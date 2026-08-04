import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { createWebApp } from '../../src/web/app.js';
import { GarmentConditioner } from '../../src/web/garment-conditioner.js';
import { ProfileService } from '../../src/web/profile-service.js';
import { RunService } from '../../src/web/run-service.js';
import {
  prepareVisualCheckpoint,
  publicVisualCheckpoint,
  readVisualAsset,
  resetVisualState,
} from '../../src/web/run-visualizer.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function image(color = '#275b36') {
  return sharp({
    create: {
      width: 360,
      height: 480,
      channels: 3,
      background: color,
    },
  }).png().toBuffer();
}

async function upload(color) {
  return {
    filename: 'input.png',
    mimetype: 'image/png',
    buffer: await image(color),
  };
}

async function canonical() {
  return sharp({
    create: {
      width: 512,
      height: 640,
      channels: 3,
      background: '#ffffff',
    },
  }).composite([{
    input: Buffer.from('<svg width="220" height="360"><rect width="220" height="360" rx="30" fill="#275b36"/></svg>'),
    left: 146,
    top: 140,
  }]).png().toBuffer();
}

function dependencies() {
  return {
    provider: new MockProvider(),
    vlm: {
      inspectGarments: async () => ({
        status: 'READY',
        reason: 'clear item',
        items: [{
          source_index: 0,
          category: 'top',
          confidence: 0.95,
          observed: {
            garment_type: 'forest green hoodie',
            colors: ['forest green'],
            material: ['fleece'],
            pattern: [],
            logo_text: [],
            construction: ['hood', 'long sleeves'],
          },
          unknowns: [],
          blockers: [],
        }],
      }),
      evaluateQa: async () => ({
        decision: 'PASS',
        reason: 'visible evidence matches',
        checks: [{ name: 'FIDELITY', pass: true, evidence: 'same visible item' }],
        defects: [],
      }),
    },
    assetGenerator: {
      generateGarment: async () => ({ image: await canonical(), metadata: { provider: 'mock' } }),
      generateScene: async () => ({ image: await canonical(), metadata: { provider: 'mock' } }),
    },
  };
}

function profileCookie(response) {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  const cookie = values.find((value) => value?.startsWith('__Host-zeely_profile='));
  assert.ok(cookie);
  return cookie.split(';')[0];
}

test('visual checkpoints expose only the exact public contract after real image bytes exist', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-contract-'));
  const runDirectory = path.join(root, 'run-1');
  await mkdir(runDirectory, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(runDirectory, 'source.png');
  const state = {
    visual_epoch: 1,
    visual_sequence: 0,
    visual_assets: {},
    visual_checkpoint: null,
  };
  const specification = {
    runDirectory,
    stage: 'SOURCE_READY',
    subject: { kind: 'PERSON', index: null, total: null },
    presentation: 'SOURCE_SCAN',
    truthState: 'IMMUTABLE_INPUT',
    title: 'Фото людини отримано',
    status: 'Незмінний оригінал збережено',
    layers: [{ role: 'SOURCE', path: sourcePath }],
  };

  await assert.rejects(() => prepareVisualCheckpoint(state, specification));
  assert.equal(state.visual_checkpoint, null, 'missing bytes must not create a visual checkpoint');
  await writeFile(sourcePath, await image());
  assert.equal(await prepareVisualCheckpoint(state, specification), true);

  const publicValue = publicVisualCheckpoint('run-1', state.visual_checkpoint, state.visual_assets);
  assert.deepEqual(Object.keys(publicValue), [
    'schema_version',
    'epoch',
    'sequence',
    'stage',
    'subject',
    'presentation',
    'truth_state',
    'title',
    'status',
    'layers',
  ]);
  assert.deepEqual(publicValue.subject, { kind: 'PERSON', index: null, total: null });
  assert.deepEqual(Object.keys(publicValue.layers[0]), ['role', 'asset_id', 'url', 'media_type']);
  assert.match(publicValue.layers[0].asset_id, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(publicValue).includes(root), false);
  assert.equal(JSON.stringify(publicValue).includes('sha256'), false);

  const corrupt = structuredClone(state.visual_checkpoint);
  corrupt.title = `/Users/private/runtime/${'x'.repeat(3)}`;
  assert.equal(publicVisualCheckpoint('run-1', corrupt, state.visual_assets), null);
  corrupt.title = 'Safe';
  corrupt.subject.kind = 'HUMAN';
  assert.equal(publicVisualCheckpoint('run-1', corrupt, state.visual_assets), null);
  corrupt.subject.kind = 'PERSON';
  corrupt.sequence = 0;
  assert.equal(publicVisualCheckpoint('run-1', corrupt, state.visual_assets), null);
  corrupt.sequence = 1;
  corrupt.presentation = 'QA_SCAN';
  corrupt.truth_state = 'APPROVED_OUTPUT';
  assert.equal(publicVisualCheckpoint('run-1', corrupt, state.visual_assets), null);
  await assert.rejects(() => prepareVisualCheckpoint(state, {
    ...specification,
    presentation: 'BEFORE_AFTER',
    truthState: 'DETERMINISTIC_DERIVATIVE',
  }), /contradicts/);
});

