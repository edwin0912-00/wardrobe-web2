import assert from 'node:assert/strict';
import test from 'node:test';

import preview from '../media-preview.js';

function pixelData(width, height, pixels) {
  return { width, height, data: Uint8ClampedArray.from(pixels) };
}

test('removes only near-white pixels connected to the image edge', () => {
  const white = [255, 255, 255, 255];
  const dark = [20, 20, 20, 255];
  const image = pixelData(3, 3, [
    ...white, ...white, ...white,
    ...white, ...dark, ...white,
    ...white, ...white, ...white,
  ]);

  preview.removeEdgeBackground(image);

  assert.equal(image.data[3], 0, 'edge background becomes transparent');
  assert.equal(image.data[4 * 4 + 3], 255, 'interior garment pixels stay opaque');
});

test('does not remove an interior white garment isolated by a dark silhouette', () => {
  const white = [255, 255, 255, 255];
  const dark = [20, 20, 20, 255];
  const image = pixelData(5, 5, [
    ...white, ...white, ...white, ...white, ...white,
    ...white, ...dark, ...dark, ...dark, ...white,
    ...white, ...dark, ...white, ...dark, ...white,
    ...white, ...dark, ...dark, ...dark, ...white,
    ...white, ...white, ...white, ...white, ...white,
  ]);

  preview.removeEdgeBackground(image);

  assert.equal(image.data[(2 * 5 + 2) * 4 + 3], 255);
});
