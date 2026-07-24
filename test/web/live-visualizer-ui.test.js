import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  boundedMaskDimensions,
  classifyBackgroundAlpha,
  createLiveVisualizer,
  formatMaskRevealMetric,
  formatPixelMetric,
  isProviderWaitStage,
  maskRevealCells,
  normalizeVisualCheckpoint,
  safeCheckpointText,
  visualCheckpointKey,
  visualizerCopy,
} from '../../web/public/live-visualizer.js';

const ASSETS = Object.freeze({
  base: '06a19bad-81d6-4ef4-9df5-aea5629d9241',
  source: '27303996-cb67-4a93-91c8-dc681245ced7',
  candidate: '9ff122c4-d8d5-41ad-a3aa-2976a08d57f7',
  cutout: '62e2e752-e6df-46df-aab7-a53e8c7813f5',
  before: '6d7f6285-8c2d-42c6-9d2f-82965c27409d',
  after: '04db52fe-43ae-41bb-8306-66c3de897a3b',
});

function layer(role, key = role.toLowerCase()) {
  const assetId = ASSETS[key];
  return {
    role,
    asset_id: assetId,
    url: `/api/runs/6d51a737-6308-4a28-b26d-c7dcc1a45eee/visual-assets/${assetId}`,
    media_type: role === 'CUTOUT' ? 'image/png' : 'image/webp',
  };
}

function checkpoint(overrides = {}) {
  return {
    schema_version: '1.0.0',
    epoch: 2,
    sequence: 7,
    stage: 'ITEM_BACKGROUND_MASK_READY',
    subject: { kind: 'ITEM', index: 1, total: 2 },
    presentation: 'MASK_REVEAL',
    truth_state: 'DETERMINISTIC_DERIVATIVE',
    title: 'Виділяємо фон',
    status: 'Маску обчислено з альфа-каналу',
    layers: [layer('BASE', 'base'), layer('CUTOUT', 'cutout')],
    metrics: { selected_pixels: 75, total_pixels: 100 },
    ...overrides,
  };
}

test('strict public visual contract accepts every supported presentation with real owned layers', () => {
  const variants = [
    ['SOURCE_SCAN', 'IMMUTABLE_INPUT', [layer('SOURCE', 'source')]],
    ['CANDIDATE_REVEAL', 'UNVERIFIED_CANDIDATE', [layer('CANDIDATE', 'candidate')]],
    ['MASK_REVEAL', 'DETERMINISTIC_DERIVATIVE', [layer('BASE', 'base'), layer('CUTOUT', 'cutout')]],
    ['BEFORE_AFTER', 'DETERMINISTIC_DERIVATIVE', [layer('BEFORE', 'before'), layer('AFTER', 'after')]],
    ['QA_SCAN', 'QA_IN_PROGRESS', [layer('CANDIDATE', 'candidate')]],
    ['OUTPUT', 'APPROVED_OUTPUT', [layer('AFTER', 'after')]],
  ];
  for (const [presentation, truthState, layers] of variants) {
    const normalized = normalizeVisualCheckpoint(checkpoint({
      presentation,
      truth_state: truthState,
      layers,
    }));
    assert.equal(normalized?.presentation, presentation);
    assert.equal(normalized?.layers.length, layers.length);
    assert.equal(visualCheckpointKey(normalized), `2:7:ITEM_BACKGROUND_MASK_READY`);
  }
});