test('visual asset reads fail closed for tampering, symlinks, traversal, stale epoch, and non-images', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-integrity-'));
  const runDirectory = path.join(root, 'run-1');
  await mkdir(runDirectory, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const goodBytes = await image();
  const goodPath = path.join(runDirectory, 'good.png');
  await writeFile(goodPath, goodBytes);
  const state = {
    visual_epoch: 1,
    visual_sequence: 0,
    visual_assets: {},
    visual_checkpoint: null,
  };
  await prepareVisualCheckpoint(state, {
    runDirectory,
    stage: 'SOURCE_READY',
    subject: { kind: 'PERSON', index: null, total: null },
    presentation: 'SOURCE_SCAN',
    truthState: 'IMMUTABLE_INPUT',
    title: 'Фото отримано',
    status: 'Оригінал збережено',
    layers: [{ role: 'SOURCE', path: goodPath, sha256: sha256(goodBytes) }],
  });
  const assetId = state.visual_checkpoint.layers[0].asset_id;
  assert.deepEqual((await readVisualAsset(state, runDirectory, assetId)).bytes, goodBytes);

  await writeFile(goodPath, await image('#ff0000'));
  assert.equal(await readVisualAsset(state, runDirectory, assetId), null);

  const outsidePath = path.join(root, 'outside.png');
  await writeFile(outsidePath, goodBytes);
  const outsideId = randomUUID();
  state.visual_assets[outsideId] = {
    epoch: 1,
    path: outsidePath,
    sha256: sha256(goodBytes),
    size: goodBytes.length,
    media_type: 'image/png',
  };
  assert.equal(await readVisualAsset(state, runDirectory, outsideId), null);

  const symlinkPath = path.join(runDirectory, 'linked.png');
  await symlink(outsidePath, symlinkPath);
  const symlinkId = randomUUID();
  state.visual_assets[symlinkId] = {
    epoch: 1,
    path: symlinkPath,
    sha256: sha256(goodBytes),
    size: goodBytes.length,
    media_type: 'image/png',
  };
  assert.equal(await readVisualAsset(state, runDirectory, symlinkId), null);

  const textPath = path.join(runDirectory, 'not-image.png');
  const textBytes = Buffer.from('not an image');
  await writeFile(textPath, textBytes);
  const textId = randomUUID();
  state.visual_assets[textId] = {
    epoch: 1,
    path: textPath,
    sha256: sha256(textBytes),
    size: textBytes.length,
    media_type: 'image/png',
  };
  assert.equal(await readVisualAsset(state, runDirectory, textId), null);
  assert.equal(await readVisualAsset(state, runDirectory, '../outside'), null);

  const oversizedDimensionPath = path.join(runDirectory, 'too-wide.png');
  const oversizedDimensionBytes = await sharp({
    create: {
      width: 8_193,
      height: 2,
      channels: 3,
      background: '#ffffff',
    },
  }).png().toBuffer();
  await writeFile(oversizedDimensionPath, oversizedDimensionBytes);
  await assert.rejects(() => prepareVisualCheckpoint(state, {
    runDirectory,
    stage: 'SOURCE_READY',
    subject: { kind: 'PERSON', index: null, total: null },
    presentation: 'SOURCE_SCAN',
    truthState: 'IMMUTABLE_INPUT',
    title: 'Фото отримано',
    status: 'Оригінал збережено',
    layers: [{ role: 'SOURCE', path: oversizedDimensionPath }],
  }), /dimensions|decodable/);

  const oversizedBytesPath = path.join(runDirectory, 'too-large.png');
  await writeFile(oversizedBytesPath, '');
  await truncate(oversizedBytesPath, 32 * 1024 * 1024 + 1);
  const oversizedBytesId = randomUUID();
  state.visual_assets[oversizedBytesId] = {
    epoch: 1,
    path: oversizedBytesPath,
    sha256: 'a'.repeat(64),
    size: 32 * 1024 * 1024 + 1,
    media_type: 'image/png',
  };
  assert.equal(await readVisualAsset(state, runDirectory, oversizedBytesId), null);

  resetVisualState(state);
  assert.equal(await readVisualAsset(state, runDirectory, assetId), null);
  assert.equal(state.visual_epoch, 2);
});

