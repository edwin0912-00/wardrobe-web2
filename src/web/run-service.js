import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FilesystemArtifactStore } from '../runner/artifact-store.js';
import { verifyCoreQaReceipt } from '../runner/core-qa-receipt.js';
import { IMAGE_MODEL_ROUTE, GPT_IMAGE_2_LADDER_VERSION, generationProfileForAttempt } from '../runner/model-policy.js';
import { PipelineRunner } from '../runner/pipeline-runner.js';
import { assessImageQuality, normalizeReference } from '../conditioning/index.mjs';
import { normalizeWhitePngBytes } from '../qa/white-normalizer.mjs';
import { inspectImage } from '../qa/image-inspector.mjs';
import { STATUS as QA_STATUS } from '../qa/constants.mjs';
import { removeBorderConnectedWhiteToAlpha } from '../conditioning/transparent-cutout.mjs';
import { GarmentNeedsInputError, GarmentConditioner } from './garment-conditioner.js';
import { lockFirstAppearance } from './first-appearance-lock.js';
import {
  GARMENT_CATEGORIES,
  compileFullLookText,
  garmentLocks,
  groupGarmentViews,
  outfitTargetRegion,
} from './garment-passport.js';
import {
  prepareVisualCheckpoint,
  publicVisualCheckpoint,
  readVisualAsset,
  resetVisualState,
} from './run-visualizer.js';
import { sanitizeOutbound, sanitizeOutboundString } from '../security/outbound-redaction.js';

const TERMINAL = new Set(['COMPLETED', 'NEEDS_INPUT', 'FAILED']);
const RESTARTABLE = new Set(['QUEUED', 'RUNNING']);
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_APPROVED_ITEM_PACK_BYTES = 2 * 1024 * 1024;
const MAX_APPROVED_ITEM_CUTOUT_BYTES = 64 * 1024 * 1024;
const MAX_APPROVED_ITEM_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_APPROVED_ITEM_JOB_BYTES = 2 * 1024 * 1024;
const MAX_APPROVED_ITEM_MANIFEST_BYTES = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const PROVIDER_WAIT_HEARTBEAT_MS = 60_000;
const SAFE_PROVIDER_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
// A valid .webp was rejected as UNSUPPORTED_MEDIA_TYPE because curl declared
// application/octet-stream, and the identical bytes were accepted once the client
// relabelled them image/webp. Browsers fill the header in, so only a mobile app, a
// script or an integration ever hit it. The container is in the bytes, and the bytes
// are the one party to the upload that cannot misdeclare it, so they decide.
const IMAGE_SIGNATURES = Object.freeze([
  { extension: '.png', matches: (bytes) => bytes.subarray(0, 8).equals(PNG_SIGNATURE) },
  { extension: '.jpg', matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  {
    extension: '.webp',
    matches: (bytes) => bytes.subarray(0, 4).toString('latin1') === 'RIFF'
      && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
  },
]);
const CHECKPOINT_MESSAGES = Object.freeze({
  RECEIVED: 'Задачу прийнято',
  VALIDATING: 'Перевіряємо контракт і файли',
  CONDITIONING_IDENTITY: 'Перевіряємо матеріали людини',
  CONDITIONING_OUTFIT: 'Перевіряємо матеріали образу',
  CONDITIONING_QA: 'Перевіряємо підготовлені матеріали',
  REFERENCES_READY: 'Матеріали затверджено',
  GENERATING_AVATAR: 'Генеруємо базовий аватар',
  AVATAR_RETRY: 'Повторно генеруємо аватар',
  AVATAR_QA: 'Перевіряємо схожість і якість аватара',
  AVATAR_READY: 'Базовий аватар затверджено',
  GENERATING_OUTFIT: 'Генеруємо повний образ',
  OUTFIT_RETRY: 'Повторно генеруємо образ',
  OUTFIT_QA: 'Перевіряємо образ і схожість',
  OUTFIT_READY: 'Образ затверджено',
  EXPORTING: 'Зберігаємо затверджений результат',
  COMPLETED: 'Результат готовий',
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export class ApprovedItemEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApprovedItemEvidenceError';
    this.statusCode = 409;
    this.code = code;
  }
}

export class InputNeedsInputError extends Error {
  constructor(code, message, {
    field = null,
    requirements = [],
    nextAction = 'REPLACE_INPUT',
  } = {}) {
    super(message);
    this.name = 'InputNeedsInputError';
    this.statusCode = 422;
    this.status = 'NEEDS_INPUT';
    this.code = code;
    this.field = field;
    this.requirements = requirements;
    this.nextAction = nextAction;
  }
}

function needsInput(code, message, options) {
  return new InputNeedsInputError(code, message, options);
}

function evidenceError(code, message) {
  return new ApprovedItemEvidenceError(code, message);
}

// Fashion Video must decide whether a stride is physically grounded before a
// provider job exists. The approved white master is already the only legal
// image input, so this is a deterministic measurement of those exact pixels —
// never a generated extension and never a VLM guess. A half-body crop cannot
// prove footwear; a visible figure that reaches from the upper to lower area of
// the white canvas can.
async function fullLengthSourceCapability(filename) {
  try {
    const isolated = await removeBorderConnectedWhiteToAlpha(filename, {
      removeBorderConnectedNeutralGradient: true,
      removeDetachedLowContrastResidue: true,
    });
    const { data, info } = await sharp(isolated.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let top = info.height;
    let bottom = -1;
    for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
      if (data[pixel * info.channels + 3] === 0) continue;
      const y = Math.floor(pixel / info.width);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    const visibleHeight = bottom >= top ? bottom - top + 1 : 0;
    return Object.freeze({
      full_length: visibleHeight >= info.height * 0.52
        && top <= info.height * 0.32
        && bottom >= info.height * 0.72,
    });
  } catch {
    // This is a capability check, not a license to infer unseen legs. If the
    // exact source cannot be measured, stride remains unavailable.
    return Object.freeze({ full_length: false });
  }
}

function isInside(root, filename) {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Runs survive a product release by being copied into the persistent runtime.
// Their signed execution checkpoint can therefore retain the absolute path of
// the release that created it.  Absolute release roots are not provenance: the
// run-relative artifact path and its signed SHA-256 are.  Accept only the
// exact expected tail, so this never turns into a general path fallback.
function hasRunArtifactSuffix(value, runId, relativePath) {
  if (typeof value !== 'string' || value.trim() === '' || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return false;
  }
  const expected = path.join(runId, ...relativePath.split('/'));
  const resolved = path.resolve(value);
  return resolved === expected || resolved.endsWith(`${path.sep}${expected}`);
}

function safeEvidenceText(value, field, { allowEmpty = false, maxLength = 2_000 } = {}) {
  if (typeof value !== 'string'
    || (!allowEmpty && value.trim() === '')
    || value.length > maxLength) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', `${field} is invalid`);
  }
  if (sanitizeOutboundString(value, { stripProjectName: false }) !== value) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_PRIVATE', `${field} contains private infrastructure`);
  }
  return value;
}

function safeEvidenceStringArray(value, field, { maxItems = 64 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', `${field} is invalid`);
  }
  return value.map((item, index) => safeEvidenceText(
    item,
    `${field}[${index}]`,
    { maxLength: 2_000 },
  ));
}

function safeEvidenceNumber(value, field) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', `${field} must be between 0 and 1`);
  }
  return value;
}

function logicalItemFacts(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', `extraction.items[${index}] is invalid`);
  }
  if (!Number.isInteger(item.source_index) || item.source_index < 0) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', `extraction.items[${index}].source_index is invalid`);
  }
  const sourceIndexes = item.source_indexes ?? [item.source_index];
  if (!Array.isArray(sourceIndexes)
    || sourceIndexes.length === 0
    || sourceIndexes.some((value) => !Number.isInteger(value) || value < 0)
    || new Set(sourceIndexes).size !== sourceIndexes.length
    || !sourceIndexes.includes(item.source_index)) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', `extraction.items[${index}].source_indexes is invalid`);
  }
  if (!GARMENT_CATEGORIES.includes(item.category)) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', `extraction.items[${index}].category is invalid`);
  }
  const observed = item.observed;
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) {
    throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', `extraction.items[${index}].observed is invalid`);
  }
  return {
    category: item.category,
    reference_set_id: item.reference_set_id === undefined
      ? `set-${sourceIndexes.slice().sort((left, right) => left - right).join('-')}`
      : safeEvidenceText(
        item.reference_set_id,
        `extraction.items[${index}].reference_set_id`,
        { maxLength: 128 },
      ),
    source_indexes: [...sourceIndexes],
    ...(item.same_item_confidence === undefined ? {} : {
      same_item_confidence: safeEvidenceNumber(
        item.same_item_confidence,
        `extraction.items[${index}].same_item_confidence`,
      ),
    }),
    ...(item.grouping_evidence === undefined ? {} : {
      grouping_evidence: safeEvidenceStringArray(
        item.grouping_evidence,
        `extraction.items[${index}].grouping_evidence`,
      ),
    }),
    confidence: safeEvidenceNumber(
      item.confidence,
      `extraction.items[${index}].confidence`,
    ),
    observed: {
      garment_type: safeEvidenceText(
        observed.garment_type,
        `extraction.items[${index}].observed.garment_type`,
      ),
      colors: safeEvidenceStringArray(
        observed.colors,
        `extraction.items[${index}].observed.colors`,
      ),
      material: safeEvidenceStringArray(
        observed.material,
        `extraction.items[${index}].observed.material`,
      ),
      pattern: safeEvidenceStringArray(
        observed.pattern,
        `extraction.items[${index}].observed.pattern`,
      ),
      logo_text: safeEvidenceStringArray(
        observed.logo_text,
        `extraction.items[${index}].observed.logo_text`,
      ),
      construction: safeEvidenceStringArray(
        observed.construction,
        `extraction.items[${index}].observed.construction`,
      ),
    },
    unknowns: safeEvidenceStringArray(
      item.unknowns,
      `extraction.items[${index}].unknowns`,
    ),
  };
}

function resolveRunId(runId) {
  const resolved = runId ?? randomUUID();
  if (typeof resolved !== 'string' || !SAFE_RUN_ID.test(resolved)) {
    throw new Error('runId must be a safe identifier of at most 128 letters, numbers, dashes, or underscores');
  }
  return resolved;
}

async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filename);
}

function sniffImageExtension(bytes) {
  return IMAGE_SIGNATURES.find((candidate) => candidate.matches(bytes))?.extension ?? null;
}

async function validateUpload(upload, field) {
  if (!upload || !Buffer.isBuffer(upload.buffer) || upload.buffer.length === 0) {
    throw needsInput('INPUT_REQUIRED', `${field} is required`, {
      field,
      requirements: ['non-empty PNG, JPEG, or WEBP image'],
    });
  }
  const extension = sniffImageExtension(upload.buffer);
  if (!extension) {
    throw needsInput('UNSUPPORTED_MEDIA_TYPE', `${field} must be PNG, JPEG, or WEBP`, {
      field,
      requirements: ['image/png', 'image/jpeg', 'image/webp'],
    });
  }
  if (upload.buffer.length > 20 * 1024 * 1024) {
    throw needsInput('FILE_TOO_LARGE', `${field} exceeds 20 MB`, {
      field,
      requirements: ['maximum 20 MB'],
    });
  }
  let metadata;
  try {
    metadata = await sharp(upload.buffer, { failOn: 'error' }).metadata();
  } catch {
    throw needsInput('IMAGE_DECODE_FAILED', `${field} is not a decodable image`, {
      field,
      requirements: ['valid, non-corrupt image bytes'],
    });
  }
  if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) {
    throw needsInput('IMAGE_TOO_SMALL', `${field} must be at least 256×256`, {
      field,
      requirements: ['minimum width 256 px', 'minimum height 256 px'],
    });
  }
  if (metadata.pages && metadata.pages > 1) {
    throw needsInput('ANIMATED_IMAGE_UNSUPPORTED', `${field} must be a still image`, {
      field,
      requirements: ['single-frame image'],
    });
  }
  return { extension, metadata };
}

