import { createHash } from 'node:crypto';

export const SCENE_SCHEMA_VERSION = '1.0.0';

export const SCENE_STATES = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const SCENE_TERMINAL_STATES = new Set([
  SCENE_STATES.COMPLETED,
  SCENE_STATES.FAILED,
  SCENE_STATES.CANCELLED,
]);

export const SCENE_QA_GATES = Object.freeze([
  'MASTER_LOOK_LOCK',
  'REFERENCE_ROLE_ISOLATION',
  'NEAR_COPY_AND_LEAKAGE',
  'IDENTITY',
  'ITEM_FIDELITY',
  'SCENE_MATCH',
  'LIGHT_AND_CONTACT_SHADOW',
  'FRAMING_AND_ANATOMY',
  'PROVENANCE',
]);

export const SCENE_EVALUATOR_GATES = Object.freeze([
  'NEAR_COPY_AND_LEAKAGE',
  'IDENTITY',
  'ITEM_FIDELITY',
  'SCENE_MATCH',
  'LIGHT_AND_CONTACT_SHADOW',
  'FRAMING_AND_ANATOMY',
]);

export const SCENE_REFERENCE_ROLES = Object.freeze([
  'environment_anchor',
  'lighting_anchor',
  'composition_anchor',
  'palette_anchor',
  'negative_reference',
]);

// Per-shot image anchors, ordered by how much of the request would lose its only
// carrier if the provider attachment budget forced one out. BLOCKING_TOPDOWN goes
// first because nothing else in the request draws where the subject stands: the
// camera and pose survive as one prose line the generator demonstrably aims past
// (three interference_frame attempts measured 96.33%, 96.48% and 96.72% against a
// 96% ceiling). The hero frame degrades rather than disappears — its environment,
// light and grade are each still compiled into the structured environment, lighting
// and palette facts — so it yields the last slot.
export const SCENE_SHOT_ANCHOR_ROLES = Object.freeze([
  'blocking_topdown',
  'hero_continuity_anchor',
]);

export const SCENE_REFERENCE_FORBIDDEN_AUTHORITIES = Object.freeze([
  'identity',
  'body',
  'hair',
  'outfit',
]);

export const SCENE_SOURCE_FORBIDDEN_AUTHORITIES = Object.freeze([
  'identity',
  'body',
  'hair',
  'outfit',
  'brands',
  'readable_text',
  'exact_architecture',
]);

/**
 * These are immutable transport route identifiers, not marketing aliases.
 * Every job snapshots the complete route and its hash before generation.
 */
export const DEFAULT_SCENE_MODEL_ROUTE = Object.freeze([
  Object.freeze({
    order: 1,
    job_set_type: 'gpt_image_2',
    model: 'GPT Image 2',
    model_version: 'gpt_image_2',
    quality: 'high',
  }),
  Object.freeze({
    order: 2,
    job_set_type: 'nano_banana_flash',
    model: 'Nano Banana 2',
    model_version: 'nano_banana_flash',
    quality: 'high',
  }),
  Object.freeze({
    order: 3,
    job_set_type: 'nano_banana_2',
    model: 'Nano Banana Pro',
    model_version: 'nano_banana_2',
    quality: 'high',
  }),
]);

export const DEFAULT_SCENE_DELIVERY = Object.freeze({
  aspect_ratio: '4:5',
  width: 1024,
  height: 1280,
  media_type: 'image/png',
  extension: '.png',
  color_space: 'srgb',
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_REFERENCE_ROLES = new Set(SCENE_REFERENCE_ROLES);
const ALLOWED_EVALUATOR_GATES = new Set(SCENE_EVALUATOR_GATES);
const SOURCE_ROLES = new Set([
  'environment_and_composition_inspiration',
  'lighting_composition_palette_inspiration',
  'environment_material_inspiration',
  'editorial_style_observation',
]);
const SAFE_EVIDENCE_URI = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const CREATE_UNIVERSE_SOURCE_URI = /^create-universe:\/\/shoot\.[a-z0-9._-]+\/(?:manifest|unit)$/;

function isVerifiedSourceUri(value) {
  return typeof value === 'string' && (value.startsWith('https://') || CREATE_UNIVERSE_SOURCE_URI.test(value));
}
const FIXED_MODEL_ROUTE = Object.freeze([
  Object.freeze({ job_set_type: 'gpt_image_2', model: 'GPT Image 2' }),
  Object.freeze({ job_set_type: 'nano_banana_flash', model: 'Nano Banana 2' }),
  Object.freeze({ job_set_type: 'nano_banana_2', model: 'Nano Banana Pro' }),
]);
const MOVING_MODEL_VERSION = /^(?:builtin-current|current|latest|unknown)$/i;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const STANDARD_PRESET_FAMILIES = Object.freeze({
  'std.city.early_morning_gloss': 'city',
  'std.city.golden_hour_gloss': 'city',
  'std.studio.peach_soft_gloss': 'light_studio',
  'std.studio.white_window_honeycomb': 'light_studio',
  'std.studio.taupe_rembrandt_gloss': 'dramatic_studio',
  'std.studio.charcoal_dawn_rim': 'dramatic_studio',
  'std.interior.gallery_morning_gloss': 'interior',
  'std.interior.loft_golden_hour_gloss': 'interior',
  'std.nature_architecture.stone_terrace_morning': 'nature_architecture',
  'std.nature_architecture.concrete_grass_golden_hour': 'nature_architecture',
});
const SOURCE_AUTHORITY_ROLES = new Set([
  'environment_and_composition_inspiration',
  'lighting_composition_palette_inspiration',
  'environment_material_inspiration',
  'editorial_style_observation',
]);
const CAMERA_HEIGHTS = new Set(['eye_level', 'waist_level', 'low_max_5deg']);
const LIGHTING_PROTECTED_REGIONS = new Set([
  'eyes',
  'lips',
  'face_identity',
  'item_logos',
  'item_text',
  'critical_construction',
]);
const READY_EDITORIAL_MODE_IDS = new Set([
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
  'shoot.skylight_haze',
  'shoot.terracotta_hardlight',
  'shoot.window_gobo_warm',
  'shoot.grey_studio_stride',
  'shoot.sky_dune_surreal',
]);
const EDITORIAL_SHOT_SLOTS = new Set([
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
]);
const EDITORIAL_FRAMINGS = new Set([
  'full_body',
  'three_quarter',
  'detail',
  'wide_full_body',
]);
const EDITORIAL_IDENTITY_VISIBILITY = new Set(['full_face', 'partial_face', 'not_intended']);
// A standard scene keeps the tight [74, 78] band below because it promises the same
// avatar at the same scale in a new environment — there, consistent scale IS the
// product. Editorial is art direction: the crop is the style, and the only vertical
// promise it makes is the breathing room reserved above the hair. Hand-picking a
// separate ceiling on top of that guard rejected frames that had nothing wrong with
// them: interference_frame measured 84.7656% against a ceiling of 82 and the
// urban_monochrome clean_identity_hero measured 93.9063% against 88 — 2.8 and 5.9
// points over — while every other gate passed and each frame's own
// FRAMING_AND_ANATOMY prose called it a coherent three-quarter fashion frame. The miss
// was also unrepairable in kind: "subject too large" can only be answered by
// outpainting invented surroundings, so three points of taste burned the whole retry
// budget on inventing scene. So the ceiling is DERIVED as the complement of the head
// guard — a subject may grow until it would start eating the room that guard already
// reserves, and not one point further.
const EDITORIAL_HEAD_GUARDS = Object.freeze({
  clean_identity_hero: { above: 6, below: 0, head: true, footwear: false },
  environmental_hero: { above: 5, below: 0, head: true, footwear: false },
  sculptural_three_quarter: { above: 5, below: 0, head: true, footwear: false },
  interference_frame: { above: 4, below: 0, head: true, footwear: false },
  material_or_accessory_detail: { above: 0, below: 0, head: false, footwear: false },
  wide_campaign_coda: { above: 8, below: 0, head: true, footwear: false },
});

// The floor cannot be derived from the head guard, so it stays a chosen number — but a
// generous one, because a legitimate art crop must never be refused for scale alone.
// Each floor names the one thing it protects.
const EDITORIAL_SUBJECT_HEIGHT_FLOORS = Object.freeze({
  // The identity hero is the shoot's identity evidence. Below half the canvas the face
  // carries too few pixels for IDENTITY to compare facial geometry at all.
  clean_identity_hero: 50,
  // Spending frame on the environment is this slot's narrative job, so its floor only
  // stops the person becoming set dressing in their own fashion photograph.
  environmental_hero: 40,
  // A sculptural portrait that stops being a portrait is nothing: same face-pixel
  // reason as the identity hero.
  sculptural_three_quarter: 50,
  // This slot gives up frame to its one foreground optical layer, so it floors below
  // the portraits while still having to be a frame OF a person.
  interference_frame: 45,
  // A detail crop has to stay close enough that logo, lettering, stitching and material
  // construction remain readable, because ITEM_FIDELITY compares them forensically.
  material_or_accessory_detail: 45,
  // The coda is the wide slot, so its floor sits far lower by design. It exists only to
  // stop the figure becoming a speck whose approved silhouette nothing can verify.
  wide_campaign_coda: 30,
});

const EDITORIAL_FRAMING_LOCKS = Object.freeze(Object.fromEntries(
  Object.entries(EDITORIAL_HEAD_GUARDS).map(([slot, guard]) => [slot, Object.freeze({
    subject: Object.freeze([
      EDITORIAL_SUBJECT_HEIGHT_FLOORS[slot],
      100 - guard.above,
    ]),
    above: guard.above,
    below: guard.below,
    head: guard.head,
    footwear: guard.footwear,
    // Headroom is a proxy for "the head is not cropped", and in editorial the
    // direct observation of that is already in hand. An identity hero measured
    // 5% of headroom against a 6% minimum and was rejected while its own gate
    // text read "Full head is visible and the figure is anatomically coherent"
    // and every other gate passed — thirteen pixels of a 1280-tall canvas, on a
    // frame whose head was demonstrably whole. A proxy that overrules the
    // measurement it stands in for is worse than no proxy, so here it advises
    // and full_head_visible decides. Standard scenes keep it blocking: their
    // promise is the same avatar composed the same way in every environment, so
    // headroom there is the product and not art direction.
    aboveIsAdvisoryWhenHeadVisible: true,
  })]),
));

// One owner for the six vertical locks. The ShootBible compiler used to keep its own
// copy of these bands, and any drift between the two literals surfaced only at
// generation time as 'Resolved editorial camera does not match its canonical framing
// lock' — a typo made a slot unshootable rather than wrong.
export function editorialFramingLock(slot) {
  const lock = EDITORIAL_FRAMING_LOCKS[slot];
  if (!lock) throw new Error(`Unknown editorial shot slot: ${slot}`);
  return lock;
}

const STANDARD_FRAMING_LOCK = Object.freeze({
  subject: Object.freeze([74, 78]),
  above: 8,
  below: 2,
  head: true,
  footwear: true,
  aboveIsAdvisoryWhenHeadVisible: false,
});

// Resolves from the preset id because that is the one part of a preset every framing
// caller holds: the live QA path has the parsed SceneSpec, the persisted-state
// validators have only the binding. Both are safe to key on, since
// validatePresetSnapshot refuses a SceneSpec whose camera disagrees with the lock its
// id resolves to — standard against [74, 78]/8/2 and editorial against
// EDITORIAL_FRAMING_LOCKS[shot_slot], with the id itself pinned to
// `${mode_id}.${shot_slot}`.
export function sceneFramingLock(preset) {
  const presetId = typeof preset === 'string' ? preset : preset?.preset_id;
  // A missing id must not quietly resolve to the standard lock: that is how an
  // editorial shot loses its art-direction bands and gets judged as a fitting shot.
  if (typeof presetId !== 'string' || presetId.length === 0) {
    throw new Error('Scene framing lock requires a preset carrying its preset_id');
  }
  if (presetId.startsWith('editorial.')) {
    const slot = [...EDITORIAL_SHOT_SLOTS].find((candidate) => presetId.endsWith(`.${candidate}`));
    const lock = slot ? EDITORIAL_FRAMING_LOCKS[slot] : null;
    if (lock) return lock;
  }
  return STANDARD_FRAMING_LOCK;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value));
}

