import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexVlmEvaluator } from '../../src/providers/codex-vlm-evaluator.js';
import { OpenRouterVlmEvaluator } from '../../src/providers/openrouter-vlm-evaluator.js';
import { createVlmEvaluator } from '../../src/web/vlm-provider.js';

test('createVlmEvaluator defaults to Codex when no provider is configured', () => {
  const evaluator = createVlmEvaluator({ provider: undefined });
  assert.ok(evaluator instanceof CodexVlmEvaluator);
});

test('createVlmEvaluator selects OpenRouter when provider is openrouter', () => {
  const evaluator = createVlmEvaluator({
    provider: 'openrouter',
    openRouterOptions: { client: { completeWithSchema: async () => '{}' } },
  });
  assert.ok(evaluator instanceof OpenRouterVlmEvaluator);
});

test('createVlmEvaluator rejects an unknown provider name', () => {
  assert.throws(() => createVlmEvaluator({ provider: 'not-a-real-provider' }), /Unknown ZEELY_VLM_PROVIDER/);
});

test('createVlmEvaluator reads ZEELY_VLM_PROVIDER from the environment when provider is not passed explicitly', () => {
  const previous = process.env.ZEELY_VLM_PROVIDER;
  try {
    process.env.ZEELY_VLM_PROVIDER = 'openrouter';
    const evaluator = createVlmEvaluator({ openRouterOptions: { client: { completeWithSchema: async () => '{}' } } });
    assert.ok(evaluator instanceof OpenRouterVlmEvaluator);
  } finally {
    if (previous === undefined) delete process.env.ZEELY_VLM_PROVIDER;
    else process.env.ZEELY_VLM_PROVIDER = previous;
  }
});
