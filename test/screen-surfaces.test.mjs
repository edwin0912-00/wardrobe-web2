import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const surfaces = require('../screen-surfaces.js');

test('TV aperture interpolation follows only committed measurements', () => {
  const frames = [
    { time: 11, x: 0.6, y: 0.2, width: 0.3, height: 0.3 },
    { time: 13, x: 0.4, y: 0.3, width: 0.4, height: 0.4 }
  ];
  const middle = surfaces.interpolateRect(frames, 12);
  assert.deepEqual(
    Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, middle[key]])),
    { x: 0.5, y: 0.25, width: 0.35, height: 0.35 }
  );
  assert.equal(surfaces.interpolateRect(frames, 9).time, 11);
  assert.equal(surfaces.interpolateRect(frames, 15).time, 13);
});

test('TV result model keeps shoot strips and widescreen video honest', () => {
  const shoot = surfaces.resultModel({ kind: 'shoot', aspect: '16:9', urls: ['1.jpg', '2.jpg'] });
  assert.equal(shoot.kind, 'shoot');
  assert.equal(shoot.urls.length, 2);
  assert.equal(shoot.pendingRealMedia, false);

  const waitingVideo = surfaces.resultModel({ kind: 'video', aspect: '16:9' });
  assert.equal(waitingVideo.mediaUrl, '');
  assert.equal(waitingVideo.pendingRealMedia, true);
});

test('the television ladder ranks video over shoot over looks over background', () => {
  assert.deepEqual(
    ['look', 'background', 'shoot', 'video'].map((kind) => surfaces.resultModel({ kind }).rank),
    [2, 1, 3, 4]
  );
});

test('a portrait look and a finished background are admitted to the shelf', () => {
  /* Pre-change proof: addResult dropped anything that was neither 16:9 nor a shoot, so
   * both of these returned without reaching the shelf and the television stayed empty. */
  for (const kind of ['look', 'background']) {
    const item = surfaces.resultModel({ kind, aspect: '9:16', urls: ['a.jpg'] });
    assert.equal(item.kind, kind);
    assert.equal(item.pendingRealMedia, false);
    assert.ok(item.rank >= 1);
  }
});

test('coalesces one to five looks into a single TV portrait row', () => {
  let shelf = [];
  for (let index = 1; index <= 6; index += 1) {
    const resolved = surfaces.addResultToShelf(shelf, {
      kind: 'look', aspect: '9:16', urls: [`look-${index}.png`],
    });
    shelf = resolved.results;
  }
  assert.equal(shelf.length, 1);
  assert.equal(shelf[0].kind, 'look');
  assert.deepEqual(shelf[0].urls, [
    'look-1.png', 'look-2.png', 'look-3.png', 'look-4.png', 'look-5.png',
  ]);
  assert.equal(surfaces.strongestResult(shelf), 0);
});

test('coalesced looks keep each native preview paired with its master', () => {
  const first = surfaces.addResultToShelf([], {
    kind: 'look', aspect: '9:16', urls: ['master-a'],
    previewUrls: ['cutout-a'], previewAttempted: true,
  });
  const second = surfaces.addResultToShelf(first.results, {
    kind: 'look', aspect: '9:16', urls: ['master-b'],
    previewUrls: ['cutout-b'], previewAttempted: true,
  });
  assert.deepEqual(second.results[0].urls, ['master-a', 'master-b']);
  assert.deepEqual(second.results[0].previewUrls, ['cutout-a', 'cutout-b']);
});

test('a master-only look is immediately usable and does not wait for a preview job', () => {
  const item = surfaces.resultModel({ kind: 'look', aspect: '9:16', urls: ['master'] });
  assert.equal(item.pendingRealMedia, false);
  assert.deepEqual(item.previewUrls, []);
});

test('a stronger TV result wins over an aggregated look row', () => {
  const look = surfaces.addResultToShelf([], {
    kind: 'look', aspect: '9:16', urls: ['look.png'],
  });
  const shoot = surfaces.addResultToShelf(look.results, {
    kind: 'shoot', aspect: '16:9', urls: ['shot-1.png', 'shot-2.png'],
  });
  assert.equal(shoot.results.length, 2);
  assert.equal(shoot.activeResult, 1);
  assert.equal(shoot.results[shoot.activeResult].kind, 'shoot');
});

test('partial shoot updates replace the same TV rung when more frames arrive', () => {
  const first = surfaces.addResultToShelf([], {
    kind: 'shoot', aspect: '16:9', urls: ['shot-1.jpg', 'shot-2.jpg'],
    partial: true, readyCount: 2, expectedCount: 5,
  });
  const second = surfaces.addResultToShelf(first.results, {
    kind: 'shoot', aspect: '16:9', urls: ['shot-1.jpg', 'shot-2.jpg', 'shot-3.jpg'],
    partial: true, readyCount: 3, expectedCount: 5,
  });
  assert.equal(second.results.length, 1);
  assert.deepEqual(second.results[0].urls, ['shot-1.jpg', 'shot-2.jpg', 'shot-3.jpg']);
  assert.equal(second.results[0].readyCount, 3);
});

test('a look row remains visible after a background finishes', () => {
  const look = surfaces.addResultToShelf([], {
    kind: 'look', aspect: '9:16', urls: ['look.png'],
  });
  const background = surfaces.addResultToShelf(look.results, {
    kind: 'background', aspect: '9:16', urls: ['room.png'],
  });
  assert.equal(background.results[background.activeResult].kind, 'look');
});

test('each rung carries its own client label and no aspect vocabulary', () => {
  assert.deepEqual(
    ['look', 'background', 'shoot', 'video'].map((kind) => surfaces.resultModel({ kind }).label),
    ['Образ', 'Фон', 'Фотосесія', 'Фешн-відео']
  );
});

test('an unknown kind still resolves to a ranked, labelled result', () => {
  const fallback = surfaces.resultModel({ kind: 'nonsense' });
  assert.equal(fallback.kind, 'video');
  assert.equal(fallback.rank, 4);
});

test('invalid TV geometry is rejected instead of spilling across the filmed bezel', () => {
  assert.throws(
    () => surfaces.interpolateRect([{ time: 1, x: 1.8, y: 0.2, width: 0.4, height: 0.3 }], 1),
    /extended film bounds/
  );
});

test('TV geometry keeps the complete plane while it crosses a frame edge', () => {
  const entering = surfaces.interpolateRect([
    { time: 0, x: 0.92, y: 0.27, width: 0.34, height: 0.334 },
    { time: 1, x: 0.62, y: 0.27, width: 0.34, height: 0.334 },
  ], 0);
  const leaving = surfaces.interpolateRect([
    { time: 0, x: -0.18, y: 0.27, width: 0.34, height: 0.334 },
    { time: 1, x: -0.32, y: 0.27, width: 0.34, height: 0.334 },
  ], 0.5);
  assert.equal(entering.x, 0.92);
  assert.ok(leaving.x < 0);
  assert.ok(leaving.x + leaving.width > 0);
});
