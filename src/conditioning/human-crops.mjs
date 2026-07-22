import sharp from 'sharp';

import { bboxToPixels } from './bbox.mjs';
import { ConditioningError, invariant } from './errors.mjs';
import { sha256Bytes } from './hash-lineage.mjs';
import { readInputBytes } from './input.mjs';
import { inspectImageMetadata } from './metadata.mjs';

async function extractPng(orientedBuffer, bbox, width, height, paddingRatio) {
  const pixels = bboxToPixels(bbox, width, height, { paddingRatio });
  const buffer = await sharp(orientedBuffer)
    .extract(pixels)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    buffer,
    sha256: sha256Bytes(buffer),
    bbox_pixels: pixels,
    width: pixels.width,
    height: pixels.height,
  };
}

/**
 * Creates evidence crops from caller-supplied bboxes in display-oriented image
 * coordinates. No face/person detector is invoked and no bbox is inferred.
 */
export async function createHumanReferenceCrops(input, options = {}) {
  const {
    faceBbox = null,
    personBbox = null,
    detailBboxes = {},
    facePaddingRatio = 0.2,
    personPaddingRatio = 0.03,
    detailPaddingRatio = 0.05,
    requiredCrops = ['face'],
  } = options;
  invariant(Array.isArray(requiredCrops), 'INVALID_REQUIRED_CROPS', 'requiredCrops must be an array.');
  invariant(detailBboxes && typeof detailBboxes === 'object' && !Array.isArray(detailBboxes), 'INVALID_DETAIL_BBOXES', 'detailBboxes must be an object.');

  const configured = {
    ...(faceBbox ? { face: faceBbox } : {}),
    ...(personBbox ? { person: personBbox } : {}),
    ...detailBboxes,
  };
  const missing = requiredCrops.filter((name) => configured[name] == null);
  if (missing.length > 0) {
    throw new ConditioningError(
      'MISSING_REQUIRED_BBOX',
      `Explicit bbox required for: ${missing.join(', ')}. No ML detector is run implicitly.`,
      { missing },
    );
  }

  const bytes = await readInputBytes(input);
  const orientedBuffer = await sharp(bytes, { failOn: 'error' })
    .rotate()
    .toColourspace('srgb')
    .png({ compressionLevel: 9 })
    .toBuffer();
  const source = await inspectImageMetadata(orientedBuffer);

  const entries = Object.entries(configured);
  const cropEntries = await Promise.all(entries.map(async ([name, bbox]) => {
    const paddingRatio = name === 'face'
      ? facePaddingRatio
      : name === 'person'
        ? personPaddingRatio
        : detailPaddingRatio;
    const crop = await extractPng(
      orientedBuffer,
      bbox,
      source.display_width,
      source.display_height,
      paddingRatio,
    );
    return [name, crop];
  }));

  return {
    source: {
      width: source.display_width,
      height: source.display_height,
      raw_sha256: sha256Bytes(bytes),
      oriented_sha256: source.source_sha256,
      coordinate_space: 'DISPLAY_ORIENTED',
    },
    crops: Object.fromEntries(cropEntries),
    operations: cropEntries.map(([name, crop]) => ({
      type: 'EXPLICIT_BBOX_CROP',
      role: name,
      bbox_pixels: crop.bbox_pixels,
    })),
  };
}
