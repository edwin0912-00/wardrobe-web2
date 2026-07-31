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

test('invalid TV geometry is rejected instead of spilling across the filmed bezel', () => {
  assert.throws(
    () => surfaces.interpolateRect([{ time: 1, x: 0.8, y: 0.2, width: 0.4, height: 0.3 }], 1),
    /inside the film frame/
  );
});
