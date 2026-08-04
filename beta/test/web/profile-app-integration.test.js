import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWebApp } from '../../src/web/app.js';
import { DraftService } from '../../src/web/draft-service.js';
import { ProfileService } from '../../src/web/profile-service.js';

function responseCookies(response) {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

function cookiePair(response, name) {
  const cookie = responseCookies(response).find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `response must set ${name}`);
  return cookie.split(';')[0];
}

function fileManifest(manifest) {
  const binding = (item) => item ? {
    id: item.id,
    sha256: item.sha256,
    size: item.size,
    mimetype: item.mimetype,
  } : null;
  return {
    version: 1,
    person: binding(manifest.person),
    identity: binding(manifest.identity),
    garments: manifest.garments.map(binding),
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-profile-app-'));
  const outputRoot = path.join(root, 'outputs');
  await mkdir(outputRoot, { recursive: true });

  const runs = new Map();
  const createInputs = [];
  const approvedReferenceCalls = [];
  const approvedReference = {
    source: 'approved-avatar-fixture',
    image: Buffer.from('approved avatar bytes'),
  };

  async function addCompletedRun(runId) {
    const directory = path.join(outputRoot, runId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'avatar.png'), Buffer.from(`avatar:${runId}`));
    await writeFile(path.join(directory, 'avatar_outfit.png'), Buffer.from(`look:${runId}`));
    const run = { run_id: runId, status: 'COMPLETED', phase: 'COMPLETED' };
    runs.set(runId, run);
    return run;
  }

  const runService = {
    async createRun(input) {
      createInputs.push(input);
      const run = { run_id: input.runId ?? 'generated-run', status: 'QUEUED', phase: 'UPLOADED' };
      runs.set(run.run_id, run);
      return run;
    },
    async getRun(runId) { return runs.get(runId) ?? null; },
    async approvedAvatarReferenceForRun(runId) {
      approvedReferenceCalls.push(runId);
      return approvedReference;
    },
    async outputFile(runId, filename) {
      if (!runs.has(runId) || !['avatar.png', 'avatar_outfit.png'].includes(filename)) return null;
      return path.join(outputRoot, runId, filename);
    },
    async deleteRun(runId) { runs.delete(runId); },
    subscribe() { return () => {}; },
    async retry() { return null; },
    async selectGarments() { return null; },
    async garmentSourceFile() { return null; },
  };

  const profiles = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite') });
  const drafts = new DraftService({ rootDirectory: path.join(root, 'drafts') });
  await drafts.initialize();
  const app = await createWebApp({ service: runService, profiles, drafts });

  t.after(async () => {
    await app.close();
    profiles.close();
    await rm(root, { recursive: true, force: true });
  });

  return {
    app,
    profiles,
    createInputs,
    approvedReference,
    approvedReferenceCalls,
    addCompletedRun,
  };
}

test('createWebApp lets one profile claim a legacy run and hides its status and files from another profile', async (t) => {
  const { app, addCompletedRun } = await fixture(t);
  await addCompletedRun('legacy-shared-run');

  const profileA = await app.inject({ method: 'GET', url: '/api/profile' });
  const profileB = await app.inject({ method: 'GET', url: '/api/profile' });
  const cookieA = cookiePair(profileA, '__Host-zeely_profile');
  const cookieB = cookiePair(profileB, '__Host-zeely_profile');
  assert.notEqual(profileA.json().profile_id, profileB.json().profile_id);

  const beforeClaim = await app.inject({ method: 'GET', url: '/api/runs/legacy-shared-run', headers: { cookie: cookieA } });
  assert.equal(beforeClaim.statusCode, 404, beforeClaim.body);

  const claim = await app.inject({
    method: 'POST',
    url: '/api/profile/runs/legacy-shared-run/claim',
    headers: { cookie: cookieA, 'content-type': 'application/json' },
    payload: { source_avatar_id: null },
  });
  assert.equal(claim.statusCode, 201, claim.body);
  assert.equal(claim.json().run_id, 'legacy-shared-run');

  const ownerStatus = await app.inject({ method: 'GET', url: '/api/runs/legacy-shared-run', headers: { cookie: cookieA } });
  assert.equal(ownerStatus.statusCode, 200, ownerStatus.body);
  assert.equal(ownerStatus.json().status, 'COMPLETED');
  const ownerFile = await app.inject({ method: 'GET', url: '/api/runs/legacy-shared-run/files/avatar.png', headers: { cookie: cookieA } });
  assert.equal(ownerFile.statusCode, 200, ownerFile.body);
  assert.equal(ownerFile.body, 'avatar:legacy-shared-run');

  const foreignStatus = await app.inject({ method: 'GET', url: '/api/runs/legacy-shared-run', headers: { cookie: cookieB } });
  assert.equal(foreignStatus.statusCode, 404, foreignStatus.body);
  assert.deepEqual(foreignStatus.json(), { error: 'Run not found' });
  const foreignFile = await app.inject({ method: 'GET', url: '/api/runs/legacy-shared-run/files/avatar.png', headers: { cookie: cookieB } });
  assert.equal(foreignFile.statusCode, 404, foreignFile.body);
  assert.deepEqual(foreignFile.json(), { error: 'Run not found' });
});

