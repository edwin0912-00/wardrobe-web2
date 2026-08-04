import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';

const READY_SHOOT_IDS = [
  'shoot.skylight_haze',
  'shoot.terracotta_hardlight',
  'shoot.window_gobo_warm',
  'shoot.grey_studio_stride',
  'shoot.sky_dune_surreal',
  'shoot.hardsun_brick_doorway',
  'shoot.overcast_street_stride',
  'shoot.grey_wall_gloss',
  'shoot.ochre_stage_tailoring',
  'shoot.shutter_amber_interior',
  'shoot.zayn_institutional',
  'shoot.liza_luminous',
  'shoot.duckweed_forest_ophelia',
  'shoot.rooftop_veil_monochrome',
  'shoot.autumn_park_mediated_sun',
];

test('all Creative Universe units compile their observed runtime style', async () => {
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

    const validationShot = bible.shots.find((shot) => shot.slot === 'clean_identity_hero');
    assert.match(validationShot.pose, /front or near-front three-quarter/i, modeId);
    assert.doesNotMatch(validationShot.pose, /back-three-quarter/i, modeId);
    const reference = await resolver.editorialShotPresetReference({
      modeId,
      version: mode.version,
      shotSpec: validationShot,
    });
    const pack = await resolver.resolveScenePreset(reference);
    assert.equal(pack.preset.editorial.item_scope, 'EXCLUDE_FOOTWEAR', modeId);
    assert.match(pack.preset.editorial.style_contract.visual_system, /validation frame/i, modeId);
    assert.match(pack.preset.editorial.style_contract.garment_behaviour, /naturally at rest/i, modeId);
    assert.doesNotMatch(pack.preset.editorial.style_contract.garment_behaviour, /moving cloth plane/i, modeId);
    assert.match(pack.prompt, /front or near-front three-quarter/i, modeId);
  }
  assert.equal(visualSystems.size, READY_SHOOT_IDS.length);
});
