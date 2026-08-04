import assert from 'node:assert/strict';
import test from 'node:test';
import { createFalRealtimeTokenIssuer } from '../../src/web/fal-realtime-token.js';

test('fal realtime token issuer is disabled without a server key', () => {
  assert.equal(createFalRealtimeTokenIssuer({ apiKey: '' }), null);
});

test('fal realtime token issuer allowlists one app without exposing the key', async () => {
  const calls = [];
  const issuer = createFalRealtimeTokenIssuer({
    apiKey: 'server-only-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => 'short-lived-token-value' };
    },
  });
  const token = await issuer({
    app: 'decart/lucy-2-5/realtime',
    expiresInSeconds: 10,
  });
  assert.equal(token, 'short-lived-token-value');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    allowed_apps: ['lucy-2-5'],
    token_expiration: 10,
  });
  assert.equal(calls[0].options.headers.Authorization, 'Key server-only-secret');
});

test('fal realtime token issuer accepts the wrapped legacy response', async () => {
  const issuer = createFalRealtimeTokenIssuer({
    apiKey: 'server-only-secret',
    fetchImpl: async () => ({ ok: true, json: async () => ({ token: 'wrapped-short-lived-token' }) }),
  });
  assert.equal(await issuer({ app: 'decart/lucy-2-5/realtime', expiresInSeconds: 10 }), 'wrapped-short-lived-token');
});
