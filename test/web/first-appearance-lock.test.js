import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { lockFirstAppearance } from '../../src/web/first-appearance-lock.js';

test('locks real bottom and footwear crops from a full-body approved look without a generator', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'first-appearance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lookPath = path.join(root, 'avatar_outfit.png');
  const look = await sharp({ create: { width: 800, height: 1200, channels: 4, background: '#ffffff' } })
    .composite([
      { input: await sharp({ create: { width: 260, height: 250, channels: 4, background: '#287044' } }).png().toBuffer(), left: 270, top: 160 },
      { input: await sharp({ create: { width: 220, height: 440, channels: 4, background: '#222222' } }).png().toBuffer(), left: 290, top: 410 },
      { input: await sharp({ create: { width: 310, height: 105, channels: 4, background: '#111111' } }).png().toBuffer(), left: 245, top: 850 },
    ]).png().toBuffer();
  await writeFile(lookPath, look);
  const calls = [];
  const result = await lockFirstAppearance({
    approvedLookPath: lookPath,
    outputDirectory: path.join(root, 'first-appearance'),
    runId: 'run_first_appearance',
    vlm: { async inspectGarments(paths) {
      calls.push(paths);
      return { status: 'READY', items: [
        { category: 'bottom', confidence: 0.98, observed: { garment_type: 'black trousers', colors: ['black'], material: ['denim'], pattern: ['plain'], logo_text: [], construction: ['straight leg'] }, unknowns: [] },
        { category: 'footwear', confidence: 0.96, observed: { garment_type: 'black shoes', colors: ['black'], material: ['synthetic'], pattern: ['plain'], logo_text: [], construction: ['low top'] }, unknowns: [] },
      ] };
    } },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(result.items.map((item) => item.category), ['bottom', 'footwear']);
  assert.ok(result.items.every((item) => item.cutout.sha256.length === 64));
  assert.equal(result.record.provenance, 'OBSERVED_FROM_APPROVED_LOOK');
  assert.equal(result.record.immutable_after_creation, true);
  assert.deepEqual(await sharp(await readFile(result.items[0].reference_card.path)).metadata().then(({ format }) => format), 'png');
});