export function assertSafeSceneId(value, label = 'scene id') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, dots, dashes, or underscores`);
  }
  return value;
}

export function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

export function assertIdempotencyKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw new Error('idempotencyKey must contain between 8 and 256 characters');
  }
  return value;
}

export function normalizeModelRoute(route = DEFAULT_SCENE_MODEL_ROUTE) {
  if (!Array.isArray(route) || route.length !== FIXED_MODEL_ROUTE.length) {
    throw new Error('Scene model route must contain exactly the three approved models');
  }
  const seenTypes = new Set();
  const normalized = route.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Scene model route entry ${index + 1} must be an object`);
    }
    assertExactKeys(
      entry,
      ['order', 'job_set_type', 'model', 'model_version', 'quality'],
      `Scene model route entry ${index + 1}`,
    );
    const expectedOrder = index + 1;
    if (entry.order !== expectedOrder) {
      throw new Error(`Scene model route entry ${expectedOrder} must have order ${expectedOrder}`);
    }
    for (const field of ['job_set_type', 'model', 'model_version', 'quality']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        throw new Error(`Scene model route entry ${expectedOrder} is missing ${field}`);
      }
    }
    const fixed = FIXED_MODEL_ROUTE[index];
    if (entry.job_set_type !== fixed.job_set_type || entry.model !== fixed.model || entry.quality !== 'high') {
      throw new Error('Scene model route must exactly match GPT Image 2 → Nano Banana 2 → Nano Banana Pro at high quality');
    }
    if (MOVING_MODEL_VERSION.test(entry.model_version)) {
      throw new Error(`Scene model route entry ${expectedOrder} uses a moving model_version alias`);
    }
    if (seenTypes.has(entry.job_set_type)) {
      throw new Error(`Scene model route repeats ${entry.job_set_type}`);
    }
    seenTypes.add(entry.job_set_type);
    return Object.freeze({
      order: expectedOrder,
      job_set_type: entry.job_set_type,
      model: entry.model,
      model_version: entry.model_version,
      quality: entry.quality,
    });
  });
  return Object.freeze(normalized);
}

export function normalizeDelivery(delivery = DEFAULT_SCENE_DELIVERY) {
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
    throw new Error('Scene delivery must be an object');
  }
  assertExactKeys(
    delivery,
    ['aspect_ratio', 'width', 'height', 'media_type', 'extension', 'color_space'],
    'Scene delivery',
  );
  const width = Number(delivery.width);
  const height = Number(delivery.height);
  if (width !== 1024 || height !== 1280) {
    throw new Error('Scene delivery must be the canonical 1024×1280 4:5 canvas');
  }
  if (delivery.aspect_ratio !== '4:5') throw new Error('Scene delivery aspect_ratio must be 4:5');
  if (delivery.media_type !== 'image/png' || delivery.extension !== '.png') {
    throw new Error('Scene delivery must be lossless PNG');
  }
  if (delivery.color_space !== 'srgb') throw new Error('Scene delivery color_space must be srgb');
  return Object.freeze({
    aspect_ratio: '4:5',
    width,
    height,
    media_type: 'image/png',
    extension: '.png',
    color_space: 'srgb',
  });
}

export function sceneQaItemScope(items, preset = null) {
  if (!Array.isArray(items)) throw new Error('Scene QA item scope requires an item array');
  const slot = preset?.editorial?.shot_slot ?? null;
  if (!slot) return items;
  if (slot === 'material_or_accessory_detail') return items.slice(0, 1);
  if (['sculptural_three_quarter', 'interference_frame'].includes(slot)) {
    return items.filter((item) => String(item.category).toLowerCase() !== 'footwear');
  }
  return items;
}

export function validateApprovedLookReference(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new Error('approvedLookReference must be an object');
  }
  return Object.freeze({
    look_id: assertSafeSceneId(reference.look_id, 'approvedLookReference.look_id'),
    image_sha256: assertSha256(reference.image_sha256, 'approvedLookReference.image_sha256'),
    receipt_sha256: assertSha256(reference.receipt_sha256, 'approvedLookReference.receipt_sha256'),
  });
}

export function validatePresetReference(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new Error('presetReference must be an object');
  }
  for (const field of ['preset_id', 'preset_version', 'reference_pack_id', 'reference_pack_version']) {
    assertSafeSceneId(reference[field], `presetReference.${field}`);
  }
  return Object.freeze({
    preset_id: reference.preset_id,
    preset_version: reference.preset_version,
    preset_sha256: assertSha256(reference.preset_sha256, 'presetReference.preset_sha256'),
    reference_pack_id: reference.reference_pack_id,
    reference_pack_version: reference.reference_pack_version,
    reference_pack_sha256: assertSha256(reference.reference_pack_sha256, 'presetReference.reference_pack_sha256'),
    prompt_sha256: assertSha256(reference.prompt_sha256, 'presetReference.prompt_sha256'),
  });
}

/**
 * The optional per-shot image anchors a caller may bind alongside the approved look.
 *
 * Ordered by SCENE_SHOT_ANCHOR_ROLES rather than by the caller's array, so the same
 * shot always produces the same request fingerprint and the same attachment order.
 * Bytes are demanded here instead of a path because the caller's file is its own
 * artifact — the hero frame lives inside a sibling scene — and an anchor that stayed
 * a reference to somebody else's file would be conditioning on something this scene
 * cannot prove still exists.
 */
export function validateShotAnchorReferences(anchors) {
  if (anchors === undefined || anchors === null) return null;
  if (!Array.isArray(anchors) || anchors.length < 1 || anchors.length > SCENE_SHOT_ANCHOR_ROLES.length) {
    throw new Error(`shotAnchorReferences must contain 1–${SCENE_SHOT_ANCHOR_ROLES.length} anchors`);
  }
  const byRole = new Map();
  for (const anchor of anchors) {
    if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
      throw new Error('shotAnchorReferences entries must be objects');
    }
    if (!SCENE_SHOT_ANCHOR_ROLES.includes(anchor.role)) {
      throw new Error(`Unsupported scene shot anchor role ${anchor.role}`);
    }
    if (byRole.has(anchor.role)) {
      throw new Error(`shotAnchorReferences repeats the ${anchor.role} role`);
    }
    if (anchor.media_type !== 'image/png') {
      throw new Error(`Scene shot anchor ${anchor.role} must be one PNG`);
    }
    byRole.set(anchor.role, Object.freeze({
      role: anchor.role,
      reference_id: assertSafeSceneId(anchor.reference_id, `shotAnchorReferences.${anchor.role}.reference_id`),
      sha256: assertSha256(anchor.sha256, `shotAnchorReferences.${anchor.role}.sha256`),
      media_type: 'image/png',
      data: anchor.data,
    }));
  }
  return Object.freeze(
    SCENE_SHOT_ANCHOR_ROLES.filter((role) => byRole.has(role)).map((role, index) => Object.freeze({
      order: index + 1,
      ...byRole.get(role),
    })),
  );
}

