import test from 'node:test';
import assert from 'node:assert/strict';
import { createZeelyClient, phaseFor, ZeelyApiError } from '../adapters/zeely-client.mjs';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function textResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

class FakeEventSource {
  static instances = [];
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  emit(type, payload) { this.listeners.get(type)?.({ data: JSON.stringify(payload) }); }
  close() { this.closed = true; }
}

test('normalizes beta states without presentation knowledge', () => {
  assert.equal(phaseFor(null), 'idle');
  assert.equal(phaseFor({ status: 'RUNNING' }), 'running');
  assert.equal(phaseFor({ status: 'NEEDS_INPUT' }), 'needs_input');
  assert.equal(phaseFor({ status: 'APPROVE_HERO' }), 'waiting_for_approval');
  assert.equal(phaseFor({ status: 'PASS' }), 'completed');
  assert.equal(phaseFor({ status: 'FAILED' }), 'failed');
  assert.equal(phaseFor({ status: 'FAIL' }), 'failed');
  assert.equal(phaseFor({ status: 'NEEDS_RETRY' }), 'recovering');
});

test('uses a relative api base and starts a run from a server draft', async () => {
  const calls = [];
  const client = createZeelyClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ run_id: 'run-1', status: 'RUNNING' }, 202);
    },
    EventSourceImpl: FakeEventSource,
    createFinalizationKey: () => '1fce992c-2139-4d12-b8b4-0c361f8a72e9',
  });

  await client.createRunFromDraft({ fileManifest: { person: { id: 'p1' } } });

  assert.equal(calls[0].url, '/api/draft/run');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    consent: true,
    finalization_key: '1fce992c-2139-4d12-b8b4-0c361f8a72e9',
    file_manifest: { person: { id: 'p1' } },
    source_avatar_id: null,
    source_look_id: null,
  });
  assert.equal(FakeEventSource.instances.at(-1).url, '/api/runs/run-1/events');
  assert.equal(client.snapshot().phase, 'running');
});

test('passes idempotency headers for scene and shoot mutations', async () => {
  const calls = [];
  const client = createZeelyClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/scenes')) return jsonResponse({ scene_id: 'scene-1', status: 'QUEUED' }, 202);
      return jsonResponse({ shoot_id: 'shoot-1', status: 'QUEUED' }, 202);
    },
    EventSourceImpl: FakeEventSource,
  });

  await client.createScene('look-1', { presetId: 'std.room', presetVersion: '1', idempotencyKey: 'scene-key' });
  await client.createShoot('look-1', { modeId: 'shoot.editorial', modeVersion: '2', idempotencyKey: 'shoot-key' });

  assert.equal(calls[0].options.headers['Idempotency-Key'], 'scene-key');
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'shoot-key');
});

test('SSE updates state and a stale watcher cannot close its replacement', () => {
  const client = createZeelyClient({ fetchImpl: async () => jsonResponse({}), EventSourceImpl: FakeEventSource });
  const firstStop = client.watchRun('run-1');
  const first = FakeEventSource.instances.at(-1);
  client.watchRun('run-1');
  assert.equal(first.closed, true);
  const current = FakeEventSource.instances.at(-1);
  current.emit('run', { run_id: 'run-1', status: 'COMPLETED' });
  assert.equal(client.snapshot().phase, 'completed');
  firstStop();
  assert.equal(current.closed, false);
  client.watchRun('run-1')();
  assert.equal(current.closed, true);
});

test('reconciles the current run once after an SSE drop so terminal failure reaches retry UI', async () => {
  const calls = [];
  const client = createZeelyClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/draft/run') return jsonResponse({ run_id: 'run-drop', status: 'RUNNING' }, 202);
      if (url === '/api/runs/run-drop') return jsonResponse({
        run_id: 'run-drop', status: 'FAILED', code: 'ITEM_FIDELITY_RETRY_EXHAUSTED',
      });
      throw new Error(`unexpected request ${url}`);
    },
    EventSourceImpl: FakeEventSource,
    createFinalizationKey: () => '1fce992c-2139-4d12-b8b4-0c361f8a72e9',
    sseRecoveryInitialDelayMs: 0,
    sseRecoveryMaxAttempts: 3,
  });

  await client.createRunFromDraft({ fileManifest: { person: { id: 'p1' } } });
  const stream = FakeEventSource.instances.at(-1);
  stream.onerror();
  stream.onerror();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(calls.filter(({ url }) => url === '/api/runs/run-drop').length, 1);
  assert.equal(client.snapshot().run.status, 'FAILED');
  assert.equal(client.snapshot().phase, 'failed');
  assert.equal(stream.closed, true);
});

