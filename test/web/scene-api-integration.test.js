import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createWebApp } from '../../src/web/app.js';
import { ProfileService } from '../../src/web/profile-service.js';
import {
  SCENE_EVALUATOR_GATES,
  canonicalJsonBytes,
  sha256,
} from '../../src/web/scene-contract.js';
import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';

const PUBLISHED_PRESET_IDS = [
  'std.architecture.glass_corridor_sunset',
  'std.city.amber_alley_cobblestone',
  'std.city.golden_hour_gloss',
  'std.city.night_neon_wet_asphalt',
  'std.city.rooftop_concrete_sunset',
  'std.interior.abandoned_palace_light_shaft',
  'std.interior.gallery_morning_gloss',
  'std.interior.industrial_brick_loft',
  'std.interior.sheer_curtain_golden_light',
  'std.nature.foggy_forest_light_shaft',
  'std.nature.ocean_dusk_blue_hour',
  'std.nature_architecture.concrete_grass_golden_hour',
  'std.studio.black_spotlight_low_key',
  'std.studio.taupe_rembrandt_gloss',
  'std.studio.terracotta_raking_light',
  'std.studio.white_window_honeycomb',
];

const PRESET_ID = 'std.city.golden_hour_gloss';
const PRESET_VERSION = '1.0.0';

function responseCookies(response) {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

function cookiePair(response, name = '__Host-zeely_profile') {
  const cookie = responseCookies(response).find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `response must set ${name}`);
  return cookie.split(';')[0];
}

async function png(color, width = 512, height = 640) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  }).png().toBuffer();
}

async function createPreviewResolverFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-scene-preview-'));
  const presetId = 'std.fixture.preview';
  const presetVersion = '1.0.0';
  const rootDirectory = path.join(root, 'assets', 'scene-presets');
  const directory = path.join(rootDirectory, presetId, 'v1');
  const assetPath = path.join(directory, 'environment-plate.webp');
  const provenancePath = path.join(directory, 'candidate-provenance.json');
  const relativeAssetPath = `assets/scene-presets/${presetId}/v1/environment-plate.webp`;
  const data = await sharp({
    create: {
      width: 64,
      height: 80,
      channels: 3,
      background: '#d7c0a5',
    },
  }).webp().toBuffer();
  const provenance = {
    schema_version: '1.0.0',
    preset_id: presetId,
    preset_version: presetVersion,
    assets: [{
      role: 'environment_plate',
      path: relativeAssetPath,
      sha256: sha256(data),
    }],
  };
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(rootDirectory, 'index.json'), JSON.stringify({
      presets: [{ preset_id: presetId, preset_version: presetVersion }],
    })),
    writeFile(assetPath, data),
    writeFile(provenancePath, JSON.stringify(provenance)),
  ]);
  const resolver = new FilesystemScenePresetResolver({ rootDirectory, projectRoot: root });
  await resolver.initialize();
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    presetId,
    presetVersion,
    directory,
    assetPath,
    provenancePath,
    relativeAssetPath,
    data,
    provenance,
    resolver,
  };
}

function evaluation(shouldPass) {
  return {
    gates: SCENE_EVALUATOR_GATES.map((id) => ({
      id,
      decision: !shouldPass && id === 'IDENTITY' ? 'FAIL' : 'PASS',
      evidence: !shouldPass && id === 'IDENTITY' ? 'Identity needs repair' : `${id} verified`,
      defects: !shouldPass && id === 'IDENTITY' ? ['IDENTITY_DRIFT'] : [],
    })),
    score: shouldPass ? 100 : 70,
    summary: shouldPass ? 'All visual gates pass' : 'Identity repair required',
    reviewer: {
      type: 'MODEL',
      id: 'fixture-scene-judge',
      version: 'fixture-judge-2026-07-23',
      request_id: `review-${Math.random().toString(16).slice(2)}`,
    },
    framing_evidence: {
      subject_bbox_xywh_px: [300, 180, 930, 1460],
      full_head_visible: true,
      full_footwear_visible: true,
    },
  };
}

