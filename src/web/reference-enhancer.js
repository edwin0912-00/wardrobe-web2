import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const REFERENCE_MIN_EDGE = 256;
const MAX_PREPARED_EDGE = 4_096;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function referenceDisplayDimensions(metadata) {
  const rotated = [5, 6, 7, 8].includes(metadata?.orientation);
  return rotated
    ? { width: metadata?.height, height: metadata?.width }
    : { width: metadata?.width, height: metadata?.height };
}

export function isLowResolution(metadata, minimumEdge = REFERENCE_MIN_EDGE) {
  const { width, height } = referenceDisplayDimensions(metadata);
  return Number.isInteger(width) && Number.isInteger(height)
    && (width < minimumEdge || height < minimumEdge);
}

async function atomicWrite(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  await rename(temporary, filename);
}

/**
 * Creates a transport-ready derivative without claiming to recover detail.
 * The source is never overwritten. Very small inputs are still carried into
 * semantic QA; unreadable facts must remain UNKNOWN/NOT_EVALUABLE there.
 */
export async function prepareReferenceFile({
  sourcePath,
  outputPath,
  minimumEdge = REFERENCE_MIN_EDGE,
  maxPreparedEdge = MAX_PREPARED_EDGE,
} = {}) {
  const resolvedSource = path.resolve(sourcePath);
  const source = await readFile(resolvedSource);
  const metadata = await sharp(source, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
  const sourceDimensions = referenceDisplayDimensions(metadata);
  if (!Number.isInteger(sourceDimensions.width) || !Number.isInteger(sourceDimensions.height)
    || sourceDimensions.width < 1 || sourceDimensions.height < 1 || (metadata.pages ?? 1) !== 1) {
    throw new Error('Reference enhancement requires one decodable still image with dimensions');
  }
  const sourceSha256 = sha256(source);
  if (!isLowResolution(metadata, minimumEdge)) {
    return {
      status: 'ORIGINAL',
      source_path: resolvedSource,
      prepared_path: resolvedSource,
      source_sha256: sourceSha256,
      prepared_sha256: sourceSha256,
      source_width: sourceDimensions.width,
      source_height: sourceDimensions.height,
      prepared_width: sourceDimensions.width,
      prepared_height: sourceDimensions.height,
      scale: 1,
      operations: [],
      synthetic: false,
      new_detail_authority: false,
    };
  }

  const requestedScale = Math.max(
    minimumEdge / sourceDimensions.width,
    minimumEdge / sourceDimensions.height,
  );
  const boundedScale = Math.min(requestedScale, maxPreparedEdge / Math.max(
    sourceDimensions.width,
    sourceDimensions.height,
  ));
  const resizedWidth = Math.max(1, Math.ceil(sourceDimensions.width * boundedScale));
  const resizedHeight = Math.max(1, Math.ceil(sourceDimensions.height * boundedScale));
  const canvasWidth = Math.max(minimumEdge, resizedWidth);
  const canvasHeight = Math.max(minimumEdge, resizedHeight);
  const left = Math.floor((canvasWidth - resizedWidth) / 2);
  const right = canvasWidth - resizedWidth - left;
  const top = Math.floor((canvasHeight - resizedHeight) / 2);
  const bottom = canvasHeight - resizedHeight - top;

  let pipeline = sharp(source, { failOn: 'error', limitInputPixels: 100_000_000 })
    .rotate()
    .toColourspace('srgb')
    .resize({
      width: resizedWidth,
      height: resizedHeight,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    });
  if (left || right || top || bottom) {
    pipeline = pipeline.extend({
      left, right, top, bottom,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
  }
  const prepared = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  const preparedMetadata = await sharp(prepared, { failOn: 'error' }).metadata();
  if (preparedMetadata.width < minimumEdge || preparedMetadata.height < minimumEdge
    || preparedMetadata.width > maxPreparedEdge || preparedMetadata.height > maxPreparedEdge) {
    throw new Error('Prepared reference dimensions are outside the bounded transport policy');
  }
  const resolvedOutput = path.resolve(outputPath);
  await atomicWrite(resolvedOutput, prepared);
  return {
    status: 'ENHANCED',
    source_path: resolvedSource,
    prepared_path: resolvedOutput,
    source_sha256: sourceSha256,
    prepared_sha256: sha256(prepared),
    source_width: sourceDimensions.width,
    source_height: sourceDimensions.height,
    prepared_width: preparedMetadata.width,
    prepared_height: preparedMetadata.height,
    scale: Number(boundedScale.toFixed(6)),
    requested_scale: Number(requestedScale.toFixed(6)),
    scale_capped: boundedScale < requestedScale,
    operations: [
      'AUTO_ORIENT',
      'CONVERT_TO_SRGB',
      'LANCZOS3_UPSCALE',
      ...(left || right || top || bottom ? ['WHITE_CANVAS_PAD'] : []),
      'PNG_ENCODE',
    ],
    synthetic: false,
    new_detail_authority: false,
  };
}
