import {
  DEFAULT_SCENE_DELIVERY,
  DEFAULT_SCENE_MODEL_ROUTE,
  canonicalJson,
  deterministicFramingCropPlan,
  normalizeDelivery,
  normalizeModelRoute,
  sceneFramingLock,
  sha256,
} from './scene-contract.js';

// This router owns decisions only.  It never creates a prompt, starts a paid
// job, or changes the immutable three-entry model route.
export const NORMALIZED_DEFECT_VERSION = 'scene-normalized-defect-v1';
export const REPAIR_PLAN_VERSION = 'scene-repair-plan-v1';

// The visible pipeline graph and the executable controller share these names.
// They are intentionally a fixed graph: no language-model response may add a
// node, change its order, broaden a QA threshold, or choose a provider route.
export const SCENE_REPAIR_NODE_GRAPH = Object.freeze([
  Object.freeze({ id: 'VLM_OBSERVATION', output: 'qa_framing_evidence' }),
  Object.freeze({ id: 'DETERMINISTIC_QA_LOCK', output: 'canonical_gate_verdict' }),
  Object.freeze({ id: 'DEFECT_NORMALIZER', output: 'normalized_defect' }),
  Object.freeze({ id: 'REPAIR_ROUTER', output: 'repair_plan' }),
  Object.freeze({ id: 'IMMUTABLE_CHECKPOINT', output: 'request_manifest_and_idempotency_key' }),
]);

const SHA256 = /^[a-f0-9]{64}$/;
const FRAMING_GATE = 'FRAMING_AND_ANATOMY';
const LARGE_MISS_PP = 5;
const MEASUREMENT_EPSILON = 1;
const PROTECTED_HASH_KEY = /^[a-z][a-z0-9_]*_sha256$/;
const FORBIDDEN_SIGNATURE_HASH = /(?:candidate|prompt|prose|summary|message|text)/i;

function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requiredSha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
  return value;
}

function requiredInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function percent(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${label} must be a percentage from 0 to 100`);
  return Number(value);
}

function presetId(input) {
  const value = input.preset_id ?? input.presetId ?? input.preset?.preset_id;
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Scene repair defect requires preset_id');
  return value;
}

function defectCode(input) {
  const direct = input.defect_code ?? input.defectCode ?? input.defect ?? input.named_defect;
  if (typeof direct === 'string' && direct) return direct;
  const values = input.defects ?? input.named_defects ?? [];
  if (Array.isArray(values)) return [...values].filter((value) => typeof value === 'string').sort()[0] ?? null;
  return null;
}

function protectedHashes(input) {
  const hashes = requiredObject(input.protected_hashes ?? input.protectedHashes, 'protected_hashes');
  const entries = Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) throw new Error('protected_hashes must not be empty');
  return Object.freeze(Object.fromEntries(entries.map(([key, value]) => {
    if (!PROTECTED_HASH_KEY.test(key) || FORBIDDEN_SIGNATURE_HASH.test(key)) {
      throw new Error(`protected_hashes.${key} is ineligible for a repair signature`);
    }
    return [key, requiredSha(value, `protected_hashes.${key}`)];
  })));
}

function framingBands(input, id) {
  const lock = sceneFramingLock(id);
  const preferred = [lock.subject[0], lock.subject[1]];
  const delivery = [lock.subject[0], lock.deliverySubjectMaximum ?? lock.subject[1]];
  const supplied = input.delivery_band ?? input.deliveryBand ?? input.delivery_subject_height_percent;
  // The caller may restate the canonical delivery band, but may never broaden it.
  if (supplied !== undefined && (!Array.isArray(supplied) || supplied.length !== 2
    || supplied[0] !== delivery[0] || supplied[1] !== delivery[1])) {
    throw new Error('Scene repair delivery thresholds must exactly match the immutable preset lock');
  }
  return { preferred_band: Object.freeze(preferred), delivery_band: Object.freeze(delivery) };
}

function currentRouteOrder(input) {
  const value = input.current_route_order ?? input.currentRouteOrder
    ?? input.current_attempt?.cycle_attempt ?? input.currentAttempt?.cycle_attempt
    ?? input.current_attempt?.route?.order ?? input.currentAttempt?.route?.order;
  if (Number.isInteger(value)) return value;
  const attempts = input.attempts;
  if (Array.isArray(attempts) && attempts.length) {
    const latest = [...attempts].sort((left, right) => (left.number ?? 0) - (right.number ?? 0)).at(-1);
    if (Number.isInteger(latest?.cycle_attempt ?? latest?.route?.order)) return latest.cycle_attempt ?? latest.route.order;
  }
  throw new Error('Scene repair plan requires the failed current route order');
}

/** Returns, but never mutates, the next entry in the configured immutable route. */
export function nextConfiguredSceneRepairRoute(input) {
  const route = normalizeModelRoute(input.model_route ?? input.modelRoute ?? DEFAULT_SCENE_MODEL_ROUTE);
  const current = currentRouteOrder(input);
  if (current < 1 || current >= route.length) throw new Error('No configured next route model remains for this failed attempt');
  return Object.freeze({ ...route[current] });
}

function history(input) {
  const entries = input.repair_history ?? input.repairHistory ?? input.attempts ?? [];
  if (!Array.isArray(entries)) throw new Error('repair_history must be an array');
  return entries;
}

function signatureOf(entry) {
  return entry?.defect_signature_sha256 ?? entry?.signature_sha256
    ?? entry?.normalized_defect?.signature_sha256;
}

function distanceOf(entry) {
  const value = entry?.distance_to_delivery_band_pp
    ?? entry?.normalized_defect?.distance_to_delivery_band_pp;
  return Number.isFinite(value) ? Number(value) : null;
}

function guideAlreadyFailed(entries, signature) {
  return entries.some((entry) => signatureOf(entry) === signature
    && (entry?.mechanism === 'MECHANICAL_GUIDE' || entry?.repair_plan?.mechanism === 'MECHANICAL_GUIDE')
    && ['QA_FAILED', 'FAILED', 'FAIL'].includes(entry.status ?? entry.outcome ?? entry?.repair_plan?.outcome));
}

function passedGateIds(input) {
  const gates = input.locked_passed_gate_ids ?? input.lockedPassedGateIds ?? input.passed_gates ?? [];
  if (!Array.isArray(gates) || new Set(gates).size !== gates.length || gates.some((gate) => typeof gate !== 'string' || gate === FRAMING_GATE)) {
    throw new Error('locked_passed_gate_ids must be unique non-framing gate ids');
  }
  return Object.freeze([...gates]);
}

/**
 * Normalizes one QA_FAILED framing defect.  candidate_sha256 and prompt_sha256
 * are retained for lineage only; neither is present in signature_sha256 input.
 */
export function normalizeSceneDefect(input) {
  requiredObject(input, 'Scene repair defect');
  if ((input.status ?? input.qa_status ?? 'QA_FAILED') !== 'QA_FAILED') throw new Error('Scene repair router only accepts QA_FAILED defects');
  const gate = input.gate?.id ?? input.gate ?? FRAMING_GATE;
  if (gate !== FRAMING_GATE) throw new Error('Scene repair router only accepts FRAMING_AND_ANATOMY defects');
  const defect_code = defectCode(input);
  if (defect_code !== 'SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE') {
    throw new Error('Scene repair router currently supports SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE only');
  }
  const id = presetId(input);
  const { preferred_band, delivery_band } = framingBands(input, id);
  const observed = percent(input.observed ?? input.observed_subject_height_percent
    ?? input.framing_evidence?.subject_height_percent, 'observed subject height');
  const direction = observed < delivery_band[0] ? 'INCREASE_SUBJECT_SCALE'
    : observed > delivery_band[1] ? 'DECREASE_SUBJECT_SCALE' : 'WITHIN_DELIVERY_BAND';
  const target = direction === 'INCREASE_SUBJECT_SCALE' ? preferred_band[0]
    : direction === 'DECREASE_SUBJECT_SCALE' ? preferred_band[1] : observed;
  const distance_to_delivery_band_pp = Number((direction === 'INCREASE_SUBJECT_SCALE'
    ? delivery_band[0] - observed : direction === 'DECREASE_SUBJECT_SCALE'
      ? observed - delivery_band[1] : 0).toFixed(4));
  const protected_hashes = protectedHashes(input);
  const signature_sha256 = sha256(canonicalJson({
    gate,
    defect_code,
    direction,
    preset_id: id,
    protected_hashes,
  }));
  return Object.freeze({
    version: NORMALIZED_DEFECT_VERSION,
    gate,
    defect_code,
    direction,
    metric: 'subject_height_percent',
    observed,
    target,
    preferred_band,
    delivery_band,
    measurement_epsilon: MEASUREMENT_EPSILON,
    distance_to_delivery_band_pp,
    signature_sha256,
    candidate_sha256: requiredSha(input.candidate_sha256 ?? input.candidateSha256, 'candidate_sha256'),
    prompt_sha256: requiredSha(input.prompt_sha256 ?? input.promptSha256, 'prompt_sha256'),
    attempt: requiredInteger(input.attempt ?? input.source_attempt ?? input.current_attempt?.number, 'attempt'),
    cycle: requiredInteger(input.cycle ?? input.current_attempt?.cycle ?? 1, 'cycle'),
  });
}

/** Creates a schema-compatible, free deterministic crop decision when geometry permits it. */
export function createDeterministicCropRepairPlan(input) {
  requiredObject(input, 'Deterministic crop repair input');
  const normalized = input.normalized_defect ?? input.normalizedDefect ?? normalizeSceneDefect(input);
  const framing = input.framing_evidence ?? input.framingEvidence;
  if (!framing || typeof framing !== 'object') return null;
  const crop = deterministicFramingCropPlan(framing, normalizeDelivery(input.delivery ?? DEFAULT_SCENE_DELIVERY));
  if (!crop) return null;
  return Object.freeze({
    version: REPAIR_PLAN_VERSION,
    source_attempt: normalized.attempt,
    source_candidate_sha256: normalized.candidate_sha256,
    normalized_defect_sha256: sha256(canonicalJson(normalized)),
    defect_signature_sha256: normalized.signature_sha256,
    classification: 'DETERMINISTIC_CROP_AVAILABLE',
    mechanism: 'MECHANICAL_CROP',
    model_action: 'NO_MODEL',
    decision_reason: 'Deterministic crop preserves immutable framing thresholds without paid generation.',
    previous_distance_to_delivery_band_pp: null,
    progress_pp: null,
    locked_passed_gate_ids: passedGateIds(input),
    guide: null,
    request_manifest: null,
  });
}

/** Plans the next repair. Paid outcomes explicitly consume NEXT_ROUTE_MODEL. */
export function planSceneRepair(input) {
  requiredObject(input, 'Scene repair plan input');
  const normalized = input.normalized_defect ?? input.normalizedDefect ?? normalizeSceneDefect(input);
  const cropPlan = input.crop_plan ?? input.cropPlan ?? createDeterministicCropRepairPlan({ ...input, normalized_defect: normalized });
  if (cropPlan) return validateSceneRepairPlan(cropPlan);
  const entries = history(input);
  // The source attempt may be present in history so `guideAlreadyFailed` can
  // see that its already-selected mechanism failed.  It must not, however,
  // count as a previous measurement of itself: that would manufacture a 0pp
  // stall on the first repair.
  const prior = [...entries]
    .filter((entry) => (entry?.number ?? entry?.normalized_defect?.attempt) !== normalized.attempt)
    .reverse()
    .find((entry) => signatureOf(entry) === normalized.signature_sha256);
  const previous_distance_to_delivery_band_pp = distanceOf(prior);
  const progress_pp = previous_distance_to_delivery_band_pp === null ? null
    : Number((previous_distance_to_delivery_band_pp - normalized.distance_to_delivery_band_pp).toFixed(4));
  let classification = normalized.distance_to_delivery_band_pp >= LARGE_MISS_PP ? 'LARGE_MISS' : 'SMALL_MISS';
  let mechanism = normalized.distance_to_delivery_band_pp >= LARGE_MISS_PP
    ? 'MECHANICAL_GUIDE'
    : 'VLM_GUIDED_REPAIR';
  // The persisted route is exactly three distinct provider models. A genuine
  // same-model paid retry would require a versioned route migration, so a
  // small VLM-guided repair is still carried by the next configured model.
  // Naming that honestly is safer than pretending the current model repeated.
  let model_action = 'NEXT_ROUTE_MODEL';
  if (guideAlreadyFailed(entries, normalized.signature_sha256)) {
    classification = 'MODEL_FALLBACK_REQUIRED';
    // Retain the guide mechanism: the fallback is the next model, not an
    // unbounded new repair type.
    mechanism = 'MECHANICAL_GUIDE';
    model_action = 'NEXT_ROUTE_MODEL';
  } else if (previous_distance_to_delivery_band_pp !== null && Math.abs(progress_pp) < normalized.measurement_epsilon) {
    classification = 'STALLED_SAME_MODEL';
    mechanism = 'MECHANICAL_GUIDE';
    model_action = 'NEXT_ROUTE_MODEL';
  }
  // Validate availability now. The route entry is intentionally not copied into
  // the persisted record; model_action tells the immutable route owner exactly what to consume.
  nextConfiguredSceneRepairRoute(input);
  return validateSceneRepairPlan({
    version: REPAIR_PLAN_VERSION,
    source_attempt: normalized.attempt,
    source_candidate_sha256: normalized.candidate_sha256,
    normalized_defect_sha256: sha256(canonicalJson(normalized)),
    defect_signature_sha256: normalized.signature_sha256,
    classification,
    mechanism,
    model_action,
    decision_reason: model_action === 'NEXT_ROUTE_MODEL'
      ? 'Consumes NEXT_ROUTE_MODEL due current immutable 3-entry route.'
      : 'First small framing miss uses bounded VLM repair on the next immutable route model.',
    previous_distance_to_delivery_band_pp,
    progress_pp,
    locked_passed_gate_ids: passedGateIds(input),
    guide: null,
    request_manifest: null,
  });
}

/** Validates an emitted plan without performing I/O; returns it on success. */
export function validateSceneRepairPlan(plan) {
  requiredObject(plan, 'Scene repair plan');
  if (plan.version !== REPAIR_PLAN_VERSION) throw new Error('Scene repair plan version is invalid');
  requiredInteger(plan.source_attempt, 'source_attempt');
  requiredSha(plan.source_candidate_sha256, 'source_candidate_sha256');
  requiredSha(plan.normalized_defect_sha256, 'normalized_defect_sha256');
  requiredSha(plan.defect_signature_sha256, 'defect_signature_sha256');
  if (!['MECHANICAL_CROP', 'MECHANICAL_GUIDE', 'VLM_GUIDED_REPAIR'].includes(plan.mechanism)) {
    throw new Error('Scene repair plan mechanism is invalid');
  }
  if (plan.mechanism === 'MECHANICAL_CROP' && plan.model_action !== 'NO_MODEL') {
    throw new Error('Mechanical crop must not consume a paid model route');
  }
  if (plan.mechanism === 'MECHANICAL_GUIDE' && plan.model_action !== 'NEXT_ROUTE_MODEL') {
    throw new Error('Mechanical guides must consume NEXT_ROUTE_MODEL');
  }
  if (plan.mechanism === 'VLM_GUIDED_REPAIR' && plan.model_action !== 'NEXT_ROUTE_MODEL') {
    throw new Error('VLM-guided repair must consume NEXT_ROUTE_MODEL under the immutable route');
  }
  if (typeof plan.decision_reason !== 'string' || !plan.decision_reason) throw new Error('Scene repair plan needs a decision reason');
  if (plan.guide !== null || plan.request_manifest !== null) throw new Error('Core scene repair router emits no guide or request manifest');
  passedGateIds(plan);
  return plan;
}
