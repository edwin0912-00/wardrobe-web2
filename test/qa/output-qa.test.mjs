import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { diagnoseBackground, inspectImage, STATUS, verifyOutput } from '../../src/qa/index.mjs';

async function png(filePath, rgb = { r: 255, g: 255, b: 255 }, options = {}) {
  const width = options.width ?? 100;
  const height = options.height ?? 125;
  let instance = sharp({ create: { width, height, channels: options.alpha ? 4 : 3, background: rgb } });
  if (options.alpha) instance = instance.png();
  await instance.png().toFile(filePath);
}

async function outputFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'zeely-qa-'));
  const folder = path.join(root, '001');
  await mkdir(folder);
  await png(path.join(folder, 'avatar.png'));
  await png(path.join(folder, 'avatar_outfit.png'), { r: 254, g: 254, b: 254 });
  return root;
}

test('inspectImage verifies PNG/sRGB/no-alpha and exact-white diagnostics', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zeely-image-'));
  const filePath = path.join(root, 'white.png');
  await png(filePath);
  const result = await inspectImage(filePath);
  assert.equal(result.technical_gates.decode.status, STATUS.PASS);
  assert.equal(result.technical_gates.png.status, STATUS.PASS);
  assert.equal(result.technical_gates.srgb.status, STATUS.PASS);
  assert.equal(result.technical_gates.no_alpha.status, STATUS.PASS);
  assert.equal(result.background_diagnostics.exact_white_ratio, 1);
  assert.equal(result.background_diagnostics.status, STATUS.PASS);
});

