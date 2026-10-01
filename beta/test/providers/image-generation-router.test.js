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
