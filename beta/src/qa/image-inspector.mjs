import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { STATUS } from './constants.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function ratio(count, total) {
  return total === 0 ? 0 : Number((count / total).toFixed(6));
}

function isNearWhite(data, offset, minimumChannel, maximumChroma) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  return Math.min(r, g, b) >= minimumChannel
    && Math.max(r, g, b) - Math.min(r, g, b) <= maximumChroma;
}

function isExactWhite(data, offset) {
  return data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255;
}

export function diagnoseBackground(data, width, height, channels = 3, options = {}) {
  const minimumChannel = options.minimumChannel ?? 245;
  const maximumChroma = options.maximumChroma ?? 10;
  const minCornerCoverage = options.minCornerCoverage ?? 0.9;
  // Some archival/general-purpose inspection callers intentionally analyse a
  // crop that reaches the bottom edge. Master avatar/outfit generation opts
  // into the strict key-surface contract explicitly below in PipelineRunner.
  const requireBottomCorners = options.requireBottomCorners ?? false;
  const minSideCoverage = options.minSideCoverage ?? 0.75;
  const minImageCoverage = options.minImageCoverage ?? 0.12;
  const cornerWidth = Math.max(1, Math.floor(width * 0.08));
  const cornerHeight = Math.max(1, Math.floor(height * 0.08));
  const sideWidth = Math.max(1, Math.floor(width * 0.04));
  const seedWidth = Math.max(cornerWidth, Math.floor(width * 0.2));
  const seedHeight = Math.max(cornerHeight, Math.floor(height * 0.2));
  const pixelCount = width * height;
  const connected = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueRead = 0;
  let queueWrite = 0;

  const enqueue = (index) => {
    if (connected[index]) return;
    if (!isNearWhite(data, index * channels, minimumChannel, maximumChroma)) return;
    connected[index] = 1;
    queue[queueWrite++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    if (x < seedWidth || x >= width - seedWidth) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
  }
  for (let y = 0; y < height; y += 1) {
    if (y < seedHeight || y >= height - seedHeight) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }
  }

  while (queueRead < queueWrite) {
    const index = queue[queueRead++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const cornerStats = {
    top_left: [0, 0],
    top_right: [0, 0],
    bottom_left: [0, 0],
    bottom_right: [0, 0],
  };
  let exactWhite = 0;
  let chromaSum = 0;
  let leftSideConnected = 0;
  let rightSideConnected = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x < cornerWidth && y < cornerHeight) cornerStats.top_left[1] += 1;
      if (x >= width - cornerWidth && y < cornerHeight) cornerStats.top_right[1] += 1;
      if (x < cornerWidth && y >= height - cornerHeight) cornerStats.bottom_left[1] += 1;
      if (x >= width - cornerWidth && y >= height - cornerHeight) cornerStats.bottom_right[1] += 1;
      if (!connected[index]) continue;
      const offset = index * channels;
      if (isExactWhite(data, offset)) exactWhite += 1;
      chromaSum += Math.max(data[offset], data[offset + 1], data[offset + 2])
        - Math.min(data[offset], data[offset + 1], data[offset + 2]);
      if (x < sideWidth) leftSideConnected += 1;
      if (x >= width - sideWidth) rightSideConnected += 1;
      if (x < cornerWidth && y < cornerHeight) cornerStats.top_left[0] += 1;
      if (x >= width - cornerWidth && y < cornerHeight) cornerStats.top_right[0] += 1;
      if (x < cornerWidth && y >= height - cornerHeight) cornerStats.bottom_left[0] += 1;
      if (x >= width - cornerWidth && y >= height - cornerHeight) cornerStats.bottom_right[0] += 1;
    }
  }

  const cornerCoverage = Object.fromEntries(
    Object.entries(cornerStats).map(([name, [classified, total]]) => [name, ratio(classified, total)]),
  );
  const minimumObservedTopCornerCoverage = Math.min(
    cornerCoverage.top_left,
    cornerCoverage.top_right,
  );
  const minimumObservedBottomCornerCoverage = Math.min(
    cornerCoverage.bottom_left,
    cornerCoverage.bottom_right,
  );
  const leftSideCoverage = ratio(leftSideConnected, sideWidth * height);
  const rightSideCoverage = ratio(rightSideConnected, sideWidth * height);
  const minimumObservedSideCoverage = Math.min(leftSideCoverage, rightSideCoverage);
  const maximumObservedSideCoverage = Math.max(leftSideCoverage, rightSideCoverage);
  const imageCoverage = ratio(queueWrite, pixelCount);
  const exactWhiteRatio = ratio(exactWhite, queueWrite);
  const everyClassifiedPixelExactWhite = queueWrite > 0 && exactWhite === queueWrite;
  const sufficientCoverage = minimumObservedTopCornerCoverage >= minCornerCoverage
    // A valid standing subject can occupy or touch one full-height side of the
    // frame with a relaxed arm, a hip or a contact shadow. Requiring both side
    // strips to be background falsely rejects broad or slightly asymmetric
    // people. Both top corners remain mandatory; one substantially open side
    // plus total image coverage proves that the corner-seeded component is a
    // real background rather than isolated specks.
    && maximumObservedSideCoverage >= minSideCoverage
    && imageCoverage >= minImageCoverage
    && (!requireBottomCorners || minimumObservedBottomCornerCoverage >= minCornerCoverage);

  return {
    method: 'corner-seeded_4-connected_near-white_background',
    classified_background_pixels: queueWrite,
    sampled_pixels: queueWrite,
    exact_white_pixels: exactWhite,
    exact_white_ratio: exactWhiteRatio,
    every_classified_background_pixel_exact_white: everyClassifiedPixelExactWhite,
    near_white_definition: `min(R,G,B) >= ${minimumChannel} and channel chroma <= ${maximumChroma}`,
    mean_classified_background_chroma: queueWrite === 0
      ? null
      : Number((chromaSum / queueWrite).toFixed(4)),
    coverage: {
      image: imageCoverage,
      corners: cornerCoverage,
      minimum_top_corner: minimumObservedTopCornerCoverage,
      minimum_bottom_corner: minimumObservedBottomCornerCoverage,
      bottom_corners_are_required: requireBottomCorners,
      left_side: leftSideCoverage,
      right_side: rightSideCoverage,
      minimum_side: minimumObservedSideCoverage,
      maximum_side: maximumObservedSideCoverage,
      gated_side_metric: 'maximum(left_side,right_side)',
    },
    thresholds: {
      exact_white_ratio_required: 1,
      minimum_channel: minimumChannel,
      maximum_chroma: maximumChroma,
      minimum_top_corner_coverage: minCornerCoverage,
      minimum_bottom_corner_coverage: requireBottomCorners ? minCornerCoverage : null,
      minimum_one_side_coverage: minSideCoverage,
      minimum_image_coverage: minImageCoverage,
    },
    status: everyClassifiedPixelExactWhite && sufficientCoverage ? STATUS.PASS : STATUS.FAIL,
    note: requireBottomCorners
      ? 'All four corners and at least one full-height side are gated. The master output requires a visible exact-white margin around the entire figure, including beneath the soles; presentation shadows belong in UI, not in the keyable source image. Central pixels are not seeds, so hair, clothing or footwear is not mislabeled as background. The source image is never modified.'
      : 'Both top corners and at least one full-height side are gated. Central and bottom pixels are not seeds, so hair, clothing or footwear is not mislabeled as background. The source image is never modified.',
  };
}

