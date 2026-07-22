import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebApp } from '../../src/web/app.js';

const service = { createRun: async () => null, getRun: async () => null, subscribe: () => () => {}, outputFile: async () => null, retry: async () => null, deleteRun: async () => {} };
const auth = { pin: '2719', secret: 'test-secret-that-is-at-least-thirty-two-characters', secure: false };

test('PIN gate protects both the page and generation API', async () => {
  const app = await createWebApp({ service, auth });
  const page = await app.inject({ method: 'GET', url: '/?run=sample' });
  assert.equal(page.statusCode, 302);
  assert.equal(page.headers.location, '/login.html?next=%2F%3Frun%3Dsample');
  const api = await app.inject({ method: 'GET', url: '/api/runs/sample' });
  assert.equal(api.statusCode, 401);
  const wrong = await app.inject({ method: 'POST', url: '/api/auth/pin', payload: { pin: '0000' } });
  assert.equal(wrong.statusCode, 401);
  const login = await app.inject({ method: 'POST', url: '/api/auth/pin', payload: { pin: '2719' } });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];
  const authenticated = await app.inject({ method: 'GET', url: '/', headers: { cookie } });
  assert.equal(authenticated.statusCode, 200);
  await app.close();
});

test('PIN gate rejects unsafe configuration', async () => {
  await assert.rejects(() => createWebApp({ service, auth: { pin: '12', secret: 'short' } }), /4 to 12 digits/);
});