test('persisted visual events reference readable assets and survive a RunService restart', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const observedStages = [];
  const observedVisuals = [];
  let service;
  service = new RunService({
    rootDirectory: root,
    ...dependencies(),
    observer: async (run) => {
      if (!run.visual_checkpoint) return;
      for (const layer of run.visual_checkpoint.layers) {
        const asset = await service.visualAsset(run.run_id, layer.asset_id);
        assert.ok(asset, `event ${run.visual_checkpoint.stage} must follow a complete image write`);
      }
      observedStages.push(run.visual_checkpoint.stage);
      observedVisuals.push(run.visual_checkpoint);
    },
  });
  await service.initialize();
  const created = await service.createRun({
    runId: 'visual-restart-run',
    person: await upload('#956b58'),
    garments: [await upload('#275b36')],
    outfitText: '',
    generateScene: false,
  });
  await service.running.get(created.run_id);

  assert.ok(observedStages.includes('SOURCE_READY'));
  assert.ok(observedStages.includes('ITEM_SOURCE_INSPECTION'));
  assert.ok(observedStages.includes('ITEM_CANDIDATE_READY'));
  assert.ok(observedStages.includes('ITEM_CANDIDATE_QA'));
  assert.ok(observedStages.includes('ITEM_BACKGROUND_REMOVAL'));
  const candidateIndex = observedStages.indexOf('ITEM_CANDIDATE_READY');
  const qaIndex = observedStages.indexOf('ITEM_CANDIDATE_QA');
  const maskIndex = observedStages.indexOf('ITEM_BACKGROUND_REMOVAL');
  assert.ok(candidateIndex < qaIndex && qaIndex < maskIndex);
  const garmentQa = observedVisuals[qaIndex];
  assert.equal(garmentQa.presentation, 'QA_SCAN');
  assert.equal(garmentQa.truth_state, 'QA_IN_PROGRESS');
  assert.deepEqual(garmentQa.layers.map((layer) => layer.role), ['CANDIDATE']);
  assert.ok(
    garmentQa.sequence > observedVisuals[candidateIndex].sequence,
    'QA scan must be a new persisted visual sequence',
  );
  assert.equal(observedStages.at(-1), 'OUTPUT_READY');
  const beforeRestart = await service.getRun(created.run_id);
  assert.equal(beforeRestart.visual_checkpoint.presentation, 'OUTPUT');
  assert.equal(beforeRestart.visual_checkpoint.truth_state, 'APPROVED_OUTPUT');

  const restarted = new RunService({ rootDirectory: root, ...dependencies() });
  await restarted.initialize();
  const afterRestart = await restarted.getRun(created.run_id);
  assert.deepEqual(afterRestart.visual_checkpoint, beforeRestart.visual_checkpoint);
  const restoredAsset = await restarted.visualAsset(
    created.run_id,
    afterRestart.visual_checkpoint.layers[0].asset_id,
  );
  assert.equal(restoredAsset.media_type, 'image/png');
  assert.ok(restoredAsset.bytes.length > 0);

  const stored = JSON.parse(await readFile(path.join(root, created.run_id, 'run.json'), 'utf8'));
  assert.ok(stored.visual_assets);
  assert.ok(Object.values(stored.visual_assets).every((asset) => asset.path.startsWith(root)));
  assert.equal(JSON.stringify(afterRestart).includes(root), false);
});

