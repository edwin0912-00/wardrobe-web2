import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerEditorialShootRoutes } from '../../src/web/editorial-shoot-routes.js';
import { registerSceneRoutes } from '../../src/web/scene-routes.js';

test('scene routes validate creates first and gate retries with the owned persisted mode', async (t) => {
  const app = Fastify({ logger: false });
  const availabilityChecks = [];
  const projections = new Map();
  let scene = null;
  let createInput = null;
  let lookReads = 0;
  let retryCalls = 0;
  let rejectFast = false;
  const profiles = {
    sceneProjectionRecords: () => [],
    async flushDeletionQueue() {},
    async approvedLookReference() {
      lookReads += 1;
      return { look_id: 'look-scene-mode' };
    },
    projectScene(profileId, lookId, createdScene) {
      projections.set(`${profileId}:${createdScene.scene_id}`, { look_id: lookId });
    },
    sceneProjection(profileId, sceneId) {
      return projections.get(`${profileId}:${sceneId}`) ?? null;
    },
    syncSceneProjection() {},
  };
  const sceneService = {
    async createScene(input) {
      createInput = input;
      scene = {
        scene_id: 'scene_route_mode_fixture',
        image_generation_mode: input.imageGenerationMode,
        status: 'QUEUED',
        approved_look: { look_id: 'look-scene-mode' },
        output: null,
      };
      return scene;
    },
    async getScene(sceneId) {
      return scene?.scene_id === sceneId ? scene : null;
    },
    async retryScene(sceneId) {
      retryCalls += 1;
      return scene?.scene_id === sceneId ? scene : null;
    },
  };
  await registerSceneRoutes(app, {
    sceneService,
    profiles,
    profileApi: { async resolveRequestProfile() { return { profileId: 'profile-scene-mode' }; } },
    runService: {},
    presetResolver: {
      async presetReference() { return { reference_pack_sha256: 'pack-sha' }; },
    },
    assertImageGenerationAvailable: async (mode) => {
      availabilityChecks.push(mode);
      if (rejectFast && mode === 'fast') {
        const error = new Error('Fast image generation is unavailable');
        error.statusCode = 503;
        throw error;
      }
    },
  });
  await app.ready();
  t.after(() => app.close());

  const invalid = await app.inject({
    method: 'POST',
    url: '/api/profile/looks/look-scene-mode/scenes',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'scene-route-invalid-0001' },
    payload: { preset_id: 'scene.fixture', preset_version: '1.0.0', image_generation_mode: null },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.deepEqual(availabilityChecks, []);
  assert.equal(lookReads, 0, 'invalid input is refused before profile work');
  assert.equal(createInput, null);

  rejectFast = true;
  const unavailable = await app.inject({
    method: 'POST',
    url: '/api/profile/looks/look-scene-mode/scenes',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'scene-route-unavailable-0001' },
    payload: { preset_id: 'scene.fixture', preset_version: '1.0.0', image_generation_mode: 'fast' },
  });
  assert.equal(unavailable.statusCode, 503, unavailable.body);
  assert.equal(lookReads, 0, 'unavailable capability is refused before profile work');
  assert.equal(createInput, null);
  rejectFast = false;
  availabilityChecks.length = 0;

  const created = await app.inject({
    method: 'POST',
    url: '/api/profile/looks/look-scene-mode/scenes',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'scene-route-fast-0001' },
    payload: { preset_id: 'scene.fixture', preset_version: '1.0.0', image_generation_mode: 'fast' },
  });
  assert.equal(created.statusCode, 202, created.body);
  assert.equal(createInput.imageGenerationMode, 'fast');
  assert.equal(created.json().image_generation_mode, 'fast');

  const retried = await app.inject({
    method: 'POST',
    url: `/api/profile/scenes/${scene.scene_id}/retry`,
    headers: { 'content-type': 'application/json', 'idempotency-key': 'scene-route-retry-0001' },
    payload: { image_generation_mode: 'slow' },
  });
  assert.equal(retried.statusCode, 202, retried.body);
  assert.equal(retryCalls, 1);
  assert.deepEqual(availabilityChecks, ['fast', 'fast']);
});

