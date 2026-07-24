export const IMAGE_MODEL_ROUTE = Object.freeze([
  'gpt_image_2',
  'nano_banana_flash',
  'nano_banana_2',
]);

export const IMAGE_MODEL_ALLOWLIST = new Set(IMAGE_MODEL_ROUTE);

export const IMAGE_MODEL_NAMES = Object.freeze({
  gpt_image_2: 'GPT Image 2',
  nano_banana_flash: 'Nano Banana 2',
  nano_banana_2: 'Nano Banana Pro',
});

export function assertAllowedImageModel(model) {
  if (!IMAGE_MODEL_ALLOWLIST.has(model)) {
    throw new Error(`Model is not allowed by the Zeely image policy: ${model}`);
  }
  return model;
}

export function imageModelName(jobSetType) {
  assertAllowedImageModel(jobSetType);
  return IMAGE_MODEL_NAMES[jobSetType];
}

export function modelForAttempt(attempt, route = IMAGE_MODEL_ROUTE) {
  if (!Array.isArray(route) || route.length < 1 || route.some((model) => !IMAGE_MODEL_ALLOWLIST.has(model))) {
    throw new Error('Image model route must contain allowed models');
  }
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > route.length) {
    throw new Error(`Image attempt must be between 1 and ${route.length}`);
  }
  return route[attempt - 1];
}

export function assertModelRoute(route) {
  if (route === undefined) return;
  if (!Array.isArray(route) || route.length < 1 || route.length > IMAGE_MODEL_ROUTE.length) {
    throw new Error('job.model_route must be a bounded allowed Zeely model route');
  }
  for (let index = 0; index < route.length; index += 1) {
    if (route[index] !== IMAGE_MODEL_ROUTE[index]) {
      throw new Error('job.model_route must exactly match the fixed Zeely model route prefix');
    }
  }
}