test('provider waiting never invents candidate pixels', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-waiting-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = dependencies();
  let release;
  let reportStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { reportStarted = resolve; });
  const generateGarment = deps.assetGenerator.generateGarment;
  deps.assetGenerator.generateGarment = async (...args) => {
    reportStarted();
    await gate;
    return generateGarment(...args);
  };
  const service = new RunService({ rootDirectory: root, ...deps });
  await service.initialize();
  const created = await service.createRun({
    runId: 'waiting-visual-run',
    person: await upload('#956b58'),
    garments: [await upload('#275b36')],
    outfitText: '',
    generateScene: false,
  });
  await started;
  const waiting = await service.getRun(created.run_id);
  assert.equal(waiting.inner_state, 'GARMENT_GENERATING');
  assert.equal(waiting.visual_checkpoint.stage, 'ITEM_SOURCE_INSPECTION');
  assert.equal(waiting.visual_checkpoint.truth_state, 'IMMUTABLE_INPUT');
  assert.equal(waiting.visual_checkpoint.presentation, 'SOURCE_SCAN');
  assert.deepEqual(waiting.visual_checkpoint.subject, { kind: 'ITEM', index: 1, total: 1 });
  assert.match(waiting.visual_checkpoint.status, /1 з 1/);
  assert.deepEqual(waiting.visual_checkpoint.layers.map((layer) => layer.role), ['SOURCE']);
  assert.equal(
    waiting.visual_checkpoint.layers.some((layer) => layer.role === 'CANDIDATE'),
    false,
  );
  release();
  await service.running.get(created.run_id);
  assert.equal((await service.getRun(created.run_id)).visual_checkpoint.stage, 'OUTPUT_READY');
});

test('visual callback failures never stop item conditioning', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-callback-soft-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'item.png');
  await writeFile(sourcePath, await image('#275b36'));
  const deps = dependencies();
  let visualCalls = 0;
  const conditioned = await new GarmentConditioner({
    vlm: deps.vlm,
    generator: deps.assetGenerator,
  }).condition({
    imagePaths: [sourcePath],
    outputDirectory: path.join(root, 'conditioned'),
    runId: 'callback-fail-soft',
    onVisual: async () => {
      visualCalls += 1;
      throw new Error('preview storage unavailable');
    },
  });
  assert.ok(visualCalls >= 4);
  assert.equal(conditioned.items.length, 1);
  assert.ok(conditioned.items[0].cutout.path);
});

