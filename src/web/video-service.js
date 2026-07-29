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
    await writeFile(path.join(dir, 'source.png'), sourceBytes);
  }

  videoPath(clipId) {
    return path.join(this.clipDir(clipId), 'clip.mp4');
  }
}

export class VideoService {
  #provider;
  #store;
  #clock;

  /**
   * @param {object} options
   * @param {object} options.provider — HiggsfieldVideoProvider instance
   * @param {ClipStore} options.clipStore
   * @param {function} [options.clock] — () => Date.now(), for testing
   */
  constructor({ provider, clipStore, clock = () => Date.now() } = {}) {
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

    // Resolve aspect from the surface, or fall back to the provider default.
    const resolvedSurface = surfaceId ? surface(surfaceId) : null;
    const aspectRatio = resolvedSurface ? resolvedSurface.aspectRatio : '16:9';

    const request = {
      prompt: plan.prompt,
      mediaPaths: [sourceImagePath],
      aspectRatio,
      durationSeconds: plan.durationSeconds,
    };

    // Phase 1: create the job. The onJobCreated hook persists the job id
    // before the wait phase starts, so a crash cannot orphan a paid job.
    const created = await this.#provider.createJob(request);

    const metadata = {
      clipId,
      jobId: created.jobId,
      status: 'CREATED',
      mode: plan.mode,
      title: plan.title,
      surface: plan.surface ?? null,
      aspectRatio,
      durationSeconds: plan.durationSeconds,
      prompt: plan.prompt,
      lookBinding,
      createdAt,
      updatedAt: createdAt,
    };

    await this.#store.save(clipId, metadata);

    return { clipId, jobId: created.jobId, status: 'CREATED', plan };
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
    const finished = await this.#provider.waitForJob({ jobId: clip.jobId });

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

  /** Load clip metadata. */
  async getClip(clipId) {
    return this.#store.load(clipId);
  }
}
