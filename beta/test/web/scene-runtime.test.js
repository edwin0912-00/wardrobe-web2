import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { HiggsfieldCliProvider } from '../../src/providers/higgsfield-cli-provider.js';
import { SceneEvaluatorAdapter, SceneGeneratorAdapter } from '../../src/web/scene-adapters.js';
import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';
import {
  createSceneRuntimeDependencies,
  SCENE_PROVIDER_RUNTIME_CONFIG,
} from '../../src/web/scene-runtime.js';

const realProjectRoot = path.resolve(import.meta.dirname, '..', '..');

test('production scene runtime builds the exact three-provider route with isolated storage', () => {
  const projectRoot = path.resolve('/test/project');
  const qaEvaluator = async () => ({ decision: 'PASS' });
  const dependencies = createSceneRuntimeDependencies({ projectRoot, qaEvaluator });

  assert.equal(dependencies.rootDirectory, path.join(projectRoot, 'runtime', 'scenes'));
  assert.ok(dependencies.generator instanceof SceneGeneratorAdapter);
  assert.ok(dependencies.evaluator instanceof SceneEvaluatorAdapter);
  assert.equal(dependencies.evaluator.model, 'gpt-5.6-terra');
  assert.ok(dependencies.presetResolver instanceof FilesystemScenePresetResolver);
  assert.equal(
    dependencies.presetResolver.rootDirectory,
    path.join(projectRoot, 'assets', 'scene-presets'),
  );
  assert.equal(dependencies.presetResolver.projectRoot, projectRoot);
  assert.equal(dependencies.observer, undefined);

  assert.deepEqual(Object.keys(dependencies.generator.providers), [
    'gpt_image_2',
    'nano_banana_flash',
    'nano_banana_2',
  ]);
  for (const [model, expected] of Object.entries(SCENE_PROVIDER_RUNTIME_CONFIG)) {
    const provider = dependencies.generator.providers[model];
    assert.ok(provider instanceof HiggsfieldCliProvider);
    assert.equal(provider.aspectRatio, expected.aspectRatio);
    assert.equal(provider.resolution, '2k');
    assert.equal(provider.quality, 'high');
    assert.equal(provider.qaEvaluator, qaEvaluator);
    assert.equal(
      provider.journalDirectory,
      path.join(projectRoot, 'runtime', 'provider-journals', 'scenes', model),
    );
  }
  assert.notEqual(
    dependencies.generator.providers.gpt_image_2.journalDirectory,
    dependencies.generator.providers.nano_banana_flash.journalDirectory,
  );
});

test('scene runtime monitor observer exposes useful state but redacts paths and credential-shaped text', async () => {
  const events = [];
  const monitor = { async append(event) { events.push(event); } };
  const dependencies = createSceneRuntimeDependencies({
    projectRoot: '/Users/private/project',
    qaEvaluator: async () => ({ decision: 'PASS' }),
    monitor,
  });

  await dependencies.observer({
    scene_id: 'scene-123',
    status: 'FAILED',
    phase: 'GENERATING',
    message: [
      'Zeely failed at /Users/private/project/runtime/scene',
      'token=super-secret-value',
      'sk-abcdefghijk',
      'Bearer eyJhbGciOiJIUzI1NiJ9.secret',
      'https://provider.example/result.png?signature=private#fragment',
    ].join(' '),
  });

  assert.equal(events.length, 1);
  assert.deepEqual({
    source: events[0].source,
    type: events[0].type,
    severity: events[0].severity,
    scene_id: events[0].data.scene_id,
    status: events[0].data.status,
    stage: events[0].data.stage,
  }, {
    source: 'runner',
    type: 'scene.phase',
    severity: 'error',
    scene_id: 'scene-123',
    status: 'FAILED',
    stage: 'GENERATING',
  });
  assert.doesNotMatch(
    events[0].data.message,
    /Zeely|madeforthisjob|\/Users\/|super-secret-value|sk-abcdefghijk|eyJhbGciOiJIUzI1NiJ9|signature=|fragment/i,
  );
  assert.match(events[0].data.message, /\[redacted/);
});

test('production scene runtime resolver opens the checked-in sixteen-preset catalog', async () => {
  const dependencies = createSceneRuntimeDependencies({
    projectRoot: realProjectRoot,
    qaEvaluator: async () => ({ decision: 'PASS' }),
  });
  await dependencies.presetResolver.initialize();
  const presets = await dependencies.presetResolver.listPresets();
  assert.deepEqual(presets.map((preset) => preset.preset_id), [
    'std.architecture.glass_corridor_sunset',
    'std.city.amber_alley_cobblestone',
    'std.city.golden_hour_gloss',
    'std.city.night_neon_wet_asphalt',
    'std.city.rooftop_concrete_sunset',
    'std.interior.abandoned_palace_light_shaft',
    'std.interior.gallery_morning_gloss',
    'std.interior.industrial_brick_loft',
    'std.interior.sheer_curtain_golden_light',
    'std.nature_architecture.concrete_grass_golden_hour',
    'std.nature.foggy_forest_light_shaft',
    'std.nature.ocean_dusk_blue_hour',
    'std.studio.black_spotlight_low_key',
    'std.studio.taupe_rembrandt_gloss',
    'std.studio.terracotta_raking_light',
    'std.studio.white_window_honeycomb',
  ]);
});

test('scene runtime refuses incomplete evaluator and monitor wiring', () => {
  assert.throws(
    () => createSceneRuntimeDependencies({ projectRoot: '/test/project' }),
    /qaEvaluator is required/,
  );
  assert.throws(
    () => createSceneRuntimeDependencies({
      projectRoot: '/test/project',
      qaEvaluator: async () => ({ decision: 'PASS' }),
      monitor: {},
    }),
    /monitor\.append/,
  );
});
