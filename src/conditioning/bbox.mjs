import { ConditioningError, invariant } from './errors.mjs';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Converts an explicit bbox to Sharp's integer pixel rectangle. Arrays are the
 * manifest's normalized [x, y, width, height] representation. Objects must
 * state unit: "normalized" or "pixels".
 */
export function bboxToPixels(bbox, imageWidth, imageHeight, { paddingRatio = 0 } = {}) {
  invariant(Number.isInteger(imageWidth) && imageWidth > 0, 'INVALID_IMAGE_WIDTH', 'imageWidth must be positive.');
  invariant(Number.isInteger(imageHeight) && imageHeight > 0, 'INVALID_IMAGE_HEIGHT', 'imageHeight must be positive.');
  invariant(finite(paddingRatio) && paddingRatio >= 0, 'INVALID_PADDING', 'paddingRatio must be non-negative.');

  let x;
  let y;
  let width;
  let height;
  let unit;
  if (Array.isArray(bbox)) {
    invariant(bbox.length === 4, 'INVALID_BBOX', 'Normalized bbox arrays must have four values.');
    [x, y, width, height] = bbox;
    unit = 'normalized';
  } else if (bbox && typeof bbox === 'object') {
    ({ x, y, width, height, unit } = bbox);
  } else {
    throw new ConditioningError('MISSING_BBOX', 'An explicit bbox is required; no detector is run implicitly.');
  }

  invariant([x, y, width, height].every(finite), 'INVALID_BBOX', 'bbox values must be finite numbers.');
  invariant(width > 0 && height > 0, 'INVALID_BBOX', 'bbox width and height must be positive.');
  invariant(['normalized', 'pixels'].includes(unit), 'INVALID_BBOX_UNIT', 'bbox unit must be normalized or pixels.');

  if (unit === 'normalized') {
    invariant(
      x >= 0 && y >= 0 && x + width <= 1 && y + height <= 1,
      'BBOX_OUT_OF_BOUNDS',
      'Normalized bbox must fit within [0, 1].',
      { bbox },
    );
    x *= imageWidth;
    y *= imageHeight;
    width *= imageWidth;
    height *= imageHeight;
  } else {
    invariant(
      x >= 0 && y >= 0 && x + width <= imageWidth && y + height <= imageHeight,
      'BBOX_OUT_OF_BOUNDS',
      'Pixel bbox must fit within the image.',
      { bbox, imageWidth, imageHeight },
    );
  }

  const padX = width * paddingRatio;
  const padY = height * paddingRatio;
  const left = Math.max(0, Math.floor(x - padX));
  const top = Math.max(0, Math.floor(y - padY));
  const right = Math.min(imageWidth, Math.ceil(x + width + padX));
  const bottom = Math.min(imageHeight, Math.ceil(y + height + padY));

  return { left, top, width: right - left, height: bottom - top };
}