test('visual contract fails closed on unknown states, malformed subjects, or non-owned assets', () => {
  assert.equal(normalizeVisualCheckpoint(checkpoint({ presentation: 'DIFFUSION_STREAM' })), null);
  assert.equal(normalizeVisualCheckpoint(checkpoint({ truth_state: 'TRUST_ME' })), null);
  assert.equal(normalizeVisualCheckpoint(checkpoint({
    presentation: 'QA_SCAN',
    truth_state: 'APPROVED_OUTPUT',
    layers: [layer('CANDIDATE', 'candidate')],
  })), null, 'presentation and truth state cannot contradict each other');
  assert.equal(normalizeVisualCheckpoint(checkpoint({
    presentation: 'OUTPUT',
    truth_state: 'APPROVED_OUTPUT',
    layers: [layer('BEFORE', 'before')],
  })), null, 'presentation rejects unrelated layer roles');
  assert.equal(normalizeVisualCheckpoint(checkpoint({ layers: [] })), null);
  assert.equal(normalizeVisualCheckpoint(checkpoint({
    subject: { kind: 'ITEM', index: 0, total: 2 },
  })), null);
  assert.equal(normalizeVisualCheckpoint(checkpoint({
    subject: { kind: 'ITEM', index: 3, total: 2 },
  })), null);
  assert.equal(normalizeVisualCheckpoint(checkpoint({
    layers: [{ ...layer('BASE', 'base'), url: 'https://provider.example/private.webp' }, layer('CUTOUT', 'cutout')],
  })), null);
  assert.equal(normalizeVisualCheckpoint(checkpoint({
    layers: [{ ...layer('BASE', 'base'), url: `/api/runs/run/visual-assets/${ASSETS.after}` }, layer('CUTOUT', 'cutout')],
  })), null);
  assert.equal(normalizeVisualCheckpoint(checkpoint({
    layers: [layer('CUTOUT', 'cutout')],
  })), null, 'mask reveal requires both the real base and alpha cutout');
  assert.ok(normalizeVisualCheckpoint(checkpoint({
    layers: [
      { ...layer('BASE', 'base'), url: `/api/runs/run_with_underscore/visual-assets/${ASSETS.base}` },
      { ...layer('CUTOUT', 'cutout'), url: `/api/runs/run_with_underscore/visual-assets/${ASSETS.cutout}` },
    ],
  })), 'run-service SAFE_RUN_ID underscores remain valid');
  assert.equal(normalizeVisualCheckpoint(checkpoint({
    layers: [
      { ...layer('BASE', 'base'), url: `/api/runs/run.with.dot/visual-assets/${ASSETS.base}` },
      layer('CUTOUT', 'cutout'),
    ],
  })), null);
});

test('copy is truthful while a provider is waiting and QA never claims pixel mutation', () => {
  const normalized = normalizeVisualCheckpoint(checkpoint());
  assert.deepEqual(visualizerCopy(null, { providerWaiting: true }), {
    title: 'Очікуємо збережений кадр',
    status: 'Модель ще працює · покажемо результат одразу після збереження.',
  });
  assert.match(visualizerCopy(normalized, { providerWaiting: true }).status, /не передає незавершені пікселі/);
  const qa = normalizeVisualCheckpoint(checkpoint({
    presentation: 'QA_SCAN',
    truth_state: 'QA_IN_PROGRESS',
    layers: [layer('CANDIDATE', 'candidate')],
  }));
  assert.equal(visualizerCopy(qa).status, 'Пікселі не змінюються · виконується перевірка.');
  assert.equal(isProviderWaitStage('GARMENT_GENERATING'), true);
  assert.equal(isProviderWaitStage('ITEM_QA'), false);
});

test('private infrastructure text is replaced before it reaches the live caption', () => {
  assert.equal(
    safeCheckpointText('TASK /Users/jarvis1/runtime/runs/private.webp', 'Безпечний текст'),
    'Безпечний текст',
  );
  assert.equal(
    safeCheckpointText('Перевіряємо видимі характеристики речі', 'fallback'),
    'Перевіряємо видимі характеристики речі',
  );
});

test('background selection comes only from the real cutout alpha channel', () => {
  const source = new Uint8ClampedArray([
    10, 20, 30, 0,
    40, 50, 60, 12,
    70, 80, 90, 13,
    100, 110, 120, 255,
  ]);
  const classified = classifyBackgroundAlpha(source);
  assert.equal(classified.selectedPixels, 2);
  assert.equal(classified.totalPixels, 4);
  assert.deepEqual([...classified.pixels.filter((_, index) => index % 4 === 3)], [178, 178, 0, 0]);
  assert.deepEqual([...source.filter((_, index) => index % 4 === 3)], [0, 12, 13, 255], 'source pixels stay immutable');
  assert.equal(formatPixelMetric(normalizeVisualCheckpoint(checkpoint())), '75% ФОНУ');
  assert.equal(formatMaskRevealMetric(75, 100, 42.4), '75% ФОНУ · 42% ВІЗУАЛІЗОВАНО');
  assert.doesNotMatch(formatMaskRevealMetric(75, 100, 42.4), /ВИДІЛЕНО/);
});

