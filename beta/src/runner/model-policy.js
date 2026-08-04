// Stable internal model identifiers. These include retired-from-new-work routes
// because old journals and receipts remain valid evidence and must still resume.
export const LEGACY_IMAGE_MODEL_ROUTE = Object.freeze([
  'gpt_image_2',
  'nano_banana_flash',
  'nano_banana_2',
]);

export const LEGACY_FAST_LOOK_IMAGE_MODEL_ROUTE = Object.freeze([
  'nano_banana_flash',
  'gpt_image_2',
  'nano_banana_2',
]);

export const GPT_IMAGE_2_LADDER_VERSION = 'zeely.gpt-image-2-ladder.v1';

// New work never enters a Nano Banana route. The two low/1k retries have
// distinct repair purposes, so the system never buys the identical prompt a
// third time. Nano identifiers above are kept only for durable legacy resume.
export const GPT_IMAGE_2_LADDER = Object.freeze([
  Object.freeze({
    order: 1,
    id: 'gpt_image_2.low_1k.initial',
    job_set_type: 'gpt_image_2',
    model: 'GPT Image 2',
    model_version: 'gpt_image_2',
    resolution: '1k',
    quality: 'low',
    repair_kind: 'INITIAL',
  }),
  Object.freeze({
    order: 2,
    id: 'gpt_image_2.low_1k.qa_repair_1',
    job_set_type: 'gpt_image_2',
    model: 'GPT Image 2',
    model_version: 'gpt_image_2',
    resolution: '1k',
    quality: 'low',
    repair_kind: 'QA_REPAIR_1',
  }),
  Object.freeze({
    order: 3,
    id: 'gpt_image_2.low_1k.qa_repair_2',
    job_set_type: 'gpt_image_2',
    model: 'GPT Image 2',
    model_version: 'gpt_image_2',
    resolution: '1k',
    quality: 'low',
    repair_kind: 'QA_REPAIR_2',
  }),
  Object.freeze({
    order: 4,
    id: 'gpt_image_2.medium_2k.escalation',
    job_set_type: 'gpt_image_2',
    model: 'GPT Image 2',
    model_version: 'gpt_image_2',
    resolution: '2k',
    quality: 'medium',
    repair_kind: 'QUALITY_ESCALATION_MEDIUM',
  }),
  Object.freeze({
    order: 5,
    id: 'gpt_image_2.high_4k.final',
    job_set_type: 'gpt_image_2',
    model: 'GPT Image 2',
    model_version: 'gpt_image_2',
    resolution: '4k',
    quality: 'high',
    repair_kind: 'QUALITY_ESCALATION_HIGH',
  }),
]);

// String routes remain the persisted shape for the pre-existing core runner.
// The profile (including quality and resolution) is separately immutable in
// every attempt receipt and request journal.
export const IMAGE_MODEL_ROUTE = Object.freeze(GPT_IMAGE_2_LADDER.map((entry) => entry.job_set_type));
export const FAST_LOOK_IMAGE_MODEL_ROUTE = IMAGE_MODEL_ROUTE;

export const LOOK_IMAGE_ROUTE_MODES = Object.freeze({
  quality: IMAGE_MODEL_ROUTE,
  // Retained as an environment compatibility alias. It must no longer make a
  // new run start with Nano Banana merely because an older launcher sets fast.
  fast: IMAGE_MODEL_ROUTE,
});

// This is an allowlist for persisted legacy records, not a new-generation
// selection menu.
export const IMAGE_MODEL_ALLOWLIST = new Set([
  ...LEGACY_IMAGE_MODEL_ROUTE,
]);

export const IMAGE_MODEL_NAMES = Object.freeze({
  gpt_image_2: 'GPT Image 2',
  nano_banana_flash: 'Nano Banana 2',
  nano_banana_2: 'Nano Banana Pro',
});

const LEGACY_ROUTE_PROFILES = Object.freeze({
  quality: Object.freeze(LEGACY_IMAGE_MODEL_ROUTE.map((job_set_type, index) => Object.freeze({
    order: index + 1,
    id: `legacy.quality.${job_set_type}`,
    job_set_type,
    model: IMAGE_MODEL_NAMES[job_set_type],
    model_version: job_set_type,
    resolution: '2k',
    quality: 'high',
    repair_kind: 'LEGACY_RESUME',
    legacy: true,
  }))),
  fast: Object.freeze(LEGACY_FAST_LOOK_IMAGE_MODEL_ROUTE.map((job_set_type, index) => Object.freeze({
    order: index + 1,
    id: `legacy.fast.${job_set_type}`,
    job_set_type,
    model: IMAGE_MODEL_NAMES[job_set_type],
    model_version: job_set_type,
    resolution: '2k',
    quality: 'high',
    repair_kind: 'LEGACY_RESUME',
    legacy: true,
  }))),
});

function samePrefix(route, approved) {
  return route.length <= approved.length
    && route.every((model, index) => model === approved[index]);
}

function legacyProfilesFor(route) {
  if (samePrefix(route, LEGACY_IMAGE_MODEL_ROUTE)) return LEGACY_ROUTE_PROFILES.quality;
  if (samePrefix(route, LEGACY_FAST_LOOK_IMAGE_MODEL_ROUTE)) return LEGACY_ROUTE_PROFILES.fast;
  return null;
}

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
  assertModelRoute(route);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > route.length) {
    throw new Error(`Image attempt must be between 1 and ${route.length}`);
  }
  return route[attempt - 1];
}

export function generationProfileForAttempt(attempt, route = IMAGE_MODEL_ROUTE) {
  const job_set_type = modelForAttempt(attempt, route);
  const legacy = legacyProfilesFor(route);
  const profile = legacy ? legacy[attempt - 1] : GPT_IMAGE_2_LADDER[attempt - 1];
  if (!profile || profile.job_set_type !== job_set_type) {
    throw new Error('Image attempt does not resolve to one immutable generation profile');
  }
  return Object.freeze({ ...profile });
}

export function assertModelRoute(route) {
  if (route === undefined) return;
  if (!Array.isArray(route) || route.length < 1 || route.length > IMAGE_MODEL_ROUTE.length
    || route.some((model) => typeof model !== 'string' || !IMAGE_MODEL_ALLOWLIST.has(model))) {
    throw new Error('job.model_route must be a bounded allowed Zeely image route');
  }
  const matchesNew = samePrefix(route, IMAGE_MODEL_ROUTE);
  const matchesLegacy = legacyProfilesFor(route) !== null;
  if (!matchesNew && !matchesLegacy) {
    throw new Error('job.model_route must exactly match an approved Zeely model route prefix');
  }
}
