import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import {
  EDITORIAL_QA_GATES,
  EDITORIAL_SHOT_SLOTS,
  sha256,
} from '../../src/web/editorial-shoot-contract.js';
import {
  EditorialSceneExecutor,
  editorialSceneIdForIdempotencyKey,
} from '../../src/web/editorial-scene-executor.js';
import {
  editorialShootView,
  registerEditorialShootRoutes,
} from '../../src/web/editorial-shoot-routes.js';
import { ProfileService } from '../../src/web/profile-service.js';
import {
  sceneQaItemScope,
  validatePresetReference,
  validatePresetSnapshot,
  validateReferencePack,
  validateResolvedReferenceAssets,
} from '../../src/web/scene-contract.js';
import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';

const LOOK_ID = '11111111-1111-4111-8111-111111111111';
const ZERO = '0'.repeat(64);

function gates(decision = 'PASS') {
  return EDITORIAL_QA_GATES.map((id) => ({
    id,
    decision: decision === 'FAIL' && id === 'ITEM_FIDELITY' ? 'FAIL' : 'PASS',
    evidence: `${id} exact evidence`,
    defects: decision === 'FAIL' && id === 'ITEM_FIDELITY'
      ? ['ITEM_DETAIL_MISMATCH']
      : [],
  }));
}

function rawShoot({
  shootId = 'shoot_owner_fixture',
  lookId = LOOK_ID,
  status = 'BIBLE_PENDING_APPROVAL',
} = {}) {
  return {
    shoot_id: shootId,
    status,
    phase: 'BIBLE_REVIEW',
    message: 'ShootBible awaits approval',
    created_at: '2026-07-24T08:00:00.000Z',
    updated_at: '2026-07-24T08:00:00.000Z',
    bindings: {
      approved_look: {
        look_id: lookId,
        image_sha256: ZERO,
        receipt_sha256: '1'.repeat(64),
      },
      shoot_bible: {
        bible_id: 'bible_fixture',
        mode_id: 'editorial.edwin_novak.organic_contrast',
        mode_version: '1.0.0',
        title: 'Органічний контраст — преміальна fashion-фотосесія',
        visual_system: 'Deep green, off-white and mustard.',
        sha256: '2'.repeat(64),
      },
    },
    bible_approval: null,
    hero_approval: null,
    shots: EDITORIAL_SHOT_SLOTS.map((slot) => ({
      slot,
      status: 'BLOCKED',
      retry_count: 0,
      attempts: [],
      output: null,
      error: null,
    })),
    cancellation: null,
    request_fingerprint: 'private-fingerprint-must-not-leak',
    idempotency_hash: 'private-idempotency-must-not-leak',
    state_integrity_sha256: 'private-state-hash-must-not-leak',
  };
}