test('background diagnostics exclude hair touching the top-center frame', () => {
  const width = 100;
  const height = 125;
  const data = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < 45; y += 1) {
    const halfWidth = Math.max(1, Math.floor(y / 12));
    for (let x = 50 - halfWidth; x <= 50 + halfWidth; x += 1) {
      data.fill(24, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  const result = diagnoseBackground(data, width, height);
  assert.equal(result.status, STATUS.PASS);
  assert.equal(result.every_classified_background_pixel_exact_white, true);
  assert.equal(result.exact_white_ratio, 1);
});

test('background diagnostics allow a broad half-body foreground to occupy one lower side', () => {
  const width = 100;
  const height = 125;
  const data = Buffer.alloc(width * height * 3, 255);
  // Simulate a valid person/garment that enters below both top-corner regions,
  // becomes broad, and reaches the right edge. The left side stays open.
  for (let y = 28; y < height; y += 1) {
    const startX = Math.max(34, 78 - Math.floor((y - 28) / 3));
    for (let x = startX; x < width; x += 1) {
      data.fill(24, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  const result = diagnoseBackground(data, width, height);
  assert.equal(result.coverage.corners.top_left, 1);
  assert.equal(result.coverage.corners.top_right, 1);
  assert.ok(result.coverage.right_side < 0.75);
  assert.equal(result.coverage.left_side, 1);
  assert.equal(result.coverage.gated_side_metric, 'maximum(left_side,right_side)');
  assert.equal(result.status, STATUS.PASS);
});

test('background diagnostics hard-fail off-white and grey corners', () => {
  const offWhite = Buffer.alloc(100 * 125 * 3, 254);
  const grey = Buffer.alloc(100 * 125 * 3, 240);
  assert.equal(diagnoseBackground(offWhite, 100, 125).status, STATUS.FAIL);
  assert.equal(diagnoseBackground(offWhite, 100, 125).exact_white_ratio, 0);
  assert.equal(diagnoseBackground(grey, 100, 125).status, STATUS.FAIL);
  assert.equal(diagnoseBackground(grey, 100, 125).coverage.minimum_top_corner, 0);
});

test('background diagnostics hard-fail a connected off-white gradient', () => {
  const width = 100;
  const height = 125;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.min(x, width - 1 - x);
      const value = Math.max(240, 255 - Math.floor(distance / 5));
      data.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  const result = diagnoseBackground(data, width, height);
  assert.equal(result.status, STATUS.FAIL);
  assert.ok(result.exact_white_ratio < 1);
});

test('inspectImage reports corrupt and missing files as hard decode failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zeely-corrupt-'));
  const corruptPath = path.join(root, 'corrupt.png');
  await writeFile(corruptPath, 'not a png');
  const corrupt = await inspectImage(corruptPath);
  const missing = await inspectImage(path.join(root, 'missing.png'));
  assert.equal(corrupt.technical_gates.decode.status, STATUS.FAIL);
  assert.equal(corrupt.technical_gates.png.status, STATUS.FAIL);
  assert.equal(missing.technical_gates.decode.status, STATUS.FAIL);
  assert.equal(missing.sha256, null);
});

test('inspectImage flags an alpha channel without modifying the image', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zeely-alpha-'));
  const filePath = path.join(root, 'alpha.png');
  await png(filePath, { r: 255, g: 255, b: 255, alpha: 0.5 }, { alpha: true });
  const before = await readFile(filePath);
  const result = await inspectImage(filePath);
  const after = await readFile(filePath);
  assert.equal(result.technical_gates.no_alpha.status, STATUS.FAIL);
  assert.deepEqual(after, before);
});

test('semantic criteria stay NEEDS_REVIEW without an explicit fixture', async () => {
  const root = await outputFixture();
  const summary = await verifyOutput({ outputDir: root });
  assert.equal(summary.status, STATUS.FAIL, '254 background is intentionally not exact #FFFFFF');
  const report = JSON.parse(await readFile(path.join(root, '001', 'qa-report.json'), 'utf8'));
  const identity = report.artifacts.avatar.notion_criteria.find(
    (criterion) => criterion.id === 'identity_preservation',
  );
  assert.equal(identity.status, STATUS.NEEDS_REVIEW);
  assert.equal(identity.source, 'missing_visual_review');
  assert.equal(report.artifacts.avatar.notion_criteria.length, 10);
});

test('explicit visual fixture controls semantic gates without self-approval', async () => {
  const root = await outputFixture();
  await sharp({ create: { width: 100, height: 125, channels: 3, background: '#ffffff' } })
    .composite([{
      input: { create: { width: 10, height: 10, channels: 3, background: '#000000' } },
      left: 45,
      top: 60,
    }])
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .png()
    .toFile(path.join(root, '001', 'avatar_outfit.png'));
  const criterionIds = [
    'identity_preservation',
    'frontal_half_body_composition',
    'studio_lighting',
    'neutral_white_balance',
    'face_hair_detail',
    'photorealism',
    'outfit_fidelity',
    'anatomy',
    'no_residue_or_bleed',
  ];
  const decisions = Object.fromEntries(
    criterionIds.map((id) => [id, { status: STATUS.PASS, reviewer: 'test-reviewer' }]),
  );
  const reviewPath = path.join(root, 'visual-review.json');
  await writeFile(reviewPath, JSON.stringify({
    schema_version: '1.0.0',
    reviews: { '001': { avatar: decisions, avatar_outfit: decisions } },
  }));
  const summary = await verifyOutput({ outputDir: root, visualReviewPath: reviewPath });
  assert.equal(summary.status, STATUS.PASS);
  const report = JSON.parse(await readFile(path.join(root, '001', 'qa-report.json'), 'utf8'));
  assert.equal(report.artifacts.avatar.notion_criteria[1].source, 'explicit_visual_review_fixture');
});

test('duplicate pair and dimension mismatch are hard failures', async () => {
  const root = await outputFixture();
  await png(path.join(root, '001', 'avatar_outfit.png'), { r: 255, g: 255, b: 255 }, { width: 80 });
  const summary = await verifyOutput({ outputDir: root });
  assert.equal(summary.status, STATUS.FAIL);
  const report = JSON.parse(await readFile(path.join(root, '001', 'qa-report.json'), 'utf8'));
  assert.equal(report.pair_checks.dimensions_match.status, STATUS.FAIL);
  assert.equal(report.pair_checks.aspect_ratio_parity.status, STATUS.FAIL);
});

test('identical bytes are reported as duplicates', async () => {
  const root = await outputFixture();
  const avatar = await readFile(path.join(root, '001', 'avatar.png'));
  await writeFile(path.join(root, '001', 'avatar_outfit.png'), avatar);
  await verifyOutput({ outputDir: root });
  const report = JSON.parse(await readFile(path.join(root, '001', 'qa-report.json'), 'utf8'));
  assert.equal(report.pair_checks.nonduplicate.status, STATUS.FAIL);
});
