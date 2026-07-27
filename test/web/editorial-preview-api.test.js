import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import { registerSceneRoutes } from '../../src/web/scene-routes.js';
import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';

const EXPECTED_SHOT_SEQUENCE = [
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function productionResolver() {
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.resolve('assets/scene-presets'),
    projectRoot: path.resolve('.'),
  });
  await resolver.initialize();
  return resolver;
}

async function routeFixture(t) {
  const app = Fastify({ logger: false });
  const presetResolver = await productionResolver();
  await registerSceneRoutes(app, {
    sceneService: {},
    profiles: {
      sceneProjectionRecords() {
        return [];
      },
      async flushDeletionQueue() {},
    },
    profileApi: {},
    runService: {},
    presetResolver,
  });
  await app.ready();
  t.after(() => app.close());
  return app;
}

test('editorial catalog activates legacy modes and eight integrity-ready Create Universe modes', async (t) => {
  const app = await routeFixture(t);
  const catalogResponse = await app.inject({
    method: 'GET',
    url: '/api/editorial-modes',
  });
  assert.equal(catalogResponse.statusCode, 200, catalogResponse.body);
  assert.equal(catalogResponse.headers['cache-control'], 'private, no-store');
  assert.deepEqual(Object.keys(catalogResponse.json()).sort(), [
    'generation_available',
    'generation_mode_ids',
    'modes',
    'shot_sequence',
    'status',
  ]);
  const catalog = catalogResponse.json();
  assert.equal(catalog.status, 'ACTIVE');
  assert.equal(catalog.generation_available, true);
  assert.deepEqual(catalog.generation_mode_ids, [
    'editorial.edwin_novak.organic_contrast',
    'editorial.edwin_novak.urban_monochrome',
    'shoot.skylight_haze',
    'shoot.terracotta_hardlight',
    'shoot.window_gobo_warm',
    'shoot.grey_studio_stride',
    'shoot.sky_dune_surreal',
    'shoot.hardsun_brick_doorway',
    'shoot.overcast_street_stride',
    'shoot.grey_wall_gloss',
  ]);
  assert.deepEqual(catalog.shot_sequence, EXPECTED_SHOT_SEQUENCE);
  assert.equal(catalog.modes.length, 12);
  assert.doesNotMatch(
    catalogResponse.body,
    /edwinnovak\.com|"sources?"|"source_(?:url|path)"|prompt|provider|model_|\/Users\/|file:\/\/|\.local\/share|assets\//i,
  );

  for (const mode of catalog.modes) {
    assert.deepEqual(Object.keys(mode).sort(), [
      'generation_available',
      'mode_id',
      'mode_version',
      'preview_url',
      'source_set_status',
      'ui_name_uk',
      'version',
      'visual_system',
    ]);
    assert.equal(mode.mode_version, mode.version);
    assert.equal(
      mode.generation_available,
      catalog.generation_mode_ids.includes(mode.mode_id),
    );
    assert.match(
      mode.preview_url,
      new RegExp(`^/api/editorial-modes/${encodeURIComponent(mode.mode_id)}/${encodeURIComponent(mode.version)}/preview\\?v=[a-f0-9]{64}$`),
    );

    const preview = await app.inject({
      method: 'GET',
      url: mode.preview_url,
    });
    assert.equal(preview.statusCode, 200, preview.body);
    // A Create Universe mode falls back to its own reference sheet (PNG) only
    // while it has no delivered mood card. Once a card exists the preview must
    // be that card, because a technical contact sheet is not a shoot preview.
    const createUniverse = mode.mode_id.startsWith('shoot.');
    const moodCard = path.join(
      path.resolve('.'),
      'assets',
      'scene-mood-cards',
      `${mode.mode_id}.webp`,
    );
    const hasMoodCard = await access(moodCard).then(() => true, () => false);
    assert.equal(
      preview.headers['content-type'],
      createUniverse && !hasMoodCard ? 'image/png' : 'image/webp',
      `${mode.mode_id} (mood card present: ${hasMoodCard})`,
    );
    assert.equal(preview.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(preview.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(preview.headers['x-content-type-options'], 'nosniff');
    assert.equal(preview.headers['set-cookie'], undefined);
    assert.equal(preview.headers.vary, undefined);
    assert.equal(preview.headers.etag, `"${sha256(preview.rawPayload)}"`);
    assert.equal(
      mode.preview_url,
      `/api/editorial-modes/${encodeURIComponent(mode.mode_id)}/${encodeURIComponent(mode.version)}/preview?v=${sha256(preview.rawPayload)}`,
    );
    const metadata = await sharp(preview.rawPayload).metadata();
    // Sheet fallback stays a PNG at the sheet's own size; a mood card is always
    // the locked 1024x1280 4:5 WebP, whichever family the mode belongs to.
    const sheetFallback = createUniverse && !hasMoodCard;
    assert.equal(metadata.format, sheetFallback ? 'png' : 'webp');
    if (!sheetFallback) {
      assert.equal(metadata.width, 1024);
      assert.equal(metadata.height, 1280);
    }
    assert.equal(metadata.pages ?? 1, 1);

    const cached = await app.inject({
      method: 'GET',
      url: mode.preview_url,
      headers: { 'if-none-match': `W/${preview.headers.etag}` },
    });
    assert.equal(cached.statusCode, 304, cached.body);
    assert.equal(cached.rawPayload.length, 0);
    assert.equal(cached.headers.etag, preview.headers.etag);
    assert.equal(cached.headers['cache-control'], 'public, max-age=31536000, immutable');
  }
});

async function temporaryEditorialFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'editorial-preview-'));
  const sceneRoot = path.join(root, 'assets', 'scene-presets');
  const moodRoot = path.join(root, 'assets', 'scene-mood-cards');
  const configRoot = path.join(root, 'config');
  const modeId = 'editorial.fixture.mode';
  const version = '1.0.0';
  const assetPath = path.join(moodRoot, `${modeId}.webp`);
  const sidecarPath = path.join(moodRoot, `${modeId}.json`);
  const data = await sharp({
    create: {
      width: 1024,
      height: 1280,
      channels: 3,
      background: '#78907f',
    },
  }).webp().toBuffer();
  const mode = {
    preset_id: modeId,
    version,
    ui_name_uk: 'Тестовий режим',
    visual_system: 'One exact fixture visual system.',
    source_set_status: 'READY',
  };
  const sidecar = {
    schema_version: '1.0.0',
    preset_id: modeId,
    kind: 'editorial',
    family: 'fixture',
    ui_name_uk: mode.ui_name_uk,
    asset_role: 'mood_card',
    file: `assets/scene-mood-cards/${modeId}.webp`,
    sha256: sha256(data),
    delivery: {
      width: 1024,
      height: 1280,
      format: 'webp',
      aspect_ratio: '4:5',
    },
  };
  await Promise.all([
    mkdir(sceneRoot, { recursive: true }),
    mkdir(moodRoot, { recursive: true }),
    mkdir(configRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(sceneRoot, 'index.json'), JSON.stringify({ presets: [] })),
    writeFile(path.join(configRoot, 'scene-presets.json'), JSON.stringify({
      editorial_program: {
        modes: [mode],
        shot_sequence: EXPECTED_SHOT_SEQUENCE,
      },
    })),
    writeFile(assetPath, data),
    writeFile(sidecarPath, JSON.stringify(sidecar)),
  ]);
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: sceneRoot,
    projectRoot: root,
  });
  await resolver.initialize();
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    resolver,
    modeId,
    version,
    moodRoot,
    assetPath,
    sidecarPath,
    data,
    sidecar,
  };
}

