import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { MOCK_PNG } from '../../src/providers/mock-provider.js';

test('MOCK_PNG fully decodes as an opaque sRGB RGB image', async () => {
  const image = sharp(MOCK_PNG, { failOn: 'error' });
  const metadata = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  assert.equal(metadata.format, 'png');
  assert.equal(metadata.space, 'srgb');
  assert.equal(metadata.channels, 3);
  assert.equal(metadata.hasAlpha, false);
  assert.equal(info.channels, 3);
  assert.equal(data.length, metadata.width * metadata.height * 3);
});
