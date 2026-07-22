import sharp from 'sharp';

import { invariant } from './errors.mjs';
import { sha256Bytes } from './hash-lineage.mjs';
import { readInputBytes } from './input.mjs';
import { inspectImageMetadata } from './metadata.mjs';

export function planConservativeResize(
  { width, height },
  {
    targetLongEdge = 2048,
    maxLongEdge = 4096,
    maxUpscaleFactor = 2,
    allowUpscale = true,
  } = {},
) {
  invariant(Number.isInteger(width) && width > 0, 'INVALID_SOURCE_SIZE', 'width must be a positive integer.');
  invariant(Number.isInteger(height) && height > 0, 'INVALID_SOURCE_SIZE', 'height must be a positive integer.');
  invariant(targetLongEdge > 0 && maxLongEdge > 0, 'INVALID_RESIZE_POLICY', 'Long-edge limits must be positive.');
  invariant(maxUpscaleFactor >= 1, 'INVALID_RESIZE_POLICY', 'maxUpscaleFactor must be >= 1.');

  const sourceLongEdge = Math.max(width, height);
  let scale = 1;
  let reason = 'UNCHANGED';
  if (sourceLongEdge > maxLongEdge) {
    scale = maxLongEdge / sourceLongEdge;
    reason = 'DOWNSCALED_TO_MAX';
  } else if (allowUpscale && sourceLongEdge < targetLongEdge) {
    const requestedScale = targetLongEdge / sourceLongEdge;
    scale = Math.min(requestedScale, maxUpscaleFactor);
    reason = scale < requestedScale ? 'UPSCALE_CAPPED' : 'UPSCALED_TO_TARGET';
  }

  return {
    source_width: width,
    source_height: height,
    output_width: Math.max(1, Math.round(width * scale)),
    output_height: Math.max(1, Math.round(height * scale)),
    scale: Number(scale.toFixed(6)),
    reason,
    target_reached: sourceLongEdge * scale >= targetLongEdge,
  };
}

function encode(pipeline, format, options) {
  if (format === 'png') return pipeline.png({ compressionLevel: options.pngCompressionLevel ?? 9 });
  if (format === 'jpeg') {
    return pipeline.jpeg({ quality: options.jpegQuality ?? 95, chromaSubsampling: '4:4:4' });
  }
  if (format === 'webp') return pipeline.webp({ quality: options.webpQuality ?? 95, smartSubsample: true });
  throw new TypeError(`Unsupported normalized output format: ${format}`);
}

/** Auto-orients, converts to sRGB and applies only the configured bounded resize. */
export async function normalizeReference(input, options = {}) {
  const bytes = await readInputBytes(input);
  const before = await inspectImageMetadata(bytes);
  const resizePlan = planConservativeResize(
    { width: before.display_width, height: before.display_height },
    options,
  );
  const format = options.format ?? 'png';

  let pipeline = sharp(bytes, { failOn: 'error' })
    .rotate()
    .toColourspace('srgb');
  if (resizePlan.scale !== 1) {
    pipeline = pipeline.resize({
      width: resizePlan.output_width,
      height: resizePlan.output_height,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    });
  }
  pipeline = encode(pipeline, format, options);
  const buffer = await pipeline.toBuffer();
  const after = await inspectImageMetadata(buffer);

  return {
    buffer,
    sha256: sha256Bytes(buffer),
    metadata_before: before,
    metadata_after: after,
    resize_plan: resizePlan,
    operations: [
      { type: 'AUTO_ORIENT', from_orientation: before.orientation },
      { type: 'CONVERT_COLOR_SPACE', to: 'srgb' },
      {
        type: 'CONSERVATIVE_RESIZE',
        scale: resizePlan.scale,
        reason: resizePlan.reason,
        interpolation: 'lanczos3',
      },
      { type: 'ENCODE', format },
    ],
  };
}
