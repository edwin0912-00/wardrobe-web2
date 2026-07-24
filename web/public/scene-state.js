export const ACTIVE_SCENE_KEY = 'zeely_active_scene_v1';

export const SCENE_TERMINAL_STATUSES = Object.freeze([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function sceneIsTerminal(scene) {
  return SCENE_TERMINAL_STATUSES.includes(scene?.status);
}

export function sceneCanCancel(scene) {
  return Boolean(scene && !sceneIsTerminal(scene));
}

export function sceneCanRetry(scene) {
  return ['FAILED', 'CANCELLED'].includes(scene?.status);
}

export function sceneCanDelete(scene) {
  return sceneIsTerminal(scene);
}

// Technical checkpoint/persistence failures preserve the generated candidate
// and only need QA rechecked — never a real creative rejection. Must never
// be shown to the user as "сцена не пройшла перевірку".
const TECHNICAL_RECOVERY_ERROR_CODES = ['QA_INFRASTRUCTURE_FAILED', 'SCENE_INTERNAL_ERROR'];

export function sceneIsTechnicalRecovery(scene) {
  return scene?.status === 'FAILED' && TECHNICAL_RECOVERY_ERROR_CODES.includes(scene?.error?.code);
}

export function sceneTone(scene) {
  if (scene?.status === 'COMPLETED') return 'completed';
  if (scene?.status === 'FAILED') return 'failed';
  if (scene?.status === 'CANCELLED') return 'cancelled';
  return 'running';
}

export function normalizeSceneResume(value) {
  if (!value || typeof value !== 'object') return null;
  const sceneId = value.scene_id == null ? null : String(value.scene_id);
  const lookId = String(value.look_id ?? '');
  const presetId = String(value.preset_id ?? '');
  const presetVersion = String(value.preset_version ?? '');
  const idempotencyKey = String(value.idempotency_key ?? '');
  const referencePackSha256 = value.reference_pack_sha256 == null
    ? null
    : String(value.reference_pack_sha256);
  if (sceneId !== null && !SAFE_ID.test(sceneId)) return null;
  if (!SAFE_ID.test(lookId) || !SAFE_ID.test(presetId) || !SAFE_ID.test(presetVersion)) return null;
  if (idempotencyKey.length < 8 || idempotencyKey.length > 256) return null;
  if (referencePackSha256 !== null && !SHA256.test(referencePackSha256)) return null;
  return {
    schema_version: 1,
    scene_id: sceneId,
    look_id: lookId,
    preset_id: presetId,
    preset_version: presetVersion,
    idempotency_key: idempotencyKey,
    reference_pack_sha256: referencePackSha256,
    updated_at: nonEmptyString(value.updated_at) ? value.updated_at : new Date().toISOString(),
  };
}

export function readSceneResume(storage = globalThis.localStorage) {
  let raw;
  try {
    raw = storage?.getItem(ACTIVE_SCENE_KEY);
    if (!raw) return null;
    const normalized = normalizeSceneResume(JSON.parse(raw));
    if (!normalized) storage?.removeItem(ACTIVE_SCENE_KEY);
    return normalized;
  } catch {
    try { storage?.removeItem(ACTIVE_SCENE_KEY); } catch { /* storage unavailable */ }
    return null;
  }
}

export function writeSceneResume(value, storage = globalThis.localStorage) {
  const normalized = normalizeSceneResume({
    ...value,
    updated_at: new Date().toISOString(),
  });
  if (!normalized) throw new TypeError('Invalid scene resume record');
  storage?.setItem(ACTIVE_SCENE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearSceneResume(storage = globalThis.localStorage) {
  try { storage?.removeItem(ACTIVE_SCENE_KEY); } catch { /* storage unavailable */ }
}

export function safePresetPreviewUrl(preset, baseUrl = globalThis.location?.href ?? 'http://localhost/') {
  const candidate = preset?.preview_url ?? preset?.image_url ?? null;
  if (!nonEmptyString(candidate)) return null;
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(candidate, base);
    if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== base.origin) return null;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return null;
  }
}

export function sceneResumeFromSnapshot(scene, previous = {}) {
  const value = {
    ...previous,
    scene_id: scene?.scene_id,
    look_id: scene?.approved_look?.look_id ?? previous.look_id,
    preset_id: scene?.preset?.preset_id ?? previous.preset_id,
    preset_version: scene?.preset?.version ?? previous.preset_version,
  };
  return normalizeSceneResume(value);
}

export function presetCameraLabel(preset) {
  const lens = Number(preset?.camera?.lens_mm);
  const ratio = nonEmptyString(preset?.camera?.aspect_ratio) ? preset.camera.aspect_ratio : '4:5';
  return Number.isFinite(lens) ? `${lens} мм · ${ratio}` : ratio;
}