export async function inspectImage(filePath, options = {}) {
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      path: filePath,
      sha256: null,
      byte_size: null,
      decoded: false,
      decode_error: message,
      technical_gates: {
        decode: { status: STATUS.FAIL, observed: message },
        png: { status: STATUS.FAIL, observed: null },
        srgb: { status: STATUS.FAIL, observed: null },
        no_alpha: { status: STATUS.FAIL, observed: null },
      },
      background_diagnostics: null,
    };
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const hasPngSignature = bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);

  let metadata;
  let raw;
  let decodeError = null;
  try {
    const instance = sharp(bytes, { failOn: 'error' });
    metadata = await instance.metadata();
    raw = await instance.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    decodeError = error instanceof Error ? error.message : String(error);
  }

  if (decodeError || !metadata || !raw) {
    return {
      path: filePath,
      sha256,
      byte_size: bytes.length,
      decoded: false,
      decode_error: decodeError ?? 'Image metadata unavailable',
      technical_gates: {
        decode: { status: STATUS.FAIL, observed: decodeError },
        png: { status: hasPngSignature ? STATUS.PASS : STATUS.FAIL, observed: hasPngSignature },
        srgb: { status: STATUS.FAIL, observed: null },
        no_alpha: { status: STATUS.FAIL, observed: null },
      },
      background_diagnostics: null,
    };
  }

  const { data, info } = raw;
  const backgroundDiagnostics = diagnoseBackground(
    data,
    info.width,
    info.height,
    info.channels,
    options,
  );
  const channels = metadata.channels ?? info.channels;
  const hasAlpha = Boolean(metadata.hasAlpha) || channels === 2 || channels === 4;
  const colorSpace = String(metadata.space ?? '').toLowerCase();

  return {
    path: filePath,
    sha256,
    byte_size: bytes.length,
    decoded: true,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    aspect_ratio: Number((metadata.width / metadata.height).toFixed(8)),
    color_space: metadata.space,
    channels,
    has_alpha: hasAlpha,
    technical_gates: {
      decode: { status: STATUS.PASS, observed: true },
      png: {
        status: metadata.format === 'png' && hasPngSignature ? STATUS.PASS : STATUS.FAIL,
        observed: metadata.format,
      },
      srgb: {
        status: colorSpace === 'srgb' ? STATUS.PASS : STATUS.FAIL,
        observed: metadata.space,
      },
      no_alpha: {
        status: hasAlpha ? STATUS.FAIL : STATUS.PASS,
        observed: hasAlpha,
      },
    },
    background_diagnostics: backgroundDiagnostics,
  };
}
