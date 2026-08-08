import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenerationRuntime } from '../../src/web/generation-provider.js';

function worker() {
  return {
    async start() { return { account: { type: 'chatgpt' }, capabilities: { imageGeneration: true } }; },
    async generate() { throw new Error('not used in construction smoke'); },
    healthStatus() { return { status: 'ready' }; },
    async close() {},
    on() {},
    off() {},
  };
}

const vlm = { evaluateQa: async () => ({ decision: 'NEEDS_INPUT' }) };

test('codex-primary builds Codex first with OpenRouter image fallback', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  try {
    const runtime = await createGenerationRuntime({
      mode: 'codex-primary',
      vlm,
      projectRoot: process.cwd(),
      codexWorker: worker(),
    });
    assert.equal(runtime.mode, 'codex-primary');
    assert.equal(runtime.provider.providerName, 'codex-primary-openrouter-fallback');
    assert.equal(runtime.generationRoute.length, 5);
    assert.equal(runtime.healthStatus().policy, 'codex-primary-openrouter-fallback');
    await runtime.close();
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test('Higgsfield generation mode is explicitly prohibited', async () => {
  await assert.rejects(
    () => createGenerationRuntime({ mode: 'higgsfield', vlm, projectRoot: process.cwd() }),
    /HIGGSFIELD_DISABLED/,
  );
});
