export const IMAGE_MODEL_ROUTE = Object.freeze([
  'gpt_image_2',
  'nano_banana_flash',
  'nano_banana_2',
]);

// The standard route remains the release-default for scenes and Fashion Shoot.
// A look (avatar + garment reference) may opt into this bounded fast route at
// process start.  It is deliberately not an arbitrary permutation: both routes
// are explicit product policy and both still finish with Nano Banana Pro.
export const FAST_LOOK_IMAGE_MODEL_ROUTE = Object.freeze([
  'nano_banana_flash',
  'gpt_image_2',
  'nano_banana_2',
]);

export const LOOK_IMAGE_ROUTE_MODES = Object.freeze({
  quality: IMAGE_MODEL_ROUTE,
  fast: FAST_LOOK_IMAGE_MODEL_ROUTE,
});

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

export function resolveLookImageRoute(mode = 'quality') {
  const route = LOOK_IMAGE_ROUTE_MODES[mode];
  if (!route) {
    throw new Error(`ZEELY_LOOK_IMAGE_ROUTE must be one of: ${Object.keys(LOOK_IMAGE_ROUTE_MODES).join(', ')}`);
  }
  return [...route];
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
  const matchesApprovedPrefix = Object.values(LOOK_IMAGE_ROUTE_MODES)
    .some((approved) => route.every((model, index) => model === approved[index]));
  if (!matchesApprovedPrefix) {
    throw new Error('job.model_route must exactly match an approved Zeely model route prefix');
  }
}
