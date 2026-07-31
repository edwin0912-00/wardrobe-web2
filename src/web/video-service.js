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
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './scene-contract.js';
import {
  buildFashionVideoReferencePrompt,
  buildMotionPlan,
  surface,
} from './video-motion-plan.js';
import { evaluateClipQa } from './video-clip-qa.js';

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

const SHA256 = /^[a-f0-9]{64}$/;
const CUT_PEOPLE = new Set(['APPROVED_AVATAR_ONLY', 'NO_PERSON', 'REFERENCE_PERFORMER', 'MIXED_OR_UNKNOWN']);
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
    await writeFile(path.join(dir, 'clip.json'), JSON.stringify(metadata, null, 2));
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
  async resumableClipIds() {
    let entries;
    try {
      entries = await readdir(path.join(this.#root, 'clips'), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const clips = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name))
      .map(async (entry) => this.load(entry.name)));
    return clips
      .filter((clip) => clip && ['CREATED', 'GENERATING'].includes(clip.status))
      .map((clip) => clip.clipId);
  }

  async saveVideo(clipId, videoBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'clip.mp4');
    await writeFile(filePath, videoBytes);
    return filePath;
  }

  salvagedVideoPath(clipId) {
    return path.join(this.clipDir(clipId), 'clip-salvaged.mp4');
  }

  async saveQaReceipt(clipId, filename, receiptBytes, conflictCode) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    try {
      await writeFile(filePath, receiptBytes, { flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(filePath);
      if (!existing.equals(receiptBytes)) {
        throw new VideoServiceError('Video QA receipt is immutable', {
          code: conflictCode,
          status: 409,
        });
      }
    }
    return filePath;
  }

  async #saveImmutableMedia(clipId, filename, mediaBytes, conflictCode) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    try {
      await writeFile(filePath, mediaBytes, { flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(filePath);
      if (!existing.equals(mediaBytes)) {
        throw new VideoServiceError('Immutable video media conflicts with its original bytes', {
          code: conflictCode,
          status: 409,
        });
      }
    }
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
    await writeFile(filePath, sourceBytes);
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
    await writeFile(filePath, imageBytes, { flag: 'wx' });
    return filePath;
  }

  async saveCreateReceipt(clipId, receiptBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'create-receipt.json');
    await writeFile(filePath, receiptBytes, { flag: 'wx' });
    return filePath;
  }

  async saveIdentityItemQa(clipId, receiptBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'identity-item-qa.json');
    try {
      await writeFile(filePath, receiptBytes, { flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(filePath);
      if (!existing.equals(receiptBytes)) {
        throw new VideoServiceError('Identity/item QA receipt is immutable', {
          code: 'QA_RECEIPT_CONFLICT',
          status: 409,
        });
      }
    }
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
    try {
      await writeFile(claimPath, `${JSON.stringify(pending, null, 2)}\n`, { flag: 'wx' });
      return { created: true, claim: pending, claimPath };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const raw = await readFile(claimPath, 'utf8');
      return { created: false, claim: JSON.parse(raw), claimPath };
    }
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
    await writeFile(claimPath, `${JSON.stringify(completed, null, 2)}\n`);
    return completed;
  }
}

export class VideoService {
  #provider;
  #store;
  #clock;

  #finalizer;

  #fashionVideoReferenceResolver;

  #automaticQaFn;

  /**
   * @param {object} options
   * @param {object} options.provider — HiggsfieldVideoProvider instance
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
    this.#provider = provider;
    this.#store = clipStore;
    this.#clock = clock;
    this.#finalizer = finalizer;
    this.#fashionVideoReferenceResolver = fashionVideoReferenceResolver;
    this.#automaticQaFn = automaticQaFn;
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
    retryOf = null,
  }) {
    if (!sourceImagePath) {
      throw new VideoServiceError('A locked source image path is required', {
        code: 'MISSING_SOURCE', status: 400,
      });
    }

    const plan = buildMotionPlan({
      modeId,
      surface: surfaceId,
      durationSeconds,
      sourceCapabilities,
      styleNote,
    });

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
        || videoReference.provider_duration_seconds < 3
        || videoReference.provider_duration_seconds > 15
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
    }
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
    if (verifiedVideoReference
      && appearanceReferences.some((reference) => reference.role === 'identity_face')) {
      throw new VideoServiceError(
        'Fashion Video accepts identity only through Image 1, the approved white master',
        { code: 'VIDEO_IDENTITY_PHOTO_FORBIDDEN', status: 409 },
      );
    }
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
      });
    }

    // Resolve aspect from the surface, or fall back to the provider default.
    const resolvedSurface = surfaceId ? surface(surfaceId) : null;
    const aspectRatio = resolvedSurface ? resolvedSurface.aspectRatio : '16:9';

    const referenceBound = verifiedVideoReference !== null;
    const prompt = referenceBound
      ? buildFashionVideoReferencePrompt({
          hasGarmentReference: lockedAppearanceReferences.some(
            (reference) => reference.role === 'garment_detail',
          ),
          cutSheet: verifiedVideoReference.cutSheet,
        })
      : plan.prompt;
    const duration = referenceBound
      ? verifiedVideoReference.providerDurationSeconds
      : plan.durationSeconds;
    const request = {
      prompt,
      mediaPaths: [
        lockedSourcePath,
        ...lockedAppearanceReferences.map((reference) => reference.path),
      ],
      videoPaths: verifiedVideoReference ? [verifiedVideoReference.path] : [],
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
            }
          : {}),
      },
    };

    const submitting = {
      clipId,
      jobId: null,
      providerKey: null,
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
            fps: verifiedVideoReference.fps,
            cutSheetSha256: verifiedVideoReference.cutSheetSha256,
            cutCount: Array.isArray(verifiedVideoReference.cutSheet?.cuts)
              ? verifiedVideoReference.cutSheet.cuts.length
              : 0,
            audioSourceFile: 'style-reference.mp4',
            audioSourceSha256: verifiedVideoReference.audioSourceSha256,
          }
        : null,
      lookBinding,
      createdAt,
      updatedAt: createdAt,
    };
    await this.#store.save(clipId, submitting);

    // Phase 1: create the job. The onJobCreated hook persists the job id
    // before the wait phase starts, so a crash cannot orphan a paid job.
    let created;
    try {
      created = await this.#provider.createJob(request);
    } catch (cause) {
      // A provider can reject locally before it accepts a job (invalid media
      // shape, expired local authentication, etc.). Leaving such a clip in
      // SUBMITTING makes it look paid/active forever and blocks a safe release.
      // The one exception is an acknowledgement we cannot parse: that outcome
      // may already be billed, so it stays recoverable until reconciled.
      if (cause?.code === 'CREATE_OUTCOME_UNKNOWN') throw cause;
      await this.#store.save(clipId, {
        ...submitting,
        status: 'FAILED',
        failureCode: 'VIDEO_CREATE_REJECTED',
        updatedAt: new Date(this.#clock()).toISOString(),
      });
      throw new VideoServiceError('Video provider rejected the create request', {
        code: 'VIDEO_CREATE_REJECTED',
        status: 502,
      });
    }

    const receipt = {
      schema_version: '1.0.0',
      clip_id: clipId,
      created_at: createdAt,
      provider: created.providerKey ?? 'higgsfield',
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
        })),
      },
      response: {
        job_id: created.jobId,
        payload: created.raw ?? null,
      },
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const createReceiptSha256 = sha256(receiptBytes);
    await this.#store.saveCreateReceipt(clipId, receiptBytes);

    const metadata = {
      ...submitting,
      retryOf,
      jobId: created.jobId,
      providerKey: created.providerKey ?? 'higgsfield',
      providerCreateAttempt: created.createAttempt ?? 1,
      fallbackUsed: created.fallbackUsed === true,
      status: 'CREATED',
      createReceiptSha256,
      createReceiptFile: 'create-receipt.json',
      updatedAt: createdAt,
    };

    await this.#store.save(clipId, metadata);

    return {
      clipId,
      jobId: created.jobId,
      status: 'CREATED',
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
  async retryFailedClip(parentClipId, { videoReference } = {}) {
    const parent = await this.#store.load(parentClipId);
    if (!parent) {
      throw new VideoServiceError('Video clip not found', { code: 'CLIP_NOT_FOUND', status: 404 });
    }
    if (!['FAIL', 'FAILED'].includes(parent.status)) {
      throw new VideoServiceError('Only a terminal failed video can be retried', {
        code: 'VIDEO_RETRY_STATUS_INVALID', status: 409,
      });
    }
    if (parent.lookBinding?.whiteBackgroundVerified !== true
      || parent.appearanceReferences?.some((reference) => reference.role === 'identity_face')) {
      throw new VideoServiceError(
        'This failed clip used a legacy appearance input and cannot be retried. Start a new Fashion Video from the approved white master.',
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
      return { role: reference.role, bytes, sha256: reference.sha256 };
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
      retryOf: parentClipId,
    });
  }

  /**
   * Attach a provider job after the provider accepted a request but its create
   * response could not be parsed. Recovery is strict: the provider's persisted
   * request must match the immutable local prompt, aspect and duration.
   */
  async recoverSubmittedClip(clipId, {
    jobId,
    providerKey = 'higgsfield',
    raw,
    createAttempt = 1,
  } = {}) {
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
    const params = raw?.params;
    const exactMatch = typeof jobId === 'string'
      && jobId.length > 0
      && params?.prompt === clip.prompt
      && params?.aspect_ratio === clip.aspectRatio
      && Number(params?.duration) === clip.durationSeconds
      && (raw?.job_set_type ?? params?.model) === 'seedance_2_0';
    if (!exactMatch) {
      throw new VideoServiceError('Provider job does not match the immutable clip request', {
        code: 'RECOVERY_JOB_MISMATCH',
        status: 409,
      });
    }

    const recoveredAt = new Date(this.#clock()).toISOString();
    const receipt = {
      schema_version: '1.0.0',
      clip_id: clipId,
      created_at: clip.createdAt,
      recovered_at: recoveredAt,
      provider: providerKey,
      provider_create_attempt: createAttempt,
      fallback_used: false,
      request: {
        source_sha256: clip.sourceSha256,
        prompt: clip.prompt,
        aspect_ratio: clip.aspectRatio,
        duration_seconds: clip.durationSeconds,
      },
      response: {
        job_id: jobId,
        payload: raw,
      },
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const createReceiptSha256 = sha256(receiptBytes);
    await this.#store.saveCreateReceipt(clipId, receiptBytes);
    const metadata = {
      ...clip,
      jobId,
      providerKey,
      providerCreateAttempt: createAttempt,
      fallbackUsed: false,
      status: 'CREATED',
      createReceiptSha256,
      createReceiptFile: 'create-receipt.json',
      recoveredAt,
      updatedAt: recoveredAt,
    };
    await this.#store.save(clipId, metadata);
    return { clipId, jobId, status: 'CREATED', recovered: true };
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
    if (clip.status !== 'CREATED' && clip.status !== 'GENERATING') {
      throw new VideoServiceError(
        `Clip is in status ${clip.status}, cannot await`,
        { code: 'CLIP_STATUS_INVALID', status: 409 },
      );
    }

    // Update status to GENERATING
    clip.status = 'GENERATING';
    clip.updatedAt = new Date(this.#clock()).toISOString();
    await this.#store.save(clipId, clip);

    // Phase 2: wait for the job to finish
    let finished;
    try {
      finished = await this.#provider.waitForJob({
        jobId: clip.jobId,
        providerKey: clip.providerKey,
      });
    } catch (cause) {
      // A missing remote job is terminal: there is nothing left to resume.
      // Other transport failures retain GENERATING for a later exact-job poll.
      if (cause?.code === 'PROVIDER_JOB_NOT_FOUND') {
        clip.status = 'FAILED';
        clip.failureCode = 'VIDEO_PROVIDER_JOB_NOT_FOUND';
        clip.updatedAt = new Date(this.#clock()).toISOString();
        await this.#store.save(clipId, clip);
        throw new VideoServiceError('The video provider no longer has this job; it was not generated.', {
          code: 'VIDEO_PROVIDER_JOB_NOT_FOUND',
          status: 502,
        });
      }
      throw cause;
    }

    if (!finished.url) {
      clip.status = 'FAILED';
      clip.failureCode = 'NO_VIDEO_URL';
      clip.updatedAt = new Date(this.#clock()).toISOString();
      await this.#store.save(clipId, clip);
      throw new VideoServiceError('Provider finished without a video URL', {
        code: 'MISSING_VIDEO_OUTPUT', status: 502,
      });
    }

    // Download
    if (typeof downloadFn !== 'function') {
      throw new VideoServiceError('A downloadFn is required', {
        code: 'SERVICE_MISCONFIGURED',
      });
    }
    const providerVideoBytes = await downloadFn(finished.url);
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
    }

    clip.status = qa
      ? (qa.pass
          ? (clip.motionReferenceBinding ? 'NEEDS_QA' : 'PASS')
          : 'FAIL')
      : 'NEEDS_QA';
    clip.videoUrl = finished.url;
    clip.providerVideoSha256 = sha256(providerVideoBytes);
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
    if (['CREATED', 'GENERATING'].includes(clip.status)) {
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
    for (let pass = 0; pass < 2; pass += 1) {
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
          failureCode: cause?.code ?? 'VIDEO_AUTOMATIC_QA_FAILED',
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
    const salvageReview = clip.salvage?.status === 'NEEDS_QA';
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
    if (salvageReview) {
      await this.#store.saveQaReceipt(
        clipId,
        'salvage-identity-item-qa.json',
        receiptBytes,
        'SALVAGE_IDENTITY_QA_RECEIPT_CONFLICT',
      );
    } else {
      await this.#store.saveIdentityItemQa(clipId, receiptBytes);
    }
    const pass = firstDecision === 'PASS' && lastDecision === 'PASS';
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
        firstDecision,
        lastDecision,
        evaluator: receipt.evaluator ?? null,
      },
      [identityShaField]: identityItemQaSha256,
      [identityFileField]: salvageReview
        ? 'salvage-identity-item-qa.json'
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
    const salvageReview = clip.salvage?.status === 'NEEDS_QA';
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
    const pass = cutCoverage.pass && requiredChecks.every((name) => decisions.get(name) === 'PASS');
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const referenceAdherenceQaSha256 = sha256(receiptBytes);
    const receiptFilename = salvageReview
      ? 'salvage-reference-adherence-qa.json'
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
        decisions: Object.fromEntries(requiredChecks.map((name) => [name, decisions.get(name)])),
        cutCoverage,
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

    if (!updated.salvage && !pass) {
      updated.failureCode = 'VIDEO_REFERENCE_QA_FAILED';
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