function assertExactKeys(actual, expected, label) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = [...expected].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label} must contain exactly: ${expectedKeys.join(', ')}`);
  }
}

function assertKeysWithOptional(actual, required, optional, label) {
  const actualKeys = Object.keys(actual);
  const allowed = new Set([...required, ...optional]);
  if (!required.every((key) => actualKeys.includes(key))
    || actualKeys.some((key) => !allowed.has(key))) {
    throw new Error(`${label} must contain: ${required.join(', ')} (optionally: ${optional.join(', ')})`);
  }
}

function assertUniqueStringArray(value, {
  label,
  minItems,
  maxItems = Infinity,
  minLength = 1,
  allowed = null,
}) {
  if (!Array.isArray(value)
    || value.length < minItems
    || value.length > maxItems
    || value.some((item) => typeof item !== 'string' || item.trim().length < minLength)
    || new Set(value).size !== value.length
    || (allowed && value.some((item) => !allowed.has(item)))) {
    throw new Error(`${label} is not a valid unique string set`);
  }
}

function validateSourceAuthority(authority, index) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    throw new Error(`Resolved scene preset source_authorities[${index}] must be an object`);
  }
  assertExactKeys(authority, ['url', 'role', 'use', 'not_authority_for'], `source_authorities[${index}]`);
  if (!isVerifiedSourceUri(authority.url)) {
    throw new Error(`source_authorities[${index}].url must be HTTPS or a locked Create Universe unit URI`);
  }
  if (!SOURCE_AUTHORITY_ROLES.has(authority.role)) {
    throw new Error(`source_authorities[${index}].role is unsupported`);
  }
  if (typeof authority.use !== 'string' || authority.use.trim().length < 10) {
    throw new Error(`source_authorities[${index}].use must describe its limited authority`);
  }
  assertUniqueStringArray(authority.not_authority_for, {
    label: `source_authorities[${index}].not_authority_for`,
    minItems: SCENE_SOURCE_FORBIDDEN_AUTHORITIES.length,
    maxItems: SCENE_SOURCE_FORBIDDEN_AUTHORITIES.length,
    allowed: new Set(SCENE_SOURCE_FORBIDDEN_AUTHORITIES),
  });
  for (const field of SCENE_SOURCE_FORBIDDEN_AUTHORITIES) {
    if (!authority.not_authority_for.includes(field)) {
      throw new Error(`source_authorities[${index}] must deny authority for ${field}`);
    }
  }
}

function validatePresetLighting(lighting) {
  if (!lighting || typeof lighting !== 'object' || Array.isArray(lighting)) {
    throw new Error('Resolved scene preset lighting must be an object');
  }
  assertExactKeys(
    lighting,
    ['time_or_setup', 'key', 'fill', 'finish', 'protected_regions'],
    'Resolved scene preset lighting',
  );
  if (typeof lighting.time_or_setup !== 'string' || lighting.time_or_setup.trim().length < 3
    || typeof lighting.key !== 'string' || lighting.key.trim().length < 10
    || typeof lighting.fill !== 'string' || lighting.fill.trim().length < 5) {
    throw new Error('Resolved scene preset lighting description is incomplete');
  }
  if (lighting.finish !== 'polished_editorial_gloss_without_skin_smoothing_or_hdr') {
    throw new Error('Resolved scene preset lighting finish is not production-locked');
  }
  assertUniqueStringArray(lighting.protected_regions, {
    label: 'Resolved scene preset lighting.protected_regions',
    minItems: 3,
    allowed: LIGHTING_PROTECTED_REGIONS,
  });
}

function validatePresetCamera(camera) {
  if (!camera || typeof camera !== 'object' || Array.isArray(camera)) {
    throw new Error('Resolved scene preset camera must be an object');
  }
  assertExactKeys(
    camera,
    [
      'aspect_ratio',
      'lens_mm',
      'height',
      'subject_height_percent',
      'minimum_clear_space_percent',
      'max_vertical_error_deg',
    ],
    'Resolved scene preset camera',
  );
  if (camera.aspect_ratio !== '4:5'
    || !Number.isInteger(camera.lens_mm)
    || camera.lens_mm < 45
    || camera.lens_mm > 70
    || !CAMERA_HEIGHTS.has(camera.height)
    || !Number.isFinite(camera.max_vertical_error_deg)
    || camera.max_vertical_error_deg < 0
    || camera.max_vertical_error_deg > 1.5) {
    throw new Error('Resolved scene preset camera violates the catalog camera lock');
  }
  if (!Array.isArray(camera.subject_height_percent)
    || camera.subject_height_percent.length !== 2
    || camera.subject_height_percent[0] !== 74
    || camera.subject_height_percent[1] !== 78) {
    throw new Error('Resolved standard scene preset must lock subject_height_percent to [74, 78]');
  }
  if (!camera.minimum_clear_space_percent
    || typeof camera.minimum_clear_space_percent !== 'object'
    || Array.isArray(camera.minimum_clear_space_percent)) {
    throw new Error('Resolved scene preset must declare minimum clear space');
  }
  assertExactKeys(
    camera.minimum_clear_space_percent,
    ['above_hair', 'below_footwear'],
    'Resolved scene preset camera.minimum_clear_space_percent',
  );
  if (camera.minimum_clear_space_percent.above_hair !== 8
    || camera.minimum_clear_space_percent.below_footwear !== 2) {
    throw new Error('Resolved scene preset clear-space lock must be 8% above hair and 2% below footwear');
  }
}

function validateEditorialStyleObservation(observation, index) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new Error(`Editorial style_observations[${index}] must be an object`);
  }
  assertExactKeys(
    observation,
    ['url', 'role', 'use', 'not_authority_for'],
    `Editorial style_observations[${index}]`,
  );
  if (!isVerifiedSourceUri(observation.url)) {
    throw new Error(`Editorial style_observations[${index}].url must be HTTPS or a locked Create Universe unit URI`);
  }
  if (observation.role !== 'editorial_style_observation'
    || typeof observation.use !== 'string'
    || observation.use.trim().length < 10) {
    throw new Error(`Editorial style_observations[${index}] has invalid limited authority`);
  }
  assertUniqueStringArray(observation.not_authority_for, {
    label: `Editorial style_observations[${index}].not_authority_for`,
    minItems: SCENE_SOURCE_FORBIDDEN_AUTHORITIES.length,
    maxItems: SCENE_SOURCE_FORBIDDEN_AUTHORITIES.length,
    allowed: new Set(SCENE_SOURCE_FORBIDDEN_AUTHORITIES),
  });
  for (const field of SCENE_SOURCE_FORBIDDEN_AUTHORITIES) {
    if (!observation.not_authority_for.includes(field)) {
      throw new Error(`Editorial style observation must deny authority for ${field}`);
    }
  }
}

function validateEditorialPresetCamera(camera, editorial) {
  if (!camera || typeof camera !== 'object' || Array.isArray(camera)) {
    throw new Error('Resolved editorial preset camera must be an object');
  }
  assertExactKeys(
    camera,
    [
      'aspect_ratio',
      'lens_mm',
      'height',
      'framing',
      'subject_height_percent',
      'minimum_clear_space_percent',
      'max_vertical_error_deg',
      'required_visibility',
    ],
    'Resolved editorial preset camera',
  );
  if (camera.aspect_ratio !== '4:5'
    || !Number.isInteger(camera.lens_mm)
    || camera.lens_mm < 24
    || camera.lens_mm > 135
    || !CAMERA_HEIGHTS.has(camera.height)
    || !EDITORIAL_FRAMINGS.has(camera.framing)
    || !Number.isFinite(camera.max_vertical_error_deg)
    || camera.max_vertical_error_deg < 0
    || camera.max_vertical_error_deg > 1.5) {
    throw new Error('Resolved editorial preset camera violates its shot lock');
  }
  // A ceiling of exactly 100 is legal rather than a typo: material_or_accessory_detail
  // reserves no clear space above the hair, so the guard its ceiling derives from
  // reserves nothing and a detail crop may fill the canvas from edge to edge.
  if (!Array.isArray(camera.subject_height_percent)
    || camera.subject_height_percent.length !== 2
    || camera.subject_height_percent.some((value) => !Number.isFinite(value) || value < 1 || value > 100)
    || camera.subject_height_percent[0] >= camera.subject_height_percent[1]) {
    throw new Error('Resolved editorial camera must declare an ordered subject height range');
  }
  if (!camera.minimum_clear_space_percent
    || typeof camera.minimum_clear_space_percent !== 'object'
    || Array.isArray(camera.minimum_clear_space_percent)) {
    throw new Error('Resolved editorial camera must declare minimum clear space');
  }
  assertExactKeys(
    camera.minimum_clear_space_percent,
    ['above_hair', 'below_footwear'],
    'Resolved editorial camera.minimum_clear_space_percent',
  );
  if (Object.values(camera.minimum_clear_space_percent).some(
    (value) => !Number.isFinite(value) || value < 0 || value > 100,
  )) {
    throw new Error('Resolved editorial camera clear-space locks are invalid');
  }
  if (!camera.required_visibility
    || typeof camera.required_visibility !== 'object'
    || Array.isArray(camera.required_visibility)) {
    throw new Error('Resolved editorial camera must declare required visibility');
  }
  assertExactKeys(
    camera.required_visibility,
    ['full_head', 'full_footwear'],
    'Resolved editorial camera.required_visibility',
  );
  if (typeof camera.required_visibility.full_head !== 'boolean'
    || typeof camera.required_visibility.full_footwear !== 'boolean') {
    throw new Error('Resolved editorial camera visibility locks must be booleans');
  }
  const expectedFraming = {
    clean_identity_hero: 'three_quarter',
    environmental_hero: 'three_quarter',
    sculptural_three_quarter: 'three_quarter',
    interference_frame: 'three_quarter',
    material_or_accessory_detail: 'detail',
    wide_campaign_coda: 'three_quarter',
  }[editorial.shot_slot];
  if (camera.framing !== expectedFraming) {
    throw new Error('Resolved editorial camera framing does not match its shot slot');
  }
  const framingLock = EDITORIAL_FRAMING_LOCKS[editorial.shot_slot];
  if (JSON.stringify(camera.subject_height_percent) !== JSON.stringify(framingLock.subject)
    || camera.minimum_clear_space_percent.above_hair !== framingLock.above
    || camera.minimum_clear_space_percent.below_footwear !== framingLock.below
    || camera.required_visibility.full_head !== framingLock.head
    || camera.required_visibility.full_footwear !== framingLock.footwear) {
    throw new Error('Resolved editorial camera does not match its canonical framing lock');
  }
  // Footwear is no longer required by any editorial slot: art direction crops
  // are intentional, and demanding feet forced the generator to invent a lower
  // half that no approved reference could verify. The head requirement stays —
  // an editorial frame that loses the face loses its identity evidence, which is
  // the one thing these gates exist to protect.
  if (['clean_identity_hero', 'environmental_hero', 'wide_campaign_coda']
    .includes(editorial.shot_slot)
    && !camera.required_visibility.full_head) {
    throw new Error('Resolved editorial hero and coda shots require the complete head');
  }
}

function validateEditorialPresetSnapshot(preset, reference) {
  assertExactKeys(
    preset,
    [
      'preset_id',
      'version',
      'family',
      'ui_name_uk',
      'source_authorities',
      'style_observations',
      'environment',
      'lighting',
      'camera',
      'palette',
      'hard_negatives',
      'prompt_path',
      'mvp_assets',
      'post_selection_assets',
      'editorial',
    ],
    'Resolved editorial SceneSpec',
  );
  if (preset.family !== 'editorial'
    || !SEMVER.test(preset.version)
    || !preset.editorial
    || typeof preset.editorial !== 'object'
    || Array.isArray(preset.editorial)) {
    throw new Error('Resolved editorial SceneSpec identity is incomplete');
  }
  assertExactKeys(
    preset.editorial,
    [
      'mode_id',
      'mode_version',
      'shot_slot',
      'shot_spec_sha256',
      'base_preset_id',
      'base_preset_version',
      'identity_visibility',
      'item_scope',
    ],
    'Resolved editorial SceneSpec editorial binding',
  );
  if (!READY_EDITORIAL_MODE_IDS.has(preset.editorial.mode_id)
    || preset.editorial.mode_version !== preset.version
    || !EDITORIAL_SHOT_SLOTS.has(preset.editorial.shot_slot)
    || preset.preset_id !== `${preset.editorial.mode_id}.${preset.editorial.shot_slot}`
    || (!STANDARD_PRESET_FAMILIES[preset.editorial.base_preset_id]
      && !(preset.editorial.mode_id.startsWith('shoot.')
        && preset.editorial.base_preset_id === preset.editorial.mode_id))
    || !SEMVER.test(preset.editorial.base_preset_version)
    || !EDITORIAL_IDENTITY_VISIBILITY.has(preset.editorial.identity_visibility)
    || !['ALL', 'EXCLUDE_FOOTWEAR', 'FIRST_ORDERED_ITEM']
      .includes(preset.editorial.item_scope)) {
    throw new Error('Resolved editorial SceneSpec binding is invalid');
  }
  const expectedItemScope = preset.editorial.shot_slot === 'material_or_accessory_detail'
    ? 'FIRST_ORDERED_ITEM'
    : ['sculptural_three_quarter', 'interference_frame']
      .includes(preset.editorial.shot_slot)
    ? 'EXCLUDE_FOOTWEAR'
    : 'ALL';
  if (preset.editorial.item_scope !== expectedItemScope) {
    throw new Error('Resolved editorial SceneSpec item scope does not match its shot slot');
  }
  assertSha256(preset.editorial.shot_spec_sha256, 'editorial shot_spec_sha256');
  if (typeof preset.ui_name_uk !== 'string' || preset.ui_name_uk.trim().length < 5
    || typeof preset.environment !== 'string' || preset.environment.trim().length < 20) {
    throw new Error('Resolved editorial SceneSpec description is incomplete');
  }
  if (!Array.isArray(preset.source_authorities)
    || preset.source_authorities.length < 2
    || new Set(preset.source_authorities.map((item) => item?.url)).size !== preset.source_authorities.length) {
    throw new Error('Resolved editorial SceneSpec needs two licensed source authorities');
  }
  preset.source_authorities.forEach(validateSourceAuthority);
  if (!Array.isArray(preset.style_observations)
    || preset.style_observations.length < 2
    || new Set(preset.style_observations.map((item) => item?.url)).size !== preset.style_observations.length) {
    throw new Error('Resolved editorial SceneSpec needs two unique style observations');
  }
  preset.style_observations.forEach(validateEditorialStyleObservation);
  validatePresetLighting(preset.lighting);
  validateEditorialPresetCamera(preset.camera, preset.editorial);
  assertUniqueStringArray(preset.palette, {
    label: 'Resolved editorial preset palette',
    minItems: 3,
    maxItems: 6,
    minLength: 2,
  });
  assertUniqueStringArray(preset.hard_negatives, {
    label: 'Resolved editorial preset hard_negatives',
    minItems: 4,
    maxItems: 20,
    minLength: 2,
  });
  if (preset.prompt_path !== `prompts/scenes/${preset.preset_id}.txt`) {
    throw new Error('Resolved editorial preset prompt_path does not match its shot id');
  }
  if (JSON.stringify(preset.mvp_assets) !== JSON.stringify(['mood_card'])
    || !Array.isArray(preset.post_selection_assets)
    || preset.post_selection_assets.length !== 2
    || !preset.post_selection_assets.includes('environment_plate')
    || !preset.post_selection_assets.includes('lighting_preview')) {
    throw new Error('Resolved editorial preset production assets are incomplete');
  }
  return preset;
}

export function validatePresetSnapshot(preset, reference) {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
    throw new Error('Resolved scene preset must be an object');
  }
  if (preset.preset_id !== reference.preset_id || preset.version !== reference.preset_version) {
    throw new Error('Resolved scene preset id/version does not match the requested preset');
  }
  if (preset.preset_id.startsWith('editorial.') || preset.preset_id.startsWith('shoot.')) {
    return validateEditorialPresetSnapshot(preset, reference);
  }
  if (!preset.preset_id.startsWith('std.')) {
    throw new Error('SceneService requires a complete standard SceneSpec; editorial modes must first compile a per-shot SceneSpec');
  }
  assertExactKeys(
    preset,
    [
      'preset_id',
      'version',
      'family',
      'ui_name_uk',
      'source_authorities',
      'environment',
      'lighting',
      'camera',
      'palette',
      'hard_negatives',
      'prompt_path',
      'mvp_assets',
      'post_selection_assets',
    ],
    'Resolved standard SceneSpec',
  );
  if (!SEMVER.test(preset.version)) {
    throw new Error('Resolved scene preset version must be semantic');
  }
  const expectedFamily = STANDARD_PRESET_FAMILIES[preset.preset_id];
  if (!expectedFamily || preset.family !== expectedFamily) {
    throw new Error('Resolved scene preset id/family is not in the catalog');
  }
  if (typeof preset.ui_name_uk !== 'string' || preset.ui_name_uk.trim().length < 5
    || typeof preset.environment !== 'string' || preset.environment.trim().length < 20) {
    throw new Error('Resolved scene preset UI name or environment specification is incomplete');
  }
  if (!Array.isArray(preset.source_authorities)
    || preset.source_authorities.length < 2
    || new Set(preset.source_authorities.map((item) => item?.url)).size !== preset.source_authorities.length) {
    throw new Error('Resolved scene preset must contain at least two unique source authorities');
  }
  preset.source_authorities.forEach(validateSourceAuthority);
  validatePresetLighting(preset.lighting);
  validatePresetCamera(preset.camera);
  assertUniqueStringArray(preset.palette, {
    label: 'Resolved scene preset palette',
    minItems: 3,
    maxItems: 6,
    minLength: 2,
  });
  assertUniqueStringArray(preset.hard_negatives, {
    label: 'Resolved scene preset hard_negatives',
    minItems: 4,
    minLength: 2,
  });
  if (preset.prompt_path !== `prompts/scenes/${preset.preset_id}.txt`) {
    throw new Error('Resolved scene preset prompt_path must exactly match its catalog preset id');
  }
  if (JSON.stringify(preset.mvp_assets) !== JSON.stringify(['mood_card'])) {
    throw new Error('Resolved scene preset mvp_assets must contain only mood_card');
  }
  if (!Array.isArray(preset.post_selection_assets)
    || preset.post_selection_assets.length !== 2
    || !preset.post_selection_assets.includes('environment_plate')
    || !preset.post_selection_assets.includes('lighting_preview')) {
    throw new Error('Resolved scene preset must require environment_plate and lighting_preview');
  }
  return preset;
}

export function validateReferencePack(referencePack, reference, presetHash, promptHash, preset = null) {
  if (!referencePack || typeof referencePack !== 'object' || Array.isArray(referencePack)) {
    throw new Error('Resolved scene reference pack must be an object');
  }
  const expected = {
    reference_pack_id: reference.reference_pack_id,
    version: reference.reference_pack_version,
    preset_id: reference.preset_id,
    preset_version: reference.preset_version,
    preset_sha256: presetHash,
    prompt_sha256: promptHash,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (referencePack[field] !== value) {
      throw new Error(`Scene reference pack ${field} is not bound to the requested preset`);
    }
  }
  if (!Array.isArray(referencePack.references)) {
    throw new Error('Scene reference pack references must be an array');
  }
  if (!SEMVER.test(referencePack.version)) {
    throw new Error('Scene reference pack version must be immutable semver');
  }
  const [packMajor, packMinor] = referencePack.version.split('.').map(Number);
  const structuredFactsOnly = packMajor > 1 || (packMajor === 1 && packMinor >= 1);
  const ids = new Set();
  const roles = new Set();
  for (const item of referencePack.references) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Scene reference pack entries must be objects');
    }
    assertExactKeys(
      item,
      ['reference_id', 'role', 'sha256', 'media_type', 'not_authority_for'],
      `Reference ${item.reference_id ?? '(unknown)'}`,
    );
    assertSafeSceneId(item.reference_id, 'reference.reference_id');
    assertSha256(item.sha256, `reference ${item.reference_id} sha256`);
    if (ids.has(item.reference_id)) throw new Error(`Duplicate scene reference id ${item.reference_id}`);
    if (!ALLOWED_REFERENCE_ROLES.has(item.role)) throw new Error(`Unsupported scene reference role ${item.role}`);
    if (roles.has(item.role)) throw new Error(`Duplicate scene reference role ${item.role}`);
    if (typeof item.media_type !== 'string' || item.media_type.trim() === '') {
      throw new Error(`Reference ${item.reference_id} must declare media_type`);
    }
    const imageReference = item.media_type.startsWith('image/');
    if (!imageReference && item.media_type !== 'application/json') {
      throw new Error(`Reference ${item.reference_id} must be an image or a strict structured JSON scene reference`);
    }
    if (structuredFactsOnly && item.media_type !== 'application/json') {
      throw new Error(`Reference pack ${referencePack.version} must use strict structured facts for every scene role`);
    }
    if (!Array.isArray(item.not_authority_for)) {
      throw new Error(`Reference ${item.reference_id} must declare not_authority_for`);
    }
    for (const authority of SCENE_REFERENCE_FORBIDDEN_AUTHORITIES) {
      if (!item.not_authority_for.includes(authority)) {
        throw new Error(`Reference ${item.reference_id} must deny authority for ${authority}`);
      }
    }
    ids.add(item.reference_id);
    roles.add(item.role);
  }
  for (const role of SCENE_REFERENCE_ROLES) {
    if (!roles.has(role)) throw new Error(`Scene reference pack is missing ${role}`);
  }
  const ledger = referencePack.source_ledger;
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    throw new Error('Scene reference pack source_ledger must be a verified ledger object');
  }
  if (ledger.schema_version !== '1.0.0'
    || ledger.preset_id !== reference.preset_id
    || ledger.preset_version !== reference.preset_version
    || ledger.status !== 'VERIFIED_FOR_RELEASE'
    || !Number.isInteger(ledger.revision)
    || ledger.revision < 1
    || typeof ledger.ledger_id !== 'string'
    || typeof ledger.created_at !== 'string') {
    throw new Error('Scene reference pack source_ledger is not release-ready for the requested preset');
  }
  if (!Array.isArray(ledger.sources) || ledger.sources.length < 2) {
    throw new Error('Scene reference pack source_ledger must contain at least two verified sources');
  }
  const sourceIds = new Set();
  const sourceUrls = new Set();
  for (const [index, source] of ledger.sources.entries()) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(`Scene source ledger entry ${index + 1} must be an object`);
    }
    for (const field of ['source_id', 'url', 'role', 'use', 'retrieved_at', 'snapshot_uri', 'content_sha256']) {
      if (typeof source[field] !== 'string' || source[field].trim() === '') {
        throw new Error(`Scene source ledger entry ${index + 1} is missing ${field}`);
      }
    }
    if (!isVerifiedSourceUri(source.url)) {
      throw new Error(`Scene source ledger entry ${index + 1} must use an HTTPS or locked Create Universe source URL`);
    }
    if (!SOURCE_ROLES.has(source.role)) {
      throw new Error(`Scene source ledger entry ${index + 1} has an unsupported role`);
    }
    if (!SAFE_EVIDENCE_URI.test(source.snapshot_uri)) {
      throw new Error(`Scene source ledger entry ${index + 1} snapshot_uri must be a safe relative evidence path`);
    }
    if (Number.isNaN(Date.parse(source.retrieved_at))) {
      throw new Error(`Scene source ledger entry ${index + 1} retrieved_at must be a timestamp`);
    }
    if (sourceIds.has(source.source_id) || sourceUrls.has(source.url)) {
      throw new Error('Scene source ledger cannot repeat a source id or URL');
    }
    sourceIds.add(source.source_id);
    sourceUrls.add(source.url);
    if (!Array.isArray(source.not_authority_for)) {
      throw new Error(`Scene source ledger entry ${index + 1} must declare not_authority_for`);
    }
    for (const authority of SCENE_SOURCE_FORBIDDEN_AUTHORITIES) {
      if (!source.not_authority_for.includes(authority)) {
        throw new Error(`Scene source ledger entry ${index + 1} must deny authority for ${authority}`);
      }
    }
    assertSha256(source.content_sha256, `source ledger entry ${index + 1} content_sha256`);
    const rights = source.rights;
    if (!rights || typeof rights !== 'object' || Array.isArray(rights)
      || rights.status !== 'VERIFIED'
      || !['OWNED', 'LICENSED', 'WRITTEN_PERMISSION', 'PUBLIC_DOMAIN'].includes(rights.basis)) {
      throw new Error(`Scene source ledger entry ${index + 1} has no verified rights evidence`);
    }
    for (const field of ['rights_holder', 'evidence_uri', 'evidence_sha256', 'verified_at']) {
      if (typeof rights[field] !== 'string' || rights[field].trim() === '') {
        throw new Error(`Scene source ledger entry ${index + 1} rights evidence is missing ${field}`);
      }
    }
    if (!SAFE_EVIDENCE_URI.test(rights.evidence_uri)) {
      throw new Error(`Scene source ledger entry ${index + 1} rights evidence_uri must be a safe relative path`);
    }
    if (Number.isNaN(Date.parse(rights.verified_at))) {
      throw new Error(`Scene source ledger entry ${index + 1} rights verified_at must be a timestamp`);
    }
    assertSha256(rights.evidence_sha256, `source ledger entry ${index + 1} rights evidence_sha256`);
  }
  if (preset) {
    const declaredUrls = [...preset.source_authorities.map((item) => item.url)].sort();
    const ledgerUrls = [...ledger.sources.map((item) => item.url)].sort();
    if (JSON.stringify(declaredUrls) !== JSON.stringify(ledgerUrls)) {
      throw new Error('Scene source ledger must exactly cover the SceneSpec source authorities');
    }
  }
  return referencePack;
}

export function validateResolvedReferenceAssets(referencePack, assets) {
  if (!Array.isArray(assets)) throw new Error('Resolved scene reference assets must be an array');
  const expected = new Map(referencePack.references.map((item) => [item.reference_id, item]));
  if (assets.length !== expected.size) {
    throw new Error('Resolved scene reference asset count does not match the reference pack');
  }
  const seen = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      throw new Error('Resolved scene reference assets must be objects');
    }
    const reference = expected.get(asset.reference_id);
    if (!reference || seen.has(asset.reference_id)) {
      throw new Error(`Unexpected or duplicate resolved scene reference ${asset.reference_id ?? '(unknown)'}`);
    }
    if (asset.role !== reference.role || asset.media_type !== reference.media_type) {
      throw new Error(`Resolved scene reference ${asset.reference_id} metadata mismatch`);
    }
    seen.add(asset.reference_id);
  }
  return assets;
}

function normalizeItemFidelityEvidence(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (!Array.isArray(value) || value.length > 7) {
    throw new Error('Scene evaluator item_fidelity_evidence must contain 1–7 ordered results');
  }
  const seen = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Scene evaluator item fidelity result ${index + 1} must be an object`);
    }
    assertExactKeys(
      item,
      [
        'item_id',
        'verdict',
        'evidence',
        'matching_features',
        'defects',
        'confidence',
        'item_sha256',
        'item_category',
        'item_facts_sha256',
        'request_id',
      ],
      `Scene evaluator item fidelity result ${index + 1}`,
    );
    assertSafeSceneId(item.item_id, `scene evaluator item ${index + 1} id`);
    if (seen.has(item.item_id)) {
      throw new Error(`Scene evaluator returned duplicate item fidelity result ${item.item_id}`);
    }
    seen.add(item.item_id);
    if (!['PASS', 'REVISE'].includes(item.verdict)) {
      throw new Error(`Scene evaluator item ${item.item_id} must declare PASS or REVISE`);
    }
    if (typeof item.item_category !== 'string'
      || !/^[a-z][a-z0-9_-]{0,63}$/.test(item.item_category)) {
      throw new Error(`Scene evaluator item ${item.item_id} category is invalid`);
    }
    for (const field of ['item_sha256', 'item_facts_sha256', 'request_id']) {
      assertSha256(item[field], `scene evaluator item ${item.item_id} ${field}`);
    }
    if (typeof item.evidence !== 'string'
      || item.evidence.trim() === ''
      || item.evidence.length > 1_200) {
      throw new Error(`Scene evaluator item ${item.item_id} evidence is invalid`);
    }
    const normalizeTextArray = (entries, field) => {
      if (!Array.isArray(entries) || entries.length > 20) {
        throw new Error(`Scene evaluator item ${item.item_id} ${field} is invalid`);
      }
      return entries.map((entry) => {
        if (typeof entry !== 'string' || entry.trim() === '' || entry.length > 240) {
          throw new Error(`Scene evaluator item ${item.item_id} ${field} is invalid`);
        }
        return entry.trim();
      });
    };
    const matchingFeatures = normalizeTextArray(item.matching_features, 'matching_features');
    const defects = normalizeTextArray(item.defects, 'defects');
    if ((item.verdict === 'PASS' && defects.length !== 0)
      || (item.verdict === 'REVISE' && defects.length === 0)) {
      throw new Error(`Scene evaluator item ${item.item_id} verdict contradicts its defects`);
    }
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
      throw new Error(`Scene evaluator item ${item.item_id} confidence is invalid`);
    }
    return {
      item_id: item.item_id,
      verdict: item.verdict,
      evidence: item.evidence.trim(),
      matching_features: matchingFeatures,
      defects,
      confidence: Number(item.confidence),
      item_sha256: item.item_sha256,
      item_category: item.item_category,
      item_facts_sha256: item.item_facts_sha256,
      request_id: item.request_id,
    };
  });
}

