import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CinematicUiBridgeError,
  createCinematicUiBridge,
} from '../adapters/cinematic-ui-bridge.mjs';

function clientStub({ profileError = null, profile = { looks: [] } } = {}) {
  let listener = null;
  const calls = [];
  return {
    calls,
    subscribe(fn) { listener = fn; fn({ type: 'snapshot' }); return () => { listener = null; }; },
    emit(event) { listener?.(event); },
    dispose() {},
    health: async () => ({ status: 'ready', release_sha: 'beta-sha' }),
    loadProfile: async () => { if (profileError) throw profileError; return profile; },
    authenticate: async (pin) => { calls.push(['authenticate', pin]); return { authenticated: true }; },
    createRunFromUploads: async (input) => { calls.push(['look', input]); return { run_id: 'run-1', status: 'QUEUED' }; },
    saveRun: async (runId) => ({ look: { look_id: 'look-1', run_id: runId } }),
    selectGarments: async () => ({}),
    retryRun: async (runId) => { calls.push(['retry-run', runId]); return {}; },
    listScenePresets: async () => ({ presets: [{ preset_id: 'std.one', preset_version: '1.0.0', ui_name_uk: 'Один' }] }),
    scenePresetPreviewUrl: (id, version) => `/api/scene-presets/${id}/${version}/preview`,
    listEditorialModes: async () => ({ modes: [{ preset_id: 'shoot.one', version: '1.0.0', ui_name_uk: 'Стиль' }] }),
    editorialModePreviewUrl: (id, version) => `/api/editorial-modes/${id}/${version}/preview`,
    videoCapability: async () => ({ available: true, styles: [{ id: 'air', title: 'Повітря', motion_mode: 'air', preview_url: '/p', playback_url: '/v', reference_url: '/r' }] }),
    realtimeCapability: async () => ({ paid_live_ready: true, consent: { maximum_session_seconds: 15 } }),
    postShootPipeline: async () => ({ modes: [{ id: 'live_webcam', provider: { model_id: 'server-owned-live' } }] }),
    liveReferenceDataUrl: async (lookId) => {
      calls.push(['live-reference', lookId]);
      return 'data:image/png;base64,AA==';
    },
    createScene: async (lookId, input) => { calls.push(['background', lookId, input]); return { scene_id: 'scene-1', status: 'QUEUED' }; },
    createShoot: async (lookId, input) => { calls.push(['shoot', lookId, input]); return { shoot_id: 'shoot-1', status: 'QUEUED' }; },
    createVideo: async (input) => { calls.push(['video', input]); return { clip_id: 'clip-1', status: 'CREATED' }; },
    watchVideo: () => () => {},
    retryScene: async () => ({}),
    retryVideo: async () => ({}),
    approveShootBible: async (shootId, hash) => { calls.push(['approve-bible', shootId, hash]); return {}; },
    approveShootHero: async (shootId, hash) => { calls.push(['approve-hero', shootId, hash]); return {}; },
    retryShootShot: async (shootId, slot) => { calls.push(['retry-shoot', shootId, slot]); return {}; },
    sceneImageUrl: (id) => `/api/profile/scenes/${id}/image`,
    videoUrl: (id) => `/api/profile/video-clips/${id}/video`,
    shootShotImageUrl: (id, slot) => `/api/profile/editorial-shoots/${id}/shots/${slot}/image`,
    loadShootContactSheet: async () => ({ shots: [{ slot: 'hero' }, { slot: 'detail' }] }),
    startLiveLook: async (input) => { calls.push(['live', input]); return 'token'; },
  };
}

test('reports the deployed beta release and keeps authentication explicit', async () => {
  const unauthorized = Object.assign(new Error('auth'), { status: 401 });
  const client = clientStub({ profileError: unauthorized });
  const bridge = createCinematicUiBridge({ client, autoProbe: false });

  await bridge.probe();
  assert.equal(bridge.state().releaseSha, 'beta-sha');
  assert.equal(bridge.state().availability, 'auth_required');
  await assert.rejects(
    bridge.createLook({ person: new Blob(['a']), garments: [new Blob(['b'])] }),
    (error) => error instanceof CinematicUiBridgeError && error.code === 'AUTH_REQUIRED',
  );
});

test('restores beta saved looks and action context after a browser reload', async () => {
  const profile = {
    looks: [{
      look_id: 'look-saved',
      avatar_id: 'avatar-1',
      created_at: '2026-07-31T20:00:00.000Z',
      image_url: '/api/profile/looks/look-saved/image',
    }],
  };
  const client = clientStub({ profile });
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();

  assert.equal(bridge.state().profile.looks[0].look_id, 'look-saved');
  assert.equal(bridge.state().savedLook.look_id, 'look-saved');
  assert.equal(bridge.state().catalogs.shoots[0].id, 'shoot.one');

  await bridge.useSavedLook('look-saved');
  assert.equal(bridge.state().savedLook.look_id, 'look-saved');
  await assert.rejects(bridge.useSavedLook('missing-look'), (error) => (
    error instanceof CinematicUiBridgeError && error.code === 'SAVED_LOOK_NOT_FOUND'
  ));
});

