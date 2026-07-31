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

test('the television ladder ranks video over shoot over background over look', () => {
  assert.deepEqual(
    ['look', 'background', 'shoot', 'video'].map((kind) => surfaces.resultModel({ kind }).rank),
    [1, 2, 3, 4]
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
    () => surfaces.interpolateRect([{ time: 1, x: 0.8, y: 0.2, width: 0.4, height: 0.3 }], 1),
    /inside the film frame/
  );
});
