import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const strategy = require('../media-strategy.js');

const input = Object.freeze({
  intro: 'assets/intro.mp4',
  tracks: ['audio/t1.mp3', 'audio/t2.mp3'],
  videos: ['assets/seg1.mp4?v=seg1-d-20260730', 'assets/seg2.mp4', 'assets/seg3.mp4']
});

test('desktop holds the selected first room before revealing the fabric handoff', () => {
  const plan = strategy.create({ ...input, ios: false });
  assert.deepEqual(plan.critical, [
    'audio/t1.mp3', 'assets/intro.mp4', 'assets/seg1.mp4?v=seg1-d-20260730'
  ]);
  assert.deepEqual(plan.background, ['assets/seg2.mp4', 'assets/seg3.mp4']);
  assert.deepEqual(plan.nativeInitialLegs, []);
  assert.deepEqual(plan.nativeDeferredLegs, []);
  assert.throws(() => { plan.critical.push('wrong.mp4'); }, TypeError);
});

test('iOS uses one native owner per room and never turns later videos into duplicate fetches', () => {
  const plan = strategy.create({ ...input, ios: true });
  assert.deepEqual(plan.critical, ['audio/t1.mp3', 'assets/intro.mp4']);
  assert.deepEqual(plan.background, []);
  assert.deepEqual(plan.nativeInitialLegs, [0]);
  assert.deepEqual(plan.nativeDeferredLegs, [1, 2]);
});

test('a native source may only be mounted from a completed loader file', () => {
  const url = input.videos[1];
  assert.equal(strategy.hasBlob({}, url), false);
  assert.equal(strategy.hasBlob({ [url]: '' }, url), false);
  assert.equal(strategy.hasBlob({ [url]: 'blob:wardrobe' }, url), true);
});
