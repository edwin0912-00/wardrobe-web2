import sharp from 'sharp';

import { bboxToPixels } from './bbox.mjs';
import { ConditioningError, invariant } from './errors.mjs';
import { sha256Bytes } from './hash-lineage.mjs';
import { readInputBytes } from './input.mjs';

function orientedDimensions(metadata) {
  const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation);
  return swapsAxes
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

function publicMetadata(metadata, byteLength, sourceSha256) {
  const display = orientedDimensions(metadata);
  return {
    format: metadata.format ?? null,
    mime_type: metadata.format ? `image/${metadata.format === 'jpg' ? 'jpeg' : metadata.format}` : null,
    source_width: metadata.width,
    source_height: metadata.height,
    display_width: display.width,
    display_height: display.height,
    orientation: metadata.orientation ?? 1,
    color_space: metadata.space ?? null,
    channels: metadata.channels ?? null,
    has_alpha: Boolean(metadata.hasAlpha),
    density: metadata.density ?? null,
    pages: metadata.pages ?? 1,
    byte_length: byteLength,
    source_sha256: sourceSha256,
  };
}

export async function inspectImageMetadata(input) {
  const bytes = await readInputBytes(input);
  try {
    const metadata = await sharp(bytes, { failOn: 'error', unlimited: false }).metadata();
    invariant(
      Number.isInteger(metadata.width) && Number.isInteger(metadata.height),
      'MISSING_DIMENSIONS',
      'Decoded image has no usable dimensions.',
    );
    return publicMetadata(metadata, bytes.length, sha256Bytes(bytes));
  } catch (error) {
    if (error instanceof ConditioningError) throw error;
    throw new ConditioningError('IMAGE_DECODE_FAILED', 'Unable to decode the image.', {
      cause: error.message,
    });
  }
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

async function pixelSignals(bytes, analysisMaxEdge) {
  const { data, info } = await sharp(bytes, { failOn: 'error' })
    .rotate()
    .toColourspace('srgb')
    .removeAlpha()
    .resize({
      width: analysisMaxEdge,
      height: analysisMaxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const luminance = new Array(info.width * info.height);
  let blackClipped = 0;
  let whiteClipped = 0;
  let sum = 0;
  let pixelIndex = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const value = Math.round(0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]);
    luminance[pixelIndex++] = value;
    sum += value;
    if (value <= 5) blackClipped += 1;
    if (value >= 250) whiteClipped += 1;
  }

  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x;
      if (x + 1 < info.width) {
        edgeTotal += Math.abs(luminance[index] - luminance[index + 1]);
        edgeCount += 1;
      }
      if (y + 1 < info.height) {
        edgeTotal += Math.abs(luminance[index] - luminance[index + info.width]);
        edgeCount += 1;
      }
    }
  }

  const sorted = [...luminance].sort((a, b) => a - b);
  const count = luminance.length;
  return {
    analysis_width: info.width,
    analysis_height: info.height,
    mean_luminance: Number((sum / count / 255).toFixed(6)),
    black_clip_ratio: Number((blackClipped / count).toFixed(6)),
    white_clip_ratio: Number((whiteClipped / count).toFixed(6)),
    luminance_range_p05_p95: Number(((percentile(sorted, 0.95) - percentile(sorted, 0.05)) / 255).toFixed(6)),
    edge_energy: Number((edgeTotal / Math.max(1, edgeCount) / 255).toFixed(6)),
  };
}

function issue(code, severity, repair, details = undefined) {
  const result = { code, severity, repair };
  if (details !== undefined) result.details = details;
  return result;
}

/**
 * Deterministic technical assessment only. It does not claim to recognize a
 * face, garment, blur, pose or occlusion. Semantic evidence must be supplied by
 * a caller and routed separately.
 */
