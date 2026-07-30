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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './scene-contract.js';
import { buildMotionPlan, surface } from './video-motion-plan.js';
import { evaluateClipQa } from './video-clip-qa.js';

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
 *   clip.mp4   — the downloaded video (when available)
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

  async saveVideo(clipId, videoBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'clip.mp4');
    await writeFile(filePath, videoBytes);
    return filePath;
  }

  async saveSource(clipId, sourceBytes) {
    const dir = this.clipDir(clipId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'source.png');
    await writeFile(filePath, sourceBytes);
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
}

export class VideoService {
  #provider;
  #store;
  #clock;

  #finalizer;

  #fashionVideoReferenceResolver;

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
    if (videoReference !== null) {
      if (videoReference?.state !== 'READY'
        || typeof videoReference.reference_path !== 'string'
        || !/^[a-f0-9]{64}$/.test(videoReference.reference_sha256 ?? '')
        || !/^[a-f0-9]{64}$/.test(videoReference.reference_pack_sha256 ?? '')) {
        throw new VideoServiceError('Fashion Video reference binding is incomplete', {
          code: 'VIDEO_REFERENCE_INVALID',
          status: 409,
        });
      }
      let referenceBytes;
      try {
        referenceBytes = await readFile(videoReference.reference_path);
      } catch (cause) {
        throw new VideoServiceError('Fashion Video reference cannot be read', {
          code: 'VIDEO_REFERENCE_UNREADABLE',
          status: 409,
          cause,
        });
      }
      if (sha256(referenceBytes) !== videoReference.reference_sha256) {
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
      };
    }
    const lockedSourcePath = await this.#store.saveSource(clipId, sourceBytes);

    // Resolve aspect from the surface, or fall back to the provider default.
    const resolvedSurface = surfaceId ? surface(surfaceId) : null;
    const aspectRatio = resolvedSurface ? resolvedSurface.aspectRatio : '16:9';

    const request = {
      prompt: plan.prompt,
      mediaPaths: [lockedSourcePath],
      videoPaths: verifiedVideoReference ? [verifiedVideoReference.path] : [],
      aspectRatio,
      durationSeconds: plan.durationSeconds,
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
      durationSeconds: plan.durationSeconds,
      prompt: plan.prompt,
      sourceSha256,
      sourceFile: 'source.png',
      lookBinding,
      createdAt,
      updatedAt: createdAt,
    };
    await this.#store.save(clipId, submitting);

    // Phase 1: create the job. The onJobCreated hook persists the job id
    // before the wait phase starts, so a crash cannot orphan a paid job.
    const created = await this.#provider.createJob(request);

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
        prompt: plan.prompt,
        aspect_ratio: aspectRatio,
        duration_seconds: plan.durationSeconds,
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

    return { clipId, jobId: created.jobId, status: 'CREATED', plan };
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
  async awaitAndFinalize(clipId, { downloadFn, probeFn, extractFrameFn }) {
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
    const finished = await this.#provider.waitForJob({
      jobId: clip.jobId,
      providerKey: clip.providerKey,
    });

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
    const videoBytes = await downloadFn(finished.url);
    const videoPath = await this.#store.saveVideo(clipId, videoBytes);
    const videoSha256 = sha256(videoBytes);

    // QA
    const mode = clip;
    const expected = {
      durationMin: clip.durationSeconds,
      durationMax: clip.durationSeconds,
      aspectRatio: clip.aspectRatio,
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

    clip.status = qa ? (qa.pass ? 'PASS' : 'FAIL') : 'NEEDS_QA';
    clip.videoUrl = finished.url;
    clip.videoSha256 = videoSha256;
    clip.videoPath = videoPath;
    clip.qa = qa;
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
  async generateClip(request, { downloadFn, probeFn, extractFrameFn } = {}) {
    const created = await this.createClip(request);
    const result = await this.awaitAndFinalize(created.clipId, {
      downloadFn,
      probeFn,
      extractFrameFn,
    });
    return { ...created, ...result };
  }

  /**
   * Resume/finalize using the runtime-owned dependencies. This is the method
   * exposed to HTTP so a restart polls the persisted provider job instead of
   * issuing another paid create.
   */
  async finalizeClip(clipId) {
    const { downloadFn, probeFn, extractFrameFn } = this.#finalizer;
    if (typeof downloadFn !== 'function'
      || typeof probeFn !== 'function'
      || typeof extractFrameFn !== 'function') {
      throw new VideoServiceError('Video finalization runtime is not configured', {
        code: 'FINALIZER_MISCONFIGURED',
        status: 503,
      });
    }
    return this.awaitAndFinalize(clipId, {
      downloadFn,
      probeFn,
      extractFrameFn,
    });
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
    const exactBinding = receipt?.clip_id === clip.clipId
      && receipt?.job_id === clip.jobId
      && receipt?.source_sha256 === clip.sourceSha256;
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
    await this.#store.saveIdentityItemQa(clipId, receiptBytes);
    const pass = firstDecision === 'PASS' && lastDecision === 'PASS';
    const updated = {
      ...clip,
      status: pass ? clip.status : 'FAIL',
      identityItemQa: {
        pass,
        firstDecision,
        lastDecision,
        evaluator: receipt.evaluator ?? null,
      },
      identityItemQaSha256,
      identityItemQaFile: 'identity-item-qa.json',
      updatedAt: new Date(this.#clock()).toISOString(),
    };
    await this.#store.save(clipId, updated);
    return {
      clipId,
      status: updated.status,
      identityItemQa: updated.identityItemQa,
      identityItemQaSha256,
    };
  }

  /** Load clip metadata. */
  async getClip(clipId) {
    return this.#store.load(clipId);
  }
}