test('READY editorial modes compile six strict per-shot packs from verified licensed bases', async () => {
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.resolve('assets/scene-presets'),
    projectRoot: path.resolve('.'),
  });
  await resolver.initialize();
  const catalog = await resolver.listEditorialModes();
  assert.equal(catalog.status, 'ACTIVE');
  assert.equal(catalog.generation_available, true);
  assert.deepEqual(catalog.generation_mode_ids, [
    'editorial.edwin_novak.organic_contrast',
    'editorial.edwin_novak.urban_monochrome',
  ]);

  for (const modeId of catalog.generation_mode_ids) {
    const bible = await resolver.compileEditorialShootBible({
      modeId,
      version: '1.0.0',
    });
    assert.deepEqual(bible.shots.map((shot) => shot.slot), EDITORIAL_SHOT_SLOTS);
    for (const shotSpec of bible.shots) {
      const reference = validatePresetReference(
        await resolver.editorialShotPresetReference({
          modeId,
          version: '1.0.0',
          shotSpec,
        }),
      );
      const pack = await resolver.resolveScenePreset(reference);
      validatePresetSnapshot(pack.preset, reference);
      validateReferencePack(
        pack.reference_pack,
        reference,
        reference.preset_sha256,
        reference.prompt_sha256,
        pack.preset,
      );
      validateResolvedReferenceAssets(pack.reference_pack, pack.assets);
      // Assert the derivation, not a number: an editorial ceiling is whatever the
      // slot's head guard does not reserve. Two frames were rejected at 84.7656% and
      // 93.9063% by ceilings picked by hand, so no hand-picked ceiling may come back.
      const [floor, ceiling] = pack.preset.camera.subject_height_percent;
      assert.equal(
        ceiling,
        100 - pack.preset.camera.minimum_clear_space_percent.above_hair,
        `${shotSpec.slot} ceiling must be the complement of its head guard`,
      );
      assert.ok(floor < ceiling, `${shotSpec.slot} floor must stay below its ceiling`);
      assert.deepEqual(
        shotSpec.camera.subject_height_percent,
        pack.preset.camera.subject_height_percent,
        `${shotSpec.slot} bible band must equal its canonical lock`,
      );
      assert.equal(pack.reference_pack.source_ledger.status, 'VERIFIED_FOR_RELEASE');
      assert.ok(pack.reference_pack.source_ledger.sources.every(
        (source) => source.rights.status === 'VERIFIED',
      ));
      assert.ok(pack.assets.every((asset) => asset.media_type === 'application/json'));
      assert.ok(pack.preset.style_observations.every(
        (source) => source.role === 'editorial_style_observation'
          && source.rights === undefined,
      ));
    }
  }

  await assert.rejects(
    () => resolver.compileEditorialShootBible({
      modeId: 'editorial.edwin_novak.institutional_modernism',
      version: '1.0.0',
    }),
    /preview-only|not ready/i,
  );
});

test('editorial item QA scope follows the intentional crop without weakening full-body shots', () => {
  const items = [
    { reference_set_id: 'top_1', category: 'top' },
    { reference_set_id: 'bag_1', category: 'bag' },
    { reference_set_id: 'shoe_1', category: 'footwear' },
  ];
  assert.deepEqual(sceneQaItemScope(items, null), items);
  assert.deepEqual(
    sceneQaItemScope(items, { editorial: { shot_slot: 'sculptural_three_quarter' } }),
    items.slice(0, 2),
  );
  assert.deepEqual(
    sceneQaItemScope(items, { editorial: { shot_slot: 'interference_frame' } }),
    items.slice(0, 2),
  );
  assert.deepEqual(
    sceneQaItemScope(items, { editorial: { shot_slot: 'material_or_accessory_detail' } }),
    items.slice(0, 1),
  );
  assert.deepEqual(
    sceneQaItemScope(items, { editorial: { shot_slot: 'wide_campaign_coda' } }),
    items,
  );
});

