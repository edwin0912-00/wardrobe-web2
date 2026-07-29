import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { EDITORIAL_SHOT_SLOTS } from '../../src/web/editorial-shoot-contract.js';
import {
  CONTACT_SHEET_NOT_READY,
  createEditorialContactSheetManifest,
} from '../../src/web/editorial-contact-sheet.js';
import { registerEditorialShootRoutes } from '../../src/web/editorial-shoot-routes.js';
import { ProfileService } from '../../src/web/profile-service.js';

const LOOK_ID = '11111111-1111-4111-8111-111111111111';

function completedShoot({
  shootId = 'shoot_contact_sheet_fixture',
  lookId = LOOK_ID,
} = {}) {
  const shots = EDITORIAL_SHOT_SLOTS.map((slot, index) => ({
    slot,
    status: 'APPROVED',
    retry_count: index,
    attempts: [],
    output: {
      resource_id: `private-resource-${index}`,
      sha256: String(index + 1).repeat(64),
      receipt_sha256: String(index + 2).repeat(64),
      width: 1024,
      height: 1280,
      media_type: 'image/png',
    },
    error: null,
  }));
  return {
    shoot_id: shootId,
    status: 'COMPLETED',
    phase: 'COMPLETED',
    message: 'All six exact-hash editorial shots passed',
    created_at: '2026-07-26T12:00:00.000Z',
    updated_at: '2026-07-26T12:30:00.000Z',
    bindings: {
      approved_look: {
        look_id: lookId,
        image_sha256: 'a'.repeat(64),
        receipt_sha256: 'b'.repeat(64),
      },
      shoot_bible: {
        bible_id: 'bible_contact_sheet_fixture',
        mode_id: 'editorial.edwin_novak.organic_contrast',
        mode_version: '1.0.0',
        sha256: 'c'.repeat(64),
      },
    },
    bible_approval: { authority: 'EXPLICIT_API_APPROVAL' },
    hero_approval: { authority: 'EXPLICIT_API_APPROVAL' },
    shots,
    cancellation: null,
    request_fingerprint: 'private-fingerprint-must-not-leak',
    idempotency_hash: 'private-idempotency-must-not-leak',
    state_integrity_sha256: 'private-state-hash-must-not-leak',
  };
}

async function contactSheetRoutes(t, shoot) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'editorial-contact-sheet-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profiles = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite') });
  await profiles.initialize();
  t.after(() => profiles.close());
  const owner = profiles.createSession();
  const foreign = profiles.createSession();
  profiles.claimRun(owner.profileId, 'owner-run');
  const saved = profiles.saveClaimedRun(owner.profileId, 'owner-run');
  shoot.bindings.approved_look.look_id = saved.look.look_id;
  profiles.projectEditorialShoot(owner.profileId, saved.look.look_id, shoot);
  let currentShoot = shoot;
  let serviceReads = 0;
  const editorialShootService = {
    async getShoot(shootId) {
      serviceReads += 1;
      return shootId === currentShoot.shoot_id ? currentShoot : null;
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
  await app.ready();
  t.after(() => app.close());
  return {
    app,
    owner,
    foreign,
    serviceReads: () => serviceReads,
    setShoot(next) {
      currentShoot = next;
    },
  };
}

test('private contact-sheet exposes five delivered frames and keeps the identity check internal', async (t) => {
  const shoot = completedShoot();
  // The persisted service validates its own order, but this projection must not trust a
  // caller to retain it: the contact sheet has one permanent slot order.
  shoot.shots.reverse();
  const expected = createEditorialContactSheetManifest(shoot);
  const routes = await contactSheetRoutes(t, shoot);
  const url = `/api/profile/editorial-shoots/${shoot.shoot_id}/contact-sheet`;

  const ownerResponse = await routes.app.inject({
    method: 'GET',
    url,
    headers: { 'x-profile-id': routes.owner.profileId },
  });
  assert.equal(ownerResponse.statusCode, 200, ownerResponse.body);
  assert.equal(ownerResponse.headers['cache-control'], 'private, no-store');
  assert.equal(ownerResponse.headers.vary, 'Cookie');
  assert.deepEqual(ownerResponse.json(), expected);
  assert.deepEqual(
    ownerResponse.json().frames.map((frame) => frame.slot),
    EDITORIAL_SHOT_SLOTS.slice(1),
  );
  assert.equal(ownerResponse.json().frames.length, 5);
  assert.doesNotMatch(ownerResponse.body, /clean_identity_hero/);
  const serialized = ownerResponse.body;
  assert.doesNotMatch(
    serialized,
    /resource_id|private-resource|request_fingerprint|idempotency_hash|state_integrity_sha256|runtime\//,
  );

  const completedButUnapproved = structuredClone(shoot);
  completedButUnapproved.shots[0].status = 'QA_PASSED';
  assert.throws(
    () => createEditorialContactSheetManifest(completedButUnapproved),
    (error) => error?.code === CONTACT_SHEET_NOT_READY,
    'COMPLETED is insufficient when any fixed slot lacks explicit approval',
  );
  const duplicateSlot = structuredClone(shoot);
  duplicateSlot.shots[1].slot = duplicateSlot.shots[0].slot;
  assert.throws(
    () => createEditorialContactSheetManifest(duplicateSlot),
    (error) => error?.code === CONTACT_SHEET_NOT_READY,
    'the manifest must refuse a malformed six-item list rather than silently choose a frame',
  );

  const readsBeforeForeign = routes.serviceReads();
  const foreignResponse = await routes.app.inject({
    method: 'GET',
    url,
    headers: { 'x-profile-id': routes.foreign.profileId },
  });
  assert.equal(foreignResponse.statusCode, 404, foreignResponse.body);
  assert.equal(
    routes.serviceReads(),
    readsBeforeForeign,
    'a foreign browser profile must not cause a shoot lookup',
  );

  const incomplete = structuredClone(shoot);
  incomplete.status = 'SERIES_RUNNING';
  incomplete.shots.find((frame) => frame.slot === 'wide_campaign_coda').status = 'QA_PASSED';
  routes.setShoot(incomplete);
  const incompleteResponse = await routes.app.inject({
    method: 'GET',
    url,
    headers: { 'x-profile-id': routes.owner.profileId },
  });
  assert.equal(incompleteResponse.statusCode, 409, incompleteResponse.body);
  assert.equal(incompleteResponse.json().code, CONTACT_SHEET_NOT_READY);
  assert.doesNotMatch(incompleteResponse.body, /private-resource|resource_id|runtime\//);
});
