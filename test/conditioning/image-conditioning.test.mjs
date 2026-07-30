import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { ConditioningError } from '../../src/conditioning/errors.mjs';
import { createGarmentReferenceAssets } from '../../src/conditioning/garment.mjs';
import { createHumanReferenceCrops } from '../../src/conditioning/human-crops.mjs';
import { assessImageQuality, inspectImageMetadata } from '../../src/conditioning/metadata.mjs';
import { normalizeReference, planConservativeResize } from '../../src/conditioning/normalize.mjs';
import { extractQualityTarget, measureSampleBackground } from '../../src/conditioning/quality-target.mjs';
import { removeBorderConnectedWhiteToAlpha } from '../../src/conditioning/transparent-cutout.mjs';

async function solid(width, height, background, channels = 3) {
  return sharp({ create: { width, height, channels, background } }).png().toBuffer();
}

test('quality assessment reports metadata, subject coverage, and bounded-upscale risk', async () => {
  const input = await solid(200, 100, { r: 90, g: 110, b: 130 });
  const report = await assessImageQuality(input, {
    hardMinWidth: 64,
    hardMinHeight: 64,
    preferredLongEdge: 1000,
    maxUpscaleFactor: 2,
    subjectBbox: [0.25, 0.25, 0.5, 0.5],
  });
  assert.equal(report.metadata.display_width, 200);
  assert.equal(report.metadata.display_height, 100);
  assert.equal(report.signals.subject_coverage, 0.25);
  assert.equal(report.resize_evidence.target_reachable, false);
  assert.ok(report.repairable_issues.some(({ code }) => code === 'BELOW_PREFERRED_RESOLUTION'));
  assert.ok(report.risks.some(({ code }) => code === 'RESOLUTION_TARGET_UNREACHABLE'));
});

test('resize planning caps upscale and preserves aspect ratio', () => {
  assert.deepEqual(planConservativeResize(
    { width: 100, height: 50 },
    { targetLongEdge: 1000, maxUpscaleFactor: 2 },
  ), {
    source_width: 100,
    source_height: 50,
    output_width: 200,
    output_height: 100,
    scale: 2,
    reason: 'UPSCALE_CAPPED',
    target_reached: false,
  });
});

