// Video service: the orchestrator that ties source resolution, motion planning,
// the Seedance transport, clip QA, and profile storage into one flow.
//
// This module does NOT register any routes — app.js is owned by `opencloud`.
// It is imported by whoever needs to drive video creation: a future route
// handler, an MCP tool, or a script.
//
// Design mirrors the editorial-shoot pattern:
// - Clip state lives in a filesystem directory (clips/{clipId}/clip.json)
// - Job id is persisted BEFORE the wait phase (crash-safe by provider design)
// - QA is evaluated from actual bytes, never trusted from a flag
//
// All dependencies are injected so the entire module is testable at zero cost.

import { randomUUID } from 'node:crypto';
import {
  link, mkdir, open, readdir, readFile, rename, rm, writeFile,
} from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

import { sha256 } from './scene-contract.js';
import {
  buildFashionVideoReferencePrompt,
  buildMotionPlan,
  fashionVideoReferenceBindings,
  fashionVideoReferenceRetryPlan,
  surfaceForReferenceGeometry,
} from './video-motion-plan.js';
import { evaluateClipQa } from './video-clip-qa.js';
import {
  DEFAULT_FAL_VIDEO_MODEL,
  FAL_VIDEO_PROVIDER,
  FAL_VIDEO_POLICY_REJECTION_CODE,
  FAL_VIDEO_POLICY_REJECTION_MESSAGE,
  FAL_VIDEO_RESULT_REJECTION_CODE,
  FAL_VIDEO_RESULT_REJECTION_MESSAGE,
  falVideoPrompt,
  resolveFalVideoModel,
} from '../providers/fal-video-provider.js';

// A Fashion Video reference is a directing authority, never footage licensed
// for output. Every detected cut must therefore carry independently hashed
// reference/output samples and an explicit person-replacement verdict.
export const REQUIRED_REFERENCE_CHECKS = Object.freeze([
  'cut_coverage_complete',
  'subject_replacement_every_cut',
  'no_reference_performer_pixels',
  'identity_and_outfit_every_subject_cut',
  'motion_and_pose_timing',
  'camera_and_framing',
  'environment_and_lighting',
  'grade_and_optical_effects',
  'shot_sequence_and_transitions',
]);

// A hero-only salvage is intentionally a shorter edit of independently
// approved spans. It cannot preserve the rejected cuts or the original full
// timeline by definition. Those creative-transfer checks are still recorded
// for audit, while delivery remains blocked by every safety/identity invariant
// that can leak the reference performer or change the approved look.
export const SALVAGE_BLOCKING_REFERENCE_CHECKS = Object.freeze([
  'no_reference_performer_pixels',
  'identity_and_outfit_every_subject_cut',
]);

// `delivery` is an explicit closed-beta policy selected by the operator: it
// keeps evidence and reports all visual mismatches, but only blocks a Fashion
// Video when it is unsafe to show (reference performer/reused footage), when
// its *deterministic* cut coverage is unprovable, or when its MP4 cannot
// technically play.  The model's creative `cut_coverage_complete` judgment
// remains evidence only: it is a style/transfer assessment, not proof that a
// source frame escaped into the output.
// `strict` remains the default for every other runtime.
const FASHION_VIDEO_QA_MODES = new Set(['strict', 'delivery']);
const DELIVERY_SAFETY_REFERENCE_CHECKS = Object.freeze([
  'no_reference_performer_pixels',
]);

// Initial render + two materially different, hash-bound reconstruction passes.
// A provider job explicitly marked `failed` may use the same bounded recovery
// path: no delivery exists, the original job remains immutable, and every new
// child records a distinct prompt and idempotency key. A missing/ambiguous job
// is deliberately excluded because another paid create could duplicate it.
export const MAX_AUTOMATIC_REFERENCE_QA_RETRIES = 2;
const AUTOMATIC_REFERENCE_QA_FAILURE_CODES = new Set([
  'VIDEO_REFERENCE_QA_FAILED',
  'VIDEO_REFERENCE_NOT_REPLACED',
  'VIDEO_PROVIDER_JOB_FAILED',
]);

// The provider can reject a create before it has accepted or billed a job while
// its own input-media IP check is still in progress.  This is deliberately a
// separate, tiny retry budget from semantic Fashion Video repair: no provider
// job exists yet, and the same bound request can be resubmitted once.
export const MAX_INPUT_MEDIA_IP_CHECK_CREATE_ATTEMPTS = 2;
export const INPUT_MEDIA_IP_CHECK_RETRY_DELAY_MS = 3_000;
const INPUT_MEDIA_IP_CHECK_PENDING_CODE = 'PROVIDER_INPUT_MEDIA_IP_CHECK_PENDING';
const CREATE_PRECHECK_CODES = new Set([
  FAL_VIDEO_POLICY_REJECTION_CODE,
  'VIDEO_MODEL_REFERENCE_DURATION_UNSUPPORTED',
  'VIDEO_MODEL_REFERENCE_GEOMETRY_UNSUPPORTED',
  'VIDEO_MODEL_REFERENCE_FPS_UNSUPPORTED',
  'VIDEO_MODEL_OUTPUT_DURATION_UNSUPPORTED',
  'VIDEO_REFERENCE_NORMALIZATION_FAILED',
  'VIDEO_REFERENCE_PROBE_FAILED',
  'VIDEO_REFERENCE_PROBE_MISMATCH',
  'VIDEO_REFERENCE_HASH_MISMATCH',
  'VIDEO_REFERENCE_BINDING_INVALID',
  'VIDEO_INPUT_UPLOAD_FAILED',
  'VIDEO_MODEL_MEDIA_LIMITS_INVALID',
  'VIDEO_IMAGE_SIZE_UNSUPPORTED',
  'VIDEO_IMAGE_FORMAT_UNSUPPORTED',
  'VIDEO_IMAGE_HASH_MISMATCH',
  'VIDEO_IMAGE_UNREADABLE',
  'VIDEO_MODEL_ASPECT_RATIO_UNSUPPORTED',
  'UNSAFE_PROVIDER_PROMPT',
  'FAL_VIDEO_MISCONFIGURED',
]);
const TERMINAL_FAL_REJECTION_CODES = new Set([
  FAL_VIDEO_POLICY_REJECTION_CODE,
  FAL_VIDEO_RESULT_REJECTION_CODE,
]);

function falRejectionMessage(code) {
  return code === FAL_VIDEO_POLICY_REJECTION_CODE
    ? FAL_VIDEO_POLICY_REJECTION_MESSAGE
    : FAL_VIDEO_RESULT_REJECTION_MESSAGE;
}

function providerCreateErrorStatus(code) {
  if (code === 'FAL_VIDEO_MISCONFIGURED') return 503;
  if (CREATE_PRECHECK_CODES.has(code)) return 409;
  return 502;
}

const SHA256 = /^[a-f0-9]{64}$/;
const CUT_PEOPLE = new Set(['APPROVED_AVATAR_ONLY', 'NO_PERSON', 'REFERENCE_PERFORMER', 'MIXED_OR_UNKNOWN']);
const SAFE_FAL_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