function publicProviderWait(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.state !== 'WAITING'
    || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || value.attempt > 5
    || !Number.isSafeInteger(value.elapsed_seconds) || value.elapsed_seconds < 60
    || typeof value.started_at !== 'string' || !Number.isFinite(Date.parse(value.started_at))) {
    return null;
  }
  // The exact provider job id stays in the private persisted run state. The
  // browser only needs proof that a real remote job is still in progress.
  return {
    state: 'WAITING',
    attempt: value.attempt,
    started_at: value.started_at,
    elapsed_seconds: value.elapsed_seconds,
  };
}

export function providerWaitHeartbeatFromJournal(journal, {
  now = new Date(),
  heartbeatMs = PROVIDER_WAIT_HEARTBEAT_MS,
} = {}) {
  if (!journal || typeof journal !== 'object' || Array.isArray(journal)
    || journal.state !== 'WAITING'
    || !SAFE_PROVIDER_JOB_ID.test(journal.provider_job_id ?? '')
    || !Array.isArray(journal.events)
    || !(now instanceof Date) || !Number.isFinite(now.getTime())
    || !Number.isInteger(heartbeatMs) || heartbeatMs < 1_000) return null;
  const started = [...journal.events].reverse().find((event) => (
    event?.type === 'WAIT_STARTED'
    && event.provider_job_id === journal.provider_job_id
    && Number.isSafeInteger(event.wait_attempt)
    && event.wait_attempt >= 1
    && event.wait_attempt <= 5
    && typeof event.at === 'string'
    && Number.isFinite(Date.parse(event.at))
  ));
  if (!started) return null;
  const startedAt = Date.parse(started.at);
  const elapsedMs = now.getTime() - startedAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs < heartbeatMs) return null;
  return {
    state: 'WAITING',
    provider: typeof journal.provider === 'string' ? journal.provider.slice(0, 32) : 'provider',
    provider_job_id: journal.provider_job_id,
    attempt: started.wait_attempt,
    started_at: new Date(startedAt).toISOString(),
    // The persisted heartbeat deliberately advances once per minute. It proves
    // that this is a live provider wait without rewriting run.json every second.
    elapsed_seconds: Math.floor(elapsedMs / heartbeatMs) * Math.floor(heartbeatMs / 1000),
  };
}

async function providerWaitHeartbeatFromDirectory(directory, options) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
    try {
      const journal = JSON.parse(await readFile(path.join(directory, entry.name), 'utf8'));
      const heartbeat = providerWaitHeartbeatFromJournal(journal, options);
      if (heartbeat) candidates.push(heartbeat);
    } catch {
      // A partial or unrelated provider receipt is never a reason to stop the
      // core run or to claim a connection failure to the browser.
    }
  }
  return candidates.sort((left, right) => right.elapsed_seconds - left.elapsed_seconds)[0] ?? null;
}

function publicRun(state) {
  const visualCheckpoint = publicVisualCheckpoint(
    state.run_id,
    state.visual_checkpoint,
    state.visual_assets,
  );
  return {
    run_id: state.run_id,
    status: state.status,
    phase: state.phase,
    inner_state: state.inner_state ?? null,
    terminal_stage: state.terminal_stage ?? null,
    message: sanitizeOutboundString(state.message),
    created_at: state.created_at,
    updated_at: state.updated_at,
    garments: (state.garments ?? []).map((item) => ({
      source_index: item.source_index,
      source_indexes: item.source_indexes,
      reference_set_id: item.reference_set_id,
      category: item.category,
      confidence: item.confidence,
      observed: sanitizeOutbound(item.observed ?? {}),
      // Presentation derivative; raw evidence never leaves this endpoint by
      // default in a conflict/picker UI.
      preview_url: `/api/runs/${state.run_id}/garments/${item.source_index}?preview=1`,
    })),
    conflicts: sanitizeOutbound(state.conflicts ?? []),
    qa: sanitizeOutbound(state.qa ?? {}),
    outputs: sanitizeOutbound(state.outputs ?? {}),
    requested_outfit_text: sanitizeOutboundString(state.inputs?.outfit_text ?? ''),
    execution_route: {
      ...(Array.isArray(state.image_model_route)
        && JSON.stringify(state.image_model_route) !== JSON.stringify(IMAGE_MODEL_ROUTE)
        ? { image_model_route: [...state.image_model_route] }
        : {}),
      ...(state.max_ordered_references === undefined ? {} : { max_ordered_references: state.max_ordered_references }),
      garment_images_supplied: Boolean(state.inputs?.garments?.length),
      garment_source_image_count: state.inputs?.garments?.length ?? 0,
      avatar_reuse: Boolean(state.inputs?.approved_avatar),
      optional_scene_requested: Boolean(state.inputs?.generate_scene),
    },
    ...(state.inputs?.approved_avatar ? { avatar_reuse: {
      purpose: 'NEW_LOOK',
      source_run_id: state.inputs.approved_avatar.source_run_id,
    } } : {}),
    ...(publicProviderWait(state.provider_wait) ? { provider_wait: publicProviderWait(state.provider_wait) } : {}),
    ...(visualCheckpoint ? { visual_checkpoint: visualCheckpoint } : {}),
    error: sanitizeOutbound(state.error ?? null),
  };
}