test('an oversized preview cannot suppress persisted core state and message updates', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-progress-soft-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = dependencies();
  let releaseConditioning;
  let reportConditioningStarted;
  const gate = new Promise((resolve) => { releaseConditioning = resolve; });
  const conditioningStarted = new Promise((resolve) => { reportConditioningStarted = resolve; });
  const condition = deps.provider.condition.bind(deps.provider);
  deps.provider.condition = async (context) => {
    if (context.role === 'outfit') {
      reportConditioningStarted();
      await gate;
    }
    return condition(context);
  };
  let reportProgress;
  const progressPersisted = new Promise((resolve) => { reportProgress = resolve; });
  const service = new RunService({
    rootDirectory: root,
    ...deps,
    observer: async (run) => {
      if (run.inner_state === 'CONDITIONING_OUTFIT') reportProgress(run);
    },
  });
  await service.initialize();
  const oversizedPerson = await sharp({
    create: {
      width: 8_193,
      height: 256,
      channels: 3,
      background: '#956b58',
    },
  }).png().toBuffer();
  const created = await service.createRun({
    runId: 'oversized-preview-progress-run',
    person: {
      filename: 'person.png',
      mimetype: 'image/png',
      buffer: oversizedPerson,
    },
    outfitText: 'black tailored jacket',
    generateScene: false,
  });
  await conditioningStarted;
  let persisted;
  try {
    persisted = await Promise.race([
      progressPersisted,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('core progress was suppressed by visual failure')),
        3_000,
      )),
    ]);
  } finally {
    releaseConditioning();
  }
  assert.equal(persisted.inner_state, 'CONDITIONING_OUTFIT');
  assert.match(persisted.message, /матеріали образу/i);
  assert.equal(persisted.visual_checkpoint, undefined);
  await service.running.get(created.run_id);
  assert.equal((await service.getRun(created.run_id)).status, 'COMPLETED');
});

test('a text-only conditioned image never claims a nonexistent before image', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-text-conditioned-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = dependencies();
  const runId = 'text-conditioned-visual-run';
  const personPath = path.join(root, runId, 'inputs', 'person.png');
  const condition = deps.provider.condition.bind(deps.provider);
  deps.provider.condition = async (context) => {
    if (context.role !== 'outfit') return condition(context);
    return {
      reference: { path: personPath },
      extension: '.png',
      mediaType: 'image/png',
      facts: { role: 'outfit', conditioned: true },
      risks: [],
    };
  };
  let releaseQa;
  const qaGate = new Promise((resolve) => { releaseQa = resolve; });
  const qa = deps.provider.qa.bind(deps.provider);
  deps.provider.qa = async (context) => {
    if (context.phase === 'conditioning') await qaGate;
    return qa(context);
  };
  let reportVisual;
  const visualReady = new Promise((resolve) => { reportVisual = resolve; });
  const service = new RunService({
    rootDirectory: root,
    ...deps,
    observer: async (run) => {
      if (run.visual_checkpoint?.stage === 'OUTFIT_REFERENCE_CONDITIONED') {
        reportVisual(run.visual_checkpoint);
      }
    },
  });
  await service.initialize();
  const created = await service.createRun({
    runId,
    person: await upload('#956b58'),
    outfitText: 'black tailored jacket',
    generateScene: false,
  });
  let checkpoint;
  try {
    checkpoint = await Promise.race([
      visualReady,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('conditioned outfit visual checkpoint timeout')),
        3_000,
      )),
    ]);
  } finally {
    releaseQa();
  }
  assert.equal(checkpoint.presentation, 'CANDIDATE_REVEAL');
  assert.equal(checkpoint.truth_state, 'DETERMINISTIC_DERIVATIVE');
  assert.deepEqual(checkpoint.layers.map((layer) => layer.role), ['CANDIDATE']);
  await service.running.get(created.run_id);
});