test('editorial preview resolver fails closed on sidecar, hash, geometry and symlink violations', async (t) => {
  const fixture = await temporaryEditorialFixture(t);
  const input = { modeId: fixture.modeId, version: fixture.version };
  const valid = await fixture.resolver.editorialModePreview(input);
  assert.equal(valid.kind, 'editorial');
  assert.equal(valid.role, 'mood_card');
  assert.equal(valid.sha256, sha256(fixture.data));
  assert.deepEqual(valid.delivery, {
    width: 1024,
    height: 1280,
    format: 'webp',
    aspect_ratio: '4:5',
  });

  async function rejectsPrivately(expectedMessage) {
    await assert.rejects(
      fixture.resolver.editorialModePreview(input),
      (error) => {
        assert.equal(error.statusCode, 422);
        assert.match(error.message, expectedMessage);
        assert.doesNotMatch(
          error.message,
          /Users\/|file:\/\/|\.local\/share|editorial-preview-|assets\/scene-mood-cards/,
        );
        return true;
      },
    );
  }

  await writeFile(fixture.sidecarPath, JSON.stringify({
    ...fixture.sidecar,
    file: '../private.webp',
  }));
  await rejectsPrivately(/sidecar does not match/);

  await writeFile(fixture.sidecarPath, JSON.stringify({
    ...fixture.sidecar,
    sha256: '0'.repeat(64),
  }));
  await rejectsPrivately(/SHA-256 mismatch/);

  const wrongGeometry = await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 3,
      background: '#78907f',
    },
  }).webp().toBuffer();
  await Promise.all([
    writeFile(fixture.assetPath, wrongGeometry),
    writeFile(fixture.sidecarPath, JSON.stringify({
      ...fixture.sidecar,
      sha256: sha256(wrongGeometry),
    })),
  ]);
  await rejectsPrivately(/1024x1280 WebP/);

  const symlinkTarget = path.join(fixture.moodRoot, 'target.webp');
  await Promise.all([
    writeFile(symlinkTarget, fixture.data),
    writeFile(fixture.sidecarPath, JSON.stringify(fixture.sidecar)),
  ]);
  await rm(fixture.assetPath);
  await symlink(path.basename(symlinkTarget), fixture.assetPath);
  await rejectsPrivately(/regular non-symlink file/);
});