test('alpha analysis is bounded before canvas allocation and can transform its small buffer in place', () => {
  const landscape = boundedMaskDimensions(4096, 2160);
  const portrait = boundedMaskDimensions(2160, 4096);
  for (const dimensions of [landscape, portrait]) {
    assert.ok(Math.max(dimensions.width, dimensions.height) <= 512);
    assert.ok(dimensions.width * dimensions.height <= 512 * 512);
  }
  const pixels = new Uint8ClampedArray([1, 2, 3, 0, 4, 5, 6, 255]);
  const classified = classifyBackgroundAlpha(pixels, { inPlace: true });
  assert.equal(classified.pixels, pixels);
  assert.deepEqual([...pixels], [184, 255, 61, 178, 184, 255, 61, 0]);
});

test('pixel reveal cells form a deterministic, non-overlapping cover of the alpha mask', () => {
  const first = maskRevealCells(101, 77);
  const second = maskRevealCells(101, 77);
  assert.deepEqual(first, second);
  assert.ok(first.length > 100);
  assert.equal(first.reduce((area, cell) => area + (cell.width * cell.height), 0), 101 * 77);
  const occupied = new Set();
  for (const cell of first) {
    for (let y = cell.y; y < cell.y + cell.height; y += 1) {
      for (let x = cell.x; x < cell.x + cell.width; x += 1) {
        const key = `${x}:${y}`;
        assert.equal(occupied.has(key), false, `overlapping cell at ${key}`);
        occupied.add(key);
      }
    }
  }
  assert.equal(occupied.size, 101 * 77);
});

