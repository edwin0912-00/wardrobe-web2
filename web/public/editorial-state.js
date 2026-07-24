export const ACTIVE_EDITORIAL_SHOOT_KEY = 'zeely_active_editorial_shoot_v1';

export const EDITORIAL_SHOT_SLOTS = Object.freeze([
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
]);

export const EDITORIAL_TERMINAL_STATUSES = Object.freeze(['COMPLETED', 'CANCELLED']);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const ACTION_TYPES = new Set(['create', 'approve_bible', 'approve_hero', 'retry_shot']);

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function safeSha(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function normalizePendingAction(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || !ACTION_TYPES.has(value.type)) return null;
  const idempotencyKey = String(value.idempotency_key ?? '');
  if (idempotencyKey.length < 8 || idempotencyKey.length > 256) return null;
  const expectedSha256 = value.expected_sha256 == null ? null : String(value.expected_sha256);
  const slot = value.slot == null ? null : String(value.slot);
  if (expectedSha256 !== null && !safeSha(expectedSha256)) return null;
  if (slot !== null && !EDITORIAL_SHOT_SLOTS.includes(slot)) return null;
  if (value.type === 'approve_bible' && expectedSha256 === null) return null;
  if (value.type === 'approve_hero' && expectedSha256 === null) return null;
  if (value.type === 'retry_shot' && slot === null) return null;
  return {
    type: value.type,
    idempotency_key: idempotencyKey,
    expected_sha256: expectedSha256,
    slot,
  };
}

export function editorialIsTerminal(shoot) {
  return EDITORIAL_TERMINAL_STATUSES.includes(shoot?.status);
}

export function editorialCanCancel(shoot) {
  return Boolean(shoot && !editorialIsTerminal(shoot));
}

export function editorialCanDelete(shoot) {
  return editorialIsTerminal(shoot);
}

export function editorialTone(shoot) {
  if (shoot?.status === 'COMPLETED') return 'completed';
  if (shoot?.status === 'CANCELLED') return 'cancelled';
  if (shoot?.status === 'NEEDS_RETRY') return 'failed';
  return 'running';
}

export function normalizeEditorialResume(value) {
  if (!value || typeof value !== 'object') return null;
  const shootId = value.shoot_id == null ? null : String(value.shoot_id);
  const lookId = String(value.look_id ?? '');
  const modeId = String(value.mode_id ?? '');
  const modeVersion = String(value.mode_version ?? '');
  const createIdempotencyKey = String(value.create_idempotency_key ?? '');
  const pendingAction = normalizePendingAction(value.pending_action);
  if (shootId !== null && !safeId(shootId)) return null;
  if (!safeId(lookId) || !safeId(modeId) || !SEMVER.test(modeVersion)) return null;
  if (createIdempotencyKey.length < 8 || createIdempotencyKey.length > 256) return null;
  if (value.pending_action != null && !pendingAction) return null;
  return {
    schema_version: 1,
    shoot_id: shootId,
    look_id: lookId,
    mode_id: modeId,
    mode_version: modeVersion,
    create_idempotency_key: createIdempotencyKey,
    pending_action: pendingAction,
    updated_at: typeof value.updated_at === 'string'
      ? value.updated_at
      : new Date().toISOString(),
  };
}

export function readEditorialResume(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(ACTIVE_EDITORIAL_SHOOT_KEY);
    if (!raw) return null;
    const normalized = normalizeEditorialResume(JSON.parse(raw));
    if (!normalized) storage?.removeItem(ACTIVE_EDITORIAL_SHOOT_KEY);
    return normalized;
  } catch {
    try { storage?.removeItem(ACTIVE_EDITORIAL_SHOOT_KEY); } catch { /* unavailable */ }
    return null;
  }
}

export function writeEditorialResume(value, storage = globalThis.localStorage) {
  const normalized = normalizeEditorialResume({
    ...value,
    updated_at: new Date().toISOString(),
  });
  if (!normalized) throw new TypeError('Invalid editorial shoot resume record');
  storage?.setItem(ACTIVE_EDITORIAL_SHOOT_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearEditorialResume(storage = globalThis.localStorage) {
  try { storage?.removeItem(ACTIVE_EDITORIAL_SHOOT_KEY); } catch { /* unavailable */ }
}

export function editorialResumeFromSnapshot(shoot, previous = {}) {
  return normalizeEditorialResume({
    ...previous,
    shoot_id: shoot?.shoot_id ?? previous.shoot_id,
    look_id: shoot?.bindings?.approved_look?.look_id
      ?? shoot?.approved_look?.look_id
      ?? shoot?.look_id
      ?? previous.look_id,
    mode_id: shoot?.bindings?.shoot_bible?.mode_id
      ?? shoot?.mode?.mode_id
      ?? shoot?.mode_id
      ?? previous.mode_id,
    mode_version: shoot?.bindings?.shoot_bible?.mode_version
      ?? shoot?.mode?.mode_version
      ?? shoot?.mode?.version
      ?? shoot?.mode_version
      ?? previous.mode_version,
    pending_action: null,
  });
}

export function safeEditorialOutputUrl(value, baseUrl = globalThis.location?.href ?? 'http://localhost/') {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(value, base);
    if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== base.origin) return null;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return null;
  }
}

export function editorialShotLabel(slot) {
  return ({
    clean_identity_hero: 'Чистий hero',
    environmental_hero: 'Hero у просторі',
    sculptural_three_quarter: 'Скульптурний 3/4',
    interference_frame: 'Експериментальний кадр',
    material_or_accessory_detail: 'Деталь образу',
    wide_campaign_coda: 'Фінальний campaign',
  })[slot] ?? String(slot ?? '').replaceAll('_', ' ');
}
