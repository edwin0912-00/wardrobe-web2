import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { PROFILE_TTL_MS, ProfileService, registerProfileRoutes } from '../../src/web/profile-service.js';

function responseCookies(response) {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

function profileCookie(response) {
  const value = responseCookies(response).find((item) => item.startsWith('zeely_profile_dev='));
  assert.ok(value, 'profile response must set the anonymous browser cookie');
  return value.split(';')[0];
}

async function fixture(t, { clock = () => new Date() } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-profile-'));
  const outputRoot = path.join(root, 'outputs');
  await mkdir(outputRoot, { recursive: true });
  const runs = new Map();
  const deletedRuns = [];

  async function addRun(runId, { status = 'COMPLETED' } = {}) {
    const directory = path.join(outputRoot, runId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'avatar.png'), Buffer.from(`avatar:${runId}`));
    await writeFile(path.join(directory, 'avatar_outfit.png'), Buffer.from(`look:${runId}`));
    runs.set(runId, { run_id: runId, status, outputs: { avatar: true, avatar_outfit: true } });
  }

  const runService = {
    async getRun(runId) { return runs.get(runId) ?? null; },
    async outputFile(runId, filename) {
      if (!runs.has(runId) || !['avatar.png', 'avatar_outfit.png'].includes(filename)) return null;
      return path.join(outputRoot, runId, filename);
    },
    async deleteRun(runId) {
      const run = runs.get(runId);
      if (run && ['QUEUED', 'RUNNING'].includes(run.status)) throw new Error('Cannot delete a running job');
      runs.delete(runId);
      deletedRuns.push(runId);
    },
  };

  const service = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite'), clock });
  const app = Fastify();
  const profileApi = await registerProfileRoutes(app, { service, runService, secureCookie: false });
  t.after(async () => {
    await app.close();
    service.close();
    await rm(root, { recursive: true, force: true });
  });
  return { app, service, profileApi, runService, deletedRuns, addRun };
}