test('normalization applies EXIF orientation, sRGB and conservative upscale', async () => {
  const input = await sharp({
    create: { width: 80, height: 40, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const before = await inspectImageMetadata(input);
  assert.equal(before.orientation, 6);
  assert.equal(before.display_width, 40);
  assert.equal(before.display_height, 80);

  const normalized = await normalizeReference(input, {
    targetLongEdge: 160,
    maxUpscaleFactor: 2,
    format: 'png',
  });
  assert.equal(normalized.metadata_after.display_width, 80);
  assert.equal(normalized.metadata_after.display_height, 160);
  assert.equal(normalized.metadata_after.orientation, 1);
  assert.equal(normalized.metadata_after.color_space, 'srgb');
});

test('human crops use caller bboxes and produce exact deterministic dimensions', async () => {
  const input = await solid(200, 100, { r: 100, g: 120, b: 140 });
  const result = await createHumanReferenceCrops(input, {
    faceBbox: [0.25, 0.2, 0.25, 0.4],
    personBbox: { x: 20, y: 10, width: 160, height: 90, unit: 'pixels' },
    detailBboxes: { hair: [0.2, 0.05, 0.4, 0.3] },
    facePaddingRatio: 0,
    personPaddingRatio: 0,
    detailPaddingRatio: 0,
    requiredCrops: ['face', 'person', 'hair'],
  });
  assert.equal(result.crops.face.width, 50);
  assert.equal(result.crops.face.height, 40);
  assert.equal(result.crops.person.width, 160);
  assert.equal(result.crops.hair.width, 80);
});

test('human crop refuses missing required bbox instead of guessing', async () => {
  const input = await solid(100, 100, { r: 10, g: 20, b: 30 });
  await assert.rejects(
    createHumanReferenceCrops(input, { requiredCrops: ['face'] }),
    (error) => error instanceof ConditioningError && error.code === 'MISSING_REQUIRED_BBOX',
  );
});

test('cutout removes a detached low-contrast background ghost without deleting real detached details', async () => {
  const input = await sharp({
    create: {
      width: 160,
      height: 120,
      channels: 3,
      background: { r: 250, g: 251, b: 246 },
    },
  })
    .composite([
      {
        input: await solid(42, 84, { r: 30, g: 42, b: 54 }),
        left: 82,
        top: 18,
      },
      {
        input: await solid(12, 12, { r: 55, g: 65, b: 70 }),
        left: 132,
        top: 94,
      },
      {
        input: await solid(20, 70, { r: 241, g: 242, b: 238 }),
        left: 18,
        top: 30,
      },
    ])
    .png()
    .toBuffer();
  const result = await removeBorderConnectedWhiteToAlpha(input, {
    removeDetachedLowContrastResidue: true,
  });
  const { data, info } = await sharp(result.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  assert.equal(alphaAt(20, 40), 0, 'the detached near-white ghost must be transparent');
  assert.equal(alphaAt(90, 40), 255, 'the primary subject must remain');
  assert.equal(alphaAt(136, 98), 255, 'a detached detail with real contrast must remain');
  assert.equal(result.stats.removed_residue_components, 1);
  assert.equal(result.stats.removed_residue_pixels, 20 * 70);
});

test('cutout never deletes the largest component when the primary garment is light', async () => {
  const input = await sharp({
    create: {
      width: 160,
      height: 120,
      channels: 3,
      background: { r: 250, g: 251, b: 246 },
    },
  })
    .composite([
      {
        input: await solid(42, 84, { r: 241, g: 242, b: 238 }),
        left: 82,
        top: 18,
      },
      {
        input: await solid(12, 12, { r: 55, g: 65, b: 70 }),
        left: 132,
        top: 94,
      },
    ])
    .png()
    .toBuffer();
  const result = await removeBorderConnectedWhiteToAlpha(input, {
    removeDetachedLowContrastResidue: true,
  });
  const { data, info } = await sharp(result.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  assert.equal(alphaAt(90, 40), 255, 'the largest light primary component must remain');
  assert.equal(alphaAt(136, 98), 255, 'the smaller dark detail must remain');
  assert.equal(result.stats.removed_residue_components, 0);
  assert.equal(result.stats.removed_residue_pixels, 0);
});

test('cutout preserves a nearby light detached garment detail', async () => {
  const input = await sharp({
    create: {
      width: 160,
      height: 120,
      channels: 3,
      background: { r: 250, g: 251, b: 246 },
    },
  })
    .composite([
      {
        input: await solid(42, 84, { r: 30, g: 42, b: 54 }),
        left: 82,
        top: 18,
      },
      {
        input: await solid(8, 12, { r: 241, g: 242, b: 238 }),
        left: 70,
        top: 50,
      },
    ])
    .png()
    .toBuffer();
  const result = await removeBorderConnectedWhiteToAlpha(input, {
    removeDetachedLowContrastResidue: true,
  });
  const { data, info } = await sharp(result.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  assert.equal(alphaAt(74, 56), 255, 'a nearby light garment detail must remain');
  assert.equal(result.stats.removed_residue_components, 0);
  assert.equal(result.stats.removed_residue_pixels, 0);
});

test('garment source alpha creates an isolated cutout and exact-white review card', async () => {
  const redPatch = await solid(20, 20, { r: 220, g: 20, b: 30, alpha: 1 }, 4);
  const input = await sharp({
    create: { width: 60, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: redPatch, left: 20, top: 10 }])
    .png()
    .toBuffer();
  const result = await createGarmentReferenceAssets(input, {
    cardWidth: 100,
    cardHeight: 100,
    cardPadding: 10,
  });
  assert.equal(result.cutout.is_isolated, true);
  assert.equal(result.cutout.isolation_method, 'SOURCE_ALPHA');
  assert.equal(result.card.width, 100);
  const corner = await sharp(result.card.buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...corner.subarray(0, 3)], [255, 255, 255]);
});

test('opaque garment bbox creates a canonical crop but reports no pixel isolation', async () => {
  const input = await solid(100, 80, { r: 30, g: 180, b: 70 });
  const result = await createGarmentReferenceAssets(input, {
    bbox: { x: 20, y: 10, width: 30, height: 40, unit: 'pixels' },
    cardWidth: 80,
    cardHeight: 80,
    cardPadding: 5,
  });
  assert.equal(result.cutout.width, 30);
  assert.equal(result.cutout.height, 40);
  assert.equal(result.cutout.is_isolated, false);
  assert.deepEqual(result.warnings, ['BBOX_CROP_IS_NOT_PIXEL_LEVEL_SEGMENTATION']);
});

test('explicit alpha mask creates a real isolated cutout without a segmentation model', async () => {
  const width = 40;
  const height = 20;
  const input = await solid(width, height, { r: 40, g: 80, b: 220 });
  const maskPixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = width / 2; x < width; x += 1) maskPixels[y * width + x] = 255;
  }
  const alphaMask = await sharp(maskPixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const result = await createGarmentReferenceAssets(input, {
    alphaMask,
    cardWidth: 80,
    cardHeight: 80,
    cardPadding: 5,
  });
  assert.equal(result.cutout.is_isolated, true);
  assert.equal(result.cutout.isolation_method, 'EXPLICIT_ALPHA_MASK');
  assert.equal(result.cutout.width, 20);
  assert.equal(result.cutout.height, 20);
});

test('alpha-mask geometry mismatch is rejected unless resize is explicitly enabled', async () => {
  const input = await solid(40, 20, { r: 40, g: 80, b: 220 });
  const alphaMask = await solid(10, 10, { r: 255, g: 255, b: 255 });
  await assert.rejects(
    createGarmentReferenceAssets(input, { alphaMask }),
    (error) => error instanceof ConditioningError && error.code === 'ALPHA_MASK_DIMENSIONS_MISMATCH',
  );
});

test('opaque garment without alpha or bbox is rejected', async () => {
  const input = await solid(100, 80, { r: 30, g: 180, b: 70 });
  await assert.rejects(
    createGarmentReferenceAssets(input),
    (error) => error instanceof ConditioningError && error.code === 'MISSING_GARMENT_ISOLATION',
  );
});

test('written quality rules override off-white sample pixels', async () => {
  const sample = await solid(100, 100, { r: 240, g: 242, b: 244 });
  const measured = await measureSampleBackground(sample);
  assert.equal(measured.background_color, '#F0F2F4');

  const target = await extractQualityTarget({
    sampleImage: sample,
    writtenRules: [
      'Background must be exact #FFFFFF.',
      'Full-length head to soles, neutral frontal pose.',
      'Soft diffused studio lighting, neutral white balance, photorealistic with natural skin, hair and fabric.',
    ],
  });
  assert.equal(target.values.background_color, '#FFFFFF');
  assert.equal(target.provenance.background_color, 'WRITTEN_RULE');
  assert.equal(target.values.framing, 'FULL_LENGTH_HEAD_TO_SOLES');
  assert.equal(target.values.pose, 'NEUTRAL_FRONTAL');
  assert.equal(target.values.lighting, 'SOFT_DIFFUSED_STUDIO');
  assert.equal(target.values.white_balance, 'NEUTRAL');
  assert.equal(target.values.finish, 'PHOTOREALISTIC');
  assert.ok(target.conflicts.some(({ field, resolution }) => (
    field === 'background_color' && resolution === 'WRITTEN_RULE_WINS'
  )));
});
