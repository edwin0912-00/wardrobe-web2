import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  normalizeBorderConnectedWhitePixels,
  normalizeWhiteFile,
} from '../../src/qa/white-normalizer.mjs';

function pixel(data, width, x, y) {
  return [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
}

test('normalizes only 4-connected qualifying pixels from the border', () => {
  const width = 5;
  const height = 5;
  const data = Buffer.alloc(width * height * 3, 20);
  const set = (x, y, rgb) => {
    const offset = (y * width + x) * 3;
    data.set(rgb, offset);
  };
  set(0, 0, [250, 249, 248]);
  set(1, 0, [250, 249, 248]);
  set(1, 1, [250, 249, 248]);
  set(3, 3, [250, 249, 248]);
  const result = normalizeBorderConnectedWhitePixels(data, width, height);
  assert.deepEqual(pixel(result.data, width, 0, 0), [255, 255, 255]);
  assert.deepEqual(pixel(result.data, width, 1, 1), [255, 255, 255]);
  assert.deepEqual(pixel(result.data, width, 3, 3), [250, 249, 248], 'isolated near-white is preserved');
  assert.equal(result.stats.changed_pixels, 3);
});

test('does not cross a nonqualifying barrier or alter subject-colored pixels', () => {
  const width = 3;
  const height = 3;
  const data = Buffer.from([
    250, 250, 250,  20, 30, 40,  250, 250, 250,
    20, 30, 40,      250, 250, 250, 20, 30, 40,
    20, 30, 40,      20, 30, 40,    20, 30, 40,
  ]);
  const result = normalizeBorderConnectedWhitePixels(data, width, height);
  assert.deepEqual(pixel(result.data, width, 1, 1), [250, 250, 250]);
  assert.deepEqual(pixel(result.data, width, 1, 0), [20, 30, 40]);
});

test('respects configurable channel and chroma limits', () => {
  const data = Buffer.from([244, 244, 244, 250, 238, 250, 245, 246, 247]);
  const result = normalizeBorderConnectedWhitePixels(data, 3, 1, {
    minimumChannel: 245,
    maximumChroma: 10,
  });
  assert.deepEqual([...result.data], [244, 244, 244, 250, 238, 250, 255, 255, 255]);
});

test('file normalization is atomic, preserves invariants and creates one original backup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zeely-white-'));
  const subjectDir = path.join(root, '001');
  await mkdir(subjectDir);
  const filePath = path.join(subjectDir, 'avatar.png');
  const width = 20;
  const height = 25;
  const rgb = Buffer.alloc(width * height * 3, 250);
  for (let y = 8; y < 17; y += 1) {
    for (let x = 7; x < 13; x += 1) rgb.fill(40, (y * width + x) * 3, (y * width + x) * 3 + 3);
  }
  await sharp(rgb, { raw: { width, height, channels: 3 } }).toColourspace('srgb').png().toFile(filePath);
  const original = await readFile(filePath);
  const result = await normalizeWhiteFile(filePath, { backup: true });
  const metadata = await sharp(filePath).metadata();
  const backup = await readFile(path.join(subjectDir, 'candidates', 'avatar.pre-white.png'));
  assert.equal(result.changed_pixels, width * height - 54);
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.equal(metadata.space, 'srgb');
  assert.equal(metadata.hasAlpha, false);
  assert.deepEqual(backup, original);
  assert.deepEqual(
    (await sharp(filePath).raw().toBuffer()).subarray((12 * width + 10) * 3, (12 * width + 10) * 3 + 3),
    Buffer.from([40, 40, 40]),
  );
  assert.equal((await normalizeWhiteFile(filePath, { backup: true })).changed_pixels, 0);
  assert.deepEqual(await readFile(path.join(subjectDir, 'candidates', 'avatar.pre-white.png')), original);
});