test('a failed-run retry clears old visual assets and advances the epoch before new generation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = new RunService({ rootDirectory: root, ...dependencies() });
  await original.initialize();
  const created = await original.createRun({
    runId: 'visual-retry-run',
    person: await upload('#956b58'),
    outfitText: 'black tailored jacket',
    generateScene: false,
  });
  await original.running.get(created.run_id);
  const statePath = path.join(root, created.run_id, 'run.json');
  const completedState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(completedState.visual_epoch, 1);
  assert.ok(completedState.visual_checkpoint);
  completedState.status = 'FAILED';
  completedState.phase = 'CORE_PIPELINE';
  completedState.error = { name: 'Error', message: 'simulated recoverable failure' };
  await writeFile(statePath, `${JSON.stringify(completedState, null, 2)}\n`);

  let release;
  let reportStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { reportStarted = resolve; });
  const retryDeps = dependencies();
  retryDeps.provider = new MockProvider();
  const retryGenerate = retryDeps.provider.generate.bind(retryDeps.provider);
  retryDeps.provider.generate = async (context) => {
    reportStarted();
    await gate;
    return retryGenerate(context);
  };
  const restarted = new RunService({ rootDirectory: root, ...retryDeps });
  const retried = await restarted.retry(created.run_id);
  assert.equal(retried.visual_checkpoint, undefined);
  await started;
  const retryState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(retryState.visual_epoch, 2);
  assert.equal(retryState.visual_checkpoint, null);
  assert.deepEqual(retryState.visual_assets, {});
  release();
  await restarted.running.get(created.run_id);
  const finished = await restarted.getRun(created.run_id);
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.visual_checkpoint.epoch, 2);
  assert.equal(finished.visual_checkpoint.stage, 'OUTPUT_READY');
});

test('visual asset route is browser-profile owned and sends private image security headers', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-visual-route-'));
  const profiles = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite') });
  const bytes = await image();
  const assetId = randomUUID();
  let assetReads = 0;
  const runService = {
    async getRun(runId) {
      return runId === 'owned-visual-run'
        ? { run_id: runId, status: 'RUNNING', phase: 'CORE_PIPELINE' }
        : null;
    },
    async visualAsset(runId, requestedAssetId) {
      assetReads += 1;
      return runId === 'owned-visual-run' && requestedAssetId === assetId
        ? { bytes, media_type: 'image/png', size: bytes.length }
        : null;
    },
    subscribe() { return () => {}; },
    async outputFile() { return null; },
    async retry() { return null; },
    async selectGarments() { return null; },
    async garmentSourceFile() { return null; },
    async deleteRun() {},
  };
  const app = await createWebApp({ service: runService, profiles });
  t.after(async () => {
    await app.close();
    profiles.close();
    await rm(root, { recursive: true, force: true });
  });

  const profileA = await app.inject({ method: 'GET', url: '/api/profile' });
  const profileB = await app.inject({ method: 'GET', url: '/api/profile' });
  const cookieA = profileCookie(profileA);
  const cookieB = profileCookie(profileB);
  const claim = await app.inject({
    method: 'POST',
    url: '/api/profile/runs/owned-visual-run/claim',
    headers: { cookie: cookieA, 'content-type': 'application/json' },
    payload: { source_avatar_id: null },
  });
  assert.equal(claim.statusCode, 201, claim.body);

  const owner = await app.inject({
    method: 'GET',
    url: `/api/runs/owned-visual-run/visual-assets/${assetId}`,
    headers: { cookie: cookieA },
  });
  assert.equal(owner.statusCode, 200, owner.body);
  assert.deepEqual(owner.rawPayload, bytes);
  assert.equal(owner.headers['content-type'], 'image/png');
  assert.equal(owner.headers['cache-control'], 'private, no-store');
  assert.equal(owner.headers.vary, 'Cookie');
  assert.equal(owner.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(owner.headers['x-content-type-options'], 'nosniff');
  assert.equal(assetReads, 1);

  const foreign = await app.inject({
    method: 'GET',
    url: `/api/runs/owned-visual-run/visual-assets/${assetId}`,
    headers: { cookie: cookieB },
  });
  assert.equal(foreign.statusCode, 404, foreign.body);
  assert.deepEqual(foreign.json(), { error: 'Run not found' });
  assert.equal(foreign.headers['cache-control'], 'private, no-store');
  assert.equal(foreign.headers.vary, 'Cookie');
  assert.equal(foreign.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(foreign.headers['x-content-type-options'], 'nosniff');
  assert.equal(assetReads, 1, 'foreign ownership must fail before looking up the asset');
});
