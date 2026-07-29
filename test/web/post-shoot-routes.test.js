import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerPostShootRoutes } from '../../src/web/post-shoot-routes.js';

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
  await registerPostShootRoutes(app, { lucyTokenIssuer: async () => { calls += 1; return 'test-token-that-is-long-enough'; } });
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

test('token route issues only an allowlisted bounded session token', async (t) => {
  const calls = [];
  const app = Fastify();
  await registerPostShootRoutes(app, {
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
});
