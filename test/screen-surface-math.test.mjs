import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const math = require('../screen-surface-math.js');

test('TV calibration accepts only measured, bounded, ordered frames', () => {
  const calibration = math.normaliseCalibration({
    leg: 1,
    measuredFrom: 'seg2-final.mp4 · frame audit 2026-07-31',
    frames: [
      { time: 12, x: 0.2, y: 0.3, width: 0.5, height: 0.3 },
      { time: 10, x: 0.1, y: 0.25, width: 0.4, height: 0.25 }
    ]
  }, 'TV');

  assert.equal(calibration.frames[0].time, 10);
  assert.equal(calibration.frames[1].time, 12);
  assert.equal(calibration.measuredFrom, 'seg2-final.mp4 · frame audit 2026-07-31');
});

test('TV calibration rejects a guessed or out-of-frame rectangle', () => {
  assert.throws(() => math.normaliseCalibration({
    leg: 1,
    frames: [{ time: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.3 }]
  }, 'TV'), /measuredFrom/);

  assert.throws(() => math.normaliseCalibration({
    leg: 1,
    measuredFrom: 'seg2-final.mp4',
    frames: [{ time: 1, x: 0.8, y: 0.1, width: 0.4, height: 0.3 }]
  }, 'TV'), /inside the measured film frame/);
});

test('calibrated frames interpolate linearly and clamp at their measured ends', () => {
  const frames = math.normaliseCalibration({
    leg: 1,
    measuredFrom: 'seg2-final.mp4',
    frames: [
      { time: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      { time: 8, x: 0.3, y: 0.4, width: 0.5, height: 0.4 }
    ]
  }, 'TV').frames;

  assert.deepEqual(math.interpolateFrame(frames, 2), frames[0]);
  assert.deepEqual(math.interpolateFrame(frames, 10), frames[1]);

  const middle = math.interpolateFrame(frames, 6);
  assert.equal(middle.x, 0.2);
  assert.ok(Math.abs(middle.y - 0.3) < 1e-12);
  assert.equal(middle.width, 0.4);
  assert.ok(Math.abs(middle.height - 0.3) < 1e-12);
});