test('EditorialSceneExecutor delegates to one deterministic SceneService execution and returns nine gates on PASS or FAIL', async () => {
  for (const decision of ['PASS', 'FAIL']) {
    const idempotencyKey = `editorial-executor-${decision.toLowerCase()}-fixture`;
    const sceneId = editorialSceneIdForIdempotencyKey(idempotencyKey);
    const calls = [];
    const sceneService = {
      async createScene(input) {
        calls.push(input);
        return { scene_id: sceneId, status: 'QUEUED' };
      },
      async waitForIdle() {
        return { scene_id: sceneId, status: decision === 'PASS' ? 'COMPLETED' : 'FAILED' };
      },
      async verifiedExecutionResult() {
        return {
          decision,
          candidate_sha256: '3'.repeat(64),
          gates: gates(decision),
          reviewer: {
            type: 'MODEL',
            id: 'scene-judge',
            version: 'scene-judge-v1',
            request_id: 'internal-request',
          },
          completed_at: '2026-07-24T08:30:00.000Z',
          output: decision === 'PASS' ? {
            resource_id: sceneId,
            sha256: '3'.repeat(64),
            receipt_sha256: '4'.repeat(64),
            width: 1024,
            height: 1280,
            media_type: 'image/png',
          } : null,
        };
      },
      async getScene() {
        return { scene_id: sceneId, status: decision === 'PASS' ? 'COMPLETED' : 'FAILED' };
      },
      async outputFile() {
        return null;
      },
    };
    const presetResolver = {
      async editorialShotPresetReference() {
        return {
          preset_id: 'editorial.fixture.clean_identity_hero',
          preset_version: '1.0.0',
          preset_sha256: '5'.repeat(64),
          reference_pack_id: 'pack.editorial.fixture',
          reference_pack_version: '1.1.0',
          reference_pack_sha256: '6'.repeat(64),
          prompt_sha256: '7'.repeat(64),
        };
      },
    };
    const executor = new EditorialSceneExecutor({ sceneService, presetResolver });
    const result = await executor.executeShot({
      idempotency_key: idempotencyKey,
      approved_look: {
        look_id: 'look_fixture',
        image_sha256: '8'.repeat(64),
        receipt_sha256: '9'.repeat(64),
      },
      shoot_bible: {
        mode_id: 'editorial.edwin_novak.organic_contrast',
        mode_version: '1.0.0',
        sha256: 'a'.repeat(64),
      },
      shot_spec: {
        slot: 'clean_identity_hero',
        camera: { lens_mm: 50, framing: 'three_quarter' },
      },
      shot_spec_sha256: 'b'.repeat(64),
      signal: new AbortController().signal,
    });
    assert.equal(calls.length, 1);
    assert.equal(result.execution_id, sceneId);
    assert.equal(result.decision, decision);
    assert.deepEqual(result.qa.gates.map((gate) => gate.id), EDITORIAL_QA_GATES);
    assert.equal(result.output === null, decision === 'FAIL');
  }
});

test('public editorial DTO exposes output URLs but never clones private orchestration fields', () => {
  const shoot = rawShoot({ status: 'HERO_PENDING_APPROVAL' });
  shoot.shots[0] = {
    ...shoot.shots[0],
    status: 'QA_PASSED',
    output: {
      resource_id: 'scene_private_resource',
      sha256: 'c'.repeat(64),
      receipt_sha256: 'd'.repeat(64),
      width: 1024,
      height: 1280,
      media_type: 'image/png',
    },
  };
  const view = editorialShootView(shoot);
  const serialized = JSON.stringify(view);
  assert.equal(view.hero_output_sha256, 'c'.repeat(64));
  assert.equal(editorialShootView(rawShoot()).hero_output_sha256, null);
  assert.equal(
    view.mode.ui_name_uk,
    'Органічний контраст — преміальна fashion-фотосесія',
  );
  assert.equal(view.mode.visual_system, 'Deep green, off-white and mustard.');
  assert.match(view.hero_image_url, /\/shots\/clean_identity_hero\/image$/);
  assert.match(view.hero_download_url, /\/shots\/clean_identity_hero\/download$/);
  assert.match(view.shots[0].output.image_url, /\/shots\/clean_identity_hero\/image$/);
  assert.match(view.shots[0].output.download_url, /\/shots\/clean_identity_hero\/download$/);
  assert.doesNotMatch(
    serialized,
    /request_fingerprint|idempotency_hash|state_integrity_sha256|resource_id|private-/,
  );
});

