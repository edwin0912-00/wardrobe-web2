import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MonitorEventStore, projectMonitorEvent } from '../../src/monitor/event-store.js';
import { createWebApp } from '../../src/web/app.js';

async function store() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zeely-monitor-'));
  const value = new MonitorEventStore({ filename: path.join(directory, 'events.jsonl') });
  await value.initialize();
  return value;
}

const service = {
  createRun: async () => null, getRun: async () => null, subscribe: () => () => {},
  outputFile: async () => null, retry: async () => null, deleteRun: async () => {},
};

async function readFirstMonitorStreamEvent(app) {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  let reader;
  try {
    const response = await fetch(`${address}/api/monitor/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let payload = '';
    while (!payload.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      payload += decoder.decode(value, { stream: true });
    }
    const line = payload.split('\n').find((candidate) => candidate.startsWith('data: '));
    assert.ok(line, 'monitor stream must emit one JSON event');
    return JSON.parse(line.slice('data: '.length));
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    await app.close();
  }
}

test('monitor store appends structured events and returns a bounded tail', async () => {
  const monitor = await store();
  await monitor.append({ source: 'test', type: 'run.phase', run_id: 'run-1', data: { stage: 'UPLOADED' } });
  await monitor.append({ source: 'test', type: 'run.phase', run_id: 'run-1', data: { stage: 'VALIDATING' } });
  const events = await monitor.tail(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.stage, 'VALIDATING');
  assert.match(events[0].id, /^[0-9a-f-]{36}$/);
});

test('monitor output redacts historical and newly appended infrastructure metadata', async () => {
  const monitor = await store();
  const userPath = ['', 'Users', 'jarvis1', 'private', 'run.json'].join('/');
  const temporaryPath = ['', 'tmp', 'private-a'].join('/');
  const homePath = ['', 'home', 'service', 'private-b'].join('/');
  await monitor.append({ source: 'server', type: 'server.error', data: {
    message: `Zeely failed at ${userPath}`,
    paths: [temporaryPath, homePath],
  } });
  const [event] = await monitor.tail(1);
  assert.doesNotMatch(JSON.stringify(event), /zeely|jarvis|\/Users\/|\/home\/|\/tmp\//i);
  assert.match(event.data.message, /\[redacted-local-path\]/);
});

test('monitor routes expose a bounded typed projection for stall diagnostics', async () => {
  const monitor = await store();
  await monitor.append({
    source: 'agent',
    type: 'agent.stall_detected',
    severity: 'error',
    run_id: '55555555-5555-4555-8555-555555555555',
    data: {
      incident_id: '0123456789abcdef',
      diagnostic_code: 'RUN_CHECKPOINT_STALLED',
      phase: 'CORE_PIPELINE',
      checkpoint_at: '2026-07-22T13:34:59.999Z',
      threshold_ms: 1_500_000,
      elapsed_ms: 1_500_001,
      recovery_state: 'QUEUED',
      attempt_count: 0,
      message: 'RAW_PROMPT_DO_NOT_EMIT',
      provider_payload: 'TOKEN_VALUE_DO_NOT_EMIT',
    },
  });
  const app = await createWebApp({ service, monitor });
  const response = await app.inject({ method: 'GET', url: '/api/monitor/events' });
  assert.equal(response.statusCode, 200);
  const [event] = response.json().events;
  assert.match(event.id, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(event.data, {
    incident_id: '0123456789abcdef',
    diagnostic_code: 'RUN_CHECKPOINT_STALLED',
    phase: 'CORE_PIPELINE',
    checkpoint_at: '2026-07-22T13:34:59.999Z',
    threshold_ms: 1_500_000,
    elapsed_ms: 1_500_001,
    recovery_state: 'QUEUED',
    attempt_count: 0,
  });
  assert.doesNotMatch(response.body, /RAW_PROMPT_DO_NOT_EMIT|TOKEN_VALUE_DO_NOT_EMIT/);
  const persisted = await readFile(monitor.filename, 'utf8');
  assert.doesNotMatch(persisted, /RAW_PROMPT_DO_NOT_EMIT|TOKEN_VALUE_DO_NOT_EMIT/);
  await app.close();
});

test('monitor routes suppress malformed legacy stall payloads', async () => {
  const monitor = await store();
  await appendFile(monitor.filename, `${JSON.stringify({
    id: 'not-a-uuid',
    at: '2026-07-22T14:00:00.000Z',
    source: 'agent',
    type: 'agent.stall_heartbeat',
    severity: 'warn',
    run_id: '55555555-5555-4555-8555-555555555555',
    data: { message: 'RAW_LEGACY_PROMPT_DO_NOT_EMIT', provider_payload: 'TOKEN_VALUE_DO_NOT_EMIT' },
  })}\n`, 'utf8');
  const app = await createWebApp({ service, monitor });
  const response = await app.inject({ method: 'GET', url: '/api/monitor/events' });
  assert.equal(response.statusCode, 200);
  const [event] = response.json().events;
  assert.equal(event.id, null);
  assert.deepEqual(event.data, { diagnostic_code: 'DIAGNOSTIC_UNAVAILABLE' });
  assert.doesNotMatch(response.body, /RAW_LEGACY_PROMPT_DO_NOT_EMIT|TOKEN_VALUE_DO_NOT_EMIT/);
  await app.close();
});

test('monitor REST and SSE project historical non-stall events through the same strict public schema', async () => {
  const monitor = await store();
  const localPath = ['', 'private', 'monitor', 'provider-response.json'].join('/');
  await appendFile(monitor.filename, `${JSON.stringify({
    id: '99999999-9999-4999-8999-999999999999',
    at: '2026-07-27T01:00:00.000Z',
    source: 'runner',
    type: 'run.phase',
    severity: 'info',
    run_id: '55555555-5555-4555-8555-555555555555',
    data: {
      // This is token-shaped on purpose. A persisted value must not become
      // public merely because it happens to satisfy a permissive regex.
      status: 'UNTRUSTED_STATUS_TOKEN',
      stage: 'CORE_PIPELINE',
      message: 'UNTRUSTED_MESSAGE',
      provider_payload: { response: 'UNTRUSTED_PROVIDER_RESPONSE' },
      error: 'UNTRUSTED_ERROR',
      prompt: 'UNTRUSTED_PROMPT',
      local_path: localPath,
    },
    raw_error: 'UNTRUSTED_TOP_LEVEL_ERROR',
  })}\n`, 'utf8');

  const app = await createWebApp({ service, monitor });
  const rest = await app.inject({ method: 'GET', url: '/api/monitor/events' });
  assert.equal(rest.statusCode, 200);
  const [restEvent] = rest.json().events;
  const streamEvent = await readFirstMonitorStreamEvent(app);
  const expected = {
    id: '99999999-9999-4999-8999-999999999999',
    at: '2026-07-27T01:00:00.000Z',
    source: 'runner',
    type: 'run.phase',
    severity: 'info',
    run_id: '55555555-5555-4555-8555-555555555555',
    data: { stage: 'CORE_PIPELINE' },
  };
  assert.deepEqual(restEvent, expected);
  assert.deepEqual(streamEvent, expected);
  const publicPayload = JSON.stringify({ restEvent, streamEvent });
  assert.doesNotMatch(publicPayload, /UNTRUSTED_(?:STATUS_TOKEN|MESSAGE|PROVIDER_RESPONSE|ERROR|PROMPT|TOP_LEVEL_ERROR)|provider-response\.json/);
});

test('monitor projection uses finite enums for public stage, editorial event type, and worker code', () => {
  const base = {
    id: '99999999-9999-4999-8999-999999999999',
    at: '2026-07-27T01:00:00.000Z',
    severity: 'info',
  };
  assert.deepEqual(projectMonitorEvent({
    ...base,
    source: 'runner',
    type: 'run.phase',
    data: { status: 'RUNNING', stage: 'UNTRUSTED_STAGE_TOKEN' },
  }).data, { status: 'RUNNING' });
  assert.deepEqual(projectMonitorEvent({
    ...base,
    source: 'runner',
    type: 'editorial.phase',
    data: {
      status: 'HERO_RUNNING',
      stage: 'HERO_GENERATION',
      event_type: 'shoot.untrusted_payload',
    },
  }).data, { status: 'HERO_RUNNING', stage: 'HERO_GENERATION' });
  assert.deepEqual(projectMonitorEvent({
    ...base,
    source: 'server',
    type: 'service.codex_worker_fatal',
    data: { code: 'UNTRUSTED_CODE_TOKEN' },
  }).data, {});
  assert.deepEqual(projectMonitorEvent({
    ...base,
    source: 'server',
    type: 'service.codex_worker_fatal',
    data: { code: 'CHATGPT_AUTH_REQUIRED' },
  }).data, { code: 'CHATGPT_AUTH_REQUIRED' });
});

test('client telemetry accepts only allowlisted event types and data fields', async () => {
  const monitor = await store();
  const app = await createWebApp({ service, monitor });
  const accepted = await app.inject({ method: 'POST', url: '/api/telemetry', payload: {
    type: 'client.file_selected', session_id: 'session-1',
    data: { field: 'person', count: 1, bytes: 123, filename: 'private-name.png', secret: 'nope' },
  } });
  assert.equal(accepted.statusCode, 202);
  const events = (await app.inject({ method: 'GET', url: '/api/monitor/events' })).json().events;
  assert.equal(events.length, 1);
  assert.equal(events[0].data.field, 'person');
  assert.equal(events[0].data.filename, undefined);
  assert.equal(events[0].data.secret, undefined);
  const rejected = await app.inject({ method: 'POST', url: '/api/telemetry', payload: { type: 'steal.files', data: {} } });
  assert.equal(rejected.statusCode, 400);
  await app.close();
});
