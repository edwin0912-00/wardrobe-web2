import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const math = require('../screen-surface-math.js');

test('D screen calibration contains only bounded, explicitly sourced measurements', async () => {
  const calibration = JSON.parse(await readFile(new URL('../b/screen-calibration.json', import.meta.url), 'utf8'));
  assert.equal(calibration.source.seg1_d_sha256, '5f13fb155eee8affa416fbf7689326b8abcbfc9570417c1ce74932fddfa0d424');
  assert.deepEqual(calibration.tv.tracks.map((track) => track.leg), [1, 2]);
  assert.equal(calibration.laptop.leg, 3);
  assert.equal(calibration.laptop.corner_order.join(','), 'tl,tr,br,bl');
  assert.ok(calibration.laptop.safe_inset >= 0.015 && calibration.laptop.safe_inset <= 0.02);

  for (const track of calibration.tv.tracks) {
    const tv = track.frames;
    for (let index = 1; index < tv.length; index += 1) assert.ok(tv[index].time > tv[index - 1].time);
    for (const frame of tv) {
      assert.ok(frame.x >= -1 && frame.y >= 0);
      assert.ok(frame.x <= 1 && frame.x + frame.width <= 2 && frame.y + frame.height <= 1);
    }
  }

  const laptop = math.normaliseQuadCalibration({
    leg: calibration.laptop.leg,
    measuredFrom: calibration.laptop.measured_from,
    frames: calibration.laptop.frames
  }, 'Laptop');
  assert.equal(laptop.frames.length, 6);
  assert.equal(laptop.frames[3].time, 12);
});