test('draft finalization resolves a saved source avatar, forwards its approved reference, and claims the deterministic run', async (t) => {
  const {
    app,
    profiles,
    createInputs,
    approvedReference,
    approvedReferenceCalls,
    addCompletedRun,
  } = await fixture(t);
  await addCompletedRun('legacy-avatar-source');

  const profile = await app.inject({ method: 'GET', url: '/api/profile' });
  const profileCookie = cookiePair(profile, '__Host-zeely_profile');
  const profileId = profile.json().profile_id;
  const claimedSource = await app.inject({
    method: 'POST',
    url: '/api/profile/runs/legacy-avatar-source/claim',
    headers: { cookie: profileCookie, 'content-type': 'application/json' },
    payload: { source_avatar_id: null },
  });
  assert.equal(claimedSource.statusCode, 201, claimedSource.body);
  const savedSource = await app.inject({
    method: 'POST',
    url: '/api/profile/runs/legacy-avatar-source/save',
    headers: { cookie: profileCookie },
  });
  assert.equal(savedSource.statusCode, 201, savedSource.body);
  const sourceAvatarId = savedSource.json().avatar.avatar_id;
  const sourceLookId = savedSource.json().look.look_id;

  const draft = await app.inject({ method: 'GET', url: '/api/draft', headers: { cookie: profileCookie } });
  const draftCookie = cookiePair(draft, 'zeely_draft_session');
  const browserCookies = `${profileCookie}; ${draftCookie}`;
  assert.equal(draft.json().draft_mode, 'NEW_AVATAR');

  const unboundFinalization = await app.inject({
    method: 'POST',
    url: '/api/draft/run',
    headers: { cookie: browserCookies, 'content-type': 'application/json' },
    payload: {
      consent: true,
      source_avatar_id: sourceAvatarId,
      file_manifest: fileManifest(draft.json()),
    },
  });
  assert.equal(unboundFinalization.statusCode, 409, unboundFinalization.body);
  assert.equal(unboundFinalization.json().code, 'DRAFT_INTENT_NOT_BOUND');
  assert.equal(createInputs.length, 0);

  const metadata = await app.inject({
    method: 'PUT',
    url: '/api/draft/meta',
    headers: { cookie: browserCookies, 'content-type': 'application/json' },
    payload: {
      outfit_text: 'precise saved-avatar look',
      generate_scene: false,
      source_avatar_id: sourceAvatarId,
      source_look_id: sourceLookId,
    },
  });
  assert.equal(metadata.statusCode, 200, metadata.body);
  assert.equal(metadata.json().draft_mode, 'ADD_ITEMS');
  assert.equal(metadata.json().source_avatar_id, sourceAvatarId);
  assert.equal(metadata.json().source_look_id, sourceLookId);
  const refreshedCookies = responseCookies(metadata);
  assert.ok(refreshedCookies.some((value) => value.startsWith('__Host-zeely_profile=')));
  assert.ok(refreshedCookies.some((value) => value.startsWith('zeely_draft_session=')));

  for (const [payload, expectedCode] of [
    [{
      outfit_text: 'lost browser binding',
      source_avatar_id: null,
      source_look_id: null,
    }, 'DRAFT_SOURCE_IMMUTABLE'],
    [{
      outfit_text: 'stale browser state',
      draft_mode: 'NEW_AVATAR',
      source_avatar_id: null,
      source_look_id: null,
    }, 'DRAFT_MODE_IMMUTABLE'],
  ]) {
    const downgrade = await app.inject({
      method: 'PUT',
      url: '/api/draft/meta',
      headers: { cookie: browserCookies, 'content-type': 'application/json' },
      payload,
    });
    assert.equal(downgrade.statusCode, 409, downgrade.body);
    assert.equal(downgrade.json().code, expectedCode);
  }
  const stillBound = await app.inject({ method: 'GET', url: '/api/draft', headers: { cookie: browserCookies } });
  assert.equal(stillBound.json().draft_mode, 'ADD_ITEMS');
  assert.equal(stillBound.json().source_avatar_id, sourceAvatarId);
  assert.equal(stillBound.json().source_look_id, sourceLookId);

  const finalizationKey = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  for (const rejectedLineage of [
    { source_avatar_id: null },
    { source_avatar_id: '41cf6522-43fd-40ad-a8db-615bcdf80e07' },
    { draft_mode: 'NEW_AVATAR' },
  ]) {
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/draft/run',
      headers: { cookie: browserCookies, 'content-type': 'application/json' },
      payload: {
        consent: true,
        finalization_key: finalizationKey,
        file_manifest: fileManifest(stillBound.json()),
        ...rejectedLineage,
      },
    });
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.match(rejected.json().code, /^DRAFT_(SOURCE|MODE)_IMMUTABLE$/);
    assert.equal(createInputs.length, 0);
  }

  const created = await app.inject({
    method: 'POST',
    url: '/api/draft/run',
    headers: { cookie: browserCookies, 'content-type': 'application/json' },
    payload: {
      consent: true,
      finalization_key: finalizationKey,
      file_manifest: fileManifest(metadata.json()),
    },
  });
  assert.equal(created.statusCode, 202, created.body);
  assert.equal(created.json().run_id, finalizationKey);

  assert.deepEqual(approvedReferenceCalls, ['legacy-avatar-source']);
  assert.equal(createInputs.length, 1);
  assert.strictEqual(createInputs[0].approvedAvatarReference, approvedReference);
  assert.equal(createInputs[0].runId, finalizationKey);
  assert.deepEqual(createInputs[0].person.buffer, Buffer.from('avatar:legacy-avatar-source'));
  assert.equal(createInputs[0].person.preparation.method, 'VERIFIED_SERVER_OUTPUT');
  assert.equal(createInputs[0].identityDetail, null);
  assert.equal(createInputs[0].outfitText, 'precise saved-avatar look');

  const claim = profiles.getClaim(profileId, finalizationKey);
  assert.ok(claim, 'the deterministic run must be claimed during finalization');
  assert.equal(claim.source_avatar_id, sourceAvatarId);
  assert.equal(claim.source_look_id, sourceLookId);
  const ownerStatus = await app.inject({ method: 'GET', url: `/api/runs/${finalizationKey}`, headers: { cookie: profileCookie } });
  assert.equal(ownerStatus.statusCode, 200, ownerStatus.body);
  assert.equal(ownerStatus.json().run_id, finalizationKey);

  await addCompletedRun(finalizationKey);
  const savedDerived = await app.inject({
    method: 'POST',
    url: `/api/profile/runs/${finalizationKey}/save`,
    headers: { cookie: profileCookie },
  });
  assert.equal(savedDerived.statusCode, 201, savedDerived.body);
  assert.equal(savedDerived.json().look.avatar_id, sourceAvatarId);
  assert.equal(savedDerived.json().look.parent_look_id, sourceLookId);
});