test('preserves a structured API error for cinematic UI recovery states', async () => {
  const client = createZeelyClient({
    fetchImpl: async () => jsonResponse({ error: 'Look not found', code: 'LOOK_NOT_FOUND' }, 404),
    EventSourceImpl: FakeEventSource,
  });
  await assert.rejects(() => client.loadProfile(), (error) => {
    assert.ok(error instanceof ZeelyApiError);
    assert.equal(error.status, 404);
    assert.equal(error.code, 'LOOK_NOT_FOUND');
    return true;
  });
  assert.equal(client.snapshot().error.code, 'LOOK_NOT_FOUND');
});

test('video polling is opt-in, begins immediately, and can be stopped', async () => {
  let calls = 0;
  const client = createZeelyClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ clip_id: 'clip-1', status: 'RUNNING' });
    },
    EventSourceImpl: FakeEventSource,
  });
  const stop = client.watchVideo('clip-1', { intervalMs: 250 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.equal(client.snapshot().video.clip_id, 'clip-1');
  stop();
});

test('matches the deployed Fashion Video style and explicit retry contract', async () => {
  const calls = [];
  const client = createZeelyClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(url.endsWith('/retry')
        ? { clip_id: 'clip-2', status: 'GENERATING' }
        : { clip_id: 'clip-1', status: 'CREATED' }, 202);
    },
    EventSourceImpl: FakeEventSource,
  });

  await client.createVideo({
    lookId: 'look-1',
    surface: 'tv',
    styleId: 'fabric-air',
    motionMode: 'editorial-forward',
    durationSeconds: 8,
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    look_id: 'look-1',
    surface: 'tv',
    style_id: 'fabric-air',
    motion_mode: 'editorial-forward',
    duration_seconds: 8,
  });
  assert.equal(client.videoStylePlaybackUrl('look-1', 'fabric-air'), '/api/profile/looks/look-1/video-styles/fabric-air/playback');
  assert.equal(client.videoStyleReferenceUrl('look-1', 'fabric-air'), '/api/profile/looks/look-1/video-styles/fabric-air/reference');

  await client.retryVideo('clip-1', 'retry-key');
  assert.equal(calls[1].url, '/api/profile/video-clips/clip-1/retry');
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'retry-key');
  client.dispose();
});

test('authentication stays a transport concern and remains same-origin', async () => {
  const calls = [];
  const client = createZeelyClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ authenticated: true });
    },
    EventSourceImpl: FakeEventSource,
  });

  await client.authenticate('1234');
  assert.equal(calls[0].url, '/api/auth/pin');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].options.body), { pin: '1234' });
});

test('Live Look forwards explicit acknowledgements and only the server capability', async () => {
  const calls = [];
  const client = createZeelyClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return textResponse('test-only-token');
    },
    EventSourceImpl: FakeEventSource,
  });
  const token = await client.startLiveLook({
    lookId: 'look-1',
    capability: { default_app: 'server-owned-live', max_session_seconds: 40 },
    privacyConsent: true,
    costAcknowledged: true,
  });
  assert.equal(calls[0].url, '/api/fal/realtime-token');
  assert.equal(token, 'test-only-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    app: 'server-owned-live',
    look_id: 'look-1',
    privacy_consent: true,
    cost_acknowledged: true,
    max_session_seconds: 40,
  });
});

test('Live Look does not invent a provider or duration without a capability', async () => {
  const calls = [];
  const client = createZeelyClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return textResponse('test-only-token');
    },
    EventSourceImpl: FakeEventSource,
  });

  await client.startLiveLook({ lookId: 'look-1', privacyConsent: true, costAcknowledged: true });

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    look_id: 'look-1',
    privacy_consent: true,
    cost_acknowledged: true,
  });
});

test('Live reference stays same-origin private media and becomes an in-memory data URL', async () => {
  const calls = [];
  const client = createZeelyClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(new Blob(['ok'], { type: 'image/png' }), { status: 200 });
    },
    EventSourceImpl: FakeEventSource,
  });

  const reference = await client.liveReferenceDataUrl('look-1');
  assert.equal(calls[0].url, '/api/profile/looks/look-1/live-reference.png');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(reference, 'data:image/png;base64,b2s=');
});
