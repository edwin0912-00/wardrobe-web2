import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWebApp } from '../../src/web/app.js';
import { GodViewAuth, OpenTesterGodViewAuth } from '../../src/web/god-view-auth.js';
import { ProfileService } from '../../src/web/profile-service.js';

function cookie(response, name) {
  const values = Array.isArray(response.headers['set-cookie'])
    ? response.headers['set-cookie']
    : [response.headers['set-cookie']];
  const value = values.find((entry) => entry?.startsWith(`${name}=`));
  assert.ok(value, `expected ${name} cookie`);
  return value.split(';')[0];
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-god-view-'));
  const outputs = path.join(root, 'outputs');
  const inputs = path.join(root, 'inputs');
  await mkdir(outputs, { recursive: true });
  await mkdir(inputs, { recursive: true });
  await writeFile(path.join(inputs, 'god-run-a-person.jpg'), 'person:god-run-a');
  const runs = new Map();
  for (const runId of ['god-run-a', 'god-run-b']) {
    const directory = path.join(outputs, runId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'avatar.png'), `avatar:${runId}`);
    await writeFile(path.join(directory, 'avatar_outfit.png'), `look:${runId}`);
    runs.set(runId, {
      run_id: runId,
      status: 'COMPLETED',
      phase: 'COMPLETED',
      message: 'Approved look',
      garments: [{ source_index: 0, category: 'top', confidence: 0.98, observed: { color: 'green' } }],
      qa: { outfit: { decision: 'PASS' } },
      execution_route: { garment_source_image_count: 1 },
    });
  }
  const runService = {
    async getRun(runId) { return runs.get(runId) ?? null; },
    async outputFile(runId, filename) {
      if (!runs.has(runId) || !['avatar.png', 'avatar_outfit.png'].includes(filename)) return null;
      return path.join(outputs, runId, filename);
    },
    async garmentSourceFile() { return null; },
    async personSourceFile(runId) {
      return runId === 'god-run-a' ? path.join(inputs, 'god-run-a-person.jpg') : null;
    },
    async identityDetailSourceFile() { return null; },
    subscribe() { return () => {}; },
  };
  const profiles = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite') });
  const godViewAuth = new GodViewAuth({
    key: 'g'.repeat(32),
    sessionSecret: 's'.repeat(32),
    secure: false,
  });
  const app = await createWebApp({ service: runService, profiles, godViewAuth });
  t.after(async () => {
    await app.close();
    profiles.close();
    await rm(root, { recursive: true, force: true });
  });
  return { app };
}

async function saveRun(app, runId) {
  const profile = await app.inject({ method: 'GET', url: '/api/profile' });
  const profileCookie = cookie(profile, '__Host-zeely_profile');
  const claim = await app.inject({
    method: 'POST',
    url: `/api/profile/runs/${runId}/claim`,
    headers: { cookie: profileCookie, 'content-type': 'application/json' },
    payload: { source_avatar_id: null, source_look_id: null },
  });
  assert.equal(claim.statusCode, 201, claim.body);
  const saved = await app.inject({
    method: 'POST',
    url: `/api/profile/runs/${runId}/save`,
    headers: { cookie: profileCookie },
  });
  assert.equal(saved.statusCode, 201, saved.body);
  return saved.json();
}

test('God View is separately authenticated, read-only, and aggregates active profiles without browser secrets', async (t) => {
  const { app } = await fixture(t);
  const first = await saveRun(app, 'god-run-a');
  await saveRun(app, 'god-run-b');

  const denied = await app.inject({ method: 'GET', url: '/api/god-view/overview' });
  assert.equal(denied.statusCode, 401);

  const failedLogin = await app.inject({
    method: 'POST',
    url: '/api/god-view/session',
    payload: { key: 'not-the-key' },
  });
  assert.equal(failedLogin.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/api/god-view/session',
    payload: { key: 'g'.repeat(32) },
  });
  assert.equal(login.statusCode, 200, login.body);
  const godCookie = cookie(login, 'zeely_god_view_dev');

  const overview = await app.inject({
    method: 'GET',
    url: '/api/god-view/overview',
    headers: { cookie: godCookie },
  });
  assert.equal(overview.statusCode, 200, overview.body);
  assert.equal(overview.headers['cache-control'], 'private, no-store');
  const body = overview.json();
  assert.equal(body.summary.profiles, 2);
  assert.equal(body.summary.avatars, 2);
  assert.equal(body.summary.looks, 2);
  assert.equal(body.summary.runs, 2);
  assert.equal(JSON.stringify(body).includes('verifier_hash'), false);
  assert.equal(JSON.stringify(body).includes('profiles.sqlite'), false);
  assert.match(body.profiles[0].avatars[0].looks[0].image_url, /^\/api\/god-view\/assets\/runs\//);

  const master = await app.inject({
    method: 'GET',
    url: `/api/god-view/assets/runs/god-run-a/look`,
    headers: { cookie: godCookie },
  });
  assert.equal(master.statusCode, 200, master.body);
  assert.equal(master.body, 'look:god-run-a');
  assert.equal(master.headers['cache-control'], 'private, no-store');

  const source = await app.inject({
    method: 'GET',
    url: '/api/god-view/assets/runs/god-run-a/inputs/person',
    headers: { cookie: godCookie },
  });
  assert.equal(source.statusCode, 200, source.body);
  assert.equal(source.body, 'person:god-run-a');

  const unknown = await app.inject({
    method: 'GET',
    url: '/api/god-view/assets/runs/not-claimed/look',
    headers: { cookie: godCookie },
  });
  assert.equal(unknown.statusCode, 404);

  const logout = await app.inject({
    method: 'DELETE',
    url: '/api/god-view/session',
    headers: { cookie: godCookie },
  });
  assert.equal(logout.statusCode, 204);
  assert.ok(first.look.look_id);
});

test('God View is absent when no separately provisioned auth is supplied', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-god-view-disabled-'));
  const profiles = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite') });
  const app = await createWebApp({
    service: { subscribe() { return () => {}; } },
    profiles,
  });
  t.after(async () => {
    await app.close();
    profiles.close();
    await rm(root, { recursive: true, force: true });
  });
  const response = await app.inject({ method: 'GET', url: '/api/god-view/overview' });
  assert.equal(response.statusCode, 404);
});

test('explicit beta tester mode exposes the read-only aggregate without a second password', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-god-view-open-testers-'));
  const profiles = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite') });
  const app = await createWebApp({
    service: { subscribe() { return () => {}; } },
    profiles,
    godViewAuth: new OpenTesterGodViewAuth(),
  });
  t.after(async () => {
    await app.close();
    profiles.close();
    await rm(root, { recursive: true, force: true });
  });
  const overview = await app.inject({ method: 'GET', url: '/api/god-view/overview' });
  assert.equal(overview.statusCode, 200, overview.body);
  const session = await app.inject({ method: 'GET', url: '/api/god-view/session' });
  assert.equal(session.json().authenticated, true);
});
