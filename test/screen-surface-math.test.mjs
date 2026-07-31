import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const math = require('../screen-surface-math.js');

const measuredQuad = {
  time: 12,
  tl: { x: 0.2693, y: 0.3194 },
  tr: { x: 0.7369, y: 0.3250 },
  br: { x: 0.7552, y: 0.8065 },
  bl: { x: 0.2484, y: 0.8065 }
};

test('a screen quad requires four ordered, convex, in-frame corners', () => {
  const quad = math.normaliseQuad(measuredQuad, 'laptop');
  assert.equal(quad.time, 12);
  assert.throws(() => math.normaliseQuad({
    time: 1,
    tl: { x: 0.1, y: 0.1 }, tr: { x: 0.9, y: 0.1 },
    br: { x: 0.1, y: 0.9 }, bl: { x: 0.9, y: 0.9 }
  }, 'crossed'), /convex ordered/);
  assert.throws(() => math.normaliseQuad({
    time: 1,
    tl: { x: 0.1, y: 0.1 }, tr: { x: 1.2, y: 0.1 },
    br: { x: 0.8, y: 0.9 }, bl: { x: 0.2, y: 0.9 }
  }, 'outside'), /within 0…1/);
});

test('quad calibration records its measurement source and interpolates each display corner', () => {
  const calibration = math.normaliseQuadCalibration({
    leg: 3,
    measuredFrom: 'seg4.mp4 · four-corner audit',
    frames: [
      { ...measuredQuad, time: 10 },
      { ...measuredQuad, time: 14, tl: { x: 0.05, y: 0.08 }, tr: { x: 0.95, y: 0.08 }, br: { x: 0.99, y: 0.95 }, bl: { x: 0.01, y: 0.95 } }
    ]
  }, 'Laptop');
  const atMidpoint = math.interpolateQuad(calibration.frames, 12);
  assert.equal(atMidpoint.time, 12);
  assert.equal(atMidpoint.tl.x, (measuredQuad.tl.x + 0.05) / 2);
  assert.equal(atMidpoint.br.y, (measuredQuad.br.y + 0.95) / 2);
});

test('the projective transform maps every source corner to its measured display corner', () => {
  const quad = math.normaliseQuad(measuredQuad, 'laptop');
  const css = math.cssMatrix3dForQuad(quad, {
    stageWidth: 1920,
    stageHeight: 1080,
    sourceWidth: 1920,
    sourceHeight: 1080
  });
  const h = css.homography;
  const corners = [
    [0, 0, quad.tl], [1, 0, quad.tr], [1, 1, quad.br], [0, 1, quad.bl]
  ];
  for (const [x, y, expected] of corners) {
    const point = math.project(h, x, y);
    assert.ok(Math.abs(point.x - expected.x * 1920) < 0.001);
    assert.ok(Math.abs(point.y - expected.y * 1080) < 0.001);
  }
  assert.match(css.css, /^matrix3d\(/);
  assert.equal(css.matrix.length, 16);

  for (const [x, y, expected] of corners) {
    const localX = x * 1920;
    const localY = y * 1080;
    const denominator = css.matrix[3] * localX + css.matrix[7] * localY + css.matrix[15];
    const mappedX = (css.matrix[0] * localX + css.matrix[4] * localY + css.matrix[12]) / denominator;
    const mappedY = (css.matrix[1] * localX + css.matrix[5] * localY + css.matrix[13]) / denominator;
    assert.ok(Math.abs(mappedX - expected.x * 1920) < 0.001);
    assert.ok(Math.abs(mappedY - expected.y * 1080) < 0.001);
  }
});