export function normalizeEvaluatorResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.gates)) {
    throw new Error('Scene evaluator must return { gates: [...] }');
  }
  if (result.gates.length !== SCENE_EVALUATOR_GATES.length) {
    throw new Error(`Scene evaluator must return exactly ${SCENE_EVALUATOR_GATES.length} visual gates`);
  }
  const seen = new Set();
  const gates = result.gates.map((gate) => {
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
      throw new Error('Scene evaluator gates must be objects');
    }
    if (!ALLOWED_EVALUATOR_GATES.has(gate.id) || seen.has(gate.id)) {
      throw new Error(`Scene evaluator returned an unexpected or duplicate gate ${gate.id ?? '(unknown)'}`);
    }
    if (!['PASS', 'FAIL'].includes(gate.decision)) {
      throw new Error(`Scene evaluator gate ${gate.id} must declare PASS or FAIL`);
    }
    if (typeof gate.evidence !== 'string' || gate.evidence.trim() === '') {
      throw new Error(`Scene evaluator gate ${gate.id} must include evidence`);
    }
    seen.add(gate.id);
    return {
      id: gate.id,
      decision: gate.decision,
      evidence: gate.evidence.trim(),
      defects: Array.isArray(gate.defects) ? gate.defects.map(String) : [],
    };
  });
  for (const gate of SCENE_EVALUATOR_GATES) {
    if (!seen.has(gate)) throw new Error(`Scene evaluator omitted ${gate}`);
  }
  if (!result.reviewer || typeof result.reviewer !== 'object' || Array.isArray(result.reviewer)) {
    throw new Error('Scene evaluator must include a reviewer receipt');
  }
  for (const field of ['type', 'id', 'version', 'request_id']) {
    if (typeof result.reviewer[field] !== 'string' || result.reviewer[field].trim() === '') {
      throw new Error(`Scene evaluator reviewer is missing ${field}`);
    }
  }
  if (!['HUMAN', 'MODEL'].includes(result.reviewer.type)) {
    throw new Error('Scene evaluator reviewer.type must be HUMAN or MODEL');
  }
  if (MOVING_MODEL_VERSION.test(result.reviewer.version)) {
    throw new Error('Scene evaluator reviewer.version must be immutable');
  }
  return {
    gates: SCENE_EVALUATOR_GATES.map((id) => gates.find((gate) => gate.id === id)),
    score: Number.isFinite(result.score) ? Number(result.score) : null,
    summary: typeof result.summary === 'string' ? result.summary.trim() : '',
    reviewer: {
      type: result.reviewer.type,
      id: result.reviewer.id.trim(),
      version: result.reviewer.version.trim(),
      request_id: result.reviewer.request_id.trim(),
    },
    framing_evidence: result.framing_evidence,
    item_fidelity_evidence: normalizeItemFidelityEvidence(result.item_fidelity_evidence),
  };
}

