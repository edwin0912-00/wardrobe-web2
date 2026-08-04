import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const builder = path.join(projectRoot, 'tools', 'build-product-release.mjs');
const verifier = path.join(projectRoot, 'tools', 'verify-product-release.mjs');
const manifestRelativePath = 'ops/product-release-manifest.json';
const requiredEditorialModeIds = [
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
  'editorial.edwin_novak.institutional_modernism',
  'editorial.edwin_novak.luminous_blue_white',
];
const requiredEditorialGenerationModeIds = [
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
];
const requiredCreateUniverseModeIds = [
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
const requiredCreateUniverseGenerationModeIds = [
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
const requiredReleasePreviewModeIds = [
  ...requiredEditorialModeIds,
  ...requiredCreateUniverseModeIds,
];
const requiredReleaseGenerationModeIds = [
  ...requiredEditorialGenerationModeIds,
  ...requiredCreateUniverseGenerationModeIds,
];
const requiredCreateUniverseUnitRoots = requiredCreateUniverseGenerationModeIds
  .map((modeId) => `docs/style-units/${modeId}`);
const requiredEditorialPreviewFiles = requiredReleasePreviewModeIds.flatMap((modeId) => [
  `assets/scene-mood-cards/${modeId}.json`,
  `assets/scene-mood-cards/${modeId}.webp`,
]);
const requiredEditorialShotSlots = [
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
];
const requiredEditorialBlockingFiles = [
  'assets/editorial-blocking/v1/index.json',
  ...requiredEditorialShotSlots.map((slot) => `assets/editorial-blocking/v1/${slot}.png`),
];
const directoryRoots = [
  'assets/editorial-blocking',
  'assets/scene-presets',
  ...requiredCreateUniverseUnitRoots,
  'config',
  'prompts',
  'schemas',
  'src',
  'web',
];
const individualFiles = [
  ...requiredEditorialPreviewFiles,
  'package.json',
  'package-lock.json',
  'tools/run-monitor-daemon.sh',
  'tools/run-web-daemon.sh',
];

function comparePath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileInventory(root, { excludeManifest = false } = {}) {
  const files = [];
  async function walk(directory, relativeDirectory = '') {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => comparePath(left.name, right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      const info = await lstat(absolutePath);
      if (info.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else {
        assert.equal(info.isFile(), true, `Unexpected non-file ${relativePath}`);
        if (excludeManifest && relativePath === manifestRelativePath) continue;
        const bytes = await readFile(absolutePath);
        files.push({
          path: relativePath,
          mode: (info.mode & 0o777).toString(8).padStart(4, '0'),
          size_bytes: bytes.byteLength,
          sha256: sha256(bytes),
        });
      }
    }
  }
  await walk(root);
  return files;
}

async function currentAllowlistedPaths() {
  const paths = [];
  for (const relativeRoot of directoryRoots) {
    const inventory = await fileInventory(path.join(projectRoot, relativeRoot));
    paths.push(...inventory.map((entry) => path.posix.join(relativeRoot, entry.path)));
  }
  paths.push(...individualFiles);
  return paths.sort(comparePath);
}

async function verify(releaseDirectory) {
  return execute(process.execPath, [verifier, releaseDirectory]);
}

async function resealDeployInventory(releaseDirectory) {
  const manifestPath = path.join(releaseDirectory, manifestRelativePath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const actualByPath = new Map(
    (await fileInventory(releaseDirectory, { excludeManifest: true }))
      .map((entry) => [entry.path, entry]),
  );
  for (const record of manifest.deploy_files) {
    const actual = actualByPath.get(record.path);
    assert.ok(actual, `Cannot reseal missing record ${record.path}`);
    record.mode = actual.mode;
    record.size_bytes = actual.size_bytes;
    record.sha256 = actual.sha256;
  }
  manifest.release_size_bytes = manifest.deploy_files
    .reduce((total, record) => total + record.size_bytes, 0);
  manifest.content_digest_sha256 = sha256(Buffer.from(JSON.stringify(manifest.deploy_files)));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await chmod(manifestPath, 0o600);
}

test('product release is deterministic, complete, scene-enabled and cache-bound', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-product-release-test-'));
  const releaseA = path.join(temporaryRoot, 'release-a');
  const releaseB = path.join(temporaryRoot, 'release-b');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  await execute(process.execPath, [builder, releaseA]);
  const verified = JSON.parse((await verify(releaseA)).stdout);
  const expectedScenePresetIds = JSON.parse(await readFile(
    path.join(projectRoot, 'config', 'scene-release-candidates.json'),
    'utf8',
  )).selected_preset_ids;
  assert.equal(expectedScenePresetIds.length, 16);
  assert.equal(verified.ok, true);
  assert.equal(verified.scene_presets, expectedScenePresetIds.length);
  assert.equal(verified.scene_ui, 'ENABLED');
  assert.equal(verified.scene_api, 'ENABLED');
  assert.equal(verified.scene_runtime, 'ENABLED');
  assert.equal(verified.editorial_preview, 'ACTIVE');
  assert.equal(verified.editorial_generation, 'ENABLED');
  assert.equal(verified.editorial_modes, requiredReleasePreviewModeIds.length);
  assert.equal(verified.editorial_generation_modes, requiredReleaseGenerationModeIds.length);
  assert.equal(verified.create_universe_modes, requiredCreateUniverseModeIds.length);
  assert.equal(verified.create_universe_generation_modes, requiredCreateUniverseGenerationModeIds.length);
  // Legacy editorial modes compile through the legacy ShootBible compiler.
  // Create Universe units compile through their own hash-bound scene route and
  // are asserted separately below; they must not be forced back onto the old
  // `EDITORIAL_BASE_PRESETS` coupling just to satisfy this count.
  assert.equal(verified.editorial_bibles_compiled, requiredEditorialGenerationModeIds.length);
  // Create Universe deliberately ships its immutable contact-sheet source
  // units. The former 40 MB ceiling predated that product and would force the
  // runtime to silently omit the actual references. Keep a finite budget,
  // with room for the approved 16 backgrounds and 10 reviewed style units,
  // but not an unbounded media dump.
  assert.ok(verified.release_size_bytes < 512 * 1024 * 1024);

  const manifest = JSON.parse(await readFile(
    path.join(releaseA, manifestRelativePath),
    'utf8',
  ));
  assert.equal(manifest.release, 'PRODUCT_SCENES_V1');
  assert.equal(manifest.package_type, 'RUNTIME_OVERLAY');
  assert.equal(manifest.runtime_state_strategy, 'PRESERVE_EXISTING_RUNTIME_AND_NODE_MODULES');
  assert.deepEqual(manifest.disabled, []);
  assert.deepEqual(manifest.features, {
    add_items: 'ENABLED',
    profile: 'ENABLED',
    scene_api: 'ENABLED',
    scene_runtime: 'ENABLED',
    scene_ui: 'ENABLED',
    editorial_preview: 'ACTIVE',
    editorial_generation: 'ENABLED',
  });
  assert.equal(manifest.editorial_preview.status, 'ACTIVE');
  assert.equal(manifest.editorial_preview.generation, 'ENABLED');
  assert.deepEqual(manifest.editorial_preview.mode_ids, requiredReleasePreviewModeIds);
  assert.ok(manifest.deploy_files.some((entry) => entry.path === 'docs/style-units/shoot.skylight_haze/manifest.json'));
  assert.ok(manifest.deploy_files.some((entry) => entry.path === 'docs/style-units/shoot.sky_dune_surreal/unit.json'));
  assert.deepEqual(
    manifest.editorial_preview.generation_mode_ids,
    requiredReleaseGenerationModeIds,
  );
  assert.deepEqual(
    manifest.editorial_preview.assets.map((asset) => asset.mode_id),
    requiredReleasePreviewModeIds,
  );
  assert.match(manifest.cache_token, /^product-[a-f0-9]{8}-[a-f0-9]{12}$/);
  assert.equal(
    manifest.source_authority.hash_format,
    'sha256-length-prefixed-path-mode-canonical-cache-bytes-v1',
  );
  assert.deepEqual(
    manifest.source_authority.files.map((record) => record.path),
    await currentAllowlistedPaths(),
  );
  assert.ok(manifest.deploy_files.every((record) => record.deploy === true));
  assert.ok(manifest.deploy_files.every((record) => (
    !/(^|\/)(?:secrets|runtime|output|evidence|inputs|personal)(?:\/|$)/i
      .test(record.path)
  )));
  assert.ok(manifest.deploy_files.every((record) => (
    !record.path.startsWith('docs/') || record.path.startsWith('docs/style-units/')
  )));
  assert.deepEqual(
    manifest.deploy_files
      .map((record) => record.path)
      .filter((relativePath) => relativePath.startsWith('assets/scene-mood-cards/')),
    [...requiredEditorialPreviewFiles].sort(comparePath),
  );
  // All six ship or none of them do: a shot resolves its own slot diagram at
  // generation time, so one missing PNG takes that slot out of service.
  assert.deepEqual(
    manifest.deploy_files
      .map((record) => record.path)
      .filter((relativePath) => relativePath.startsWith('assets/editorial-blocking/')),
    [...requiredEditorialBlockingFiles].sort(comparePath),
  );
  for (const modeId of requiredReleasePreviewModeIds) {
    const authority = manifest.editorial_preview.assets.find((asset) => asset.mode_id === modeId);
    const sidecarPath = `assets/scene-mood-cards/${modeId}.json`;
    const imagePath = `assets/scene-mood-cards/${modeId}.webp`;
    assert.equal(authority.sidecar_path, sidecarPath);
    assert.equal(authority.image_path, imagePath);
    assert.equal(authority.width, 1024);
    assert.equal(authority.height, 1280);
    assert.equal(authority.media_type, 'image/webp');
    assert.equal(
      authority.sidecar_sha256,
      manifest.deploy_files.find((record) => record.path === sidecarPath).sha256,
    );
    assert.equal(
      authority.image_sha256,
      manifest.deploy_files.find((record) => record.path === imagePath).sha256,
    );
  }

  const catalog = JSON.parse(await readFile(
    path.join(releaseA, 'assets/scene-presets/index.json'),
    'utf8',
  ));
  const releaseCandidates = JSON.parse(await readFile(
    path.join(releaseA, 'config/scene-release-candidates.json'),
    'utf8',
  ));
  assert.deepEqual(catalog.selected_preset_ids, expectedScenePresetIds);
  assert.deepEqual(releaseCandidates.selected_preset_ids, expectedScenePresetIds);
  assert.equal(catalog.published_preset_indexes.length, expectedScenePresetIds.length);
  for (const presetId of releaseCandidates.selected_preset_ids) {
    for (const relativePath of [
      `assets/scene-presets/${presetId}/v1/index.json`,
      `assets/scene-presets/${presetId}/v1/preset.json`,
      `assets/scene-presets/${presetId}/v1/reference-pack.json`,
      `assets/scene-presets/${presetId}/v1/source-ledger.json`,
      `assets/scene-presets/${presetId}/v1/environment-plate.png`,
      `assets/scene-presets/${presetId}/v1/environment-plate.webp`,
      `assets/scene-presets/${presetId}/v1/lighting-preview.png`,
      `assets/scene-presets/${presetId}/v1/lighting-preview.webp`,
      `prompts/scene-presets/${presetId}/v1/production-scene.txt`,
    ]) {
      assert.ok(
        manifest.deploy_files.some((record) => record.path === relativePath),
        `Missing ${relativePath}`,
      );
    }
  }

  const indexHtml = await readFile(path.join(releaseA, 'web/public/index.html'), 'utf8');
  const appSource = await readFile(path.join(releaseA, 'web/public/app.js'), 'utf8');
  const sceneUiSource = await readFile(path.join(releaseA, 'web/public/scene-ui.js'), 'utf8');
  const editorialUiSource = await readFile(
    path.join(releaseA, 'web/public/editorial-shoot-ui.js'),
    'utf8',
  );
  const editorialStateSource = await readFile(
    path.join(releaseA, 'web/public/editorial-state.js'),
    'utf8',
  );
  const profileClientSource = await readFile(
    path.join(releaseA, 'web/public/profile-client.js'),
    'utf8',
  );
  assert.match(indexHtml, new RegExp(`/scene\\.css\\?v=${manifest.cache_token}`));
  assert.match(indexHtml, new RegExp(`/app\\.js\\?v=${manifest.cache_token}`));
  assert.match(appSource, new RegExp(`\\./scene-ui\\.js\\?v=${manifest.cache_token}`));
  assert.match(sceneUiSource, new RegExp(`\\./scene-state\\.js\\?v=${manifest.cache_token}`));
  assert.match(sceneUiSource, /createEditorialShootUi/);
  assert.match(editorialUiSource, /export function createEditorialShootUi/);
  assert.match(editorialStateSource, /zeely_active_editorial_shoot_v1/);
  assert.match(profileClientSource, /\/api\/profile\/editorial-shoots/);
  assert.match(indexHtml, /id="editorial-shoot"/);
  assert.doesNotMatch(`${indexHtml}\n${appSource}\n${sceneUiSource}`, /scene-ui-disabled/);
  assert.doesNotMatch(
    `${indexHtml}\n${sceneUiSource}\n${editorialUiSource}`,
    /PREVIEW_ONLY|Це mood-board, не кнопки запуску|ще не підключені/,
  );

  await execute(process.execPath, [builder, releaseB]);
  assert.deepEqual(
    await fileInventory(releaseB),
    await fileInventory(releaseA),
    'Identical current-workspace snapshots must produce byte-identical releases',
  );
});

test('product verifier rejects tamper, stale cache, private paths, disabled scenes, missing code/assets and symlinks', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-product-rejection-test-'));
  const releaseDirectory = path.join(temporaryRoot, 'release');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await execute(process.execPath, [builder, releaseDirectory]);
  await verify(releaseDirectory);

  const manifestPath = path.join(releaseDirectory, manifestRelativePath);
  const appPath = path.join(releaseDirectory, 'web/public/app.js');
  const runtimePath = path.join(releaseDirectory, 'src/web/scene-runtime.js');
  const assetPath = path.join(
    releaseDirectory,
    'assets/scene-presets/std.city.golden_hour_gloss/v1/environment-plate.webp',
  );
  const originalManifest = await readFile(manifestPath);
  const originalApp = await readFile(appPath);
  const originalRuntime = await readFile(runtimePath);
  const originalRuntimeMode = (await lstat(runtimePath)).mode & 0o777;
  const originalAsset = await readFile(assetPath);
  const originalAssetMode = (await lstat(assetPath)).mode & 0o777;
  const editorialSidecarPath = path.join(
    releaseDirectory,
    'assets/scene-mood-cards/editorial.edwin_novak.organic_contrast.json',
  );
  const editorialImagePath = path.join(
    releaseDirectory,
    'assets/scene-mood-cards/editorial.edwin_novak.organic_contrast.webp',
  );
  const originalEditorialSidecar = await readFile(editorialSidecarPath);
  const originalEditorialSidecarMode = (await lstat(editorialSidecarPath)).mode & 0o777;
  const originalEditorialImage = await readFile(editorialImagePath);
  const originalEditorialImageMode = (await lstat(editorialImagePath)).mode & 0o777;

  await writeFile(appPath, Buffer.concat([originalApp, Buffer.from('\n// tampered\n')]));
  await assert.rejects(verify(releaseDirectory), /(?:Size|SHA-256) mismatch/);
  await writeFile(appPath, originalApp);

  const originalManifestValue = JSON.parse(originalManifest.toString('utf8'));
  const token = originalManifestValue.cache_token;
  const staleApp = originalApp.toString('utf8').replace(
    `./scene-ui.js?v=${token}`,
    './scene-ui.js?v=stale-release',
  );
  assert.notEqual(staleApp, originalApp.toString('utf8'));
  await writeFile(appPath, staleApp);
  await resealDeployInventory(releaseDirectory);
  await assert.rejects(verify(releaseDirectory), /Stale cache binding/);
  await writeFile(appPath, originalApp);
  await writeFile(manifestPath, originalManifest);
  await chmod(manifestPath, 0o600);

  await writeFile(appPath, Buffer.concat([
    originalApp,
    Buffer.from('\n// /Users/private-user/project/runtime/file.png\n'),
  ]));
  await resealDeployInventory(releaseDirectory);
  await assert.rejects(verify(releaseDirectory), /macOS home path/);
  await writeFile(appPath, originalApp);
  await writeFile(manifestPath, originalManifest);
  await chmod(manifestPath, 0o600);

  const disabledManifest = structuredClone(originalManifestValue);
  disabledManifest.features.scene_ui = 'DISABLED';
  disabledManifest.disabled = ['scene_ui'];
  await writeFile(manifestPath, `${JSON.stringify(disabledManifest, null, 2)}\n`);
  await chmod(manifestPath, 0o600);
  await assert.rejects(
    verify(releaseDirectory),
    /feature is not enabled|disabled feature policy is invalid/,
  );
  await writeFile(manifestPath, originalManifest);
  await chmod(manifestPath, 0o600);

  const falselyDisabledManifest = structuredClone(originalManifestValue);
  falselyDisabledManifest.features.editorial_preview = 'PREVIEW_ONLY';
  falselyDisabledManifest.features.editorial_generation = 'DISABLED';
  falselyDisabledManifest.editorial_preview.status = 'PREVIEW_ONLY';
  falselyDisabledManifest.editorial_preview.generation = 'DISABLED';
  falselyDisabledManifest.disabled = ['editorial_generation'];
  await writeFile(manifestPath, `${JSON.stringify(falselyDisabledManifest, null, 2)}\n`);
  await chmod(manifestPath, 0o600);
  await assert.rejects(
    verify(releaseDirectory),
    /Editorial catalog feature must be ACTIVE|disabled feature policy/,
  );
  await writeFile(manifestPath, originalManifest);
  await chmod(manifestPath, 0o600);

  const overbroadGenerationManifest = structuredClone(originalManifestValue);
  overbroadGenerationManifest.editorial_preview.generation_mode_ids.push(
    'editorial.edwin_novak.institutional_modernism',
  );
  await writeFile(manifestPath, `${JSON.stringify(overbroadGenerationManifest, null, 2)}\n`);
  await chmod(manifestPath, 0o600);
  await assert.rejects(
    verify(releaseDirectory),
    /does not contain every registered generation mode ID/,
  );
  await writeFile(manifestPath, originalManifest);
  await chmod(manifestPath, 0o600);

  const tamperedSidecar = JSON.parse(originalEditorialSidecar.toString('utf8'));
  tamperedSidecar.ui_name_uk = 'Tampered editorial mode';
  await writeFile(editorialSidecarPath, `${JSON.stringify(tamperedSidecar, null, 2)}\n`);
  await resealDeployInventory(releaseDirectory);
  await assert.rejects(
    verify(releaseDirectory),
    /Editorial preview manifest authority is invalid|sidecar contract is invalid|Unexpected source/,
  );
  await writeFile(editorialSidecarPath, originalEditorialSidecar);
  await chmod(editorialSidecarPath, originalEditorialSidecarMode);
  await writeFile(manifestPath, originalManifest);
  await chmod(manifestPath, 0o600);

  const tamperedEditorialImage = Buffer.from(originalEditorialImage);
  tamperedEditorialImage[tamperedEditorialImage.length - 1] ^= 0xff;
  await writeFile(editorialImagePath, tamperedEditorialImage);
  await resealDeployInventory(releaseDirectory);
  await assert.rejects(
    verify(releaseDirectory),
    /Editorial preview manifest authority is invalid|sidecar contract is invalid|SHA-256|Unexpected source/,
  );
  await writeFile(editorialImagePath, originalEditorialImage);
  await chmod(editorialImagePath, originalEditorialImageMode);
  await writeFile(manifestPath, originalManifest);
  await chmod(manifestPath, 0o600);

  await unlink(editorialSidecarPath);
  await assert.rejects(verify(releaseDirectory), /file set does not match/);
  await writeFile(editorialSidecarPath, originalEditorialSidecar);
  await chmod(editorialSidecarPath, originalEditorialSidecarMode);

  await unlink(runtimePath);
  await assert.rejects(verify(releaseDirectory), /file set does not match/);
  await writeFile(runtimePath, originalRuntime);
  await chmod(runtimePath, originalRuntimeMode);

  await unlink(assetPath);
  await assert.rejects(verify(releaseDirectory), /file set does not match/);
  await writeFile(assetPath, originalAsset);
  await chmod(assetPath, originalAssetMode);

  const linkPath = path.join(releaseDirectory, 'web/public/release-test-link.js');
  await symlink('app.js', linkPath);
  await assert.rejects(verify(releaseDirectory), /contains a symlink/);
  await unlink(linkPath);

  await verify(releaseDirectory);
});
