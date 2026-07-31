import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerPostShootRoutes } from '../../src/web/post-shoot-routes.js';

function ownershipFixture({ ownedLookId = 'look-123' } = {}) {
  const sessions = [];
  const profiles = {
    ownsLook(profileId, lookId) {
      return profileId === 'profile-1' && lookId === ownedLookId;
    },
  };
  const profileApi = {
    async resolveRequestProfile(request, reply) {
      sessions.push({ request, reply });
      return { profileId: 'profile-1' };
    },
  };
  return { profileApi, profiles, sessions };
}

test('public pipeline exposes Lucy contract without secrets', async (t) => {
  const app = Fastify();
  await registerPostShootRoutes(app);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/api/post-shoot/pipeline' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().provider_ready, false);
  assert.equal(response.body.includes('decart/lucy-2-5/realtime'), true);
  assert.equal(response.body.toLowerCase().includes('fal_key'), false);
});

test('saved-look action hub receives a full-viewport truthful Real-time Look launch contract', async (t) => {
  const app = Fastify();
  const owner = ownershipFixture();
  await registerPostShootRoutes(app, {
    lucyTokenIssuer: async () => 'test-token-that-is-long-enough',
    ...owner,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/post-shoot/realtime-look-capability?look_id=look-123',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    capability: 'REALTIME_LOOK',
    camera_preview_ready: true,
    paid_live_ready: true,
    launch: {
      href: '/post-shoot-mvp.html?look=look-123&surface=full',
      presentation: 'FULL_VIEWPORT',
      target: '_self',
      nested: false,
      internal_scroll: false,
    },
    consent: {
      privacy_required: true,
      cost_required: true,
      maximum_cost_usd: 0.6,
      maximum_session_seconds: 15,
    },
    camera: {
      permission_required: true,
      video: true,
      audio: false,
    },
    capture: {
      automatic_recording: false,
      automatic_upload: false,
    },
  });
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(owner.sessions.length, 1);
});

test('Real-time Look launch contract rejects an unsafe or missing saved-look id', async (t) => {
  const app = Fastify();
  await registerPostShootRoutes(app);
  t.after(() => app.close());

  for (const url of [
    '/api/post-shoot/realtime-look-capability',
    '/api/post-shoot/realtime-look-capability?look_id=../private',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'INVALID_LOOK_ID');
  }
});

test('Real-time Look capability hides nonexistent and foreign saved looks', async (t) => {
  const app = Fastify();
  const owner = ownershipFixture();
  await registerPostShootRoutes(app, owner);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/post-shoot/realtime-look-capability?look_id=look-foreign',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, 'LOOK_NOT_FOUND');
  assert.equal(owner.sessions.length, 1);
});

test('live entrypoint opens a cache-busted test with the outfit-only reference preloaded', async (t) => {
  const app = Fastify();
  await registerPostShootRoutes(app);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/live' });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers.location, '/post-shoot-mvp.html?demo=outfit&release=20260729-2');
});

test('token route rejects missing cost approval before provider access', async (t) => {
  let calls = 0;
  const app = Fastify();
  await registerPostShootRoutes(app, {
    ...ownershipFixture(),
    lucyTokenIssuer: async () => { calls += 1; return 'test-token-that-is-long-enough'; },
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/fal/realtime-token',
    payload: { app: 'decart/lucy-2-5/realtime', max_session_seconds: 15 },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().maximum_cost_usd, 0.6);
  assert.equal(calls, 0);
});

test('token route rejects missing privacy approval before provider access', async (t) => {
  let calls = 0;
  const app = Fastify();
  await registerPostShootRoutes(app, {
    ...ownershipFixture(),
    lucyTokenIssuer: async () => {
      calls += 1;
      return 'test-token-that-is-long-enough';
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/fal/realtime-token',
    payload: {
      app: 'decart/lucy-2-5/realtime',
      look_id: 'look-123',
      cost_acknowledged: true,
      max_session_seconds: 15,
    },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'PRIVACY_CONSENT_REQUIRED');
  assert.equal(calls, 0);
});

test('token route rejects cross-site, missing-look and foreign-look requests before provider access', async (t) => {
  let calls = 0;
  const app = Fastify();
  const owner = ownershipFixture();
  await registerPostShootRoutes(app, {
    ...owner,
    lucyTokenIssuer: async () => {
      calls += 1;
      return 'test-token-that-is-long-enough';
    },
  });
  t.after(() => app.close());

  const base = {
    app: 'decart/lucy-2-5/realtime',
    privacy_consent: true,
    cost_acknowledged: true,
    max_session_seconds: 15,
  };
  const crossSite = await app.inject({
    method: 'POST',
    url: '/api/fal/realtime-token',
    headers: {
      origin: 'https://evil.example',
      host: 'beta.example',
      'sec-fetch-site': 'cross-site',
    },
    payload: { ...base, look_id: 'look-123' },
  });
  assert.equal(crossSite.statusCode, 403);
  assert.equal(crossSite.json().code, 'CROSS_SITE_REQUEST');

  const missing = await app.inject({
    method: 'POST',
    url: '/api/fal/realtime-token',
    payload: base,
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, 'INVALID_LOOK_ID');

  const foreign = await app.inject({
    method: 'POST',
    url: '/api/fal/realtime-token',
    payload: { ...base, look_id: 'look-foreign' },
  });
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.json().code, 'LOOK_NOT_FOUND');
  assert.equal(calls, 0);
});

test('token route issues only an allowlisted bounded session token', async (t) => {
  const calls = [];
  const app = Fastify();
  const owner = ownershipFixture();
  await registerPostShootRoutes(app, {
    ...owner,
    lucyTokenIssuer: async (request) => {
      calls.push(request);
      return 'short-lived-test-token';
    },
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/fal/realtime-token',
    payload: {
      app: 'decart/lucy-2-5/realtime',
      look_id: 'look-123',
      privacy_consent: true,
      cost_acknowledged: true,
      max_session_seconds: 15,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'short-lived-test-token');
  assert.deepEqual(calls, [{
    app: 'decart/lucy-2-5/realtime',
    expiresInSeconds: 10,
    maxSessionSeconds: 15,
  }]);
  assert.equal(owner.sessions.length, 1);
});