test('profile ownership hides foreign editorial mutations before the service can change state', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'editorial-profile-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profiles = new ProfileService({
    databasePath: path.join(root, 'profiles.sqlite'),
  });
  await profiles.initialize();
  t.after(() => profiles.close());
  const owner = profiles.createSession();
  const foreign = profiles.createSession();
  profiles.claimRun(owner.profileId, 'owner-run');
  const saved = profiles.saveClaimedRun(owner.profileId, 'owner-run');
  const shoot = rawShoot({
    shootId: 'shoot_foreign_guard',
    lookId: saved.look.look_id,
    status: 'HERO_PENDING_APPROVAL',
  });
  shoot.shots[0] = {
    ...shoot.shots[0],
    status: 'QA_PASSED',
    output: {
      resource_id: 'scene_profile_hero',
      sha256: 'c'.repeat(64),
      receipt_sha256: 'd'.repeat(64),
      width: 1024,
      height: 1280,
      media_type: 'image/png',
    },
  };
  profiles.projectEditorialShoot(owner.profileId, saved.look.look_id, shoot);
  const reopenedProfile = profiles.getProfile(owner.profileId);
  const reopenedShoot = reopenedProfile.looks[0].editorial_shoots[0];
  assert.match(
    reopenedShoot.hero_image_url,
    /\/editorial-shoots\/shoot_foreign_guard\/shots\/clean_identity_hero\/image$/,
  );
  assert.match(
    reopenedShoot.hero_download_url,
    /\/editorial-shoots\/shoot_foreign_guard\/shots\/clean_identity_hero\/download$/,
  );

  let approvals = 0;
  let cancellations = 0;
  const editorialShootService = {
    async getShoot(shootId) {
      return shootId === shoot.shoot_id ? shoot : null;
    },
    async approveBible() {
      approvals += 1;
      return shoot;
    },
    async cancelShoot() {
      cancellations += 1;
      return {
        ...shoot,
        status: 'CANCELLED',
        phase: 'CANCELLED',
        message: 'Cancelled',
        cancellation: {
          reason: 'Cancelled by profile owner',
          cancelled_at: '2026-07-24T09:00:00.000Z',
        },
      };
    },
    subscribe() {
      return () => {};
    },
    async deleteShoot() {
      return true;
    },
  };
  const app = Fastify({ logger: false });
  await registerEditorialShootRoutes(app, {
    editorialShootService,
    profiles,
    profileApi: {
      async resolveRequestProfile(request) {
        return { profileId: request.headers['x-profile-id'] };
      },
    },
    runService: {},
    presetResolver: {},
    sceneService: {},
  });
  await app.ready();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/api/profile/editorial-shoots/${shoot.shoot_id}/approve-bible`,
    headers: {
      'x-profile-id': foreign.profileId,
      'idempotency-key': 'foreign-approval-attempt',
    },
    payload: {
      expected_bible_sha256: shoot.bindings.shoot_bible.sha256,
    },
  });
  assert.equal(response.statusCode, 404, response.body);
  assert.equal(approvals, 0);

  const cancelled = await app.inject({
    method: 'POST',
    url: `/api/profile/editorial-shoots/${shoot.shoot_id}/cancel`,
    headers: {
      'x-profile-id': owner.profileId,
    },
  });
  assert.equal(cancelled.statusCode, 202, cancelled.body);
  assert.equal(cancelled.json().status, 'CANCELLED');
  assert.equal(cancellations, 1, 'cancel must be idempotent without requiring an unused key');
});

async function ownedShootRoutes(t, shoot) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'editorial-api-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profiles = new ProfileService({
    databasePath: path.join(root, 'profiles.sqlite'),
  });
  await profiles.initialize();
  t.after(() => profiles.close());
  const owner = profiles.createSession();
  profiles.claimRun(owner.profileId, 'owner-run');
  const saved = profiles.saveClaimedRun(owner.profileId, 'owner-run');
  shoot.bindings.approved_look.look_id = saved.look.look_id;
  profiles.projectEditorialShoot(owner.profileId, saved.look.look_id, shoot);
  const calls = [];
  const editorialShootService = {
    async getShoot(shootId) {
      return shootId === shoot.shoot_id ? shoot : null;
    },
    async approveBible(shootId, options) {
      calls.push(['approveBible', options]);
      return shoot;
    },
    async approveHero(shootId, options) {
      calls.push(['approveHero', options]);
      return shoot;
    },
    async retryShot(shootId, slot, options) {
      calls.push(['retryShot', slot, options]);
      return shoot;
    },
    subscribe() {
      return () => {};
    },
  };
  const app = Fastify({ logger: false });
  await registerEditorialShootRoutes(app, {
    editorialShootService,
    profiles,
    profileApi: {
      async resolveRequestProfile(request) {
        return { profileId: request.headers['x-profile-id'] };
      },
    },
    runService: {},
    presetResolver: {},
    sceneService: {},
  });
  // The editorial plugin relaxes JSON parsing inside its own encapsulation. A route
  // registered on the root instance after it must still get Fastify's own parser, or the
  // relaxation has quietly become a server-wide change to every API.
  app.post('/api/test/root-json', async (request) => ({ body: request.body ?? null }));
  await app.ready();
  t.after(() => app.close());
  return { app, owner, calls };
}

test('editorial approval errors name only fields the routes accept, and a bodyless retry is not a JSON error', async (t) => {
  const shoot = rawShoot({ shootId: 'shoot_api_contract', status: 'HERO_PENDING_APPROVAL' });
  shoot.shots[0] = {
    ...shoot.shots[0],
    status: 'QA_PASSED',
    output: {
      resource_id: 'scene_api_contract',
      sha256: 'c'.repeat(64),
      receipt_sha256: 'd'.repeat(64),
      width: 1024,
      height: 1280,
      media_type: 'image/png',
    },
  };
  const { app, owner, calls } = await ownedShootRoutes(t, shoot);
  const url = `/api/profile/editorial-shoots/${shoot.shoot_id}`;
  const headers = {
    'x-profile-id': owner.profileId,
    'idempotency-key': 'editorial-contract-key',
    'content-type': 'application/json',
  };

  const empty = await app.inject({
    method: 'POST',
    url: `${url}/approve-bible`,
    headers,
    payload: '',
  });
  assert.equal(empty.statusCode, 422, empty.body);
  assert.equal(empty.json().code, 'INVALID_EXPECTED_SHA256');
  assert.match(empty.body, /expected_bible_sha256 must be a lowercase SHA-256/);
  assert.doesNotMatch(empty.body, /expectedBibleSha256|FST_ERR_CTP_EMPTY_JSON_BODY/);

  const camelCase = await app.inject({
    method: 'POST',
    url: `${url}/approve-hero`,
    headers,
    payload: { expectedOutputSha256: 'c'.repeat(64) },
  });
  assert.equal(camelCase.statusCode, 422, camelCase.body);
  assert.match(camelCase.body, /expected_output_sha256 must be a lowercase SHA-256/);
  assert.doesNotMatch(camelCase.body, /expectedOutputSha256/);

  const withoutKey = await app.inject({
    method: 'POST',
    url: `${url}/approve-bible`,
    headers: { 'x-profile-id': owner.profileId, 'content-type': 'application/json' },
    payload: { expected_bible_sha256: shoot.bindings.shoot_bible.sha256 },
  });
  assert.equal(withoutKey.statusCode, 422, withoutKey.body);
  assert.equal(withoutKey.json().code, 'MISSING_IDEMPOTENCY_KEY');
  assert.match(withoutKey.body, /Idempotency-Key request header is required/);

  const malformed = await app.inject({
    method: 'POST',
    url: `${url}/approve-bible`,
    headers,
    payload: '{"expected_bible_sha256":',
  });
  assert.equal(malformed.statusCode, 400, malformed.body);
  assert.equal(malformed.json().code, 'FST_ERR_CTP_INVALID_JSON_BODY');

  const retried = await app.inject({
    method: 'POST',
    url: `${url}/shots/environmental_hero/retry`,
    headers,
    payload: '',
  });
  assert.equal(retried.statusCode, 202, retried.body);

  const rootRoute = await app.inject({
    method: 'POST',
    url: '/api/test/root-json',
    headers: { 'content-type': 'application/json' },
    payload: '',
  });
  assert.equal(rootRoute.statusCode, 400, rootRoute.body);
  assert.equal(rootRoute.json().code, 'FST_ERR_CTP_EMPTY_JSON_BODY');

  const approved = await app.inject({
    method: 'POST',
    url: `${url}/approve-bible`,
    headers,
    payload: { expected_bible_sha256: shoot.bindings.shoot_bible.sha256 },
  });
  assert.equal(approved.statusCode, 202, approved.body);
  assert.equal(approved.json().hero_output_sha256, 'c'.repeat(64));
  assert.deepEqual(calls, [
    ['retryShot', 'environmental_hero', { idempotencyKey: 'editorial-contract-key' }],
    ['approveBible', {
      idempotencyKey: 'editorial-contract-key',
      expectedBibleSha256: shoot.bindings.shoot_bible.sha256,
    }],
  ]);
});