export async function assessImageQuality(input, options = {}) {
  const {
    hardMinWidth = 96,
    hardMinHeight = 96,
    preferredLongEdge = 1024,
    maxUpscaleFactor = 2,
    analysisMaxEdge = 256,
    subjectBbox,
    requireAlpha = false,
    allowedFormats = ['jpeg', 'png', 'webp', 'tiff', 'avif'],
    maxByteLength = null,
    minEdgeEnergy = null,
    maxBlackClipRatio = null,
    maxWhiteClipRatio = null,
  } = options;
  invariant(hardMinWidth > 0 && hardMinHeight > 0, 'INVALID_QUALITY_OPTIONS', 'Hard minimums must be positive.');
  invariant(preferredLongEdge > 0, 'INVALID_QUALITY_OPTIONS', 'preferredLongEdge must be positive.');
  invariant(maxUpscaleFactor >= 1, 'INVALID_QUALITY_OPTIONS', 'maxUpscaleFactor must be at least 1.');
  invariant(Number.isInteger(analysisMaxEdge) && analysisMaxEdge >= 16, 'INVALID_QUALITY_OPTIONS', 'analysisMaxEdge must be >= 16.');

  const bytes = await readInputBytes(input);
  const metadata = await inspectImageMetadata(bytes);
  const signals = await pixelSignals(bytes, analysisMaxEdge);
  const fatalIssues = [];
  const repairableIssues = [];
  const risks = [];

  if (metadata.display_width < hardMinWidth || metadata.display_height < hardMinHeight) {
    fatalIssues.push(issue('BELOW_HARD_MINIMUM', 'FATAL', null, {
      minimum: [hardMinWidth, hardMinHeight],
      actual: [metadata.display_width, metadata.display_height],
    }));
  }
  if (!allowedFormats.includes(metadata.format)) {
    repairableIssues.push(issue('NON_CANONICAL_FORMAT', 'REPAIRABLE', 'TRANSCODE', { format: metadata.format }));
  }
  if (metadata.orientation !== 1) {
    repairableIssues.push(issue('EXIF_ORIENTATION_PRESENT', 'REPAIRABLE', 'AUTO_ORIENT', {
      orientation: metadata.orientation,
    }));
  }
  if (metadata.color_space !== 'srgb') {
    repairableIssues.push(issue('NON_SRGB_COLOR_SPACE', 'REPAIRABLE', 'CONVERT_TO_SRGB', {
      color_space: metadata.color_space,
    }));
  }
  if (requireAlpha && !metadata.has_alpha) {
    risks.push(issue('MISSING_ALPHA', 'EVIDENCE_REQUIRED', 'SUPPLY_ALPHA_OR_BBOX'));
  }
  if (maxByteLength !== null && metadata.byte_length > maxByteLength) {
    repairableIssues.push(issue('FILE_TOO_LARGE', 'REPAIRABLE', 'REENCODE', {
      maximum: maxByteLength,
      actual: metadata.byte_length,
    }));
  }

  const longEdge = Math.max(metadata.display_width, metadata.display_height);
  const factorToPreferred = preferredLongEdge / longEdge;
  const appliedUpscaleFactor = Math.max(1, Math.min(maxUpscaleFactor, factorToPreferred));
  if (longEdge < preferredLongEdge) {
    repairableIssues.push(issue('BELOW_PREFERRED_RESOLUTION', 'REPAIRABLE', 'CONSERVATIVE_UPSCALE', {
      preferred_long_edge: preferredLongEdge,
      actual_long_edge: longEdge,
      applied_upscale_factor: Number(appliedUpscaleFactor.toFixed(6)),
    }));
    if (factorToPreferred > maxUpscaleFactor) {
      risks.push(issue('RESOLUTION_TARGET_UNREACHABLE', 'RISK', 'REQUEST_BETTER_REFERENCE_FOR_EXACT_DETAIL', {
        factor_to_preferred: Number(factorToPreferred.toFixed(6)),
        max_upscale_factor: maxUpscaleFactor,
      }));
    }
  }

  if (minEdgeEnergy !== null && signals.edge_energy < minEdgeEnergy) {
    risks.push(issue('LOW_EDGE_ENERGY', 'RISK', 'REQUEST_BETTER_REFERENCE', {
      threshold: minEdgeEnergy,
      actual: signals.edge_energy,
      note: 'Edge energy is a technical signal, not an ML blur classification.',
    }));
  }
  if (maxBlackClipRatio !== null && signals.black_clip_ratio > maxBlackClipRatio) {
    risks.push(issue('EXCESSIVE_BLACK_CLIPPING', 'RISK', 'REQUEST_BETTER_EXPOSURE'));
  }
  if (maxWhiteClipRatio !== null && signals.white_clip_ratio > maxWhiteClipRatio) {
    risks.push(issue('EXCESSIVE_WHITE_CLIPPING', 'RISK', 'REQUEST_BETTER_EXPOSURE'));
  }

  let subjectCoverage = null;
  if (subjectBbox !== undefined) {
    const pixels = bboxToPixels(subjectBbox, metadata.display_width, metadata.display_height);
    subjectCoverage = Number((pixels.width * pixels.height / (metadata.display_width * metadata.display_height)).toFixed(6));
  }

  return {
    schema_version: '1.0.0',
    metadata,
    signals: {
      ...signals,
      subject_coverage: subjectCoverage,
    },
    resize_evidence: {
      preferred_long_edge: preferredLongEdge,
      current_long_edge: longEdge,
      factor_to_preferred: Number(factorToPreferred.toFixed(6)),
      max_upscale_factor: maxUpscaleFactor,
      applied_upscale_factor: Number(appliedUpscaleFactor.toFixed(6)),
      target_reachable: factorToPreferred <= maxUpscaleFactor,
    },
    fatal_issues: fatalIssues,
    repairable_issues: repairableIssues,
    risks,
  };
}