// One owner for the space below the subject. The below-footwear framing lock
// and the contact-point observation ask the same geometry question at two
// resolutions, so consumers must not rederive it independently.
function clearSpaceBelowSubjectPercent(bbox, height) {
  const [, y, , bboxHeight] = bbox;
  return Number((((height - y - bboxHeight) / height) * 100).toFixed(4));
}

// A subject box ending strictly above the canvas bottom leaves the contact
// point inside the frame. This says nothing about foreground occlusion; that
// separate observed claim is audited by scene-adapters.
export function contactPointInsideFrame(evidence, { height }) {
  if (!Number.isInteger(height) || height < 1) {
    throw new Error('A contact-point observation requires a positive integer canvas height');
  }
  const bbox = evidence?.subject_bbox_xywh_px;
  if (!Array.isArray(bbox)
    || bbox.length !== 4
    || bbox.some((value) => !Number.isInteger(value))) {
    throw new Error('framing_evidence.subject_bbox_xywh_px must contain four integers');
  }
  return clearSpaceBelowSubjectPercent(bbox, height) > 0;
}

// The measurement primitive. Production code must not call it: it reaches the lock
// through assessSceneFraming, which is the only function allowed to spell these option
// names. See the note there.
export function assessFramingEvidence(evidence, {
  width,
  height,
  expectedSubjectHeightPercent,
  minimumAboveHairPercent = 8,
  minimumBelowFootwearPercent = 2,
  requireFullHead = true,
  requireFullFootwear = true,
  aboveIsAdvisoryWhenHeadVisible = false,
}) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Scene delivery dimensions must be positive integers');
  }
  if (!Number.isFinite(minimumAboveHairPercent)
    || minimumAboveHairPercent < 0
    || minimumAboveHairPercent > 100
    || !Number.isFinite(minimumBelowFootwearPercent)
    || minimumBelowFootwearPercent < 0
    || minimumBelowFootwearPercent > 100) {
    throw new Error('Scene framing clear-space locks must be finite percentages from 0 to 100');
  }
  if (typeof requireFullHead !== 'boolean' || typeof requireFullFootwear !== 'boolean') {
    throw new Error('Scene framing visibility locks must be booleans');
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Scene evaluator must include framing_evidence');
  }
  if (typeof evidence.full_head_visible !== 'boolean'
    || typeof evidence.full_footwear_visible !== 'boolean') {
    throw new Error('framing_evidence visibility fields must be booleans');
  }
  const bbox = evidence.subject_bbox_xywh_px;
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((value) => !Number.isInteger(value))) {
    throw new Error('framing_evidence.subject_bbox_xywh_px must contain four integers');
  }
  const [x, y, bboxWidth, bboxHeight] = bbox;
  if (x < 0 || y < 0 || bboxWidth < 1 || bboxHeight < 1 || x + bboxWidth > width || y + bboxHeight > height) {
    throw new Error('framing_evidence subject bbox must fit inside the delivery canvas');
  }
  if (!Array.isArray(expectedSubjectHeightPercent)
    || expectedSubjectHeightPercent.length !== 2
    || !expectedSubjectHeightPercent.every(Number.isFinite)
    || expectedSubjectHeightPercent.some((value) => value < 0 || value > 100)
    || expectedSubjectHeightPercent[0] > expectedSubjectHeightPercent[1]) {
    throw new Error('Scene preset must declare an ordered subject_height_percent range from 0 to 100');
  }
  const subjectHeight = Number(((bboxHeight / height) * 100).toFixed(4));
  const aboveHair = Number(((y / height) * 100).toFixed(4));
  const belowFootwear = clearSpaceBelowSubjectPercent(bbox, height);
  const defects = [];
  if (subjectHeight < expectedSubjectHeightPercent[0] || subjectHeight > expectedSubjectHeightPercent[1]) {
    defects.push('SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE');
  }
  const headroomShort = requireFullHead && aboveHair < minimumAboveHairPercent;
  const headroomWaived = headroomShort
    && aboveIsAdvisoryWhenHeadVisible
    && evidence.full_head_visible === true;
  if (headroomShort && !headroomWaived) {
    defects.push('INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR');
  }
  if (requireFullFootwear && belowFootwear < minimumBelowFootwearPercent) {
    defects.push('INSUFFICIENT_CLEAR_SPACE_BELOW_FOOTWEAR');
  }
  if (requireFullHead && evidence.full_head_visible !== true) defects.push('FULL_HEAD_NOT_VISIBLE');
  if (requireFullFootwear && evidence.full_footwear_visible !== true) {
    defects.push('FULL_FOOTWEAR_NOT_VISIBLE');
  }
  return {
    evidence: {
      canvas_width: width,
      canvas_height: height,
      subject_bbox_xywh_px: bbox,
      expected_subject_height_percent: [...expectedSubjectHeightPercent],
      subject_height_percent: subjectHeight,
      minimum_clear_space_above_hair_percent: minimumAboveHairPercent,
      minimum_clear_space_below_footwear_percent: minimumBelowFootwearPercent,
      clear_space_above_hair_percent: aboveHair,
      // Without this the allowance was only inferable — headroom under its own minimum
      // and no INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR beside it — and a reader who did not
      // know the editorial lock existed read the receipt as a passing frame that simply
      // measured 3.2813 against 6. scene_13313d49 shipped exactly that.
      clear_space_above_hair_waived_by_full_head: headroomWaived,
      clear_space_below_footwear_percent: belowFootwear,
      full_head_visible: evidence.full_head_visible === true,
      full_footwear_visible: evidence.full_footwear_visible === true,
    },
    defects,
  };
}

