import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageGenerationRouter } from '../../src/providers/image-generation-router.js';

function response(provider) {
  return { image: Buffer.from('png'), mediaType: 'image/png', metadata: { provider } };
}

test('Codex primary result is returned without invoking OpenRouter', async () => {
  let fallbackCalls = 0;
  const router = new ImageGenerationRouter({
    primary: { providerName: 'codex', maxOrderedReferences: 5, generate: async () => response('codex') },
    fallbacks: [{ providerName: 'openrouter', generate: async () => { fallbackCalls += 1; return response('openrouter'); } }],
  });
  const result = await router.generate({ idempotencyKey: 'x' });
  assert.equal(result.metadata.provider, 'codex');
  assert.equal(result.metadata.routing.selected, 'codex');
  assert.equal(fallbackCalls, 0);
});

test('retryable Codex transport failure uses OpenRouter exactly once', async () => {
  let fallbackCalls = 0;
  const router = new ImageGenerationRouter({
    primary: { providerName: 'codex', generate: async () => { throw Object.assign(new Error('worker down'), { code: 'PROCESS_EXITED', retryable: true }); } },
    fallbacks: [{ providerName: 'openrouter', generate: async () => { fallbackCalls += 1; return response('openrouter'); } }],
  });
  const result = await router.generate({ idempotencyKey: 'x' });
  assert.equal(result.metadata.provider, 'openrouter');
  assert.equal(result.metadata.routing.fallback_used, true);
  assert.equal(fallbackCalls, 1);
});

test('unknown submitted Codex outcome never falls through to a paid duplicate', async () => {
  let fallbackCalls = 0;
  const router = new ImageGenerationRouter({
    primary: { providerName: 'codex', generate: async () => { throw Object.assign(new Error('unknown'), { code: 'GENERATION_OUTCOME_UNKNOWN', retryable: false }); } },
    fallbacks: [{ providerName: 'openrouter', generate: async () => { fallbackCalls += 1; return response('openrouter'); } }],
  });
  await assert.rejects(() => router.generate({ idempotencyKey: 'x' }), (error) => error.code === 'GENERATION_OUTCOME_UNKNOWN');
  assert.equal(fallbackCalls, 0);
});

test('a request beyond Codex reference capacity goes straight to FAL with every binding', async () => {
  let codexCalls = 0;
  let falContext;
  const references = Array.from({ length: 6 }, (_, index) => ({ order: index + 1, role: `REFERENCE_${index + 1}` }));
  const router = new ImageGenerationRouter({
    primary: { providerName: 'codex', maxOrderedReferences: 5, generate: async () => { codexCalls += 1; return response('codex'); } },
    fallbacks: [{
      providerName: 'fal-gpt-image-2.5-sunburst',
      maxOrderedReferences: 16,
      async generate(context) { falContext = context; return response('fal'); },
    }],
  });

  const result = await router.generate({ references: { ordered: references } });

  assert.equal(codexCalls, 0);
  assert.equal(falContext.references.ordered.length, 6);
  assert.deepEqual(result.metadata.routing.attempts, [
    { provider: 'codex', outcome: 'SKIPPED', reason: 'REFERENCE_LIMIT', reference_count: 6, max_ordered_references: 5 },
    { provider: 'fal-gpt-image-2.5-sunburst', outcome: 'SUCCEEDED' },
  ]);
});

test('a request beyond all configured provider capacities fails with the skip receipt', async () => {
  const router = new ImageGenerationRouter({
    primary: { providerName: 'codex', maxOrderedReferences: 5, async generate() { throw new Error('must be skipped'); } },
  });

  await assert.rejects(
    () => router.generate({ references: { ordered: Array.from({ length: 6 }, (_, index) => ({ order: index + 1 })) } }),
    (error) => error.code === 'NO_CAPABLE_IMAGE_PROVIDER'
      && error.attempts[0].outcome === 'SKIPPED'
      && error.attempts[0].reason === 'REFERENCE_LIMIT',
  );
});

test('Fast sends every required reference straight to FAL without touching Codex', async () => {
  let codexCalls = 0;
  let falContext;
  const references = Array.from({ length: 6 }, (_, index) => ({ order: index + 1, role: `REFERENCE_${index + 1}` }));
  const fal = {
    providerName: 'fal-gpt-image-2.5-sunburst',
    maxOrderedReferences: 16,
    async generate(context) { falContext = context; return response('fal'); },
  };
  const router = new ImageGenerationRouter({
    primary: { providerName: 'codex', maxOrderedReferences: 5, async generate() { codexCalls += 1; throw new Error('Codex must not run'); } },
    fallbacks: [fal],
    fastProvider: fal,
  });

  const result = await router.generate({ imageGenerationMode: 'fast', references: { ordered: references } });

  assert.equal(codexCalls, 0);
  assert.equal(falContext.references.ordered.length, references.length);
  assert.equal(result.metadata.provider, 'fal');
  assert.equal(result.metadata.routing.image_generation_mode, 'fast');
  assert.equal(result.metadata.routing.selected, 'fal-gpt-image-2.5-sunburst');
  assert.equal(result.metadata.routing.fallback_used, false);
});