test('visualizer occupies the former blank board area and stays out of terminal traces', async () => {
  const [html, css, experience, app] = await Promise.all([
    readFile(new URL('../../web/public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../web/public/progress.css', import.meta.url), 'utf8'),
    readFile(new URL('../../web/public/experience.css', import.meta.url), 'utf8'),
    readFile(new URL('../../web/public/app.js', import.meta.url), 'utf8'),
  ]);
  const board = html.slice(html.indexOf('<section class="pipeline-board"'), html.indexOf('</section>', html.indexOf('<section class="pipeline-board"')));
  assert.ok(board.indexOf('id="pipeline-live-visualizer"') < board.indexOf('class="pipeline-board-head"'));
  const visualizer = board.slice(board.indexOf('<figure'), board.indexOf('</figure>'));
  assert.equal((visualizer.match(/role="status"/g) ?? []).length, 1);
  assert.match(visualizer, /<canvas id="live-visualizer-canvas" aria-hidden="true">/);
  assert.match(css, /\.pipeline-board\s*\{[\s\S]*?grid-template-rows:\s*minmax\(210px,\s*1fr\) auto auto auto;/);
  assert.match(css, /\.terminal-pipeline-trace \.pipeline-live-visualizer\s*\{\s*display:\s*none;/);
  assert.match(css, /max-width:\s*700px[\s\S]*?orientation:\s*portrait[\s\S]*?\.pipeline-board\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /max-height:\s*700px[\s\S]*?\.pipeline-inspector dl\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,/);
  assert.match(experience, /max-width:\s*700px[\s\S]*?orientation:\s*portrait[\s\S]*?html,[\s\S]*?body\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(experience, /body\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?max-height:\s*100dvh;/);
  assert.match(app, /liveVisualizer\.update\(run\.visual_checkpoint,/);
  assert.match(app, /liveVisualizer\.update\(null,\s*\{\s*providerWaiting:\s*false\s*\}\);/);
});

test('controller cancels stale image work, schedules bounded animation, and pauses while hidden', async (context) => {
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  const visibilityListeners = new Set();
  const fakeDocument = {
    hidden: false,
    addEventListener(type, listener) {
      if (type === 'visibilitychange') visibilityListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'visibilitychange') visibilityListeners.delete(listener);
    },
  };
  const imageInstances = [];
  class FakeImage {
    constructor() {
      this.naturalWidth = 100;
      this.naturalHeight = 150;
      this.onload = null;
      this.onerror = null;
      this._src = '';
      imageInstances.push(this);
    }

    set src(value) { this._src = value; }
    get src() { return this._src; }
  }
  globalThis.document = fakeDocument;
  globalThis.Image = FakeImage;
  context.after(() => {
    globalThis.document = originalDocument;
    globalThis.Image = originalImage;
  });

  const drawingCalls = [];
  const gradient = { addColorStop() {} };
  const drawing = {
    setTransform() {}, clearRect() {}, createLinearGradient: () => gradient,
    fillRect() {}, stroke() {}, beginPath() {}, moveTo() {}, lineTo() {},
    save() { drawingCalls.push('save'); },
    restore() { drawingCalls.push('restore'); },
    drawImage() { drawingCalls.push('drawImage'); },
    rect() { drawingCalls.push('rect'); },
    clip() { drawingCalls.push('clip'); },
    fillText() {},
  };
  const elements = {
    '#live-visualizer-canvas': {
      width: 0,
      height: 0,
      getContext: () => drawing,
      getBoundingClientRect: () => ({ width: 320, height: 180 }),
    },
    '#live-visualizer-title': { textContent: '' },
    '#live-visualizer-status': { textContent: '' },
    '#live-visualizer-announcement': { textContent: '' },
    '#live-visualizer-metric': { textContent: '', hidden: true },
  };
  const root = { dataset: {}, querySelector: (selector) => elements[selector] ?? null };
  const queuedFrames = new Map();
  const cancelledFrames = [];
  let nextFrameId = 1;
  const controller = createLiveVisualizer(root, {
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      queuedFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      queuedFrames.delete(id);
    },
    now: () => 1_000,
    matchMedia: () => ({ matches: false }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });

  const first = checkpoint({
    stage: 'SOURCE_READY',
    presentation: 'SOURCE_SCAN',
    truth_state: 'IMMUTABLE_INPUT',
    subject: { kind: 'PERSON', index: null, total: null },
    layers: [layer('SOURCE', 'source')],
  });
  const second = checkpoint({
    sequence: 8,
    stage: 'CANDIDATE_REVEAL_TEST',
    presentation: 'CANDIDATE_REVEAL',
    truth_state: 'UNVERIFIED_CANDIDATE',
    subject: { kind: 'PERSON', index: null, total: null },
    layers: [layer('CANDIDATE', 'base')],
  });
  controller.update(first);
  assert.equal(imageInstances.length, 1);
  controller.update(second);
  assert.equal(imageInstances[0].src, '', 'stale image request is actively cancelled');
  assert.equal(imageInstances.length, 2);

  drawingCalls.length = 0;
  imageInstances[1].onload?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    drawingCalls.filter((operation) => operation === 'drawImage').length,
    1,
    'candidate has no full foreground prepaint before its reveal',
  );
  assert.ok(
    drawingCalls.indexOf('clip') < drawingCalls.indexOf('drawImage'),
    'the first candidate foreground draw is already inside the reveal clip',
  );
  assert.equal(queuedFrames.size, 1, 'only one animation frame may be outstanding');

  const third = checkpoint({
    sequence: 9,
    stage: 'SOURCE_RETRY_TEST',
    presentation: 'SOURCE_SCAN',
    truth_state: 'IMMUTABLE_INPUT',
    subject: { kind: 'PERSON', index: null, total: null },
    layers: [layer('SOURCE', 'after')],
  });
  controller.update(third);
  assert.equal(imageInstances.length, 3);
  imageInstances[2].onerror?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.dataset.assetState, 'RETRY_PENDING');
  assert.match(elements['#live-visualizer-status'].textContent, /повторимо завантаження/);

  controller.update(third);
  assert.equal(imageInstances.length, 4, 'a later same-checkpoint sync gets one retry');
  imageInstances[3].onerror?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.dataset.assetState, 'UNAVAILABLE');
  controller.update(third);
  assert.equal(imageInstances.length, 4, 'a second failure cannot create an infinite retry loop');

  fakeDocument.hidden = true;
  for (const listener of visibilityListeners) listener();
  assert.equal(queuedFrames.size, 0);
  assert.ok(cancelledFrames.length >= 1);
  controller.destroy();
  assert.equal(visibilityListeners.size, 0);
});