// The one entry point for a framing verdict: hand it the preset, never the bands. The
// four assessments used to source their own options and the live one built them by hand
// off preset.camera, so the editorial headroom waiver was threaded through the three
// lock-driven callers, passed its unit tests and changed nothing in production — the
// assessment that actually decides a shot never saw the flag. Two paid generation
// rounds and an hour went into rediscovering that. The lock option names are spelled
// out here and nowhere else, which is what makes a new framing rule unable to reach
// only some of the paths.
export function assessSceneFraming(evidence, { preset, width, height }) {
  const lock = sceneFramingLock(preset);
  return assessFramingEvidence(evidence, {
    width,
    height,
    expectedSubjectHeightPercent: lock.subject,
    minimumAboveHairPercent: lock.above,
    minimumBelowFootwearPercent: lock.below,
    requireFullHead: lock.head,
    requireFullFootwear: lock.footwear,
    aboveIsAdvisoryWhenHeadVisible: lock.aboveIsAdvisoryWhenHeadVisible === true,
  });
}

export function validateFramingEvidence(evidence, options) {
  const assessment = assessFramingEvidence(evidence, options);
  if (assessment.defects.includes('SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE')) {
    throw new Error('Measured subject height is outside the preset framing range');
  }
  if (assessment.defects.some((defect) => defect.startsWith('INSUFFICIENT_CLEAR_SPACE_'))) {
    throw new Error('Measured clear space is below the framing lock');
  }
  if (assessment.defects.includes('FULL_HEAD_NOT_VISIBLE')
    || assessment.defects.includes('FULL_FOOTWEAR_NOT_VISIBLE')) {
    throw new Error('Framing evidence must confirm complete head and footwear');
  }
  return assessment.evidence;
}

export function deterministicFramingCropPlan(framing, delivery) {
  if (!framing
    || framing.full_head_visible !== true
    || framing.full_footwear_visible !== true
    || !Array.isArray(framing.subject_bbox_xywh_px)
    || framing.subject_bbox_xywh_px.length !== 4
    || !Array.isArray(framing.expected_subject_height_percent)
    || framing.expected_subject_height_percent.length !== 2) {
    return null;
  }
  const [boxX, boxY, boxWidth, boxHeight] = framing.subject_bbox_xywh_px;
  const [minimumPercent, maximumPercent] = framing.expected_subject_height_percent;
  if (![boxX, boxY, boxWidth, boxHeight, minimumPercent, maximumPercent].every(Number.isFinite)
    || boxWidth <= 0
    || boxHeight <= 0
    || minimumPercent <= 0
    || maximumPercent < minimumPercent
    || framing.subject_height_percent >= minimumPercent) {
    return null;
  }
  const targetPercent = (minimumPercent + maximumPercent) / 2;
  const minimumCropHeight = Math.ceil(boxHeight / (maximumPercent / 100) / 5) * 5;
  const maximumCropHeight = Math.floor(boxHeight / (minimumPercent / 100) / 5) * 5;
  let cropHeight = Math.round(boxHeight / (targetPercent / 100) / 5) * 5;
  cropHeight = Math.max(minimumCropHeight, Math.min(maximumCropHeight, cropHeight, delivery.height));
  const cropWidth = cropHeight * 4 / 5;
  if (!Number.isInteger(cropWidth)
    || cropWidth > delivery.width
    || cropHeight > delivery.height
    || cropWidth < boxWidth
    || cropHeight < boxHeight) {
    return null;
  }

  const minimumAbove = cropHeight * (framing.minimum_clear_space_above_hair_percent / 100);
  const minimumBelow = cropHeight * (framing.minimum_clear_space_below_footwear_percent / 100);
  const minimumTop = Math.max(
    0,
    Math.ceil(boxY + boxHeight + minimumBelow - cropHeight),
  );
  const maximumTop = Math.min(
    delivery.height - cropHeight,
    Math.floor(boxY - minimumAbove),
  );
  if (minimumTop > maximumTop) return null;
  const centeredTop = Math.round(boxY + boxHeight / 2 - cropHeight / 2);
  const top = Math.max(minimumTop, Math.min(maximumTop, centeredTop));
  const centeredLeft = Math.round(boxX + boxWidth / 2 - cropWidth / 2);
  const left = Math.max(0, Math.min(delivery.width - cropWidth, centeredLeft));
  if (left > boxX
    || top > boxY
    || left + cropWidth < boxX + boxWidth
    || top + cropHeight < boxY + boxHeight) {
    return null;
  }
  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
    target_subject_height_percent: targetPercent,
    output_scale: Number((delivery.height / cropHeight).toFixed(6)),
  };
}

export function allGatesPass(gates) {
  return Array.isArray(gates)
    && gates.length === SCENE_QA_GATES.length
    && SCENE_QA_GATES.every((id, index) => gates[index]?.id === id && gates[index]?.decision === 'PASS');
}

function validatePersistedQaGates(gates, expectedIds, label) {
  if (!Array.isArray(gates) || gates.length !== expectedIds.length) {
    throw new Error(`${label} must contain exactly ${expectedIds.length} ordered gates`);
  }
  gates.forEach((gate, index) => {
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
      throw new Error(`${label} gate ${index + 1} is invalid`);
    }
    assertExactKeys(gate, ['id', 'decision', 'evidence', 'defects'], `${label} gate ${index + 1}`);
    if (gate.id !== expectedIds[index]
      || !['PASS', 'FAIL'].includes(gate.decision)
      || typeof gate.evidence !== 'string'
      || gate.evidence.length === 0
      || !Array.isArray(gate.defects)
      || gate.defects.some((defect) => typeof defect !== 'string' || defect.length === 0)) {
      throw new Error(`${label} gate ${index + 1} is invalid`);
    }
    if (gate.decision === 'PASS' && gate.defects.length > 0) {
      throw new Error(`${label} PASS gate ${gate.id} cannot retain named defects`);
    }
  });
}

function validatePersistedReviewer(reviewer, label) {
  if (!reviewer || typeof reviewer !== 'object' || Array.isArray(reviewer)) {
    throw new Error(`${label} reviewer is invalid`);
  }
  assertExactKeys(reviewer, ['type', 'id', 'version', 'request_id'], `${label} reviewer`);
  if (!['HUMAN', 'MODEL'].includes(reviewer.type)
    || typeof reviewer.id !== 'string'
    || reviewer.id.length === 0
    || typeof reviewer.version !== 'string'
    || reviewer.version.length === 0
    || MOVING_MODEL_VERSION.test(reviewer.version)
    || typeof reviewer.request_id !== 'string'
    || reviewer.request_id.length === 0) {
    throw new Error(`${label} reviewer receipt is invalid`);
  }
}

function validatePersistedFramingEvidence(evidence, {
  preset,
  width,
  height,
  requirePass,
  label,
}) {
  const assessment = assessSceneFraming(evidence, { preset, width, height });
  // A receipt written before the waiver was stated carries every measurement but not
  // the flag. That flag is derived from those measurements and the preset lock, never
  // reported by the evaluator, so recomputing it for such a receipt cannot be wrong and
  // its absence is the single difference tolerated here — everything else still has to
  // match byte for byte. Demanding it would instead have quarantined all nine persisted
  // scenes on the next read, three of them delivered editorial heroes.
  const comparable = evidence?.clear_space_above_hair_waived_by_full_head === undefined
    ? Object.fromEntries(Object.entries(assessment.evidence)
      .filter(([key]) => key !== 'clear_space_above_hair_waived_by_full_head'))
    : assessment.evidence;
  if (sha256(canonicalJsonBytes(comparable)) !== sha256(canonicalJsonBytes(evidence))) {
    throw new Error(`${label} framing evidence does not match its measured bounding box`);
  }
  if (requirePass && assessment.defects.length > 0) {
    throw new Error(`${label} PASS framing evidence violates ${assessment.defects.join(', ')}`);
  }
  return assessment;
}

function validatePersistedNormalization(normalization, { attempt, state }) {
  if (normalization === null) return;
  if (!normalization || typeof normalization !== 'object' || Array.isArray(normalization)) {
    throw new Error(`Persisted scene attempt ${attempt.number} normalization is invalid`);
  }
  const baseKeys = [
    'source_width',
    'source_height',
    'target_width',
    'target_height',
    'strategy',
    'color_space',
    'exact_aspect_ratio',
  ];
  const deterministicKeys = [
    ...baseKeys,
    'source_attempt',
    'source_candidate_sha256',
    'crop_xywh_px',
    'target_subject_height_percent',
    'output_scale',
    'trigger_framing_evidence',
    'trigger_reviewer',
  ];
  const deterministic = normalization.strategy === 'deterministic_bbox_crop';
  assertExactKeys(
    normalization,
    deterministic ? deterministicKeys : baseKeys,
    `Persisted scene attempt ${attempt.number} normalization`,
  );
  if (!Number.isInteger(normalization.source_width)
    || normalization.source_width < 1
    || !Number.isInteger(normalization.source_height)
    || normalization.source_height < 1
    || normalization.target_width !== state.delivery.width
    || normalization.target_height !== state.delivery.height
    || !['same_aspect_lossless_resize', 'deterministic_bbox_crop'].includes(normalization.strategy)
    || normalization.color_space !== 'srgb'
    || normalization.exact_aspect_ratio !== '4:5') {
    throw new Error(`Persisted scene attempt ${attempt.number} normalization geometry is invalid`);
  }
  if (!deterministic) return;

  assertSha256(
    normalization.source_candidate_sha256,
    `scene attempt ${attempt.number} deterministic source sha256`,
  );
  if (!Number.isInteger(normalization.source_attempt)
    || normalization.source_attempt < 1
    || normalization.source_attempt > attempt.number
    || !Array.isArray(normalization.crop_xywh_px)
    || normalization.crop_xywh_px.length !== 4
    || normalization.crop_xywh_px.some((value) => !Number.isInteger(value))
    || !Number.isFinite(normalization.target_subject_height_percent)
    || normalization.target_subject_height_percent < 1
    || normalization.target_subject_height_percent > 100
    || !Number.isFinite(normalization.output_scale)
    || normalization.output_scale <= 1) {
    throw new Error(`Persisted scene attempt ${attempt.number} deterministic framing receipt is invalid`);
  }
  const [left, top, width, height] = normalization.crop_xywh_px;
  if (left < 0
    || top < 0
    || width < 1
    || height < 1
    || left + width > normalization.source_width
    || top + height > normalization.source_height
    || width * 5 !== height * 4
    || Number((state.delivery.height / height).toFixed(6)) !== normalization.output_scale) {
    throw new Error(`Persisted scene attempt ${attempt.number} deterministic crop geometry is invalid`);
  }
  validatePersistedReviewer(
    normalization.trigger_reviewer,
    `Persisted scene attempt ${attempt.number} deterministic trigger`,
  );
  validatePersistedFramingEvidence(normalization.trigger_framing_evidence, {
    preset: state.bindings.preset,
    width: normalization.source_width,
    height: normalization.source_height,
    requirePass: false,
    label: `Persisted scene attempt ${attempt.number} deterministic trigger`,
  });
  const expectedPlan = deterministicFramingCropPlan(
    normalization.trigger_framing_evidence,
    state.delivery,
  );
  if (!expectedPlan
    || sha256(canonicalJsonBytes([
      expectedPlan.left,
      expectedPlan.top,
      expectedPlan.width,
      expectedPlan.height,
    ])) !== sha256(canonicalJsonBytes(normalization.crop_xywh_px))
    || expectedPlan.target_subject_height_percent !== normalization.target_subject_height_percent
    || expectedPlan.output_scale !== normalization.output_scale) {
    throw new Error(`Persisted scene attempt ${attempt.number} deterministic crop plan is invalid`);
  }
  if (normalization.source_attempt < attempt.number) {
    const sourceAttempt = state.attempts.find(
      (candidate) => candidate.number === normalization.source_attempt,
    );
    if (!sourceAttempt
      || sourceAttempt.status !== 'QA_FAILED'
      || sourceAttempt.candidate?.sha256 !== normalization.source_candidate_sha256
      || sha256(canonicalJsonBytes(sourceAttempt.qa?.framing_evidence))
        !== sha256(canonicalJsonBytes(normalization.trigger_framing_evidence))
      || sha256(canonicalJsonBytes(sourceAttempt.qa?.reviewer))
        !== sha256(canonicalJsonBytes(normalization.trigger_reviewer))) {
      throw new Error(`Persisted scene attempt ${attempt.number} deterministic source lineage is invalid`);
    }
  }
}