test('Fast never falls back to Codex after a FAL failure', async () => {
  let codexCalls = 0;
  let fallbackCalls = 0;
  const fal = {
    providerName: 'fal-gpt-image-2.5-sunburst',
    async generate() { throw Object.assign(new Error('FAL transport failed'), { code: 'PROCESS_EXITED', retryable: true }); },
  };
  const router = new ImageGenerationRouter({
    primary: { providerName: 'codex', async generate() { codexCalls += 1; return response('codex'); } },
    fallbacks: [{ providerName: 'other-fallback', async generate() { fallbackCalls += 1; return response('fallback'); } }],
    fastProvider: fal,
  });

  await assert.rejects(
    () => router.generate({ imageGenerationMode: 'fast' }),
    (error) => error.code === 'PROCESS_EXITED' && error.retryable === true,
  );
  assert.equal(codexCalls, 0);
  assert.equal(fallbackCalls, 0);
});

test('Fast without a configured FAL provider is explicitly unavailable', async () => {
  let codexCalls = 0;
  const router = new ImageGenerationRouter({
    primary: { providerName: 'codex', async generate() { codexCalls += 1; return response('codex'); } },
  });

  await assert.rejects(
    () => router.generate({ imageGenerationMode: 'fast' }),
    (error) => error.code === 'IMAGE_GENERATION_MODE_UNAVAILABLE' && error.statusCode === 503,
  );
  assert.equal(codexCalls, 0);
});

test('invalid image mode is rejected before either transport runs', async () => {
  let calls = 0;
  const router = new ImageGenerationRouter({
    primary: { async generate() { calls += 1; return response('codex'); } },
    fallbacks: [{ providerName: 'fal-gpt-image-2.5-sunburst', async generate() { calls += 1; return response('fal'); } }],
  });

  await assert.rejects(
    () => router.generate({ imageGenerationMode: null }),
    (error) => error.code === 'IMAGE_GENERATION_MODE_INVALID' && error.statusCode === 400,
  );
  assert.equal(calls, 0);
});

test('concurrent Slow and Fast calls keep their per-request routes independent', async () => {
  const seen = [];
  const fal = {
    providerName: 'fal-gpt-image-2.5-sunburst',
    async generate(context) {
      await Promise.resolve();
      seen.push(['fast', context.imageGenerationMode]);
      return response('fal');
    },
  };
  const router = new ImageGenerationRouter({
    primary: {
      providerName: 'codex',
      async generate(context) {
        await Promise.resolve();
        seen.push(['slow', context.imageGenerationMode]);
        return response('codex');
      },
    },
    fallbacks: [fal],
    fastProvider: fal,
  });

  const [slow, fast] = await Promise.all([
    router.generate({ imageGenerationMode: 'slow' }),
    router.generate({ imageGenerationMode: 'fast' }),
  ]);

  assert.deepEqual(seen.sort(), [['fast', 'fast'], ['slow', 'slow']]);
  assert.equal(slow.metadata.routing.image_generation_mode, 'slow');
  assert.equal(slow.metadata.routing.selected, 'codex');
  assert.equal(fast.metadata.routing.image_generation_mode, 'fast');
  assert.equal(fast.metadata.routing.selected, 'fal-gpt-image-2.5-sunburst');
});

test('an unavailable Codex primary is reported as degraded and FAL remains routable', async () => {
  let codexCalls = 0;
  let falCalls = 0;
  const router = new ImageGenerationRouter({
    primary: {
      providerName: 'codex',
      healthStatus: () => ({ status: 'ready' }),
      async probe() { throw Object.assign(new Error('not authenticated'), { code: 'CODEX_NOT_AUTHENTICATED' }); },
      async generate() { codexCalls += 1; return response('codex'); },
    },
    fallbacks: [{ providerName: 'fal-gpt-image-2.5-sunburst', async generate() { falCalls += 1; return response('fal'); } }],
  });

  const health = await router.probe();
  const result = await router.generate({ idempotencyKey: 'x' });

  assert.equal(health.status, 'degraded');
  assert.equal(health.primary, 'degraded');
  assert.equal(health.primary_code, 'CODEX_NOT_AUTHENTICATED');
  assert.equal(codexCalls, 0);
  assert.equal(falCalls, 1);
  assert.equal(result.metadata.routing.attempts[0].reason, 'PRIMARY_UNAVAILABLE');
});