test('existing profile databases gain source_look_id through an idempotent additive migration', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-profile-migration-'));
  const databasePath = path.join(root, 'profiles.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE run_claims (
      run_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      source_avatar_id TEXT,
      saved_avatar_id TEXT,
      saved_look_id TEXT,
      claimed_at INTEGER NOT NULL
    ) STRICT
  `);
  legacy.close();

  const service = new ProfileService({ databasePath });
  await service.initialize();
  service.close();
  const inspected = new DatabaseSync(databasePath);
  const columns = inspected.prepare('PRAGMA table_info(run_claims)').all().map((column) => column.name);
  inspected.close();
  assert.equal(columns.filter((name) => name === 'source_look_id').length, 1);

  const reopened = new ProfileService({ databasePath });
  await reopened.initialize();
  reopened.close();
  t.after(() => rm(root, { recursive: true, force: true }));
});

test('same anonymous browser cookie restores one fixed-expiry profile', async (t) => {
  let now = Date.now();
  const { app } = await fixture(t, { clock: () => new Date(now) });

  const first = await app.inject({ method: 'GET', url: '/api/profile' });
  assert.equal(first.statusCode, 200, first.body);
  const cookie = profileCookie(first);
  assert.match(cookie, /^zeely_profile_dev=[A-Za-z0-9_-]{43}$/);
  assert.match(responseCookies(first)[0], /HttpOnly/);
  assert.match(responseCookies(first)[0], /SameSite=Strict/);
  assert.match(responseCookies(first)[0], /Max-Age=2592000/);

  const original = first.json();
  now += 7 * 24 * 60 * 60 * 1000;
  const reload = await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } });
  assert.equal(reload.statusCode, 200, reload.body);
  assert.equal(reload.json().profile_id, original.profile_id);
  assert.equal(reload.json().created_at, original.created_at);
  assert.equal(reload.json().expires_at, original.expires_at, 'reload must not slide the 30-day retention window');
  assert.match(responseCookies(reload)[0], /Max-Age=1987200/, 'cookie lifetime must shrink with the fixed server expiry');
});

test('claim is required, ownership is isolated, and claim/save replay is idempotent', async (t) => {
  const { app, addRun } = await fixture(t);
  await addRun('completed-profile-run');

  const browserA = await app.inject({ method: 'GET', url: '/api/profile' });
  const cookieA = profileCookie(browserA);
  const browserB = await app.inject({ method: 'GET', url: '/api/profile' });
  const cookieB = profileCookie(browserB);
  assert.notEqual(browserA.json().profile_id, browserB.json().profile_id);

  const unclaimedSave = await app.inject({ method: 'POST', url: '/api/profile/runs/completed-profile-run/save', headers: { cookie: cookieA } });
  assert.equal(unclaimedSave.statusCode, 404);

  const claim = await app.inject({
    method: 'POST', url: '/api/profile/runs/completed-profile-run/claim',
    headers: { cookie: cookieA, 'content-type': 'application/json' }, payload: { source_avatar_id: null },
  });
  assert.equal(claim.statusCode, 201, claim.body);
  const replayedClaim = await app.inject({
    method: 'POST', url: '/api/profile/runs/completed-profile-run/claim',
    headers: { cookie: cookieA, 'content-type': 'application/json' }, payload: { source_avatar_id: null },
  });
  assert.equal(replayedClaim.statusCode, 200, replayedClaim.body);
  assert.equal(replayedClaim.json().replayed, true);

  const stolenClaim = await app.inject({
    method: 'POST', url: '/api/profile/runs/completed-profile-run/claim',
    headers: { cookie: cookieB, 'content-type': 'application/json' }, payload: { source_avatar_id: null },
  });
  assert.equal(stolenClaim.statusCode, 409);
  const stolenSave = await app.inject({ method: 'POST', url: '/api/profile/runs/completed-profile-run/save', headers: { cookie: cookieB } });
  assert.equal(stolenSave.statusCode, 404);

  const saved = await app.inject({ method: 'POST', url: '/api/profile/runs/completed-profile-run/save', headers: { cookie: cookieA } });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.ok(saved.json().avatar.avatar_id);
  assert.ok(saved.json().look.look_id);
  assert.equal(saved.json().avatar.expires_at, browserA.json().expires_at);
  assert.equal(saved.json().look.expires_at, browserA.json().expires_at);

  const replayedSave = await app.inject({ method: 'POST', url: '/api/profile/runs/completed-profile-run/save', headers: { cookie: cookieA } });
  assert.equal(replayedSave.statusCode, 200, replayedSave.body);
  assert.equal(replayedSave.json().replayed, true);
  assert.equal(replayedSave.json().avatar.avatar_id, saved.json().avatar.avatar_id);
  assert.equal(replayedSave.json().look.look_id, saved.json().look.look_id);
  assert.equal(replayedSave.json().profile.avatars.length, 1);
  assert.equal(replayedSave.json().profile.looks.length, 1);

  const avatarImage = await app.inject({ method: 'GET', url: saved.json().avatar.image_url, headers: { cookie: cookieA } });
  assert.equal(avatarImage.statusCode, 200);
  assert.equal(avatarImage.body, 'avatar:completed-profile-run');
  assert.equal(avatarImage.headers['cache-control'], 'private, no-store');
  const isolatedImage = await app.inject({ method: 'GET', url: saved.json().avatar.image_url, headers: { cookie: cookieB } });
  assert.equal(isolatedImage.statusCode, 404);
});

test('derived looks belong to an existing avatar and deletion preserves shared source data', async (t) => {
  const { app, addRun, deletedRuns } = await fixture(t);
  await addRun('base-avatar-run');
  await addRun('derived-look-run');
  const profile = await app.inject({ method: 'GET', url: '/api/profile' });
  const cookie = profileCookie(profile);

  await app.inject({
    method: 'POST', url: '/api/profile/runs/base-avatar-run/claim',
    headers: { cookie, 'content-type': 'application/json' }, payload: { source_avatar_id: null },
  });
  const base = await app.inject({ method: 'POST', url: '/api/profile/runs/base-avatar-run/save', headers: { cookie } });
  assert.equal(base.statusCode, 201, base.body);
  const avatarId = base.json().avatar.avatar_id;
  const initialLookId = base.json().look.look_id;

  const derivedClaim = await app.inject({
    method: 'POST', url: '/api/profile/runs/derived-look-run/claim',
    headers: { cookie, 'content-type': 'application/json' },
    payload: { source_avatar_id: avatarId, source_look_id: initialLookId },
  });
  assert.equal(derivedClaim.statusCode, 201, derivedClaim.body);
  assert.equal(derivedClaim.json().source_look_id, initialLookId);
  const derived = await app.inject({ method: 'POST', url: '/api/profile/runs/derived-look-run/save', headers: { cookie } });
  assert.equal(derived.statusCode, 201, derived.body);
  assert.equal(derived.json().avatar.avatar_id, avatarId);
  assert.notEqual(derived.json().look.look_id, initialLookId);
  assert.equal(derived.json().look.parent_look_id, initialLookId);

  const deleteDerived = await app.inject({ method: 'DELETE', url: `/api/profile/looks/${derived.json().look.look_id}`, headers: { cookie } });
  assert.equal(deleteDerived.statusCode, 204, deleteDerived.body);
  assert.deepEqual(deletedRuns, ['derived-look-run']);

  const deleteInitial = await app.inject({ method: 'DELETE', url: `/api/profile/looks/${initialLookId}`, headers: { cookie } });
  assert.equal(deleteInitial.statusCode, 204, deleteInitial.body);
  assert.deepEqual(deletedRuns, ['derived-look-run'], 'base run must remain while its avatar is retained');

  const avatarStillAvailable = await app.inject({ method: 'GET', url: base.json().avatar.image_url, headers: { cookie } });
  assert.equal(avatarStillAvailable.statusCode, 200);
  const deleteAvatar = await app.inject({ method: 'DELETE', url: `/api/profile/avatars/${avatarId}`, headers: { cookie } });
  assert.equal(deleteAvatar.statusCode, 204, deleteAvatar.body);
  assert.deepEqual(deletedRuns, ['derived-look-run', 'base-avatar-run']);
  const avatarGone = await app.inject({ method: 'GET', url: base.json().avatar.image_url, headers: { cookie } });
  assert.equal(avatarGone.statusCode, 404);
});

test('add-items lineage rejects a saved look from a different avatar', async (t) => {
  const { app, addRun } = await fixture(t);
  await addRun('avatar-a-run');
  await addRun('avatar-b-run');
  await addRun('mismatched-derived-run');
  const profile = await app.inject({ method: 'GET', url: '/api/profile' });
  const cookie = profileCookie(profile);

  const saveBase = async (runId) => {
    await app.inject({
      method: 'POST',
      url: `/api/profile/runs/${runId}/claim`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { source_avatar_id: null, source_look_id: null },
    });
    return app.inject({
      method: 'POST',
      url: `/api/profile/runs/${runId}/save`,
      headers: { cookie },
    });
  };
  const baseA = await saveBase('avatar-a-run');
  const baseB = await saveBase('avatar-b-run');

  const rejected = await app.inject({
    method: 'POST',
    url: '/api/profile/runs/mismatched-derived-run/claim',
    headers: { cookie, 'content-type': 'application/json' },
    payload: {
      source_avatar_id: baseA.json().avatar.avatar_id,
      source_look_id: baseB.json().look.look_id,
    },
  });
  assert.equal(rejected.statusCode, 409, rejected.body);
  assert.equal(rejected.json().code, 'LOOK_AVATAR_MISMATCH');
});

test('fixed expiry cleanup revokes the cookie and physically queues owned runs', async (t) => {
  let now = Date.now();
  const { app, profileApi, addRun, deletedRuns } = await fixture(t, { clock: () => new Date(now) });
  await addRun('expiring-profile-run');
  const first = await app.inject({ method: 'GET', url: '/api/profile' });
  const cookie = profileCookie(first);
  await app.inject({
    method: 'POST', url: '/api/profile/runs/expiring-profile-run/claim',
    headers: { cookie, 'content-type': 'application/json' }, payload: { source_avatar_id: null },
  });
  await app.inject({ method: 'POST', url: '/api/profile/runs/expiring-profile-run/save', headers: { cookie } });

  now += PROFILE_TTL_MS + 1;
  const cleanup = await profileApi.cleanup();
  assert.equal(cleanup.removedProfiles, 1);
  assert.deepEqual(cleanup.deleted, ['expiring-profile-run']);
  assert.deepEqual(deletedRuns, ['expiring-profile-run']);

  const afterExpiry = await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } });
  assert.equal(afterExpiry.statusCode, 200, afterExpiry.body);
  assert.notEqual(afterExpiry.json().profile_id, first.json().profile_id);
  assert.equal(afterExpiry.json().avatars.length, 0);
});

test('deleting the whole profile revokes browser access and clears its cookie', async (t) => {
  const { app, addRun, deletedRuns } = await fixture(t);
  await addRun('delete-profile-run');
  const first = await app.inject({ method: 'GET', url: '/api/profile' });
  const cookie = profileCookie(first);
  await app.inject({
    method: 'POST', url: '/api/profile/runs/delete-profile-run/claim',
    headers: { cookie, 'content-type': 'application/json' }, payload: { source_avatar_id: null },
  });
  const saved = await app.inject({ method: 'POST', url: '/api/profile/runs/delete-profile-run/save', headers: { cookie } });
  assert.equal(saved.statusCode, 201, saved.body);

  const deleted = await app.inject({ method: 'DELETE', url: '/api/profile', headers: { cookie } });
  assert.equal(deleted.statusCode, 204, deleted.body);
  assert.ok(responseCookies(deleted).some((value) => /zeely_profile_dev=;/.test(value) && /Max-Age=0/.test(value)));
  assert.deepEqual(deletedRuns, ['delete-profile-run']);

  const oldCookie = await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } });
  assert.notEqual(oldCookie.json().profile_id, first.json().profile_id);
  const oldImage = await app.inject({ method: 'GET', url: saved.json().avatar.image_url, headers: { cookie } });
  assert.equal(oldImage.statusCode, 404);
});
