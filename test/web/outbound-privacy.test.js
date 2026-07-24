import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.match(response.json().error, /\[redacted-local-path\]/);
  await app.close();
});

test('health response exposes capability status without provider or project fingerprints', async () => {
  const app = await createWebApp({ service: serviceThatLeaksInternally(), health: {
    status: 'ok', generation: 'Higgsfield CLI', semantic_qa: 'Codex CLI', internal_path: '/Users/jarvis1/app',
  } });
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'web',
    generation: 'available',
    semantic_qa: 'available',
    editorial_generation: 'disabled',
  });
  await app.close();
});

test('degraded provider preflight refuses paid generation before uploads enter the pipeline', async () => {
  let createCalls = 0;
  const app = await createWebApp({
    service: {
      ...serviceThatLeaksInternally(),
      createRun: async () => { createCalls += 1; return null; },
    },
    health: { status: 'degraded' },
  });
  const response = await app.inject({ method: 'POST', url: '/api/runs' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: 'Генерація тимчасово недоступна: потрібна авторизація або перевірка Higgsfield.',
    code: 'GENERATION_UNAVAILABLE',
    next_action: 'RETRY_AFTER_PROVIDER_READY',
  });
  assert.equal(response.headers['retry-after'], '60');
  assert.equal(createCalls, 0);
  await app.close();
});
