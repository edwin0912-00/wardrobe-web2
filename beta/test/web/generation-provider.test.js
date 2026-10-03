import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGenerationRuntime } from '../../src/web/generation-provider.js';
import { ImageAssetGenerator } from '../../src/web/image-asset-generator.js';
import { MOCK_PNG } from '../../src/providers/mock-provider.js';

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

test('codex-primary builds Codex first with FAL fallback and ignores an OpenRouter key', async () => {
  const previousOpenRouter = process.env.OPENROUTER_API_KEY;
  const previousFal = process.env.FAL_KEY;
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.FAL_KEY = 'fal-test-key';
  try {
    const runtime = await createGenerationRuntime({
      mode: 'codex-primary',
      vlm,
      projectRoot: process.cwd(),
      codexWorker: worker(),
      falClient: {},
    });
    assert.equal(runtime.mode, 'codex-primary');
    assert.equal(runtime.provider.providerName, 'codex-primary-fal-fallback');
    assert.equal(runtime.generationRoute.length, 5);
    assert.equal(runtime.healthStatus().policy, 'codex-primary-fal-fallback');
    assert.deepEqual(runtime.healthStatus().fallbacks, ['fal-gpt-image-2.5-sunburst']);
    assert.deepEqual(runtime.imageGenerationModes(), {
      slow: { available: true },
      fast: { available: true },
    });
    assert.equal(runtime.runtimeStatus(), 'ready');
    await runtime.close();
  } finally {
    if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouter;
    if (previousFal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousFal;
  }
});

test('codex-primary boots without FAL_KEY and never advertises OpenRouter as a fallback', async () => {
  const previousOpenRouter = process.env.OPENROUTER_API_KEY;
  const previousFal = process.env.FAL_KEY;
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  delete process.env.FAL_KEY;
  try {
    const runtime = await createGenerationRuntime({
      mode: 'codex-primary',
      vlm,
      projectRoot: process.cwd(),
      codexWorker: worker(),
    });
    assert.equal(runtime.mode, 'codex-primary');
    assert.equal(runtime.provider.providerName, 'codex-primary-fal-fallback');
    assert.deepEqual(runtime.healthStatus().fallbacks, []);
    assert.deepEqual(runtime.imageGenerationModes(), {
      slow: { available: true },
      fast: { available: false },
    });
    assert.equal(runtime.label, 'Codex Image Generation');
    await runtime.close();
  } finally {
    if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouter;
    if (previousFal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousFal;
  }
});

test('OpenRouter remains available only through its explicit legacy mode', async () => {
  const previousOpenRouter = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  try {
    const runtime = await createGenerationRuntime({ mode: 'openrouter', vlm, projectRoot: process.cwd() });
    assert.equal(runtime.label, 'OpenRouter Image Generation');
    await assert.rejects(
      () => runtime.provider.generate({ imageGenerationMode: 'fast' }),
      (error) => error.code === 'IMAGE_GENERATION_MODE_UNAVAILABLE' && error.statusCode === 503,
    );
    await runtime.close();
  } finally {
    if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouter;
  }
});

test('failed Codex probe degrades the runtime instead of killing the local UI', async () => {
  const brokenWorker = worker();
  brokenWorker.start = async () => {
    const error = new Error('not authenticated');
    error.code = 'CODEX_NOT_AUTHENTICATED';
    throw error;
  };
  const runtime = await createGenerationRuntime({
    mode: 'codex-primary',
    vlm,
    projectRoot: process.cwd(),
    codexWorker: brokenWorker,
  });
  assert.equal(runtime.healthStatus().status, 'degraded');
  assert.equal(runtime.healthStatus().code, 'CODEX_NOT_AUTHENTICATED');
  await assert.rejects(
    () => runtime.provider.generate({}),
    (error) => error.code === 'GENERATION_UNAVAILABLE' && error.retryable === true,
  );
  await runtime.close();
});

test('a configured FAL fallback keeps runtime available when Codex startup authentication fails', async () => {
  const previousFal = process.env.FAL_KEY;
  process.env.FAL_KEY = 'fal-test-key';
  const brokenWorker = worker();
  brokenWorker.start = async () => {
    const error = new Error('not authenticated');
    error.code = 'CODEX_NOT_AUTHENTICATED';
    throw error;
  };
  try {
    const runtime = await createGenerationRuntime({
      mode: 'codex-primary',
      vlm,
      projectRoot: process.cwd(),
      codexWorker: brokenWorker,
      falClient: {},
    });
    assert.equal(runtime.provider.providerName, 'codex-primary-fal-fallback');
    assert.equal(runtime.healthStatus().status, 'degraded');
    assert.equal(runtime.healthStatus().primary, 'degraded');
    assert.equal(runtime.healthStatus().primary_code, 'CODEX_NOT_AUTHENTICATED');
    assert.deepEqual(runtime.healthStatus().fallbacks, ['fal-gpt-image-2.5-sunburst']);
    assert.deepEqual(runtime.imageGenerationModes(), {
      slow: { available: true },
      fast: { available: true },
    });
    assert.equal(runtime.runtimeStatus(), 'ready');
    assert.equal((await runtime.provider.qa({})).decision, 'NEEDS_INPUT');
    await runtime.close();
  } finally {
    if (previousFal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousFal;
  }
});

test('Higgsfield generation mode is explicitly prohibited', async () => {
  await assert.rejects(
    () => createGenerationRuntime({ mode: 'higgsfield', vlm, projectRoot: process.cwd() }),
    /HIGGSFIELD_DISABLED/,
  );
});

test('garment asset generation carries Fast mode and a distinct provider idempotency key', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-asset-mode-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const referencePath = path.join(root, 'garment.png');
  await writeFile(referencePath, MOCK_PNG);
  const calls = [];
  const generator = new ImageAssetGenerator({
    provider: {
      async generate(context) {
        calls.push(context);
        return { image: MOCK_PNG, mediaType: 'image/png' };
      },
    },
  });
  const input = {
    sourcePath: referencePath,
    model: 'gpt_image_2',
    generationProfile: { id: 'low', resolution: '1k', quality: 'low' },
    prompt: 'keep the garment unchanged',
    workDirectory: root,
    operationId: 'same-garment-operation',
  };

  await generator.generateGarment({ ...input, imageGenerationMode: 'slow' });
  await generator.generateGarment({ ...input, imageGenerationMode: 'fast' });

  assert.deepEqual(calls.map((call) => call.imageGenerationMode), ['slow', 'fast']);
  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
});
