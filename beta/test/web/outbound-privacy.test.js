import assert from 'node:assert/strict';
import test from 'node:test';
import FormData from 'form-data';
import { createWebApp } from '../../src/web/app.js';

function serviceThatLeaksInternally() {
  return {
    createRun: async () => null,
    getRun: async () => { throw new Error('Zeely failed at /Users/jarvis1/private/run.json'); },
    subscribe: () => () => {},
    outputFile: async () => null,
    retry: async () => null,
    deleteRun: async () => {},
  };
}

test('HTTP error responses redact local infrastructure metadata', async () => {
  const app = await createWebApp({ service: serviceThatLeaksInternally() });
  const response = await app.inject({ method: 'GET', url: '/api/runs/run-1' });
  assert.equal(response.statusCode, 400);
  assert.doesNotMatch(response.body, /zeely|jarvis|\/Users\//i);
  assert.equal(response.json().error, 'Дію зупинено. Перевірте код і наступну дію.');
  await app.close();
});

test('health response exposes capability status without provider or project fingerprints', async () => {
  const app = await createWebApp({ service: serviceThatLeaksInternally(), health: {
    status: 'ok',
    generation: 'Higgsfield CLI',
    semantic_qa: 'Codex CLI',
    fashion_shoot_qa_mode: 'off',
    internal_path: '/Users/jarvis1/app',
  } });
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'web',
    generation: 'available',
    image_generation_modes: { slow: { available: true }, fast: { available: false } },
    semantic_qa: 'available',
    fashion_shoot_qa_mode: 'off',
    editorial_generation: 'disabled',
  });
  await app.close();
});

test('degraded Slow capability refuses generation after multipart mode parsing', async () => {
  let createCalls = 0;
  const app = await createWebApp({
    service: {
      ...serviceThatLeaksInternally(),
      createRun: async () => { createCalls += 1; return null; },
    },
    health: { status: 'degraded' },
  });
  const form = new FormData();
  form.append('consent', 'true');
  const response = await app.inject({
    method: 'POST', url: '/api/runs', headers: form.getHeaders(), payload: form.getBuffer(),
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: 'Обраний режим генерації зображень тимчасово недоступний.',
    code: 'IMAGE_GENERATION_MODE_UNAVAILABLE',
  });
  assert.equal(response.headers['retry-after'], '60');
  assert.equal(createCalls, 0);
  await app.close();
});

test('Fast remains available when Codex preflight is degraded and FAL is configured', async () => {
  let received;
  const app = await createWebApp({
    service: {
      ...serviceThatLeaksInternally(),
      createRun: async (input) => { received = input; return { run_id: 'fast-run', status: 'QUEUED' }; },
    },
    health: { status: 'degraded' },
    healthProvider: async () => ({
      status: 'degraded',
      runtime_status: 'ready',
      image_generation_modes: { slow: { available: false }, fast: { available: true } },
    }),
  });
  const form = new FormData();
  form.append('image_generation_mode', 'fast');
  form.append('consent', 'true');
  const response = await app.inject({
    method: 'POST', url: '/api/runs', headers: form.getHeaders(), payload: form.getBuffer(),
  });
  assert.equal(response.statusCode, 202, response.body);
  assert.equal(received.image_generation_mode, 'fast');
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.deepEqual(health.json().image_generation_modes, {
    slow: { available: false },
    fast: { available: true },
  });
  await app.close();
});

test('a hard runtime fault disables both image modes even when capabilities are advertised', async () => {
  let createCalls = 0;
  const app = await createWebApp({
    service: {
      ...serviceThatLeaksInternally(),
      createRun: async () => { createCalls += 1; return { run_id: 'blocked', status: 'QUEUED' }; },
    },
    healthProvider: async () => ({
      status: 'ready',
      runtime_status: 'degraded',
      image_generation_modes: { slow: { available: true }, fast: { available: true } },
    }),
  });
  for (const mode of ['slow', 'fast']) {
    const form = new FormData();
    form.append('image_generation_mode', mode);
    form.append('consent', 'true');
    const response = await app.inject({
      method: 'POST', url: '/api/runs', headers: form.getHeaders(), payload: form.getBuffer(),
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'IMAGE_GENERATION_MODE_UNAVAILABLE');
  }
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.deepEqual(health.json().image_generation_modes, {
    slow: { available: false },
    fast: { available: false },
  });
  assert.equal(createCalls, 0);
  await app.close();
});

test('a recovered cached preflight re-enables the journey without restarting the web app', async () => {
  let latest = { status: 'degraded', runtime_status: 'ready' };
  const app = await createWebApp({
    service: serviceThatLeaksInternally(),
    health: { status: 'degraded' },
    healthProvider: async () => latest,
  });

  let response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.json().status, 'degraded');
  assert.equal(response.json().generation, 'unavailable');

  latest = { status: 'ready', runtime_status: 'ready' };
  response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.json().status, 'ready');
  assert.equal(response.json().generation, 'available');

  await app.close();
});
