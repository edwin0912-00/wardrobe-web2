import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhiteBorderMatte, BLACK_GOLD_LIGHT_STAGE } from '../../web/public/light-stage.js';

function pixels(width, height, fill = [255, 255, 255, 255]) {
  return new Uint8ClampedArray(Array.from({ length: width * height }, () => fill).flat());
}

test('light stage recipe is presentation-only black gold', () => {
  assert.equal(BLACK_GOLD_LIGHT_STAGE.id, 'black-gold');
  assert.equal(BLACK_GOLD_LIGHT_STAGE.floorColor, '#060707');
});

test('removes only white connected to the border', () => {
  const image = pixels(5, 5);
  const centre = ((2 * 5) + 2) * 4;
  image.set([22, 24, 22, 255], centre);
  const result = createWhiteBorderMatte(image, 5, 5);
  assert.equal(result[3], 0);
  assert.equal(result[centre + 3], 255);
  assert.deepEqual([...result.slice(centre, centre + 3)], [22, 24, 22]);
});

test('keeps an enclosed white detail opaque', () => {
  const image = pixels(7, 7);
  for (let y = 2; y <= 4; y += 1) for (let x = 2; x <= 4; x += 1) image.set([30, 30, 30, 255], ((y * 7) + x) * 4);
  image.set([255, 255, 255, 255], ((3 * 7) + 3) * 4);
  const result = createWhiteBorderMatte(image, 7, 7);
  assert.equal(result[(((3 * 7) + 3) * 4) + 3], 255);
});
