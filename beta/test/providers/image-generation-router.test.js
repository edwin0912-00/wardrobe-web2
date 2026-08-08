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
