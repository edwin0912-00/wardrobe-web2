import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

function qualifies(data, offset, minimumChannel, maximumChroma) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  return Math.min(r, g, b) >= minimumChannel
    && Math.max(r, g, b) - Math.min(r, g, b) <= maximumChroma;
}

function isExactWhite(data, offset) {
  return data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255;
}

function enqueueIfEligible(index, data, visited, queue, minimumChannel, maximumChroma) {
  if (visited[index]) return;
  const offset = index * 3;
  if (!qualifies(data, offset, minimumChannel, maximumChroma)) return;
  visited[index] = 1;
  queue.push(index);
}

export function normalizeBorderConnectedWhitePixels(data, width, height, options = {}) {
  const minimumChannel = options.minimumChannel ?? 245;
  const maximumChroma = options.maximumChroma ?? 10;
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) {
    throw new TypeError('data must be a Buffer or Uint8Array');
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('width and height must be positive integers');
  }
  if (data.length !== width * height * 3) {
    throw new RangeError(`Expected ${width * height * 3} RGB bytes, got ${data.length}`);
  }
  if (!Number.isInteger(minimumChannel) || minimumChannel < 0 || minimumChannel > 255) {
    throw new RangeError('minimumChannel must be an integer in [0, 255]');
  }
  if (!Number.isInteger(maximumChroma) || maximumChroma < 0 || maximumChroma > 255) {
    throw new RangeError('maximumChroma must be an integer in [0, 255]');
  }

  const result = Buffer.from(data);
  const visited = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x += 1) {
    enqueueIfEligible(x, result, visited, queue, minimumChannel, maximumChroma);
    enqueueIfEligible((height - 1) * width + x, result, visited, queue, minimumChannel, maximumChroma);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueueIfEligible(y * width, result, visited, queue, minimumChannel, maximumChroma);
    enqueueIfEligible(y * width + width - 1, result, visited, queue, minimumChannel, maximumChroma);
  }

  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const index = queue[queueIndex++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueueIfEligible(index - 1, result, visited, queue, minimumChannel, maximumChroma);
    if (x + 1 < width) enqueueIfEligible(index + 1, result, visited, queue, minimumChannel, maximumChroma);
    if (y > 0) enqueueIfEligible(index - width, result, visited, queue, minimumChannel, maximumChroma);
    if (y + 1 < height) enqueueIfEligible(index + width, result, visited, queue, minimumChannel, maximumChroma);
  }

  let exactWhiteBefore = 0;
  let exactWhiteAfter = 0;
  let changedPixels = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3;
    const beforeWhite = isExactWhite(result, offset);
    if (beforeWhite) exactWhiteBefore += 1;
    if (visited[index] && !beforeWhite) {
      result[offset] = 255;
      result[offset + 1] = 255;
      result[offset + 2] = 255;
      changedPixels += 1;
    }
    if (isExactWhite(result, offset)) exactWhiteAfter += 1;
  }

  return {
    data: result,
    stats: {
      width,
      height,
      total_pixels: width * height,
      connected_eligible_pixels: queue.length,
      changed_pixels: changedPixels,
      exact_white_pixels_before: exactWhiteBefore,
      exact_white_pixels_after: exactWhiteAfter,
      minimum_channel: minimumChannel,
      maximum_chroma: maximumChroma,
      connectivity: 4,
    },
  };
}

export async function normalizeWhitePngBytes(input, options = {}) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new TypeError('input must be a Buffer or Uint8Array containing PNG bytes');
  }
  const sourceBytes = Buffer.from(input);
  const source = sharp(sourceBytes, { failOn: 'error' });
  const metadata = await source.metadata();
  if (metadata.format !== 'png') throw new Error('Generated image is not PNG');
  if (String(metadata.space).toLowerCase() !== 'srgb') throw new Error('Generated PNG is not sRGB');
  if (metadata.hasAlpha || metadata.channels === 2 || metadata.channels === 4) {
    throw new Error('Generated PNG has an alpha channel; refusing implicit flattening');
  }

  const { data, info } = await source
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Expected RGB pixels, got ${info.channels} channels`);

  const normalized = normalizeBorderConnectedWhitePixels(data, info.width, info.height, options);
  if (normalized.stats.changed_pixels === 0) {
    return {
      image: sourceBytes,
      wrote_output: false,
      stats: normalized.stats,
    };
  }

  const image = await sharp(normalized.data, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .toColourspace('srgb')
    .removeAlpha()
    .png()
    .toBuffer();
  const outputMetadata = await sharp(image, { failOn: 'error' }).metadata();
  if (
    outputMetadata.width !== metadata.width
    || outputMetadata.height !== metadata.height
    || outputMetadata.format !== 'png'
    || String(outputMetadata.space).toLowerCase() !== 'srgb'
    || outputMetadata.hasAlpha
  ) {
    throw new Error('Normalized output failed metadata invariants');
  }

  return {
    image,
    wrote_output: true,
    stats: normalized.stats,
  };
}

export async function normalizeWhiteFile(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const sourceBytes = await readFile(resolvedPath);
  const source = sharp(sourceBytes, { failOn: 'error' });
  const metadata = await source.metadata();
  if (metadata.format !== 'png') throw new Error(`${resolvedPath} is not PNG`);
  if (String(metadata.space).toLowerCase() !== 'srgb') throw new Error(`${resolvedPath} is not sRGB`);
  if (metadata.hasAlpha || metadata.channels === 2 || metadata.channels === 4) {
    throw new Error(`${resolvedPath} has an alpha channel; refusing implicit flattening`);
  }
  const { data, info } = await source.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Expected RGB pixels, got ${info.channels} channels`);

  const normalized = normalizeBorderConnectedWhitePixels(data, info.width, info.height, options);
  let backupPath = null;
  if (options.backup) {
    const backupDir = options.backupDir
      ? path.resolve(options.backupDir)
      : path.join(path.dirname(resolvedPath), 'candidates');
    await mkdir(backupDir, { recursive: true });
    backupPath = path.join(
      backupDir,
      `${path.basename(resolvedPath, path.extname(resolvedPath))}.pre-white.png`,
    );
    try {
      await copyFile(resolvedPath, backupPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }

  if (normalized.stats.changed_pixels > 0) {
    const temporaryPath = path.join(
      path.dirname(resolvedPath),
      `.${path.basename(resolvedPath)}.${process.pid}.${Date.now()}.tmp.png`,
    );
    try {
      await sharp(normalized.data, {
        raw: { width: info.width, height: info.height, channels: 3 },
      })
        .toColourspace('srgb')
        .removeAlpha()
        .png()
        .toFile(temporaryPath);
      const outputMetadata = await sharp(temporaryPath, { failOn: 'error' }).metadata();
      if (
        outputMetadata.width !== metadata.width
        || outputMetadata.height !== metadata.height
        || outputMetadata.format !== 'png'
        || String(outputMetadata.space).toLowerCase() !== 'srgb'
        || outputMetadata.hasAlpha
      ) {
        throw new Error('Normalized output failed metadata invariants');
      }
      await rename(temporaryPath, resolvedPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  return {
    path: resolvedPath,
    backup_path: backupPath,
    wrote_output: normalized.stats.changed_pixels > 0,
    ...normalized.stats,
  };
}
