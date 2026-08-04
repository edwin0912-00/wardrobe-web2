import sharp from 'sharp';

import { bboxToPixels } from './bbox.mjs';
import { ConditioningError, invariant } from './errors.mjs';
import { sha256Bytes } from './hash-lineage.mjs';
import { readInputBytes } from './input.mjs';
import { inspectImageMetadata } from './metadata.mjs';

async function alphaIsMeaningful(buffer) {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.hasAlpha) return false;
  const stats = await sharp(buffer).stats();
  const alpha = stats.channels[metadata.channels - 1];
  return alpha.min < 255;
}

async function replaceAlpha(imageBuffer, alphaMask, width, height, allowAlphaMaskResize) {
  const maskBytes = await readInputBytes(alphaMask);
  const maskMetadata = await inspectImageMetadata(maskBytes);
  const dimensionsMatch = maskMetadata.display_width === width && maskMetadata.display_height === height;
  if (!dimensionsMatch && !allowAlphaMaskResize) {
    throw new ConditioningError(
      'ALPHA_MASK_DIMENSIONS_MISMATCH',
      'alphaMask must match the canonical crop dimensions unless allowAlphaMaskResize is explicit.',
      {
        expected: [width, height],
        actual: [maskMetadata.display_width, maskMetadata.display_height],
      },
    );
  }
  let maskPipeline = sharp(maskBytes, { failOn: 'error' }).rotate();
  if (!dimensionsMatch) {
    maskPipeline = maskPipeline.resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 });
  }
  const alphaRaw = await maskPipeline.greyscale().raw().toBuffer();
  const rgbRaw = await sharp(imageBuffer)
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer();
  const rgba = Buffer.allocUnsafe(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const rgbOffset = pixel * 3;
    const rgbaOffset = pixel * 4;
    rgba[rgbaOffset] = rgbRaw[rgbOffset];
    rgba[rgbaOffset + 1] = rgbRaw[rgbOffset + 1];
    rgba[rgbaOffset + 2] = rgbRaw[rgbOffset + 2];
    rgba[rgbaOffset + 3] = alphaRaw[pixel];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function trimTransparentMargins(buffer) {
  try {
    return await sharp(buffer)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return buffer;
  }
}

/**
 * Makes a canonical item artifact and white review card. Isolation must come
 * from source alpha, an explicit alpha mask, or an explicit bbox; no background
 * removal model is hidden inside this function.
 */
export async function createGarmentReferenceAssets(input, options = {}) {
  const {
    bbox = null,
    alphaMask = null,
    allowFullImage = false,
    cardWidth = 1024,
    cardHeight = 1024,
    cardPadding = 64,
    cardBackground = { r: 255, g: 255, b: 255, alpha: 1 },
    allowCardUpscale = false,
    allowAlphaMaskResize = false,
  } = options;
  invariant(Number.isInteger(cardWidth) && cardWidth > 0, 'INVALID_CARD_SIZE', 'cardWidth must be positive.');
  invariant(Number.isInteger(cardHeight) && cardHeight > 0, 'INVALID_CARD_SIZE', 'cardHeight must be positive.');
  invariant(Number.isInteger(cardPadding) && cardPadding >= 0, 'INVALID_CARD_PADDING', 'cardPadding must be non-negative.');
  invariant(cardPadding * 2 < cardWidth && cardPadding * 2 < cardHeight, 'INVALID_CARD_PADDING', 'cardPadding leaves no content area.');

  const bytes = await readInputBytes(input);
  const oriented = await sharp(bytes, { failOn: 'error' })
    .rotate()
    .toColourspace('srgb')
    .png({ compressionLevel: 9 })
    .toBuffer();
  const sourceMetadata = await inspectImageMetadata(oriented);

  let canonical = oriented;
  let bboxPixels = null;
  if (bbox !== null) {
    bboxPixels = bboxToPixels(bbox, sourceMetadata.display_width, sourceMetadata.display_height);
    canonical = await sharp(oriented).extract(bboxPixels).png({ compressionLevel: 9 }).toBuffer();
  }

  const canonicalMetadata = await inspectImageMetadata(canonical);
  const canonicalHasAlpha = await alphaIsMeaningful(canonical);
  let isolationMethod;
  let isIsolated;
  const warnings = [];
  if (alphaMask !== null) {
    canonical = await replaceAlpha(
      canonical,
      alphaMask,
      canonicalMetadata.display_width,
      canonicalMetadata.display_height,
      allowAlphaMaskResize,
    );
    canonical = await trimTransparentMargins(canonical);
    isolationMethod = 'EXPLICIT_ALPHA_MASK';
    isIsolated = true;
  } else if (canonicalHasAlpha) {
    canonical = await trimTransparentMargins(canonical);
    isolationMethod = 'SOURCE_ALPHA';
    isIsolated = true;
  } else if (bbox !== null) {
    isolationMethod = 'EXPLICIT_BBOX_CROP';
    isIsolated = false;
    warnings.push('BBOX_CROP_IS_NOT_PIXEL_LEVEL_SEGMENTATION');
  } else if (allowFullImage) {
    isolationMethod = 'FULL_IMAGE';
    isIsolated = false;
    warnings.push('GARMENT_NOT_ISOLATED');
  } else {
    throw new ConditioningError(
      'MISSING_GARMENT_ISOLATION',
      'Supply source alpha, alphaMask, or bbox. No segmentation model is run implicitly.',
    );
  }

  const innerWidth = cardWidth - cardPadding * 2;
  const innerHeight = cardHeight - cardPadding * 2;
  const resized = await sharp(canonical)
    .resize({
      width: innerWidth,
      height: innerHeight,
      fit: 'inside',
      withoutEnlargement: !allowCardUpscale,
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((cardWidth - resized.info.width) / 2);
  const top = Math.floor((cardHeight - resized.info.height) / 2);
  const card = await sharp({
    create: {
      width: cardWidth,
      height: cardHeight,
      channels: 4,
      background: cardBackground,
    },
  })
    .composite([{ input: resized.data, left, top }])
    .flatten({ background: cardBackground })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const finalMetadata = await inspectImageMetadata(canonical);
  return {
    cutout: {
      buffer: canonical,
      sha256: sha256Bytes(canonical),
      width: finalMetadata.display_width,
      height: finalMetadata.display_height,
      is_isolated: isIsolated,
      isolation_method: isolationMethod,
    },
    card: {
      buffer: card,
      sha256: sha256Bytes(card),
      width: cardWidth,
      height: cardHeight,
      background: cardBackground,
    },
    source: {
      raw_sha256: sha256Bytes(bytes),
      oriented_sha256: sourceMetadata.source_sha256,
      bbox_pixels: bboxPixels,
    },
    warnings,
    operations: [
      { type: 'AUTO_ORIENT' },
      { type: 'CONVERT_COLOR_SPACE', to: 'srgb' },
      { type: isolationMethod, bbox_pixels: bboxPixels },
      { type: 'CREATE_REFERENCE_CARD', width: cardWidth, height: cardHeight },
    ],
  };
}
