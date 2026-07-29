import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';

const READY_SHOOT_IDS = [
  'shoot.autumn_park_mediated_sun',
];

test('the recovered source-backed Creative Universe unit compiles its observed runtime style', async () => {
  const projectRoot = path.resolve('.');
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.join(projectRoot, 'assets', 'scene-presets'),
    projectRoot,
  });
  await resolver.initialize();

  const catalog = await resolver.listEditorialModes();
  const byId = new Map(catalog.modes.map((mode) => [mode.mode_id, mode]));

  const visualSystems = new Set();
  for (const modeId of READY_SHOOT_IDS) {
    const mode = byId.get(modeId);
    assert.ok(mode, modeId);
    assert.equal(mode.source_set_status, 'READY', modeId);
    assert.equal(mode.generation_available, true, modeId);
    assert.doesNotMatch(mode.visual_system, /\.(?:png|jpe?g|webp)$/i, modeId);
    visualSystems.add(mode.visual_system);

    const bible = await resolver.compileEditorialShootBible({
      modeId,
      version: mode.version,
    });
    assert.equal(bible.shots.length, 6, modeId);
    assert.equal(new Set(bible.shots.map((shot) => shot.pose)).size, 6, modeId);
    assert.equal(new Set(bible.shots.map((shot) => shot.camera.angle)).size, 6, modeId);
    assert.ok(
      bible.shots.every((shot) => /optical signature/i.test(shot.lighting)),
      `${modeId} must carry its fixed optical signature on every frame`,
    );
  }
  assert.equal(visualSystems.size, READY_SHOOT_IDS.length);
});
