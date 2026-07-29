import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { sanitizeOutbound, sanitizeOutboundString } from '../security/outbound-redaction.js';
import {
  approvedItemEvidenceDocument,
  approvedItemFactsSha256,
} from './approved-item-evidence.js';
import {
  DEFAULT_SCENE_DELIVERY,
  DEFAULT_SCENE_MODEL_ROUTE,
  SCENE_EVALUATOR_GATES,
  SCENE_QA_GATES,
  SCENE_SCHEMA_VERSION,
  SCENE_STATES,
  SCENE_TERMINAL_STATES,
  allGatesPass,
  assessSceneFraming,
  assertIdempotencyKey,
  assertSafeSceneId,
  canonicalJsonBytes,
  deterministicFramingCropPlan,
  normalizeDelivery,
  normalizeEvaluatorResult,
  normalizeModelRoute,
  sceneQaItemScope,
  sha256,
  validateApprovedLookReference,
  validatePersistedSceneState,
  validatePresetReference,
  validatePresetSnapshot,
  validateReferencePack,
  validateResolvedReferenceAssets,
  validateShotAnchorReferences,
} from './scene-contract.js';

const OUTPUT_HASH_FIELDS = Object.freeze({
  'scene.png': 'sha256',
  'scene-manifest.json': 'manifest_sha256',
  'scene-evidence-manifest.json': 'evidence_manifest_sha256',
  'scene-qa-receipt.json': 'qa_receipt_sha256',
  'scene-privacy-report.json': 'privacy_report_sha256',
});
const OUTPUT_FILES = new Set(Object.keys(OUTPUT_HASH_FIELDS));
const RESUMABLE_ATTEMPT_STATES = new Set(['GENERATING', 'NORMALIZATION_PENDING', 'QA_PENDING', 'QA_PASS']);
const MIME_EXTENSION = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/json': '.json',
  'text/plain': '.txt',
});
const NO_CHANGE = Symbol('NO_CHANGE');
const LOCK_NOT_ACQUIRED = Symbol('LOCK_NOT_ACQUIRED');
const PROCESS_STARTED_AT_MS = Date.now() - Math.round(process.uptime() * 1_000);
const RESERVED_ROOT_DIRECTORIES = new Set(['.locks', '.tombstones', 'incidents', 'quarantine']);
const LOCK_POLL_MS = 25;
const LOCK_WAIT_MS = 10_000;
const LOCK_MALFORMED_GRACE_MS = 5_000;
const SCENE_PRIVACY_RULES = Object.freeze([
  'NO_ABSOLUTE_USER_PATHS',
  'NO_PRIVATE_RUNTIME_PATHS',
  'NO_SECRET_VALUES',
  'NO_LOCAL_FILE_URIS',
  'PERSONAL_INPUT_POLICY',
]);
const POST_RELEASE_REJECTION_TYPE = 'POST_RELEASE_SCENE_REJECTION';
const POST_RELEASE_REJECTION_LEDGER_TYPE = 'POST_RELEASE_SCENE_REJECTION_LEDGER_ENTRY';
const POST_RELEASE_REJECTION_GATES = new Set(SCENE_EVALUATOR_GATES);
const MOVING_REVIEWER_VERSION = /^(?:builtin-current|current|latest|unknown)$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
// Change this only when the bytes sent to the image provider change. It is part
// of provider idempotency, so an old journal can never be replayed against a
// materially different repair contract.
const SCENE_GENERATION_CONTRACT_VERSION = 'scene-generation-contract-v8-gpt-3-4-tolerance';

function nowIso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('SceneService clock must return a valid Date or timestamp');
  return date.toISOString();
}

function assertExactObjectKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
}

function normalizeRejectionText(value, label, maximum) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`${label} must contain between 1 and ${maximum} characters`);
  }
  assertNoLocalPathText(normalized, label);
  if (privacyFindingsForText(normalized, label).length > 0) {
    throw new Error(`${label} contains private or credential-shaped material`);
  }
  return normalized;
}

function normalizePostReleaseRejectionRequest({
  expectedOutputSha256,
  gateId,
  evidence,
  defects,
  reviewer,
}) {
  assertHash(expectedOutputSha256, 'expectedOutputSha256');
  if (!POST_RELEASE_REJECTION_GATES.has(gateId)) {
    throw new Error('gateId must be one of the six visual scene QA gates');
  }
  if (!Array.isArray(defects) || defects.length < 1 || defects.length > 20) {
    throw new Error('defects must contain between 1 and 20 named defects');
  }
  const normalizedDefects = defects.map((defect, index) => (
    normalizeRejectionText(defect, `defects[${index}]`, 300)
  ));
  if (new Set(normalizedDefects).size !== normalizedDefects.length) {
    throw new Error('defects must not contain duplicates');
  }
  assertExactObjectKeys(reviewer, ['type', 'id', 'version', 'request_id'], 'reviewer');
  if (!['HUMAN', 'MODEL'].includes(reviewer.type)) {
    throw new Error('reviewer.type must be HUMAN or MODEL');
  }
  const normalizedReviewer = {
    type: reviewer.type,
    id: normalizeRejectionText(reviewer.id, 'reviewer.id', 200),
    version: normalizeRejectionText(reviewer.version, 'reviewer.version', 200),
    request_id: normalizeRejectionText(reviewer.request_id, 'reviewer.request_id', 300),
  };
  if (MOVING_REVIEWER_VERSION.test(normalizedReviewer.version)) {
    throw new Error('reviewer.version must be immutable');
  }
  return {
    expected_output_sha256: expectedOutputSha256,
    gate_id: gateId,
    evidence: normalizeRejectionText(evidence, 'evidence', 2_000),
    defects: normalizedDefects,
    reviewer: normalizedReviewer,
  };
}