export class RunService {
  constructor({ rootDirectory, provider, vlm, assetGenerator, generationRoute = IMAGE_MODEL_ROUTE, projectRoot = path.resolve(import.meta.dirname, '..', '..'), clock = () => new Date(), observer = null }) {
    if (!Array.isArray(generationRoute) || generationRoute.length < 1) {
      throw new TypeError('generationRoute must contain immutable Zeely image profiles');
    }
    generationRoute.forEach((_, index) => generationProfileForAttempt(index + 1, generationRoute));
    this.rootDirectory = path.resolve(rootDirectory);
    this.provider = provider;
    this.vlm = vlm;
    this.assetGenerator = assetGenerator;
    this.generationRoute = [...generationRoute];
    this.maxOrderedReferences = Number.isInteger(provider?.maxOrderedReferences)
      ? provider.maxOrderedReferences
      : null;
    this.projectRoot = projectRoot;
    this.clock = clock;
    this.observer = observer;
    this.events = new EventEmitter();
    this.running = new Map();
    this.creating = new Map();
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true });
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_RUN_ID.test(entry.name)) continue;
      let state;
      try { state = await this.#read(entry.name); } catch { continue; }
      if (state?.run_id === entry.name && RESTARTABLE.has(state.status)) this.start(entry.name);
    }
  }
  runDirectory(runId) { return path.join(this.rootDirectory, runId); }
  statePath(runId) { return path.join(this.runDirectory(runId), 'run.json'); }

  async #read(runId) {
    try { return JSON.parse(await readFile(this.statePath(runId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async #write(state, update = {}) {
    Object.assign(state, update, { updated_at: this.clock().toISOString() });
    await atomicJson(this.statePath(state.run_id), state);
    const publicState = publicRun(state);
    this.events.emit(state.run_id, publicState);
    if (this.observer) {
      try { await this.observer(publicState); } catch { /* monitoring must never break a run */ }
    }
    return state;
  }

  async #prepareVisualFailSoft(state, specification) {
    try {
      return await prepareVisualCheckpoint(state, specification);
    } catch {
      // Visual telemetry is observational. A preview problem must never alter
      // the core pipeline result or suppress its persisted phase/message.
      return false;
    }
  }

  async createRun({ person, identityDetail, garments = [], outfitText = '', generateScene = false, runId: requestedRunId, approvedAvatarReference = null }) {
    const runId = resolveRunId(requestedRunId);
    const pending = this.creating.get(runId);
    if (pending) return pending;
    const existing = await this.#read(runId);
    if (existing) {
      if (RESTARTABLE.has(existing.status) && !this.running.has(runId)) this.start(runId);
      return publicRun(existing);
    }
    const raced = this.creating.get(runId);
    if (raced) return raced;
    const creation = this.#createNewRun({ runId, person, identityDetail, garments, outfitText, generateScene, approvedAvatarReference })
      .finally(() => this.creating.delete(runId));
    this.creating.set(runId, creation);
    return creation;
  }

  async #createNewRun({ runId, person, identityDetail, garments, outfitText, generateScene, approvedAvatarReference }) {
    if (garments.length > 5) {
      throw needsInput(
        'TOO_MANY_ITEM_REFERENCES',
        'Можна додати не більше п’яти фото речей',
        {
          field: 'Фото речей',
          requirements: ['maximum 5 item images'],
          nextAction: 'REMOVE_EXTRA_INPUTS',
        },
      );
    }
    if (garments.length === 0 && outfitText.trim() === '') {
      throw needsInput(
        'OUTFIT_INPUT_REQUIRED',
        'Додайте опис образу або хоча б одне фото речі',
        {
          field: 'Образ',
          requirements: ['outfit text or at least one item image'],
        },
      );
    }
    await validateUpload(person, 'Фото людини');
    if (identityDetail) await validateUpload(identityDetail, 'Додаткове фото людини');
    for (const [index, garment] of garments.entries()) await validateUpload(garment, `Фото речі ${index + 1}`);
    const approvedAvatar = approvedAvatarReference
      ? await this.#verifyApprovedAvatarReference(approvedAvatarReference, runId)
      : null;
    const runDirectory = this.runDirectory(runId);
    const inputsDirectory = path.join(runDirectory, 'inputs');
    await mkdir(inputsDirectory, { recursive: true });
    const save = async (upload, stem, displayField) => {
      const { extension } = await validateUpload(upload, displayField);
      const filename = path.join(inputsDirectory, `${stem}${extension}`);
      await writeFile(filename, upload.buffer, { flag: 'wx' });
      return filename;
    };
    const personPath = await save(person, 'person', 'Фото людини');
    const identityDetailPath = identityDetail ? await save(identityDetail, 'identity-detail', 'Додаткове фото людини') : null;
    const garmentPaths = [];
    for (const [index, garment] of garments.entries()) garmentPaths.push(await save(garment, `garment-${String(index + 1).padStart(2, '0')}`, `Фото речі ${index + 1}`));
    let importedApprovedAvatar = null;
    if (approvedAvatar) {
      const avatarPath = path.join(inputsDirectory, 'approved-avatar.png');
      const receiptPath = path.join(inputsDirectory, 'approved-avatar-qa-receipt.json');
      await writeFile(avatarPath, approvedAvatar.avatarBytes, { flag: 'wx' });
      await writeFile(receiptPath, approvedAvatar.receiptBytes, { flag: 'wx' });
      importedApprovedAvatar = {
        path: avatarPath,
        sha256: approvedAvatar.avatarSha256,
        source_run_id: approvedAvatar.sourceRunId,
        qa_receipt: { path: receiptPath, sha256: approvedAvatar.receiptSha256, decision: 'PASS' },
      };
    }
    const now = this.clock().toISOString();
    const state = {
      schema_version: '1.0.0', run_id: runId, status: 'QUEUED', phase: 'UPLOADED', message: 'Inputs accepted',
      created_at: now, updated_at: now, inputs: { person: personPath, identity_detail: identityDetailPath, garments: garmentPaths, outfit_text: outfitText.trim(), generate_scene: Boolean(generateScene), ...(importedApprovedAvatar ? { approved_avatar: importedApprovedAvatar } : {}) },
      image_model_route: [...this.generationRoute],
      image_model_route_version: GPT_IMAGE_2_LADDER_VERSION,
      ...(this.maxOrderedReferences === null ? {} : { max_ordered_references: this.maxOrderedReferences }),
      garments: [], conflicts: [], qa: {}, outputs: {}, error: null,
      visual_epoch: 1,
      visual_sequence: 0,
      visual_assets: {},
      visual_checkpoint: null,
    };
    const preparation = {
      person: person.preparation ?? null,
      identity_detail: identityDetail?.preparation ?? null,
      garments: garments.map((item) => item.preparation ?? null),
    };
    if (preparation.person || preparation.identity_detail || preparation.garments.some(Boolean)) {
      state.inputs.preparation = preparation;
    }
    await this.#prepareVisualFailSoft(state, {
      runDirectory,
      clock: this.clock,
      stage: 'SOURCE_READY',
      subject: { kind: 'PERSON', index: null, total: null },
      presentation: 'SOURCE_SCAN',
      truthState: 'IMMUTABLE_INPUT',
      title: 'Фото людини отримано',
      status: 'Незмінний оригінал збережено для перевірок',
      layers: [{ role: 'SOURCE', path: personPath }],
    });
    await this.#write(state);
    this.start(runId);
    return publicRun(state);
  }

  async #verifyApprovedAvatarReference(reference, targetRunId) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new Error('approvedAvatarReference must be an object');
    const sourceRunId = reference.source_run_id;
    if (typeof sourceRunId !== 'string' || !SAFE_RUN_ID.test(sourceRunId)) throw new Error('approvedAvatarReference.source_run_id is invalid');
    if (sourceRunId === targetRunId) throw new Error('A run cannot reuse its own avatar');
    const sourceState = await this.#read(sourceRunId);
    if (!sourceState || sourceState.status !== 'COMPLETED') throw new Error('Approved avatar source run must exist and be completed');
    const expectedAvatarPath = path.join(this.runDirectory(sourceRunId), 'outputs', 'avatar.png');
    const expectedReceiptPath = path.join(this.runDirectory(sourceRunId), 'outputs', 'run-manifest.json');
    if (path.resolve(reference.path ?? '') !== expectedAvatarPath) throw new Error('Approved avatar path must belong to the declared source run');
    if (path.resolve(reference.qa_receipt?.path ?? '') !== expectedReceiptPath) throw new Error('Approved avatar QA receipt must belong to the declared source run');
    await this.#verifyCompletedOutputSet(sourceRunId);
    const [avatarBytes, receiptBytes] = await Promise.all([readFile(expectedAvatarPath), readFile(expectedReceiptPath)]);
    const avatarSha256 = sha256(avatarBytes);
    const receiptSha256 = sha256(receiptBytes);
    if (reference.sha256 !== avatarSha256) throw new Error('Approved avatar SHA-256 mismatch');
    if (reference.qa_receipt?.sha256 !== receiptSha256) throw new Error('Approved avatar QA receipt SHA-256 mismatch');
    if (reference.qa_receipt?.decision !== 'PASS') throw new Error('Approved avatar QA receipt must declare PASS');
    let manifest;
    try { manifest = JSON.parse(receiptBytes.toString('utf8')); } catch { throw new Error('Approved avatar QA receipt is invalid JSON'); }
    if (manifest.job_id !== `web-${sourceRunId}` || manifest.state !== 'COMPLETED') throw new Error('Approved avatar QA receipt does not match the declared source run');
    if (manifest.qa?.avatar?.decision !== 'PASS') throw new Error('Source avatar did not pass avatar QA');
    if (manifest.outputs?.avatar?.sha256 !== avatarSha256) throw new Error('Source QA receipt is not bound to the approved avatar hash');
    return { sourceRunId, avatarBytes, receiptBytes, avatarSha256, receiptSha256 };
  }

  start(runId) {
    if (this.running.has(runId)) return this.running.get(runId);
    const promise = this.#execute(runId).finally(() => this.running.delete(runId));
    this.running.set(runId, promise);
    return promise;
  }

  async #execute(runId) {
    const state = await this.#read(runId);
    if (!state || TERMINAL.has(state.status)) return state;
    try {
      let conditioned = await this.#restoreConditionedGarments(state);
      if (state.inputs.garments.length) {
        if (!conditioned) {
          await this.#write(state, { status: 'RUNNING', phase: 'GARMENT_CONDITIONING', message: 'Фіксуємо характеристики речей і готуємо еталонні референси' });
          const conditioner = new GarmentConditioner({
            vlm: this.vlm,
            generator: this.assetGenerator,
            generationRoute: this.generationRoute,
            maxGarmentBindings: this.maxOrderedReferences === null
              ? null
              : Math.max(0, this.maxOrderedReferences - 1 - (state.inputs.identity_detail ? 2 : 1)),
            clock: this.clock,
          });
          conditioned = await conditioner.condition({
            imagePaths: state.inputs.garments,
            outputDirectory: path.join(this.runDirectory(runId), 'conditioned', 'garments'),
            runId,
            passport: state.inputs.garment_passport ?? null,
            selections: state.inputs.garment_selections ?? {},
            onProgress: async (innerState, message) => this.#write(state, { inner_state: innerState, message }),
            onVisual: async (visual) => {
              if (visual?.reset === true) {
                resetVisualState(state);
                await this.#write(state);
                return;
              }
              const changed = await this.#prepareVisualFailSoft(state, {
                ...visual,
                runDirectory: this.runDirectory(runId),
                clock: this.clock,
              });
              if (changed) await this.#write(state);
            },
          });
          await this.#write(state, { garments: conditioned.items.map((item) => ({ source_index: item.source_index, source_indexes: item.source_indexes, reference_set_id: item.reference_set_id, category: item.category, confidence: item.confidence, observed: item.observed, reference_card: item.reference_card.path, cutout: item.cutout.path })), conflicts: conditioned.conflicts });
        }
      }
      const jobPath = await this.#buildJob(state, conditioned);
      await this.#write(state, { status: 'RUNNING', phase: 'CORE_PIPELINE', inner_state: null, terminal_stage: null, message: 'Генеруємо й перевіряємо аватар та образ', job_path: jobPath });
      const runner = new PipelineRunner({ provider: this.provider });
      let progressSync = Promise.resolve();
      const progressTimer = setInterval(() => {
        progressSync = progressSync
          .then(() => this.#syncRunnerProgress(state))
          .catch(() => {});
      }, 1000);
      let result;
      try {
        result = await runner.runJobFile(jobPath);
      } finally {
        clearInterval(progressTimer);
        await progressSync;
      }
      state.runner = result;
      await this.#syncRunnerProgress(state);
      if (result.status !== 'COMPLETED') {
        let qaReason = null;
        let terminalDetails = null;
        try {
          const checkpoint = JSON.parse(await readFile(result.checkpointPath, 'utf8'));
          qaReason = checkpoint.qa?.outfit?.reason ?? checkpoint.qa?.avatar?.reason ?? checkpoint.qa?.conditioning?.reason ?? null;
        } catch { /* checkpoint details are optional in an infrastructure failure */ }
        try {
          const events = (await readFile(result.eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
          terminalDetails = events.reverse().find((event) => event.type === 'STATE_TRANSITION' && ['FAILED', 'NEEDS_INPUT'].includes(event.state))?.data ?? null;
        } catch { /* event details are optional in an infrastructure failure */ }
        const error = result.lastError ?? terminalDetails?.error ?? null;
        const terminalStage = terminalDetails?.from ?? state.inner_state ?? state.phase;
        return this.#write(state, { status: result.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'FAILED', phase: 'CORE_PIPELINE', terminal_stage: terminalStage, message: error?.message ?? terminalDetails?.reason ?? qaReason ?? `Pipeline ended with ${result.status}`, error });
      }
      const outputs = {
        avatar: `/api/runs/${runId}/files/avatar.png`,
        avatar_outfit: `/api/runs/${runId}/files/avatar_outfit.png`,
        manifest: `/api/runs/${runId}/files/run-manifest.json`,
      };
      const manifest = JSON.parse(await readFile(result.outputs.manifest, 'utf8'));
      state.qa = manifest.qa;
      state.outputs = outputs;
      // The durable approved-item evidence is intentionally readable only after
      // this run becomes COMPLETED. At this point the in-memory garment list is
      // already hash-bound by the runner checkpoint and is sufficient to decide
      // whether lower-body first-appearance capture is required.
      const categories = new Set((state.garments ?? []).map((item) => item.category));
      if (!categories.has('bottom') || !categories.has('footwear')) {
        const firstAppearance = await lockFirstAppearance({
          approvedLookPath: result.outputs.avatar_outfit,
          outputDirectory: path.join(this.runDirectory(runId), 'conditioned', 'first-appearance'),
          runId,
          vlm: this.vlm,
          clock: this.clock,
        });
        state.first_appearance_lock = {
          record_sha256: sha256(await readFile(firstAppearance.recordPath)),
          categories: firstAppearance.items.map((item) => item.category),
        };
      }
      if (state.inputs.generate_scene) await this.#generateScene(state, result.outputs.avatar_outfit);
      await this.#prepareVisualFailSoft(state, {
        runDirectory: this.runDirectory(runId),
        clock: this.clock,
        stage: 'OUTPUT_READY',
        subject: { kind: 'LOOK', index: null, total: null },
        presentation: 'OUTPUT',
        truthState: 'APPROVED_OUTPUT',
        title: 'Образ готовий',
        status: 'Фінальний результат пройшов перевірку й збережений',
        layers: [{
          role: 'AFTER',
          path: result.outputs.avatar_outfit,
          sha256: manifest.outputs?.avatar_outfit?.sha256,
        }],
      });
      return this.#write(state, { status: 'COMPLETED', phase: 'COMPLETED', inner_state: null, terminal_stage: null, message: 'Аватар і образ готові', outputs: state.outputs });
    } catch (error) {
      if (error instanceof GarmentNeedsInputError) {
        const passport = error.details.passport;
        const garments = passport?.items ? groupGarmentViews(passport.items, passport.reference_sets) : state.garments;
        return this.#write(state, { status: 'NEEDS_INPUT', phase: 'GARMENT_CONDITIONING', terminal_stage: state.inner_state ?? state.phase, message: error.message, garments, conflicts: error.details.conflicts ?? [], error: { name: error.name, message: error.message, details: error.details } });
      }
      return this.#write(state, { status: 'FAILED', phase: state.phase, terminal_stage: state.inner_state ?? state.phase, message: error.message, error: { name: error.name, message: error.message } });
    }
  }

  async #syncRunnerProgress(state) {
    const checkpointPath = path.join(this.runDirectory(state.run_id), 'outputs', '.zeely-run', 'checkpoint.json');
    let checkpoint;
    try {
      checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
    } catch {
      return;
    }
    const providerWait = await providerWaitHeartbeatFromDirectory(
      path.join(this.runDirectory(state.run_id), 'outputs', '.zeely-run', 'provider-jobs'),
      { now: this.clock() },
    );
    const priorWait = publicProviderWait(state.provider_wait);
    const waitChanged = JSON.stringify(priorWait) !== JSON.stringify(publicProviderWait(providerWait));
    let visualChanged = false;
    const retryStates = new Set(['CONDITIONING_RETRY', 'AVATAR_RETRY', 'OUTFIT_RETRY']);
    if (retryStates.has(checkpoint.state)) {
      const phase = checkpoint.state.split('_')[0].toLowerCase();
      const marker = `${checkpoint.state}:${checkpoint.attempts?.[phase] ?? checkpoint.attempts?.conditioning ?? 0}`;
      if (state.visual_runner_retry_marker !== marker) {
        resetVisualState(state);
        state.visual_runner_retry_marker = marker;
        visualChanged = true;
      }
    } else {
      const visual = this.#runnerVisualCheckpoint(state, checkpoint);
      if (visual) {
        visualChanged = await this.#prepareVisualFailSoft(state, {
          ...visual,
          runDirectory: this.runDirectory(state.run_id),
          clock: this.clock,
        });
      }
    }
    if (checkpoint.state !== state.inner_state || visualChanged || waitChanged) {
      const waitMessage = providerWait
        ? `Модель обробляє запит у провайдера · спроба ${providerWait.attempt} · очікуємо ${Math.floor(providerWait.elapsed_seconds / 60)} хв`
        : null;
      await this.#write(state, {
        inner_state: checkpoint.state,
        ...(providerWait ? { provider_wait: providerWait, message: waitMessage } : { provider_wait: null }),
        message: waitMessage ?? CHECKPOINT_MESSAGES[checkpoint.state] ?? checkpoint.state.replaceAll('_', ' ').toLowerCase(),
      });
    }
  }

  #runnerVisualCheckpoint(state, checkpoint) {
    const artifactLayer = (artifact, role) => {
      const descriptor = artifact?.artifact;
      if (!descriptor?.path
        || !['image/png', 'image/jpeg', 'image/webp'].includes(descriptor.mediaType)
        || !SHA256.test(descriptor.digest ?? '')) {
        return null;
      }
      return { role, path: descriptor.path, sha256: descriptor.digest };
    };
    const identity = artifactLayer(checkpoint.artifacts?.conditioned_identity, 'AFTER');
    const conditionedOutfit = artifactLayer(checkpoint.artifacts?.conditioned_outfit, 'AFTER');
    const avatar = artifactLayer(checkpoint.artifacts?.avatar, 'CANDIDATE');
    const outfit = artifactLayer(checkpoint.artifacts?.outfit, 'CANDIDATE');
    const personBefore = state.inputs?.person
      ? { role: 'BEFORE', path: state.inputs.person }
      : null;
    const conditionedOutfitVisual = conditionedOutfit ? {
      stage: 'OUTFIT_REFERENCE_CONDITIONED',
      subject: { kind: 'LOOK', index: null, total: null },
      presentation: 'CANDIDATE_REVEAL',
      truthState: 'DETERMINISTIC_DERIVATIVE',
      title: 'Референси образу підготовлено',
      status: 'Показано фактичний файл, переданий у генерацію',
      layers: [{ ...conditionedOutfit, role: 'CANDIDATE' }],
    } : null;
    switch (checkpoint.state) {
      case 'CONDITIONING_IDENTITY':
      case 'CONDITIONING_OUTFIT':
        if (conditionedOutfitVisual) return conditionedOutfitVisual;
        return identity ? {
          stage: 'IDENTITY_CONDITIONED',
          subject: { kind: 'PERSON', index: null, total: null },
          presentation: 'BEFORE_AFTER',
          truthState: 'DETERMINISTIC_DERIVATIVE',
          title: 'Фото людини підготовлено',
          status: 'Показано реальний нормалізований файл',
          layers: [personBefore, identity].filter(Boolean),
        } : null;
      case 'CONDITIONING_QA':
      case 'REFERENCES_READY':
        return conditionedOutfitVisual;
      case 'GENERATING_AVATAR':
        return avatar ? {
          stage: 'AVATAR_CANDIDATE_READY',
          subject: { kind: 'PERSON', index: null, total: null },
          presentation: 'CANDIDATE_REVEAL',
          truthState: 'UNVERIFIED_CANDIDATE',
          title: 'Кандидат аватара отримано',
          status: 'Показано реальний результат до перевірки якості',
          layers: [avatar],
          metrics: { attempt: checkpoint.attempts?.avatar ?? 1 },
        } : null;
      case 'AVATAR_QA':
        return avatar ? {
          stage: 'AVATAR_QA',
          subject: { kind: 'PERSON', index: null, total: null },
          presentation: 'QA_SCAN',
          truthState: 'QA_IN_PROGRESS',
          title: 'Перевіряємо аватар',
          status: 'Це реальний кандидат, який ще не затверджено',
          layers: [avatar],
          metrics: { attempt: checkpoint.attempts?.avatar ?? 1 },
        } : null;
      case 'AVATAR_READY':
        return avatar ? {
          stage: 'AVATAR_APPROVED',
          subject: { kind: 'PERSON', index: null, total: null },
          presentation: 'OUTPUT',
          truthState: 'APPROVED_OUTPUT',
          title: 'Аватар затверджено',
          status: 'Кандидат пройшов перевірку якості',
          layers: [{ ...avatar, role: 'AFTER' }],
          metrics: { attempt: checkpoint.attempts?.avatar ?? 1 },
        } : null;
      case 'GENERATING_OUTFIT':
        if (outfit) {
          return {
            stage: 'OUTFIT_CANDIDATE_READY',
            subject: { kind: 'LOOK', index: null, total: null },
            presentation: 'CANDIDATE_REVEAL',
            truthState: 'UNVERIFIED_CANDIDATE',
            title: 'Кандидат образу отримано',
            status: 'Показано реальний результат до перевірки якості',
            layers: [outfit],
            metrics: { attempt: checkpoint.attempts?.outfit ?? 1 },
          };
        }
        return avatar ? {
          stage: 'AVATAR_APPROVED',
          subject: { kind: 'PERSON', index: null, total: null },
          presentation: 'OUTPUT',
          truthState: 'APPROVED_OUTPUT',
          title: 'Аватар затверджено',
          status: 'Кандидат пройшов перевірку якості',
          layers: [{ ...avatar, role: 'AFTER' }],
          metrics: { attempt: checkpoint.attempts?.avatar ?? 1 },
        } : null;
      case 'OUTFIT_QA':
        return outfit ? {
          stage: 'OUTFIT_QA',
          subject: { kind: 'LOOK', index: null, total: null },
          presentation: 'QA_SCAN',
          truthState: 'QA_IN_PROGRESS',
          title: 'Перевіряємо повний образ',
          status: 'Це реальний кандидат, який ще не затверджено',
          layers: [outfit],
          metrics: { attempt: checkpoint.attempts?.outfit ?? 1 },
        } : null;
      case 'OUTFIT_READY':
      case 'EXPORTING':
      case 'COMPLETED':
        return outfit ? {
          stage: 'OUTFIT_APPROVED',
          subject: { kind: 'LOOK', index: null, total: null },
          presentation: 'OUTPUT',
          truthState: 'APPROVED_OUTPUT',
          title: 'Образ затверджено',
          status: 'Кандидат пройшов перевірку якості',
          layers: [{ ...outfit, role: 'AFTER' }],
          metrics: { attempt: checkpoint.attempts?.outfit ?? 1 },
        } : null;
      default:
        return null;
    }
  }

  async #restoreConditionedGarments(state) {
    if (!state.inputs.garments.length || !state.garments?.length) return null;
    const packPath = path.join(this.runDirectory(state.run_id), 'conditioned', 'garments', 'reference-pack.json');
    try {
      const document = JSON.parse(await readFile(packPath, 'utf8'));
      const items = state.garments.map((item) => {
        const sourceIndexes = item.source_indexes?.length ? item.source_indexes : [item.source_index];
        return {
          ...item,
          source_indexes: sourceIndexes,
          source_path: state.inputs.garments[sourceIndexes[0]],
          source_paths: sourceIndexes.map((index) => state.inputs.garments[index]),
          reference_card: { path: item.reference_card },
          cutout: { path: item.cutout },
        };
      });
      for (const item of items) {
        await access(item.reference_card.path);
        await access(item.cutout.path);
      }
      return {
        items,
        conflicts: state.conflicts ?? [],
        pack: { path: packPath, document },
        outfitText: compileFullLookText(items),
      };
    } catch {
      return null;
    }
  }

  async #buildJob(state, conditioned) {
    const jobPath = path.join(this.runDirectory(state.run_id), 'job.json');
    // A running job survives a beta release. Its checkpoint is bound to the
    // exact original job bytes, including the release-local prompt paths that
    // existed when the run began. Recompiling after a daemon restart changes
    // that hash and destroys an otherwise resumable paid generation.
    try {
      await access(jobPath);
      return jobPath;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const outfitText = conditioned?.outfitText
      ? [state.inputs.outfit_text, conditioned.outfitText].filter(Boolean).join('\n')
      : state.inputs.outfit_text;
    const hasReference = Boolean(conditioned);
    const outfit = {
      mode: hasReference ? (outfitText ? 'reference_image_plus_text' : 'reference_image') : 'text',
      ...(outfitText ? { text: outfitText } : {}),
      ...(hasReference ? {
        reference: conditioned.items[0].source_path,
        reference_pack: { path: conditioned.pack.path },
        target_region: outfitTargetRegion(conditioned.items),
        must_match: conditioned.items.flatMap(garmentLocks),
      } : {}),
    };
    const identityPack = await this.#buildIdentityPack(state);
    const job = {
      job_id: `web-${state.run_id}`, identity_reference: state.inputs.person,
      identity_reference_pack: { path: identityPack },
      output_directory: path.join(this.runDirectory(state.run_id), 'outputs'),
      prompts: {
        avatar: path.join(this.projectRoot, 'prompts', 'avatar.txt'),
        outfit: path.join(this.projectRoot, 'prompts', hasReference ? 'outfit-reference.txt' : 'outfit-text.txt'),
        repair: path.join(this.projectRoot, 'prompts', 'repair.txt'),
      },
      outfit,
      // Test fixtures never ship with a product release. Production QA relies
      // exclusively on the immutable user evidence and generated candidate.
      quality_references: [],
      model_route: [...this.generationRoute],
      max_attempts: this.generationRoute.length,
      // Conditioning is a separate evidence-preparation lane, not image
      // synthesis. Do not multiply its VLM work merely because GPT Image 2
      // has a five-step image ladder.
      conditioning_max_attempts: 2,
      ...(state.inputs.approved_avatar ? { approved_avatar_reference: state.inputs.approved_avatar } : {}),
    };
    await atomicJson(jobPath, job);
    return jobPath;
  }

  async #buildIdentityPack(state) {
    const directory = path.join(this.runDirectory(state.run_id), 'conditioned', 'identity');
    const filename = path.join(directory, 'reference-pack.json');
    try {
      JSON.parse(await readFile(filename, 'utf8'));
      return filename;
    } catch { /* a missing or incomplete pack is rebuilt from the immutable upload */ }
    await mkdir(directory, { recursive: true });
    const sources = [state.inputs.person, state.inputs.identity_detail].filter(Boolean);
    const bindings = [];
    const derivatives = [];
    for (const [index, source] of sources.entries()) {
      const normalized = await normalizeReference(source, {
        format: 'png',
        targetLongEdge: 2048,
        maxLongEdge: 4096,
        maxUpscaleFactor: 2,
      });
      const derivativePath = path.join(
        directory,
        index === 0 ? 'primary.png' : 'detail.png',
      );
      await writeFile(derivativePath, normalized.buffer);
      bindings.push({
        order: index + 1,
        role: index === 0 ? 'IDENTITY_PRIMARY' : 'FACE_DETAIL',
        path: derivativePath,
        sha256: normalized.sha256,
      });
      derivatives.push({
        role: index === 0 ? 'IDENTITY_PRIMARY' : 'FACE_DETAIL',
        parent_sha256: normalized.metadata_before.source_sha256,
        output_sha256: normalized.sha256,
        operations: normalized.operations,
        resize_plan: normalized.resize_plan,
      });
    }
    const raw = await readFile(state.inputs.person);
    const technicalAssessment = await assessImageQuality(raw, {
      hardMinWidth: 256,
      hardMinHeight: 256,
      preferredLongEdge: 1024,
      maxUpscaleFactor: 2,
      maxByteLength: 20 * 1024 * 1024,
    });
    const unknowns = [
      {
        fact_path: '/identity/body_build',
        status: 'NOT_EVALUABLE',
        reason: 'Body visibility and proportions are not inferred from an arbitrary upload.',
        handling: 'DO_NOT_INFER',
      },
      {
        fact_path: '/identity/unseen_features',
        status: 'NOT_EVALUABLE',
        reason: 'Features not visible in supplied evidence cannot become identity locks.',
        handling: 'DO_NOT_INFER',
      },
    ];
    const document = {
      schema_version: '1.0.0', asset_id: `${state.run_id}-identity`, kind: 'HUMAN',
      source: { path: path.resolve(state.inputs.person), sha256: sha256(raw), immutable: true },
      extraction: {
        method: 'user_upload_plus_deterministic_normalization',
        provenance: 'OBSERVED',
        semantic_visibility_assessment: 'DEFERRED_TO_HASH_BOUND_QA',
        unknowns,
      },
      technical_assessment: technicalAssessment,
      derivatives,
      readiness: {
        decision: 'READY',
        reasons: [
          'PRIMARY_IDENTITY_IMAGE_DECODES',
          'DETERMINISTIC_NORMALIZATION_COMPLETE',
          'UNOBSERVABLE_IDENTITY_FACTS_CARRIED_AS_NOT_EVALUABLE',
        ],
        actions: [],
        terminal: false,
        semantic_qa_required_before_export: true,
      },
      generation_bindings: bindings,
      created_at: this.clock().toISOString(),
    };
    await atomicJson(filename, document);
    return filename;
  }

  async #generateScene(state, approvedOutfitPath) {
    await this.#write(state, { phase: 'OPTIONAL_SCENE', inner_state: null, message: 'Генеруємо додатковий редакційний кадр' });
    const sceneDirectory = path.join(this.runDirectory(state.run_id), 'scene');
    for (const [index, model] of this.generationRoute.entries()) {
      const generationProfile = generationProfileForAttempt(index + 1, this.generationRoute);
      const response = await this.assetGenerator.generateScene({
        approvedOutfitPath, model, generationProfile, workDirectory: sceneDirectory, operationId: `${state.run_id}-scene-${index + 1}`,
        prompt: 'Using ATTACHMENT_1 [APPROVED_OUTFIT], create one memorable high-fashion editorial photograph with the exact same approved person and complete outfit. Preserve identity, face, hair, body proportions, every item color, texture, logo, text and fit. Place the subject in a bold contemporary editorial studio environment with sculptural light and a confident pose. No text overlay, no brand invention, no wardrobe changes.',
      });
      const candidatePath = path.join(sceneDirectory, `candidate-${index + 1}.png`);
      await mkdir(sceneDirectory, { recursive: true });
      await writeFile(candidatePath, response.image);
      const qa = await this.vlm.evaluateQa({ phase: 'scene', evidence: { avatar: { artifact: { path: approvedOutfitPath } }, candidate: { artifact: { path: candidatePath } } } });
      if (qa.decision === 'PASS') {
        const finalPath = path.join(this.runDirectory(state.run_id), 'outputs', 'art_director_scene.png');
        await writeFile(finalPath, response.image, { flag: 'wx' });
        state.outputs.art_director_scene = `/api/runs/${state.run_id}/files/art_director_scene.png`;
        state.qa.scene = qa;
        return;
      }
      if (qa.decision === 'NEEDS_INPUT' || qa.decision === 'REJECT') break;
    }
    state.qa.scene = { decision: 'SKIPPED', reason: 'Bonus scene did not pass; core outputs remain valid' };
  }

  async getRun(runId) { const state = await this.#read(runId); return state ? publicRun(state) : null; }
  subscribe(runId, listener) { this.events.on(runId, listener); return () => this.events.off(runId, listener); }

  async visualAsset(runId, assetId) {
    if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) return null;
    const state = await this.#read(runId);
    if (!state) return null;
    return readVisualAsset(state, this.runDirectory(runId), assetId);
  }

  async #readApprovedItemEvidenceFile(filename, allowedDirectory, label, maxBytes) {
    const resolvedRoot = this.rootDirectory;
    const resolvedAllowedDirectory = path.resolve(allowedDirectory);
    const resolvedFilename = path.resolve(filename);
    if (!isInside(resolvedRoot, resolvedAllowedDirectory)
      || !isInside(resolvedAllowedDirectory, resolvedFilename)) {
      throw evidenceError('APPROVED_ITEM_EVIDENCE_PATH_ESCAPE', `${label} escapes its run evidence directory`);
    }

    const relative = path.relative(resolvedRoot, resolvedFilename);
    let cursor = resolvedRoot;
    let finalInfo = null;
    for (const [index, segment] of relative.split(path.sep).filter(Boolean).entries()) {
      cursor = path.join(cursor, segment);
      let info;
      try {
        info = await lstat(cursor);
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw evidenceError('APPROVED_ITEM_EVIDENCE_MISSING', `${label} is missing`);
        }
        throw error;
      }
      if (info.isSymbolicLink()) {
        throw evidenceError('APPROVED_ITEM_EVIDENCE_SYMLINK', `${label} must not use symbolic links`);
      }
      const isFinal = index === relative.split(path.sep).filter(Boolean).length - 1;
      if ((isFinal && !info.isFile()) || (!isFinal && !info.isDirectory())) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID_FILE',
          `${label} must be a regular file below regular directories`,
        );
      }
      if (isFinal) finalInfo = info;
    }
    if (!finalInfo) {
      throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID_FILE', `${label} must be a regular file`);
    }
    if (finalInfo.size <= 0 || finalInfo.size > maxBytes) {
      throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID_FILE', `${label} has an invalid size`);
    }

    let realRoot;
    let realAllowedDirectory;
    let realFilename;
    try {
      [realRoot, realAllowedDirectory, realFilename] = await Promise.all([
        realpath(resolvedRoot),
        realpath(resolvedAllowedDirectory),
        realpath(resolvedFilename),
      ]);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw evidenceError('APPROVED_ITEM_EVIDENCE_MISSING', `${label} is missing`);
      }
      throw error;
    }
    if (!isInside(realRoot, realAllowedDirectory)
      || !isInside(realAllowedDirectory, realFilename)) {
      throw evidenceError('APPROVED_ITEM_EVIDENCE_PATH_ESCAPE', `${label} escapes its run evidence directory`);
    }
    const bytes = await readFile(realFilename);
    if (bytes.length <= 0 || bytes.length > maxBytes) {
      throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID_FILE', `${label} has an invalid size`);
    }
    return bytes;
  }

  /**
   * Return the verified identity image used by downstream appearance-bound
   * video. Bytes only: callers never receive a run-local filesystem path.
   */
  async approvedIdentityReferenceForRun(runId) {
    if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) {
      throw evidenceError('APPROVED_IDENTITY_REFERENCE_INVALID', 'Run id is invalid');
    }
    const directory = path.join(this.runDirectory(runId), 'conditioned', 'identity');
    const packPath = path.join(directory, 'reference-pack.json');
    const packBytes = await this.#readApprovedItemEvidenceFile(
      packPath,
      directory,
      'Identity reference pack',
      MAX_APPROVED_ITEM_PACK_BYTES,
    );
    let pack;
    try {
      pack = JSON.parse(packBytes.toString('utf8'));
    } catch {
      throw evidenceError(
        'APPROVED_IDENTITY_REFERENCE_INVALID',
        'Identity reference pack is not valid JSON',
      );
    }
    const binding = pack?.generation_bindings?.find(
      (candidate) => candidate?.order === 1 && candidate?.role === 'IDENTITY_PRIMARY',
    );
    if (pack?.schema_version !== '1.0.0'
      || pack.kind !== 'HUMAN'
      || pack.readiness?.decision !== 'READY'
      || !binding
      || !SHA256.test(binding.sha256 ?? '')
      || typeof binding.path !== 'string') {
      throw evidenceError(
        'APPROVED_IDENTITY_REFERENCE_INVALID',
        'Identity reference pack is incomplete',
      );
    }
    const deterministicPath = path.join(directory, 'primary.png');
    const relocationSuffix = path.join('conditioned', 'identity', 'primary.png');
    const declaredPath = path.resolve(binding.path);
    const referencePath = isInside(directory, declaredPath)
      ? declaredPath
      : (declaredPath.endsWith(`${path.sep}${relocationSuffix}`)
        ? deterministicPath
        : null);
    if (!referencePath) {
      throw evidenceError(
        'APPROVED_IDENTITY_REFERENCE_PATH_ESCAPE',
        'Identity reference escapes its run directory',
      );
    }
    const data = await this.#readApprovedItemEvidenceFile(
      referencePath,
      directory,
      'Identity reference',
      MAX_APPROVED_ITEM_CUTOUT_BYTES,
    );
    if (sha256(data) !== binding.sha256) {
      throw evidenceError(
        'APPROVED_IDENTITY_REFERENCE_HASH_MISMATCH',
        'Identity reference SHA-256 mismatch',
      );
    }
    return {
      role: 'identity_face',
      data,
      sha256: binding.sha256,
      media_type: 'image/png',
    };
  }

  /**
   * Return the optional face-detail derivative for Fashion Video only when its
   * exact persisted pixels independently pass the white-background contract.
   * A missing or non-white detail is simply omitted: the approved white master
   * remains Image 1 and already carries the authoritative identity.
   */
  async approvedIdentityFaceReferenceForRun(runId) {
    if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) {
      throw evidenceError('APPROVED_IDENTITY_FACE_REFERENCE_INVALID', 'Run id is invalid');
    }
    const directory = path.join(this.runDirectory(runId), 'conditioned', 'identity');
    const packPath = path.join(directory, 'reference-pack.json');
    let packBytes;
    try {
      packBytes = await this.#readApprovedItemEvidenceFile(
        packPath,
        directory,
        'Identity reference pack',
        MAX_APPROVED_ITEM_PACK_BYTES,
      );
    } catch (error) {
      if (error?.code === 'APPROVED_ITEM_EVIDENCE_MISSING') return null;
      throw error;
    }
    let pack;
    try {
      pack = JSON.parse(packBytes.toString('utf8'));
    } catch {
      throw evidenceError(
        'APPROVED_IDENTITY_FACE_REFERENCE_INVALID',
        'Identity reference pack is not valid JSON',
      );
    }
    if (pack?.schema_version !== '1.0.0'
      || pack.kind !== 'HUMAN'
      || pack.readiness?.decision !== 'READY'
      || !Array.isArray(pack.generation_bindings)) {
      throw evidenceError(
        'APPROVED_IDENTITY_FACE_REFERENCE_INVALID',
        'Identity reference pack is incomplete',
      );
    }
    const binding = pack.generation_bindings.find((candidate) => (
      candidate?.role === 'FACE_DETAIL' || candidate?.role === 'IDENTITY_FACE_DETAIL'
    ));
    if (!binding) return null;
    if (!Number.isInteger(binding.order)
      || binding.order < 2
      || !SHA256.test(binding.sha256 ?? '')
      || typeof binding.path !== 'string') {
      throw evidenceError(
        'APPROVED_IDENTITY_FACE_REFERENCE_INVALID',
        'Identity face-detail binding is incomplete',
      );
    }

    const deterministicPath = path.join(directory, 'detail.png');
    const relocationSuffix = path.join('conditioned', 'identity', 'detail.png');
    const declaredPath = path.resolve(binding.path);
    const referencePath = isInside(directory, declaredPath)
      ? declaredPath
      : (declaredPath.endsWith(`${path.sep}${relocationSuffix}`)
        ? deterministicPath
        : null);
    if (!referencePath) {
      throw evidenceError(
        'APPROVED_IDENTITY_FACE_REFERENCE_PATH_ESCAPE',
        'Identity face-detail reference escapes its run directory',
      );
    }
    const data = await this.#readApprovedItemEvidenceFile(
      referencePath,
      directory,
      'Identity face-detail reference',
      MAX_APPROVED_ITEM_CUTOUT_BYTES,
    );
    if (sha256(data) !== binding.sha256) {
      throw evidenceError(
        'APPROVED_IDENTITY_FACE_REFERENCE_HASH_MISMATCH',
        'Identity face-detail reference SHA-256 mismatch',
      );
    }
    const inspected = await inspectImage(referencePath);
    const technicalPass = Object.values(inspected.technical_gates ?? {})
      .every((gate) => gate?.status === QA_STATUS.PASS);
    if (!technicalPass || inspected.background_diagnostics?.status !== QA_STATUS.PASS) {
      return null;
    }
    if (inspected.sha256 !== binding.sha256) {
      throw evidenceError(
        'APPROVED_IDENTITY_FACE_REFERENCE_HASH_MISMATCH',
        'Identity face-detail reference changed during verification',
      );
    }
    return {
      role: 'identity_face',
      data,
      sha256: binding.sha256,
      media_type: 'image/png',
      white_background_verified: true,
      background_diagnostics: inspected.background_diagnostics,
    };
  }

  /**
   * Resolves the immutable, per-item evidence used to generate a completed
   * garment-backed look. The returned object intentionally contains logical
   * facts and bytes only: filesystem paths and raw source-pack fields never
   * leave RunService.
   */
  async approvedItemEvidenceForRun(runId, options = {}) {
    const base = await this.#baseApprovedItemEvidenceForRun(runId, options);
    const directory = path.join(this.runDirectory(runId), 'conditioned', 'first-appearance');
    const recordPath = path.join(directory, 'lock.json');
    let recordBytes;
    try { recordBytes = await readFile(recordPath); } catch { return base; }
    let record;
    try { record = JSON.parse(recordBytes.toString('utf8')); } catch {
      throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', 'First-appearance lock is not valid JSON');
    }
    if (record?.schema_version !== '1.0.0'
      || record.kind !== 'FIRST_APPEARANCE_ITEM_LOCK'
      || record.run_id !== runId
      || (options.expectedLookSha256 !== undefined && record.approved_look_sha256 !== options.expectedLookSha256)
      || record.provenance !== 'OBSERVED_FROM_APPROVED_LOOK'
      || record.immutable_after_creation !== true
      || !Array.isArray(record.items)) {
      throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', 'First-appearance lock is not bound to this approved look');
    }
    const known = new Set((base?.items ?? []).map((item) => item.category));
    const nextIndex = Math.max(-1, ...(base?.items ?? []).flatMap((item) => item.source_indexes ?? [])) + 1;
    const locked = [];
    for (const [index, item] of record.items.entries()) {
      if (!['bottom', 'footwear'].includes(item?.category)
        || item.role !== `GARMENT_${item.category.toUpperCase()}`
        || !SHA256.test(item.cutout?.sha256 ?? '') || typeof item.cutout?.path !== 'string') {
        throw evidenceError('APPROVED_ITEM_EVIDENCE_INVALID', 'First-appearance item is invalid');
      }
      // A user-supplied approved garment is the higher-authority reference.
      // First-appearance capture only fills categories absent from that pack;
      // an accidentally duplicated lower-body crop must not replace or block it.
      if (known.has(item.category)) continue;
      const declaredFilename = path.resolve(item.cutout.path);
      const deterministicFilename = path.join(
        directory,
        String(index + 1).padStart(2, '0'),
        'cutout.png',
      );
      const relocationSuffix = path.join(
        'conditioned',
        'first-appearance',
        String(index + 1).padStart(2, '0'),
        'cutout.png',
      );
      const filename = isInside(directory, declaredFilename)
        ? declaredFilename
        : (declaredFilename.endsWith(`${path.sep}${relocationSuffix}`)
          ? deterministicFilename
          : null);
      if (!filename) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_PATH_ESCAPE',
          'First-appearance cutout escapes its lock directory',
        );
      }
      const data = await this.#readApprovedItemEvidenceFile(filename, directory, 'First-appearance cutout', MAX_APPROVED_ITEM_CUTOUT_BYTES);
      if (sha256(data) !== item.cutout.sha256) throw evidenceError('APPROVED_ITEM_EVIDENCE_HASH_MISMATCH', 'First-appearance cutout SHA-256 mismatch');
      locked.push({
        order: (base?.items.length ?? 0) + index + 1,
        role: item.role,
        category: item.category,
        reference_set_id: item.reference_set_id,
        source_indexes: [nextIndex + index],
        same_item_confidence: item.same_item_confidence,
        grouping_evidence: item.grouping_evidence,
        confidence: item.confidence,
        observed: item.observed,
        unknowns: item.unknowns,
        sha256: item.cutout.sha256,
        media_type: 'image/png',
        data,
      });
    }
    const all = [...(base?.items ?? []), ...locked];
    if (!all.length) return null;
    return {
      schema_version: '1.0.0', kind: 'APPROVED_ITEM_EVIDENCE', source_run_id: runId,
      reference_pack: base?.reference_pack ?? {
        schema_version: '1.0.0', asset_id: `${runId}-wardrobe`, kind: 'GARMENT',
        sha256: sha256(recordBytes), extraction: { method: 'first_appearance_crop', provenance: 'OBSERVED' },
        readiness: { decision: 'READY', reasons: ['FIRST_APPEARANCE_LOCKED_FROM_APPROVED_LOOK'], actions: [], terminal: false },
      },
      items: all,
    };
  }

  async #baseApprovedItemEvidenceForRun(runId, {
    expectedReceiptSha256,
    expectedLookSha256,
  } = {}) {
    if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) {
      throw evidenceError('APPROVED_ITEM_EVIDENCE_RUN_INVALID', 'Approved item evidence run id is invalid');
    }
    if (expectedReceiptSha256 !== undefined && !SHA256.test(expectedReceiptSha256)) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_RECEIPT_INVALID',
        'Approved item evidence receipt SHA-256 is invalid',
      );
    }
    if (expectedLookSha256 !== undefined && !SHA256.test(expectedLookSha256)) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_RECEIPT_INVALID',
        'Approved look SHA-256 is invalid',
      );
    }
    const state = await this.#read(runId);
    if (!state || state.status !== 'COMPLETED') {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_RUN_NOT_COMPLETED',
        'Approved item evidence requires a completed run',
      );
    }
    if (!Array.isArray(state.inputs?.garments)) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_RUN_INVALID',
        'Completed run garment inputs are invalid',
      );
    }
    if (state.inputs.garments.length === 0) return null;

    const garmentDirectory = path.join(this.runDirectory(runId), 'conditioned', 'garments');
    const packPath = path.join(garmentDirectory, 'reference-pack.json');
    const packBytes = await this.#readApprovedItemEvidenceFile(
      packPath,
      garmentDirectory,
      'Approved item reference pack',
      MAX_APPROVED_ITEM_PACK_BYTES,
    );
    let pack;
    try {
      pack = JSON.parse(packBytes.toString('utf8'));
    } catch {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_INVALID',
        'Approved item reference pack is not valid JSON',
      );
    }
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)
      || pack.schema_version !== '1.0.0'
      || pack.asset_id !== `${runId}-wardrobe`
      || pack.kind !== 'GARMENT'
      || pack.extraction?.provenance !== 'OBSERVED'
      || pack.readiness?.decision !== 'READY'
      || pack.readiness?.terminal !== false) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_INVALID',
        'Approved item reference pack is not the READY observed pack for this run',
      );
    }
    const packSha256 = sha256(packBytes);
    const checkpointDirectory = path.join(
      this.runDirectory(runId),
      'outputs',
      '.zeely-run',
    );
    const checkpointBytes = await this.#readApprovedItemEvidenceFile(
      path.join(checkpointDirectory, 'checkpoint.json'),
      checkpointDirectory,
      'Completed run checkpoint',
      MAX_APPROVED_ITEM_CHECKPOINT_BYTES,
    );
    let checkpoint;
    try {
      checkpoint = JSON.parse(checkpointBytes.toString('utf8'));
    } catch {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_CHECKPOINT_INVALID',
        'Completed run checkpoint is not valid JSON',
      );
    }
    const runDirectory = this.runDirectory(runId);
    const outputDirectory = path.join(runDirectory, 'outputs');
    const manifestBytes = await this.#readApprovedItemEvidenceFile(
      path.join(outputDirectory, 'run-manifest.json'),
      outputDirectory,
      'Completed run manifest',
      MAX_APPROVED_ITEM_MANIFEST_BYTES,
    );
    if (expectedReceiptSha256 !== undefined && sha256(manifestBytes) !== expectedReceiptSha256) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_RECEIPT_MISMATCH',
        'Completed run manifest no longer matches the saved-look receipt',
      );
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'));
    } catch {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_RECEIPT_INVALID',
        'Completed run manifest is not valid JSON',
      );
    }
    const jobPath = path.join(runDirectory, 'job.json');
    if (!hasRunArtifactSuffix(checkpoint?.job_source, runId, 'job.json')) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_EXECUTION_MISMATCH',
        'Completed run checkpoint is not bound to its immutable job source',
      );
    }
    const jobBytes = await this.#readApprovedItemEvidenceFile(
      jobPath,
      runDirectory,
      'Completed run job',
      MAX_APPROVED_ITEM_JOB_BYTES,
    );
    let jobHash;
    let executionHash;
    let rawJob;
    try {
      rawJob = JSON.parse(jobBytes.toString('utf8'));
      jobHash = sha256(jobBytes);
      executionHash = sha256(`${jobHash}:${JSON.stringify(checkpoint.inputs)}`);
    } catch {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_EXECUTION_MISMATCH',
        'Completed run inputs no longer reproduce their immutable execution receipt',
      );
    }
    if (rawJob?.job_id !== `web-${runId}`
      || manifest?.job_id !== `web-${runId}`
      || manifest.state !== 'COMPLETED'
      || manifest.job_hash !== jobHash
      || manifest.execution_hash !== executionHash
      || checkpoint?.job_hash !== jobHash
      || checkpoint?.execution_hash !== executionHash
      || (expectedLookSha256 !== undefined
        && manifest.outputs?.avatar_outfit?.sha256 !== expectedLookSha256)) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_EXECUTION_MISMATCH',
        'Approved item evidence does not match the completed immutable execution receipt',
      );
    }
    const checkpointPack = checkpoint?.inputs?.outfit_reference_pack;
    if (checkpoint?.state !== 'COMPLETED'
      || checkpoint.job_id !== `web-${runId}`
      || checkpointPack?.kind !== 'REFERENCE_PACK'
      || checkpointPack?.scope !== 'outfit'
      || !hasRunArtifactSuffix(
        checkpointPack?.path,
        runId,
        'conditioned/garments/reference-pack.json',
      )
      || checkpointPack?.sha256 !== packSha256) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_CHECKPOINT_MISMATCH',
        'Approved item reference pack is not bound to the completed run checkpoint',
      );
    }
    const bindings = pack.generation_bindings;
    const extractedItems = pack.extraction?.items;
    if (!Array.isArray(bindings)
      || bindings.length === 0
      || bindings.length > 5
      || !Array.isArray(extractedItems)
      || extractedItems.length !== bindings.length) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_INVALID',
        'Approved item reference pack bindings and extracted facts are incomplete',
      );
    }
    const checkpointBindings = Object.entries(checkpoint.inputs)
      .filter(([key]) => /^outfit_reference_pack_binding_\d{3}$/.test(key))
      .map(([, value]) => value)
      .sort((left, right) => left.binding_order - right.binding_order);
    if (checkpointBindings.length !== bindings.length) {
      throw evidenceError(
        'APPROVED_ITEM_EVIDENCE_CHECKPOINT_MISMATCH',
        'Approved item bindings do not match the completed run checkpoint',
      );
    }

    const logicalFacts = extractedItems.map(logicalItemFacts);
    const seenReferenceSetIds = new Set();
    const seenSourceIndexes = new Set();
    for (const [index, facts] of logicalFacts.entries()) {
      if (seenReferenceSetIds.has(facts.reference_set_id)) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID',
          `Approved item facts ${index + 1} repeat reference_set_id`,
        );
      }
      seenReferenceSetIds.add(facts.reference_set_id);
      for (const sourceIndex of facts.source_indexes) {
        if (sourceIndex >= state.inputs.garments.length || seenSourceIndexes.has(sourceIndex)) {
          throw evidenceError(
            'APPROVED_ITEM_EVIDENCE_INVALID',
            `Approved item facts ${index + 1} have invalid or overlapping source indexes`,
          );
        }
        seenSourceIndexes.add(sourceIndex);
      }
    }
    const seenOrders = new Set();
    const items = [];
    const sortedBindings = bindings.map((binding, index) => {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)
        || !Number.isInteger(binding.order)
        || binding.order < 1
        || binding.order > bindings.length
        || seenOrders.has(binding.order)) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID',
          `Approved item binding ${index + 1} has an invalid or duplicate order`,
        );
      }
      seenOrders.add(binding.order);
      return binding;
    }).sort((left, right) => left.order - right.order);

    for (const [index, binding] of sortedBindings.entries()) {
      if (binding.order !== index + 1) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID',
          'Approved item binding orders must be contiguous from 1',
        );
      }
      const facts = logicalFacts[index];
      const expectedRole = `GARMENT_${facts.category.toUpperCase()}`;
      const bindingId = binding.binding_id === undefined
        ? null
        : safeEvidenceText(
          binding.binding_id,
          `generation_bindings[${index}].binding_id`,
          { maxLength: 128 },
        );
      if (binding.role !== expectedRole
        || (bindingId !== null && bindingId !== facts.reference_set_id)) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID',
          `Approved item binding ${binding.order} does not match its extracted facts`,
        );
      }
      if (typeof binding.path !== 'string'
        || binding.path.trim() === ''
        || /^[a-z][a-z0-9+.-]*:/i.test(binding.path)) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID',
          `Approved item binding ${binding.order} path is invalid`,
        );
      }
      if (typeof binding.sha256 !== 'string' || !SHA256.test(binding.sha256)) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID',
          `Approved item binding ${binding.order} SHA-256 is invalid`,
        );
      }
      const cutoutRelativePath = path.isAbsolute(binding.path)
        ? (() => {
          const marker = `${path.sep}${runId}${path.sep}conditioned${path.sep}garments${path.sep}`;
          const resolved = path.resolve(binding.path);
          const markerIndex = resolved.lastIndexOf(marker);
          return markerIndex < 0 ? null : resolved.slice(markerIndex + marker.length);
        })()
        : binding.path;
      const cutoutPath = cutoutRelativePath === null
        ? null
        : path.resolve(garmentDirectory, cutoutRelativePath);
      if (path.isAbsolute(binding.path) && cutoutRelativePath === null) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_PATH_ESCAPE',
          `Approved item binding ${binding.order} escapes its run evidence directory`,
        );
      }
      if (!cutoutPath || path.basename(cutoutPath) !== 'cutout.png') {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID',
          `Approved item binding ${binding.order} is not a canonical cutout`,
        );
      }
      const checkpointBinding = checkpointBindings[index];
      if (!checkpointBinding
        || checkpointBinding.kind !== 'REFERENCE_PACK_MEDIA'
        || checkpointBinding.scope !== 'outfit'
        || checkpointBinding.binding_order !== binding.order
        || checkpointBinding.role !== expectedRole
        || checkpointBinding.sha256 !== binding.sha256
        || checkpointBinding.declared_sha256 !== binding.sha256
        || (bindingId !== null && checkpointBinding.binding_id !== bindingId)
        || (bindingId === null && checkpointBinding.binding_id !== undefined)
        || !hasRunArtifactSuffix(
          checkpointBinding.path,
          runId,
          `conditioned/garments/${cutoutRelativePath.replaceAll(path.sep, '/')}`,
        )) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_CHECKPOINT_MISMATCH',
          `Approved item binding ${binding.order} is not bound to the completed run checkpoint`,
        );
      }
      const data = await this.#readApprovedItemEvidenceFile(
        cutoutPath,
        garmentDirectory,
        `Approved item binding ${binding.order}`,
        MAX_APPROVED_ITEM_CUTOUT_BYTES,
      );
      if (sha256(data) !== binding.sha256) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_HASH_MISMATCH',
          `Approved item binding ${binding.order} SHA-256 mismatch`,
        );
      }
      let metadata;
      try {
        metadata = await sharp(data).metadata();
      } catch {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID_IMAGE',
          `Approved item binding ${binding.order} is not a decodable image`,
        );
      }
      if (metadata.format !== 'png'
        || !metadata.width
        || !metadata.height
        || (metadata.pages ?? 1) !== 1) {
        throw evidenceError(
          'APPROVED_ITEM_EVIDENCE_INVALID_IMAGE',
          `Approved item binding ${binding.order} must be one PNG image`,
        );
      }
      items.push({
        order: binding.order,
        role: expectedRole,
        ...facts,
        sha256: binding.sha256,
        media_type: 'image/png',
        data,
      });
    }

    return {
      schema_version: '1.0.0',
      kind: 'APPROVED_ITEM_EVIDENCE',
      source_run_id: runId,
      reference_pack: {
        schema_version: pack.schema_version,
        asset_id: safeEvidenceText(pack.asset_id, 'reference_pack.asset_id', { maxLength: 160 }),
        kind: pack.kind,
        sha256: packSha256,
        extraction: {
          method: safeEvidenceText(
            pack.extraction.method,
            'reference_pack.extraction.method',
            { maxLength: 160 },
          ),
          provenance: pack.extraction.provenance,
        },
        readiness: {
          decision: pack.readiness.decision,
          reasons: safeEvidenceStringArray(
            pack.readiness.reasons,
            'reference_pack.readiness.reasons',
          ),
          actions: safeEvidenceStringArray(
            pack.readiness.actions,
            'reference_pack.readiness.actions',
          ),
          terminal: pack.readiness.terminal,
        },
      },
      items,
    };
  }

  async approvedAvatarReferenceForRun(runId) {
    const verified = await this.#verifyCompletedOutputSet(runId);
    const avatarPath = verified.avatar;
    const receiptPath = verified.manifest;
    const [avatarBytes, receiptBytes] = await Promise.all([readFile(avatarPath), readFile(receiptPath)]);
    return {
      path: avatarPath,
      sha256: sha256(avatarBytes),
      source_run_id: runId,
      qa_receipt: { path: receiptPath, sha256: sha256(receiptBytes), decision: 'PASS' },
    };
  }

  async #verifyCompletedOutputSet(runId) {
    if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) {
      throw new Error('Completed output run id is invalid');
    }
    const state = await this.#read(runId);
    if (!state || state.status !== 'COMPLETED') {
      throw new Error('Completed output source run must exist and be completed');
    }
    const outputDirectory = path.join(this.runDirectory(runId), 'outputs');
    const paths = {
      avatar: path.join(outputDirectory, 'avatar.png'),
      outfit: path.join(outputDirectory, 'avatar_outfit.png'),
      manifest: path.join(outputDirectory, 'run-manifest.json'),
    };
    const manifestBytes = await readFile(paths.manifest);
    let materializedManifest;
    try {
      materializedManifest = JSON.parse(manifestBytes.toString('utf8'));
    } catch {
      throw new Error('Completed run manifest is not valid JSON');
    }

    const checkpointPath = path.join(outputDirectory, '.zeely-run', 'checkpoint.json');
    let checkpoint = null;
    try {
      checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Completed run checkpoint is invalid');
    }
    const phases = ['conditioning', 'avatar', 'outfit'];
    const strictReceiptMarker = phases.some((phase) => (
      typeof state.qa?.[phase]?.receipt_id === 'string'
      || typeof materializedManifest.qa?.[phase]?.receipt_id === 'string'
      || typeof checkpoint?.qa?.[phase]?.receipt_id === 'string'
    ));
    const strictArtifactMarker = Boolean(checkpoint?.artifacts?.run_manifest);

    if (!strictReceiptMarker && !strictArtifactMarker) {
      const [avatarBytes, outfitBytes] = await Promise.all([
        readFile(paths.avatar),
        readFile(paths.outfit),
      ]);
      if (!avatarBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        || !outfitBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        || materializedManifest.schema_version !== '1.0.0'
        || materializedManifest.job_id !== `web-${runId}`
        || materializedManifest.state !== 'COMPLETED'
        || materializedManifest.outputs?.avatar?.sha256 !== sha256(avatarBytes)
        || materializedManifest.outputs?.avatar_outfit?.sha256 !== sha256(outfitBytes)
        || phases.some((phase) => materializedManifest.qa?.[phase]?.decision !== 'PASS')) {
        throw new Error('Legacy completed outputs are not bound to their PASS manifest');
      }
      return paths;
    }

    if (!checkpoint || checkpoint.state !== 'COMPLETED') {
      throw new Error('Strict completed output checkpoint is missing');
    }
    const store = new FilesystemArtifactStore(path.join(outputDirectory, '.zeely-run'));
    const relocateArtifact = (artifact) => {
      if (!artifact
        || typeof artifact.path !== 'string'
        || !SHA256.test(artifact.digest ?? '')
        || typeof artifact.extension !== 'string') return artifact;
      const filename = `${artifact.digest}${artifact.extension}`;
      const currentPath = path.join(
        outputDirectory,
        '.zeely-run',
        'artifacts',
        'sha256',
        filename,
      );
      const relocationSuffix = path.join(
        'outputs',
        '.zeely-run',
        'artifacts',
        'sha256',
        filename,
      );
      if (path.resolve(artifact.path) === currentPath
        || path.resolve(artifact.path).endsWith(`${path.sep}${relocationSuffix}`)) {
        return { ...artifact, path: currentPath };
      }
      return artifact;
    };
    const avatarArtifact = relocateArtifact(checkpoint.artifacts?.avatar?.artifact);
    const outfitArtifact = relocateArtifact(checkpoint.artifacts?.outfit?.artifact);
    const manifestArtifact = relocateArtifact(checkpoint.artifacts?.run_manifest);
    if (avatarArtifact?.extension !== '.png'
      || avatarArtifact?.mediaType !== 'image/png'
      || outfitArtifact?.extension !== '.png'
      || outfitArtifact?.mediaType !== 'image/png') {
      throw new Error('Strict completed output artifact metadata is invalid');
    }
    const [avatarArtifactBytes, outfitArtifactBytes, storedManifest] = await Promise.all([
      store.readArtifact(avatarArtifact),
      store.readArtifact(outfitArtifact),
      store.readJsonArtifact(manifestArtifact),
    ]);
    if (!avatarArtifactBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      || !outfitArtifactBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error('Strict completed output is not a PNG image');
    }

    const verifiedReceipts = {};
    for (const phase of phases) {
      const result = checkpoint.qa?.[phase];
      const attempt = checkpoint.attempts?.[phase];
      if (!result?.artifact || !Number.isInteger(attempt)) {
        throw new Error(`Strict ${phase} QA receipt is missing`);
      }
      const receipt = await store.readJsonArtifact(relocateArtifact(result.artifact));
      const verified = verifyCoreQaReceipt(receipt, {
        phase,
        attempt,
        jobId: checkpoint.job_id,
        runId: checkpoint.run_id,
        receiptId: result.receipt_id,
        requirePass: true,
      });
      if (result.subject_sha256 !== verified.subject.sha256
        || result.evidence_manifest_sha256 !== verified.evidence.manifest_sha256
        || result.prompt_sha256 !== verified.evidence.prompt_sha256) {
        throw new Error(`Strict ${phase} QA checkpoint binding is stale`);
      }
      const publicQa = storedManifest.qa?.[phase];
      if (publicQa?.decision !== 'PASS'
        || publicQa.receipt_id !== verified.receipt_id
        || publicQa.subject_sha256 !== verified.subject.sha256
        || publicQa.evidence_manifest_sha256 !== verified.evidence.manifest_sha256
        || publicQa.prompt_sha256 !== verified.evidence.prompt_sha256
        || publicQa.artifact?.digest !== result.artifact.digest) {
        throw new Error(`Strict ${phase} QA manifest binding is stale`);
      }
      verifiedReceipts[phase] = verified;
    }
    if (verifiedReceipts.avatar.subject.sha256 !== avatarArtifact.digest
      || verifiedReceipts.outfit.subject.sha256 !== outfitArtifact.digest) {
      throw new Error('Strict image outputs do not match their semantic QA subjects');
    }
    if (storedManifest.schema_version !== '1.0.0'
      || storedManifest.run_id !== checkpoint.run_id
      || storedManifest.job_id !== checkpoint.job_id
      || storedManifest.job_id !== `web-${runId}`
      || storedManifest.job_hash !== checkpoint.job_hash
      || storedManifest.execution_hash !== checkpoint.execution_hash
      || storedManifest.state !== 'COMPLETED'
      || storedManifest.outputs?.avatar?.sha256 !== avatarArtifact.digest
      || storedManifest.outputs?.avatar_outfit?.sha256 !== outfitArtifact.digest) {
      throw new Error('Strict completed manifest is stale');
    }
    const matchesRelocatedOutput = (declared, current, filename) => (
      declared === current
      || (typeof declared === 'string'
        && path.resolve(declared).endsWith(
          `${path.sep}runs${path.sep}${runId}${path.sep}outputs${path.sep}${filename}`,
        ))
    );
    if (!matchesRelocatedOutput(checkpoint.outputs?.avatar, paths.avatar, 'avatar.png')
      || !matchesRelocatedOutput(checkpoint.outputs?.avatar_outfit, paths.outfit, 'avatar_outfit.png')
      || !matchesRelocatedOutput(checkpoint.outputs?.manifest, paths.manifest, 'run-manifest.json')) {
      throw new Error('Strict completed output paths are stale');
    }

    const [avatarBytes, outfitBytes] = await Promise.all([
      readFile(paths.avatar),
      readFile(paths.outfit),
    ]);
    if (sha256(avatarBytes) !== avatarArtifact.digest
      || sha256(outfitBytes) !== outfitArtifact.digest
      || sha256(manifestBytes) !== manifestArtifact.digest) {
      throw new Error('Materialized completed output failed integrity verification');
    }
    return paths;
  }

  async outputFile(runId, name) {
    const allowed = new Set(['avatar.png', 'avatar_outfit.png', 'art_director_scene.png', 'run-manifest.json']);
    if (!allowed.has(name)) return null;
    if (name !== 'art_director_scene.png') {
      try {
        const verified = await this.#verifyCompletedOutputSet(runId);
        return ({
          'avatar.png': verified.avatar,
          'avatar_outfit.png': verified.outfit,
          'run-manifest.json': verified.manifest,
        })[name];
      } catch {
        return null;
      }
    }
    const filename = path.join(this.runDirectory(runId), 'outputs', name);
    try { await access(filename); return filename; } catch { return null; }
  }

  /**
   * Fashion Video may receive only the approved full-look master, never the
   * original user upload or an identity-pack photo. Verify the same keyable
   * white surface again at this downstream boundary so an arbitrary image path
   * cannot become `[Image 1]` by accident.
   */
  async approvedWhiteMasterReferenceForRun(runId) {
    const filename = await this.outputFile(runId, 'avatar_outfit.png');
    if (!filename) {
      throw evidenceError('APPROVED_WHITE_MASTER_MISSING', 'Approved white master is missing');
    }
    // Footwear legitimately reaches the lower edge of a full-length master.
    // The inspector therefore gates both upper corners and a full-height side,
    // rather than mistaking a sole at the bottom for a non-white background.
    const inspected = await inspectImage(filename);
    const technicalPass = Object.values(inspected.technical_gates ?? {})
      .every((gate) => gate?.status === QA_STATUS.PASS);
    if (!technicalPass || inspected.background_diagnostics?.status !== QA_STATUS.PASS) {
      throw evidenceError(
        'APPROVED_WHITE_MASTER_INVALID',
        'Fashion Video requires the approved full-look master on exact white; original input photos are not allowed',
      );
    }
    const data = await readFile(filename);
    if (sha256(data) !== inspected.sha256) {
      throw evidenceError('APPROVED_WHITE_MASTER_HASH_MISMATCH', 'Approved white master changed during verification');
    }
    return {
      role: 'approved_white_master',
      path: filename,
      data,
      sha256: inspected.sha256,
      white_background_verified: true,
      source_capabilities: await fullLengthSourceCapability(filename),
      background_diagnostics: inspected.background_diagnostics,
    };
  }

  async garmentSourceFile(runId, sourceIndex) {
    const state = await this.#read(runId);
    const index = Number(sourceIndex);
    if (!state || !Number.isInteger(index) || index < 0 || index >= state.inputs.garments.length) return null;
    const filename = state.inputs.garments[index];
    try { await access(filename); return filename; } catch { return null; }
  }

  // Raw person inputs are never part of the ordinary profile API. The only
  // caller is the separately authenticated, read-only God View route.
  async personSourceFile(runId) {
    const state = await this.#read(runId);
    const filename = state?.inputs?.person;
    if (typeof filename !== 'string') return null;
    try { await access(filename); return filename; } catch { return null; }
  }

  async identityDetailSourceFile(runId) {
    const state = await this.#read(runId);
    const filename = state?.inputs?.identity_detail;
    if (typeof filename !== 'string') return null;
    try { await access(filename); return filename; } catch { return null; }
  }

  async selectGarments(runId, selections) {
    const state = await this.#read(runId);
    if (!state) return null;
    if (state.status !== 'NEEDS_INPUT' || state.error?.name !== 'GarmentNeedsInputError') throw new Error('Цей запуск не очікує вибору речі');
    const duplicateConflicts = (state.conflicts ?? []).filter((conflict) => conflict.type === 'DUPLICATE_SLOT');
    if (!duplicateConflicts.length) throw new Error('Цей конфлікт речей не можна вирішити вибором категорії');
    const normalized = {};
    for (const conflict of duplicateConflicts) {
      const selected = selections?.[conflict.category];
      if (!conflict.reference_set_ids.includes(selected)) throw new Error(`Оберіть рівно один варіант для категорії ${conflict.category}`);
      normalized[conflict.category] = selected;
    }
    await rm(path.join(this.runDirectory(runId), 'conditioned', 'garments'), { recursive: true, force: true });
    await rm(path.join(this.runDirectory(runId), 'outputs'), { recursive: true, force: true });
    // A user-selected alternative garment is a new immutable input contract.
    // Only this explicit branch may discard the former job before rebuilding.
    await rm(path.join(this.runDirectory(runId), 'job.json'), { force: true });
    state.inputs.garment_passport = state.error.details.passport;
    state.inputs.garment_selections = normalized;
    resetVisualState(state);
    state.visual_runner_retry_marker = null;
    await this.#write(state, { status: 'QUEUED', phase: 'UPLOADED', inner_state: null, terminal_stage: null, message: 'Вибір речі збережено — продовжуємо цей запуск', garments: [], conflicts: [], error: null, outputs: {}, qa: {} });
    this.start(runId);
    return publicRun(state);
  }

  async retry(runId) {
    const state = await this.#read(runId);
    if (!state) return null;
    const orphanedAfterRestart = RESTARTABLE.has(state.status) && !this.running.has(runId);
    if (!['NEEDS_INPUT', 'FAILED'].includes(state.status) && !orphanedAfterRestart) throw new Error('Only failed, needs-input, or interrupted runs can be retried');
    if (orphanedAfterRestart) {
      await this.#write(state, { status: 'QUEUED', message: 'Interrupted run queued from its existing checkpoint', error: null });
      this.start(runId);
      return publicRun(state);
    }
    if (['GENERATION_OUTCOME_UNKNOWN', 'PRIOR_OUTCOME_UNKNOWN', 'CREATE_OUTCOME_UNKNOWN'].includes(state.error?.code)) {
      const error = new Error('This provider outcome is unknown, so automatic retry is blocked to prevent a duplicate generation. Start a new explicit run only after incident review.');
      error.statusCode = 409;
      error.code = state.error.code;
      throw error;
    }
    await rm(path.join(this.runDirectory(runId), 'outputs'), { recursive: true, force: true });
    resetVisualState(state);
    state.visual_runner_retry_marker = null;
    await this.#write(state, { status: 'QUEUED', phase: 'UPLOADED', inner_state: null, terminal_stage: null, message: 'Retry queued', garments: [], conflicts: [], error: null, outputs: {}, qa: {} });
    this.start(runId);
    return publicRun(state);
  }

  async deleteRun(runId) {
    if (this.running.has(runId)) throw new Error('Cannot delete a running job');
    const directory = this.runDirectory(runId);
    if (!directory.startsWith(`${this.rootDirectory}${path.sep}`)) throw new Error('Unsafe run path');
    await rm(directory, { recursive: true, force: true });
  }
}
