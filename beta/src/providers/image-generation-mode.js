export const DEFAULT_IMAGE_GENERATION_MODE = 'slow';

export function resolveImageGenerationMode(value = DEFAULT_IMAGE_GENERATION_MODE) {
  if (value !== 'slow' && value !== 'fast') {
    const error = new TypeError('image_generation_mode must be "slow" or "fast"');
    error.code = 'IMAGE_GENERATION_MODE_INVALID';
    error.statusCode = 400;
    error.retryable = false;
    throw error;
  }
  return value;
}