test('restores nested avatar looks from older beta profile payloads', async () => {
  const client = clientStub({ profile: {
    looks: [],
    avatars: [{ avatar_id: 'avatar-legacy', looks: [{
      look_id: 'look-legacy', image_url: '/api/profile/looks/look-legacy/image',
    }] }],
  } });
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  assert.equal(bridge.state().savedLook.look_id, 'look-legacy');
});

test('a completed real run becomes the saved look and loads all action catalogues', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  await bridge.createLook({ person: new Blob(['a']), garments: [new Blob(['b'])] });
  client.emit({ type: 'run:event', run: { run_id: 'run-1', status: 'COMPLETED', outputs: { avatar_outfit: '/api/runs/run-1/files/avatar_outfit.png' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const state = bridge.state();
  assert.equal(state.savedLook.look_id, 'look-1');
  assert.equal(state.result.pendingRealMedia, false);
  assert.equal(state.catalogs.backgrounds[0].id, 'std.one');
  assert.equal(state.catalogs.shoots[0].id, 'shoot.one');
  assert.equal(state.catalogs.videos[0].id, 'air');
  assert.equal(state.liveCapability.app, 'server-owned-live');
});

test('normalizes beta mode_id catalogues so main renders real style previews', async () => {
  const client = clientStub();
  client.listEditorialModes = async () => ({ modes: [{
    mode_id: 'shoot.real-style',
    mode_version: '1.0.0',
    ui_name_uk: 'Реальний стиль',
    visual_system: 'власний preview',
    source_set_status: 'READY',
    preview_url: '/api/editorial-modes/shoot.real-style/1.0.0/preview?v=sha',
  }] });
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  client.emit({ type: 'run:event', run: {
    run_id: 'run-1', status: 'COMPLETED',
    outputs: { avatar_outfit: '/api/runs/run-1/files/avatar_outfit.png' },
  } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const style = bridge.state().catalogs.shoots[0];
  assert.equal(style.id, 'shoot.real-style');
  assert.equal(style.version, '1.0.0');
  assert.equal(style.previewUrl, '/api/editorial-modes/shoot.real-style/1.0.0/preview?v=sha');
});

test('failed outfit QA maps only the verified visible conflict into mirror copy', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  client.emit({
    type: 'run:event',
    run: {
      run_id: 'run-1', status: 'FAILED', terminal_stage: 'OUTFIT_QA',
      message: 'Candidate identity is supported, but the generated outfit retains the prior blue T-shirt visibly at the neckline.',
      garments: [{ source_index: 0, preview_url: '/api/runs/run-1/garments/0?preview=1' }],
    },
  });
  assert.deepEqual(bridge.state().error, {
    code: 'OUTFIT_QA_VISIBLE_BLUE_LAYER',
    message: 'На образі лишився синій шар замість погодженого темного верху. Повторимо тільки образ.',
  });
  assert.equal(bridge.state().run.garments[0].preview_url, '/api/runs/run-1/garments/0?preview=1');
});

test('first-appearance review keeps the real core image visible and retryable', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  client.emit({
    type: 'run:event',
    run: {
      run_id: 'run-1',
      status: 'NEEDS_INPUT',
      phase: 'CORE_PIPELINE',
      terminal_stage: 'FIRST_APPEARANCE',
      outputs: { avatar_outfit: '/api/runs/run-1/files/avatar_outfit.png' },
      error: { code: 'FIRST_APPEARANCE_NEEDS_INPUT', message: 'crop needs review' },
    },
  });
  const state = bridge.state();
  assert.equal(state.phase, 'needs_input');
  assert.equal(state.result.mediaUrl, '/api/runs/run-1/files/avatar_outfit.png');
  assert.equal(state.result.reviewRequired, true);
  assert.equal(state.review.code, 'FIRST_APPEARANCE_NEEDS_INPUT');
  await bridge.retryActive();
  assert.equal(client.calls.at(-1)[0], 'retry-run');
});

test('legacy first-appearance failure with persisted output is still recoverable', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  client.emit({
    type: 'run:event',
    run: {
      run_id: 'run-legacy',
      status: 'FAILED',
      terminal_stage: 'COMPLETED',
      outputs: { avatar_outfit: '/api/runs/run-legacy/files/avatar_outfit.png' },
      error: { name: 'FirstAppearanceNeedsInputError', message: 'crop needs review' },
    },
  });
  assert.equal(bridge.state().result.mediaUrl, '/api/runs/run-legacy/files/avatar_outfit.png');
  assert.equal(bridge.state().result.reviewRequired, true);
  assert.equal(bridge.state().review.retryable, true);
});

test('an unsupported garment format returns a precise replacement instruction', async () => {
  const rejected = Object.assign(new Error('Фото речі 2 must be PNG, JPEG, or WEBP'), {
    status: 422,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    body: { field: 'Фото речі 2' },
  });
  const client = clientStub();
  client.createRunFromUploads = async () => { throw rejected; };
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  await assert.rejects(bridge.createLook({ person: new Blob(['a']), garments: [new Blob(['b'])] }));
  assert.deepEqual(bridge.state().error, {
    code: 'UNSUPPORTED_GARMENT_MEDIA', status: 422,
    message: 'Фото речі 2: оберіть JPEG, PNG або WebP.',
  });
});

test('a too-small garment returns a replacement instruction instead of a paid retry', async () => {
  const rejected = Object.assign(new Error('Фото речі 3 must be at least 256×256'), {
    status: 422,
    code: 'IMAGE_TOO_SMALL',
    body: { field: 'Фото речі 3', nextAction: 'REPLACE_INPUT' },
  });
  const client = clientStub();
  client.createRunFromUploads = async () => { throw rejected; };
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  await assert.rejects(bridge.createLook({ person: new Blob(['a']), garments: [new Blob(['b'])] }));
  assert.deepEqual(bridge.state().error, {
    code: 'IMAGE_TOO_SMALL', status: 422,
    message: 'Фото речі 3: потрібне зображення щонайменше 256×256 px.',
  });
});

test('Live reference and token stay bound to the saved look and beta capability', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  await bridge.createLook({ person: new Blob(['a']), garments: [new Blob(['b'])] });
  client.emit({ type: 'run:event', run: { run_id: 'run-1', status: 'COMPLETED', outputs: { avatar_outfit: '/api/look.png' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(await bridge.loadLiveReference(), 'data:image/png;base64,AA==');
  await bridge.startLive({ privacyConsent: true, costAcknowledged: true });
  assert.deepEqual(client.calls.find(([kind]) => kind === 'live-reference'), ['live-reference', 'look-1']);
  assert.deepEqual(client.calls.find(([kind]) => kind === 'live')[1], {
    lookId: 'look-1',
    capability: { app: 'server-owned-live', default_app: undefined, max_session_seconds: 15 },
    privacyConsent: true,
    costAcknowledged: true,
  });
});

test('background, shoot and video actions carry the selected saved look', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  await bridge.createLook({ person: new Blob(['a']), garments: [new Blob(['b'])] });
  client.emit({ type: 'run:event', run: { run_id: 'run-1', status: 'COMPLETED', outputs: { avatar_outfit: '/api/look.png' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  await bridge.createBackground({ presetId: 'std.one', presetVersion: '1.0.0', aspect: '9:16' });
  await bridge.createShoot({ modeId: 'shoot.one', modeVersion: '1.0.0' });
  await bridge.createVideo({ styleId: 'air', motionMode: 'air', aspect: '16:9' });

  assert.deepEqual(client.calls.find(([kind]) => kind === 'background').slice(0, 2), ['background', 'look-1']);
  assert.deepEqual(client.calls.find(([kind]) => kind === 'shoot').slice(0, 2), ['shoot', 'look-1']);
  assert.equal(client.calls.find(([kind]) => kind === 'video')[1].surface, 'tv');
});

test('duplicate garment choices and explicit shoot approvals remain actionable', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();
  await bridge.createLook({ person: new Blob(['a']), garments: [new Blob(['b'])] });
  client.emit({
    type: 'run:event',
    run: {
      run_id: 'run-1', status: 'NEEDS_INPUT',
      conflicts: [{ type: 'DUPLICATE_SLOT', category: 'top', reference_set_ids: ['set-0', 'set-1'] }],
      garments: [
        { source_index: 0, preview_url: '/api/a.png', observed: { garment_type: 'сорочка' } },
        { source_index: 1, preview_url: '/api/b.png', observed: { garment_type: 'джемпер' } },
      ],
    },
  });
  assert.deepEqual(bridge.state().choices[0].options[1], {
    id: 'set-1', label: 'джемпер', previewUrl: '/api/b.png',
  });

  client.emit({
    type: 'shoot:event',
    shoot: { shoot_id: 'shoot-1', status: 'BIBLE_PENDING_APPROVAL', bible: { sha256: 'a'.repeat(64) } },
  });
  await bridge.approveShoot();
  assert.deepEqual(client.calls.at(-1), ['approve-bible', 'shoot-1', 'a'.repeat(64)]);

  client.emit({
    type: 'shoot:event',
    shoot: { shoot_id: 'shoot-1', status: 'HERO_PENDING_APPROVAL', hero_output_sha256: 'b'.repeat(64) },
  });
  await bridge.approveShoot();
  assert.deepEqual(client.calls.at(-1), ['approve-hero', 'shoot-1', 'b'.repeat(64)]);

  client.emit({
    type: 'shoot:reconciled',
    shoot: {
      shoot_id: 'shoot-1',
      status: 'NEEDS_RETRY',
      terminal_stage: 'SHOT_RETRY',
      shots: [{ slot: 'hero', status: 'FAILED' }],
    },
  });
  assert.equal(bridge.state().phase, 'failed');
  assert.deepEqual(bridge.state().error, { code: 'SHOOT_NEEDS_RETRY' });
});