test('shoot routes pass Fast at creation and gate later actions from owned persisted state', async (t) => {
  const app = Fastify({ logger: false });
  const availabilityChecks = [];
  const lookId = 'look-shoot-mode';
  let lookReads = 0;
  let createInput = null;
  let shoot = null;
  const profiles = {
    editorialShootProjectionRecords: () => [],
    async flushDeletionQueue() {},
    async approvedLookReference() {
      lookReads += 1;
      return { look_id: lookId };
    },
    projectEditorialShoot(_profileId, _requestLookId, createdShoot) {
      shoot = createdShoot;
    },
    editorialShootProjection: () => (shoot ? { look_id: lookId } : null),
    syncEditorialShootProjection() {},
  };
  const editorialShootService = {
    async createShoot(input) {
      createInput = input;
      shoot = {
        shoot_id: 'shoot_route_mode_fixture',
        image_generation_mode: input.imageGenerationMode,
        status: 'BIBLE_PENDING_APPROVAL',
        phase: 'BIBLE_REVIEW',
        message: 'Waiting for approval',
        created_at: '2026-10-03T00:00:00.000Z',
        updated_at: '2026-10-03T00:00:00.000Z',
        bindings: {
          approved_look: { look_id: lookId },
          shoot_bible: {
            bible_id: 'bible_route_mode_fixture',
            mode_id: 'editorial.fixture',
            mode_version: '1.0.0',
            title: 'Fixture',
            visual_system: 'Fixture system',
            sha256: 'a'.repeat(64),
          },
        },
        bible_approval: null,
        hero_approval: null,
        shots: [],
        cancellation: null,
      };
      return shoot;
    },
    async getShoot(shootId) { return shoot?.shoot_id === shootId ? shoot : null; },
    async approveBible() { return shoot; },
    async approveHero() { return shoot; },
    async retryShot() { return shoot; },
  };
  await registerEditorialShootRoutes(app, {
    editorialShootService,
    profiles,
    profileApi: { async resolveRequestProfile() { return { profileId: 'profile-shoot-mode' }; } },
    runService: {},
    presetResolver: {
      async compileEditorialShootBible({ modeId, version }) {
        return { mode_id: modeId, mode_version: version };
      },
    },
    sceneService: {},
    assertImageGenerationAvailable: async (mode) => availabilityChecks.push(mode),
  });
  await app.ready();
  t.after(() => app.close());

  const invalid = await app.inject({
    method: 'POST',
    url: `/api/profile/looks/${lookId}/editorial-shoots`,
    headers: { 'content-type': 'application/json', 'idempotency-key': 'shoot-route-invalid-0001' },
    payload: { mode_id: 'editorial.fixture', mode_version: '1.0.0', image_generation_mode: null },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.deepEqual(availabilityChecks, []);
  assert.equal(lookReads, 0, 'invalid input is refused before profile work');
  assert.equal(createInput, null);

  const created = await app.inject({
    method: 'POST',
    url: `/api/profile/looks/${lookId}/editorial-shoots`,
    headers: { 'content-type': 'application/json', 'idempotency-key': 'shoot-route-fast-0001' },
    payload: {
      mode_id: 'editorial.fixture',
      mode_version: '1.0.0',
      image_generation_mode: 'fast',
    },
  });
  assert.equal(created.statusCode, 202, created.body);
  assert.equal(createInput.imageGenerationMode, 'fast');
  assert.equal(created.json().image_generation_mode, 'fast');

  const approval = await app.inject({
    method: 'POST',
    url: `/api/profile/editorial-shoots/${shoot.shoot_id}/approve-bible`,
    headers: { 'content-type': 'application/json', 'idempotency-key': 'shoot-route-approve-0001' },
    payload: { expected_bible_sha256: 'a'.repeat(64), image_generation_mode: 'slow' },
  });
  assert.equal(approval.statusCode, 202, approval.body);

  const retry = await app.inject({
    method: 'POST',
    url: `/api/profile/editorial-shoots/${shoot.shoot_id}/shots/environmental_hero/retry`,
    headers: { 'content-type': 'application/json', 'idempotency-key': 'shoot-route-retry-0001' },
    payload: { image_generation_mode: 'slow' },
  });
  assert.equal(retry.statusCode, 202, retry.body);
  const heroApproval = await app.inject({
    method: 'POST',
    url: `/api/profile/editorial-shoots/${shoot.shoot_id}/approve-hero`,
    headers: { 'content-type': 'application/json', 'idempotency-key': 'shoot-route-hero-0001' },
    payload: { expected_output_sha256: 'b'.repeat(64), image_generation_mode: 'slow' },
  });
  assert.equal(heroApproval.statusCode, 202, heroApproval.body);
  assert.deepEqual(availabilityChecks, ['fast', 'fast', 'fast', 'fast']);
});