async function createFixture(t, { initialQaPass = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-scene-api-'));
  const runRoot = path.join(root, 'runs');
  const sceneRoot = path.join(root, 'scenes');
  const databasePath = path.join(root, 'profiles.sqlite');
  await Promise.all([
    mkdir(runRoot, { recursive: true }),
    mkdir(sceneRoot, { recursive: true }),
  ]);

  const runs = new Map();
  const calls = { generator: 0, evaluator: 0, deleteRun: 0 };
  const qa = { pass: initialQaPass };
  const generated = await png('#c79782', 960, 1280);

  async function addCompletedRun(runId) {
    const directory = path.join(runRoot, runId);
    await mkdir(directory, { recursive: true });
    const avatar = await png('#e9dfd0');
    const look = await png('#315543');
    const manifest = {
      job_id: `web-${runId}`,
      state: 'COMPLETED',
      outputs: {
        avatar: { sha256: sha256(avatar) },
        avatar_outfit: { sha256: sha256(look) },
      },
      qa: {
        avatar: { decision: 'PASS' },
        outfit: { decision: 'PASS' },
      },
    };
    await Promise.all([
      writeFile(path.join(directory, 'avatar.png'), avatar),
      writeFile(path.join(directory, 'avatar_outfit.png'), look),
      writeFile(path.join(directory, 'run-manifest.json'), canonicalJsonBytes(manifest)),
    ]);
    runs.set(runId, { run_id: runId, status: 'COMPLETED', phase: 'COMPLETED' });
    return { directory, avatar, look, manifest };
  }

  const runService = {
    async createRun(input) {
      const runId = input.runId ?? 'new-core-run';
      const run = { run_id: runId, status: 'QUEUED', phase: 'UPLOADED' };
      runs.set(runId, run);
      return run;
    },
    async getRun(runId) {
      return runs.get(runId) ?? null;
    },
    async outputFile(runId, filename) {
      if (!runs.has(runId)
        || !['avatar.png', 'avatar_outfit.png', 'run-manifest.json', 'art_director_scene.png'].includes(filename)) {
        return null;
      }
      const candidate = path.join(runRoot, runId, filename);
      try {
        await readFile(candidate);
        return candidate;
      } catch {
        return null;
      }
    },
    async deleteRun(runId) {
      calls.deleteRun += 1;
      runs.delete(runId);
      await rm(path.join(runRoot, runId), { recursive: true, force: true });
      return true;
    },
    subscribe() {
      return () => {};
    },
    async retry() {
      return null;
    },
    async selectGarments() {
      return null;
    },
    async garmentSourceFile() {
      return null;
    },
  };

  const resolverOptions = {
    rootDirectory: path.resolve('assets/scene-presets'),
    projectRoot: path.resolve('.'),
  };
  const productionResolver = new FilesystemScenePresetResolver(resolverOptions);
  await productionResolver.initialize();
  const authoredReference = await productionResolver.presetReference({
    presetId: PRESET_ID,
    presetVersion: PRESET_VERSION,
  });
  const authoredPack = await productionResolver.resolveScenePreset(authoredReference);
  const {
    schema_version: _authoredSchemaVersion,
    production_prompt_path: _authoredProductionPromptPath,
    ...executionPreset
  } = authoredPack.preset;
  const executionPresetBytes = canonicalJsonBytes(executionPreset);
  const executionReferencePack = {
    ...authoredPack.reference_pack,
    preset_sha256: sha256(executionPresetBytes),
  };
  const executionReferencePackBytes = canonicalJsonBytes(executionReferencePack);
  const executionReference = {
    preset_id: PRESET_ID,
    preset_version: PRESET_VERSION,
    preset_sha256: sha256(executionPresetBytes),
    reference_pack_id: executionReferencePack.reference_pack_id,
    reference_pack_version: executionReferencePack.version,
    reference_pack_sha256: sha256(executionReferencePackBytes),
    prompt_sha256: sha256(authoredPack.prompt),
  };
  const executionResolver = {
    async initialize() {},
    async listPresets() {
      const catalog = await productionResolver.listPresets();
      return catalog.map((item) => item.preset_id === PRESET_ID
        ? { ...item, ...executionReference }
        : item);
    },
    async environmentPlatePreview(input) {
      return productionResolver.environmentPlatePreview(input);
    },
    async presetReference({ presetId, presetVersion }) {
      if (presetId !== PRESET_ID || presetVersion !== PRESET_VERSION) {
        const error = new Error('Fixture preset is unavailable');
        error.statusCode = 404;
        throw error;
      }
      return executionReference;
    },
    async resolveScenePreset(reference) {
      for (const [key, value] of Object.entries(executionReference)) {
        if (reference[key] !== value) throw new Error(`Fixture preset ${key} mismatch`);
      }
      return {
        preset: executionPreset,
        preset_bytes: executionPresetBytes,
        prompt: authoredPack.prompt,
        reference_pack: executionReferencePack,
        reference_pack_bytes: executionReferencePackBytes,
        assets: authoredPack.assets,
      };
    },
  };
  const appResources = [];

  async function openApp() {
    const profiles = new ProfileService({ databasePath });
    const app = await createWebApp({
      service: runService,
      profiles,
      sceneDependencies: {
        rootDirectory: sceneRoot,
        presetResolver: executionResolver,
        generator: {
          async generateScene(context) {
            calls.generator += 1;
            return {
              image: generated,
              media_type: 'image/png',
              metadata: {
                provider: 'fixture',
                provider_request_id: `generation-${calls.generator}`,
                request_id: context.idempotency_key,
                job_id: `generation-${calls.generator}`,
                model: context.model,
                model_version: context.model_version,
                job_set_type: context.job_set_type,
                quality: context.quality,
                source_width: 960,
                source_height: 1280,
                source_aspect_ratio: '3:4',
                raw_output_sha256: sha256(generated),
                geometry_output_sha256: sha256(generated),
                transport_aspect_ratio: '3:4',
                geometry_strategy: 'provider_exact_3_4',
              },
            };
          },
        },
        evaluator: {
          async evaluateScene() {
            calls.evaluator += 1;
            return evaluation(qa.pass);
          },
        },
      },
    });
    const resource = { app, profiles, closed: false };
    appResources.push(resource);
    return resource;
  }

  async function close(resource) {
    if (resource.closed) return;
    resource.closed = true;
    await resource.app.close();
    resource.profiles.close();
  }

  async function saveRunAsLook(app, runId) {
    const profile = await app.inject({ method: 'GET', url: '/api/profile' });
    const cookie = cookiePair(profile);
    const claim = await app.inject({
      method: 'POST',
      url: `/api/profile/runs/${runId}/claim`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { source_avatar_id: null },
    });
    assert.equal(claim.statusCode, 201, claim.body);
    const saved = await app.inject({
      method: 'POST',
      url: `/api/profile/runs/${runId}/save`,
      headers: { cookie },
    });
    assert.equal(saved.statusCode, 201, saved.body);
    return {
      cookie,
      profileId: profile.json().profile_id,
      lookId: saved.json().look.look_id,
      avatarId: saved.json().avatar.avatar_id,
    };
  }

  async function createScene(app, owner, key = 'scene-create-owner-0001') {
    return app.inject({
      method: 'POST',
      url: `/api/profile/looks/${owner.lookId}/scenes`,
      headers: {
        cookie: owner.cookie,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      payload: { preset_id: PRESET_ID, preset_version: PRESET_VERSION },
    });
  }

  async function settle(app, sceneId) {
    const running = app.sceneService.running.get(sceneId);
    if (running) await running;
    return app.sceneService.getScene(sceneId);
  }

  t.after(async () => {
    for (const resource of appResources.reverse()) {
      await close(resource);
    }
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    sceneRoot,
    calls,
    qa,
    runService,
    addCompletedRun,
    openApp,
    close,
    saveRunAsLook,
    createScene,
    settle,
  };
}

test('filesystem resolver verifies and exposes every beta-published production pack without private paths', async () => {
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.resolve('assets/scene-presets'),
    projectRoot: path.resolve('.'),
  });
  await resolver.initialize();
  const presets = await resolver.listPresets();
  assert.equal(presets.length, PUBLISHED_PRESET_IDS.length);
  assert.deepEqual(
    new Set(presets.map((item) => item.preset_id)),
    new Set(PUBLISHED_PRESET_IDS),
  );
  assert.equal(new Set(presets.map((item) => item.preview_url)).size, PUBLISHED_PRESET_IDS.length);
  for (const preset of presets) {
    assert.match(
      preset.preview_url,
      new RegExp(`^/api/scene-presets/${encodeURIComponent(preset.preset_id)}/${encodeURIComponent(preset.preset_version)}/preview\\?v=[a-f0-9]{64}$`),
    );
  }
  assert.doesNotMatch(JSON.stringify(presets), /Users\/|production_prompt_path|reference_pack_path/);
});

test('published scene preset previews are exact private-path-safe still WebPs with immutable ETags', async (t) => {
  const fixture = await createFixture(t);
  const resource = await fixture.openApp();
  const catalogResponse = await resource.app.inject({
    method: 'GET',
    url: '/api/scene-presets',
  });
  assert.equal(catalogResponse.statusCode, 200, catalogResponse.body);
  assert.equal(catalogResponse.headers['cache-control'], 'private, no-store');
  assert.doesNotMatch(catalogResponse.body, /Users\/|file:\/\/|\.local\/share|candidate-provenance/);

  const presets = catalogResponse.json().presets;
  assert.equal(presets.length, PUBLISHED_PRESET_IDS.length);
  assert.equal(new Set(presets.map((preset) => preset.preview_url)).size, PUBLISHED_PRESET_IDS.length);
  for (const preset of presets) {
    assert.match(preset.preview_url, /^\/api\/scene-presets\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/preview\?v=[a-f0-9]{64}$/);
    const provenance = JSON.parse(await readFile(path.join(
      'assets',
      'scene-presets',
      preset.preset_id,
      'v1',
      'candidate-provenance.json',
    )));
    const expected = provenance.assets.find((asset) => asset.role === 'environment_plate');
    assert.ok(expected);

    const preview = await resource.app.inject({
      method: 'GET',
      url: preset.preview_url,
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.headers['content-type'], 'image/webp');
    assert.equal(preview.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(preview.headers.etag, `"${expected.sha256}"`);
    assert.equal(
      preset.preview_url,
      `/api/scene-presets/${encodeURIComponent(preset.preset_id)}/${encodeURIComponent(preset.preset_version)}/preview?v=${expected.sha256}`,
    );
    assert.equal(preview.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(preview.headers['x-content-type-options'], 'nosniff');
    assert.equal(preview.headers['set-cookie'], undefined);
    assert.equal(preview.headers.vary, undefined);
    assert.equal(sha256(preview.rawPayload), expected.sha256);
    const metadata = await sharp(preview.rawPayload).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.pages ?? 1, 1);
    assert.ok(metadata.width && metadata.height);

    const cached = await resource.app.inject({
      method: 'GET',
      url: preset.preview_url,
      headers: { 'if-none-match': preview.headers.etag },
    });
    assert.equal(cached.statusCode, 304, cached.body);
    assert.equal(cached.rawPayload.length, 0);
    assert.equal(cached.headers.etag, preview.headers.etag);
    assert.equal(cached.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(cached.headers['cross-origin-resource-policy'], 'same-origin');
  }

  for (const url of [
    '/api/scene-presets/not%24an%24id/1.0.0/preview',
    '/api/scene-presets/std.city.golden_hour_gloss/not%24a%24version/preview',
    '/api/scene-presets/std.unknown.preset/1.0.0/preview',
    '/api/scene-presets/std.city.golden_hour_gloss/2.0.0/preview',
  ]) {
    const response = await resource.app.inject({ method: 'GET', url });
    assert.ok([404, 422].includes(response.statusCode), response.body);
    assert.doesNotMatch(response.body, /Users\/|file:\/\/|\.local\/share|assets\/scene-presets/);
  }
});

test('environment preview resolver fails closed on path, hash, image and symlink violations', async (t) => {
  const fixture = await createPreviewResolverFixture(t);
  const input = {
    presetId: fixture.presetId,
    presetVersion: fixture.presetVersion,
  };
  const resolved = await fixture.resolver.environmentPlatePreview(input);
  assert.equal(resolved.media_type, 'image/webp');
  assert.equal(resolved.sha256, sha256(fixture.data));
  assert.deepEqual(resolved.data, fixture.data);

  async function rejectsPrivately(expectedMessage) {
    await assert.rejects(
      fixture.resolver.environmentPlatePreview(input),
      (error) => {
        assert.equal(error.statusCode, 422);
        assert.match(error.message, expectedMessage);
        assert.doesNotMatch(
          error.message,
          /Users\/|file:\/\/|\.local\/share|zeely-scene-preview-|assets\/scene-presets/,
        );
        return true;
      },
    );
  }

  await writeFile(fixture.provenancePath, JSON.stringify({
    ...fixture.provenance,
    assets: [{
      ...fixture.provenance.assets[0],
      path: `assets/scene-presets/${fixture.presetId}/v1/other.webp`,
    }],
  }));
  await rejectsPrivately(/fixed published path/);

  await writeFile(fixture.provenancePath, JSON.stringify({
    ...fixture.provenance,
    assets: [{ ...fixture.provenance.assets[0], sha256: '0'.repeat(64) }],
  }));
  await rejectsPrivately(/SHA-256 mismatch/);

  const invalidImage = Buffer.from('not a WebP image');
  await Promise.all([
    writeFile(fixture.assetPath, invalidImage),
    writeFile(fixture.provenancePath, JSON.stringify({
      ...fixture.provenance,
      assets: [{ ...fixture.provenance.assets[0], sha256: sha256(invalidImage) }],
    })),
  ]);
  await rejectsPrivately(/not a decodable WebP image/);

  const symlinkTarget = path.join(fixture.directory, 'environment-plate-target.webp');
  await Promise.all([
    writeFile(symlinkTarget, fixture.data),
    writeFile(fixture.provenancePath, JSON.stringify(fixture.provenance)),
  ]);
  await rm(fixture.assetPath);
  await symlink(path.basename(symlinkTarget), fixture.assetPath);
  await rejectsPrivately(/regular non-symlink file/);
});

test('profile scene survives reload/restart with private ownership and exact download', async (t) => {
  const fixture = await createFixture(t);
  await fixture.addCompletedRun('completed-look-run');
  const first = await fixture.openApp();

  const catalog = await first.app.inject({ method: 'GET', url: '/api/scene-presets' });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.equal(catalog.json().presets.length, PUBLISHED_PRESET_IDS.length);
  assert.doesNotMatch(catalog.body, /Users\/|production_prompt_path|reference_pack_path/);

  const owner = await fixture.saveRunAsLook(first.app, 'completed-look-run');
  const created = await fixture.createScene(first.app, owner);
  assert.equal(created.statusCode, 202, created.body);
  const sceneId = created.json().scene_id;
  const completed = await fixture.settle(first.app, sceneId);
  const persistedAfterCreate = JSON.parse(await readFile(
    path.join(fixture.sceneRoot, sceneId, 'scene.json'),
    'utf8',
  ));
  assert.equal(completed.status, 'COMPLETED', JSON.stringify({
    completed,
    attempt: persistedAfterCreate.attempts.at(-1),
  }));

  const status = await first.app.inject({
    method: 'GET',
    url: `/api/profile/scenes/${sceneId}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().output.image_url, `/api/profile/scenes/${sceneId}/image`);
  assert.equal(status.json().output.download_url, `/api/profile/scenes/${sceneId}/download`);
  assert.doesNotMatch(status.body, /\/api\/scenes\//);

  const profileAfterReload = await first.app.inject({
    method: 'GET',
    url: '/api/profile',
    headers: { cookie: owner.cookie },
  });
  assert.equal(profileAfterReload.json().looks[0].scenes[0].scene_id, sceneId);
  assert.equal(profileAfterReload.json().looks[0].scenes[0].status, 'COMPLETED');

  const output = await first.app.inject({
    method: 'GET',
    url: `/api/profile/scenes/${sceneId}/download`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(output.statusCode, 200, output.body);
  assert.match(output.headers['content-disposition'], /^attachment/);
  assert.equal(sha256(output.rawPayload), completed.output.sha256);

  const events = await first.app.inject({
    method: 'GET',
    url: `/api/profile/scenes/${sceneId}/events`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(events.statusCode, 200, events.body);
  assert.match(events.body, /event: scene/);
  assert.match(events.body, /"status":"COMPLETED"/);

  const foreignProfile = await first.app.inject({ method: 'GET', url: '/api/profile' });
  const foreignCookie = cookiePair(foreignProfile);
  const providerCallsBeforeForeignCreate = fixture.calls.generator;
  const foreignCreate = await first.app.inject({
    method: 'POST',
    url: `/api/profile/looks/${owner.lookId}/scenes`,
    headers: {
      cookie: foreignCookie,
      'content-type': 'application/json',
      'idempotency-key': 'scene-create-foreign-0001',
    },
    payload: { preset_id: PRESET_ID, preset_version: PRESET_VERSION },
  });
  assert.equal(foreignCreate.statusCode, 404, foreignCreate.body);
  assert.equal(fixture.calls.generator, providerCallsBeforeForeignCreate);
  for (const request of [
    { method: 'GET', url: `/api/profile/looks/${owner.lookId}/scenes` },
    { method: 'GET', url: `/api/profile/scenes/${sceneId}` },
    { method: 'GET', url: `/api/profile/scenes/${sceneId}/events` },
    { method: 'GET', url: `/api/profile/scenes/${sceneId}/image` },
    { method: 'GET', url: `/api/profile/scenes/${sceneId}/download` },
    { method: 'DELETE', url: `/api/profile/scenes/${sceneId}` },
  ]) {
    const response = await first.app.inject({ ...request, headers: { cookie: foreignCookie } });
    assert.equal(response.statusCode, 404, `${request.method} ${request.url}: ${response.body}`);
  }

  await fixture.close(first);
  const restarted = await fixture.openApp();
  const afterRestart = await restarted.app.inject({
    method: 'GET',
    url: `/api/profile/scenes/${sceneId}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(afterRestart.statusCode, 200, afterRestart.body);
  assert.equal(afterRestart.json().status, 'COMPLETED');

  const deleted = await restarted.app.inject({
    method: 'DELETE',
    url: `/api/profile/scenes/${sceneId}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(deleted.statusCode, 204, deleted.body);
  assert.equal(await restarted.app.sceneService.getScene(sceneId), null);
  const afterDelete = await restarted.app.inject({
    method: 'GET',
    url: `/api/profile/scenes/${sceneId}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(afterDelete.statusCode, 404, afterDelete.body);
});

test('failed scene retries independently and exact saved-look tampering blocks provider work', async (t) => {
  const fixture = await createFixture(t, { initialQaPass: false });
  const source = await fixture.addCompletedRun('retry-look-run');
  const current = await fixture.openApp();
  const owner = await fixture.saveRunAsLook(current.app, 'retry-look-run');

  const created = await fixture.createScene(current.app, owner, 'scene-create-retry-0001');
  assert.equal(created.statusCode, 202, created.body);
  const sceneId = created.json().scene_id;
  const failed = await fixture.settle(current.app, sceneId);
  assert.equal(failed.status, 'FAILED', JSON.stringify(failed));
  assert.equal(fixture.calls.generator, 3);

  fixture.qa.pass = true;
  const retried = await current.app.inject({
    method: 'POST',
    url: `/api/profile/scenes/${sceneId}/retry`,
    headers: { cookie: owner.cookie, 'idempotency-key': 'scene-retry-owner-0001' },
  });
  assert.equal(retried.statusCode, 202, retried.body);
  const completed = await fixture.settle(current.app, sceneId);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed));
  assert.equal(completed.execution.manual_retries, 1);
  assert.equal(fixture.calls.generator, 4);

  const generatorCallsBeforeTamper = fixture.calls.generator;
  await writeFile(path.join(source.directory, 'avatar_outfit.png'), await png('#ff0000'));
  const blocked = await fixture.createScene(current.app, owner, 'scene-create-tampered-0001');
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.match(blocked.json().error, /receipt|PASS/i);
  assert.equal(fixture.calls.generator, generatorCallsBeforeTamper);
});

test('deleting a parent look cascades its scene execution and source run through the typed cleanup queue', async (t) => {
  const fixture = await createFixture(t);
  await fixture.addCompletedRun('cascade-look-run');
  const current = await fixture.openApp();
  const owner = await fixture.saveRunAsLook(current.app, 'cascade-look-run');
  const created = await fixture.createScene(current.app, owner, 'scene-create-cascade-0001');
  assert.equal(created.statusCode, 202, created.body);
  const sceneId = created.json().scene_id;
  assert.equal((await fixture.settle(current.app, sceneId)).status, 'COMPLETED');

  const deleted = await current.app.inject({
    method: 'DELETE',
    url: `/api/profile/looks/${owner.lookId}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(deleted.statusCode, 204, deleted.body);
  assert.equal(await current.app.sceneService.getScene(sceneId), null);
  assert.ok(await fixture.runService.getRun('cascade-look-run'), 'shared avatar bytes must remain after look deletion');
  assert.deepEqual(current.profiles.pendingResourceDeletions(), []);

  const profile = await current.app.inject({
    method: 'GET',
    url: '/api/profile',
    headers: { cookie: owner.cookie },
  });
  assert.deepEqual(profile.json().looks, []);
  assert.deepEqual(profile.json().scenes, []);

  const deletedAvatar = await current.app.inject({
    method: 'DELETE',
    url: `/api/profile/avatars/${owner.avatarId}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(deletedAvatar.statusCode, 204, deletedAvatar.body);
  assert.equal(await fixture.runService.getRun('cascade-look-run'), null);
});