function assertRelativeArtifactPath(value, label) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.split(/[\\/]/).some((part) => part === '..')) {
    throw new Error(`${label} must be a safe scene-relative artifact path`);
  }
}

export function validatePersistedSceneState(state, expectedSceneId) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Persisted scene state must be an object');
  }
  assertExactKeys(
    state,
    [
      'schema_version',
      'scene_id',
      'state_revision',
      'request_fingerprint',
      'idempotency_hash',
      'status',
      'phase',
      'message',
      'created_at',
      'updated_at',
      'bindings',
      'delivery',
      'model_route',
      'cycle',
      'manual_retries',
      'retry_requests',
      'attempts',
      'qa',
      'output',
      'error',
      'cancellation',
    ],
    'Persisted scene state',
  );
  if (state.schema_version !== SCENE_SCHEMA_VERSION || state.scene_id !== expectedSceneId) {
    throw new Error('Persisted scene state identity is invalid');
  }
  assertSafeSceneId(state.scene_id);
  if (!Number.isInteger(state.state_revision) || state.state_revision < 1) {
    throw new Error('Persisted scene state_revision is invalid');
  }
  assertSha256(state.request_fingerprint, 'scene.request_fingerprint');
  assertSha256(state.idempotency_hash, 'scene.idempotency_hash');
  if (!Object.values(SCENE_STATES).includes(state.status)) throw new Error('Persisted scene status is invalid');
  for (const field of ['phase', 'message', 'created_at', 'updated_at']) {
    if (typeof state[field] !== 'string') throw new Error(`Persisted scene ${field} is invalid`);
  }
  if (Number.isNaN(Date.parse(state.created_at)) || Number.isNaN(Date.parse(state.updated_at))) {
    throw new Error('Persisted scene timestamps are invalid');
  }
  normalizeDelivery(state.delivery);
  if (!state.model_route || typeof state.model_route !== 'object') throw new Error('Persisted scene model route is invalid');
  assertExactKeys(state.model_route, ['route_version', 'sha256', 'entries'], 'Persisted scene model route');
  const route = normalizeModelRoute(state.model_route.entries);
  if (state.model_route.route_version !== 'zeely.scene.image-route.v1') {
    throw new Error('Persisted scene route version is invalid');
  }
  assertSha256(state.model_route.sha256, 'scene.model_route.sha256');
  if (sha256(canonicalJsonBytes(route)) !== state.model_route.sha256) {
    throw new Error('Persisted scene model route hash is invalid');
  }
  const bindings = state.bindings;
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new Error('Persisted scene bindings are invalid');
  }
  const bindingNames = [
    'approved_look',
    ...(Object.hasOwn(bindings, 'approved_items') ? ['approved_items'] : []),
    ...(Object.hasOwn(bindings, 'shot_anchors') ? ['shot_anchors'] : []),
    'preset',
    'prompt',
    'reference_pack',
  ];
  assertExactKeys(bindings, bindingNames, 'Persisted scene bindings');
  const bindingKeys = {
    approved_look: [
      'look_id',
      'image_sha256',
      'media_type',
      'receipt_sha256',
      'receipt_format',
      'source_run_id',
      'relative_path',
      'receipt_relative_path',
    ],
    preset: ['preset_id', 'version', 'sha256', 'relative_path'],
    prompt: ['sha256', 'relative_path'],
    reference_pack: [
      'reference_pack_id',
      'version',
      'sha256',
      'relative_path',
      'source_ledger',
      'references',
    ],
  };
  for (const [binding, fields] of Object.entries({
    approved_look: ['look_id', 'image_sha256', 'receipt_sha256', 'relative_path', 'receipt_relative_path'],
    preset: ['preset_id', 'version', 'sha256', 'relative_path'],
    prompt: ['sha256', 'relative_path'],
    reference_pack: ['reference_pack_id', 'version', 'sha256', 'relative_path'],
  })) {
    const value = bindings[binding];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Persisted scene ${binding} binding is invalid`);
    }
    assertExactKeys(value, bindingKeys[binding], `Persisted scene ${binding} binding`);
    for (const field of fields) {
      if (typeof value[field] !== 'string' || value[field].length === 0) {
        throw new Error(`Persisted scene ${binding}.${field} is invalid`);
      }
    }
    for (const [field, valueText] of Object.entries(value)) {
      if (field.endsWith('sha256')) assertSha256(valueText, `scene.${binding}.${field}`);
      if (field.endsWith('relative_path')) assertRelativeArtifactPath(valueText, `scene.${binding}.${field}`);
    }
  }
  if (bindings.approved_items !== undefined) {
    const items = bindings.approved_items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      throw new Error('Persisted scene approved_items binding is invalid');
    }
    assertExactKeys(items, [
      'schema_version', 'kind', 'source_run_id', 'reference_pack_sha256',
      'evidence_sha256', 'relative_path', 'items',
    ], 'Persisted scene approved_items binding');
    for (const field of ['schema_version', 'kind', 'source_run_id', 'relative_path']) {
      if (typeof items[field] !== 'string' || items[field].length === 0) {
        throw new Error(`Persisted scene approved_items.${field} is invalid`);
      }
    }
    assertSha256(items.reference_pack_sha256, 'scene.approved_items.reference_pack_sha256');
    assertSha256(items.evidence_sha256, 'scene.approved_items.evidence_sha256');
    assertRelativeArtifactPath(items.relative_path, 'scene.approved_items.relative_path');
    if (!Array.isArray(items.items) || items.items.length < 1) {
      throw new Error('Persisted scene approved_items entries are invalid');
    }
    for (const item of items.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Persisted scene approved item is invalid');
      }
      assertExactKeys(item, [
        'order', 'role', 'category', 'reference_set_id', 'sha256', 'facts_sha256', 'media_type', 'relative_path',
      ], 'Persisted scene approved item');
      if (!Number.isInteger(item.order) || item.order < 1
        || typeof item.role !== 'string' || typeof item.category !== 'string'
        || typeof item.reference_set_id !== 'string' || item.media_type !== 'image/png') {
        throw new Error('Persisted scene approved item fields are invalid');
      }
      assertSha256(item.sha256, 'scene.approved_item.sha256');
      assertSha256(item.facts_sha256, 'scene.approved_item.facts_sha256');
      assertRelativeArtifactPath(item.relative_path, 'scene.approved_item.relative_path');
    }
  }
  if (Object.hasOwn(bindings, 'shot_anchors')) {
    const anchors = bindings.shot_anchors;
    if (!Array.isArray(anchors) || anchors.length < 1 || anchors.length > SCENE_SHOT_ANCHOR_ROLES.length) {
      throw new Error('Persisted scene shot_anchors binding is invalid');
    }
    const expectedRoles = SCENE_SHOT_ANCHOR_ROLES.filter(
      (role) => anchors.some((anchor) => anchor?.role === role),
    );
    anchors.forEach((anchor, index) => {
      if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
        throw new Error('Persisted scene shot anchor is invalid');
      }
      assertExactKeys(
        anchor,
        ['order', 'role', 'reference_id', 'sha256', 'media_type', 'relative_path'],
        'Persisted scene shot anchor',
      );
      if (anchor.order !== index + 1
        || anchor.role !== expectedRoles[index]
        || anchor.media_type !== 'image/png') {
        throw new Error('Persisted scene shot anchors are not in canonical anchor order');
      }
      assertSafeSceneId(anchor.reference_id, 'scene shot anchor id');
      assertSha256(anchor.sha256, `scene shot anchor ${anchor.role} sha256`);
      assertRelativeArtifactPath(anchor.relative_path, `scene shot anchor ${anchor.role} path`);
    });
  }
  if (!Array.isArray(bindings.reference_pack.references) || bindings.reference_pack.references.length !== SCENE_REFERENCE_ROLES.length) {
    throw new Error('Persisted scene reference bindings are invalid');
  }
  for (const reference of bindings.reference_pack.references) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw new Error('Persisted scene reference binding is invalid');
    }
    assertExactKeys(
      reference,
      ['reference_id', 'role', 'sha256', 'media_type', 'not_authority_for', 'relative_path'],
      'Persisted scene reference binding',
    );
    assertSafeSceneId(reference.reference_id, 'scene reference id');
    assertSha256(reference.sha256, `scene reference ${reference.reference_id} sha256`);
    assertRelativeArtifactPath(reference.relative_path, `scene reference ${reference.reference_id} path`);
  }
  if (!Number.isInteger(state.cycle) || state.cycle < 1
    || !Number.isInteger(state.manual_retries) || state.manual_retries < 0
    || !Array.isArray(state.retry_requests)
    || state.retry_requests.some((hash) => {
      try { assertSha256(hash, 'scene retry request'); return false; } catch { return true; }
    })) {
    throw new Error('Persisted scene retry state is invalid');
  }
  if (!Array.isArray(state.attempts)) throw new Error('Persisted scene attempts must be an array');
  const attemptNumbers = new Set();
  for (const attempt of state.attempts) {
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)
      || !Number.isInteger(attempt.number) || attempt.number < 1
      || !Number.isInteger(attempt.cycle) || attempt.cycle < 1
      || !Number.isInteger(attempt.cycle_attempt) || attempt.cycle_attempt < 1
      || !['GENERATING', 'NORMALIZATION_PENDING', 'QA_PENDING', 'GENERATION_FAILED', 'QA_FAILED', 'QA_PASS'].includes(attempt.status)
      || attemptNumbers.has(attempt.number)) {
      throw new Error('Persisted scene attempt is invalid');
    }
    assertExactKeys(
      attempt,
      [
        'number',
        'cycle',
        'cycle_attempt',
        'status',
        'route',
        'generation_idempotency_key',
        'started_at',
        'updated_at',
        'compiled_prompt',
        'provider_source',
        'candidate',
        'provider_metadata',
        'normalization',
        'qa_infrastructure_attempts',
        'qa',
        'error',
      ],
      `Persisted scene attempt ${attempt.number}`,
    );
    if (Number.isNaN(Date.parse(attempt.started_at)) || Number.isNaN(Date.parse(attempt.updated_at))) {
      throw new Error('Persisted scene attempt timestamps are invalid');
    }
    if (!Number.isInteger(attempt.qa_infrastructure_attempts)
      || attempt.qa_infrastructure_attempts < 0
      || attempt.qa_infrastructure_attempts > 10) {
      throw new Error('Persisted scene attempt QA retry count is invalid');
    }
    attemptNumbers.add(attempt.number);
    const expectedRoute = route[attempt.cycle_attempt - 1];
    if (!expectedRoute || sha256(canonicalJsonBytes(expectedRoute)) !== sha256(canonicalJsonBytes(attempt.route))) {
      throw new Error('Persisted scene attempt route is invalid');
    }
    assertSha256(attempt.generation_idempotency_key, 'scene attempt generation idempotency key');
    if (attempt.provider_source) {
      assertExactKeys(
        attempt.provider_source,
        ['relative_path', 'sha256', 'size', 'media_type'],
        'Persisted scene attempt provider source',
      );
      assertSha256(attempt.provider_source.sha256, 'scene attempt provider source sha256');
      assertRelativeArtifactPath(attempt.provider_source.relative_path, 'scene attempt provider source path');
      if (!Number.isInteger(attempt.provider_source.size) || attempt.provider_source.size < 1
        || typeof attempt.provider_source.media_type !== 'string' || attempt.provider_source.media_type.length === 0) {
        throw new Error('Persisted scene attempt provider source metadata is invalid');
      }
    }
    if (attempt.candidate) {
      assertExactKeys(
        attempt.candidate,
        ['relative_path', 'sha256', 'size', 'media_type', 'width', 'height'],
        'Persisted scene attempt candidate',
      );
      assertSha256(attempt.candidate.sha256, 'scene attempt candidate sha256');
      assertRelativeArtifactPath(attempt.candidate.relative_path, 'scene attempt candidate path');
      if (attempt.candidate.media_type !== 'image/png'
        || attempt.candidate.width !== 1024
        || attempt.candidate.height !== 1280
        || !Number.isInteger(attempt.candidate.size)
        || attempt.candidate.size < 1) {
        throw new Error('Persisted scene attempt candidate metadata is invalid');
      }
    }
    if (attempt.compiled_prompt) {
      assertExactKeys(
        attempt.compiled_prompt,
        ['relative_path', 'sha256'],
        'Persisted scene attempt compiled prompt',
      );
      assertSha256(attempt.compiled_prompt.sha256, 'scene attempt prompt sha256');
      assertRelativeArtifactPath(attempt.compiled_prompt.relative_path, 'scene attempt prompt path');
    }
    if (!attempt.provider_metadata
      || typeof attempt.provider_metadata !== 'object'
      || Array.isArray(attempt.provider_metadata)
      || !Number.isInteger(attempt.cycle_attempt)
      || attempt.cycle_attempt > route.length) {
      throw new Error('Persisted scene attempt provider metadata is invalid');
    }
    validatePersistedNormalization(attempt.normalization, { attempt, state });
    const hasFinalQa = attempt.status === 'QA_FAILED' || attempt.status === 'QA_PASS';
    if (hasFinalQa) {
      const qaLabel = `Persisted scene attempt ${attempt.number} QA`;
      if (!attempt.qa || typeof attempt.qa !== 'object' || Array.isArray(attempt.qa)) {
        throw new Error(`${qaLabel} receipt is missing`);
      }
      assertKeysWithOptional(
        attempt.qa,
        ['decision', 'gates', 'score', 'summary', 'reviewer', 'framing_evidence'],
        ['item_fidelity_evidence'],
        qaLabel,
      );
      if (attempt.qa.item_fidelity_evidence !== undefined) {
        normalizeItemFidelityEvidence(attempt.qa.item_fidelity_evidence);
      }
      const expectedDecision = attempt.status === 'QA_PASS' ? 'PASS' : 'FAIL';
      if (attempt.qa.decision !== expectedDecision
        || (attempt.qa.score !== null
          && (!Number.isFinite(attempt.qa.score) || attempt.qa.score < 0 || attempt.qa.score > 100))
        || typeof attempt.qa.summary !== 'string') {
        throw new Error(`${qaLabel} decision, score or summary is invalid`);
      }
      const expectedAttemptGates = SCENE_QA_GATES.slice(0, -1);
      validatePersistedQaGates(attempt.qa.gates, expectedAttemptGates, qaLabel);
      validatePersistedReviewer(attempt.qa.reviewer, qaLabel);
      validatePersistedFramingEvidence(attempt.qa.framing_evidence, {
        preset: bindings.preset,
        width: state.delivery.width,
        height: state.delivery.height,
        requirePass: expectedDecision === 'PASS',
        label: qaLabel,
      });
      if (expectedDecision === 'PASS' && attempt.qa.gates.some((gate) => gate.decision !== 'PASS')) {
        throw new Error(`${qaLabel} PASS receipt contains a failed gate`);
      }
      if (expectedDecision === 'FAIL' && attempt.qa.gates.every((gate) => gate.decision === 'PASS')) {
        throw new Error(`${qaLabel} FAIL receipt contains no failed gate`);
      }
      if (expectedDecision === 'PASS' && attempt.error !== null) {
        throw new Error(`${qaLabel} PASS attempt cannot retain an error`);
      }
    } else if (attempt.qa !== null) {
      throw new Error(`Persisted scene attempt ${attempt.number} cannot expose QA before a visual verdict`);
    }
  }
  if (!state.qa || typeof state.qa !== 'object' || Array.isArray(state.qa)
    || !['PENDING', 'PASS', 'FAIL'].includes(state.qa.decision)
    || !Array.isArray(state.qa.gates)
    || state.qa.gates.length < 2
    || state.qa.gates.length > SCENE_QA_GATES.length) {
    throw new Error('Persisted scene QA state is invalid');
  }
  const qaKeys = Object.keys(state.qa);
  if (!['decision', 'gates', 'score', 'summary'].every((key) => qaKeys.includes(key))
    || qaKeys.some((key) => ![
      'decision', 'gates', 'score', 'summary', 'reviewer', 'framing_evidence', 'item_fidelity_evidence',
    ].includes(key))) {
    throw new Error('Persisted scene QA fields are invalid');
  }
  if (state.qa.item_fidelity_evidence !== undefined) {
    normalizeItemFidelityEvidence(state.qa.item_fidelity_evidence);
  }
  validatePersistedQaGates(
    state.qa.gates,
    SCENE_QA_GATES.slice(0, state.qa.gates.length),
    'Persisted scene QA',
  );
  if (state.qa.score !== null
    && (!Number.isFinite(state.qa.score) || state.qa.score < 0 || state.qa.score > 100)) {
    throw new Error('Persisted scene QA score is invalid');
  }
  if (typeof state.qa.summary !== 'string') {
    throw new Error('Persisted scene QA summary is invalid');
  }
  const hasStateFraming = state.qa.framing_evidence !== undefined;
  const hasStateReviewer = state.qa.reviewer !== undefined;
  if (hasStateFraming !== hasStateReviewer) {
    throw new Error('Persisted scene QA framing and reviewer receipts must be stored together');
  }
  if (hasStateFraming) {
    validatePersistedReviewer(state.qa.reviewer, 'Persisted scene QA');
    validatePersistedFramingEvidence(state.qa.framing_evidence, {
      preset: bindings.preset,
      width: state.delivery.width,
      height: state.delivery.height,
      requirePass: state.qa.decision === 'PASS',
      label: 'Persisted scene QA',
    });
  }
  if (state.qa.decision === 'PASS') {
    if (state.qa.gates.length !== SCENE_QA_GATES.length
      || state.qa.gates.some((gate) => gate.decision !== 'PASS')
      || !hasStateFraming) {
      throw new Error('Persisted scene PASS QA receipt is incomplete');
    }
  } else if (state.qa.decision === 'FAIL'
    && state.qa.gates.length > 2
    && state.qa.gates.every((gate) => gate.decision === 'PASS')) {
    throw new Error('Persisted scene FAIL QA receipt contains no failed gate');
  }
  if (state.error !== null
    && (!state.error || typeof state.error !== 'object' || Array.isArray(state.error)
      || typeof state.error.code !== 'string' || typeof state.error.message !== 'string')) {
    throw new Error('Persisted scene error is invalid');
  }
  if (state.error) assertExactKeys(state.error, ['code', 'message'], 'Persisted scene error');
  if (state.cancellation !== null
    && (!state.cancellation || typeof state.cancellation !== 'object' || Array.isArray(state.cancellation)
      || typeof state.cancellation.reason !== 'string'
      || Number.isNaN(Date.parse(state.cancellation.cancelled_at)))) {
    throw new Error('Persisted scene cancellation is invalid');
  }
  if (state.cancellation) {
    assertExactKeys(state.cancellation, ['reason', 'cancelled_at'], 'Persisted scene cancellation');
  }
  if (state.status === SCENE_STATES.COMPLETED) {
    if (!state.output || typeof state.output !== 'object' || state.qa?.decision !== 'PASS') {
      throw new Error('Completed scene is missing its output or PASS receipt');
    }
    assertExactKeys(
      state.output,
      [
        'relative_path',
        'manifest_relative_path',
        'evidence_manifest_relative_path',
        'qa_receipt_relative_path',
        'privacy_report_relative_path',
        'sha256',
        'manifest_sha256',
        'evidence_manifest_sha256',
        'qa_receipt_sha256',
        'privacy_report_sha256',
        'size',
        'media_type',
        'width',
        'height',
      ],
      'Completed scene output',
    );
    assertSha256(state.output.sha256, 'scene output sha256');
    assertSha256(state.output.manifest_sha256, 'scene output manifest sha256');
    assertSha256(state.output.evidence_manifest_sha256, 'scene output evidence manifest sha256');
    assertSha256(state.output.qa_receipt_sha256, 'scene output QA receipt sha256');
    assertSha256(state.output.privacy_report_sha256, 'scene output privacy report sha256');
    assertRelativeArtifactPath(state.output.relative_path, 'scene output path');
    assertRelativeArtifactPath(state.output.manifest_relative_path, 'scene output manifest path');
    assertRelativeArtifactPath(state.output.evidence_manifest_relative_path, 'scene output evidence manifest path');
    assertRelativeArtifactPath(state.output.qa_receipt_relative_path, 'scene output QA receipt path');
    assertRelativeArtifactPath(state.output.privacy_report_relative_path, 'scene output privacy report path');
    if (state.output.relative_path !== 'outputs/scene.png'
      || state.output.manifest_relative_path !== 'outputs/scene-manifest.json'
      || state.output.evidence_manifest_relative_path !== 'outputs/scene-evidence-manifest.json'
      || state.output.qa_receipt_relative_path !== 'outputs/scene-qa-receipt.json'
      || state.output.privacy_report_relative_path !== 'outputs/scene-privacy-report.json'
      || state.output.media_type !== 'image/png'
      || state.output.width !== 1024
      || state.output.height !== 1280
      || !Number.isInteger(state.output.size)
      || state.output.size < 1
      || !allGatesPass(state.qa.gates)) {
      throw new Error('Completed scene output metadata or QA receipt is invalid');
    }
  } else if (state.output !== null) {
    throw new Error('Only a completed scene may expose output');
  }
  return state;
}
