import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import FormData from 'form-data';
import sharp from 'sharp';
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

  const draft = await app.inject({ method: 'GET', url: '/api/draft', headers: { cookie: profileCookie } });
  const draftCookie = cookiePair(draft, 'zeely_draft_session');
  const browserCookies = `${profileCookie}; ${draftCookie}`;
  const personBytes = await sharp({
    create: { width: 320, height: 400, channels: 3, background: '#365773' },
  }).jpeg().toBuffer();
  const person = new FormData();
  person.append('file', personBytes, { filename: 'person.jpg', contentType: 'image/jpeg' });
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/draft/file/person',
    headers: { ...person.getHeaders(), cookie: browserCookies },
    payload: person.getBuffer(),
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const metadata = await app.inject({
    method: 'PUT',
    url: '/api/draft/meta',
    headers: { cookie: browserCookies, 'content-type': 'application/json' },
    payload: { outfit_text: 'precise saved-avatar look', generate_scene: false },
  });
  assert.equal(metadata.statusCode, 200, metadata.body);

  const finalizationKey = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  const created = await app.inject({
    method: 'POST',
    url: '/api/draft/run',
    headers: { cookie: browserCookies, 'content-type': 'application/json' },
    payload: { consent: true, finalization_key: finalizationKey, source_avatar_id: sourceAvatarId },
  });
  assert.equal(created.statusCode, 202, created.body);
  assert.equal(created.json().run_id, finalizationKey);

  assert.deepEqual(approvedReferenceCalls, ['legacy-avatar-source']);
  assert.equal(createInputs.length, 1);
  assert.strictEqual(createInputs[0].approvedAvatarReference, approvedReference);
  assert.equal(createInputs[0].runId, finalizationKey);
  assert.deepEqual(createInputs[0].person.buffer, personBytes);
  assert.equal(createInputs[0].outfitText, 'precise saved-avatar look');

  const claim = profiles.getClaim(profileId, finalizationKey);
  assert.ok(claim, 'the deterministic run must be claimed during finalization');
  assert.equal(claim.source_avatar_id, sourceAvatarId);
  const ownerStatus = await app.inject({ method: 'GET', url: `/api/runs/${finalizationKey}`, headers: { cookie: profileCookie } });
  assert.equal(ownerStatus.statusCode, 200, ownerStatus.body);
  assert.equal(ownerStatus.json().run_id, finalizationKey);
});
