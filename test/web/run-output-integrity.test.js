import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { createWebApp } from '../../src/web/app.js';
import { ProfileService } from '../../src/web/profile-service.js';
import { RunService } from '../../src/web/run-service.js';

async function upload() {
  return {
    filename: 'person.png',
    mimetype: 'image/png',
    buffer: await sharp({
      create: {
        width: 360,
        height: 480,
        channels: 3,
        background: '#8a6554',
      },
    }).png().toBuffer(),
  };
}

function dependencies() {
  return {
    provider: new MockProvider(),
    vlm: {},
    assetGenerator: {},
  };
}

async function completedRun(t, runId) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-output-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new RunService({ rootDirectory: root, ...dependencies() });
  await service.initialize();
  await service.createRun({
    runId,
    person: await upload(),
    outfitText: 'black tailored jacket',
    generateScene: false,
  });
  await service.running.get(runId);
  assert.equal((await service.getRun(runId)).status, 'COMPLETED');
  return { root, service };
}

test('strict completed outputs fail closed after a materialized image is changed', async (t) => {
  const runId = 'strict-image-tamper';
  const { root, service } = await completedRun(t, runId);
  assert.ok(await service.outputFile(runId, 'avatar.png'));

  await writeFile(path.join(root, runId, 'outputs', 'avatar.png'), Buffer.from('changed'));

  assert.equal(await service.outputFile(runId, 'avatar.png'), null);
  assert.equal(await service.outputFile(runId, 'avatar_outfit.png'), null);
  assert.equal(await service.outputFile(runId, 'run-manifest.json'), null);
  await assert.rejects(
    () => service.approvedAvatarReferenceForRun(runId),
    /integrity verification/,
  );
});

test('strict completed outputs fail closed after a QA receipt or public manifest is changed', async (t) => {
  const receiptRunId = 'strict-receipt-tamper';
  const receiptFixture = await completedRun(t, receiptRunId);
  const receiptCheckpoint = JSON.parse(await readFile(path.join(
    receiptFixture.root,
    receiptRunId,
    'outputs',
    '.zeely-run',
    'checkpoint.json',
  ), 'utf8'));
  await writeFile(receiptCheckpoint.qa.avatar.artifact.path, Buffer.from('{}\n'));
  assert.equal(await receiptFixture.service.outputFile(receiptRunId, 'avatar.png'), null);

  const manifestRunId = 'strict-manifest-tamper';
  const manifestFixture = await completedRun(t, manifestRunId);
  await writeFile(
    path.join(manifestFixture.root, manifestRunId, 'outputs', 'run-manifest.json'),
    Buffer.from('{}\n'),
  );
  assert.equal(await manifestFixture.service.outputFile(manifestRunId, 'avatar.png'), null);
  assert.equal(await manifestFixture.service.outputFile(manifestRunId, 'run-manifest.json'), null);
});

test('legacy PASS manifests remain readable when their exact output hashes still match', async (t) => {
  const runId = 'legacy-output-compatible';
  const { root, service } = await completedRun(t, runId);
  const runDirectory = path.join(root, runId);
  const manifestPath = path.join(runDirectory, 'outputs', 'run-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const phase of ['conditioning', 'avatar', 'outfit']) {
    manifest.qa[phase] = {
      decision: manifest.qa[phase].decision,
      reason: manifest.qa[phase].reason,
      checks: manifest.qa[phase].checks,
      defects: manifest.qa[phase].defects,
    };
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const statePath = path.join(runDirectory, 'run.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.qa = manifest.qa;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await rm(path.join(runDirectory, 'outputs', '.zeely-run'), { recursive: true, force: true });

  assert.ok(await service.outputFile(runId, 'avatar.png'));
  assert.ok(await service.outputFile(runId, 'avatar_outfit.png'));
  assert.ok(await service.outputFile(runId, 'run-manifest.json'));
});

test('tampered completed outputs cannot be downloaded or saved into a browser profile', async (t) => {
  const runId = 'profile-save-tamper';
  const { root, service } = await completedRun(t, runId);
  const profiles = new ProfileService({
    databasePath: path.join(root, 'profiles.sqlite'),
  });
  const app = await createWebApp({ service, profiles });
  t.after(async () => {
    await app.close();
    profiles.close();
  });

  const profileResponse = await app.inject({ method: 'GET', url: '/api/profile' });
  const setCookie = profileResponse.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  const mutationHeaders = {
    cookie,
    host: 'example.test',
    origin: 'https://example.test',
  };
  const claim = await app.inject({
    method: 'POST',
    url: `/api/profile/runs/${runId}/claim`,
    headers: mutationHeaders,
    payload: {},
  });
  assert.equal(claim.statusCode, 201);

  await writeFile(path.join(root, runId, 'outputs', 'avatar_outfit.png'), Buffer.from('changed'));

  const download = await app.inject({
    method: 'GET',
    url: `/api/runs/${runId}/files/avatar_outfit.png`,
    headers: { cookie },
  });
  assert.equal(download.statusCode, 404);
  const save = await app.inject({
    method: 'POST',
    url: `/api/profile/runs/${runId}/save`,
    headers: mutationHeaders,
  });
  assert.equal(save.statusCode, 409);
  assert.match(save.body, /avatar/i);
  assert.equal(profiles.getProfile(profileResponse.json().profile_id).avatars.length, 0);
});