async function writeTemporaryFile(filename, bytes) {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  let ownsTemporary = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    return temporary;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (ownsTemporary) await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function syncParentDirectory(filename) {
  if (!['darwin', 'linux'].includes(process.platform)) return;
  const handle = await open(path.dirname(filename), 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWriteFile(filename, bytes) {
  const temporary = await writeTemporaryFile(filename, bytes);
  try {
    await rename(temporary, filename);
    await syncParentDirectory(filename);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function createFileIfAbsent(filename, bytes) {
  const temporary = await writeTemporaryFile(filename, bytes);
  let created = true;
  try {
    try {
      await link(temporary, filename);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      created = false;
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  await syncParentDirectory(filename);
  return created;
}

async function writeImmutableFile(filename, bytes, conflictError) {
  const contents = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (await createFileIfAbsent(filename, contents)) return;
  const existing = await readFile(filename);
  if (!existing.equals(contents)) throw conflictError();
}

function sanitizeProviderWaitValue(value, key = '', depth = 0) {
  if (depth > 12) return '[TRUNCATED_DEPTH]';
  if (/token|secret|authorization|cookie|api[_-]?key/i.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:') return `${parsed.origin}${parsed.pathname}`;
    } catch {
      // Not a URL; continue with local-path protection.
    }
    if (/^(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/.test(value)) return '[REDACTED_LOCAL_PATH]';
    return value.length > 2_000 ? `${value.slice(0, 2_000)}[TRUNCATED]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeProviderWaitValue(entry, '', depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, child]) => [
      childKey,
      sanitizeProviderWaitValue(child, childKey, depth + 1),
    ]));
  }
  return value;
}

function sanitizedUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? `${parsed.origin}${parsed.pathname}` : null;
  } catch {
    return null;
  }
}
function validFashionCutSheet(sheet, durationSeconds) {
  if (sheet?.schema_version !== '1.0.0' || !Array.isArray(sheet.cuts)
    || sheet.cuts.length < 1 || sheet.cuts.length > 24) return false;
  let end = 0;
  for (const [index, cut] of sheet.cuts.entries()) {
    if (cut?.cut_index !== index || !Number.isInteger(cut.start_ms)
      || !Number.isInteger(cut.end_ms) || cut.start_ms !== end
      || cut.end_ms <= cut.start_ms || cut.subject_rule !== 'APPROVED_AVATAR_OR_EMPTY'
      || typeof cut.direction !== 'string' || cut.direction.length < 24 || cut.direction.length > 500) return false;
    end = cut.end_ms;
  }
  return Math.abs(end - Math.round(durationSeconds * 1000)) <= 40;
}

function validatedMicroCutCoverage(coverage, durationSeconds) {
  if (!coverage || typeof coverage !== 'object'
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0
    || !Number.isInteger(coverage.sample_rate_fps) || coverage.sample_rate_fps < 2
    || !Array.isArray(coverage.cuts) || coverage.cuts.length < 1) {
    return null;
  }
  const expectedEndMs = Math.round(Number(durationSeconds) * 1000);
  let previousEnd = 0;
  const cuts = [];
  for (const [index, cut] of coverage.cuts.entries()) {
    if (!cut || cut.cut_index !== index
      || !Number.isInteger(cut.start_ms) || !Number.isInteger(cut.end_ms)
      || cut.start_ms < 0 || cut.end_ms <= cut.start_ms
      || cut.start_ms > previousEnd + 125
      || !Number.isInteger(cut.sample_count) || cut.sample_count < 1
      || !Array.isArray(cut.output_frame_sha256s) || cut.output_frame_sha256s.length < 1
      || !Array.isArray(cut.reference_frame_sha256s) || cut.reference_frame_sha256s.length < 1
      || cut.output_frame_sha256s.some((hash) => !SHA256.test(hash))
      || cut.reference_frame_sha256s.some((hash) => !SHA256.test(hash))
      || typeof cut.reference_performer_visible !== 'boolean'
      || !CUT_PEOPLE.has(cut.visible_people)
      || !['PASS', 'FAIL'].includes(cut.decision)) {
      return null;
    }
    previousEnd = cut.end_ms;
    cuts.push(cut);
  }
  if (previousEnd < expectedEndMs - 125) return null;
  const pass = cuts.every((cut) => cut.decision === 'PASS'
    && cut.reference_performer_visible === false
    && ['APPROVED_AVATAR_ONLY', 'NO_PERSON'].includes(cut.visible_people));
  const referenceLeakDetected = cuts.some((cut) => cut.reference_performer_visible === true
    || ['REFERENCE_PERFORMER', 'MIXED_OR_UNKNOWN'].includes(cut.visible_people));
  const approvedHeroSegments = [];
  for (const cut of cuts) {
    const approvedHero = cut.decision === 'PASS'
      && cut.reference_performer_visible === false
      && cut.visible_people === 'APPROVED_AVATAR_ONLY';
    if (!approvedHero) continue;
    const previous = approvedHeroSegments.at(-1);
    if (previous && cut.start_ms <= previous.end_ms + 40) {
      previous.end_ms = cut.end_ms;
    } else {
      approvedHeroSegments.push({ start_ms: cut.start_ms, end_ms: cut.end_ms });
    }
  }
  const unsafeNonReferenceFailure = cuts.some((cut) => cut.decision === 'FAIL'
    && cut.reference_performer_visible !== true
    && !['REFERENCE_PERFORMER', 'MIXED_OR_UNKNOWN'].includes(cut.visible_people));
  return {
    pass,
    // This is intentionally narrower than `pass`: the delivery beta accepts
    // a recorded identity/item mismatch as an advisory result, but never an
    // uninspected span or a possible surviving source performer.
    deliverySafetyPass: previousEnd >= expectedEndMs - 125
      && cuts.every((cut) => cut.reference_performer_visible === false
        && ['APPROVED_AVATAR_ONLY', 'NO_PERSON'].includes(cut.visible_people)),
    cutCount: cuts.length,
    sampleRateFps: coverage.sample_rate_fps,
    inspectedDurationMs: previousEnd,
    referenceLeakDetected,
    approvedHeroSegments,
    unsafeNonReferenceFailure,
  };
}

export class VideoServiceError extends Error {
  constructor(message, { code = 'VIDEO_SERVICE_ERROR', status = 500 } = {}) {
    super(message);
    this.name = 'VideoServiceError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Minimal clip store backed by the filesystem.
 *
 * Each clip lives in `{rootDirectory}/clips/{clipId}/` with:
 *   clip.json  — metadata
 *   source.png — the locked source frame (when saved)
 *   provider.mp4 — raw provider output (never served as delivery)
 *   style-reference.mp4 — exact locked Fashion Video reference/audio authority
 *   clip.mp4   — assembled delivery (provider picture + approved reference audio)
 */
export class ClipStore {
  #root;

  constructor(rootDirectory) {
    if (typeof rootDirectory !== 'string' || rootDirectory.length === 0) {
      throw new VideoServiceError('ClipStore requires a root directory', {
        code: 'STORE_MISCONFIGURED',
      });
    }
    this.#root = rootDirectory;
  }

  clipDir(clipId) {
    return path.join(this.#root, 'clips', clipId);
  }

  async save(clipId, metadata) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    await atomicWriteFile(path.join(dir, 'clip.json'), JSON.stringify(metadata, null, 2));
    return metadata;
  }

  async load(clipId) {
    try {
      const raw = await readFile(path.join(this.clipDir(clipId), 'clip.json'), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // Persisted clip IDs are the recovery source after a daemon restart.  This
  // deliberately reads only direct child directories and treats malformed
  // files as absent, so startup recovery cannot traverse or repair arbitrary
  // runtime data.
  async resumableClipIds({ includeSubmitting = false } = {}) {
    let entries;
    try {
      entries = await readdir(path.join(this.#root, 'clips'), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const clips = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name))
      .map(async (entry) => ({ clipId: entry.name, clip: await this.load(entry.name) })));
    return clips
      .filter(({ clipId, clip }) => clip && clip.clipId === clipId && (
        ['CREATED', 'GENERATING', 'OUTPUT_DOWNLOAD_FAILED'].includes(clip.status)
        || (includeSubmitting && clip.status === 'SUBMITTING')
      ))
      .map(({ clipId }) => clipId);
  }

  async saveVideo(clipId, videoBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'clip.mp4');
    await atomicWriteFile(filePath, videoBytes);
    return filePath;
  }

  salvagedVideoPath(clipId) {
    return path.join(this.clipDir(clipId), 'clip-salvaged.mp4');
  }

  async saveQaReceipt(clipId, filename, receiptBytes, conflictCode) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    await writeImmutableFile(filePath, receiptBytes, () => new VideoServiceError(
      'Video QA receipt is immutable', { code: conflictCode, status: 409 },
    ));
    return filePath;
  }

  async #saveImmutableMedia(clipId, filename, mediaBytes, conflictCode) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    await writeImmutableFile(filePath, mediaBytes, () => new VideoServiceError(
      'Immutable video media conflicts with its original bytes', { code: conflictCode, status: 409 },
    ));
    return filePath;
  }

  async saveProviderVideo(clipId, videoBytes) {
    return this.#saveImmutableMedia(clipId, 'provider.mp4', videoBytes, 'PROVIDER_VIDEO_CONFLICT');
  }

  async saveFashionReference(clipId, videoBytes) {
    return this.#saveImmutableMedia(clipId, 'style-reference.mp4', videoBytes, 'VIDEO_REFERENCE_CONFLICT');
  }
  async saveSource(clipId, sourceBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'source.png');
    await writeImmutableFile(filePath, sourceBytes, () => new VideoServiceError(
      'Locked Fashion Video source conflicts with its original bytes', {
        code: 'VIDEO_SOURCE_CONFLICT', status: 409,
      },
    ));
    return filePath;
  }

  async saveAppearanceReference(clipId, role, imageBytes) {
    const filenames = {
      identity_face: 'identity-face.png',
      garment_detail: 'garment-detail.png',
    };
    const filename = filenames[role];
    if (!filename) {
      throw new VideoServiceError('Unknown Fashion Video appearance reference role', {
        code: 'VIDEO_APPEARANCE_REFERENCE_INVALID',
        status: 409,
      });
    }
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    await writeImmutableFile(filePath, imageBytes, () => new VideoServiceError(
      'Fashion Video appearance reference is immutable', {
        code: 'VIDEO_APPEARANCE_REFERENCE_CONFLICT', status: 409,
      },
    ));
    return filePath;
  }

  async saveCreateReceipt(clipId, receiptBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'create-receipt.json');
    await writeImmutableFile(filePath, receiptBytes, () => new VideoServiceError(
      'Create receipt is immutable', { code: 'CREATE_RECEIPT_CONFLICT', status: 409 },
    ));
    return filePath;
  }

  async saveIdentityItemQa(clipId, receiptBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'identity-item-qa.json');
    await writeImmutableFile(filePath, receiptBytes, () => new VideoServiceError(
      'Identity/item QA receipt is immutable', { code: 'QA_RECEIPT_CONFLICT', status: 409 },
    ));
    return filePath;
  }

  videoPath(clipId) {
    return path.join(this.clipDir(clipId), 'clip.mp4');
  }

  // A retry is an explicit, paid user action.  Persist the idempotency record
  // outside the browser so a double tap, reload, or daemon restart can never
  // create two provider jobs for the same retry click.
  #retryClaimPath(parentClipId, keyHash) {
    return path.join(this.#root, 'video-retries', parentClipId, `${keyHash}.json`);
  }

  async claimRetry(parentClipId, idempotencyKey) {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      throw new VideoServiceError('A retry idempotency key is required', {
        code: 'VIDEO_RETRY_IDEMPOTENCY_REQUIRED', status: 400,
      });
    }
    const keyHash = sha256(Buffer.from(idempotencyKey));
    const claimPath = this.#retryClaimPath(parentClipId, keyHash);
    await mkdir(path.dirname(claimPath), { recursive: true });
    const pending = {
      parent_clip_id: parentClipId,
      key_sha256: keyHash,
      state: 'SUBMITTING',
      created_at: new Date().toISOString(),
    };
    const bytes = `${JSON.stringify(pending, null, 2)}\n`;
    if (await createFileIfAbsent(claimPath, bytes)) {
      return { created: true, claim: pending, claimPath };
    }
    const raw = await readFile(claimPath, 'utf8');
    return { created: false, claim: JSON.parse(raw), claimPath };
  }

  async completeRetryClaim(claimPath, childClipId) {
    const raw = await readFile(claimPath, 'utf8');
    const claim = JSON.parse(raw);
    const completed = {
      ...claim,
      state: 'CREATED',
      child_clip_id: childClipId,
      completed_at: new Date().toISOString(),
    };
    await atomicWriteFile(claimPath, `${JSON.stringify(completed, null, 2)}\n`);
    return completed;
  }
}

export class VideoService {
  #provider;
  #store;
  #clock;
  #sleep;

  #finalizer;

  #fashionVideoReferenceResolver;

  #automaticQaFn;

  #fashionVideoQaMode;

  /**
   * @param {object} options
   * @param {object} options.provider — configured video provider instance
   * @param {ClipStore} options.clipStore
   * @param {function} [options.clock] — () => Date.now(), for testing
   */
  constructor({
    provider,
    clipStore,
    clock = () => Date.now(),
    finalizer = {},
    fashionVideoReferenceResolver = null,
    automaticQaFn = null,
    fashionVideoQaMode = 'strict',
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    if (!provider) {
      throw new VideoServiceError('A video provider is required', {
        code: 'SERVICE_MISCONFIGURED',
      });
    }
    if (!clipStore) {
      throw new VideoServiceError('A clip store is required', {
        code: 'SERVICE_MISCONFIGURED',
      });
    }
    if (!FASHION_VIDEO_QA_MODES.has(fashionVideoQaMode)) {
      throw new VideoServiceError(`Unknown Fashion Video QA mode: ${String(fashionVideoQaMode)}`, {
        code: 'SERVICE_MISCONFIGURED',
      });
    }
    if (typeof sleep !== 'function') {
      throw new VideoServiceError('A video sleep function must be callable', {
        code: 'SERVICE_MISCONFIGURED',
      });
    }
    this.#provider = provider;
    this.#store = clipStore;
    this.#clock = clock;
    this.#sleep = sleep;
    this.#finalizer = finalizer;
    this.#fashionVideoReferenceResolver = fashionVideoReferenceResolver;
    this.#automaticQaFn = automaticQaFn;
    this.#fashionVideoQaMode = fashionVideoQaMode;
  }

  async fashionVideoCapability({
    profileId,
    lookId,
    approvedLook,
    motionMode = null,
    referenceId = null,
  } = {}) {
    if (typeof this.#fashionVideoReferenceResolver !== 'function') return null;
    return this.#fashionVideoReferenceResolver({
      profileId,
      lookId,
      approvedLook,
      motionMode,
      referenceId,
    });
  }

  /**
   * Create a video clip: build motion plan, call transport, persist job id
   * before the wait phase.
   *
   * Returns immediately after the job is created and persisted — the caller
   * can resume later via `awaitAndFinalize`.
   */
  async createClip({
    modeId,
    surfaceId,
    durationSeconds,
    sourceCapabilities = {},
    styleNote = null,
    sourceImagePath,
    lookBinding = null,
    videoReference = null,
    appearanceReferences = [],
    videoModel = DEFAULT_FAL_VIDEO_MODEL,
    retryOf = null,
    automaticRetry = null,
  }) {
    if (!sourceImagePath) {
      throw new VideoServiceError('A locked source image path is required', {
        code: 'MISSING_SOURCE', status: 400,
      });
    }

    let selectedVideoModel;
    try {
      selectedVideoModel = resolveFalVideoModel(videoModel);
    } catch (cause) {
      throw new VideoServiceError('The requested Fashion Video model is not supported', {
        code: cause?.code ?? 'VIDEO_MODEL_UNSUPPORTED',
        status: 400,
        cause,
      });
    }

    let plan;
    let referenceOwnedSurface = null;

    const clipId = randomUUID();
    const createdAt = new Date(this.#clock()).toISOString();
    let sourceBytes;
    try {
      sourceBytes = await readFile(sourceImagePath);
    } catch (cause) {
      throw new VideoServiceError('The locked source image cannot be read', {
        code: 'SOURCE_UNREADABLE',
        status: 409,
        cause,
      });
    }
    const sourceSha256 = sha256(sourceBytes);
    if (lookBinding?.sourceSha256
      && lookBinding.sourceSha256 !== sourceSha256) {
      throw new VideoServiceError('The approved look bytes changed before video submission', {
        code: 'VIDEO_SOURCE_HASH_MISMATCH',
        status: 409,
      });
    }
    let verifiedVideoReference = null;
    let verifiedReferenceBytes = null;
    if (videoReference !== null) {
      if (selectedVideoModel.id === 'seedance-2.5'
        && Number.isFinite(videoReference?.duration_seconds)
        && Math.ceil(videoReference.duration_seconds) > 30) {
        throw new VideoServiceError(
          'Seedance 2.5 cannot fit the full reference cut sheet within its 30-second output limit; the source will not be shortened.',
          { code: 'VIDEO_MODEL_OUTPUT_DURATION_UNSUPPORTED', status: 409 },
        );
      }
      if (lookBinding?.whiteBackgroundVerified !== true) {
        throw new VideoServiceError(
          'Fashion Video requires a verified approved white master; raw person photos are forbidden',
          { code: 'VIDEO_WHITE_MASTER_REQUIRED', status: 409 },
        );
      }
      if (videoReference?.state !== 'READY'
        || typeof videoReference.reference_path !== 'string'
        || !/^[a-f0-9]{64}$/.test(videoReference.reference_sha256 ?? '')
        || !/^[a-f0-9]{64}$/.test(videoReference.reference_pack_sha256 ?? '')
        || !Number.isFinite(videoReference.duration_seconds)
        || !Number.isInteger(videoReference.provider_duration_seconds)
        || videoReference.provider_duration_seconds < 4
        || videoReference.provider_duration_seconds > 30
        || !Number.isInteger(videoReference.width)
        || !Number.isInteger(videoReference.height)
        || videoReference.width < 1
        || videoReference.height < 1
        || !validFashionCutSheet(videoReference.cut_sheet, videoReference.duration_seconds)
        || !SHA256.test(videoReference.cut_sheet_sha256 ?? '')
        || sha256(Buffer.from(JSON.stringify(videoReference.cut_sheet))) !== videoReference.cut_sheet_sha256) {
        throw new VideoServiceError('Fashion Video reference binding is incomplete', {
          code: 'VIDEO_REFERENCE_INVALID',
          status: 409,
        });
      }
      try {
        verifiedReferenceBytes = await readFile(videoReference.reference_path);
      } catch (cause) {
        throw new VideoServiceError('Fashion Video reference cannot be read', {
          code: 'VIDEO_REFERENCE_UNREADABLE',
          status: 409,
          cause,
        });
      }
      if (sha256(verifiedReferenceBytes) !== videoReference.reference_sha256) {
        throw new VideoServiceError('Fashion Video reference changed before submission', {
          code: 'VIDEO_REFERENCE_HASH_MISMATCH',
          status: 409,
        });
      }
      if (selectedVideoModel.id === 'seedance-2.0' && videoReference.duration_seconds > 15) {
        throw new VideoServiceError(
          `Seedance 2.0 accepts motion references up to 15 seconds; this reference is ${videoReference.duration_seconds}s. Select Seedance 2.5.`,
          { code: 'VIDEO_MODEL_REFERENCE_DURATION_UNSUPPORTED', status: 409 },
        );
      }
      verifiedVideoReference = {
        path: videoReference.reference_path,
        sha256: videoReference.reference_sha256,
        packSha256: videoReference.reference_pack_sha256,
        referenceId: videoReference.reference_id ?? null,
        durationSeconds: videoReference.duration_seconds,
        providerDurationSeconds: videoReference.provider_duration_seconds,
        width: videoReference.width ?? null,
        height: videoReference.height ?? null,
        fps: videoReference.fps ?? null,
        cutSheet: videoReference.cut_sheet ?? null,
        cutSheetSha256: videoReference.cut_sheet_sha256 ?? null,
      };
      try {
        referenceOwnedSurface = surfaceForReferenceGeometry(
          verifiedVideoReference.width,
          verifiedVideoReference.height,
        );
      } catch (cause) {
        throw new VideoServiceError(
          'Fashion Video reference geometry has no supported presentation surface',
          { code: 'VIDEO_REFERENCE_ASPECT_UNSUPPORTED', status: 409, cause },
        );
      }
      verifiedVideoReference.presentationSurface = referenceOwnedSurface.id;
      verifiedVideoReference.aspectRatio = referenceOwnedSurface.aspectRatio;
    }
    // A reference-bound Fashion Video owns its geometry. Any legacy
    // `surfaceId` supplied by an old client is deliberately ignored here.
    plan = buildMotionPlan({
      modeId,
      surface: referenceOwnedSurface?.id ?? surfaceId,
      durationSeconds,
      // A reference-bound style owns duration exactly as it owns aspect ratio.
      // This avoids treating a historical mode demo duration as authority when
      // retrying a completed style binding.
      referenceDurationSeconds: verifiedVideoReference?.providerDurationSeconds ?? null,
      maxReferenceDurationSeconds: selectedVideoModel.id === 'seedance-2.5' ? 30 : 15,
      sourceCapabilities,
      styleNote,
    });
    if (!Array.isArray(appearanceReferences)
      || appearanceReferences.length > 2
      || appearanceReferences.some((reference) => (
        !['identity_face', 'garment_detail'].includes(reference?.role)
        || !Buffer.isBuffer(reference?.bytes)
        || reference.bytes.length === 0
        || !/^[a-f0-9]{64}$/.test(reference?.sha256 ?? '')
        || sha256(reference.bytes) !== reference.sha256
      ))
      || new Set(appearanceReferences.map((reference) => reference.role)).size
        !== appearanceReferences.length) {
      throw new VideoServiceError('Fashion Video appearance references are invalid', {
        code: 'VIDEO_APPEARANCE_REFERENCE_INVALID',
        status: 409,
      });
    }
    const appearanceRoles = appearanceReferences.map((reference) => reference.role);
    const canonicalAppearanceRoles = ['identity_face', 'garment_detail']
      .filter((role) => appearanceRoles.includes(role));
    if (appearanceRoles.some((role, index) => role !== canonicalAppearanceRoles[index])) {
      throw new VideoServiceError('Fashion Video appearance references are out of canonical order', {
        code: 'VIDEO_APPEARANCE_REFERENCE_ORDER_INVALID',
        status: 409,
      });
    }
    if (appearanceReferences.some((reference) => (
      reference.role === 'identity_face' && reference.white_background_verified !== true
    ))) {
      throw new VideoServiceError(
        'Fashion Video identity-face input must be a verified white-background derivative',
        { code: 'VIDEO_IDENTITY_FACE_BACKGROUND_INVALID', status: 409 },
      );
    }
    if (appearanceReferences.some((reference) => (
      reference.role === 'garment_detail' && reference.white_background_verified !== true
    ))) {
      throw new VideoServiceError(
        'Fashion Video garment-detail input must be a verified white-background evidence card',
        { code: 'VIDEO_GARMENT_REFERENCE_BACKGROUND_INVALID', status: 409 },
      );
    }
    const referenceBindings = fashionVideoReferenceBindings({ appearanceRoles });
    const lockedSourcePath = await this.#store.saveSource(clipId, sourceBytes);
    if (verifiedVideoReference) {
      // The directing reference is allowed as provider input, but it is also
      // the only permitted delivery-audio source. Freeze exact bytes now so a
      // later source-file edit cannot change either the request or final mux.
      const lockedReferencePath = await this.#store.saveFashionReference(
        clipId,
        verifiedReferenceBytes,
      );
      verifiedVideoReference = {
        ...verifiedVideoReference,
        path: lockedReferencePath,
        audioSourceSha256: sha256(verifiedReferenceBytes),
      };
    }
    const lockedAppearanceReferences = [];
    for (const reference of appearanceReferences) {
      const referencePath = await this.#store.saveAppearanceReference(
        clipId,
        reference.role,
        reference.bytes,
      );
      lockedAppearanceReferences.push({
        role: reference.role,
        path: referencePath,
        sha256: reference.sha256,
        white_background_verified: true,
        provider_label: referenceBindings.appearance.find(
          (binding) => binding.role === reference.role,
        ).provider_label,
      });
    }

    // For Fashion Video this is derived from the verified reference geometry;
    // legacy callers retain their existing MotionPlan-derived surface.
    const aspectRatio = plan.aspectRatio;

    const referenceBound = verifiedVideoReference !== null;
    let referenceRetryPlan = null;
    if (automaticRetry !== null) {
      if (!referenceBound
        || !AUTOMATIC_REFERENCE_QA_FAILURE_CODES.has(automaticRetry?.reason_code)
        || !Number.isInteger(automaticRetry?.retry_number)) {
        throw new VideoServiceError('Automatic Fashion Video retry is invalid', {
          code: 'VIDEO_AUTOMATIC_RETRY_INVALID', status: 409,
        });
      }
      try {
        referenceRetryPlan = fashionVideoReferenceRetryPlan(automaticRetry.retry_number);
      } catch (cause) {
        throw new VideoServiceError('Automatic Fashion Video retry is invalid', {
          code: cause?.code ?? 'VIDEO_AUTOMATIC_RETRY_INVALID', status: 409, cause,
        });
      }
    }
    const prompt = referenceBound
      ? buildFashionVideoReferencePrompt({
          appearanceRoles,
          cutSheet: verifiedVideoReference.cutSheet,
          referenceRetryPlan,
        })
      : plan.prompt;
    const duration = referenceBound
      ? verifiedVideoReference.providerDurationSeconds
      : plan.durationSeconds;
    const request = {
      prompt,
      videoModel: selectedVideoModel.id,
      mediaPaths: [
        lockedSourcePath,
        ...lockedAppearanceReferences.map((reference) => reference.path),
      ],
      videoPaths: verifiedVideoReference ? [verifiedVideoReference.path] : [],
      appearanceReferences: lockedAppearanceReferences.map(({ role, sha256: referenceSha256 }) => ({
        role,
        sha256: referenceSha256,
      })),
      aspectRatio,
      durationSeconds: duration,
      sourceBinding: {
        clipId,
        sourceSha256,
        approvedLookReceiptSha256: lookBinding?.approvedLookReceiptSha256 ?? null,
        ...(verifiedVideoReference
          ? {
              motionReferenceSha256: verifiedVideoReference.sha256,
              referencePackSha256: verifiedVideoReference.packSha256,
              referenceManifestVersion: referenceBindings.schema_version,
            }
          : {}),
      },
    };
    const providerReferenceBindings = verifiedVideoReference
      ? {
          schema_version: referenceBindings.schema_version,
          motion_reference: {
            role: referenceBindings.motion_reference.role,
            provider_label: referenceBindings.motion_reference.provider_label,
            sha256: verifiedVideoReference.sha256,
            duration_seconds: verifiedVideoReference.durationSeconds,
            width: verifiedVideoReference.width,
            height: verifiedVideoReference.height,
            fps: verifiedVideoReference.fps,
            cut_sheet_sha256: verifiedVideoReference.cutSheetSha256,
          },
          images: [
            {
              role: referenceBindings.approved_white_master.role,
              provider_label: referenceBindings.approved_white_master.provider_label,
              sha256: sourceSha256,
            },
            ...lockedAppearanceReferences.map((reference) => ({
              role: reference.role,
              provider_label: reference.provider_label,
              sha256: reference.sha256,
            })),
          ],
        }
      : null;
    request.referenceBindings = providerReferenceBindings;
    const immutableRequestBinding = {
      schema_version: 'fashion-video-request-binding-v1',
      source_binding: {
        source_sha256: sourceSha256,
        approved_look_receipt_sha256: lookBinding?.approvedLookReceiptSha256 ?? null,
        white_background_verified: lookBinding?.whiteBackgroundVerified === true,
        profile_id: lookBinding?.profileId ?? null,
        look_id: lookBinding?.lookId ?? null,
      },
      motion_reference: verifiedVideoReference
        ? {
            sha256: verifiedVideoReference.sha256,
            reference_pack_sha256: verifiedVideoReference.packSha256,
            provider_label: referenceBindings.motion_reference.provider_label,
            reference_manifest_version: referenceBindings.schema_version,
            presentation_surface: verifiedVideoReference.presentationSurface,
            aspect_ratio: verifiedVideoReference.aspectRatio,
          }
        : null,
      appearance_references: lockedAppearanceReferences.map((reference) => ({
        role: reference.role,
        sha256: reference.sha256,
        provider_label: reference.provider_label,
        white_background_verified: reference.white_background_verified,
      })),
      automatic_reference_retry: referenceRetryPlan
        ? {
            version: referenceRetryPlan.version,
            id: referenceRetryPlan.id,
            retry_number: automaticRetry.retry_number,
            reason_code: automaticRetry.reason_code,
        }
        : null,
      reference_bindings: providerReferenceBindings,
    };

    const submitting = {
      clipId,
      jobId: null,
      providerKey: FAL_VIDEO_PROVIDER,
      videoModel: selectedVideoModel.id,
      providerEndpoint: selectedVideoModel.endpoint,
      providerRequestId: null,
      status: 'SUBMITTING',
      mode: plan.mode,
      title: plan.title,
      surface: plan.surface ?? null,
      aspectRatio,
      durationSeconds: duration,
      prompt,
      sourceSha256,
      sourceFile: 'source.png',
      appearanceReferences: lockedAppearanceReferences.map((reference) => ({
        role: reference.role,
        file: path.basename(reference.path),
        sha256: reference.sha256,
        provider_label: reference.provider_label,
        white_background_verified: reference.white_background_verified,
      })),
      motionReferenceBinding: verifiedVideoReference
        ? {
            referenceId: verifiedVideoReference.referenceId,
            sha256: verifiedVideoReference.sha256,
            packSha256: verifiedVideoReference.packSha256,
            durationSeconds: verifiedVideoReference.durationSeconds,
            providerDurationSeconds: verifiedVideoReference.providerDurationSeconds,
            width: verifiedVideoReference.width,
            height: verifiedVideoReference.height,
            presentationSurface: verifiedVideoReference.presentationSurface,
            aspectRatio: verifiedVideoReference.aspectRatio,
            fps: verifiedVideoReference.fps,
            cutSheetSha256: verifiedVideoReference.cutSheetSha256,
            cutCount: Array.isArray(verifiedVideoReference.cutSheet?.cuts)
              ? verifiedVideoReference.cutSheet.cuts.length
              : 0,
            providerLabel: referenceBindings.motion_reference.provider_label,
            referenceManifestVersion: referenceBindings.schema_version,
            presentationSurface: verifiedVideoReference.presentationSurface,
            aspectRatio: verifiedVideoReference.aspectRatio,
            audioSourceFile: 'style-reference.mp4',
            audioSourceSha256: verifiedVideoReference.audioSourceSha256,
          }
        : null,
      lookBinding,
      immutableRequestBinding,
      automaticRetry: referenceRetryPlan
        ? {
            version: referenceRetryPlan.version,
            id: referenceRetryPlan.id,
            retry_number: referenceRetryPlan.retry_number,
            max_retries: MAX_AUTOMATIC_REFERENCE_QA_RETRIES,
            reason_code: automaticRetry.reason_code,
            parent_clip_id: retryOf,
          }
        : null,
      createdAt,
      updatedAt: createdAt,
    };
    await this.#store.save(clipId, submitting);

    // Phase 1: create the job. The onJobCreated hook persists the job id
    // before the wait phase starts, so a crash cannot orphan a paid job.
    let created;
    let providerInputMedia = null;
    for (let attempt = 1; attempt <= MAX_INPUT_MEDIA_IP_CHECK_CREATE_ATTEMPTS; attempt += 1) {
      try {
        // `request` is deliberately constructed once above and reused by
        // identity, not cloned/recompiled: the retry has the same content
        // hashes, prompt, reference order and idempotency binding.
        created = await this.#provider.createJob(request);
        if (attempt > 1) {
          providerInputMedia = {
            state: 'READY',
            attempt,
            max_attempts: MAX_INPUT_MEDIA_IP_CHECK_CREATE_ATTEMPTS,
          };
        }
        break;
      } catch (cause) {
        const inputMediaPending = cause?.code === INPUT_MEDIA_IP_CHECK_PENDING_CODE;
        if (inputMediaPending && attempt < MAX_INPUT_MEDIA_IP_CHECK_CREATE_ATTEMPTS) {
          await this.#store.save(clipId, {
            ...submitting,
            providerInputMedia: {
              state: 'WAITING_TO_RETRY',
              attempt,
              max_attempts: MAX_INPUT_MEDIA_IP_CHECK_CREATE_ATTEMPTS,
              retry_after_ms: INPUT_MEDIA_IP_CHECK_RETRY_DELAY_MS,
            },
            updatedAt: new Date(this.#clock()).toISOString(),
          });
          await this.#sleep(INPUT_MEDIA_IP_CHECK_RETRY_DELAY_MS);
          continue;
        }
        // A provider can reject locally before it accepts a job (invalid media
        // shape, expired local authentication, etc.). Leaving such a clip in
        // SUBMITTING makes it look paid/active forever and blocks a safe release.
        // The one exception is an acknowledgement we cannot parse: that outcome
        // may already be billed, so it stays recoverable until reconciled.
        if (cause?.code === 'CREATE_OUTCOME_UNKNOWN' || cause?.providerInputMedia) {
          const uploadedInputs = cause?.providerInputMedia ?? null;
          const unknownOutcome = cause?.code === 'CREATE_OUTCOME_UNKNOWN';
          const failureReceipt = {
            schema_version: '1.0.0',
            clip_id: clipId,
            created_at: createdAt,
            provider: FAL_VIDEO_PROVIDER,
            video_model: selectedVideoModel.id,
            endpoint: selectedVideoModel.endpoint,
            outcome: unknownOutcome ? 'UNKNOWN' : 'REJECTED',
            failure_code: cause?.code ?? 'VIDEO_INPUT_UPLOAD_FAILED',
            request: {
              source_sha256: sourceSha256,
              motion_reference_sha256: verifiedVideoReference?.sha256 ?? null,
              prompt,
              aspect_ratio: aspectRatio,
              duration_seconds: duration,
              reference_bindings: providerReferenceBindings,
              immutable_request_binding: immutableRequestBinding,
            },
            provider_input_media: uploadedInputs,
          };
          const receiptBytes = Buffer.from(`${JSON.stringify(failureReceipt, null, 2)}\n`);
          await this.#store.saveCreateReceipt(clipId, receiptBytes);
          const failureCode = unknownOutcome
            ? null
            : CREATE_PRECHECK_CODES.has(cause?.code) ? cause.code : 'VIDEO_CREATE_REJECTED';
          await this.#store.save(clipId, {
            ...submitting,
            ...(uploadedInputs ? { providerInputMedia: uploadedInputs } : {}),
            ...(unknownOutcome
              ? { providerCreateOutcome: 'UNKNOWN' }
              : {
                  status: 'FAILED',
                  failureCode,
                  ...(TERMINAL_FAL_REJECTION_CODES.has(failureCode)
                    ? {
                        providerTerminal: {
                          code: failureCode,
                          jobId: null,
                          recordedAt: new Date(this.#clock()).toISOString(),
                          retryable: false,
                        },
                      }
                    : {}),
                }),
            createReceiptSha256: sha256(receiptBytes),
            createReceiptFile: 'create-receipt.json',
            updatedAt: new Date(this.#clock()).toISOString(),
          });
          if (unknownOutcome) {
            throw new VideoServiceError(
              'The provider may have accepted this Fashion Video request, but its acknowledgement was lost. No second create was sent.',
              { code: 'CREATE_OUTCOME_UNKNOWN', status: 503, cause },
            );
          }
          throw new VideoServiceError(cause.message ?? 'FAL could not upload Fashion Video inputs', {
            code: failureCode,
            status: providerCreateErrorStatus(cause?.code),
            ...(!TERMINAL_FAL_REJECTION_CODES.has(cause?.code) ? { cause } : {}),
          });
        }
        const terminalInputMedia = inputMediaPending
          ? {
              state: 'PENDING',
              attempt,
              max_attempts: MAX_INPUT_MEDIA_IP_CHECK_CREATE_ATTEMPTS,
            }
          : null;
        await this.#store.save(clipId, {
          ...submitting,
          ...(terminalInputMedia ? { providerInputMedia: terminalInputMedia } : {}),
          status: 'FAILED',
          failureCode: inputMediaPending
            ? 'VIDEO_INPUT_MEDIA_IP_CHECK_PENDING'
            : 'VIDEO_CREATE_REJECTED',
          updatedAt: new Date(this.#clock()).toISOString(),
        });
        if (inputMediaPending) {
          throw new VideoServiceError(
            'Провайдер ще перевіряє вхідне медіа. Генерація не стартувала; спробуйте ще раз через кілька секунд.',
            { code: 'VIDEO_INPUT_MEDIA_IP_CHECK_PENDING', status: 503 },
          );
        }
        throw new VideoServiceError('Video provider rejected the create request', {
          code: CREATE_PRECHECK_CODES.has(cause?.code) ? cause.code : 'VIDEO_CREATE_REJECTED',
          status: providerCreateErrorStatus(cause?.code),
        });
      }
    }

    const receipt = {
      schema_version: '1.0.0',
      clip_id: clipId,
      created_at: createdAt,
      provider: created.providerKey ?? 'openrouter',
      video_model: created.providerKey === FAL_VIDEO_PROVIDER
        ? created.videoModel ?? selectedVideoModel.id
        : null,
      endpoint: created.providerKey === FAL_VIDEO_PROVIDER
        ? created.providerEndpoint ?? selectedVideoModel.endpoint
        : null,
      request_id: created.providerKey === FAL_VIDEO_PROVIDER
        ? created.requestId ?? created.jobId
        : null,
      provider_create_attempt: created.createAttempt ?? 1,
      fallback_used: created.fallbackUsed === true,
      request: {
        source_sha256: sourceSha256,
        approved_look_receipt_sha256: lookBinding?.approvedLookReceiptSha256 ?? null,
        motion_reference_sha256: verifiedVideoReference?.sha256 ?? null,
        reference_pack_sha256: verifiedVideoReference?.packSha256 ?? null,
        prompt,
        aspect_ratio: aspectRatio,
        duration_seconds: duration,
        appearance_references: lockedAppearanceReferences.map((reference) => ({
          role: reference.role,
          sha256: reference.sha256,
          provider_label: reference.provider_label,
          white_background_verified: reference.white_background_verified,
        })),
        automatic_reference_retry: referenceRetryPlan
          ? {
              version: referenceRetryPlan.version,
              id: referenceRetryPlan.id,
              retry_number: automaticRetry.retry_number,
              reason_code: automaticRetry.reason_code,
          }
          : null,
        reference_bindings: providerReferenceBindings,
        immutable_request_binding: immutableRequestBinding,
        provider_payload: created.request ?? null,
      },
      response: {
        job_id: created.jobId,
        payload: created.raw ?? null,
      },
      provider_input_media: created.inputMedia ?? providerInputMedia,
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const createReceiptSha256 = sha256(receiptBytes);
    await this.#store.saveCreateReceipt(clipId, receiptBytes);

    const metadata = {
      ...submitting,
      retryOf,
      jobId: created.jobId,
      providerKey: created.providerKey ?? 'openrouter',
      videoModel: created.providerKey === FAL_VIDEO_PROVIDER
        ? created.videoModel ?? selectedVideoModel.id
        : null,
      providerEndpoint: created.providerKey === FAL_VIDEO_PROVIDER
        ? created.providerEndpoint ?? selectedVideoModel.endpoint
        : null,
      providerRequestId: created.providerKey === FAL_VIDEO_PROVIDER
        ? created.requestId ?? created.jobId
        : null,
      providerCreateAttempt: created.createAttempt ?? 1,
      fallbackUsed: created.fallbackUsed === true,
      ...((created.inputMedia ?? providerInputMedia)
        ? { providerInputMedia: created.inputMedia ?? providerInputMedia }
        : {}),
      status: 'CREATED',
      createReceiptSha256,
      createReceiptFile: 'create-receipt.json',
      updatedAt: createdAt,
    };

    await this.#store.save(clipId, metadata);

    return {
      clipId,
      jobId: created.jobId,
      requestId: created.requestId ?? created.jobId,
      status: 'CREATED',
      videoModel: created.providerKey === FAL_VIDEO_PROVIDER
        ? created.videoModel ?? selectedVideoModel.id
        : null,
      providerEndpoint: created.providerKey === FAL_VIDEO_PROVIDER
        ? created.providerEndpoint ?? selectedVideoModel.endpoint
        : null,
      plan: {
        ...plan,
        prompt,
        durationSeconds: duration,
        referenceBound,
      },
    };
  }

  /**
   * Create one deliberate child attempt from a failed clip. The child uses
   * only the parent’s persisted, hash-locked source and appearance references;
   * it never silently substitutes today’s avatar, outfit, or style media.
   */
  /**
   * The public retry-claim surface. `claimRetry`/`completeRetryClaim` were
   * defined only on the private `ClipStore` (`this.#store`), while
   * `registerVideoRoutes` calls them directly on this facade
   * (`videoService.claimRetry(...)`) — a `TypeError` in production every
   * time a viewer pressed retry after a failed clip, because the method
   * simply did not exist on the object the route held. Delegating here is
   * the minimal fix: the store's idempotency-file semantics are unchanged.
   */
  async claimRetry(parentClipId, idempotencyKey) {
    return this.#store.claimRetry(parentClipId, idempotencyKey);
  }

  async completeRetryClaim(claimPath, childClipId) {
    return this.#store.completeRetryClaim(claimPath, childClipId);
  }

  /**
   * Create at most two autonomous children when semantic reference QA proves
   * that a provider result leaked the directing performer.  Each child gets a
   * different immutable repair plan; this is deliberately not a blind resend
   * of the same paid request.
   *
   * A retry claim is durable before create.  If the create outcome becomes
   * ambiguous, the claim remains pending and this method will not spend a
   * duplicate provider job after a restart.
   */
  async automaticRetryReferenceQaFailure(parentClipId, { videoReference } = {}) {
    const parent = await this.#store.load(parentClipId);
    if (!parent) {
      throw new VideoServiceError('Video clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
    }
    if (TERMINAL_FAL_REJECTION_CODES.has(parent.failureCode)) {
      return {
        eligible: false,
        created: false,
        exhausted: false,
        reasonCode: parent.failureCode,
      };
    }
    if (!['FAIL', 'FAILED'].includes(parent.status)
      || !AUTOMATIC_REFERENCE_QA_FAILURE_CODES.has(parent.failureCode)) {
      return {
        eligible: false,
        created: false,
        exhausted: false,
        reasonCode: parent.failureCode ?? 'VIDEO_AUTOMATIC_RETRY_NOT_APPLICABLE',
      };
    }

    // The parent record is a pointer to an already-submitted child. Do not
    // treat its recorded retry number as permission to create the next pass:
    // only a terminal failure of that child may unlock retry #2.
    if (['SUBMITTING', 'CREATED'].includes(parent.automaticRetry?.state)) {
      return {
        eligible: true,
        created: false,
        pending: parent.automaticRetry.state === 'SUBMITTING',
        reused: typeof parent.automaticRetry.child_clip_id === 'string',
        childClipId: parent.automaticRetry.child_clip_id ?? null,
        retryNumber: parent.automaticRetry.retry_number,
        maxRetries: parent.automaticRetry.max_retries ?? MAX_AUTOMATIC_REFERENCE_QA_RETRIES,
      };
    }

    const previousRetry = Number.isInteger(parent.automaticRetry?.retry_number)
      ? parent.automaticRetry.retry_number
      : 0;
    if (previousRetry >= MAX_AUTOMATIC_REFERENCE_QA_RETRIES) {
      return {
        eligible: true,
        created: false,
        exhausted: true,
        retryNumber: previousRetry,
        maxRetries: MAX_AUTOMATIC_REFERENCE_QA_RETRIES,
      };
    }

    const retryNumber = previousRetry + 1;
    const idempotencyKey = [
      'fashion-video-reference-qa-autoretry-v1',
      parentClipId,
      parent.failureCode,
      `attempt-${retryNumber}`,
      parent.referenceAdherenceQaSha256 ?? 'unbound-reference-qa',
    ].join(':');
    const claim = await this.#store.claimRetry(parentClipId, idempotencyKey);
    if (!claim.created) {
      return {
        eligible: true,
        created: false,
        pending: claim.claim.state === 'SUBMITTING',
        reused: typeof claim.claim.child_clip_id === 'string',
        childClipId: claim.claim.child_clip_id ?? null,
        retryNumber,
        maxRetries: MAX_AUTOMATIC_REFERENCE_QA_RETRIES,
      };
    }

    const submittedAt = new Date(this.#clock()).toISOString();
    await this.#store.save(parentClipId, {
      ...parent,
      automaticRetry: {
        version: 'fashion-video-auto-retry-v1',
        state: 'SUBMITTING',
        retry_number: retryNumber,
        max_retries: MAX_AUTOMATIC_REFERENCE_QA_RETRIES,
        reason_code: parent.failureCode,
        idempotency_key_sha256: sha256(Buffer.from(idempotencyKey)),
        submitted_at: submittedAt,
      },
      updatedAt: submittedAt,
    });

    try {
      const childResult = await this.retryFailedClip(parentClipId, {
        videoReference,
        automaticRetry: {
          retry_number: retryNumber,
          reason_code: parent.failureCode,
        },
      });
      await this.#store.completeRetryClaim(claim.claimPath, childResult.clipId);
      const latestParent = await this.#store.load(parentClipId);
      const createdAt = new Date(this.#clock()).toISOString();
      await this.#store.save(parentClipId, {
        ...latestParent,
        automaticRetry: {
          version: 'fashion-video-auto-retry-v1',
          state: 'CREATED',
          retry_number: retryNumber,
          max_retries: MAX_AUTOMATIC_REFERENCE_QA_RETRIES,
          reason_code: parent.failureCode,
          child_clip_id: childResult.clipId,
          idempotency_key_sha256: sha256(Buffer.from(idempotencyKey)),
          submitted_at: submittedAt,
          created_at: createdAt,
        },
        updatedAt: createdAt,
      });
      return {
        eligible: true,
        created: true,
        exhausted: false,
        childClipId: childResult.clipId,
        retryNumber,
        maxRetries: MAX_AUTOMATIC_REFERENCE_QA_RETRIES,
      };
    } catch (cause) {
      // Do not delete the durable SUBMITTING claim.  A missing acknowledgement
      // could mean the provider accepted the request; another automatic pass
      // would risk a duplicate paid generation.
      const latestParent = await this.#store.load(parentClipId);
      if (latestParent?.automaticRetry?.state === 'SUBMITTING') {
        const pausedAt = new Date(this.#clock()).toISOString();
        await this.#store.save(parentClipId, {
          ...latestParent,
          automaticRetry: {
            ...latestParent.automaticRetry,
            state: 'PAUSED',
            failure_code: cause?.code ?? 'VIDEO_AUTOMATIC_RETRY_SUBMISSION_FAILED',
            paused_at: pausedAt,
          },
          updatedAt: pausedAt,
        });
      }
      throw cause;
    }
  }

  async retryFailedClip(parentClipId, { videoReference, automaticRetry = null } = {}) {
    const parent = await this.#store.load(parentClipId);
    if (!parent) {
      throw new VideoServiceError('Video clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
    }
    if (!['FAIL', 'FAILED'].includes(parent.status)) {
      throw new VideoServiceError('Only a terminal failed video can be retried', {
        code: 'VIDEO_RETRY_STATUS_INVALID', status: 409,
      });
    }
    if (TERMINAL_FAL_REJECTION_CODES.has(parent.failureCode)) {
      throw new VideoServiceError(falRejectionMessage(parent.failureCode), {
        code: parent.failureCode,
        status: 409,
      });
    }
    const rejectedAutomaticChild = typeof parent.automaticRetry?.child_clip_id === 'string'
      ? await this.#store.load(parent.automaticRetry.child_clip_id)
      : null;
    if (TERMINAL_FAL_REJECTION_CODES.has(rejectedAutomaticChild?.failureCode)) {
      throw new VideoServiceError(falRejectionMessage(rejectedAutomaticChild.failureCode), {
        code: rejectedAutomaticChild.failureCode,
        status: 409,
      });
    }
    let retryVideoModel = DEFAULT_FAL_VIDEO_MODEL;
    if (parent.providerKey === FAL_VIDEO_PROVIDER) {
      let persistedModel;
      try {
        persistedModel = resolveFalVideoModel(parent.videoModel);
      } catch (cause) {
        throw new VideoServiceError('The failed clip has no valid persisted FAL model binding', {
          code: 'VIDEO_RETRY_PROVIDER_BINDING_INVALID', status: 409, cause,
        });
      }
      if (parent.providerEndpoint !== persistedModel.endpoint) {
        throw new VideoServiceError('The failed clip endpoint does not match its persisted model', {
          code: 'VIDEO_RETRY_PROVIDER_BINDING_INVALID', status: 409,
        });
      }
      retryVideoModel = persistedModel.id;
    } else if (parent.providerKey && parent.providerKey !== 'openrouter') {
      throw new VideoServiceError('This failed video provider cannot be retried by the FAL route', {
        code: 'VIDEO_RETRY_PROVIDER_BINDING_INVALID', status: 409,
      });
    }
    if (parent.lookBinding?.whiteBackgroundVerified !== true
      || parent.appearanceReferences?.some((reference) => (
        reference.white_background_verified !== true
      ))) {
      throw new VideoServiceError(
        'This failed clip used a legacy unverified appearance input and cannot be retried. Start a new Fashion Video from the approved white master.',
        { code: 'VIDEO_RETRY_LEGACY_APPEARANCE_FORBIDDEN', status: 409 },
      );
    }
    const binding = parent.motionReferenceBinding;
    if (!binding || !videoReference
      || binding.referenceId !== (videoReference.reference_id ?? null)
      || binding.sha256 !== videoReference.reference_sha256
      || binding.packSha256 !== videoReference.reference_pack_sha256) {
      throw new VideoServiceError('The selected Fashion Video style changed; retry is blocked', {
        code: 'VIDEO_RETRY_REFERENCE_MISMATCH', status: 409,
      });
    }
    const sourceImagePath = path.join(this.#store.clipDir(parentClipId), parent.sourceFile ?? 'source.png');
    const appearanceReferences = await Promise.all((parent.appearanceReferences ?? []).map(async (reference) => {
      const bytes = await readFile(path.join(this.#store.clipDir(parentClipId), reference.file));
      if (sha256(bytes) !== reference.sha256) {
        throw new VideoServiceError('A locked appearance reference changed; retry is blocked', {
          code: 'VIDEO_RETRY_APPEARANCE_MISMATCH', status: 409,
        });
      }
      return {
        role: reference.role,
        bytes,
        sha256: reference.sha256,
        white_background_verified: reference.white_background_verified,
      };
    }));
    return this.createClip({
      modeId: parent.mode,
      surfaceId: parent.surface,
      durationSeconds: parent.durationSeconds,
      // This is not a new visual claim: the parent was already admitted with
      // this full-length prerequisite. Retrying it must not silently downgrade
      // a valid stride into another motion plan.
      sourceCapabilities: parent.mode === 'walk_stride' ? { full_length: true } : {},
      sourceImagePath,
      lookBinding: parent.lookBinding,
      videoReference,
      appearanceReferences,
      videoModel: retryVideoModel,
      retryOf: parentClipId,
      automaticRetry,
    });
  }

  async #matchesCreateAcknowledgement(clip, clipId, receipt, receiptBytes) {
    try {
      if (!Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`).equals(receiptBytes)) return false;
      const model = resolveFalVideoModel(clip.videoModel);
      const request = receipt.request;
      const payload = request?.provider_payload;
      const inputMedia = receipt.provider_input_media;
      const locked = clip.immutableRequestBinding;
      const hasProfileLookBinding = Object.hasOwn(locked?.source_binding ?? {}, 'profile_id')
        && Object.hasOwn(locked?.source_binding ?? {}, 'look_id');
      const motion = clip.motionReferenceBinding;
      if (receipt.schema_version !== '1.0.0'
        || receipt.clip_id !== clipId || clip.clipId !== clipId
        || receipt.created_at !== clip.createdAt
        || receipt.provider !== FAL_VIDEO_PROVIDER
        || clip.providerKey !== FAL_VIDEO_PROVIDER
        || receipt.outcome !== undefined || clip.providerCreateOutcome !== undefined
        || clip.failureCode !== undefined || clip.providerTerminal !== undefined
        || !SAFE_FAL_REQUEST_ID.test(receipt.request_id ?? '')
        || receipt.response?.job_id !== receipt.request_id
        || receipt.response?.payload?.request_id !== receipt.request_id
        || receipt.video_model !== model.id || clip.videoModel !== model.id
        || receipt.endpoint !== model.endpoint || clip.providerEndpoint !== model.endpoint
        || !Number.isInteger(receipt.provider_create_attempt) || receipt.provider_create_attempt < 1
        || receipt.fallback_used !== false
        || locked?.schema_version !== 'fashion-video-request-binding-v1'
        || locked.source_binding?.source_sha256 !== clip.sourceSha256
        || locked.source_binding?.approved_look_receipt_sha256
          !== (clip.lookBinding?.approvedLookReceiptSha256 ?? null)
        || locked.source_binding?.white_background_verified
          !== (clip.lookBinding?.whiteBackgroundVerified === true)
        || (Object.hasOwn(locked?.source_binding ?? {}, 'profile_id') !== hasProfileLookBinding)
        || (Object.hasOwn(locked?.source_binding ?? {}, 'look_id') !== hasProfileLookBinding)
        || (hasProfileLookBinding
          && (locked.source_binding.profile_id !== (clip.lookBinding?.profileId ?? null)
            || locked.source_binding.look_id !== (clip.lookBinding?.lookId ?? null)))
        || (clip.lookBinding?.sourceSha256
          && clip.lookBinding.sourceSha256 !== clip.sourceSha256)
        || !motion || motion.audioSourceFile !== 'style-reference.mp4'
        || motion.sha256 !== motion.audioSourceSha256
        || !SHA256.test(motion.sha256 ?? '')
        || !SHA256.test(motion.packSha256 ?? '')
        || locked.motion_reference?.sha256 !== motion.sha256
        || locked.motion_reference?.reference_pack_sha256 !== motion.packSha256
        || locked.motion_reference?.provider_label !== motion.providerLabel
        || locked.motion_reference?.reference_manifest_version !== motion.referenceManifestVersion
        || locked.motion_reference?.presentation_surface !== motion.presentationSurface
        || locked.motion_reference?.aspect_ratio !== motion.aspectRatio
        || !SHA256.test(clip.sourceSha256 ?? '')
        || clip.sourceFile !== 'source.png'
        || !Array.isArray(clip.appearanceReferences)
        || !isDeepStrictEqual(request?.immutable_request_binding, locked)
        || !isDeepStrictEqual(request?.reference_bindings, locked.reference_bindings)
        || request?.source_sha256 !== clip.sourceSha256
        || request?.approved_look_receipt_sha256 !== (clip.lookBinding?.approvedLookReceiptSha256 ?? null)
        || request?.motion_reference_sha256 !== motion.sha256
        || request?.reference_pack_sha256 !== motion.packSha256
        || request?.prompt !== clip.prompt
        || request?.aspect_ratio !== clip.aspectRatio
        || request?.duration_seconds !== clip.durationSeconds
        || !isDeepStrictEqual(request?.automatic_reference_retry, locked.automatic_reference_retry)
        || inputMedia?.schema_version !== 'fal-video-input-media-v1'
        || inputMedia.provider !== FAL_VIDEO_PROVIDER
        || inputMedia.video_model !== model.id || inputMedia.endpoint !== model.endpoint
        || payload?.prompt !== falVideoPrompt(clip.prompt)
        || inputMedia.prompt_sha256 !== sha256(Buffer.from(payload.prompt))
        || payload.aspect_ratio !== clip.aspectRatio
        || payload.duration !== String(clip.durationSeconds)
        || payload.resolution !== '720p' || payload.codec !== 'H264'
        || payload.generate_audio !== false
        || (model.id === 'seedance-2.5'
          ? payload.task !== 'reference'
          : Object.hasOwn(payload, 'task'))
        || !Array.isArray(inputMedia.files)
        || !Array.isArray(payload.image_urls) || !Array.isArray(payload.video_urls)) return false;

      const sourceBytes = await readFile(path.join(this.#store.clipDir(clipId), 'source.png'));
      if (sha256(sourceBytes) !== clip.sourceSha256) return false;
      const appearanceFiles = { identity_face: 'identity-face.png', garment_detail: 'garment-detail.png' };
      const allowedRoles = ['identity_face', 'garment_detail'];
      const appearanceBindings = [];
      for (const reference of clip.appearanceReferences) {
        if (!allowedRoles.includes(reference.role)
          || reference.file !== appearanceFiles[reference.role]
          || !SHA256.test(reference.sha256 ?? '')
          || reference.white_background_verified !== true
          || appearanceBindings.some((entry) => entry.role === reference.role)) return false;
        const bytes = await readFile(path.join(this.#store.clipDir(clipId), reference.file));
        if (sha256(bytes) !== reference.sha256) return false;
        appearanceBindings.push({
          role: reference.role,
          sha256: reference.sha256,
          provider_label: reference.provider_label,
          white_background_verified: reference.white_background_verified,
        });
      }
      const expectedAppearanceRoles = ['identity_face', 'garment_detail'].filter((role) => (
        appearanceBindings.some((reference) => reference.role === role)
      ));
      if (!isDeepStrictEqual(appearanceBindings.map((reference) => reference.role), expectedAppearanceRoles)
        || !isDeepStrictEqual(locked.appearance_references, appearanceBindings)) return false;

      const referenceBytes = await readFile(path.join(this.#store.clipDir(clipId), 'style-reference.mp4'));
      if (sha256(referenceBytes) !== motion.sha256) return false;

      const expectedImages = [
        { role: 'approved_white_master', provider_label: '@Image 1', sha256: clip.sourceSha256 },
        ...appearanceBindings.map((reference, index) => ({
          role: reference.role,
          provider_label: `@Image ${index + 2}`,
          sha256: reference.sha256,
        })),
      ];
      const expectedMotion = {
        role: 'motion_reference',
        provider_label: '@Video 1',
        sha256: motion.sha256,
        duration_seconds: motion.durationSeconds,
        width: motion.width,
        height: motion.height,
        fps: motion.fps,
        cut_sheet_sha256: motion.cutSheetSha256,
      };
      const bindings = locked.reference_bindings;
      if (bindings?.schema_version !== motion.referenceManifestVersion
        || !isDeepStrictEqual(bindings.images, expectedImages)
        || !isDeepStrictEqual(bindings.motion_reference, expectedMotion)
        || !isDeepStrictEqual(request.appearance_references, appearanceBindings)
        || inputMedia.files.length !== expectedImages.length + 1
        || payload.image_urls.length !== expectedImages.length
        || payload.video_urls.length !== 1) return false;

      for (const [index, binding] of expectedImages.entries()) {
        const uploaded = inputMedia.files[index];
        if (uploaded?.role !== binding.role
          || uploaded.provider_label !== `@Image${index + 1}`
          || uploaded.source_sha256 !== binding.sha256
          || uploaded.uploaded_sha256 !== binding.sha256
          || uploaded.normalized !== false
          || typeof uploaded.url !== 'string' || !uploaded.url.startsWith('https://')
          || payload.image_urls[index] !== uploaded.url) return false;
      }
      const uploadedMotion = inputMedia.files.at(-1);
      if (uploadedMotion?.role !== 'motion_reference'
        || uploadedMotion.provider_label !== '@Video1'
        || uploadedMotion.source_sha256 !== motion.sha256
        || !SHA256.test(uploadedMotion.uploaded_sha256 ?? '')
        || typeof uploadedMotion.normalized !== 'boolean'
        || typeof uploadedMotion.url !== 'string' || !uploadedMotion.url.startsWith('https://')
        || payload.video_urls[0] !== uploadedMotion.url
        || (uploadedMotion.normalized
          && (uploadedMotion.normalization?.source_sha256 !== motion.sha256
            || uploadedMotion.normalization?.uploaded_sha256 !== uploadedMotion.uploaded_sha256
            || uploadedMotion.normalization?.duration_preserved !== true))
        || (!uploadedMotion.normalized && uploadedMotion.uploaded_sha256 !== motion.sha256)) return false;
      return true;
    } catch {
      return false;
    }
  }

  /** Restore only the successful local POST receipt; never trust a caller-supplied job id. */
  async recoverSubmittedClip(clipId) {
    const clip = await this.#store.load(clipId);
    if (!clip) {
      throw new VideoServiceError('Clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
    }
    if (clip.status !== 'SUBMITTING' || clip.jobId) {
      throw new VideoServiceError('Only an unbound SUBMITTING clip can be recovered', {
        code: 'CLIP_STATUS_INVALID',
        status: 409,
      });
    }
    let receiptBytes;
    let receipt;
    try {
      receiptBytes = await readFile(path.join(this.#store.clipDir(clipId), 'create-receipt.json'));
      receipt = JSON.parse(receiptBytes.toString('utf8'));
    } catch {
      throw new VideoServiceError('The local create acknowledgement cannot be verified', {
        code: 'RECOVERY_PROVIDER_BINDING_UNVERIFIABLE', status: 409,
      });
    }
    if (!await this.#matchesCreateAcknowledgement(clip, clipId, receipt, receiptBytes)) {
      throw new VideoServiceError('The local create acknowledgement cannot be verified', {
        code: 'RECOVERY_PROVIDER_BINDING_UNVERIFIABLE', status: 409,
      });
    }
    const recovered = {
      ...clip,
      jobId: receipt.request_id,
      providerRequestId: receipt.request_id,
      providerKey: FAL_VIDEO_PROVIDER,
      videoModel: receipt.video_model,
      providerEndpoint: receipt.endpoint,
      providerCreateAttempt: receipt.provider_create_attempt,
      fallbackUsed: receipt.fallback_used,
      providerInputMedia: receipt.provider_input_media,
      status: 'CREATED',
      createReceiptSha256: sha256(receiptBytes),
      createReceiptFile: 'create-receipt.json',
      updatedAt: new Date(this.#clock()).toISOString(),
    };
    await this.#store.save(clipId, recovered);
    return {
      clipId,
      jobId: recovered.jobId,
      requestId: recovered.providerRequestId,
      status: recovered.status,
      videoModel: recovered.videoModel,
      providerEndpoint: recovered.providerEndpoint,
    };
  }

  /**
   * Wait for a created job to finish, download the result, run QA.
   *
   * `downloadFn(url)` must return the video bytes as a Buffer/Uint8Array.
   * `probeFn`/`extractFrameFn` are passed to clip QA.
   */
  async awaitAndFinalize(clipId, {
    downloadFn, probeFn, extractFrameFn, composeFn,
  }) {
    const clip = await this.#store.load(clipId);
    if (!clip) {
      throw new VideoServiceError('Clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
    }
    const resumeOutputDownload = clip.status === 'OUTPUT_DOWNLOAD_FAILED'
      && typeof clip.providerOutputUrl === 'string'
      && clip.providerOutputUrl.length > 0;
    if (clip.status !== 'CREATED' && clip.status !== 'GENERATING' && !resumeOutputDownload) {
      throw new VideoServiceError(
        `Clip is in status ${clip.status}, cannot await`,
        { code: 'CLIP_STATUS_INVALID', status: 409 },
      );
    }

    // A download failure is a separate, resumable stage. If the provider URL
    // was already captured, retry only the download; never poll a missing job
    // again and never create a second paid job implicitly.
    let finished = resumeOutputDownload
      ? {
          jobId: clip.jobId,
          url: clip.providerOutputUrl,
          selectedFieldPath: clip.providerOutputFieldPath ?? null,
          raw: null,
        }
      : null;

    if (!resumeOutputDownload) {
      // Persist a short-lived lease before entering the provider wait. This is
      // the only durable evidence that a deployment must not restart an active
      // waiter. A bare GENERATING status can be left behind by a crashed daemon
      // and is deliberately not enough to block a later release.
      clip.status = 'GENERATING';
      clip.updatedAt = new Date(this.#clock()).toISOString();
      clip.providerWaitLease = {
        jobId: clip.jobId,
        startedAt: clip.updatedAt,
        heartbeatAt: clip.updatedAt,
      };
      await this.#store.save(clipId, clip);

      // Phase 2: wait for the job to finish
      try {
        finished = await this.#provider.waitForJob({
          jobId: clip.jobId,
          providerKey: clip.providerKey,
          videoModel: clip.videoModel,
          providerEndpoint: clip.providerEndpoint,
          providerRequestId: clip.providerRequestId,
        });
      } catch (cause) {
      // Provider-terminal outcomes cannot be recovered by polling the same
      // immutable job again. Persist them as retryable failure evidence; do
      // not invent a video, issue another paid create, or leave a stale
      // GENERATING state that blocks deployment forever.
        if (['PROVIDER_JOB_NOT_FOUND', 'PROVIDER_JOB_FAILED', 'MISSING_VIDEO_OUTPUT']
          .includes(cause?.code) || TERMINAL_FAL_REJECTION_CODES.has(cause?.code)) {
          clip.status = 'FAILED';
          clip.failureCode = TERMINAL_FAL_REJECTION_CODES.has(cause.code)
            ? cause.code
            : cause.code === 'MISSING_VIDEO_OUTPUT'
              ? 'MISSING_VIDEO_OUTPUT'
              : cause.code === 'PROVIDER_JOB_FAILED'
                ? 'VIDEO_PROVIDER_JOB_FAILED'
                : 'VIDEO_PROVIDER_JOB_NOT_FOUND';
          clip.providerTerminal = {
            code: clip.failureCode,
            jobId: clip.jobId,
            recordedAt: new Date(this.#clock()).toISOString(),
            // A retry creates a new explicit child attempt; the finished
            // provider job itself is immutable and will never be polled again.
            retryable: !TERMINAL_FAL_REJECTION_CODES.has(cause.code)
              && cause.code !== 'PROVIDER_JOB_NOT_FOUND',
          };
          delete clip.providerWaitLease;
          clip.updatedAt = new Date(this.#clock()).toISOString();
          await this.#store.save(clipId, clip);
          const message = TERMINAL_FAL_REJECTION_CODES.has(cause.code)
            ? cause.message
            : cause.code === 'MISSING_VIDEO_OUTPUT'
              ? 'Provider finished without a video URL; no video was generated.'
              : cause.code === 'PROVIDER_JOB_FAILED'
                ? 'The video provider marked this job failed; create a new attempt to retry.'
                : 'The video provider no longer has this job; it was not generated.';
          throw new VideoServiceError(message, {
            code: clip.failureCode,
            status: TERMINAL_FAL_REJECTION_CODES.has(cause.code) ? 422 : 502,
          });
        }
        // A transport blip is retryable against the same job. The current wait
        // is over, so remove its lease; a future request will acquire a fresh one.
        delete clip.providerWaitLease;
        clip.updatedAt = new Date(this.#clock()).toISOString();
        await this.#store.save(clipId, clip);
        throw cause;
      }
    }

    if (!finished.url) {
      clip.status = 'FAILED';
      clip.failureCode = 'MISSING_VIDEO_OUTPUT';
      clip.providerTerminal = {
        code: 'MISSING_VIDEO_OUTPUT', jobId: clip.jobId,
        recordedAt: new Date(this.#clock()).toISOString(), retryable: true,
      };
      delete clip.providerWaitLease;
      clip.updatedAt = new Date(this.#clock()).toISOString();
      await this.#store.save(clipId, clip);
      throw new VideoServiceError('Provider finished without a video URL', {
        code: 'MISSING_VIDEO_OUTPUT', status: 502,
      });
    }

    // The remote wait has settled. It is no longer deployment-blocking even
    // while the local download and QA stages continue.
    delete clip.providerWaitLease;

    if (finished.raw !== null && finished.raw !== undefined) {
      const rawPayloadSha256 = sha256(Buffer.from(JSON.stringify(finished.raw)));
      const waitReceipt = {
        schema_version: '1.0.0',
        clip_id: clipId,
        job_id: clip.jobId,
        provider: clip.providerKey,
        selected_field_path: finished.selectedFieldPath ?? null,
        selected_url_sanitized: sanitizedUrl(finished.url),
        raw_payload_sha256: rawPayloadSha256,
        raw_payload_sanitized: sanitizeProviderWaitValue(finished.raw),
      };
      const waitReceiptBytes = Buffer.from(`${JSON.stringify(waitReceipt, null, 2)}\n`);
      const waitReceiptSha256 = sha256(waitReceiptBytes);
      const waitReceiptFile = `provider-wait-receipt-${rawPayloadSha256.slice(0, 16)}.json`;
      await this.#store.saveQaReceipt(
        clipId,
        waitReceiptFile,
        waitReceiptBytes,
        'PROVIDER_WAIT_RECEIPT_CONFLICT',
      );
      clip.providerWaitReceiptFile = waitReceiptFile;
      clip.providerWaitReceiptSha256 = waitReceiptSha256;
    }
    clip.providerOutputFieldPath = finished.selectedFieldPath ?? null;
    // Keep the provider URL private and durable so a failed transfer can be
    // resumed without polling or paying for another provider job.
    clip.providerOutputUrl = finished.url;

    // Download
    if (typeof downloadFn !== 'function') {
      throw new VideoServiceError('A downloadFn is required', {
        code: 'SERVICE_MISCONFIGURED',
      });
    }
    let providerVideoBytes;
    try {
      providerVideoBytes = await downloadFn(finished.url);
    } catch (cause) {
      clip.status = 'OUTPUT_DOWNLOAD_FAILED';
      clip.failureCode = 'VIDEO_OUTPUT_DOWNLOAD_FAILED';
      clip.providerDownloadError = {
        code: cause?.code ?? 'VIDEO_DOWNLOAD_FAILED',
        recordedAt: new Date(this.#clock()).toISOString(),
        retryable: true,
      };
      clip.updatedAt = new Date(this.#clock()).toISOString();
      await this.#store.save(clipId, clip);
      throw new VideoServiceError('Відео створене, але його завантаження на сервер не завершилось.', {
        code: 'VIDEO_OUTPUT_DOWNLOAD_FAILED',
        status: 502,
        cause,
      });
    }
    const providerVideoSha256 = sha256(providerVideoBytes);
    if (clip.motionReferenceBinding?.sha256 === providerVideoSha256) {
      clip.status = 'FAIL';
      clip.failureCode = 'VIDEO_PROVIDER_OUTPUT_IS_REFERENCE';
      clip.providerVideoSha256 = providerVideoSha256;
      clip.videoUrl = sanitizedUrl(finished.url);
      clip.updatedAt = new Date(this.#clock()).toISOString();
      await this.#store.save(clipId, clip);
      throw new VideoServiceError('Provider selected the locked motion reference as output', {
        code: 'VIDEO_PROVIDER_OUTPUT_IS_REFERENCE', status: 502,
      });
    }
    const providerVideoPath = await this.#store.saveProviderVideo(clipId, providerVideoBytes);
    let videoPath = providerVideoPath;
    let audioBinding = { policy: 'SILENT_REQUIRED', referenceAudioAttached: false };

    // A Fashion Video uses a private directing reference as input. Provider
    // sound is not evidence and must never be delivered. Assemble the final
    // file before QA: retain newly generated picture, remove provider audio,
    // and use the exact locked reference audio when it exists. A silent
    // reference intentionally yields a silent delivery, never a false fail.
    if (clip.motionReferenceBinding) {
      if (typeof composeFn !== 'function') {
        throw new VideoServiceError('Fashion Video delivery audio assembler is not configured', {
          code: 'DELIVERY_AUDIO_ASSEMBLER_MISCONFIGURED', status: 503,
        });
      }
      const referenceFile = clip.motionReferenceBinding.audioSourceFile;
      const referenceSha256 = clip.motionReferenceBinding.audioSourceSha256;
      const referencePath = typeof referenceFile === 'string'
        ? path.join(this.#store.clipDir(clipId), referenceFile)
        : null;
      let referenceBytes;
      try {
        referenceBytes = referencePath ? await readFile(referencePath) : null;
      } catch {
        referenceBytes = null;
      }
      if (!referenceBytes || !SHA256.test(referenceSha256 ?? '')
        || sha256(referenceBytes) !== referenceSha256) {
        clip.status = 'FAILED';
        clip.failureCode = 'DELIVERY_AUDIO_REFERENCE_INVALID';
        clip.updatedAt = new Date(this.#clock()).toISOString();
        await this.#store.save(clipId, clip);
        throw new VideoServiceError('Locked Fashion Video audio reference is missing or changed', {
          code: 'DELIVERY_AUDIO_REFERENCE_INVALID', status: 409,
        });
      }
      const assemblyPath = path.join(this.#store.clipDir(clipId), 'clip.assembling.mp4');
      try {
        audioBinding = await composeFn({
          providerVideoPath,
          referenceVideoPath: referencePath,
          outputPath: assemblyPath,
        });
        const deliveryBytes = await readFile(assemblyPath);
        videoPath = await this.#store.saveVideo(clipId, deliveryBytes);
      } catch (cause) {
        clip.status = 'FAILED';
        clip.failureCode = 'DELIVERY_AUDIO_ASSEMBLY_FAILED';
        clip.updatedAt = new Date(this.#clock()).toISOString();
        await this.#store.save(clipId, clip);
        throw new VideoServiceError('Could not assemble approved delivery audio', {
          code: 'DELIVERY_AUDIO_ASSEMBLY_FAILED', status: 502, cause,
        });
      } finally {
        await rm(assemblyPath, { force: true });
      }
    } else {
      // Non-reference legacy motion has no approved audio source. Strip
      // provider sound in its own transport before delivery once migrated.
      videoPath = await this.#store.saveVideo(clipId, providerVideoBytes);
    }
    const deliveryBytes = await readFile(videoPath);
    const videoSha256 = sha256(deliveryBytes);

    // QA
    const mode = clip;
    const expected = {
      durationMin: clip.durationSeconds,
      durationMax: clip.durationSeconds,
      aspectRatio: clip.aspectRatio,
      audioPolicy: audioBinding.policy,
    };

    // If probeFn is provided, run full QA; otherwise mark as NEEDS_QA
    let qa = null;
    if (typeof probeFn === 'function' && typeof extractFrameFn === 'function') {
      const probe = await probeFn(videoPath);
      const [firstFrameRgb, lastFrameRgb] = await Promise.all([
        extractFrameFn(videoPath, 'first'),
        extractFrameFn(videoPath, 'last'),
      ]);
      qa = evaluateClipQa(expected, { ...probe, firstFrameRgb, lastFrameRgb });
      clip.deliveryDurationSeconds = probe.durationSeconds;
    }

    clip.status = qa
      ? (qa.pass
          ? (clip.motionReferenceBinding ? 'NEEDS_QA' : 'PASS')
          : 'FAIL')
      : 'NEEDS_QA';
    clip.videoUrl = sanitizedUrl(finished.url);
    clip.providerVideoSha256 = providerVideoSha256;
    clip.providerVideoFile = 'provider.mp4';
    clip.videoSha256 = videoSha256;
    clip.videoPath = videoPath;
    clip.audioBinding = audioBinding;
    clip.qa = qa;
    clip.failureCode = qa?.pass === false
      ? (qa.defects?.[0]?.code ?? 'VIDEO_TECHNICAL_QA_FAILED')
      : null;
    clip.updatedAt = new Date(this.#clock()).toISOString();
    await this.#store.save(clipId, clip);

    return {
      clipId,
      status: clip.status,
      videoSha256,
      qa,
    };
  }

  /**
   * Full flow: create → wait → finalize in one call.
   * The job id is persisted between create and wait, so a restart can resume.
   */
  async generateClip(request, {
    downloadFn, probeFn, extractFrameFn, composeFn,
  } = {}) {
    const created = await this.createClip(request);
    const result = await this.awaitAndFinalize(created.clipId, {
      downloadFn,
      probeFn,
      extractFrameFn,
      composeFn,
    });
    return { ...created, ...result };
  }

  /**
   * Resume/finalize using the runtime-owned dependencies. This is the method
   * exposed to HTTP so a restart polls the persisted provider job instead of
   * issuing another paid create.
   */
  async finalizeClip(clipId) {
    const {
      downloadFn, probeFn, extractFrameFn, composeFn,
    } = this.#finalizer;
    let clip = await this.#store.load(clipId);
    if (!clip) {
      throw new VideoServiceError('Clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
    }
    let result = { clipId, status: clip.status, videoSha256: clip.videoSha256, qa: clip.qa };
    if (['CREATED', 'GENERATING', 'OUTPUT_DOWNLOAD_FAILED'].includes(clip.status)) {
      if (typeof downloadFn !== 'function'
        || typeof probeFn !== 'function'
        || typeof extractFrameFn !== 'function') {
        throw new VideoServiceError('Video finalization runtime is not configured', {
          code: 'FINALIZER_MISCONFIGURED',
          status: 503,
        });
      }
      result = await this.awaitAndFinalize(clipId, {
        downloadFn,
        probeFn,
        extractFrameFn,
        composeFn,
      });
      clip = await this.#store.load(clipId);
    }
    if (clip.status === 'NEEDS_QA') {
      return this.runAutomaticQa(clipId);
    }
    return result;
  }

  async runAutomaticQa(clipId) {
    if (typeof this.#automaticQaFn !== 'function') {
      const clip = await this.#store.load(clipId);
      if (!clip) throw new VideoServiceError('Clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
      const failed = {
        ...clip,
        status: 'FAIL',
        failureCode: 'VIDEO_AUTOMATIC_QA_MISCONFIGURED',
        updatedAt: new Date(this.#clock()).toISOString(),
      };
      await this.#store.save(clipId, failed);
      return { clipId, status: failed.status, failureCode: failed.failureCode };
    }
    // Original review may create a salvage, and the first salvage review may
    // trim one residual boundary leak. Each derivative is hash-bound and must
    // complete its own fresh semantic pass; no further recursive repair occurs.
    for (let pass = 0; pass < 3; pass += 1) {
      const clip = await this.#store.load(clipId);
      if (!clip) throw new VideoServiceError('Clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
      if (clip.status !== 'NEEDS_QA') {
        return { clipId, status: clip.status, videoSha256: clip.videoSha256, qa: clip.qa };
      }
      let receipts;
      try {
        receipts = await this.#automaticQaFn(clip);
      } catch (cause) {
        const failed = {
          ...clip,
          status: 'FAIL',
          failureCode: typeof cause?.code === 'string'
            ? cause.code
            : 'VIDEO_AUTOMATIC_QA_FAILED',
          updatedAt: new Date(this.#clock()).toISOString(),
        };
        await this.#store.save(clipId, failed);
        return { clipId, status: failed.status, failureCode: failed.failureCode };
      }
      await this.recordIdentityItemQa(clipId, receipts.identityReceipt);
      await this.recordReferenceAdherenceQa(clipId, receipts.referenceReceipt);
    }
    const clip = await this.#store.load(clipId);
    if (clip?.status === 'NEEDS_QA') {
      clip.status = 'FAIL';
      clip.failureCode = 'VIDEO_AUTOMATIC_QA_INCOMPLETE';
      clip.updatedAt = new Date(this.#clock()).toISOString();
      await this.#store.save(clipId, clip);
    }
    return { clipId, status: clip?.status, videoSha256: clip?.videoSha256, qa: clip?.qa };
  }

  /**
   * Return only persisted remote jobs whose wait phase can be resumed.  The
   * caller still owns scheduling/concurrency; this method never creates jobs.
   */
  async resumableClipIds() {
    for (const clipId of await this.#store.resumableClipIds({ includeSubmitting: true })) {
      if ((await this.#store.load(clipId))?.status !== 'SUBMITTING') continue;
      try {
        await this.recoverSubmittedClip(clipId);
      } catch (error) {
        if (error?.code !== 'RECOVERY_PROVIDER_BINDING_UNVERIFIABLE') throw error;
      }
    }
    return this.#store.resumableClipIds();
  }

  /**
   * Persist the independently evaluated first/last-frame identity and item QA.
   * Technical MP4 QA cannot override this semantic gate.
   */
  async recordIdentityItemQa(clipId, receipt) {
    const clip = await this.#store.load(clipId);
    if (!clip) {
      throw new VideoServiceError('Clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
    }
    const salvageReview = Boolean(clip.salvage)
      && receipt?.output_sha256 === clip.videoSha256;
    const exactBinding = receipt?.clip_id === clip.clipId
      && receipt?.job_id === clip.jobId
      && receipt?.source_sha256 === clip.sourceSha256
      && (!salvageReview || receipt?.output_sha256 === clip.videoSha256);
    const firstDecision = receipt?.results?.first?.decision;
    const lastDecision = receipt?.results?.last?.decision;
    if (!exactBinding || typeof firstDecision !== 'string' || typeof lastDecision !== 'string') {
      throw new VideoServiceError('Identity/item QA does not match the persisted clip', {
        code: 'QA_RECEIPT_MISMATCH',
        status: 409,
      });
    }
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const identityItemQaSha256 = sha256(receiptBytes);
    const salvageIdentityReceiptFile = (clip.salvage?.revision ?? 0) > 0
      ? `salvage-identity-item-qa-v${(clip.salvage.revision ?? 0) + 1}.json`
      : 'salvage-identity-item-qa.json';
    if (salvageReview) {
      await this.#store.saveQaReceipt(
        clipId,
        salvageIdentityReceiptFile,
        receiptBytes,
        'SALVAGE_IDENTITY_QA_RECEIPT_CONFLICT',
      );
    } else {
      await this.#store.saveIdentityItemQa(clipId, receiptBytes);
    }
    const strictPass = firstDecision === 'PASS' && lastDecision === 'PASS';
    const pass = strictPass || this.#fashionVideoQaMode === 'delivery';
    const referencePass = salvageReview
      ? clip.salvageReferenceAdherenceQa?.pass === true
      : clip.referenceAdherenceQa?.pass === true;
    const technicalPass = clip.qa?.pass;
    const identityField = salvageReview ? 'salvageIdentityItemQa' : 'identityItemQa';
    const identityShaField = salvageReview
      ? 'salvageIdentityItemQaSha256'
      : 'identityItemQaSha256';
    const identityFileField = salvageReview
      ? 'salvageIdentityItemQaFile'
      : 'identityItemQaFile';
    const originalReferenceReviewPending = !salvageReview
      && Boolean(clip.motionReferenceBinding)
      && !clip.referenceAdherenceQa;
    const updated = {
      ...clip,
      status: technicalPass === false
        ? 'FAIL'
        : !pass
          ? (originalReferenceReviewPending ? 'NEEDS_QA' : 'FAIL')
        : technicalPass !== true
          ? 'NEEDS_QA'
          : clip.motionReferenceBinding
            ? (referencePass ? 'PASS' : 'NEEDS_QA')
            : 'PASS',
      [identityField]: {
        pass,
        strictPass,
        advisory: !strictPass && this.#fashionVideoQaMode === 'delivery',
        firstDecision,
        lastDecision,
        evaluator: receipt.evaluator ?? null,
      },
      [identityShaField]: identityItemQaSha256,
      [identityFileField]: salvageReview
        ? salvageIdentityReceiptFile
        : 'identity-item-qa.json',
      failureCode: !pass && !originalReferenceReviewPending
        ? (salvageReview
            ? 'VIDEO_SALVAGE_IDENTITY_ITEM_QA_FAILED'
            : 'VIDEO_IDENTITY_ITEM_QA_FAILED')
        : technicalPass === false
          ? (clip.failureCode ?? 'VIDEO_TECHNICAL_QA_FAILED')
          : null,
      updatedAt: new Date(this.#clock()).toISOString(),
    };
    if (salvageReview) {
      updated.salvage = {
        ...clip.salvage,
        status: updated.status === 'PASS'
          ? 'PASS'
          : updated.status === 'FAIL' ? 'FAIL' : 'NEEDS_QA',
        reviewedAt: new Date(this.#clock()).toISOString(),
      };
    }
    await this.#store.save(clipId, updated);
    return {
      clipId,
      status: updated.status,
      identityItemQa: updated[identityField],
      identityItemQaSha256,
    };
  }

  /**
   * Persist the blocking Fashion Video reference-transfer decision. Technical
   * validity and identity stability cannot substitute for this gate.
   */
  async recordReferenceAdherenceQa(clipId, receipt) {
    const clip = await this.#store.load(clipId);
    if (!clip) {
      throw new VideoServiceError('Clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
    }
    const expectedReferenceSha256 = clip.motionReferenceBinding?.sha256;
    const salvageReview = Boolean(clip.salvage)
      && receipt?.output_sha256 === clip.videoSha256;
    const checks = receipt?.checks;
    const exactBinding = receipt?.clip_id === clip.clipId
      && receipt?.job_id === clip.jobId
      && receipt?.source_sha256 === clip.sourceSha256
      && receipt?.motion_reference_sha256 === expectedReferenceSha256
      && (!salvageReview || receipt?.output_sha256 === clip.videoSha256);
    const requiredChecks = REQUIRED_REFERENCE_CHECKS;
    const decisions = new Map(
      Array.isArray(checks)
        ? checks.map((check) => [check?.name, check?.decision])
        : [],
    );
    const coverageDuration = salvageReview
      ? clip.deliveryDurationSeconds
      : clip.durationSeconds;
    const cutCoverage = validatedMicroCutCoverage(receipt?.cut_coverage, coverageDuration);
    if (!exactBinding || !cutCoverage
      || requiredChecks.some((name) => !['PASS', 'FAIL'].includes(decisions.get(name)))) {
      throw new VideoServiceError('Reference-adherence QA does not match the persisted clip', {
        code: 'REFERENCE_QA_RECEIPT_MISMATCH',
        status: 409,
      });
    }
    const strictBlockingChecks = salvageReview
      ? SALVAGE_BLOCKING_REFERENCE_CHECKS
      : requiredChecks;
    const strictPass = cutCoverage.pass
      && strictBlockingChecks.every((name) => decisions.get(name) === 'PASS');
    const deliverySafetyPass = cutCoverage.deliverySafetyPass === true
      && DELIVERY_SAFETY_REFERENCE_CHECKS.every((name) => decisions.get(name) === 'PASS');
    const pass = this.#fashionVideoQaMode === 'delivery'
      ? deliverySafetyPass
      : strictPass;
    const nonBlockingFailures = salvageReview
      ? requiredChecks.filter((name) => !strictBlockingChecks.includes(name)
        && decisions.get(name) === 'FAIL')
      : [];
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const referenceAdherenceQaSha256 = sha256(receiptBytes);
    const receiptFilename = salvageReview
      ? ((clip.salvage?.revision ?? 0) > 0
          ? `salvage-reference-adherence-qa-v${(clip.salvage.revision ?? 0) + 1}.json`
          : 'salvage-reference-adherence-qa.json')
      : 'reference-adherence-qa.json';
    await this.#store.saveQaReceipt(
      clipId,
      receiptFilename,
      receiptBytes,
      salvageReview
        ? 'SALVAGE_REFERENCE_QA_RECEIPT_CONFLICT'
        : 'REFERENCE_QA_RECEIPT_CONFLICT',
    );
    const identityPass = salvageReview
      ? clip.salvageIdentityItemQa?.pass === true
      : clip.identityItemQa?.pass === true;
    const identityRecorded = salvageReview
      ? Boolean(clip.salvageIdentityItemQa)
      : Boolean(clip.identityItemQa);
    const technicalPass = clip.qa?.pass;
    const qaField = salvageReview
      ? 'salvageReferenceAdherenceQa'
      : 'referenceAdherenceQa';
    const qaShaField = salvageReview
      ? 'salvageReferenceAdherenceQaSha256'
      : 'referenceAdherenceQaSha256';
    const qaFileField = salvageReview
      ? 'salvageReferenceAdherenceQaFile'
      : 'referenceAdherenceQaFile';
    const updated = {
      ...clip,
      status: !pass || technicalPass === false
        ? 'FAIL'
        : technicalPass !== true || !identityRecorded
          ? 'NEEDS_QA'
          : identityPass ? 'PASS' : 'FAIL',
      [qaField]: {
        pass,
        strictPass,
        deliverySafetyPass,
        qaMode: this.#fashionVideoQaMode,
        decisions: Object.fromEntries(requiredChecks.map((name) => [name, decisions.get(name)])),
        cutCoverage,
        acceptanceContract: salvageReview
          ? 'SALVAGE_HERO_ONLY_V1'
          : 'FULL_REFERENCE_TRANSFER_V1',
        blockingChecks: this.#fashionVideoQaMode === 'delivery'
          ? [...DELIVERY_SAFETY_REFERENCE_CHECKS]
          : [...strictBlockingChecks],
        nonBlockingFailures: this.#fashionVideoQaMode === 'delivery'
          ? requiredChecks.filter((name) => !DELIVERY_SAFETY_REFERENCE_CHECKS.includes(name)
            && decisions.get(name) === 'FAIL')
          : nonBlockingFailures,
        evaluator: receipt.evaluator ?? null,
      },
      [qaShaField]: referenceAdherenceQaSha256,
      [qaFileField]: receiptFilename,
      ...(salvageReview
        ? {
            salvage: {
              ...clip.salvage,
              status: pass && technicalPass === true && identityPass
                ? 'PASS'
                : (pass && !identityRecorded ? 'NEEDS_QA' : 'FAIL'),
              reviewedAt: new Date(this.#clock()).toISOString(),
            },
          }
        : {}),
      updatedAt: new Date(this.#clock()).toISOString(),
    };

    if (!salvageReview && !pass) {
      const approvedDurationMs = cutCoverage.approvedHeroSegments.reduce(
        (total, segment) => total + segment.end_ms - segment.start_ms,
        0,
      );
      // A bad provider result is still locally repairable whenever the cut
      // audit found at least one second of independently PASSed avatar-only
      // footage. Global creative failures often describe the rejected cuts;
      // they must not prevent us from discarding those cuts. The derivative
      // inherits no semantic PASS and is audited again against its own SHA.
      const salvageEligible = cutCoverage.referenceLeakDetected
        && approvedDurationMs >= 1_000;
      if (salvageEligible) {
        const { salvageFn, probeFn, extractFrameFn } = this.#finalizer;
        if (typeof salvageFn !== 'function'
          || typeof probeFn !== 'function'
          || typeof extractFrameFn !== 'function') {
          updated.salvage = {
            eligible: true,
            status: 'BLOCKED',
            failureCode: 'VIDEO_QA_SALVAGE_MISCONFIGURED',
          };
          updated.failureCode = updated.salvage.failureCode;
        } else {
          let referencePath = null;
          const lockedReferenceFile = clip.motionReferenceBinding?.audioSourceFile;
          if (typeof lockedReferenceFile === 'string') {
            const candidate = path.join(this.#store.clipDir(clipId), lockedReferenceFile);
            try {
              const bytes = await readFile(candidate);
              if (sha256(bytes) === expectedReferenceSha256) referencePath = candidate;
            } catch {
              referencePath = null;
            }
          }
          if (!referencePath && typeof this.#fashionVideoReferenceResolver === 'function') {
            const reference = await this.#fashionVideoReferenceResolver({
              motionMode: clip.mode,
              referenceId: clip.motionReferenceBinding?.referenceId,
            });
            if (reference?.state === 'READY'
              && reference.reference_sha256 === expectedReferenceSha256
              && typeof reference.reference_path === 'string') {
              try {
                const bytes = await readFile(reference.reference_path);
                if (sha256(bytes) === expectedReferenceSha256) {
                  referencePath = reference.reference_path;
                }
              } catch {
                referencePath = null;
              }
            }
          }
          if (!referencePath) {
            updated.salvage = {
              eligible: true,
              status: 'BLOCKED',
              failureCode: 'VIDEO_QA_SALVAGE_REFERENCE_MISMATCH',
            };
            updated.failureCode = updated.salvage.failureCode;
            await this.#store.save(clipId, updated);
            return {
              clipId,
              status: updated.status,
              referenceAdherenceQa: updated[qaField],
              referenceAdherenceQaSha256,
              salvage: updated.salvage,
            };
          }
          const salvagedVideoPath = this.#store.salvagedVideoPath(clipId);
          let salvageResult;
          try {
            salvageResult = await salvageFn({
              sourceVideoPath: clip.videoPath,
              referenceVideoPath: referencePath,
              outputVideoPath: salvagedVideoPath,
              segments: cutCoverage.approvedHeroSegments,
            });
          } catch (cause) {
            updated.salvage = {
              eligible: true,
              status: 'BLOCKED',
              failureCode: cause?.code ?? 'VIDEO_QA_SALVAGE_FAILED',
            };
            updated.failureCode = updated.salvage.failureCode;
            await this.#store.save(clipId, updated);
            return {
              clipId,
              status: updated.status,
              referenceAdherenceQa: updated[qaField],
              referenceAdherenceQaSha256,
              salvage: updated.salvage,
            };
          }
          const salvagedBytes = await readFile(salvagedVideoPath);
          const salvagedVideoSha256 = sha256(salvagedBytes);
          const probe = await probeFn(salvagedVideoPath);
          const [firstFrameRgb, lastFrameRgb] = await Promise.all([
            extractFrameFn(salvagedVideoPath, 'first'),
            extractFrameFn(salvagedVideoPath, 'last'),
          ]);
          const salvageTechnicalQa = evaluateClipQa({
            durationMin: salvageResult.durationSeconds,
            durationMax: salvageResult.durationSeconds,
            aspectRatio: clip.aspectRatio,
            audioPolicy: salvageResult.audioPolicy ?? clip.audioBinding?.policy ?? 'REFERENCE_REQUIRED',
          }, { ...probe, firstFrameRgb, lastFrameRgb });
          const salvagedAt = new Date(this.#clock()).toISOString();
          const salvageReceipt = {
            schema_version: '1.0.0',
            clip_id: clipId,
            created_at: salvagedAt,
            source_video_sha256: clip.videoSha256,
            motion_reference_sha256: expectedReferenceSha256,
            triggering_reference_qa_sha256: referenceAdherenceQaSha256,
            output_video_sha256: salvagedVideoSha256,
            duration_seconds: salvageResult.durationSeconds,
            segments: salvageResult.segments,
            audio_source: salvageResult.audioSource,
            audio_policy: salvageResult.audioPolicy ?? clip.audioBinding?.policy ?? 'REFERENCE_REQUIRED',
            technical_qa: salvageTechnicalQa,
          };
          const salvageReceiptBytes = Buffer.from(`${JSON.stringify(salvageReceipt, null, 2)}\n`);
          const salvageReceiptSha256 = sha256(salvageReceiptBytes);
          await this.#store.saveQaReceipt(
            clipId,
            'salvage-receipt.json',
            salvageReceiptBytes,
            'VIDEO_QA_SALVAGE_RECEIPT_CONFLICT',
          );
          Object.assign(updated, {
            status: salvageTechnicalQa.pass ? 'NEEDS_QA' : 'FAIL',
            failureCode: salvageTechnicalQa.pass
              ? null
              : (salvageTechnicalQa.defects?.[0]?.code ?? 'VIDEO_QA_SALVAGE_TECHNICAL_FAIL'),
            originalProviderVideoPath: clip.videoPath,
            originalProviderVideoSha256: clip.videoSha256,
            videoPath: salvagedVideoPath,
            videoSha256: salvagedVideoSha256,
            deliveryDurationSeconds: salvageResult.durationSeconds,
            qa: salvageTechnicalQa,
            audioBinding: {
              ...(clip.audioBinding ?? {}),
              policy: salvageResult.audioPolicy ?? clip.audioBinding?.policy ?? 'REFERENCE_REQUIRED',
              source: salvageResult.audioSource,
            },
            salvage: {
              eligible: true,
              status: salvageTechnicalQa.pass ? 'NEEDS_QA' : 'FAIL',
              segmentCount: salvageResult.segmentCount,
              segments: salvageResult.segments,
              audioSource: salvageResult.audioSource,
              receiptFile: 'salvage-receipt.json',
              receiptSha256: salvageReceiptSha256,
              salvagedAt,
            },
          });
        }
      }
    }

    if (salvageReview && !pass) {
      const approvedDurationMs = cutCoverage.approvedHeroSegments.reduce(
        (total, segment) => total + segment.end_ms - segment.start_ms,
        0,
      );
      const canRepairBoundaryLeak = cutCoverage.referenceLeakDetected
        && approvedDurationMs >= 1_000
        && (clip.salvage?.revision ?? 0) < 1;
      if (canRepairBoundaryLeak) {
        const { salvageFn, probeFn, extractFrameFn } = this.#finalizer;
        let referencePath = null;
        const lockedReferenceFile = clip.motionReferenceBinding?.audioSourceFile;
        if (typeof lockedReferenceFile === 'string') {
          const candidate = path.join(this.#store.clipDir(clipId), lockedReferenceFile);
          try {
            const bytes = await readFile(candidate);
            if (sha256(bytes) === expectedReferenceSha256) referencePath = candidate;
          } catch {
            referencePath = null;
          }
        }
        if (typeof salvageFn === 'function' && typeof probeFn === 'function'
          && typeof extractFrameFn === 'function' && referencePath) {
          try {
            const repairedVideoPath = path.join(this.#store.clipDir(clipId), 'clip-salvaged-v2.mp4');
            const repairResult = await salvageFn({
              sourceVideoPath: clip.videoPath,
              referenceVideoPath: referencePath,
              outputVideoPath: repairedVideoPath,
              segments: cutCoverage.approvedHeroSegments,
            });
            const repairedBytes = await readFile(repairedVideoPath);
            const repairedVideoSha256 = sha256(repairedBytes);
            const repairedProbe = await probeFn(repairedVideoPath);
            const [firstFrameRgb, lastFrameRgb] = await Promise.all([
              extractFrameFn(repairedVideoPath, 'first'),
              extractFrameFn(repairedVideoPath, 'last'),
            ]);
            const repairedTechnicalQa = evaluateClipQa({
              durationMin: repairResult.durationSeconds,
              durationMax: repairResult.durationSeconds,
              aspectRatio: clip.aspectRatio,
              audioPolicy: repairResult.audioPolicy ?? clip.audioBinding?.policy ?? 'REFERENCE_REQUIRED',
            }, { ...repairedProbe, firstFrameRgb, lastFrameRgb });
            const repairedAt = new Date(this.#clock()).toISOString();
            const repairReceipt = {
              schema_version: '1.0.0',
              operation: 'SALVAGE_BOUNDARY_REPAIR',
              clip_id: clipId,
              created_at: repairedAt,
              source_video_sha256: clip.videoSha256,
              motion_reference_sha256: expectedReferenceSha256,
              triggering_reference_qa_sha256: referenceAdherenceQaSha256,
              output_video_sha256: repairedVideoSha256,
              duration_seconds: repairResult.durationSeconds,
              segments: repairResult.segments,
              audio_source: repairResult.audioSource,
              audio_policy: repairResult.audioPolicy ?? clip.audioBinding?.policy ?? 'REFERENCE_REQUIRED',
              technical_qa: repairedTechnicalQa,
            };
            const repairReceiptBytes = Buffer.from(`${JSON.stringify(repairReceipt, null, 2)}\n`);
            const repairReceiptSha256 = sha256(repairReceiptBytes);
            await this.#store.saveQaReceipt(
              clipId,
              'salvage-repair-receipt.json',
              repairReceiptBytes,
              'VIDEO_QA_SALVAGE_REPAIR_RECEIPT_CONFLICT',
            );
            Object.assign(updated, {
              status: repairedTechnicalQa.pass ? 'NEEDS_QA' : 'FAIL',
              failureCode: repairedTechnicalQa.pass
                ? null
                : (repairedTechnicalQa.defects?.[0]?.code ?? 'VIDEO_QA_SALVAGE_TECHNICAL_FAIL'),
              videoPath: repairedVideoPath,
              videoSha256: repairedVideoSha256,
              deliveryDurationSeconds: repairResult.durationSeconds,
              qa: repairedTechnicalQa,
              audioBinding: {
                ...(clip.audioBinding ?? {}),
                policy: repairResult.audioPolicy ?? clip.audioBinding?.policy ?? 'REFERENCE_REQUIRED',
                source: repairResult.audioSource,
              },
              salvageIdentityItemQa: null,
              salvageIdentityItemQaSha256: null,
              salvageIdentityItemQaFile: null,
              salvageReferenceAdherenceQa: null,
              salvageReferenceAdherenceQaSha256: null,
              salvageReferenceAdherenceQaFile: null,
              salvage: {
                ...clip.salvage,
                status: repairedTechnicalQa.pass ? 'NEEDS_QA' : 'FAIL',
                revision: 1,
                parentSegments: clip.salvage.segments,
                segmentCount: repairResult.segmentCount,
                segments: repairResult.segments,
                audioSource: repairResult.audioSource,
                receiptFile: 'salvage-repair-receipt.json',
                receiptSha256: repairReceiptSha256,
                repairedAt,
              },
            });
          } catch (cause) {
            updated.failureCode = cause?.code ?? 'VIDEO_QA_SALVAGE_REPAIR_FAILED';
          }
        }
      }
      if (updated.status !== 'NEEDS_QA') {
        updated.failureCode ??= 'VIDEO_SALVAGE_REFERENCE_QA_FAILED';
      }
    } else if (!updated.salvage && !pass) {
      // The deterministic exact-reference-copy path (video-semantic-qa.js) marks
      // `evaluator` with a fixed string rather than a model identity precisely so this can
      // be told apart from a normal VLM rejection without adding a second field to the
      // receipt schema. Reported as its own code: "the model said no" and "the delivery is
      // byte-identical to the directing reference, so nothing was ever generated" are
      // different failures with different remedies, and the client/QA report should not
      // have to re-derive which one happened from cut_coverage.
      updated.failureCode = receipt.evaluator === 'deterministic/exact-reference-copy-v1'
        ? 'VIDEO_REFERENCE_NOT_REPLACED'
        : 'VIDEO_REFERENCE_QA_FAILED';
    } else if (pass && technicalPass !== false) {
      updated.failureCode = null;
    }
    await this.#store.save(clipId, updated);
    return {
      clipId,
      status: updated.status,
      referenceAdherenceQa: updated[qaField],
      referenceAdherenceQaSha256,
      salvage: updated.salvage ?? null,
    };
  }

  /** Load clip metadata. */
  async getClip(clipId) {
    return this.#store.load(clipId);
  }
}
