import assert from 'node:assert/strict';
import test from 'node:test';
import { runLocalPreflight } from '../../src/web/preflight.js';

function withKey(fn) {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  return Promise.resolve(fn()).finally(() => {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  });
}

test('OpenRouter preflight reports ready from configuration without a provider CLI probe', async () => {
  const result = await withKey(() => runLocalPreflight());
  assert.equal(result.status, 'ready');
  assert.equal(result.generation, 'OpenRouter Image Generation');
});

test('OpenRouter preflight fails clearly when its key is missing', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await assert.rejects(() => runLocalPreflight(), /OPENROUTER_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
  }
});

test('unsupported provider modes are rejected instead of probing a removed CLI', async () => {
  await assert.rejects(() => runLocalPreflight({ generationMode: 'higgsfield' }), /Unsupported generation mode/);
});