async function exists(filename) {
  try {
    await access(filename, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, filename);
}

async function writeImmutable(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.immutable`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    try {
      await link(temporary, filename);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = await readFile(filename);
      if (!current.equals(bytes)) throw new Error(`Immutable scene artifact conflict: ${path.basename(filename)}`);
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reducedAspectRatio(width, height) {
  let left = Math.abs(Math.trunc(width));
  let right = Math.abs(Math.trunc(height));
  while (right) [left, right] = [right, left % right];
  const divisor = left || 1;
  return `${Math.trunc(width / divisor)}:${Math.trunc(height / divisor)}`;
}

function lockOwnerIsAlive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1 || typeof owner.acquired_at !== 'string') {
    return false;
  }
  const acquiredAt = Date.parse(owner.acquired_at);
  if (!Number.isFinite(acquiredAt)) return false;
  if (owner.pid === process.pid) {
    return acquiredAt >= PROCESS_STARTED_AT_MS - 5_000;
  }
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function acquireFilesystemLock(filename, {
  waitMs = LOCK_WAIT_MS,
  pollMs = LOCK_POLL_MS,
} = {}) {
  await mkdir(path.dirname(filename), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  while (true) {
    let handle;
    try {
      handle = await open(filename, 'wx', 0o600);
      const owner = {
        schema_version: SCENE_SCHEMA_VERSION,
        token,
        pid: process.pid,
        acquired_at: new Date().toISOString(),
      };
      await handle.writeFile(`${JSON.stringify(owner)}\n`);
      await handle.sync();
      await handle.close();
      handle = null;
      return async () => {
        try {
          const current = JSON.parse(await readFile(filename, 'utf8'));
          if (current.token === token) await unlink(filename);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error.code !== 'EEXIST') throw error;

      let stale = false;
      try {
        const owner = JSON.parse(await readFile(filename, 'utf8'));
        stale = !lockOwnerIsAlive(owner);
      } catch {
        try {
          const metadata = await stat(filename);
          stale = Date.now() - metadata.mtimeMs >= LOCK_MALFORMED_GRACE_MS;
        } catch (statError) {
          if (statError.code === 'ENOENT') continue;
          throw statError;
        }
      }
      if (stale) {
        await unlink(filename).catch((unlinkError) => {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        });
        continue;
      }
      if (Date.now() >= deadline) return null;
      await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  }
}

function resolveInside(directory, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const resolved = path.resolve(directory, relativePath);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    throw new Error(`${label} escapes the scene directory`);
  }
  return resolved;
}

async function verifiedRepairCandidate(directory, state, repairAttempt) {
  if (!repairAttempt) return null;
  const failIntegrity = (message) => {
    const error = new Error(message);
    error.code = 'BOUND_INPUT_INTEGRITY_FAILED';
    return error;
  };
  let filename;
  let bytes;
  try {
    filename = resolveInside(
      directory,
      repairAttempt.candidate.relative_path,
      'Repair scene candidate',
    );
    bytes = await readFile(filename);
  } catch {
    throw failIntegrity('The selected repair candidate is missing or outside the scene boundary');
  }
  if (sha256(bytes) !== repairAttempt.candidate.sha256) {
    throw failIntegrity('The selected repair candidate no longer matches its immutable SHA-256');
  }
  let metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw failIntegrity('The selected repair candidate is no longer a decodable image');
  }
  if (
    metadata.format !== 'png'
    || !metadata.width
    || !metadata.height
    || (metadata.pages ?? 1) !== 1
    || metadata.width !== state.delivery.width
    || metadata.height !== state.delivery.height
  ) {
    throw failIntegrity('The selected repair candidate no longer matches the immutable delivery geometry');
  }
  return {
    path: filename,
    sha256: repairAttempt.candidate.sha256,
    media_type: 'image/png',
    role: 'failed_candidate',
    attempt: repairAttempt.number,
  };
}

// This is deliberately a layout derivative, not an image repair.  It has no
// authority to add scene pixels: it rescales the already failed candidate onto
// a neutral opaque 4:5 canvas so the provider can see the measured target framing
// instead of trying to infer "76% of frame height" from prose alone.
async function mechanicalFramingGuide(directory, state, repairAttempt, repairCandidate) {
  if (!repairAttempt || !repairCandidate) return null;
  const defects = repairAttempt.qa?.gates
    ?.find((gate) => gate.id === 'FRAMING_AND_ANATOMY')
    ?.defects ?? [];
  const evidence = repairAttempt.qa?.framing_evidence;
  const bbox = evidence?.subject_bbox_xywh_px;
  const range = evidence?.expected_subject_height_percent;
  const measured = evidence?.subject_height_percent;
  const minimumAbove = evidence?.minimum_clear_space_above_hair_percent;
  if (
    !Array.isArray(defects)
    || !defects.includes('SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE')
    || !defects.includes('INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR')
    || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)
    || !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)
    || !Number.isFinite(measured) || !Number.isFinite(minimumAbove)
    || measured <= range[1] || range[0] <= 0 || range[0] > range[1]
  ) return null;

  const [sourceX, sourceY] = bbox;
  const targetSubjectHeight = (range[0] + range[1]) / 2;
  const scale = targetSubjectHeight / measured;
  const source = await sharp(repairCandidate.path).metadata();
  if (!source.width || !source.height || source.width !== state.delivery.width || source.height !== state.delivery.height) {
    return null;
  }
  const resizedWidth = Math.round(source.width * scale);
  const resizedHeight = Math.round(source.height * scale);
  if (resizedWidth < 1 || resizedHeight < 1 || resizedWidth > state.delivery.width || resizedHeight > state.delivery.height) {
    return null;
  }
  const targetTop = Math.round(((minimumAbove + 1) / 100) * state.delivery.height);
  const left = Math.round((state.delivery.width - resizedWidth) / 2);
  const top = Math.round(targetTop - (sourceY * scale));
  if (left < 0 || top < 0 || left + resizedWidth > state.delivery.width || top + resizedHeight > state.delivery.height) {
    return null;
  }
  const bytes = await sharp({
    create: {
      width: state.delivery.width,
      height: state.delivery.height,
      channels: 4,
      // Transparency is rendered as black by the provider's reference viewer, making
      // an otherwise correct 76% guide read like a dark vignette rather than a layout.
      // This deterministic neutral canvas exists only in conditioning and has no
      // authority over delivery pixels, palette or lighting.
      background: { r: 240, g: 238, b: 232, alpha: 1 },
    },
  })
    .composite([{
      input: await sharp(repairCandidate.path).resize({ width: resizedWidth, height: resizedHeight }).png().toBuffer(),
      left,
      top,
    }])
    .png()
    .toBuffer();
  const filename = path.join(
    directory,
    `attempts/${String(repairAttempt.number + 1).padStart(3, '0')}/mechanical-framing-guide.png`,
  );
  const expectedHash = sha256(bytes);
  try {
    const existing = await readFile(filename);
    if (sha256(existing) !== expectedHash) {
      throw new Error('Mechanical framing guide already exists with a different immutable SHA-256');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeImmutable(filename, bytes);
  }
  return {
    path: filename,
    sha256: expectedHash,
    media_type: 'image/png',
    role: 'mechanical_framing_guide',
    source_attempt: repairAttempt.number,
    target_subject_height_percent: targetSubjectHeight,
    target_clear_space_above_hair_percent: minimumAbove + 1,
  };
}

// The initial composed master is a deterministic layout derivative of the
// approved master, never a generated replacement. It gives the provider the
// exact approved pixels at the delivery safe-area before it sees any scene
// reference. A full-body master commonly fills its source frame; without this
// separate geometry authority the provider faithfully repeats that oversized
// composition in every new environment.
async function initialComposedMasterGuide(directory, state, attemptNumber, approvedLook, transportAspectRatio) {
  if (!approvedLook?.path || !approvedLook?.sha256 || !Number.isInteger(attemptNumber)) return null;
  const source = await sharp(approvedLook.path).metadata();
  if (!source.width || !source.height || (source.pages ?? 1) !== 1) return null;
  // Native 4:5 measured 76.4% at 0.775. GPT's 3:4 delivery loses 6.25%
  // vertically in its explicit centre crop, so it needs a smaller composition
  // reference to land in the same final 74–78% band.
  const scale = transportAspectRatio === '3:4' ? 0.725 : 0.775;
  const resizedWidth = Math.round(state.delivery.width * scale);
  const resizedHeight = Math.round(state.delivery.height * scale);
  const top = Math.round(state.delivery.height * 0.09);
  const left = Math.round((state.delivery.width - resizedWidth) / 2);
  const bytes = await sharp({
    create: {
      width: state.delivery.width,
      height: state.delivery.height,
      channels: 4,
      background: { r: 240, g: 238, b: 232, alpha: 1 },
    },
  })
    .composite([{
      input: await sharp(approvedLook.path)
        .resize({ width: resizedWidth, height: resizedHeight, fit: 'fill' })
        .png()
        .toBuffer(),
      left,
      top,
    }])
    .png()
    .toBuffer();
  const filename = path.join(
    directory,
    `attempts/${String(attemptNumber).padStart(3, '0')}/initial-composed-master-guide.png`,
  );
  const expectedHash = sha256(bytes);
  try {
    const existing = await readFile(filename);
    if (sha256(existing) !== expectedHash) throw new Error('Initial composed master guide has different immutable bytes');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeImmutable(filename, bytes);
  }
  return {
    path: filename,
    sha256: expectedHash,
    media_type: 'image/png',
    role: 'mechanical_framing_guide',
    source_kind: 'approved_look',
    target_subject_height_percent: 76,
    target_clear_space_above_hair_percent: 9,
  };
}

async function binaryFrom(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  if (value && typeof value === 'object' && typeof value.path === 'string') {
    return readFile(value.path);
  }
  if (value && typeof value === 'object' && typeof value.base64 === 'string') {
    return Buffer.from(value.base64, 'base64');
  }
  throw new Error(`${label} must be bytes, text, { path }, or { base64 }`);
}

async function receiptBytesFrom(value) {
  if (value && typeof value === 'object'
    && !Buffer.isBuffer(value)
    && !(value instanceof Uint8Array)
    && typeof value.path !== 'string'
    && typeof value.base64 !== 'string') {
    return canonicalJsonBytes(value);
  }
  return binaryFrom(value, 'Resolved approved look receipt');
}

async function jsonSnapshot(value, bytesValue, label) {
  const bytes = bytesValue === undefined
    ? canonicalJsonBytes(value)
    : await binaryFrom(bytesValue, `${label} bytes`);
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return { bytes, document, sha256: sha256(bytes) };
}

async function approvedItemSnapshot(value, expectedSourceRunId) {
  if (value === null || value === undefined) return null;
  let document;
  try {
    document = approvedItemEvidenceDocument(value);
  } catch {
    throw new Error('Resolved approved item evidence has an invalid logical contract');
  }
  if (!document
    || document.schema_version !== '1.0.0'
    || document.kind !== 'APPROVED_ITEM_EVIDENCE'
    || document.source_run_id !== expectedSourceRunId
    || document.reference_pack?.kind !== 'GARMENT'
    || document.reference_pack?.sha256 === undefined
    || !SHA256_PATTERN.test(document.reference_pack.sha256)
    || !Array.isArray(document.items)
    || document.items.length < 1
    || document.items.length > 5
    || !Array.isArray(value.items)
    || value.items.length !== document.items.length) {
    throw new Error('Resolved approved item evidence does not match the approved look source');
  }
  const seenIds = new Set();
  const seenIndexes = new Set();
  const items = [];
  for (const [index, logical] of document.items.entries()) {
    const source = value.items[index];
    const expectedRole = `GARMENT_${String(logical.category ?? '').toUpperCase()}`;
    if (logical.order !== index + 1
      || logical.role !== expectedRole
      || typeof logical.reference_set_id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(logical.reference_set_id)
      || seenIds.has(logical.reference_set_id)
      || !Array.isArray(logical.source_indexes)
      || logical.source_indexes.length < 1
      || logical.source_indexes.some((sourceIndex) => (
        !Number.isInteger(sourceIndex)
        || sourceIndex < 0
        || seenIndexes.has(sourceIndex)
      ))
      || !SHA256_PATTERN.test(logical.sha256 ?? '')
      || !SHA256_PATTERN.test(logical.facts_sha256 ?? '')
      || logical.media_type !== 'image/png'
      || !Buffer.isBuffer(source?.data)
      || source.data.length < 1
      || source.data.length > 64 * 1024 * 1024
      || sha256(source.data) !== logical.sha256
      || approvedItemFactsSha256(source) !== logical.facts_sha256) {
      throw new Error(`Resolved approved item evidence item ${index + 1} is invalid`);
    }
    seenIds.add(logical.reference_set_id);
    logical.source_indexes.forEach((sourceIndex) => seenIndexes.add(sourceIndex));
    let metadata;
    try {
      metadata = await sharp(source.data).metadata();
    } catch {
      throw new Error(`Resolved approved item evidence item ${index + 1} is not an image`);
    }
    if (metadata.format !== 'png'
      || !metadata.width
      || !metadata.height
      || (metadata.pages ?? 1) !== 1) {
      throw new Error(`Resolved approved item evidence item ${index + 1} must be one PNG`);
    }
    items.push({ logical, data: source.data });
  }
  const bytes = canonicalJsonBytes(document);
  assertNoLocalPathText(bytes.toString('utf8'), 'Resolved approved item evidence');
  return {
    document,
    bytes,
    sha256: sha256(bytes),
    items,
  };
}

function extensionFor(mediaType) {
  const extension = MIME_EXTENSION[mediaType];
  if (!extension) throw new Error(`Unsupported scene reference media type: ${mediaType}`);
  return extension;
}

function safeProviderMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const allowed = [
    'provider',
    'provider_request_id',
    'request_id',
    'job_id',
    'model',
    'model_version',
    'job_set_type',
    'quality',
    'seed',
    'geometry_strategy',
    'geometry_crop_fraction',
    'aspect_error_fraction',
    'transport_aspect_error_fraction',
    'transport_aspect_ratio',
    'source_width',
    'source_height',
    'source_aspect_ratio',
    'raw_output_sha256',
    'geometry_output_sha256',
    // The frame-finish step sits after geometry and before storage, so when it
    // runs the stored bytes are no longer the geometry output and the lineage
    // needs its own last link. Listed here because this allowlist silently drops
    // anything it does not name — a receipt field that is not on this list
    // simply vanishes, which has cost two paid rounds before.
    'delivered_output_sha256',
    'frame_finish_grain_applied',
    'frame_finish_grain_strength',
    'frame_finish_oversample_requested',
    'frame_finish_oversample_factor',
    'frame_finish_oversample_honoured',
    'reference_role_order',
    'reference_evidence_sha256',
    'attached_reference_count',
    'structured_reference_count',
    'shot_anchor_role_order',
    'dropped_attachment_roles',
    'dropped_attachment_count',
    'outbound_prompt_sha256',
    'repair_candidate_sha256',
    'repair_from_attempt',
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => ['string', 'number', 'boolean'].includes(typeof metadata[key]))
      .map((key) => [
        key,
        typeof metadata[key] === 'string'
          ? sanitizeOutboundString(metadata[key], { stripProjectName: false })
          : metadata[key],
      ]),
  );
}

function publicScene(state) {
  const currentAttempt = state.attempts.at(-1) ?? null;
  return sanitizeOutbound({
    scene_id: state.scene_id,
    status: state.status,
    phase: state.phase,
    message: state.message,
    created_at: state.created_at,
    updated_at: state.updated_at,
    approved_look: {
      look_id: state.bindings.approved_look.look_id,
      sha256: state.bindings.approved_look.image_sha256,
    },
    preset: {
      preset_id: state.bindings.preset.preset_id,
      version: state.bindings.preset.version,
      sha256: state.bindings.preset.sha256,
      reference_pack_id: state.bindings.reference_pack.reference_pack_id,
      reference_pack_version: state.bindings.reference_pack.version,
      reference_pack_sha256: state.bindings.reference_pack.sha256,
    },
    delivery: state.delivery,
    execution: {
      cycle: state.cycle,
      manual_retries: state.manual_retries,
      attempt: currentAttempt?.number ?? 0,
      cycle_attempt: currentAttempt?.cycle_attempt ?? 0,
      model: currentAttempt?.route ? {
        job_set_type: currentAttempt.route.job_set_type,
        name: currentAttempt.route.model,
        model_version: currentAttempt.route.model_version,
        quality: currentAttempt.route.quality,
      } : null,
      route_hash: state.model_route.sha256,
    },
    qa: state.qa ? {
      decision: state.qa.decision,
      gates: state.qa.gates,
      score: state.qa.score ?? null,
      summary: state.qa.summary ?? '',
      framing_evidence: state.qa.framing_evidence ?? null,
    } : null,
    output: state.output ? {
      image_url: `/api/scenes/${encodeURIComponent(state.scene_id)}/output`,
      sha256: state.output.sha256,
      width: state.output.width,
      height: state.output.height,
      media_type: state.output.media_type,
      manifest_sha256: state.output.manifest_sha256,
      evidence_manifest_sha256: state.output.evidence_manifest_sha256,
      qa_receipt_sha256: state.output.qa_receipt_sha256,
      privacy_report_sha256: state.output.privacy_report_sha256,
    } : null,
    error: state.error,
    cancellation: state.cancellation ?? null,
  });
}

function errorMessage(error) {
  if (error?.name === 'AbortError') return 'Operation cancelled';
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message.replaceAll(/(?:\/[^\s"'<>]+)+/g, '[private-path]').slice(0, 500)
    : 'Unknown scene operation error';
}

function sanitizeEvaluation(result) {
  return {
    ...result,
    gates: result.gates.map((gate) => ({
      ...gate,
      evidence: sanitizeOutboundString(gate.evidence),
      defects: gate.defects.map((defect) => sanitizeOutboundString(defect)),
    })),
    summary: sanitizeOutboundString(result.summary),
    reviewer: Object.fromEntries(
      Object.entries(result.reviewer).map(([key, value]) => [
        key,
        sanitizeOutboundString(value, { stripProjectName: false }),
      ]),
    ),
    item_fidelity_evidence: result.item_fidelity_evidence?.map((item) => ({
      ...item,
      evidence: sanitizeOutboundString(item.evidence),
      matching_features: item.matching_features.map((entry) => sanitizeOutboundString(entry)),
      defects: item.defects.map((entry) => sanitizeOutboundString(entry)),
    })) ?? null,
  };
}

function assertItemFidelityEvidenceMatches(items, evaluation) {
  const evidence = evaluation.item_fidelity_evidence;
  if (!Array.isArray(items) || items.length === 0) {
    if (evidence !== null) {
      throw new Error('Scene evaluator returned item evidence for a look without bound item references');
    }
    return;
  }
  if (!Array.isArray(evidence) || evidence.length !== items.length) {
    throw new Error('Scene evaluator did not return one forensic result for every bound item');
  }
  const requestIds = new Set();
  for (const [index, item] of items.entries()) {
    const result = evidence[index];
    if (result.item_id !== item.reference_set_id
      || result.item_sha256 !== item.sha256
      || result.item_category !== item.category
      || result.item_facts_sha256 !== item.facts_sha256
      || requestIds.has(result.request_id)) {
      throw new Error(`Scene evaluator item result ${index + 1} is not bound to its exact approved item`);
    }
    requestIds.add(result.request_id);
  }
  const itemGate = evaluation.gates.find((gate) => gate.id === 'ITEM_FIDELITY');
  const anyRejected = evidence.some((item) => item.verdict === 'REVISE');
  if ((anyRejected && itemGate?.decision !== 'FAIL')
    || (!anyRejected && itemGate?.decision === 'PASS'
      && evidence.some((item) => item.defects.length !== 0))) {
    throw new Error('Scene evaluator ITEM_FIDELITY gate contradicts its forensic item results');
  }
}

function assertNoLocalPathText(value, label) {
  const sanitized = sanitizeOutboundString(value, { stripProjectName: false });
  if (sanitized !== value) throw new Error(`${label} contains private local infrastructure`);
}

function privacyFindingsForText(value, artifactPath) {
  const findings = [];
  const rules = [
    {
      rule: 'NO_ABSOLUTE_USER_PATHS',
      pattern: /(?:\/(?:Users|home|tmp|private\/var|Volumes)\/[^\s"'<>]+|[A-Za-z]:\\[^\s"'<>]+)/,
      message: 'Release text contains an absolute local filesystem path.',
    },
    {
      rule: 'NO_PRIVATE_RUNTIME_PATHS',
      pattern: /(?:\.local\/share|runtime\/runs|\.zeely-run|artifacts\/sha256)/i,
      message: 'Release text contains a private runtime locator.',
    },
    {
      rule: 'NO_SECRET_VALUES',
      pattern: /(?:\bsk-[A-Za-z0-9_-]{12,}|\bAIza[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bBearer\s+[A-Za-z0-9._~+/-]{12,}|(?:api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,})/i,
      message: 'Release text contains a value shaped like a credential.',
    },
    {
      rule: 'NO_LOCAL_FILE_URIS',
      pattern: /\bfile:\/\/\S+/i,
      message: 'Release text contains a local file URI.',
    },
    {
      rule: 'PERSONAL_INPUT_POLICY',
      pattern: /(?:inputs\/approved-look|approved-look-receipt\.json|artifacts\/conditioning\/humans)/i,
      message: 'Release text exposes a private personal-input locator.',
    },
  ];
  const lines = String(value).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        findings.push({
          rule: rule.rule,
          path: artifactPath,
          line: index + 1,
          message: rule.message,
        });
      }
    }
  }
  return findings;
}

async function imageMetadataPrivacyFindings(bytes, artifactPath) {
  const metadata = await sharp(bytes).metadata();
  const embedded = ['exif', 'xmp', 'iptc', 'comments'].filter((field) => metadata[field]);
  return embedded.map((field) => ({
    rule: 'PERSONAL_INPUT_POLICY',
    path: artifactPath,
    line: null,
    message: `Released image retains disallowed ${field.toUpperCase()} metadata.`,
  }));
}

function createPreflightGates(lookHash, packHash, itemEvidenceHash = null) {
  return [
    {
      id: 'MASTER_LOOK_LOCK',
      decision: 'PASS',
      evidence: itemEvidenceHash
        ? `Approved look bytes, PASS receipt and exact item evidence ${itemEvidenceHash} are bound to SHA-256 ${lookHash}.`
        : `Approved look bytes and PASS receipt are bound to SHA-256 ${lookHash}.`,
      defects: [],
    },
    {
      id: 'REFERENCE_ROLE_ISOLATION',
      decision: 'PASS',
      evidence: `The immutable reference pack ${packHash} contains every required role and denies identity/body/hair/outfit authority.`,
      defects: [],
    },
  ];
}

function approvedItemsReceipt(binding) {
  if (!binding) return null;
  return {
    schema_version: binding.schema_version,
    kind: binding.kind,
    source_run_id: binding.source_run_id,
    reference_pack_sha256: binding.reference_pack_sha256,
    evidence_sha256: binding.evidence_sha256,
    items: binding.items.map((item) => ({
      order: item.order,
      role: item.role,
      category: item.category,
      reference_set_id: item.reference_set_id,
      sha256: item.sha256,
      facts_sha256: item.facts_sha256,
      media_type: item.media_type,
    })),
  };
}

function provenanceGate({
  state,
  attempt,
  outputHash,
  promptHash,
  rejectionRecord = null,
}) {
  const required = [
    state.bindings.approved_look.image_sha256,
    state.bindings.approved_look.receipt_sha256,
    state.bindings.preset.sha256,
    state.bindings.reference_pack.sha256,
    promptHash,
    attempt.route.model_version,
    outputHash,
    ...(state.bindings.approved_items
      ? [state.bindings.approved_items.evidence_sha256]
      : []),
  ];
  if (required.some((value) => typeof value !== 'string' || value.length === 0)) {
    return {
      id: 'PROVENANCE',
      decision: 'FAIL',
      evidence: 'The release receipt is missing an immutable provenance field.',
      defects: ['MISSING_PROVENANCE_FIELD'],
    };
  }
  const providerRequestId = attempt.provider_metadata.provider_request_id
    ?? attempt.provider_metadata.request_id
    ?? attempt.provider_metadata.job_id;
  if (typeof providerRequestId !== 'string' || providerRequestId.length === 0) {
    return {
      id: 'PROVENANCE',
      decision: 'FAIL',
      evidence: 'The provider did not return an immutable request or job receipt.',
      defects: ['MISSING_PROVIDER_REQUEST_RECEIPT'],
    };
  }
  const provider = attempt.provider_metadata;
  // The transport aspect is what the serving transport handed over, so the GPT
  // route has two truthful values: 3:4 from the Higgsfield CLI, which offered
  // nothing closer, and 4:5 from OpenRouter, which serves the delivery aspect
  // directly. Pinning it to 3:4 by model name would reject the better one.
  const expectedTransportAspectRatios = attempt.route.job_set_type === 'gpt_image_2'
    ? ['3:4']
    : ['4:5'];
  const geometryReceiptValid = typeof provider.provider === 'string'
    && provider.provider.length > 0
    && provider.model === attempt.route.model
    && provider.model_version === attempt.route.model_version
    && provider.job_set_type === attempt.route.job_set_type
    && provider.quality === attempt.route.quality
    && Number.isFinite(provider.source_width)
    && provider.source_width > 0
    && Number.isFinite(provider.source_height)
    && provider.source_height > 0
    && typeof provider.source_aspect_ratio === 'string'
    && provider.source_aspect_ratio.length > 0
    && expectedTransportAspectRatios.includes(provider.transport_aspect_ratio)
    && [
      'provider_exact_4_5',
      'provider_exact_4_5_rescaled',
      'provider_native_4_5_tolerance_rescaled',
      'centre_crop_to_exact_4_5',
      // Accepted for reading receipts written before blur padding was removed.
      'blurred_canvas_contain_no_subject_crop',
    ].includes(provider.geometry_strategy)
    && (provider.geometry_strategy !== 'centre_crop_to_exact_4_5'
      || (Number.isFinite(provider.geometry_crop_fraction) && provider.geometry_crop_fraction >= 0))
    && /^[a-f0-9]{64}$/.test(provider.raw_output_sha256 ?? '')
    // Lineage is a chain, not a single equality. Without the frame-finish step
    // the geometry output IS the stored frame and the two hashes coincide; with
    // it there is one more link, and the last one is what got stored. Asserting
    // the old single equality would have failed the gate on the pipeline's own
    // correct output — the same shape of defect as every other requirement in
    // this codebase that ended up enforced in two places that disagreed.
    && (provider.frame_finish_grain_applied === true
      ? /^[a-f0-9]{64}$/.test(provider.geometry_output_sha256 ?? '')
        && provider.delivered_output_sha256 === attempt.provider_source.sha256
      : provider.geometry_output_sha256 === attempt.provider_source.sha256);
  if (!geometryReceiptValid) {
    return {
      id: 'PROVENANCE',
      decision: 'FAIL',
      evidence: 'The provider geometry transform or raw-output lineage receipt is incomplete.',
      defects: ['MISSING_PROVIDER_GEOMETRY_LINEAGE'],
    };
  }
  const deterministicSourceAttemptNumber = attempt.normalization?.strategy === 'deterministic_bbox_crop'
    ? attempt.normalization.source_attempt
    : null;
  const deterministicSourceAttempt = Number.isInteger(deterministicSourceAttemptNumber)
    && deterministicSourceAttemptNumber < attempt.number
    ? state.attempts.find((item) => item.number === deterministicSourceAttemptNumber)
    : null;
  if (Number.isInteger(deterministicSourceAttemptNumber)
    && deterministicSourceAttemptNumber < attempt.number) {
    const localLineageValid = deterministicSourceAttempt
      && deterministicSourceAttempt.candidate
      && deterministicSourceAttempt.provider_source
      && deterministicSourceAttempt.compiled_prompt
      && attempt.normalization.source_candidate_sha256 === deterministicSourceAttempt.candidate.sha256
      && attempt.provider_source.sha256 === deterministicSourceAttempt.provider_source.sha256
      && attempt.compiled_prompt.sha256 === deterministicSourceAttempt.compiled_prompt.sha256
      && attempt.generation_idempotency_key === deterministicSourceAttempt.generation_idempotency_key
      && sha256(canonicalJsonBytes(attempt.route))
        === sha256(canonicalJsonBytes(deterministicSourceAttempt.route))
      && sha256(canonicalJsonBytes(attempt.provider_metadata))
        === sha256(canonicalJsonBytes(deterministicSourceAttempt.provider_metadata))
      && sha256(canonicalJsonBytes(attempt.normalization.trigger_framing_evidence))
        === sha256(canonicalJsonBytes(deterministicSourceAttempt.qa?.framing_evidence))
      && sha256(canonicalJsonBytes(attempt.normalization.trigger_reviewer))
        === sha256(canonicalJsonBytes(deterministicSourceAttempt.qa?.reviewer));
    if (!localLineageValid) {
      return {
        id: 'PROVENANCE',
        decision: 'FAIL',
        evidence: 'The deterministic framing repair is not bound to its exact failed source attempt.',
        defects: ['INVALID_DETERMINISTIC_FRAMING_LINEAGE'],
      };
    }
  }
  const providerGenerationAttempt = deterministicSourceAttempt ?? attempt;
  const rejectionReceipt = rejectionRecord?.receipt ?? null;
  const repairAttempt = rejectionReceipt
    ? null
    : selectRepairAttempt(state, providerGenerationAttempt);
  const repairReceiptValid = rejectionReceipt
    ? (
      provider.rejection_id === rejectionReceipt.rejection_id
      && provider.rejection_receipt_sha256 === rejectionRecord.receiptHash
      && provider.rejection_gate_id === rejectionReceipt.gate.id
      && provider.supersedes_output_sha256 === rejectionReceipt.rejected_release.output.sha256
      && provider.repair_candidate_sha256 === rejectionReceipt.repair_source.sha256
      && provider.repair_from_attempt === rejectionReceipt.repair_source.source_attempt
    )
    : repairAttempt
      ? (
        provider.repair_candidate_sha256 === repairAttempt.candidate.sha256
        && provider.repair_from_attempt === repairAttempt.number
      )
      : (
        provider.repair_candidate_sha256 === undefined
        && provider.repair_from_attempt === undefined
        && provider.rejection_id === undefined
        && provider.rejection_receipt_sha256 === undefined
        && provider.rejection_gate_id === undefined
        && provider.supersedes_output_sha256 === undefined
      );
  if (!repairReceiptValid) {
    return {
      id: 'PROVENANCE',
      decision: 'FAIL',
      evidence: rejectionReceipt
        ? 'The scene repair attachment is not bound to the immutable post-release rejection receipt.'
        : 'The scene repair attachment is not bound to the selected prior QA candidate.',
      defects: ['INVALID_REPAIR_CANDIDATE_LINEAGE'],
    };
  }
  if (!attempt.qa?.reviewer?.id
    || !attempt.qa?.reviewer?.version
    || !attempt.qa?.reviewer?.request_id
    || !attempt.qa?.framing_evidence
    || !attempt.normalization) {
    return {
      id: 'PROVENANCE',
      decision: 'FAIL',
      evidence: 'The evaluator or normalization receipt is incomplete.',
      defects: ['MISSING_QA_OR_NORMALIZATION_RECEIPT'],
    };
  }
  return {
    id: 'PROVENANCE',
    decision: 'PASS',
    evidence: rejectionReceipt
      ? `Output, exact prompt, approved look, rejection receipt ${rejectionReceipt.rejection_id}, rejected source, preset, reference pack, source ledger and model route are hash-bound for attempt ${attempt.number}.`
      : `Output, exact prompt, approved look, receipt, preset, reference pack, source ledger and model route are hash-bound for attempt ${attempt.number}.`,
    defects: [],
  };
}

function receiptBinding(receipt, resolved, reference, imageHash) {
  if (receipt.receipt_type === 'APPROVED_LOOK') {
    if (receipt.schema_version !== SCENE_SCHEMA_VERSION
      || receipt.look_id !== reference.look_id
      || receipt.decision !== 'PASS'
      || receipt.output?.sha256 !== imageHash
      || receipt.qa?.identity !== 'PASS'
      || receipt.qa?.item_fidelity !== 'PASS') {
      throw new Error('Approved look receipt is not a PASS receipt bound to the requested look bytes');
    }
    return { format: 'APPROVED_LOOK', source_run_id: null };
  }

  const sourceRunId = resolved.source_run_id ?? resolved.sourceRunId;
  if (typeof sourceRunId !== 'string') {
    throw new Error('Legacy run receipt resolution must include source_run_id');
  }
  assertSafeSceneId(sourceRunId, 'resolved approved look source_run_id');
  if (receipt.job_id !== `web-${sourceRunId}`
    || receipt.state !== 'COMPLETED'
    || receipt.outputs?.avatar_outfit?.sha256 !== imageHash
    || receipt.qa?.avatar?.decision !== 'PASS'
    || receipt.qa?.outfit?.decision !== 'PASS') {
    throw new Error('Run manifest is not a completed PASS receipt bound to the requested approved look');
  }
  return { format: 'RUN_MANIFEST', source_run_id: sourceRunId };
}

function validatePostReleaseRejectionReceipt(receipt, expectedSceneId) {
  assertExactObjectKeys(receipt, [
    'schema_version',
    'receipt_type',
    'rejection_id',
    'sequence',
    'scene_id',
    'idempotency_hash',
    'request_fingerprint',
    'decision',
    'gate',
    'reviewer',
    'rejected_release',
    'repair_source',
    'quarantine_relative_path',
    'rejected_at',
  ], 'Post-release rejection receipt');
  if (receipt.schema_version !== SCENE_SCHEMA_VERSION
    || receipt.receipt_type !== POST_RELEASE_REJECTION_TYPE
    || receipt.scene_id !== expectedSceneId
    || receipt.decision !== 'REJECTED'
    || !Number.isInteger(receipt.sequence)
    || receipt.sequence < 1
    || Number.isNaN(Date.parse(receipt.rejected_at))) {
    throw new Error('Post-release rejection receipt identity is invalid');
  }
  assertSafeSceneId(receipt.rejection_id, 'rejection_id');
  assertHash(receipt.idempotency_hash, 'rejection receipt idempotency_hash');
  assertHash(receipt.request_fingerprint, 'rejection receipt request_fingerprint');
  assertExactObjectKeys(receipt.gate, ['id', 'evidence', 'defects'], 'Rejection gate');
  const normalized = normalizePostReleaseRejectionRequest({
    expectedOutputSha256: receipt.rejected_release?.output?.sha256,
    gateId: receipt.gate.id,
    evidence: receipt.gate.evidence,
    defects: receipt.gate.defects,
    reviewer: receipt.reviewer,
  });
  if (sha256(canonicalJsonBytes(normalized)) !== receipt.request_fingerprint) {
    throw new Error('Post-release rejection request fingerprint is invalid');
  }

  assertExactObjectKeys(receipt.rejected_release, [
    'attempt',
    'cycle',
    'approved_at',
    'output',
  ], 'Rejected release');
  if (!Number.isInteger(receipt.rejected_release.attempt)
    || receipt.rejected_release.attempt < 1
    || !Number.isInteger(receipt.rejected_release.cycle)
    || receipt.rejected_release.cycle < 1
    || Number.isNaN(Date.parse(receipt.rejected_release.approved_at))) {
    throw new Error('Rejected release lineage is invalid');
  }
  const output = receipt.rejected_release.output;
  assertExactObjectKeys(output, [
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
  ], 'Rejected release output');
  for (const key of [
    'sha256',
    'manifest_sha256',
    'evidence_manifest_sha256',
    'qa_receipt_sha256',
    'privacy_report_sha256',
  ]) {
    assertHash(output[key], `rejected release output ${key}`);
  }
  if (output.relative_path !== 'outputs/scene.png'
    || output.manifest_relative_path !== 'outputs/scene-manifest.json'
    || output.evidence_manifest_relative_path !== 'outputs/scene-evidence-manifest.json'
    || output.qa_receipt_relative_path !== 'outputs/scene-qa-receipt.json'
    || output.privacy_report_relative_path !== 'outputs/scene-privacy-report.json'
    || !Number.isInteger(output.size)
    || output.size < 1
    || output.media_type !== 'image/png'
    || output.width !== 1024
    || output.height !== 1280) {
    throw new Error('Rejected release output receipt is invalid');
  }

  assertExactObjectKeys(receipt.repair_source, [
    'relative_path',
    'sha256',
    'media_type',
    'width',
    'height',
    'source_attempt',
  ], 'Rejection repair source');
  assertHash(receipt.repair_source.sha256, 'rejection repair source sha256');
  if (receipt.repair_source.sha256 !== output.sha256
    || receipt.repair_source.media_type !== 'image/png'
    || receipt.repair_source.width !== 1024
    || receipt.repair_source.height !== 1280
    || receipt.repair_source.source_attempt !== receipt.rejected_release.attempt
    || receipt.repair_source.relative_path
      !== `${receipt.quarantine_relative_path}/outputs/scene.png`) {
    throw new Error('Rejection repair source is not bound to the rejected output');
  }
  if (receipt.quarantine_relative_path
    !== `quarantine/rejections/${receipt.rejection_id}`) {
    throw new Error('Rejection quarantine path is invalid');
  }
  return receipt;
}

function validatePostReleaseRejectionLedgerEntry(entry, {
  expectedSceneId,
  expectedSequence,
  expectedPreviousHash,
  receipt,
  receiptHash,
}) {
  assertExactObjectKeys(entry, [
    'schema_version',
    'ledger_type',
    'sequence',
    'scene_id',
    'rejection_id',
    'receipt_relative_path',
    'receipt_sha256',
    'idempotency_hash',
    'request_fingerprint',
    'rejected_output_sha256',
    'previous_entry_sha256',
    'created_at',
  ], 'Post-release rejection ledger entry');
  if (entry.schema_version !== SCENE_SCHEMA_VERSION
    || entry.ledger_type !== POST_RELEASE_REJECTION_LEDGER_TYPE
    || entry.scene_id !== expectedSceneId
    || entry.sequence !== expectedSequence
    || entry.sequence !== receipt.sequence
    || entry.rejection_id !== receipt.rejection_id
    || entry.receipt_relative_path !== `rejections/receipts/${receipt.rejection_id}.json`
    || entry.receipt_sha256 !== receiptHash
    || entry.idempotency_hash !== receipt.idempotency_hash
    || entry.request_fingerprint !== receipt.request_fingerprint
    || entry.rejected_output_sha256 !== receipt.rejected_release.output.sha256
    || entry.previous_entry_sha256 !== expectedPreviousHash
    || Number.isNaN(Date.parse(entry.created_at))) {
    throw new Error('Post-release rejection ledger entry is invalid');
  }
  return entry;
}

function postReleaseRepairAttempt(receipt, sourceAttempt) {
  if (!sourceAttempt
    || sourceAttempt.number !== receipt.rejected_release.attempt
    || sourceAttempt.status !== 'QA_PASS'
    || sourceAttempt.candidate?.sha256 !== receipt.repair_source.sha256
    || !Array.isArray(sourceAttempt.qa?.gates)) {
    throw new Error('Rejected release is not bound to its original QA_PASS attempt');
  }
  return {
    ...sourceAttempt,
    status: 'QA_FAILED',
    candidate: {
      ...sourceAttempt.candidate,
      relative_path: receipt.repair_source.relative_path,
      sha256: receipt.repair_source.sha256,
    },
    qa: {
      ...sourceAttempt.qa,
      decision: 'FAIL',
      gates: sourceAttempt.qa.gates.map((gate) => gate.id === receipt.gate.id
        ? {
          id: gate.id,
          decision: 'FAIL',
          evidence: receipt.gate.evidence,
          defects: receipt.gate.defects,
        }
        : gate),
      summary: `Post-release rejection: ${receipt.gate.id}`,
    },
  };
}

function failedGateCount(attempt) {
  return attempt.qa?.gates?.filter((gate) => gate.decision === 'FAIL').length
    ?? Number.POSITIVE_INFINITY;
}

function framingRepairDistance(attempt) {
  const failed = attempt.qa?.gates?.some(
    (gate) => gate.id === 'FRAMING_AND_ANATOMY' && gate.decision === 'FAIL',
  );
  if (!failed) return 0;
  const framing = attempt.qa?.framing_evidence;
  if (!framing
    || !Number.isFinite(framing.subject_height_percent)
    || !Array.isArray(framing.expected_subject_height_percent)
    || framing.expected_subject_height_percent.length !== 2
    || framing.full_head_visible !== true
    || framing.full_footwear_visible !== true) {
    return Number.POSITIVE_INFINITY;
  }
  const [minimum, maximum] = framing.expected_subject_height_percent;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
    return Number.POSITIVE_INFINITY;
  }
  if (framing.subject_height_percent < minimum) {
    return minimum - framing.subject_height_percent;
  }
  if (framing.subject_height_percent > maximum) {
    return framing.subject_height_percent - maximum;
  }
  return 0;
}

function selectRepairAttempt(state, attempt) {
  return state.attempts
    .filter((item) => (
      item.number < attempt.number
      && item.status === 'QA_FAILED'
      && item.candidate
      && Array.isArray(item.qa?.gates)
    ))
    .sort((left, right) => (
      failedGateCount(left) - failedGateCount(right)
      || framingRepairDistance(left) - framingRepairDistance(right)
      || (right.qa.score ?? Number.NEGATIVE_INFINITY) - (left.qa.score ?? Number.NEGATIVE_INFINITY)
      || right.number - left.number
    ))[0] ?? null;
}

function compiledPrompt({
  basePrompt,
  state,
  attempt,
  preset = null,
  approvedItems = [],
  repairAttempt = selectRepairAttempt(state, attempt),
}) {
  const camera = preset?.camera ?? null;
  const editorial = preset?.editorial ?? null;
  const requireFullHead = camera?.required_visibility?.full_head ?? true;
  const requireFullFootwear = camera?.required_visibility?.full_footwear ?? true;
  const framingIntent = camera?.framing ?? 'full_body';
  const itemScope = editorial?.item_scope ?? 'ALL';
  const detailItemId = itemScope === 'FIRST_ORDERED_ITEM'
    ? approvedItems[0]?.reference_set_id
    : null;
  const defects = repairAttempt
    ? repairAttempt.qa.gates
      .filter((gate) => gate.decision === 'FAIL')
      .flatMap((gate) => gate.defects.length ? gate.defects : [gate.id])
    : [];
  const passedGates = repairAttempt
    ? repairAttempt.qa.gates
      .filter((gate) => gate.decision === 'PASS')
      .map((gate) => gate.id)
    : [];
  const failedGates = repairAttempt
    ? repairAttempt.qa.gates
      .filter((gate) => gate.decision === 'FAIL')
      .map((gate) => gate.id)
    : [];
  const itemFidelityFailed = failedGates.includes('ITEM_FIDELITY');
  const framingFailed = repairAttempt?.qa.gates.some(
    (gate) => gate.id === 'FRAMING_AND_ANATOMY' && gate.decision === 'FAIL',
  ) ?? false;
  const measuredSubjectHeight = repairAttempt?.qa.framing_evidence?.subject_height_percent;
  const expectedSubjectRange = repairAttempt?.qa.framing_evidence?.expected_subject_height_percent;
  const expectedMinimum = Array.isArray(expectedSubjectRange) && Number.isFinite(expectedSubjectRange[0])
    ? expectedSubjectRange[0]
    : 74;
  const expectedMaximum = Array.isArray(expectedSubjectRange) && Number.isFinite(expectedSubjectRange[1])
    ? expectedSubjectRange[1]
    : 78;
  const targetSubjectHeight = (expectedMinimum + expectedMaximum) / 2;
  const scaleHint = Number.isFinite(measuredSubjectHeight) && measuredSubjectHeight > 0
    ? (targetSubjectHeight / measuredSubjectHeight).toFixed(3)
    : null;
  const subjectTooLarge = Number.isFinite(measuredSubjectHeight)
    && measuredSubjectHeight > expectedMaximum;
  const subjectTooSmall = Number.isFinite(measuredSubjectHeight)
    && measuredSubjectHeight < expectedMinimum;
  // Keyed on the defect the assessment actually recorded, never on the preset's declared
  // minimum: an editorial slot whose headroom is waived measures under its own minimum and
  // is still a PASS on that axis, so reading the minimum would order a model to "fix"
  // clearance the art direction spent on purpose.
  const framingLockEvidence = repairAttempt?.qa.framing_evidence ?? null;
  const headroomDefect = (repairAttempt?.qa.gates ?? [])
    .find((gate) => gate.id === 'FRAMING_AND_ANATOMY')
    ?.defects
    ?.includes('INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR') === true;
  const measuredAboveHair = framingLockEvidence?.clear_space_above_hair_percent;
  const measuredBelowFootwear = framingLockEvidence?.clear_space_below_footwear_percent;
  const minimumAboveHair = framingLockEvidence?.minimum_clear_space_above_hair_percent;
  const minimumBelowFootwear = framingLockEvidence?.minimum_clear_space_below_footwear_percent;
  const headroomShort = headroomDefect
    && [measuredAboveHair, measuredBelowFootwear, minimumAboveHair, minimumBelowFootwear]
      .every(Number.isFinite);
  const subjectInBand = Number.isFinite(measuredSubjectHeight)
    && !subjectTooLarge
    && !subjectTooSmall;
  // One point over the lock rather than the lock itself. A crop can close a residual
  // subject-height gap for free, but only while above_px/subject_px stays over
  // minimum/maximum, and a frame asked for exactly 8% has no room for the model's own
  // error: the three attempts on scene_1cd6953f landed 0.89, 1.20 and 1.36 points under it.
  const targetAboveHair = headroomShort ? minimumAboveHair + 1 : null;
  // The height the composition is built around, not the mid-band ideal. A subject already
  // inside the band keeps what it measured: mid-band handed the six live in-band attempts a
  // 1.001 scale factor whose only effect was to grow the person and take part of the growth
  // out of the clearance that was their sole defect (white_window_honeycomb ran
  // 75.9375%/5.7031% -> 76.4844%/5.4688% -> 76.4844%/5.3906%).
  const composedSubjectHeight = subjectInBand ? measuredSubjectHeight : targetSubjectHeight;
  const targetBelowFootwear = headroomShort
    ? Number((100 - targetAboveHair - composedSubjectHeight).toFixed(4))
    : null;
  const targetCompositionFits = headroomShort && targetBelowFootwear >= minimumBelowFootwear;
  const surplusFloorPaysForHeadroom = targetCompositionFits
    && measuredBelowFootwear > targetBelowFootwear;
  const headroomDeficit = headroomShort
    ? Number((minimumAboveHair - measuredAboveHair).toFixed(4))
    : null;
  // Measured against the floor's own minimum, because that is the part of it the frame is
  // free to give away. Naming it is the difference between an instruction the model can
  // execute and the bare defect code the six exhausted attempts were sent.
  const unspentFloor = headroomShort
    ? Number((measuredBelowFootwear - minimumBelowFootwear).toFixed(4))
    : null;
  return [
    basePrompt.trim(),
    '',
    'PRODUCTION INPUT AUTHORITY',
    '- ATTACHMENT_1 is the immutable approved look and is the only authority for identity, body, hair, outfit, product details, logos and readable garment text.',
    ...(repairAttempt ? [
      `- ATTACHMENT_2 is the hash-bound failed scene candidate from attempt ${repairAttempt.number}. Edit this exact scene; it is not authority for identity or item details.`,
    ] : []),
    '- Environment, lighting, composition, palette and negative references are role-limited exactly as declared by the attached reference pack.',
    '- Never copy a person, identity, garment, brand, text, landmark or exact architecture from a scene reference.',
    '',
    'DELIVERY LOCK',
    `- Output exactly one ${state.delivery.width}x${state.delivery.height} sRGB image at 4:5.`,
    ...(editorial ? [
      `- Execute the immutable editorial slot ${editorial.shot_slot} with ${framingIntent} framing.`,
      `- Complete head visibility is ${requireFullHead ? 'required' : 'not required by this intentional crop'}; complete footwear visibility is ${requireFullFootwear ? 'required' : 'not required by this intentional crop'}.`,
      '- Preserve exact identity, anatomy and every visible approved item detail inside the intentional crop. No wide-angle distortion or anatomy defects.',
    ] : [
      '- Preserve the complete head, hair and footwear. No wide-angle distortion or anatomy defects.',
    ]),
    ...(itemScope === 'FIRST_ORDERED_ITEM' ? [
      `- Make the first ordered approved item${detailItemId ? ` (${detailItemId})` : ''} the exact forensic subject of this intentional detail crop. Other approved items may remain outside frame; never invent their appearance.`,
    ] : itemScope === 'EXCLUDE_FOOTWEAR' ? [
      '- Include every approved item expected in the three-quarter crop. Footwear may remain intentionally outside frame; do not replace it or fabricate a partial substitute.',
    ] : [
      '- Include every approved item.',
    ]),
    '- Add no wardrobe, accessory, text, logo or prop not authorized by the approved look or preset.',
    ...(repairAttempt ? [
      '',
      'REPAIR MODE — EDIT THE HASH-BOUND FAILED SCENE',
      '- Make the smallest local edit required to pass QA. Do not regenerate or redesign scene content that already passed.',
      `- Preserve these passed gates exactly: ${passedGates.join(', ') || 'none recorded'}.`,
      `- Repair only these failed gates: ${failedGates.join(', ') || 'none recorded'}.`,
      ...(itemFidelityFailed ? [
        'PRODUCT VISIBILITY LOCK',
        '- Do not cover the jeans waistband, closure, belt loops, front pockets or rivets with hands, hoodie or props.',
        '- Keep the approved jeans as a clean straight-leg silhouette with its washed-charcoal fade and contrast stitching visibly readable.',
        '- Keep both shoes large enough to inspect their side overlays, sole units and color accents; never turn an exact multi-color shoe into a generic all-black sneaker.',
        '- This is a composition and visibility repair only. Do not alter identity, item construction, color, logos or scene authority.',
      ] : []),
      ...(framingFailed ? [
        ...(subjectTooLarge ? [
          '- Outpaint the existing scene and pull the camera back while keeping the same person, pose, outfit, products, environment, light and camera character.',
        ] : []),
        // Reached on the recorded clearance defect by itself, whatever the height verdict
        // says. Gating this on `subjectTooSmall && headroomShort` is why it never fired on
        // the failure it was written for: all six live standard attempts (two presets, three
        // each) measured a subject inside the band and were exhausted on
        // INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR alone, so the only framing line they ever got
        // was "preserve the current subject scale" and the numbers stayed in the receipt.
        ...(headroomShort ? [
          `- Head clearance is the recorded defect: ${measuredAboveHair}% above the hair against a ${minimumAboveHair}% minimum, ${headroomDeficit} points missing. The floor under the footwear measures ${measuredBelowFootwear}% against a ${minimumBelowFootwear}% minimum, so ${unspentFloor} points of it are unspent${unspentFloor >= headroomDeficit ? ' and cover the whole shortfall' : ', which is less than the shortfall'}.`,
          ...(subjectTooSmall ? [
            // Enlarging about the subject's own centre is what produced 7.1094 -> 6.7969 ->
            // 6.6406% of head clearance across three paid attempts of scene_1cd6953f while the
            // person grew 0.86 points in total: the extra height comes half out of the
            // clearance that is already short, so each attempt left the frame further outside
            // what any crop can repair. The subject has to move down the frame, not just grow.
            '- The person is also too small, so do not enlarge it about its own centre — half of any height you add comes straight out of the clear space above the hair you are already missing.',
          ] : []),
          ...(surplusFloorPaysForHeadroom ? [
            `- Raise the ground line and lower the whole locked person-and-look group in frame: the floor below the footwear is ${measuredBelowFootwear}% and only ${targetBelowFootwear}% is needed, so spend that surplus on head clearance${subjectTooSmall ? ' before scaling the group up' : subjectInBand ? ' without rescaling the group' : ''}.`,
          ] : [
            `- Lower the whole locked person-and-look group in frame so clear space opens above the hair${subjectTooSmall ? ', then scale the group up' : subjectInBand ? ', without rescaling the group' : ''}.`,
          ]),
          ...(targetCompositionFits ? [
            `- Compose to about ${targetAboveHair}% empty above the hair, ${composedSubjectHeight}% person and ${targetBelowFootwear}% below the footwear, keeping the same person, pose, outfit, products, environment, light and camera character.`,
          ] : []),
        ] : []),
        // Never beside the block above: "scale up around the same optical center" is the
        // instruction whose clearance cost that block exists to state.
        ...(subjectTooSmall && !headroomShort ? [
          '- The person is too small. Move the existing camera framing closer or scale the complete locked person-and-look group up around the same optical center. Do not pull the camera back and do not redesign the scene.',
        ] : []),
        ...(!subjectTooLarge && !subjectTooSmall ? [
          '- Preserve the current subject scale; repair only the named head, footwear, margin or anatomy defect with the smallest local edit.',
        ] : []),
        subjectInBand
          ? `- Hold visible person height at the measured ${measuredSubjectHeight}%, already inside the required ${expectedMinimum}–${expectedMaximum}% range${requireFullHead ? ', while keeping the complete head and headwear visible' : ''}${requireFullFootwear ? ' and keeping complete footwear visible' : ''}.`
          : `- Target visible person height around ${targetSubjectHeight}% inside the required ${expectedMinimum}–${expectedMaximum}% range${requireFullHead ? ' while keeping the complete head and headwear visible' : ''}${requireFullFootwear ? ' and keeping complete footwear visible' : ''}.`,
        // No scale factor for a subject already in band: 76/75.9375 = 1.001 carries no
        // correction and still reads as an order to grow, which is the move the live
        // attempts spent their remaining clearance on.
        ...(scaleHint && !subjectInBand ? [
          `- The measured person height was ${measuredSubjectHeight}%. Scale the complete locked person-and-look group to approximately ${scaleHint} of its current rendered size.${subjectTooLarge ? ' Restore the surrounding scene by outpainting.' : ' Preserve the existing scene boundaries and fill only incidental edit seams.'}`,
        ] : []),
      ] : []),
      ...(defects.length ? [
        '',
        'REPAIR ONLY THESE PREVIOUS SCENE DEFECTS',
        ...defects.map((item) => `- ${String(item).slice(0, 200)}`),
      ] : []),
    ] : []),
  ].join('\n');
}

// Which of deterministicFramingCropPlan's `return null`s actually returned. Only the guards
// whose test is a literal re-read of the same evidence are re-read here, in the plan's own
// order and with none of this file's own arithmetic: the plan's 5px crop-height quantisation
// and its top window are exactly what a copy here would drift from, and a drifted copy is
// what this replaced. The message below used to open with a crop-height window for every
// refusal, so the six live in-band attempts were each told an 8% head clearance capped a
// 1247px crop the plan never computed, on a branch it never reached, and a frame that cut
// the head off was told a crop "satisfies both locks". Two reviews chased that branch.
//
// THE HALF THAT IS NOT HERE. This file may not edit scene-contract.js, where the plan still
// answers with a bare null, so its last three guards cannot be attributed. The change that
// closes it, in that file:
//   export function deterministicFramingCropDecision(framing, delivery)
//     -> { plan: {...}, refusal: null } | { plan: null, refusal: { code, detail } }
//   export function deterministicFramingCropPlan(framing, delivery) {
//     return deterministicFramingCropDecision(framing, delivery).plan;
//   }
// with one code per `return null` in the order they appear there: FRAMING_EVIDENCE_INCOMPLETE,
// SUBJECT_GEOMETRY_UNMEASURABLE, SUBJECT_ALREADY_INSIDE_BAND, CROP_HEIGHT_WINDOW_EMPTY
// (detail: cropHeight, minimumCropHeight, maximumCropHeight, cropWidth), VERTICAL_WINDOW_EMPTY
// (detail: cropHeight, minimumTop, maximumTop) and CROP_EXCLUDES_SUBJECT (detail: left, top,
// width, height). Then #evaluate holds the decision it already computes and passes
// `decision.refusal` as a third argument here, this function prints that code and detail, and
// both framingCropRefusalGuard and the UNREPORTED_CROP_GEOMETRY_BRANCH arm below go away.
function framingCropRefusalGuard(framing) {
  if (!framing
    || framing.full_head_visible !== true
    || framing.full_footwear_visible !== true
    || !Array.isArray(framing.subject_bbox_xywh_px)
    || framing.subject_bbox_xywh_px.length !== 4
    || !Array.isArray(framing.expected_subject_height_percent)
    || framing.expected_subject_height_percent.length !== 2) {
    return 'FRAMING_EVIDENCE_INCOMPLETE';
  }
  const [boxX, boxY, boxWidth, boxHeight] = framing.subject_bbox_xywh_px;
  const [minimumPercent, maximumPercent] = framing.expected_subject_height_percent;
  if (![boxX, boxY, boxWidth, boxHeight, minimumPercent, maximumPercent].every(Number.isFinite)
    || boxWidth <= 0
    || boxHeight <= 0
    || minimumPercent <= 0
    || maximumPercent < minimumPercent) {
    return 'SUBJECT_GEOMETRY_UNMEASURABLE';
  }
  // Spelled as the plan spells it, so an absent height stays undefined and falls through
  // rather than being reported as a subject inside the band.
  if (framing.subject_height_percent >= minimumPercent) return 'SUBJECT_ALREADY_INSIDE_BAND';
  return 'UNREPORTED_CROP_GEOMETRY_BRANCH';
}

function deterministicFramingCropRefusal(framing, delivery) {
  const guard = framingCropRefusalGuard(framing);
  if (guard === 'FRAMING_EVIDENCE_INCOMPLETE') {
    return 'deterministic framing crop not attempted: FRAMING_EVIDENCE_INCOMPLETE — the plan '
      + 'needs a complete head, complete footwear, a four-number subject box and a two-number '
      + `band; this frame recorded full_head_visible=${framing?.full_head_visible === true}, `
      + `full_footwear_visible=${framing?.full_footwear_visible === true}. No crop restores a `
      + 'subject the frame cut off';
  }
  if (guard === 'SUBJECT_GEOMETRY_UNMEASURABLE') {
    return 'deterministic framing crop not attempted: SUBJECT_GEOMETRY_UNMEASURABLE — the '
      + 'recorded subject box and preset band are not both finite, positive and ordered, so the '
      + 'plan returned before computing anything';
  }
  const [minimumPercent, maximumPercent] = framing.expected_subject_height_percent;
  if (guard === 'SUBJECT_ALREADY_INSIDE_BAND') {
    return 'deterministic framing crop not attempted: SUBJECT_ALREADY_INSIDE_BAND — the subject '
      + `measures ${framing.subject_height_percent}%, at or above the ${minimumPercent}% band `
      + 'minimum, so the plan returns before computing any crop: it reframes an undersized '
      + 'subject only, and a crop removes rows, so it can only push that percentage higher and '
      + `can never add rows above the ${framing.clear_space_above_hair_percent}% of clear space `
      + 'this frame has. Only a new generation repairs this one';
  }
  // A crop only ever removes rows, so the pixels above the hair can never grow while the
  // subject keeps every row it has — above_px/subject_px is the one framing quantity a crop
  // cannot move upward, and the band and the headroom lock together demand it be at least
  // minimum_above/maximum_subject. All three route attempts of scene_1cd6953f were refused on
  // exactly that (0.0975, 0.0926, 0.0900 against 8/78 = 0.1026) and recorded nothing about it,
  // so a failure whose cause is fixed geometry read as "the repair never ran" and had to be
  // recovered from the pixels by hand. The bound is stated as a bound, computed here from the
  // same pixels, and never as the plan's reason: the plan does not say which of its windows
  // was empty, and the whole point of this rewrite is to stop answering that question for it.
  const [, aboveHairPx, , subjectPx] = framing.subject_bbox_xywh_px;
  const aboveMinimumPercent = framing.minimum_clear_space_above_hair_percent;
  const opening = 'deterministic framing crop refused inside the crop-geometry search: '
    + `UNREPORTED_CROP_GEOMETRY_BRANCH — ${subjectPx}px of subject under ${aboveHairPx}px of `
    + 'clear space, and the plan names no branch. Bounded independently from the same pixels: ';
  const tightest = Math.ceil(subjectPx / (maximumPercent / 100));
  const widest = Math.min(delivery.height, Math.floor(subjectPx / (minimumPercent / 100)));
  if (tightest > widest) {
    return `${opening}no crop of a ${delivery.width}x${delivery.height} delivery lands the `
      + `subject inside ${minimumPercent}-${maximumPercent}%`;
  }
  if (!Number.isFinite(aboveMinimumPercent) || aboveMinimumPercent <= 0) {
    return `${opening}${minimumPercent}-${maximumPercent}% admits a ${tightest}-${widest}px crop `
      + 'height and this frame declares no head-clearance minimum to test it against';
  }
  const headroomCap = Math.floor(aboveHairPx / (aboveMinimumPercent / 100));
  if (tightest > headroomCap) {
    return `${opening}${minimumPercent}-${maximumPercent}% needs a ${tightest}-${widest}px crop `
      + `height and the ${aboveMinimumPercent}% head clearance caps it at ${headroomCap}px, so no `
      + 'crop of these pixels satisfies both locks';
  }
  return `${opening}a ${tightest}-${Math.min(widest, headroomCap)}px crop height satisfies both `
    + 'locks, so the empty window is one the plan quantises or contains for itself';
}

function selectDeterministicFramingRepair(state) {
  const consumedSourceAttempts = new Set(
    state.attempts
      .filter((attempt) => (
        attempt.normalization?.strategy === 'deterministic_bbox_crop'
        && Number.isInteger(attempt.normalization.source_attempt)
        && attempt.normalization.source_attempt < attempt.number
      ))
      .map((attempt) => attempt.normalization.source_attempt),
  );
  return state.attempts
    .filter((attempt) => (
      attempt.status === 'QA_FAILED'
      && attempt.candidate
      && !consumedSourceAttempts.has(attempt.number)
      && attempt.normalization?.strategy !== 'deterministic_bbox_crop'
      && Array.isArray(attempt.qa?.gates)
      && attempt.qa.gates.filter((gate) => gate.decision === 'FAIL').length === 1
      && attempt.qa.gates.some(
        (gate) => gate.id === 'FRAMING_AND_ANATOMY' && gate.decision === 'FAIL',
      )
      && deterministicFramingCropPlan(attempt.qa.framing_evidence, state.delivery)
    ))
    .sort((left, right) => (
      framingRepairDistance(left) - framingRepairDistance(right)
      || (right.qa.score ?? Number.NEGATIVE_INFINITY) - (left.qa.score ?? Number.NEGATIVE_INFINITY)
      || right.number - left.number
    ))[0] ?? null;
}

async function deterministicFramingCrop(bytes, cropPlan, delivery) {
  return sharp(bytes)
    .extract({
      left: cropPlan.left,
      top: cropPlan.top,
      width: cropPlan.width,
      height: cropPlan.height,
    })
    .resize({
      width: delivery.width,
      height: delivery.height,
      fit: 'fill',
    })
    .toColourspace('srgb')
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export class SceneServiceError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'SceneServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Durable production-scene core.
 *
 * Resolver contracts:
 *   approvedLookResolver.resolveApprovedLook(reference) ->
 *     { look_id, image, receipt, receipt_bytes?, source_run_id? }
 *   presetResolver.resolveScenePreset(reference) ->
 *     { preset, preset_bytes?, prompt, reference_pack, reference_pack_bytes?,
 *       assets: [{ reference_id, role, media_type, data }] }
 *
 * Generator contract:
 *   generator.generateScene(context) -> { image, media_type?, metadata? }
 *
 * Evaluator contract:
 *   evaluator.evaluateScene(context) ->
 *     { gates: [{ id, decision: "PASS"|"FAIL", evidence, defects? }], score?, summary? }
 *
 * MASTER_LOOK_LOCK, REFERENCE_ROLE_ISOLATION and PROVENANCE are deterministic
 * service gates. The evaluator must return exactly the other six named gates.
 */
export class SceneService {
  constructor({
    rootDirectory,
    approvedLookResolver,
    presetResolver,
    generator,
    evaluator,
    clock = () => new Date(),
    modelRoute = DEFAULT_SCENE_MODEL_ROUTE,
    delivery = DEFAULT_SCENE_DELIVERY,
    maxManualRetries = 2,
    qaMaxAttempts = 3,
    observerTimeoutMs = 2_000,
    observer = null,
    autoRecoverQaInfrastructureFailures = false,
  }) {
    if (!rootDirectory) throw new Error('SceneService rootDirectory is required');
    if (typeof approvedLookResolver?.resolveApprovedLook !== 'function') {
      throw new Error('SceneService approvedLookResolver.resolveApprovedLook is required');
    }
    if (typeof presetResolver?.resolveScenePreset !== 'function') {
      throw new Error('SceneService presetResolver.resolveScenePreset is required');
    }
    if (typeof generator?.generateScene !== 'function') {
      throw new Error('SceneService generator.generateScene is required');
    }
    if (typeof evaluator?.evaluateScene !== 'function') {
      throw new Error('SceneService evaluator.evaluateScene is required');
    }
    if (!Number.isInteger(maxManualRetries) || maxManualRetries < 0 || maxManualRetries > 20) {
      throw new Error('SceneService maxManualRetries must be an integer between 0 and 20');
    }
    if (!Number.isInteger(qaMaxAttempts) || qaMaxAttempts < 1 || qaMaxAttempts > 10) {
      throw new Error('SceneService qaMaxAttempts must be an integer between 1 and 10');
    }
    if (!Number.isFinite(observerTimeoutMs) || observerTimeoutMs < 10 || observerTimeoutMs > 30_000) {
      throw new Error('SceneService observerTimeoutMs must be between 10 and 30000 milliseconds');
    }
    if (typeof autoRecoverQaInfrastructureFailures !== 'boolean') {
      throw new Error('SceneService autoRecoverQaInfrastructureFailures must be boolean');
    }
    this.rootDirectory = path.resolve(rootDirectory);
    this.approvedLookResolver = approvedLookResolver;
    this.presetResolver = presetResolver;
    this.generator = generator;
    this.evaluator = evaluator;
    this.clock = clock;
    this.modelRoute = normalizeModelRoute(modelRoute);
    this.delivery = normalizeDelivery(delivery);
    this.maxManualRetries = maxManualRetries;
    this.qaMaxAttempts = qaMaxAttempts;
    this.observerTimeoutMs = observerTimeoutMs;
    this.observer = observer;
    this.autoRecoverQaInfrastructureFailures = autoRecoverQaInfrastructureFailures;
    this.events = new EventEmitter();
    this.running = new Map();
    this.creating = new Map();
    this.mutations = new Map();
    this.controllers = new Map();
    this.incidents = new Map();
  }

  sceneDirectory(sceneId) {
    assertSafeSceneId(sceneId);
    return path.join(this.rootDirectory, sceneId);
  }

  statePath(sceneId) {
    return path.join(this.sceneDirectory(sceneId), 'scene.json');
  }

  lockPath(sceneId, kind) {
    assertSafeSceneId(sceneId);
    if (!['create', 'execution', 'lifecycle', 'state'].includes(kind)) {
      throw new Error('Unsupported SceneService lock kind');
    }
    return path.join(this.rootDirectory, '.locks', `${sceneId}.${kind}.lock`);
  }

  tombstonePath(sceneId) {
    assertSafeSceneId(sceneId);
    return path.join(this.rootDirectory, '.tombstones', `${sceneId}.json`);
  }

  rejectionDirectory(sceneId) {
    return path.join(this.sceneDirectory(sceneId), 'rejections');
  }

  async #readRejectionRecords(sceneId) {
    const ledgerDirectory = path.join(this.rejectionDirectory(sceneId), 'ledger');
    let entries;
    try {
      entries = await readdir(ledgerDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const files = entries
      .filter((entry) => entry.isFile() && /^\d{6}\.json$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (files.length !== entries.filter((entry) => entry.isFile()).length) {
      throw new Error('Post-release rejection ledger contains an unsupported artifact');
    }
    const records = [];
    let previousEntryHash = null;
    for (const [index, entry] of files.entries()) {
      const expectedSequence = index + 1;
      if (entry.name !== `${String(expectedSequence).padStart(6, '0')}.json`) {
        throw new Error('Post-release rejection ledger sequence is not contiguous');
      }
      const entryPath = path.join(ledgerDirectory, entry.name);
      const entryBytes = await readFile(entryPath);
      let ledgerEntry;
      try {
        ledgerEntry = JSON.parse(entryBytes.toString('utf8'));
      } catch {
        throw new Error('Post-release rejection ledger entry is not valid JSON');
      }
      const receiptPath = resolveInside(
        this.sceneDirectory(sceneId),
        ledgerEntry.receipt_relative_path,
        'Post-release rejection receipt',
      );
      const receiptBytes = await readFile(receiptPath);
      const receiptHash = sha256(receiptBytes);
      let receipt;
      try {
        receipt = JSON.parse(receiptBytes.toString('utf8'));
      } catch {
        throw new Error('Post-release rejection receipt is not valid JSON');
      }
      validatePostReleaseRejectionReceipt(receipt, sceneId);
      validatePostReleaseRejectionLedgerEntry(ledgerEntry, {
        expectedSceneId: sceneId,
        expectedSequence,
        expectedPreviousHash: previousEntryHash,
        receipt,
        receiptHash,
      });
      const entryHash = sha256(entryBytes);
      records.push({
        entry: ledgerEntry,
        entryHash,
        receipt,
        receiptHash,
        receiptPath,
      });
      previousEntryHash = entryHash;
    }
    return records;
  }

  async #latestRejectionRecord(sceneId) {
    return (await this.#readRejectionRecords(sceneId)).at(-1) ?? null;
  }

  async #verifiedCompletedRelease(state) {
    if (state.status !== SCENE_STATES.COMPLETED || !state.output) {
      throw new SceneServiceError(
        409,
        'SCENE_NOT_REJECTABLE',
        'Only a completed scene release can be rejected',
      );
    }
    const directory = this.sceneDirectory(state.scene_id);
    const artifacts = {};
    for (const [name, hashField] of Object.entries(OUTPUT_HASH_FIELDS)) {
      const relativePath = name === 'scene.png'
        ? state.output.relative_path
        : state.output[{
          'scene-manifest.json': 'manifest_relative_path',
          'scene-evidence-manifest.json': 'evidence_manifest_relative_path',
          'scene-qa-receipt.json': 'qa_receipt_relative_path',
          'scene-privacy-report.json': 'privacy_report_relative_path',
        }[name]];
      const filename = resolveInside(directory, relativePath, `Completed scene ${name}`);
      let bytes;
      try {
        bytes = await readFile(filename);
      } catch {
        throw new SceneServiceError(
          409,
          'OUTPUT_INTEGRITY_FAILED',
          `Completed scene release is missing ${name}`,
        );
      }
      if (sha256(bytes) !== state.output[hashField]) {
        throw new SceneServiceError(
          409,
          'OUTPUT_INTEGRITY_FAILED',
          `Completed scene release no longer matches its ${name} receipt`,
        );
      }
      artifacts[name] = { filename, bytes };
    }
    let manifest;
    try {
      manifest = JSON.parse(artifacts['scene-manifest.json'].bytes.toString('utf8'));
    } catch {
      throw new SceneServiceError(
        409,
        'OUTPUT_INTEGRITY_FAILED',
        'Completed scene release manifest is not valid JSON',
      );
    }
    const sourceAttempt = state.attempts.find(
      (attempt) => attempt.number === manifest.generation?.attempt,
    );
    if (!sourceAttempt
      || sourceAttempt.status !== 'QA_PASS'
      || sourceAttempt.cycle !== manifest.generation?.cycle
      || sourceAttempt.candidate?.sha256 !== state.output.sha256
      || manifest.output?.sha256 !== state.output.sha256
      || manifest.qa?.decision !== 'PASS') {
      throw new SceneServiceError(
        409,
        'OUTPUT_INTEGRITY_FAILED',
        'Completed scene release is not bound to its original QA_PASS attempt',
      );
    }
    return { artifacts, manifest, sourceAttempt };
  }

  async #ensureRejectionQuarantine(sceneId, record) {
    const receipt = record.receipt;
    const directory = this.sceneDirectory(sceneId);
    const sourceDirectory = path.join(directory, 'outputs');
    const quarantineDirectory = resolveInside(
      directory,
      `${receipt.quarantine_relative_path}/outputs`,
      'Rejected scene quarantine',
    );
    const verifyArchived = async () => {
      for (const [name, hashField] of Object.entries(OUTPUT_HASH_FIELDS)) {
        const expectedHash = receipt.rejected_release.output[hashField];
        const filename = path.join(quarantineDirectory, name);
        let bytes;
        try {
          bytes = await readFile(filename);
        } catch {
          throw new SceneServiceError(
            409,
            'BOUND_INPUT_INTEGRITY_FAILED',
            `Rejected release quarantine is missing ${name}`,
          );
        }
        if (sha256(bytes) !== expectedHash) {
          throw new SceneServiceError(
            409,
            'BOUND_INPUT_INTEGRITY_FAILED',
            `Rejected release quarantine no longer matches ${name}`,
          );
        }
      }
    };
    if (await exists(quarantineDirectory)) {
      if (await exists(sourceDirectory)) {
        throw new SceneServiceError(
          409,
          'OUTPUT_INTEGRITY_FAILED',
          'Rejected release exists in both public and quarantine locations',
        );
      }
      await verifyArchived();
      return;
    }
    if (!await exists(sourceDirectory)) {
      throw new SceneServiceError(
        409,
        'BOUND_INPUT_INTEGRITY_FAILED',
        'Rejected release is missing before quarantine',
      );
    }
    for (const [name, hashField] of Object.entries(OUTPUT_HASH_FIELDS)) {
      let bytes;
      try {
        bytes = await readFile(path.join(sourceDirectory, name));
      } catch {
        throw new SceneServiceError(
          409,
          'BOUND_INPUT_INTEGRITY_FAILED',
          `Rejected release lost ${name} before quarantine`,
        );
      }
      if (sha256(bytes) !== receipt.rejected_release.output[hashField]) {
        throw new SceneServiceError(
          409,
          'BOUND_INPUT_INTEGRITY_FAILED',
          `Rejected release changed before ${name} could be quarantined`,
        );
      }
    }
    await mkdir(path.dirname(quarantineDirectory), { recursive: true });
    await rename(sourceDirectory, quarantineDirectory);
    await verifyArchived();
  }

  async #verifiedRejectionRepairRecord(state, rejectionId = null) {
    const records = await this.#readRejectionRecords(state.scene_id);
    const record = rejectionId
      ? records.find((candidate) => candidate.receipt.rejection_id === rejectionId)
      : records.at(-1);
    if (!record) return null;
    await this.#ensureRejectionQuarantine(state.scene_id, record);
    const repairPath = resolveInside(
      this.sceneDirectory(state.scene_id),
      record.receipt.repair_source.relative_path,
      'Rejected scene repair source',
    );
    const repairBytes = await readFile(repairPath);
    if (sha256(repairBytes) !== record.receipt.repair_source.sha256) {
      throw new SceneServiceError(
        409,
        'BOUND_INPUT_INTEGRITY_FAILED',
        'Rejected scene repair source no longer matches its immutable receipt',
      );
    }
    let metadata;
    try {
      metadata = await sharp(repairBytes).metadata();
    } catch {
      throw new SceneServiceError(
        409,
        'BOUND_INPUT_INTEGRITY_FAILED',
        'Rejected scene repair source is no longer a decodable image',
      );
    }
    if (metadata.format !== 'png'
      || metadata.width !== state.delivery.width
      || metadata.height !== state.delivery.height
      || (metadata.pages ?? 1) !== 1) {
      throw new SceneServiceError(
        409,
        'BOUND_INPUT_INTEGRITY_FAILED',
        'Rejected scene repair source no longer matches delivery geometry',
      );
    }
    const sourceAttempt = state.attempts.find(
      (attempt) => attempt.number === record.receipt.repair_source.source_attempt,
    );
    return {
      ...record,
      repairAttempt: postReleaseRepairAttempt(record.receipt, sourceAttempt),
    };
  }

  async #rejectionRepairDisposition(state, record = null) {
    const latest = record ?? await this.#latestRejectionRecord(state.scene_id);
    if (!latest) return { status: 'NONE', record: null };
    const taggedAttempts = state.attempts.filter(
      (attempt) => attempt.provider_metadata?.rejection_id === latest.receipt.rejection_id,
    );
    if (state.status === SCENE_STATES.COMPLETED && state.output) {
      try {
        const manifest = JSON.parse(await readFile(
          path.join(this.sceneDirectory(state.scene_id), state.output.manifest_relative_path),
          'utf8',
        ));
        if (manifest.supersedes?.rejection_id === latest.receipt.rejection_id
          && manifest.supersedes?.rejection_receipt_sha256 === latest.receiptHash) {
          return { status: 'SUPERSEDED', record: latest };
        }
      } catch {
        // A malformed current release is handled by the completed-output reconciler.
      }
    }
    if (state.error?.code === 'OUTPUT_INTEGRITY_FAILED'
      && taggedAttempts.some((attempt) => attempt.status === 'QA_PASS')) {
      return { status: 'SUPERSEDED', record: latest };
    }
    if (taggedAttempts.some((attempt) => attempt.cycle === state.cycle)
      && [SCENE_STATES.QUEUED, SCENE_STATES.RUNNING].includes(state.status)) {
      return { status: 'ACTIVE', record: latest };
    }
    if (taggedAttempts.length > 0) return { status: 'CONSUMED', record: latest };
    return { status: 'PENDING', record: latest };
  }

  async #denyAndQuarantineRejectedRelease(state, record) {
    const rejectedHash = record.receipt.rejected_release.output.sha256;
    const denied = await this.#mutate(state.scene_id, (current) => {
      if (current.status === SCENE_STATES.COMPLETED) {
        if (current.output?.sha256 !== rejectedHash) {
          throw new SceneServiceError(
            409,
            'SCENE_REJECTION_STALE_OUTPUT',
            'The completed scene changed before rejection could be committed',
          );
        }
        return {
          ...current,
          status: SCENE_STATES.FAILED,
          phase: 'POST_RELEASE_REJECTED',
          message: 'Released scene was rejected and removed from public output',
          qa: {
            decision: 'PENDING',
            gates: createPreflightGates(
              current.bindings.approved_look.image_sha256,
              current.bindings.reference_pack.sha256,
              current.bindings.approved_items?.evidence_sha256 ?? null,
            ),
            score: null,
            summary: '',
          },
          output: null,
          error: {
            code: 'POST_RELEASE_REJECTED',
            message: 'One hash-bound post-release repair cycle is available',
          },
          cancellation: null,
        };
      }
      if (current.error?.code === 'POST_RELEASE_REJECTED' && current.output === null) {
        return NO_CHANGE;
      }
      throw new SceneServiceError(
        409,
        'SCENE_NOT_REJECTABLE',
        'The rejected release is no longer the current scene output',
      );
    });
    await this.#ensureRejectionQuarantine(state.scene_id, record);
    return denied;
  }

  async #withSceneLock(sceneId, kind, action, {
    waitMs = LOCK_WAIT_MS,
    required = true,
  } = {}) {
    const release = await acquireFilesystemLock(this.lockPath(sceneId, kind), { waitMs });
    if (!release) {
      if (!required) return LOCK_NOT_ACQUIRED;
      throw new SceneServiceError(
        503,
        'SCENE_BUSY',
        `Scene ${kind} lock is held by another active service instance`,
      );
    }
    try {
      return await action();
    } finally {
      await release();
    }
  }

  async #readTombstone(sceneId) {
    try {
      const tombstone = JSON.parse(await readFile(this.tombstonePath(sceneId), 'utf8'));
      if (tombstone.scene_id !== sceneId || tombstone.status !== 'DELETED') {
        throw new Error('Invalid scene tombstone');
      }
      return tombstone;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #loadIncidents() {
    const incidentDirectory = path.join(this.rootDirectory, 'incidents');
    let entries;
    try {
      entries = await readdir(incidentDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const incident = JSON.parse(await readFile(path.join(incidentDirectory, entry.name), 'utf8'));
        assertSafeSceneId(incident.scene_id, 'incident.scene_id');
        if (incident.code !== 'MALFORMED_PERSISTED_SCENE') continue;
        const previous = this.incidents.get(incident.scene_id);
        if (!previous || previous.created_at < incident.created_at) {
          this.incidents.set(incident.scene_id, incident);
        }
      } catch {
        // Incident corruption is isolated from production jobs.
      }
    }
  }

  async #publish(value, eventKey) {
    try {
      this.events.emit(eventKey, sanitizeOutbound(value));
    } catch {
      // A broken live listener cannot change the durable job.
    }
    if (this.observer) {
      let timeout;
      try {
        await Promise.race([
          Promise.resolve().then(() => this.observer(sanitizeOutbound(value))),
          new Promise((resolve) => {
            timeout = setTimeout(resolve, this.observerTimeoutMs);
          }),
        ]);
      } catch {
        // Monitoring cannot change generation semantics.
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  }

  async #quarantineMalformed(sceneId, error) {
    return this.#withSceneLock(sceneId, 'lifecycle', async () => {
      const existing = this.incidents.get(sceneId);
      if (existing) return existing;
      const directory = this.sceneDirectory(sceneId);
      if (!await exists(directory)) {
        await this.#loadIncidents();
        return this.incidents.get(sceneId) ?? null;
      }
      const createdAt = nowIso(this.clock);
      const suffix = `${createdAt.replaceAll(/[^0-9]/g, '')}-${randomUUID()}`;
      const quarantineRelativePath = `quarantine/malformed-${sceneId}-${suffix}`;
      const quarantinePath = path.join(this.rootDirectory, quarantineRelativePath);
      await mkdir(path.dirname(quarantinePath), { recursive: true });
      await rename(directory, quarantinePath);
      const incident = {
        schema_version: SCENE_SCHEMA_VERSION,
        incident_id: `incident_${randomUUID()}`,
        scene_id: sceneId,
        status: 'QUARANTINED',
        code: 'MALFORMED_PERSISTED_SCENE',
        message: `Persisted scene state failed strict validation: ${errorMessage(error)}`,
        quarantine_relative_path: quarantineRelativePath,
        created_at: createdAt,
      };
      const incidentPath = path.join(
        this.rootDirectory,
        'incidents',
        `${sceneId}-${suffix}.json`,
      );
      await writeImmutable(incidentPath, canonicalJsonBytes(incident));
      this.incidents.set(sceneId, incident);
      await this.#publish({ type: 'scene.incident', ...incident }, sceneId);
      return incident;
    });
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true });
    await this.#loadIncidents();
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    const qaRecoveryIds = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || RESERVED_ROOT_DIRECTORIES.has(entry.name)) continue;
      try {
        assertSafeSceneId(entry.name);
      } catch {
        continue;
      }
      let state;
      try {
        state = await this.#read(entry.name);
      } catch (error) {
        await this.#quarantineMalformed(entry.name, error);
        continue;
      }
      if (!state || state.scene_id !== entry.name) continue;
      await this.#reconcile(state);
      if (this.autoRecoverQaInfrastructureFailures
        && this.#isCandidatePreservingQaRecovery(state)) {
        qaRecoveryIds.push(state.scene_id);
      }
    }
    for (const sceneId of qaRecoveryIds) {
      // A deployed evaluator-contract repair must resume the immutable
      // candidate itself. Never regenerate an image just because QA tooling
      // was repaired; a deterministic key makes this recovery one-shot.
      await this.retryScene(sceneId, {
        idempotencyKey: `qa-contract-recovery-v1-${sceneId}`,
      });
    }
  }

  // Candidate-preserving QA recovery: the image already generated
  // successfully and the latest attempt is still QA_PENDING with its
  // candidate intact. Only QA_INFRASTRUCTURE_FAILED and the constrained
  // SCENE_INTERNAL_ERROR shape below qualify — anything else may be a real
  // integrity error and must not be silently retried.
  #isCandidatePreservingQaRecovery(state) {
    const lastAttempt = state.attempts.at(-1);
    return state.status === SCENE_STATES.FAILED
      && lastAttempt?.status === 'QA_PENDING'
      && Boolean(lastAttempt?.candidate)
      && ['QA_INFRASTRUCTURE_FAILED', 'SCENE_INTERNAL_ERROR'].includes(state.error?.code);
  }

  async #read(sceneId) {
    try {
      const state = JSON.parse(await readFile(this.statePath(sceneId), 'utf8'));
      return validatePersistedSceneState(state, sceneId);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #verifyBoundInputs(state) {
    const directory = this.sceneDirectory(state.scene_id);
    const verifiedFile = async (relativePath, expectedHash, label) => {
      const filename = resolveInside(directory, relativePath, label);
      const bytes = await readFile(filename);
      if (sha256(bytes) !== expectedHash) {
        throw new Error(`${label} no longer matches its bound SHA-256`);
      }
      return { filename, bytes };
    };
    try {
      const look = await verifiedFile(
        state.bindings.approved_look.relative_path,
        state.bindings.approved_look.image_sha256,
        'Approved look',
      );
      const receiptFile = await verifiedFile(
        state.bindings.approved_look.receipt_relative_path,
        state.bindings.approved_look.receipt_sha256,
        'Approved look receipt',
      );
      const presetFile = await verifiedFile(
        state.bindings.preset.relative_path,
        state.bindings.preset.sha256,
        'Scene preset',
      );
      const promptFile = await verifiedFile(
        state.bindings.prompt.relative_path,
        state.bindings.prompt.sha256,
        'Scene prompt',
      );
      const packFile = await verifiedFile(
        state.bindings.reference_pack.relative_path,
        state.bindings.reference_pack.sha256,
        'Scene reference pack',
      );
      const routeFile = await verifiedFile(
        'inputs/model-route.json',
        state.model_route.sha256,
        'Scene model route',
      );
      const shotAnchors = [];
      for (const binding of state.bindings.shot_anchors ?? []) {
        const verified = await verifiedFile(
          binding.relative_path,
          binding.sha256,
          `Scene shot anchor ${binding.role}`,
        );
        const metadata = await sharp(verified.bytes).metadata();
        if (metadata.format !== 'png' || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
          throw new Error(`Scene shot anchor ${binding.role} is not one PNG`);
        }
        shotAnchors.push({
          order: binding.order,
          role: binding.role,
          reference_id: binding.reference_id,
          sha256: binding.sha256,
          media_type: binding.media_type,
          path: verified.filename,
        });
      }
      const approvedItems = [];
      if (state.bindings.approved_items) {
        const itemBinding = state.bindings.approved_items;
        const evidenceFile = await verifiedFile(
          itemBinding.relative_path,
          itemBinding.evidence_sha256,
          'Approved item evidence',
        );
        let evidence;
        try {
          evidence = JSON.parse(evidenceFile.bytes.toString('utf8'));
        } catch {
          throw new Error('Approved item evidence is not valid JSON');
        }
        assertNoLocalPathText(evidenceFile.bytes.toString('utf8'), 'Approved item evidence');
        if (evidence.schema_version !== itemBinding.schema_version
          || evidence.kind !== itemBinding.kind
          || evidence.source_run_id !== itemBinding.source_run_id
          || evidence.source_run_id !== state.bindings.approved_look.source_run_id
          || evidence.reference_pack?.sha256 !== itemBinding.reference_pack_sha256
          || !Array.isArray(evidence.items)
          || evidence.items.length !== itemBinding.items.length) {
          throw new Error('Approved item evidence no longer matches its persisted binding');
        }
        for (const [index, binding] of itemBinding.items.entries()) {
          const logical = evidence.items[index];
          if (logical?.order !== binding.order
            || logical?.role !== binding.role
            || logical?.category !== binding.category
            || logical?.reference_set_id !== binding.reference_set_id
            || logical?.sha256 !== binding.sha256
            || logical?.facts_sha256 !== binding.facts_sha256
            || logical?.media_type !== binding.media_type
            || approvedItemFactsSha256(logical) !== binding.facts_sha256) {
            throw new Error(`Approved item ${binding.reference_set_id} no longer matches its logical evidence`);
          }
          const verified = await verifiedFile(
            binding.relative_path,
            binding.sha256,
            `Approved item ${binding.reference_set_id}`,
          );
          const metadata = await sharp(verified.bytes).metadata();
          if (metadata.format !== 'png'
            || !metadata.width
            || !metadata.height
            || (metadata.pages ?? 1) !== 1) {
            throw new Error(`Approved item ${binding.reference_set_id} is not one PNG`);
          }
          approvedItems.push({
            ...logical,
            path: verified.filename,
          });
        }
      }

      const receipt = JSON.parse(receiptFile.bytes.toString('utf8'));
      receiptBinding(
        receipt,
        { source_run_id: state.bindings.approved_look.source_run_id },
        {
          look_id: state.bindings.approved_look.look_id,
          image_sha256: state.bindings.approved_look.image_sha256,
          receipt_sha256: state.bindings.approved_look.receipt_sha256,
        },
        state.bindings.approved_look.image_sha256,
      );
      const preset = JSON.parse(presetFile.bytes.toString('utf8'));
      const prompt = promptFile.bytes.toString('utf8');
      assertNoLocalPathText(prompt, 'Scene prompt');
      const referencePack = JSON.parse(packFile.bytes.toString('utf8'));
      const route = JSON.parse(routeFile.bytes.toString('utf8'));
      if (sha256(canonicalJsonBytes(route)) !== sha256(canonicalJsonBytes(state.model_route.entries))) {
        throw new Error('Scene model route snapshot no longer matches the persisted job route');
      }
      const reference = {
        preset_id: state.bindings.preset.preset_id,
        preset_version: state.bindings.preset.version,
        preset_sha256: state.bindings.preset.sha256,
        reference_pack_id: state.bindings.reference_pack.reference_pack_id,
        reference_pack_version: state.bindings.reference_pack.version,
        reference_pack_sha256: state.bindings.reference_pack.sha256,
        prompt_sha256: state.bindings.prompt.sha256,
      };
      validatePresetSnapshot(preset, reference);
      validateReferencePack(
        referencePack,
        reference,
        state.bindings.preset.sha256,
        state.bindings.prompt.sha256,
        preset,
      );
      validateResolvedReferenceAssets(referencePack, state.bindings.reference_pack.references);
      const references = [];
      for (const binding of state.bindings.reference_pack.references) {
        const declared = referencePack.references.find((item) => item.reference_id === binding.reference_id);
        if (!declared
          || declared.sha256 !== binding.sha256
          || declared.role !== binding.role
          || declared.media_type !== binding.media_type) {
          throw new Error(`Scene reference ${binding.reference_id} no longer matches its pack declaration`);
        }
        const verified = await verifiedFile(
          binding.relative_path,
          binding.sha256,
          `Scene reference ${binding.reference_id}`,
        );
        references.push({
          reference_id: binding.reference_id,
          role: binding.role,
          sha256: binding.sha256,
          media_type: binding.media_type,
          not_authority_for: binding.not_authority_for,
          path: verified.filename,
        });
      }
      return {
        approvedLookPath: look.filename,
        receiptPath: receiptFile.filename,
        presetPath: presetFile.filename,
        preset,
        promptPath: promptFile.filename,
        prompt,
        referencePackPath: packFile.filename,
        referencePack,
        references,
        approvedItems,
        shotAnchors,
      };
    } catch (error) {
      throw new SceneServiceError(
        409,
        'BOUND_INPUT_INTEGRITY_FAILED',
        `Immutable scene input verification failed: ${errorMessage(error)}`,
      );
    }
  }

  async #persistState(state, { expectedRevision = null } = {}) {
    if (expectedRevision !== null) {
      const current = await this.#read(state.scene_id);
      if (!current || current.state_revision !== expectedRevision) {
        throw new SceneServiceError(
          409,
          'SCENE_STATE_CONFLICT',
          'Persisted scene state changed before the compare-and-swap write',
        );
      }
    }
    validatePersistedSceneState(state, state.scene_id);
    await atomicWrite(this.statePath(state.scene_id), Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
    return state;
  }

  async #writeState(state) {
    const persisted = await this.#persistState(state);
    await this.#publish(publicScene(persisted), persisted.scene_id);
    return persisted;
  }

  async #mutate(sceneId, action) {
    const previous = this.mutations.get(sceneId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        let changed = false;
        const result = await this.#withSceneLock(sceneId, 'state', async () => {
          const current = await this.#read(sceneId);
          if (!current) {
            if (await this.#readTombstone(sceneId)) {
              throw new SceneServiceError(410, 'SCENE_DELETED', 'Scene was permanently deleted');
            }
            throw new SceneServiceError(404, 'SCENE_NOT_FOUND', 'Scene not found');
          }
          const next = await action(current);
          if (next === NO_CHANGE) return current;
          next.updated_at = nowIso(this.clock);
          next.state_revision = current.state_revision + 1;
          changed = true;
          return this.#persistState(next, { expectedRevision: current.state_revision });
        });
        if (changed) await this.#publish(publicScene(result), sceneId);
        return result;
      });
    this.mutations.set(sceneId, operation);
    try {
      return await operation;
    } finally {
      if (this.mutations.get(sceneId) === operation) this.mutations.delete(sceneId);
    }
  }

  async #reconcile(state) {
    if (this.running.has(state.scene_id)) return;
    const rejectionRecords = await this.#readRejectionRecords(state.scene_id);
    const latestRejection = rejectionRecords.at(-1) ?? null;
    const matchingRejection = state.output
      ? [...rejectionRecords].reverse().find(
        (record) => record.receipt.rejected_release.output.sha256 === state.output.sha256,
      )
      : null;
    if (matchingRejection && state.status === SCENE_STATES.COMPLETED) {
      await this.#withSceneLock(state.scene_id, 'lifecycle', async () => {
        const current = await this.#read(state.scene_id);
        if (current?.status === SCENE_STATES.COMPLETED
          && current.output?.sha256
            === matchingRejection.receipt.rejected_release.output.sha256) {
          await this.#denyAndQuarantineRejectedRelease(current, matchingRejection);
        } else if (current?.error?.code === 'POST_RELEASE_REJECTED') {
          await this.#ensureRejectionQuarantine(state.scene_id, matchingRejection);
        }
      });
      return;
    }
    if (latestRejection
      && state.status === SCENE_STATES.FAILED
      && state.error?.code === 'POST_RELEASE_REJECTED') {
      await this.#withSceneLock(state.scene_id, 'lifecycle', async () => {
        await this.#ensureRejectionQuarantine(state.scene_id, latestRejection);
      });
      return;
    }
    if (state.status === SCENE_STATES.COMPLETED) {
      const sceneDirectory = this.sceneDirectory(state.scene_id);
      const outputPath = resolveInside(sceneDirectory, state.output.relative_path, 'Completed scene output');
      const manifestPath = resolveInside(sceneDirectory, state.output.manifest_relative_path, 'Completed scene manifest');
      const evidenceManifestPath = resolveInside(
        sceneDirectory,
        state.output.evidence_manifest_relative_path,
        'Completed scene evidence manifest',
      );
      const qaReceiptPath = resolveInside(
        sceneDirectory,
        state.output.qa_receipt_relative_path,
        'Completed scene QA receipt',
      );
      const privacyReportPath = resolveInside(
        sceneDirectory,
        state.output.privacy_report_relative_path,
        'Completed scene privacy report',
      );
      const valid = state.output
        && await exists(outputPath)
        && await exists(manifestPath)
        && await exists(evidenceManifestPath)
        && await exists(qaReceiptPath)
        && await exists(privacyReportPath)
        && sha256(await readFile(outputPath)) === state.output.sha256
        && sha256(await readFile(manifestPath)) === state.output.manifest_sha256
        && sha256(await readFile(evidenceManifestPath)) === state.output.evidence_manifest_sha256
        && sha256(await readFile(qaReceiptPath)) === state.output.qa_receipt_sha256
        && sha256(await readFile(privacyReportPath)) === state.output.privacy_report_sha256;
      if (!valid) {
        const outputDirectory = path.join(sceneDirectory, 'outputs');
        if (await exists(outputDirectory)) {
          const quarantineDirectory = path.join(sceneDirectory, 'quarantine');
          await mkdir(quarantineDirectory, { recursive: true });
          await rename(
            outputDirectory,
            path.join(quarantineDirectory, `invalid-output-${Date.now()}-${randomUUID()}`),
          );
        }
        await this.#mutate(state.scene_id, (current) => ({
          ...current,
          status: SCENE_STATES.FAILED,
          phase: 'OUTPUT_INTEGRITY_FAILED',
          message: 'Scene output failed restart integrity verification',
          error: {
            code: 'OUTPUT_INTEGRITY_FAILED',
            message: 'A completed scene output is missing or no longer matches its receipt',
          },
          output: null,
        }));
      }
      return;
    }
    if (state.status === SCENE_STATES.RUNNING) {
      this.start(state.scene_id);
      return;
    }
    if (state.status === SCENE_STATES.QUEUED) this.start(state.scene_id);
  }

  async createScene({
    idempotencyKey,
    approvedLookReference,
    presetReference,
    shotAnchorReferences = null,
  }) {
    assertIdempotencyKey(idempotencyKey);
    const approvedLook = validateApprovedLookReference(approvedLookReference);
    const preset = validatePresetReference(presetReference);
    const shotAnchors = validateShotAnchorReferences(shotAnchorReferences);
    const idempotencyHash = sha256(idempotencyKey);
    const sceneId = `scene_${idempotencyHash.slice(0, 48)}`;
    const routeBytes = canonicalJsonBytes(this.modelRoute);
    const requestFingerprint = sha256(canonicalJsonBytes({
      approved_look: approvedLook,
      preset,
      // Only role and hash: the bytes are already summarised by the hash, and an
      // anchor set that differs is a different request even when everything the
      // preset declares is identical.
      ...(shotAnchors ? {
        shot_anchors: shotAnchors.map((anchor) => ({ role: anchor.role, sha256: anchor.sha256 })),
      } : {}),
      delivery: this.delivery,
      model_route_sha256: sha256(routeBytes),
    }));

    const pending = this.creating.get(sceneId);
    if (pending) return pending;
    if (await this.#readTombstone(sceneId)) {
      throw new SceneServiceError(410, 'SCENE_DELETED', 'This idempotent scene request was permanently deleted');
    }
    const existing = await this.#read(sceneId);
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw new SceneServiceError(409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key is already bound to a different scene request');
      }
      if (existing.status === SCENE_STATES.QUEUED && !this.running.has(sceneId)) this.start(sceneId);
      return publicScene(existing);
    }
    const raced = this.creating.get(sceneId);
    if (raced) return raced;

    const creation = this.#withSceneLock(sceneId, 'create', async () => {
      if (await this.#readTombstone(sceneId)) {
        throw new SceneServiceError(410, 'SCENE_DELETED', 'This idempotent scene request was permanently deleted');
      }
      const concurrentlyCreated = await this.#read(sceneId);
      if (concurrentlyCreated) {
        if (concurrentlyCreated.request_fingerprint !== requestFingerprint) {
          throw new SceneServiceError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'The idempotency key is already bound to a different scene request',
          );
        }
        if (concurrentlyCreated.status === SCENE_STATES.QUEUED) this.start(sceneId);
        return publicScene(concurrentlyCreated);
      }
      return this.#createNewScene({
        sceneId,
        idempotencyHash,
        requestFingerprint,
        approvedLookReference: approvedLook,
        presetReference: preset,
        shotAnchorReferences: shotAnchors,
        routeBytes,
      });
    }, { waitMs: 30_000 }).finally(() => this.creating.delete(sceneId));
    this.creating.set(sceneId, creation);
    return creation;
  }

  async #createNewScene({
    sceneId,
    idempotencyHash,
    requestFingerprint,
    approvedLookReference,
    presetReference,
    shotAnchorReferences,
    routeBytes,
  }) {
    const [resolvedLook, resolvedPreset] = await Promise.all([
      this.approvedLookResolver.resolveApprovedLook(approvedLookReference),
      this.presetResolver.resolveScenePreset(presetReference),
    ]);

    if (!resolvedLook || typeof resolvedLook !== 'object' || Array.isArray(resolvedLook)) {
      throw new Error('Approved look resolver returned an invalid result');
    }
    const resolvedLookId = resolvedLook.look_id ?? resolvedLook.lookId;
    if (resolvedLookId !== approvedLookReference.look_id) {
      throw new Error('Approved look resolver returned a different look id');
    }
    const lookBytes = await binaryFrom(resolvedLook.image, 'Resolved approved look image');
    const lookHash = sha256(lookBytes);
    if (lookHash !== approvedLookReference.image_sha256) {
      throw new Error('Approved look image SHA-256 mismatch');
    }
    let lookMetadata;
    try {
      lookMetadata = await sharp(lookBytes).metadata();
    } catch {
      throw new Error('Resolved approved look is not a decodable image');
    }
    if (!lookMetadata.width || !lookMetadata.height || (lookMetadata.pages ?? 1) !== 1) {
      throw new Error('Resolved approved look must be one still image');
    }
    const lookMediaType = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
    }[lookMetadata.format];
    if (!lookMediaType) throw new Error('Resolved approved look must be PNG, JPEG, or WEBP');
    const receiptBytes = await receiptBytesFrom(resolvedLook.receipt_bytes ?? resolvedLook.receipt);
    const receiptHash = sha256(receiptBytes);
    if (receiptHash !== approvedLookReference.receipt_sha256) {
      throw new Error('Approved look receipt SHA-256 mismatch');
    }
    let receipt;
    try {
      receipt = JSON.parse(receiptBytes.toString('utf8'));
    } catch {
      throw new Error('Approved look receipt is not valid JSON');
    }
    const approvedLookBinding = receiptBinding(receipt, resolvedLook, approvedLookReference, lookHash);
    const approvedItemsSnapshot = await approvedItemSnapshot(
      resolvedLook.approved_item_evidence,
      approvedLookBinding.source_run_id,
    );

    if (!resolvedPreset || typeof resolvedPreset !== 'object' || Array.isArray(resolvedPreset)) {
      throw new Error('Scene preset resolver returned an invalid result');
    }
    const presetSnapshot = await jsonSnapshot(
      resolvedPreset.preset,
      resolvedPreset.preset_bytes,
      'Resolved scene preset',
    );
    if (presetSnapshot.sha256 !== presetReference.preset_sha256) {
      throw new Error('Scene preset SHA-256 mismatch');
    }
    validatePresetSnapshot(presetSnapshot.document, presetReference);
    const promptBytes = await binaryFrom(resolvedPreset.prompt, 'Resolved scene prompt');
    const promptHash = sha256(promptBytes);
    if (promptHash !== presetReference.prompt_sha256) {
      throw new Error('Scene prompt SHA-256 mismatch');
    }
    if (promptBytes.length === 0 || promptBytes.includes(0)) {
      throw new Error('Resolved scene prompt must be non-empty UTF-8 text');
    }
    assertNoLocalPathText(promptBytes.toString('utf8'), 'Resolved scene prompt');
    const referencePackSnapshot = await jsonSnapshot(
      resolvedPreset.reference_pack,
      resolvedPreset.reference_pack_bytes,
      'Resolved scene reference pack',
    );
    if (referencePackSnapshot.sha256 !== presetReference.reference_pack_sha256) {
      throw new Error('Scene reference pack SHA-256 mismatch');
    }
    validateReferencePack(
      referencePackSnapshot.document,
      presetReference,
      presetSnapshot.sha256,
      promptHash,
      presetSnapshot.document,
    );
    const resolvedAssets = validateResolvedReferenceAssets(
      referencePackSnapshot.document,
      resolvedPreset.assets,
    );
    const assetSnapshots = [];
    for (const asset of resolvedAssets) {
      const document = referencePackSnapshot.document.references
        .find((item) => item.reference_id === asset.reference_id);
      const bytes = await binaryFrom(asset.data ?? asset.image ?? asset.bytes, `Scene reference ${asset.reference_id}`);
      if (sha256(bytes) !== document.sha256) {
        throw new Error(`Scene reference ${asset.reference_id} SHA-256 mismatch`);
      }
      assetSnapshots.push({ ...document, bytes });
    }

    const directory = this.sceneDirectory(sceneId);
    const inputDirectory = path.join(directory, 'inputs');
    const referenceDirectory = path.join(inputDirectory, 'references');
    const approvedItemsDirectory = path.join(inputDirectory, 'approved-items');
    const shotAnchorDirectory = path.join(inputDirectory, 'shot-anchors');
    await Promise.all([
      mkdir(referenceDirectory, { recursive: true }),
      ...(approvedItemsSnapshot
        ? [mkdir(approvedItemsDirectory, { recursive: true })]
        : []),
      ...(shotAnchorReferences ? [mkdir(shotAnchorDirectory, { recursive: true })] : []),
    ]);
    const lookRelativePath = `inputs/approved-look${extensionFor(lookMediaType)}`;
    const receiptRelativePath = 'inputs/approved-look-receipt.json';
    const presetRelativePath = 'inputs/preset.json';
    const promptRelativePath = 'inputs/prompt.txt';
    const packRelativePath = 'inputs/reference-pack.json';
    const itemEvidenceRelativePath = approvedItemsSnapshot
      ? 'inputs/approved-items/evidence.json'
      : null;
    await Promise.all([
      writeImmutable(path.join(directory, lookRelativePath), lookBytes),
      writeImmutable(path.join(directory, receiptRelativePath), receiptBytes),
      writeImmutable(path.join(directory, presetRelativePath), presetSnapshot.bytes),
      writeImmutable(path.join(directory, promptRelativePath), promptBytes),
      writeImmutable(path.join(directory, packRelativePath), referencePackSnapshot.bytes),
      writeImmutable(path.join(inputDirectory, 'model-route.json'), routeBytes),
      ...(approvedItemsSnapshot ? [
        writeImmutable(
          path.join(directory, itemEvidenceRelativePath),
          approvedItemsSnapshot.bytes,
        ),
      ] : []),
    ]);
    const referenceBindings = [];
    for (const asset of assetSnapshots) {
      const relativePath = `inputs/references/${asset.reference_id}${extensionFor(asset.media_type)}`;
      await writeImmutable(path.join(directory, relativePath), asset.bytes);
      referenceBindings.push({
        reference_id: asset.reference_id,
        role: asset.role,
        sha256: asset.sha256,
        media_type: asset.media_type,
        not_authority_for: asset.not_authority_for,
        relative_path: relativePath,
      });
    }
    const shotAnchorBindings = [];
    for (const anchor of shotAnchorReferences ?? []) {
      const bytes = await binaryFrom(anchor.data, `Scene shot anchor ${anchor.role}`);
      if (sha256(bytes) !== anchor.sha256) {
        throw new Error(`Scene shot anchor ${anchor.role} SHA-256 mismatch`);
      }
      const metadata = await sharp(bytes).metadata();
      if (metadata.format !== 'png' || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
        throw new Error(`Scene shot anchor ${anchor.role} is not one PNG`);
      }
      const relativePath = `inputs/shot-anchors/${String(anchor.order).padStart(2, '0')}-${anchor.role}.png`;
      await writeImmutable(path.join(directory, relativePath), bytes);
      shotAnchorBindings.push({
        order: anchor.order,
        role: anchor.role,
        reference_id: anchor.reference_id,
        sha256: anchor.sha256,
        media_type: 'image/png',
        relative_path: relativePath,
      });
    }
    const approvedItemBindings = [];
    for (const item of approvedItemsSnapshot?.items ?? []) {
      const relativePath = `inputs/approved-items/${String(item.logical.order).padStart(2, '0')}-${item.logical.reference_set_id}.png`;
      await writeImmutable(path.join(directory, relativePath), item.data);
      approvedItemBindings.push({
        order: item.logical.order,
        role: item.logical.role,
        category: item.logical.category,
        reference_set_id: item.logical.reference_set_id,
        sha256: item.logical.sha256,
        facts_sha256: item.logical.facts_sha256,
        media_type: item.logical.media_type,
        relative_path: relativePath,
      });
    }

    const now = nowIso(this.clock);
    const state = {
      schema_version: SCENE_SCHEMA_VERSION,
      scene_id: sceneId,
      state_revision: 1,
      request_fingerprint: requestFingerprint,
      idempotency_hash: idempotencyHash,
      status: SCENE_STATES.QUEUED,
      phase: 'BOUND',
      message: 'Approved look and scene preset are immutably bound',
      created_at: now,
      updated_at: now,
      bindings: {
        approved_look: {
          look_id: approvedLookReference.look_id,
          image_sha256: lookHash,
          media_type: lookMediaType,
          receipt_sha256: receiptHash,
          receipt_format: approvedLookBinding.format,
          source_run_id: approvedLookBinding.source_run_id,
          relative_path: lookRelativePath,
          receipt_relative_path: receiptRelativePath,
        },
        ...(approvedItemsSnapshot ? {
          approved_items: {
            schema_version: approvedItemsSnapshot.document.schema_version,
            kind: approvedItemsSnapshot.document.kind,
            source_run_id: approvedItemsSnapshot.document.source_run_id,
            reference_pack_sha256:
              approvedItemsSnapshot.document.reference_pack.sha256,
            evidence_sha256: approvedItemsSnapshot.sha256,
            relative_path: itemEvidenceRelativePath,
            items: approvedItemBindings,
          },
        } : {}),
        ...(shotAnchorBindings.length > 0 ? { shot_anchors: shotAnchorBindings } : {}),
        preset: {
          preset_id: presetReference.preset_id,
          version: presetReference.preset_version,
          sha256: presetSnapshot.sha256,
          relative_path: presetRelativePath,
        },
        prompt: {
          sha256: promptHash,
          relative_path: promptRelativePath,
        },
        reference_pack: {
          reference_pack_id: presetReference.reference_pack_id,
          version: presetReference.reference_pack_version,
          sha256: referencePackSnapshot.sha256,
          relative_path: packRelativePath,
          source_ledger: referencePackSnapshot.document.source_ledger,
          references: referenceBindings,
        },
      },
      delivery: this.delivery,
      model_route: {
        route_version: 'zeely.scene.image-route.v1',
        sha256: sha256(routeBytes),
        entries: this.modelRoute,
      },
      cycle: 1,
      manual_retries: 0,
      retry_requests: [],
      attempts: [],
      qa: {
        decision: 'PENDING',
        gates: createPreflightGates(
          lookHash,
          referencePackSnapshot.sha256,
          approvedItemsSnapshot?.sha256 ?? null,
        ),
        score: null,
        summary: '',
      },
      output: null,
      error: null,
      cancellation: null,
    };
    await this.#writeState(state);
    this.start(sceneId);
    return publicScene(state);
  }

  start(sceneId) {
    assertSafeSceneId(sceneId);
    if (this.running.has(sceneId)) return this.running.get(sceneId);
    const controller = new AbortController();
    this.controllers.set(sceneId, controller);
    const promise = this.#withSceneLock(sceneId, 'execution', async () => {
      if (await this.#readTombstone(sceneId)) return null;
      return this.#execute(sceneId, controller.signal);
    }, {
      waitMs: 250,
      required: false,
    })
      .then((result) => result === LOCK_NOT_ACQUIRED ? this.#read(sceneId) : result)
      .finally(() => {
        this.running.delete(sceneId);
        if (this.controllers.get(sceneId) === controller) this.controllers.delete(sceneId);
      });
    this.running.set(sceneId, promise);
    return promise;
  }

  async #execute(sceneId, signal) {
    let state = await this.#read(sceneId);
    if (!state || SCENE_TERMINAL_STATES.has(state.status)) return state;
    state = await this.#mutate(sceneId, (current) => {
      if (SCENE_TERMINAL_STATES.has(current.status)) return NO_CHANGE;
      return {
        ...current,
        status: SCENE_STATES.RUNNING,
        phase: 'RECOVERING',
        message: 'Checking durable scene checkpoints',
        error: null,
      };
    });
    if (state.status !== SCENE_STATES.RUNNING) return state;

    try {
      await this.#verifyBoundInputs(state);
      await this.#recoverAttemptCheckpoints(sceneId);
      while (true) {
        state = await this.#read(sceneId);
        if (!state || state.status !== SCENE_STATES.RUNNING || signal.aborted) return state;
        let attempt = this.#resumableAttempt(state);
        if (!attempt) {
          const cycleAttempts = state.attempts.filter((item) => item.cycle === state.cycle);
          const deterministicFramingOnlyCycle = cycleAttempts.some((item) => (
            item.normalization?.strategy === 'deterministic_bbox_crop'
            && Number.isInteger(item.normalization.source_attempt)
            && item.normalization.source_attempt < item.number
          ));
          if (deterministicFramingOnlyCycle
            || cycleAttempts.length >= state.model_route.entries.length) {
            const hadQaFailure = cycleAttempts.some((item) => item.status === 'QA_FAILED');
            const lastQaFailure = [...cycleAttempts]
              .reverse()
              .find((item) => item.status === 'QA_FAILED' && item.qa);
            return this.#mutate(sceneId, (current) => ({
              ...current,
              status: SCENE_STATES.FAILED,
              phase: hadQaFailure ? 'QA_EXHAUSTED' : 'GENERATION_EXHAUSTED',
              message: hadQaFailure
                ? 'Scene did not pass every blocking QA gate'
                : 'Scene generation failed on the fixed model route',
              error: {
                code: hadQaFailure ? 'SCENE_QA_EXHAUSTED' : 'SCENE_GENERATION_EXHAUSTED',
                message: hadQaFailure
                  ? 'Every model attempt completed, but at least one blocking scene QA gate still failed'
                  : 'Every model attempt failed before an approved scene could be produced',
              },
              qa: lastQaFailure
                ? {
                  ...lastQaFailure.qa,
                  decision: 'FAIL',
                }
                : {
                  ...(current.qa ?? {}),
                  decision: 'FAIL',
                },
            }));
          }
          attempt = await this.#newAttempt(sceneId, state);
        }

        if (attempt.status === 'GENERATING') {
          attempt = await this.#generate(sceneId, attempt, signal);
          if (!attempt || signal.aborted) continue;
        }
        if (attempt.status === 'NORMALIZATION_PENDING') {
          attempt = await this.#normalize(sceneId, attempt);
        }
        if (attempt.status === 'QA_PENDING') {
          attempt = await this.#evaluate(sceneId, attempt, signal);
        }
        if (attempt.status === 'QA_PASS') {
          return await this.#export(sceneId, attempt);
        }
        // A failed attempt advances to the next immutable route entry.
      }
    } catch (error) {
      const latest = await this.#read(sceneId);
      if (latest?.status === SCENE_STATES.CANCELLED || signal.aborted) return latest;
      const integrityFailure = error?.code === 'BOUND_INPUT_INTEGRITY_FAILED';
      const qaInfrastructureFailure = error?.code === 'QA_INFRASTRUCTURE_FAILED';
      const privacyFailure = error?.code === 'PRIVACY_GATE_FAILED';
      const identicalRepairFailure =
        error?.code === 'REPAIR_OUTPUT_IDENTICAL_TO_REJECTED_RELEASE';
      return this.#mutate(sceneId, (current) => ({
        ...current,
        status: SCENE_STATES.FAILED,
        phase: integrityFailure
          ? 'BOUND_INPUT_INTEGRITY_FAILED'
          : qaInfrastructureFailure
            ? 'QA_INFRASTRUCTURE_FAILED'
            : privacyFailure
              ? 'PRIVACY_GATE_FAILED'
              : identicalRepairFailure
                ? 'REPAIR_OUTPUT_IDENTICAL_TO_REJECTED_RELEASE'
                : 'INTERNAL_ERROR',
        message: integrityFailure
          ? 'The scene stopped because an immutable input no longer matches its receipt'
          : qaInfrastructureFailure
            ? 'The generated candidate is preserved, but the QA service did not return valid evidence'
            : privacyFailure
              ? 'The candidate was preserved privately, but its release failed the privacy gate'
              : identicalRepairFailure
                ? 'The repair was denied because it reproduced the rejected release byte-for-byte'
                : 'The scene stopped at a protected internal boundary',
        error: {
          code: integrityFailure
            ? 'BOUND_INPUT_INTEGRITY_FAILED'
            : qaInfrastructureFailure
              ? 'QA_INFRASTRUCTURE_FAILED'
              : privacyFailure
                ? 'PRIVACY_GATE_FAILED'
                : identicalRepairFailure
                  ? 'REPAIR_OUTPUT_IDENTICAL_TO_REJECTED_RELEASE'
                  : 'SCENE_INTERNAL_ERROR',
          message: errorMessage(error),
        },
        qa: { ...(current.qa ?? {}), decision: 'FAIL' },
      }));
    }
  }

  #resumableAttempt(state) {
    const attempt = state.attempts.at(-1);
    return attempt?.cycle === state.cycle && RESUMABLE_ATTEMPT_STATES.has(attempt.status)
      ? attempt
      : null;
  }

  async #newAttempt(sceneId, state) {
    const cycleAttempts = state.attempts.filter((item) => item.cycle === state.cycle);
    const cycleAttempt = cycleAttempts.length + 1;
    const route = state.model_route.entries[cycleAttempt - 1];
    if (!route) throw new Error('No model route entry remains for this scene cycle');
    const rejectionDisposition = await this.#rejectionRepairDisposition(state);
    const rejectionRecord = ['PENDING', 'ACTIVE'].includes(rejectionDisposition.status)
      ? await this.#verifiedRejectionRepairRecord(
        state,
        rejectionDisposition.record.receipt.rejection_id,
      )
      : null;
    const number = (state.attempts.at(-1)?.number ?? 0) + 1;
    const attempt = {
      number,
      cycle: state.cycle,
      cycle_attempt: cycleAttempt,
      status: 'GENERATING',
      route,
      generation_idempotency_key: sha256(
        `${sceneId}:${state.request_fingerprint}:${state.bindings.approved_items?.evidence_sha256 ?? 'no-approved-items'}:${SCENE_GENERATION_CONTRACT_VERSION}:${state.cycle}:${cycleAttempt}:${route.model_version}:generate`,
      ),
      started_at: nowIso(this.clock),
      updated_at: nowIso(this.clock),
      compiled_prompt: null,
      provider_source: null,
      candidate: null,
      provider_metadata: rejectionRecord ? {
        rejection_id: rejectionRecord.receipt.rejection_id,
        rejection_receipt_sha256: rejectionRecord.receiptHash,
        rejection_gate_id: rejectionRecord.receipt.gate.id,
        supersedes_output_sha256: rejectionRecord.receipt.rejected_release.output.sha256,
      } : {},
      normalization: null,
      qa_infrastructure_attempts: 0,
      qa: null,
      error: null,
    };
    await this.#checkpointAttempt(sceneId, attempt);
    await this.#mutate(sceneId, (current) => ({
      ...current,
      phase: 'GENERATING',
      message: `Generating scene attempt ${number} with ${route.model}`,
    }));
    return attempt;
  }

  async #newDeterministicFramingAttempt(sceneId, state, sourceAttempt) {
    const cropPlan = deterministicFramingCropPlan(
      sourceAttempt.qa?.framing_evidence,
      state.delivery,
    );
    if (!cropPlan
      || !sourceAttempt.candidate
      || !sourceAttempt.provider_source
      || !sourceAttempt.compiled_prompt
      || !sourceAttempt.qa?.reviewer) {
      throw new SceneServiceError(
        409,
        'DETERMINISTIC_FRAMING_REPAIR_UNAVAILABLE',
        'The failed scene no longer contains a complete deterministic framing receipt',
      );
    }

    const sceneDirectory = this.sceneDirectory(sceneId);
    const sourceCandidatePath = resolveInside(
      sceneDirectory,
      sourceAttempt.candidate.relative_path,
      'Deterministic framing source candidate',
    );
    const sourceProviderPath = resolveInside(
      sceneDirectory,
      sourceAttempt.provider_source.relative_path,
      'Deterministic framing provider source',
    );
    const sourcePromptPath = resolveInside(
      sceneDirectory,
      sourceAttempt.compiled_prompt.relative_path,
      'Deterministic framing source prompt',
    );
    let sourceCandidateBytes;
    let providerBytes;
    let promptBytes;
    try {
      [sourceCandidateBytes, providerBytes, promptBytes] = await Promise.all([
        readFile(sourceCandidatePath),
        readFile(sourceProviderPath),
        readFile(sourcePromptPath),
      ]);
    } catch {
      throw new SceneServiceError(
        409,
        'BOUND_INPUT_INTEGRITY_FAILED',
        'The deterministic framing source lineage is missing',
      );
    }
    if (sha256(sourceCandidateBytes) !== sourceAttempt.candidate.sha256
      || sha256(providerBytes) !== sourceAttempt.provider_source.sha256
      || sha256(promptBytes) !== sourceAttempt.compiled_prompt.sha256) {
      throw new SceneServiceError(
        409,
        'BOUND_INPUT_INTEGRITY_FAILED',
        'The deterministic framing source no longer matches its immutable lineage',
      );
    }

    const number = (state.attempts.at(-1)?.number ?? 0) + 1;
    const repaired = await deterministicFramingCrop(
      sourceCandidateBytes,
      cropPlan,
      state.delivery,
    );
    const repairedPath = path.join(
      this.attemptDirectory(sceneId, number),
      'candidate-framing-repair.png',
    );
    await writeImmutable(repairedPath, repaired);
    const now = nowIso(this.clock);
    return {
      number,
      cycle: state.cycle + 1,
      cycle_attempt: sourceAttempt.cycle_attempt,
      status: 'QA_PENDING',
      route: structuredClone(sourceAttempt.route),
      generation_idempotency_key: sourceAttempt.generation_idempotency_key,
      started_at: now,
      updated_at: now,
      compiled_prompt: structuredClone(sourceAttempt.compiled_prompt),
      provider_source: structuredClone(sourceAttempt.provider_source),
      candidate: {
        relative_path: path.relative(sceneDirectory, repairedPath),
        sha256: sha256(repaired),
        size: repaired.length,
        media_type: 'image/png',
        width: state.delivery.width,
        height: state.delivery.height,
      },
      provider_metadata: structuredClone(sourceAttempt.provider_metadata),
      normalization: {
        source_width: sourceAttempt.candidate.width,
        source_height: sourceAttempt.candidate.height,
        target_width: state.delivery.width,
        target_height: state.delivery.height,
        strategy: 'deterministic_bbox_crop',
        color_space: 'srgb',
        exact_aspect_ratio: '4:5',
        source_attempt: sourceAttempt.number,
        source_candidate_sha256: sourceAttempt.candidate.sha256,
        crop_xywh_px: [
          cropPlan.left,
          cropPlan.top,
          cropPlan.width,
          cropPlan.height,
        ],
        target_subject_height_percent: cropPlan.target_subject_height_percent,
        output_scale: cropPlan.output_scale,
        trigger_framing_evidence: structuredClone(sourceAttempt.qa.framing_evidence),
        trigger_reviewer: structuredClone(sourceAttempt.qa.reviewer),
      },
      qa_infrastructure_attempts: 0,
      qa: null,
      error: null,
    };
  }

  attemptDirectory(sceneId, number) {
    return path.join(this.sceneDirectory(sceneId), 'attempts', String(number).padStart(3, '0'));
  }

  async #checkpointAttempt(sceneId, attempt) {
    attempt.updated_at = nowIso(this.clock);
    const attemptPath = path.join(this.attemptDirectory(sceneId, attempt.number), 'attempt.json');
    await atomicWrite(attemptPath, Buffer.from(`${JSON.stringify(attempt, null, 2)}\n`));
    await this.#mutate(sceneId, (state) => {
      if (state.status === SCENE_STATES.CANCELLED) return NO_CHANGE;
      const attempts = state.attempts.filter((item) => item.number !== attempt.number);
      attempts.push(attempt);
      attempts.sort((left, right) => left.number - right.number);
      return { ...state, attempts };
    });
    return attempt;
  }

  async #recoverAttemptCheckpoints(sceneId) {
    const attemptsDirectory = path.join(this.sceneDirectory(sceneId), 'attempts');
    let entries;
    try {
      entries = await readdir(attemptsDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const recovered = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d{3,6}$/.test(entry.name)) continue;
      try {
        const attempt = JSON.parse(await readFile(path.join(attemptsDirectory, entry.name, 'attempt.json'), 'utf8'));
        if (attempt.number !== Number(entry.name)) continue;
        recovered.push(attempt);
      } catch {
        // A malformed checkpoint cannot override the atomic job state.
      }
    }
    if (recovered.length) {
      recovered.sort((left, right) => left.number - right.number);
      await this.#mutate(sceneId, (state) => {
        const byNumber = new Map(state.attempts.map((item) => [item.number, item]));
        for (const item of recovered) byNumber.set(item.number, item);
        return {
          ...state,
          attempts: [...byNumber.values()].sort((left, right) => left.number - right.number),
        };
      });
    }

    const state = await this.#read(sceneId);
    let attempt = state?.attempts.at(-1);
    if (!attempt || attempt.cycle !== state.cycle) return;
    const directory = this.attemptDirectory(sceneId, attempt.number);
    const providerPath = path.join(directory, 'provider-output.bin');
    if (attempt.status === 'GENERATING' && await exists(providerPath)) {
      const bytes = await readFile(providerPath);
      attempt = {
        ...attempt,
        status: 'NORMALIZATION_PENDING',
        provider_source: {
          relative_path: path.relative(this.sceneDirectory(sceneId), providerPath),
          sha256: sha256(bytes),
          size: bytes.length,
          media_type: 'application/octet-stream',
        },
        provider_metadata: {
          ...attempt.provider_metadata,
          recovered_from_atomic_artifact: true,
        },
      };
      await this.#checkpointAttempt(sceneId, attempt);
    }
  }

  async #generate(sceneId, attempt, signal) {
    const state = await this.#read(sceneId);
    const directory = this.sceneDirectory(sceneId);
    let bound = await this.#verifyBoundInputs(state);
    let rejectionRecord = attempt.provider_metadata.rejection_id
      ? await this.#verifiedRejectionRepairRecord(
        state,
        attempt.provider_metadata.rejection_id,
      )
      : null;
    if (rejectionRecord
      && (
        attempt.provider_metadata.rejection_receipt_sha256 !== rejectionRecord.receiptHash
        || attempt.provider_metadata.rejection_gate_id !== rejectionRecord.receipt.gate.id
        || attempt.provider_metadata.supersedes_output_sha256
          !== rejectionRecord.receipt.rejected_release.output.sha256
      )) {
      throw new SceneServiceError(
        409,
        'BOUND_INPUT_INTEGRITY_FAILED',
        'Post-release repair attempt no longer matches its rejection receipt',
      );
    }
    const repairAttempt = rejectionRecord?.repairAttempt
      ?? selectRepairAttempt(state, attempt);
    const repairCandidate = await verifiedRepairCandidate(
      directory,
      state,
      repairAttempt,
    );
    const compositionGuide = repairCandidate
      ? await mechanicalFramingGuide(directory, state, repairAttempt, repairCandidate)
      : await initialComposedMasterGuide(directory, state, attempt.number, {
        path: bound.approvedLookPath,
        sha256: state.bindings.approved_look.image_sha256,
      }, attempt.route.job_set_type === 'gpt_image_2' ? '3:4' : '4:5');
    const prompt = compiledPrompt({
      basePrompt: bound.prompt,
      state,
      attempt,
      preset: bound.preset,
      approvedItems: bound.approvedItems,
      repairAttempt,
    });
    const promptBytes = Buffer.from(prompt);
    const promptRelativePath = `attempts/${String(attempt.number).padStart(3, '0')}/compiled-prompt.txt`;
    await writeImmutable(path.join(directory, promptRelativePath), promptBytes);
    attempt = {
      ...attempt,
      compiled_prompt: {
        relative_path: promptRelativePath,
        sha256: sha256(promptBytes),
      },
    };
    await this.#checkpointAttempt(sceneId, attempt);
    if (signal.aborted) return null;

    let generated;
    try {
      generated = await this.generator.generateScene({
        scene_id: sceneId,
        attempt: attempt.number,
        cycle: attempt.cycle,
        cycle_attempt: attempt.cycle_attempt,
        model: attempt.route.model,
        model_version: attempt.route.model_version,
        job_set_type: attempt.route.job_set_type,
        quality: attempt.route.quality,
        route_hash: state.model_route.sha256,
        idempotency_key: attempt.generation_idempotency_key,
        aspect_ratio: '4:5',
        width: state.delivery.width,
        height: state.delivery.height,
        prompt,
        prompt_sha256: attempt.compiled_prompt.sha256,
        approved_look: {
          path: bound.approvedLookPath,
          sha256: state.bindings.approved_look.image_sha256,
          media_type: state.bindings.approved_look.media_type,
          role: 'look_master',
        },
        preset: {
          path: bound.presetPath,
          sha256: state.bindings.preset.sha256,
          preset_id: state.bindings.preset.preset_id,
          version: state.bindings.preset.version,
        },
        reference_pack: {
          path: bound.referencePackPath,
          sha256: state.bindings.reference_pack.sha256,
          reference_pack_id: state.bindings.reference_pack.reference_pack_id,
          version: state.bindings.reference_pack.version,
        },
        references: bound.references,
        item_evidence: bound.approvedItems,
        shot_anchors: bound.shotAnchors,
        repair_candidate: repairCandidate,
        composition_guide: compositionGuide,
        work_directory: this.attemptDirectory(sceneId, attempt.number),
        signal,
      });
      if (signal.aborted) return null;
      bound = await this.#verifyBoundInputs(await this.#read(sceneId));
      if (rejectionRecord) {
        rejectionRecord = await this.#verifiedRejectionRepairRecord(
          await this.#read(sceneId),
          rejectionRecord.receipt.rejection_id,
        );
      }
      const bytes = await binaryFrom(generated?.image, 'Generated scene image');
      if (bytes.length === 0) throw new Error('Generator returned an empty scene image');
      const sourcePath = path.join(this.attemptDirectory(sceneId, attempt.number), 'provider-output.bin');
      await writeImmutable(sourcePath, bytes);
      attempt = {
        ...attempt,
        status: 'NORMALIZATION_PENDING',
        provider_source: {
          relative_path: path.relative(directory, sourcePath),
          sha256: sha256(bytes),
          size: bytes.length,
          media_type: generated.media_type ?? 'application/octet-stream',
        },
        provider_metadata: {
          ...attempt.provider_metadata,
          ...safeProviderMetadata(generated.metadata),
          ...(repairCandidate ? {
            repair_candidate_sha256: repairCandidate.sha256,
            repair_from_attempt: repairCandidate.attempt,
          } : {}),
        },
        error: null,
      };
    } catch (error) {
      if (signal.aborted) return null;
      if (error?.code === 'BOUND_INPUT_INTEGRITY_FAILED') throw error;
      attempt = {
        ...attempt,
        status: 'GENERATION_FAILED',
        error: { code: 'GENERATION_FAILED', message: errorMessage(error) },
      };
    }
    await this.#checkpointAttempt(sceneId, attempt);
    return attempt;
  }

  async #normalize(sceneId, attempt) {
    const state = await this.#read(sceneId);
    const directory = this.sceneDirectory(sceneId);
    const sourcePath = resolveInside(directory, attempt.provider_source.relative_path, 'Provider scene output');
    const sourceBytes = await readFile(sourcePath);
    if (sha256(sourceBytes) !== attempt.provider_source.sha256) {
      attempt = {
        ...attempt,
        status: 'GENERATION_FAILED',
        error: { code: 'SOURCE_INTEGRITY_FAILED', message: 'Provider output no longer matches its atomic checkpoint' },
      };
      await this.#checkpointAttempt(sceneId, attempt);
      return attempt;
    }
    let sourceMetadata;
    let normalized;
    try {
      sourceMetadata = await sharp(sourceBytes).metadata();
      if (!sourceMetadata.width || !sourceMetadata.height || (sourceMetadata.pages ?? 1) !== 1) {
        throw new Error('Provider scene output must be one still image');
      }
      if (sourceMetadata.width * 5 !== sourceMetadata.height * 4) {
        throw new Error('Provider scene output must already preserve the requested 4:5 framing');
      }
      normalized = await sharp(sourceBytes)
        .rotate()
        .toColourspace('srgb')
        .resize({
          width: state.delivery.width,
          height: state.delivery.height,
          fit: 'fill',
        })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
    } catch (error) {
      attempt = {
        ...attempt,
        status: 'GENERATION_FAILED',
        error: { code: 'NORMALIZATION_FAILED', message: errorMessage(error) },
      };
      await this.#checkpointAttempt(sceneId, attempt);
      return attempt;
    }
    const candidatePath = path.join(this.attemptDirectory(sceneId, attempt.number), 'candidate.png');
    await writeImmutable(candidatePath, normalized);
    const candidateHash = sha256(normalized);
    const providerRequestId = attempt.provider_metadata.provider_request_id
      ?? attempt.provider_metadata.request_id
      ?? attempt.provider_metadata.job_id;
    const observedProviderMetadata = {
      ...attempt.provider_metadata,
      ...(providerRequestId ? {
        provider_request_id: attempt.provider_metadata.provider_request_id ?? providerRequestId,
        request_id: attempt.provider_metadata.request_id ?? attempt.generation_idempotency_key,
        job_id: attempt.provider_metadata.job_id ?? providerRequestId,
      } : {}),
      model: attempt.provider_metadata.model ?? attempt.route.model,
      model_version: attempt.provider_metadata.model_version ?? attempt.route.model_version,
      job_set_type: attempt.provider_metadata.job_set_type ?? attempt.route.job_set_type,
      quality: attempt.provider_metadata.quality ?? attempt.route.quality,
      source_width: attempt.provider_metadata.source_width ?? sourceMetadata.width,
      source_height: attempt.provider_metadata.source_height ?? sourceMetadata.height,
      source_aspect_ratio: attempt.provider_metadata.source_aspect_ratio
        ?? reducedAspectRatio(sourceMetadata.width, sourceMetadata.height),
      raw_output_sha256: attempt.provider_metadata.raw_output_sha256 ?? attempt.provider_source.sha256,
      geometry_output_sha256: attempt.provider_metadata.geometry_output_sha256 ?? attempt.provider_source.sha256,
      transport_aspect_ratio: attempt.provider_metadata.transport_aspect_ratio
        ?? '4:5',
      geometry_strategy: attempt.provider_metadata.geometry_strategy ?? 'provider_exact_4_5',
    };
    if (attempt.provider_metadata.rejection_id
      && candidateHash === attempt.provider_metadata.supersedes_output_sha256) {
      attempt = {
        ...attempt,
        status: 'GENERATION_FAILED',
        candidate: {
          relative_path: path.relative(directory, candidatePath),
          sha256: candidateHash,
          size: normalized.length,
          media_type: 'image/png',
          width: state.delivery.width,
          height: state.delivery.height,
        },
        normalization: {
          source_width: sourceMetadata.width,
          source_height: sourceMetadata.height,
          target_width: state.delivery.width,
          target_height: state.delivery.height,
          strategy: 'same_aspect_lossless_resize',
          color_space: 'srgb',
          exact_aspect_ratio: '4:5',
        },
        provider_metadata: observedProviderMetadata,
        error: {
          code: 'REPAIR_OUTPUT_IDENTICAL_TO_REJECTED_RELEASE',
          message: 'Repair candidate is byte-identical to the quarantined rejected release',
        },
      };
      await this.#checkpointAttempt(sceneId, attempt);
      return attempt;
    }
    attempt = {
      ...attempt,
      status: 'QA_PENDING',
      candidate: {
        relative_path: path.relative(directory, candidatePath),
        sha256: candidateHash,
        size: normalized.length,
        media_type: 'image/png',
        width: state.delivery.width,
        height: state.delivery.height,
      },
      normalization: {
        source_width: sourceMetadata.width,
        source_height: sourceMetadata.height,
        target_width: state.delivery.width,
        target_height: state.delivery.height,
        strategy: 'same_aspect_lossless_resize',
        color_space: 'srgb',
        exact_aspect_ratio: '4:5',
      },
      provider_metadata: observedProviderMetadata,
      error: null,
    };
    await this.#checkpointAttempt(sceneId, attempt);
    await this.#mutate(sceneId, (current) => ({
      ...(current.status === SCENE_STATES.RUNNING ? {
        ...current,
        phase: 'QA',
        message: `Checking all nine blocking scene gates for attempt ${attempt.number}`,
      } : current),
    }));
    return attempt;
  }

  async #evaluate(sceneId, attempt, signal) {
    const state = await this.#read(sceneId);
    const directory = this.sceneDirectory(sceneId);
    let bound = await this.#verifyBoundInputs(state);
    let normalized;
    try {
      const result = await this.evaluator.evaluateScene({
        scene_id: sceneId,
        attempt: attempt.number,
        candidate: {
          path: path.join(directory, attempt.candidate.relative_path),
          sha256: attempt.candidate.sha256,
          width: attempt.candidate.width,
          height: attempt.candidate.height,
        },
        approved_look: {
          path: bound.approvedLookPath,
          sha256: state.bindings.approved_look.image_sha256,
          receipt_path: bound.receiptPath,
          receipt_sha256: state.bindings.approved_look.receipt_sha256,
        },
        preset: {
          path: bound.presetPath,
          sha256: state.bindings.preset.sha256,
          preset_id: state.bindings.preset.preset_id,
          version: state.bindings.preset.version,
        },
        reference_pack: {
          path: bound.referencePackPath,
          sha256: state.bindings.reference_pack.sha256,
        },
        references: bound.references,
        item_evidence: bound.approvedItems,
        required_gates: SCENE_EVALUATOR_GATES,
        delivery: state.delivery,
        signal,
      });
      if (signal.aborted) return attempt;
      bound = await this.#verifyBoundInputs(await this.#read(sceneId));
      normalized = sanitizeEvaluation(normalizeEvaluatorResult(result));
      assertItemFidelityEvidenceMatches(
        sceneQaItemScope(bound.approvedItems, bound.preset),
        normalized,
      );
      // This is the assessment that actually decides a live shot. It used to read the
      // bands off bound.preset.camera by hand, which is why waiving headroom on the
      // three lock-driven call sites in scene-contract.js changed nothing here and an
      // editorial hero kept failing on 3.75% of clear space with its head observed
      // whole. The preset goes in, the lock owner answers.
      const framingAssessment = assessSceneFraming(normalized.framing_evidence, {
        preset: bound.preset,
        width: state.delivery.width,
        height: state.delivery.height,
      });
      normalized.framing_evidence = framingAssessment.evidence;
      if (framingAssessment.defects.length) {
        const framingGate = normalized.gates.find((gate) => gate.id === 'FRAMING_AND_ANATOMY');
        framingGate.decision = 'FAIL';
        framingGate.defects = [...new Set([...framingGate.defects, ...framingAssessment.defects])];
        framingGate.evidence = sanitizeOutboundString([
          framingGate.evidence,
          `Measured subject height ${framingAssessment.evidence.subject_height_percent}%`,
          `clear space ${framingAssessment.evidence.clear_space_above_hair_percent}% above`,
          `${framingAssessment.evidence.clear_space_below_footwear_percent}% below`,
        ].join('; '));
        if (normalized.score !== null) normalized.score = Math.min(normalized.score, 99);
        normalized.summary = sanitizeOutboundString([
          normalized.summary,
          `Deterministic framing lock failed: ${framingAssessment.defects.join(', ')}`,
        ].filter(Boolean).join('; '));
      }
    } catch (error) {
      if (signal.aborted) return attempt;
      if (error?.code === 'BOUND_INPUT_INTEGRITY_FAILED') throw error;
      const qaInfrastructureAttempts = (attempt.qa_infrastructure_attempts ?? 0) + 1;
      attempt = {
        ...attempt,
        status: 'QA_PENDING',
        qa_infrastructure_attempts: qaInfrastructureAttempts,
        error: { code: 'EVALUATOR_CONTRACT_FAILED', message: errorMessage(error) },
      };
      await this.#checkpointAttempt(sceneId, attempt);
      if (qaInfrastructureAttempts >= this.qaMaxAttempts) {
        throw new SceneServiceError(
          503,
          'QA_INFRASTRUCTURE_FAILED',
          `Scene QA infrastructure failed ${qaInfrastructureAttempts} times without invalidating the generated candidate`,
        );
      }
      return attempt;
    }
    const failedVisualGates = normalized.gates.filter((gate) => gate.decision === 'FAIL');
    const cropEligible = attempt.normalization?.strategy === 'same_aspect_lossless_resize'
      && failedVisualGates.length === 1
      && failedVisualGates[0].id === 'FRAMING_AND_ANATOMY';
    const cropPlan = cropEligible
      ? deterministicFramingCropPlan(normalized.framing_evidence, state.delivery)
      : null;
    if (cropPlan) {
      const sourceCandidate = attempt.candidate;
      const sourcePath = resolveInside(
        directory,
        sourceCandidate.relative_path,
        'Undersized scene candidate',
      );
      const sourceBytes = await readFile(sourcePath);
      if (sha256(sourceBytes) !== sourceCandidate.sha256) {
        const error = new Error('The undersized scene candidate no longer matches its immutable SHA-256');
        error.code = 'BOUND_INPUT_INTEGRITY_FAILED';
        throw error;
      }
      const reframed = await deterministicFramingCrop(sourceBytes, cropPlan, state.delivery);
      const repairedPath = path.join(
        this.attemptDirectory(sceneId, attempt.number),
        'candidate-framing-repair.png',
      );
      await writeImmutable(repairedPath, reframed);
      attempt = {
        ...attempt,
        status: 'QA_PENDING',
        candidate: {
          relative_path: path.relative(directory, repairedPath),
          sha256: sha256(reframed),
          size: reframed.length,
          media_type: 'image/png',
          width: state.delivery.width,
          height: state.delivery.height,
        },
        normalization: {
          source_width: sourceCandidate.width,
          source_height: sourceCandidate.height,
          target_width: state.delivery.width,
          target_height: state.delivery.height,
          strategy: 'deterministic_bbox_crop',
          color_space: 'srgb',
          exact_aspect_ratio: '4:5',
          source_attempt: attempt.number,
          source_candidate_sha256: sourceCandidate.sha256,
          crop_xywh_px: [
            cropPlan.left,
            cropPlan.top,
            cropPlan.width,
            cropPlan.height,
          ],
          target_subject_height_percent: cropPlan.target_subject_height_percent,
          output_scale: cropPlan.output_scale,
          trigger_framing_evidence: normalized.framing_evidence,
          trigger_reviewer: normalized.reviewer,
        },
        qa: null,
        error: null,
      };
      await this.#checkpointAttempt(sceneId, attempt);
      await this.#mutate(sceneId, (current) => ({
        ...current,
        phase: 'QA',
        message: `Rechecking deterministic framing repair for attempt ${attempt.number}`,
      }));
      return attempt;
    }
    const preflight = createPreflightGates(
      state.bindings.approved_look.image_sha256,
      state.bindings.reference_pack.sha256,
      state.bindings.approved_items?.evidence_sha256 ?? null,
    );
    const visualPass = normalized.gates.every((gate) => gate.decision === 'PASS');
    attempt = {
      ...attempt,
      status: visualPass ? 'QA_PASS' : 'QA_FAILED',
      qa: {
        decision: visualPass ? 'PASS' : 'FAIL',
        gates: [...preflight, ...normalized.gates],
        score: normalized.score,
        summary: normalized.summary,
        reviewer: normalized.reviewer,
        framing_evidence: normalized.framing_evidence,
        ...(normalized.item_fidelity_evidence ? {
          item_fidelity_evidence: normalized.item_fidelity_evidence,
        } : {}),
      },
      error: visualPass ? null : {
        code: 'BLOCKING_QA_FAILED',
        message: [
          normalized.gates
            .filter((gate) => gate.decision === 'FAIL')
            .map((gate) => gate.id)
            .join(', '),
          // The attempt that was eligible for a free crop and did not get one is the only
          // place this can be said. The attempt schema is exact-keyed, so the receipt has
          // exactly one free-form field left, and leaving the refusal unsaid is how three
          // identical failures looked like a repair that was never wired up.
          ...(cropEligible && !cropPlan
            ? [deterministicFramingCropRefusal(normalized.framing_evidence, state.delivery)]
            : []),
        ].filter(Boolean).join(' — '),
      },
    };
    await this.#checkpointAttempt(sceneId, attempt);
    return attempt;
  }

  async #verifyReleaseLineage(sceneId, state, attempt, outputHash) {
    const directory = this.sceneDirectory(sceneId);
    const providerPath = resolveInside(
      directory,
      attempt.provider_source.relative_path,
      'Approved scene provider source',
    );
    let providerBytes;
    try {
      providerBytes = await readFile(providerPath);
    } catch {
      const error = new Error('Approved scene provider source is missing');
      error.code = 'BOUND_INPUT_INTEGRITY_FAILED';
      throw error;
    }
    if (sha256(providerBytes) !== attempt.provider_source.sha256) {
      const error = new Error('Approved scene provider source no longer matches its immutable receipt');
      error.code = 'BOUND_INPUT_INTEGRITY_FAILED';
      throw error;
    }
    if (attempt.normalization?.strategy !== 'deterministic_bbox_crop') return;

    const sourceAttemptNumber = attempt.normalization.source_attempt;
    const sourceAttempt = sourceAttemptNumber < attempt.number
      ? state.attempts.find((item) => item.number === sourceAttemptNumber)
      : attempt;
    const sourceRelativePath = sourceAttemptNumber < attempt.number
      ? sourceAttempt?.candidate?.relative_path
      : `attempts/${String(attempt.number).padStart(3, '0')}/candidate.png`;
    if (!sourceAttempt || !sourceRelativePath) {
      const error = new Error('Deterministic framing source attempt is missing');
      error.code = 'BOUND_INPUT_INTEGRITY_FAILED';
      throw error;
    }
    const sourcePath = resolveInside(
      directory,
      sourceRelativePath,
      'Deterministic framing release source',
    );
    let sourceBytes;
    try {
      sourceBytes = await readFile(sourcePath);
    } catch {
      const error = new Error('Deterministic framing release source is missing');
      error.code = 'BOUND_INPUT_INTEGRITY_FAILED';
      throw error;
    }
    const cropPlan = deterministicFramingCropPlan(
      attempt.normalization.trigger_framing_evidence,
      state.delivery,
    );
    const expectedCrop = cropPlan
      ? [cropPlan.left, cropPlan.top, cropPlan.width, cropPlan.height]
      : null;
    const receiptValid = sha256(sourceBytes) === attempt.normalization.source_candidate_sha256
      && cropPlan
      && sha256(canonicalJsonBytes(expectedCrop))
        === sha256(canonicalJsonBytes(attempt.normalization.crop_xywh_px))
      && cropPlan.target_subject_height_percent
        === attempt.normalization.target_subject_height_percent
      && cropPlan.output_scale === attempt.normalization.output_scale;
    if (!receiptValid) {
      const error = new Error('Deterministic framing crop no longer matches its immutable source receipt');
      error.code = 'BOUND_INPUT_INTEGRITY_FAILED';
      throw error;
    }
    const recomputed = await deterministicFramingCrop(sourceBytes, cropPlan, state.delivery);
    if (sha256(recomputed) !== outputHash) {
      const error = new Error('Approved scene is not the declared deterministic framing transform');
      error.code = 'BOUND_INPUT_INTEGRITY_FAILED';
      throw error;
    }
  }

  async #export(sceneId, attempt) {
    let state = await this.#read(sceneId);
    if (state.status !== SCENE_STATES.RUNNING) return state;
    await this.#verifyBoundInputs(state);
    const rejectionRecord = attempt.provider_metadata.rejection_id
      ? await this.#verifiedRejectionRepairRecord(
        state,
        attempt.provider_metadata.rejection_id,
      )
      : null;
    state = await this.#mutate(sceneId, (current) => {
      if (current.status !== SCENE_STATES.RUNNING) return NO_CHANGE;
      return {
        ...current,
        phase: 'EXPORTING',
        message: 'Writing the hash-bound approved scene release',
      };
    });
    if (state.status !== SCENE_STATES.RUNNING) return state;
    const directory = this.sceneDirectory(sceneId);
    const candidatePath = resolveInside(directory, attempt.candidate.relative_path, 'Approved scene candidate');
    const candidateBytes = await readFile(candidatePath);
    const outputHash = sha256(candidateBytes);
    if (outputHash !== attempt.candidate.sha256) {
      throw new Error('Approved scene candidate no longer matches its QA receipt');
    }
    if (rejectionRecord
      && outputHash === rejectionRecord.receipt.rejected_release.output.sha256) {
      throw new SceneServiceError(
        409,
        'REPAIR_OUTPUT_IDENTICAL_TO_REJECTED_RELEASE',
        'A post-release repair cannot approve byte-identical rejected output',
      );
    }
    await this.#verifyReleaseLineage(sceneId, state, attempt, outputHash);
    const promptPath = resolveInside(directory, attempt.compiled_prompt.relative_path, 'Compiled scene prompt');
    const promptBytes = await readFile(promptPath);
    const promptHash = sha256(promptBytes);
    if (promptHash !== attempt.compiled_prompt.sha256) {
      throw new Error('Approved scene prompt no longer matches its generation receipt');
    }
    const finalProvenanceGate = provenanceGate({
      state,
      attempt,
      outputHash,
      promptHash,
      rejectionRecord,
    });
    const gates = [
      ...attempt.qa.gates,
      finalProvenanceGate,
    ];
    if (!allGatesPass(gates)) {
      throw new Error('Scene cannot be exported without nine ordered PASS gates');
    }

    const approvedAt = attempt.updated_at;
    const manifestBase = {
      schema_version: SCENE_SCHEMA_VERSION,
      receipt_type: 'APPROVED_SCENE',
      scene_id: sceneId,
      state: 'COMPLETED',
      approved_look: {
        look_id: state.bindings.approved_look.look_id,
        sha256: state.bindings.approved_look.image_sha256,
        receipt_sha256: state.bindings.approved_look.receipt_sha256,
      },
      ...(state.bindings.approved_items ? {
        approved_items: approvedItemsReceipt(state.bindings.approved_items),
      } : {}),
      preset: {
        preset_id: state.bindings.preset.preset_id,
        version: state.bindings.preset.version,
        sha256: state.bindings.preset.sha256,
      },
      reference_pack: {
        reference_pack_id: state.bindings.reference_pack.reference_pack_id,
        version: state.bindings.reference_pack.version,
        sha256: state.bindings.reference_pack.sha256,
        source_ledger: state.bindings.reference_pack.source_ledger,
        references: state.bindings.reference_pack.references.map((item) => ({
          reference_id: item.reference_id,
          role: item.role,
          sha256: item.sha256,
          media_type: item.media_type,
          not_authority_for: item.not_authority_for,
        })),
      },
      generation: {
        attempt: attempt.number,
        cycle: attempt.cycle,
        route_hash: state.model_route.sha256,
        model: attempt.route.model,
        model_version: attempt.route.model_version,
        job_set_type: attempt.route.job_set_type,
        quality: attempt.route.quality,
        generation_idempotency_key: attempt.generation_idempotency_key,
        provider_source_sha256: attempt.provider_source.sha256,
        provider_metadata: attempt.provider_metadata,
        normalization: attempt.normalization,
      },
      attempt_history: state.attempts.map((item) => ({
        attempt: item.number,
        cycle: item.cycle,
        cycle_attempt: item.cycle_attempt,
        status: item.status,
        model: item.route.model,
        model_version: item.route.model_version,
        job_set_type: item.route.job_set_type,
        quality: item.route.quality,
        generation_idempotency_key: item.generation_idempotency_key,
        prompt_sha256: item.compiled_prompt?.sha256 ?? null,
        provider_source_sha256: item.provider_source?.sha256 ?? null,
        candidate_sha256: item.candidate?.sha256 ?? null,
        qa: item.qa ? {
          decision: item.qa.decision,
          gates: item.qa.gates,
          score: item.qa.score,
          summary: item.qa.summary,
          reviewer: item.qa.reviewer ?? null,
          framing_evidence: item.qa.framing_evidence ?? null,
          ...(item.qa.item_fidelity_evidence ? {
            item_fidelity_evidence: item.qa.item_fidelity_evidence,
          } : {}),
        } : null,
        error: item.error,
      })),
      prompt: {
        sha256: promptHash,
        exact_text: promptBytes.toString('utf8'),
      },
      delivery: state.delivery,
      output: {
        filename: 'scene.png',
        sha256: outputHash,
        size: candidateBytes.length,
        media_type: 'image/png',
        width: state.delivery.width,
        height: state.delivery.height,
      },
      qa: {
        decision: 'PASS',
        gates,
        score: attempt.qa.score,
        summary: attempt.qa.summary,
        reviewer: attempt.qa.reviewer,
        framing_evidence: attempt.qa.framing_evidence,
        ...(attempt.qa.item_fidelity_evidence ? {
          item_fidelity_evidence: attempt.qa.item_fidelity_evidence,
        } : {}),
      },
      approval: {
        decision: 'PASS',
        authority: 'NINE_BLOCKING_GATES',
        approved_at: approvedAt,
      },
      ...(rejectionRecord ? {
        supersedes: {
          rejection_id: rejectionRecord.receipt.rejection_id,
          rejection_receipt_sha256: rejectionRecord.receiptHash,
          rejected_output_sha256: rejectionRecord.receipt.rejected_release.output.sha256,
          rejected_manifest_sha256:
            rejectionRecord.receipt.rejected_release.output.manifest_sha256,
          source_attempt: rejectionRecord.receipt.repair_source.source_attempt,
          repaired_by_attempt: attempt.number,
        },
      } : {}),
      created_at: state.created_at,
      approved_at: approvedAt,
    };

    const evidenceManifest = {
      schema_version: SCENE_SCHEMA_VERSION,
      evidence_type: 'PRODUCTION_SCENE_RELEASE_EVIDENCE',
      scene_id: sceneId,
      output_sha256: outputHash,
      approved_look_sha256: state.bindings.approved_look.image_sha256,
      approved_look_receipt_sha256: state.bindings.approved_look.receipt_sha256,
      ...(state.bindings.approved_items ? {
        approved_items: approvedItemsReceipt(state.bindings.approved_items),
      } : {}),
      preset_sha256: state.bindings.preset.sha256,
      reference_pack_sha256: state.bindings.reference_pack.sha256,
      source_ledger_sha256: sha256(canonicalJsonBytes(state.bindings.reference_pack.source_ledger)),
      prompt_sha256: promptHash,
      route_sha256: state.model_route.sha256,
      provider_source_sha256: attempt.provider_source.sha256,
      provider_metadata: attempt.provider_metadata,
      normalization: attempt.normalization,
      evaluator: attempt.qa.reviewer,
      framing_evidence: attempt.qa.framing_evidence,
      ...(attempt.qa.item_fidelity_evidence ? {
        item_fidelity_evidence: attempt.qa.item_fidelity_evidence,
      } : {}),
      gate_results: gates,
      ...(rejectionRecord ? {
        supersedes: {
          rejection_id: rejectionRecord.receipt.rejection_id,
          rejection_receipt_sha256: rejectionRecord.receiptHash,
          rejected_output_sha256: rejectionRecord.receipt.rejected_release.output.sha256,
          repair_source_sha256: rejectionRecord.receipt.repair_source.sha256,
        },
      } : {}),
      created_at: approvedAt,
    };
    const evidenceManifestBytes = canonicalJsonBytes(evidenceManifest);
    const evidenceManifestHash = sha256(evidenceManifestBytes);
    const qaReceipt = {
      schema_version: SCENE_SCHEMA_VERSION,
      receipt_id: `scene.qa.${sceneId}`,
      revision: 1,
      qa_profile: 'PRODUCTION_SCENE',
      evidence_subject_sha256: evidenceManifestHash,
      reviewer: {
        type: attempt.qa.reviewer.type,
        id: attempt.qa.reviewer.id,
        version: attempt.qa.reviewer.version,
      },
      verdict: 'PASS',
      asset_results: [
        {
          asset_id: `scene.asset.${sceneId}`,
          preset_id: state.bindings.preset.preset_id,
          sha256: outputHash,
          status: 'PASS',
          framing_evidence: attempt.qa.framing_evidence,
          gate_results: gates.map((gate) => ({
            id: gate.id,
            status: gate.decision,
            evidence: gate.evidence,
          })),
          named_defects: [],
        },
      ],
      completed_at: approvedAt,
    };
    const qaReceiptBytes = canonicalJsonBytes(qaReceipt);
    const qaReceiptHash = sha256(qaReceiptBytes);

    const privacyFindings = [
      ...privacyFindingsForText(evidenceManifestBytes.toString('utf8'), 'outputs/scene-evidence-manifest.json'),
      ...privacyFindingsForText(qaReceiptBytes.toString('utf8'), 'outputs/scene-qa-receipt.json'),
      ...await imageMetadataPrivacyFindings(candidateBytes, 'outputs/scene.png'),
    ];
    const privacyReport = {
      schema_version: SCENE_SCHEMA_VERSION,
      status: privacyFindings.length === 0 ? 'PASS' : 'FAIL',
      scope: [
        'outputs/scene.png',
        'outputs/scene-evidence-manifest.json',
        'outputs/scene-qa-receipt.json',
      ],
      excluded_paths: ['attempts/**', 'inputs/**'],
      checked_rules: [...SCENE_PRIVACY_RULES],
      checked_files: [
        {
          path: 'outputs/scene.png',
          sha256: outputHash,
          inspection: 'IMAGE_METADATA',
        },
        {
          path: 'outputs/scene-evidence-manifest.json',
          sha256: evidenceManifestHash,
          inspection: 'TEXT',
        },
        {
          path: 'outputs/scene-qa-receipt.json',
          sha256: qaReceiptHash,
          inspection: 'TEXT',
        },
      ],
      findings: privacyFindings,
      completed_at: approvedAt,
    };
    const privacyReportBytes = canonicalJsonBytes(privacyReport);
    const privacyReportHash = sha256(privacyReportBytes);
    if (privacyFindings.length > 0) {
      const quarantinePath = path.join(
        directory,
        'quarantine',
        `privacy-report-${attempt.number}-${randomUUID()}.json`,
      );
      await writeImmutable(quarantinePath, privacyReportBytes);
      throw new SceneServiceError(
        409,
        'PRIVACY_GATE_FAILED',
        'Scene release was blocked because its textual or image metadata exposed private material',
      );
    }

    const manifest = {
      ...manifestBase,
      evidence_manifest: {
        filename: 'scene-evidence-manifest.json',
        sha256: evidenceManifestHash,
      },
      qa_receipt: {
        filename: 'scene-qa-receipt.json',
        sha256: qaReceiptHash,
        evidence_subject_sha256: evidenceManifestHash,
      },
      privacy_report: {
        filename: 'scene-privacy-report.json',
        sha256: privacyReportHash,
        status: 'PASS',
      },
    };
    const manifestBytes = canonicalJsonBytes(manifest);
    const finalManifestFindings = privacyFindingsForText(
      manifestBytes.toString('utf8'),
      'outputs/scene-manifest.json',
    );
    if (finalManifestFindings.length > 0) {
      throw new SceneServiceError(
        409,
        'PRIVACY_GATE_FAILED',
        'Scene production receipt failed the final privacy guard',
      );
    }

    const outputDirectory = path.join(directory, 'outputs');
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, 'scene.png');
    const manifestPath = path.join(outputDirectory, 'scene-manifest.json');
    const evidenceManifestPath = path.join(outputDirectory, 'scene-evidence-manifest.json');
    const qaReceiptPath = path.join(outputDirectory, 'scene-qa-receipt.json');
    const privacyReportPath = path.join(outputDirectory, 'scene-privacy-report.json');
    await Promise.all([
      writeImmutable(outputPath, candidateBytes),
      writeImmutable(evidenceManifestPath, evidenceManifestBytes),
      writeImmutable(qaReceiptPath, qaReceiptBytes),
      writeImmutable(privacyReportPath, privacyReportBytes),
      writeImmutable(manifestPath, manifestBytes),
    ]);
    return this.#mutate(sceneId, (current) => {
      if (current.status !== SCENE_STATES.RUNNING) return NO_CHANGE;
      return {
        ...current,
        status: SCENE_STATES.COMPLETED,
        phase: 'COMPLETED',
        message: 'Production scene passed all nine gates',
        qa: manifest.qa,
        output: {
          relative_path: 'outputs/scene.png',
          manifest_relative_path: 'outputs/scene-manifest.json',
          evidence_manifest_relative_path: 'outputs/scene-evidence-manifest.json',
          qa_receipt_relative_path: 'outputs/scene-qa-receipt.json',
          privacy_report_relative_path: 'outputs/scene-privacy-report.json',
          sha256: outputHash,
          manifest_sha256: sha256(manifestBytes),
          evidence_manifest_sha256: evidenceManifestHash,
          qa_receipt_sha256: qaReceiptHash,
          privacy_report_sha256: privacyReportHash,
          size: candidateBytes.length,
          media_type: 'image/png',
          width: state.delivery.width,
          height: state.delivery.height,
        },
        error: null,
      };
    });
  }

  async getScene(sceneId) {
    assertSafeSceneId(sceneId);
    const state = await this.#read(sceneId);
    return state ? publicScene(state) : null;
  }

  async waitForIdle(sceneId) {
    assertSafeSceneId(sceneId);
    while (true) {
      const running = this.running.get(sceneId);
      if (!running) return this.getScene(sceneId);
      await Promise.resolve(running).catch(() => undefined);
    }
  }

  /**
   * Returns the minimum exact-hash execution evidence needed by a parent
   * orchestrator. Internal paths, prompts, provider metadata and ledgers never
   * cross this boundary.
   */
  async verifiedExecutionResult(sceneId) {
    assertSafeSceneId(sceneId);
    const state = await this.#read(sceneId);
    if (!state) return null;
    if (state.status === SCENE_STATES.COMPLETED && state.output) {
      const verified = await this.#verifiedCompletedRelease(state);
      return sanitizeOutbound({
        decision: 'PASS',
        candidate_sha256: state.output.sha256,
        // The scene-level gate set is the complete one. A per-attempt array
        // holds only the eight gates decided during that attempt; PROVENANCE is
        // decided at release, against the receipt and provider job id, so it
        // exists only on the released scene. Returning the attempt array here
        // under-reported a released scene's own verdict by exactly that gate,
        // and the editorial executor — which validates the full nine-gate
        // contract — rejected scenes that had passed, reporting EXECUTOR_FAILED
        // as though generation had broken. Prefer the released set and fall back
        // to the attempt only if a release somehow carries none.
        gates: (state.qa?.gates?.length ? state.qa.gates : verified.sourceAttempt.qa.gates),
        reviewer: state.qa?.reviewer ?? verified.sourceAttempt.qa.reviewer,
        completed_at: verified.manifest.approved_at,
        output: {
          resource_id: sceneId,
          sha256: state.output.sha256,
          receipt_sha256: state.output.qa_receipt_sha256,
          width: state.output.width,
          height: state.output.height,
          media_type: state.output.media_type,
        },
      });
    }
    const attempt = [...state.attempts]
      .reverse()
      .find((item) => item.qa && item.candidate);
    if (!attempt) {
      throw new SceneServiceError(
        409,
        'SCENE_EXECUTION_EVIDENCE_UNAVAILABLE',
        'Scene execution ended without a hash-bound QA candidate',
      );
    }
    const candidatePath = resolveInside(
      this.sceneDirectory(sceneId),
      attempt.candidate.relative_path,
      'Scene QA candidate',
    );
    const candidateBytes = await readFile(candidatePath);
    if (sha256(candidateBytes) !== attempt.candidate.sha256) {
      throw new SceneServiceError(
        409,
        'OUTPUT_INTEGRITY_FAILED',
        'Scene QA candidate no longer matches its immutable hash',
      );
    }
    const promptPath = resolveInside(
      this.sceneDirectory(sceneId),
      attempt.compiled_prompt?.relative_path,
      'Scene QA prompt',
    );
    const promptBytes = await readFile(promptPath);
    if (sha256(promptBytes) !== attempt.compiled_prompt?.sha256) {
      throw new SceneServiceError(
        409,
        'OUTPUT_INTEGRITY_FAILED',
        'Scene QA prompt no longer matches its immutable hash',
      );
    }
    const finalProvenanceGate = provenanceGate({
      state,
      attempt,
      outputHash: attempt.candidate.sha256,
      promptHash: attempt.compiled_prompt.sha256,
    });
    return sanitizeOutbound({
      decision: 'FAIL',
      candidate_sha256: attempt.candidate.sha256,
      gates: [...attempt.qa.gates, finalProvenanceGate],
      reviewer: attempt.qa.reviewer,
      completed_at: state.updated_at,
      output: null,
    });
  }

  async getIncident(sceneId) {
    assertSafeSceneId(sceneId);
    return this.incidents.has(sceneId)
      ? sanitizeOutbound(structuredClone(this.incidents.get(sceneId)))
      : null;
  }

  async listIncidents() {
    return [...this.incidents.values()]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((incident) => sanitizeOutbound(structuredClone(incident)));
  }

  subscribe(sceneId, listener) {
    assertSafeSceneId(sceneId);
    this.events.on(sceneId, listener);
    return () => this.events.off(sceneId, listener);
  }

  async rejectCompletedScene(sceneId, request = {}) {
    assertSafeSceneId(sceneId);
    assertExactObjectKeys(request, [
      'idempotencyKey',
      'expectedOutputSha256',
      'gateId',
      'evidence',
      'defects',
      'reviewer',
    ], 'Post-release rejection request');
    assertIdempotencyKey(request.idempotencyKey);
    const normalized = normalizePostReleaseRejectionRequest(request);
    const idempotencyHash = sha256(request.idempotencyKey);
    const requestFingerprint = sha256(canonicalJsonBytes(normalized));
    return this.#withSceneLock(sceneId, 'lifecycle', async () => {
      if (await this.#readTombstone(sceneId)) {
        throw new SceneServiceError(410, 'SCENE_DELETED', 'Deleted scenes cannot be rejected');
      }
      const records = await this.#readRejectionRecords(sceneId);
      const replay = records.find(
        (record) => record.receipt.idempotency_hash === idempotencyHash,
      );
      if (replay) {
        if (replay.receipt.request_fingerprint !== requestFingerprint) {
          throw new SceneServiceError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'The rejection idempotency key is already bound to a different payload',
          );
        }
        const current = await this.#read(sceneId);
        if (!current) throw new SceneServiceError(404, 'SCENE_NOT_FOUND', 'Scene not found');
        if (current.status === SCENE_STATES.COMPLETED
          && current.output?.sha256 === replay.receipt.rejected_release.output.sha256) {
          return publicScene(await this.#denyAndQuarantineRejectedRelease(current, replay));
        }
        if (current.error?.code === 'POST_RELEASE_REJECTED') {
          await this.#ensureRejectionQuarantine(sceneId, replay);
        }
        return publicScene(current);
      }

      const current = await this.#read(sceneId);
      if (!current) throw new SceneServiceError(404, 'SCENE_NOT_FOUND', 'Scene not found');
      const pendingMarker = [...records].reverse().find(
        (record) => record.receipt.rejected_release.output.sha256 === current.output?.sha256,
      );
      if (pendingMarker
        && current.status === SCENE_STATES.COMPLETED
        && current.output?.sha256 === pendingMarker.receipt.rejected_release.output.sha256) {
        await this.#denyAndQuarantineRejectedRelease(current, pendingMarker);
        throw new SceneServiceError(
          409,
          'SCENE_NOT_REJECTABLE',
          'The current release already has a committed post-release rejection',
        );
      }
      if (current.status !== SCENE_STATES.COMPLETED || !current.output) {
        throw new SceneServiceError(
          409,
          'SCENE_NOT_REJECTABLE',
          'Only a completed scene release can be rejected',
        );
      }
      if (current.output.sha256 !== normalized.expected_output_sha256) {
        throw new SceneServiceError(
          409,
          'SCENE_REJECTION_STALE_OUTPUT',
          'expectedOutputSha256 does not match the current completed scene',
        );
      }
      const verified = await this.#verifiedCompletedRelease(current);
      const sequence = records.length + 1;
      const rejectionId = `rejection_${String(sequence).padStart(6, '0')}_${idempotencyHash.slice(0, 16)}`;
      const quarantineRelativePath = `quarantine/rejections/${rejectionId}`;
      const rejectedAt = nowIso(this.clock);
      const receipt = {
        schema_version: SCENE_SCHEMA_VERSION,
        receipt_type: POST_RELEASE_REJECTION_TYPE,
        rejection_id: rejectionId,
        sequence,
        scene_id: sceneId,
        idempotency_hash: idempotencyHash,
        request_fingerprint: requestFingerprint,
        decision: 'REJECTED',
        gate: {
          id: normalized.gate_id,
          evidence: normalized.evidence,
          defects: normalized.defects,
        },
        reviewer: normalized.reviewer,
        rejected_release: {
          attempt: verified.sourceAttempt.number,
          cycle: verified.sourceAttempt.cycle,
          approved_at: verified.manifest.approved_at,
          output: structuredClone(current.output),
        },
        repair_source: {
          relative_path: `${quarantineRelativePath}/outputs/scene.png`,
          sha256: current.output.sha256,
          media_type: 'image/png',
          width: current.output.width,
          height: current.output.height,
          source_attempt: verified.sourceAttempt.number,
        },
        quarantine_relative_path: quarantineRelativePath,
        rejected_at: rejectedAt,
      };
      validatePostReleaseRejectionReceipt(receipt, sceneId);
      const receiptBytes = canonicalJsonBytes(receipt);
      const receiptHash = sha256(receiptBytes);
      const receiptRelativePath = `rejections/receipts/${rejectionId}.json`;
      const ledgerEntry = {
        schema_version: SCENE_SCHEMA_VERSION,
        ledger_type: POST_RELEASE_REJECTION_LEDGER_TYPE,
        sequence,
        scene_id: sceneId,
        rejection_id: rejectionId,
        receipt_relative_path: receiptRelativePath,
        receipt_sha256: receiptHash,
        idempotency_hash: idempotencyHash,
        request_fingerprint: requestFingerprint,
        rejected_output_sha256: current.output.sha256,
        previous_entry_sha256: records.at(-1)?.entryHash ?? null,
        created_at: rejectedAt,
      };
      validatePostReleaseRejectionLedgerEntry(ledgerEntry, {
        expectedSceneId: sceneId,
        expectedSequence: sequence,
        expectedPreviousHash: records.at(-1)?.entryHash ?? null,
        receipt,
        receiptHash,
      });
      const directory = this.sceneDirectory(sceneId);
      await writeImmutable(
        path.join(directory, receiptRelativePath),
        receiptBytes,
      );
      const ledgerBytes = canonicalJsonBytes(ledgerEntry);
      await writeImmutable(
        path.join(
          this.rejectionDirectory(sceneId),
          'ledger',
          `${String(sequence).padStart(6, '0')}.json`,
        ),
        ledgerBytes,
      );
      const record = {
        entry: ledgerEntry,
        entryHash: sha256(ledgerBytes),
        receipt,
        receiptHash,
        receiptPath: path.join(directory, receiptRelativePath),
      };
      return publicScene(await this.#denyAndQuarantineRejectedRelease(current, record));
    });
  }

  async rejectScene(sceneId, request = {}) {
    return this.rejectCompletedScene(sceneId, request);
  }

  async retryScene(sceneId, { idempotencyKey } = {}) {
    assertSafeSceneId(sceneId);
    assertIdempotencyKey(idempotencyKey);
    return this.#withSceneLock(sceneId, 'lifecycle', async () => {
      if (await this.#readTombstone(sceneId)) {
        throw new SceneServiceError(410, 'SCENE_DELETED', 'Deleted scenes cannot be retried');
      }
      const retryHash = sha256(idempotencyKey);
      const current = await this.#read(sceneId);
      if (!current) {
        throw new SceneServiceError(404, 'SCENE_NOT_FOUND', 'Scene not found');
      }
      if (current.retry_requests.includes(retryHash)) return publicScene(current);
      const rejectionDisposition = await this.#rejectionRepairDisposition(current);
      const rejectionQaOnlyRetry = rejectionDisposition.status === 'CONSUMED'
        && current.error?.code === 'QA_INFRASTRUCTURE_FAILED'
        && current.attempts.at(-1)?.status === 'QA_PENDING'
        && current.attempts.at(-1)?.candidate
        && current.attempts.at(-1)?.provider_metadata?.rejection_id
          === rejectionDisposition.record.receipt.rejection_id;
      if (rejectionDisposition.status === 'CONSUMED' && !rejectionQaOnlyRetry) {
        throw new SceneServiceError(
          409,
          'SCENE_REJECTION_REPAIR_CONSUMED',
          'This post-release rejection has already consumed its single repair cycle',
        );
      }
      if (![SCENE_STATES.FAILED, SCENE_STATES.CANCELLED].includes(current.status)) {
        throw new SceneServiceError(
          409,
          'SCENE_NOT_RETRYABLE',
          'Only failed or cancelled scenes can be retried',
        );
      }
      const rejectionRepair = rejectionDisposition.status === 'PENDING'
        && current.status === SCENE_STATES.FAILED
        && current.error?.code === 'POST_RELEASE_REJECTED';
      if (rejectionDisposition.status === 'PENDING' && !rejectionRepair) {
        throw new SceneServiceError(
          409,
          'SCENE_REJECTION_REPAIR_STATE_INVALID',
          'The pending post-release rejection is not in a repairable state',
        );
      }
      if (rejectionRepair) {
        await this.#verifiedRejectionRepairRecord(
          current,
          rejectionDisposition.record.receipt.rejection_id,
        );
      }
      const qaOnlyRetry = rejectionQaOnlyRetry || (
        !rejectionRepair
        && this.#isCandidatePreservingQaRecovery(current)
      );
      const deterministicSource = !rejectionRepair
        && !qaOnlyRetry
        && current.status === SCENE_STATES.FAILED
        && current.error?.code === 'SCENE_QA_EXHAUSTED'
        ? selectDeterministicFramingRepair(current)
        : null;
      if (!rejectionRepair
        && !rejectionQaOnlyRetry
        && !deterministicSource
        && current.manual_retries >= this.maxManualRetries) {
        throw new SceneServiceError(
          409,
          'SCENE_RETRY_LIMIT',
          'The scene manual retry limit has been reached',
        );
      }
      const deterministicAttempt = deterministicSource
        ? await this.#newDeterministicFramingAttempt(sceneId, current, deterministicSource)
        : null;
      const state = await this.#mutate(sceneId, (current) => {
        if (current.retry_requests.includes(retryHash)) return NO_CHANGE;
        if (![SCENE_STATES.FAILED, SCENE_STATES.CANCELLED].includes(current.status)) {
          throw new SceneServiceError(409, 'SCENE_NOT_RETRYABLE', 'Only failed or cancelled scenes can be retried');
        }
        const rejectionAlreadyConsumed = rejectionRepair
          && current.attempts.some(
            (attempt) => attempt.provider_metadata?.rejection_id
              === rejectionDisposition.record.receipt.rejection_id,
          );
        if (rejectionAlreadyConsumed) {
          throw new SceneServiceError(
            409,
            'SCENE_REJECTION_REPAIR_CONSUMED',
            'This post-release rejection has already consumed its single repair cycle',
          );
        }
        if (!rejectionRepair
          && !rejectionQaOnlyRetry
          && !deterministicAttempt
          && current.manual_retries >= this.maxManualRetries) {
          throw new SceneServiceError(409, 'SCENE_RETRY_LIMIT', 'The scene manual retry limit has been reached');
        }
        if (deterministicAttempt) {
          const selected = selectDeterministicFramingRepair(current);
          if (selected?.number !== deterministicSource.number
            || deterministicAttempt.number !== (current.attempts.at(-1)?.number ?? 0) + 1
            || deterministicAttempt.cycle !== current.cycle + 1) {
            throw new SceneServiceError(
              409,
              'SCENE_STATE_CONFLICT',
              'The failed framing candidate changed before the deterministic retry was queued',
            );
          }
        }
        const attempts = deterministicAttempt
          ? [...current.attempts, deterministicAttempt]
          : qaOnlyRetry
          ? current.attempts.map((attempt, index) => index === current.attempts.length - 1
            ? {
              ...attempt,
              status: 'QA_PENDING',
              qa_infrastructure_attempts: 0,
              error: null,
            }
            : attempt)
          : current.attempts;
        return {
          ...current,
          status: SCENE_STATES.QUEUED,
          phase: 'QUEUED',
          message: rejectionQaOnlyRetry
            ? 'Post-release repair QA retry queued for the preserved candidate'
            : rejectionRepair
            ? `Post-release repair queued from ${rejectionDisposition.record.receipt.rejection_id}`
            : deterministicAttempt
            ? `Deterministic framing repair queued from attempt ${deterministicSource.number}`
            : 'Scene-only retry queued from immutable inputs',
          cycle: qaOnlyRetry ? current.cycle : current.cycle + 1,
          manual_retries: rejectionRepair || rejectionQaOnlyRetry || deterministicAttempt
            ? current.manual_retries
            : current.manual_retries + 1,
          retry_requests: [...current.retry_requests, retryHash],
          attempts,
          qa: {
            decision: 'PENDING',
            gates: createPreflightGates(
              current.bindings.approved_look.image_sha256,
              current.bindings.reference_pack.sha256,
              current.bindings.approved_items?.evidence_sha256 ?? null,
            ),
            score: null,
            summary: '',
          },
          output: null,
          error: null,
          cancellation: null,
        };
      });
      if (!deterministicAttempt && qaOnlyRetry) {
        await this.#checkpointAttempt(sceneId, state.attempts.at(-1));
      }
      if (state.status === SCENE_STATES.QUEUED) {
        const previous = this.running.get(sceneId);
        if (previous) {
          previous.finally(async () => {
            const latest = await this.#read(sceneId);
            if (latest?.status === SCENE_STATES.QUEUED && !this.running.has(sceneId)) this.start(sceneId);
          });
        } else {
          this.start(sceneId);
        }
      }
      return publicScene(state);
    });
  }

  async cancelScene(sceneId, reason = 'Cancelled by request') {
    assertSafeSceneId(sceneId);
    const state = await this.#mutate(sceneId, (current) => {
      if (current.status === SCENE_STATES.CANCELLED) return NO_CHANGE;
      if ([SCENE_STATES.COMPLETED, SCENE_STATES.FAILED].includes(current.status)) {
        throw new SceneServiceError(409, 'SCENE_NOT_CANCELLABLE', 'Completed or failed scenes cannot be cancelled');
      }
      if (current.phase === 'EXPORTING') {
        throw new SceneServiceError(409, 'SCENE_EXPORTING', 'The approved scene release is already being written');
      }
      return {
        ...current,
        status: SCENE_STATES.CANCELLED,
        phase: 'CANCELLED',
        message: 'Scene generation cancelled',
        cancellation: {
          reason: String(reason).slice(0, 300),
          cancelled_at: nowIso(this.clock),
        },
        error: null,
      };
    });
    this.controllers.get(sceneId)?.abort();
    return publicScene(state);
  }

  async deleteScene(sceneId) {
    assertSafeSceneId(sceneId);
    return this.#withSceneLock(sceneId, 'lifecycle', async () => {
      if (await this.#readTombstone(sceneId)) return false;
      const directory = this.sceneDirectory(sceneId);
      if (!directory.startsWith(`${this.rootDirectory}${path.sep}`)) {
        throw new Error('Unsafe scene directory');
      }
      const state = await this.#read(sceneId);
      if (!state) return false;
      if (!SCENE_TERMINAL_STATES.has(state.status) || this.running.has(sceneId)) {
        throw new SceneServiceError(409, 'SCENE_RUNNING', 'Cancel the active scene before deleting it');
      }
      const deletedAt = nowIso(this.clock);
      const tombstone = {
        schema_version: SCENE_SCHEMA_VERSION,
        scene_id: sceneId,
        status: 'DELETED',
        final_state_revision: state.state_revision,
        deleted_at: deletedAt,
      };
      await writeImmutable(this.tombstonePath(sceneId), canonicalJsonBytes(tombstone));
      await rm(directory, { recursive: true, force: true });
      return true;
    });
  }

  async outputFile(sceneId, name = 'scene.png') {
    assertSafeSceneId(sceneId);
    if (!OUTPUT_FILES.has(name)) return null;
    const state = await this.#read(sceneId);
    if (!state || state.status !== SCENE_STATES.COMPLETED || !state.output) return null;
    const rejected = (await this.#readRejectionRecords(sceneId)).some(
      (record) => record.receipt.rejected_release.output.sha256 === state.output.sha256,
    );
    if (rejected) {
      return null;
    }
    const expectedHash = state.output[OUTPUT_HASH_FIELDS[name]];
    const filename = path.join(this.sceneDirectory(sceneId), 'outputs', name);
    if (!await exists(filename)) return null;
    if (sha256(await readFile(filename)) !== expectedHash) return null;
    return filename;
  }
}
