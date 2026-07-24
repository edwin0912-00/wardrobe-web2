import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneEvaluatorAdapter } from '../../src/web/scene-adapters.js';
import { OpenRouterSceneEvaluator } from '../../src/web/openrouter-scene-evaluator.js';
import { createSceneRuntimeDependencies } from '../../src/web/scene-runtime.js';

const baseArgs = { projectRoot: process.cwd(), qaEvaluator: async () => ({}) };

test('createSceneRuntimeDependencies defaults to SceneEvaluatorAdapter (Codex) when no vlmProvider is configured', () => {
  const deps = createSceneRuntimeDependencies({ ...baseArgs, vlmProvider: undefined });
  assert.ok(deps.evaluator instanceof SceneEvaluatorAdapter);
});

test('createSceneRuntimeDependencies selects OpenRouterSceneEvaluator when vlmProvider is openrouter', () => {
  const deps = createSceneRuntimeDependencies({
    ...baseArgs,
    vlmProvider: 'openrouter',
    // Avoid constructing a real OpenRouterClient (which requires an API key)
    // by supplying an explicit sceneEvaluator override.
    sceneEvaluator: new OpenRouterSceneEvaluator({ client: { completeWithSchema: async () => '{}' } }),
  });
  assert.ok(deps.evaluator instanceof OpenRouterSceneEvaluator);
});

test('createSceneRuntimeDependencies rejects an unknown vlmProvider', () => {
  assert.throws(
    () => createSceneRuntimeDependencies({ ...baseArgs, vlmProvider: 'not-a-real-provider' }),
    /Unknown ZEELY_VLM_PROVIDER/,
  );
});

test('createSceneRuntimeDependencies reads ZEELY_VLM_PROVIDER from the environment when vlmProvider is not passed explicitly', () => {
  const previous = process.env.ZEELY_VLM_PROVIDER;
  try {
    process.env.ZEELY_VLM_PROVIDER = 'openrouter';
    const deps = createSceneRuntimeDependencies({
      ...baseArgs,
      sceneEvaluator: new OpenRouterSceneEvaluator({ client: { completeWithSchema: async () => '{}' } }),
    });
    assert.ok(deps.evaluator instanceof OpenRouterSceneEvaluator);
  } finally {
    if (previous === undefined) delete process.env.ZEELY_VLM_PROVIDER;
    else process.env.ZEELY_VLM_PROVIDER = previous;
  }
});
