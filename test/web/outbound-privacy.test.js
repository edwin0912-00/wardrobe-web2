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
  assert.deepEqual(response.json(), { status: 'ok', service: 'web', generation: 'available', semantic_qa: 'available' });
  await app.close();
});
