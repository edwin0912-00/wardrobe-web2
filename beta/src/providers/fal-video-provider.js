import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { File } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createFalClient } from '@fal-ai/client';
import { probeVideo } from '../web/ffprobe-video-probe.js';
import { assertExternalPromptPrivacy } from './provider-prompt-privacy.js';

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 30_000_000;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MODEL_LIMITS = Object.freeze({
  'seedance-2.0': Object.freeze({
    label: 'Seedance 2.0',
    endpoint: 'bytedance/seedance-2.0/reference-to-video',
    maxImages: 9,
    maxVideos: 3,
    maxFiles: 12,
    minVideoDuration: 2,
    maxVideoDuration: 15,
    maxVideoBytes: 50_000_000 - 1,
    minVideoEdge: 480,
    maxVideoEdge: 1112,
    maxOutputDuration: 15,
  }),
  'seedance-2.5': Object.freeze({
    label: 'Seedance 2.5',
    endpoint: 'bytedance/seedance-2.5/reference-to-video',
    maxImages: 30,
    maxVideos: 10,
    maxFiles: 50,
    minVideoDuration: 1.8,
    maxVideoDuration: 30.2,
    maxVideoBytes: 200_000_000,
    minVideoEdge: 300,
    maxVideoEdge: 6000,
    minFps: 24,
    maxFps: 60,
    maxOutputDuration: 30,
  }),
});

export const FAL_VIDEO_PROVIDER = 'fal';
export const DEFAULT_FAL_VIDEO_MODEL = 'seedance-2.0';
export const FAL_VIDEO_POLICY_REJECTION_CODE = 'FAL_VIDEO_POLICY_REJECTED';
export const FAL_VIDEO_POLICY_REJECTION_MESSAGE = 'Провайдер відхилив цей запуск за правилами контенту. Повтор для нього недоступний.';
export const FAL_VIDEO_RESULT_REJECTION_CODE = 'FAL_VIDEO_RESULT_REJECTED';
export const FAL_VIDEO_RESULT_REJECTION_MESSAGE = 'Провайдер відхилив обробку результату. Повтор цього запуску недоступний.';
export const FAL_VIDEO_MODELS = Object.freeze(Object.fromEntries(
  Object.entries(MODEL_LIMITS).map(([id, limits]) => [id, Object.freeze({
    id,
    label: limits.label,
    endpoint: limits.endpoint,
    default: id === DEFAULT_FAL_VIDEO_MODEL,
  })]),
));

export class FalVideoProviderError extends Error {
  constructor(message, { code = 'FAL_VIDEO_ERROR', retryable = false, cause, providerInputMedia } = {}) {
    super(message, { cause });
    this.name = 'FalVideoProviderError';
    this.code = code;
    this.retryable = retryable;
    if (providerInputMedia) this.providerInputMedia = providerInputMedia;
  }
}

export function resolveFalVideoModel(model = DEFAULT_FAL_VIDEO_MODEL) {
  if (typeof model !== 'string' || !Object.hasOwn(MODEL_LIMITS, model)) {
    throw new FalVideoProviderError(`Unsupported Fashion Video model: ${String(model)}`, {
      code: 'VIDEO_MODEL_UNSUPPORTED',
    });
  }
  return { id: model, ...MODEL_LIMITS[model] };
}

export function falVideoModelCompatibility({
  durationSeconds,
  width,
  height,
  fps,
  bytes,
} = {}) {
  const ratio = width / height;
  const valuesValid = Number.isFinite(durationSeconds) && Number.isInteger(width)
    && Number.isInteger(height) && Number.isFinite(fps) && Number.isInteger(bytes) && bytes > 0;
  return Object.entries(MODEL_LIMITS).map(([id, limits]) => {
    let reasonCode = null;
    let reason = null;
    if (!valuesValid) {
      reasonCode = 'VIDEO_MODEL_REFERENCE_METADATA_INVALID';
      reason = 'Не вдалося перевірити параметри цього відеореференсу.';
    } else if (durationSeconds < limits.minVideoDuration || durationSeconds > limits.maxVideoDuration) {
      reasonCode = 'VIDEO_MODEL_REFERENCE_DURATION_UNSUPPORTED';
      reason = id === 'seedance-2.0' && durationSeconds > 15
        ? `Референс ${durationSeconds}s довший за ліміт 15s у Seedance 2.0; обери Seedance 2.5.`
        : `Seedance ${id.endsWith('2.0') ? '2.0' : '2.5'} не підтримує референс тривалістю ${durationSeconds}s.`;
    } else if (Math.ceil(durationSeconds) > limits.maxOutputDuration) {
      reasonCode = 'VIDEO_MODEL_OUTPUT_DURATION_UNSUPPORTED';
      reason = `${limits.label} не вмістить усі cut у максимальні ${limits.maxOutputDuration}s; референс не буде скорочено.`;
    } else if (width < limits.minVideoEdge || height < limits.minVideoEdge
      || ratio < 0.4 || ratio > 2.5) {
      reasonCode = 'VIDEO_MODEL_REFERENCE_GEOMETRY_UNSUPPORTED';
      reason = 'Геометрію неможливо безпечно підготувати без апскейлу або зміни пропорцій.';
    } else if (id === 'seedance-2.5' && (fps < limits.minFps || fps > limits.maxFps)) {
      reasonCode = 'VIDEO_MODEL_REFERENCE_FPS_UNSUPPORTED';
      reason = 'Seedance 2.5 потребує 24–60 кадрів/с; зміна таймінгу заборонена.';
    } else {
      const normalizationRequired = bytes > limits.maxVideoBytes
        || Math.max(width, height) > limits.maxVideoEdge;
      return {
        id,
        available: true,
        reason_code: null,
        reason_uk: normalizationRequired
          ? 'Сервер підготує окрему сумісну копію без зміни тривалості та cut sheet.'
          : null,
        normalization_required: normalizationRequired,
      };
    }
    return {
      id,
      available: false,
      reason_code: reasonCode,
      reason_uk: reason,
      normalization_required: false,
    };
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function imageMimeType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new FalVideoProviderError('Fashion Video accepts only verified PNG, JPEG or WebP image inputs', {
    code: 'VIDEO_IMAGE_FORMAT_UNSUPPORTED',
  });
}

export function falVideoPrompt(prompt) {
  const direction = '@Video 1 is private reference-only directing material, never delivery media. '
    + 'Use it only to reconstruct its complete shot sequence, cut timing, transitions, action timing, '
    + 'pose choreography, camera movement, framing, environment, lighting, colour grade, optical effects, '
    + 'props and environmental text.';
  return prompt
    .replace(direction, '@Video 1 is private motion-only reference material, never delivery media. '
      + 'Use it only for camera movement, framing, and shot/cut timing; follow the cut-sheet scene directions '
      + 'and the approved image bindings for every other visual detail.')
    .replace(/@Image\s+(\d+)/g, '@Image$1')
    .replace(/@Video\s+(\d+)/g, '@Video$1');
}

function validateBindings(request) {
  const imageBindings = request.referenceBindings?.images;
  const videoBinding = request.referenceBindings?.motion_reference;
  const appearanceReferences = request.appearanceReferences;
  const appearanceRoles = Array.isArray(appearanceReferences)
    ? appearanceReferences.map((reference) => reference?.role)
    : [];
  const orderedAppearanceRoles = ['identity_face', 'garment_detail']
    .filter((role) => appearanceRoles.includes(role));
  if (!Array.isArray(imageBindings) || imageBindings.length !== request.mediaPaths.length
    || !Array.isArray(appearanceReferences) || appearanceReferences.length > 2
    || appearanceRoles.join(',') !== orderedAppearanceRoles.join(',')
    || imageBindings[0]?.role !== 'approved_white_master'
    || imageBindings[0]?.provider_label !== '@Image 1'
    || imageBindings.some((binding, index) => (
      !SHA256.test(binding?.sha256 ?? '')
      || binding.sha256 !== (index === 0
        ? request.sourceBinding?.sourceSha256
        : appearanceReferences[index - 1]?.sha256)
      || (index > 0 && binding.role !== appearanceReferences[index - 1]?.role)
      || binding.provider_label !== `@Image ${index + 1}`
      || (index > 0 && !['identity_face', 'garment_detail'].includes(binding.role))
    ))) {
    throw new FalVideoProviderError('Fashion Video image roles or source hashes do not match the approved request', {
      code: 'VIDEO_REFERENCE_BINDING_INVALID',
    });
  }
  if (request.videoPaths?.length !== 1
    || videoBinding?.role !== 'motion_reference'
    || videoBinding?.provider_label !== '@Video 1'
    || !SHA256.test(videoBinding?.sha256 ?? '')
    || videoBinding.sha256 !== request.sourceBinding?.motionReferenceSha256
    || !SHA256.test(videoBinding?.cut_sheet_sha256 ?? '')
    || !Number.isFinite(videoBinding.duration_seconds)
    || !Number.isInteger(videoBinding.width)
    || !Number.isInteger(videoBinding.height)
    || !Number.isFinite(videoBinding.fps)) {
    throw new FalVideoProviderError('Fashion Video motion reference binding is invalid', {
      code: 'VIDEO_REFERENCE_BINDING_INVALID',
    });
  }
  return { imageBindings, videoBinding };
}

function assertGeometry(probe, limits, modelId) {
  const { width, height, durationSeconds, fps } = probe;
  const aspectRatio = width / height;
  if (!Number.isFinite(durationSeconds)
    || durationSeconds < limits.minVideoDuration
    || durationSeconds > limits.maxVideoDuration) {
    throw new FalVideoProviderError(
      `${limits.label} accepts motion references from ${limits.minVideoDuration} to ${limits.maxVideoDuration} seconds; this source is ${durationSeconds}s.`,
      { code: 'VIDEO_MODEL_REFERENCE_DURATION_UNSUPPORTED' },
    );
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < limits.minVideoEdge || height < limits.minVideoEdge
    || !Number.isFinite(aspectRatio) || aspectRatio < 0.4 || aspectRatio > 2.5) {
    throw new FalVideoProviderError('Motion reference geometry cannot be normalized without upscaling or changing its aspect ratio', {
      code: 'VIDEO_MODEL_REFERENCE_GEOMETRY_UNSUPPORTED',
    });
  }
  if (modelId === 'seedance-2.5'
    && (!Number.isFinite(fps) || fps < limits.minFps || fps > limits.maxFps)) {
    throw new FalVideoProviderError('Seedance 2.5 requires a 24–60 FPS motion reference; frame timing was not changed.', {
      code: 'VIDEO_MODEL_REFERENCE_FPS_UNSUPPORTED',
    });
  }
}

function falQueueSubmissionFetch(fetchFn) {
  let submitted = false;
  return (input, init = {}) => {
    let url;
    try {
      url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    } catch {
      return fetchFn(input, init);
    }
    if (url.hostname === 'queue.fal.run' && String(init.method ?? 'GET').toUpperCase() === 'POST') {
      if (submitted) {
        throw new FalVideoProviderError('FAL create acknowledgement was not received; another paid submit is blocked.', {
          code: 'CREATE_OUTCOME_UNKNOWN',
        });
      }
      submitted = true;
    }
    return fetchFn(input, init);
  };
}

function responseDetail(error) {
  const body = error?.body ?? error?.response?.body ?? error?.data?.body;
  return Array.isArray(body?.detail) ? body.detail : [];
}

function isContentPolicyRejection(error) {
  return responseDetail(error).some((detail) => (
    detail?.type === 'content_policy_violation'
    || detail?.ctx?.extra_info?.reason === 'partner_validation_failed'
  ));
}

function providerFailure(cause, phase) {
  if (cause instanceof FalVideoProviderError) return cause;
  if (isContentPolicyRejection(cause)) {
    return new FalVideoProviderError(FAL_VIDEO_POLICY_REJECTION_MESSAGE, {
      code: FAL_VIDEO_POLICY_REJECTION_CODE,
      cause,
    });
  }
  if (phase === 'wait' && [400, 422].includes(Number(cause?.status))) {
    return new FalVideoProviderError(FAL_VIDEO_RESULT_REJECTION_MESSAGE, {
      code: FAL_VIDEO_RESULT_REJECTION_CODE,
      cause,
    });
  }
  if (phase === 'wait' && cause?.status === 404) {
    return new FalVideoProviderError('The persisted FAL video job no longer exists.', {
      code: 'PROVIDER_JOB_NOT_FOUND', cause,
    });
  }
  if (phase === 'wait' && ['FAILED', 'ERROR'].includes(String(cause?.status ?? '').toUpperCase())) {
    return new FalVideoProviderError('FAL marked the persisted video job as failed.', {
      code: 'PROVIDER_JOB_FAILED', cause,
    });
  }
  if (phase === 'create') {
    const status = Number(cause?.status);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return new FalVideoProviderError('FAL rejected the video create request.', {
        code: 'FAL_VIDEO_CREATE_REJECTED', cause,
      });
    }
    return new FalVideoProviderError(
      'FAL create acknowledgement was not received; the provider may have accepted the job.',
      { code: 'CREATE_OUTCOME_UNKNOWN', cause },
    );
  }
  return new FalVideoProviderError(`FAL video ${phase} failed.`, {
    code: 'FAL_VIDEO_WAIT_FAILED',
    retryable: true,
    cause,
  });
}

/** FAL queue transport. Every source file is hashed and every limit is checked before upload. */
export class FalVideoProvider {
  #apiKey;

  #client;

  #clientFactory;

  #fetchFn;

  #probeVideoFn;

  #commandRunner;

  #sleep;

  #pollIntervalMs;

  #maxPolls;

  constructor({
    apiKey,
    client = null,
    clientFactory = createFalClient,
    fetchFn = globalThis.fetch,
    probeVideoFn = probeVideo,
    commandRunner = execFileAsync,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollIntervalMs = 5_000,
    maxPolls = 360,
  } = {}) {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0
      || typeof fetchFn !== 'function' || typeof clientFactory !== 'function'
      || typeof probeVideoFn !== 'function' || typeof commandRunner !== 'function'
      || typeof sleep !== 'function' || !Number.isInteger(maxPolls) || maxPolls < 1
      || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw new FalVideoProviderError('FAL video provider dependencies are incomplete', {
        code: 'FAL_VIDEO_PROVIDER_MISCONFIGURED',
      });
    }
    this.#apiKey = apiKey;
    this.#fetchFn = fetchFn;
    this.#clientFactory = clientFactory;
    this.#client = client ?? clientFactory({ credentials: apiKey, fetch: fetchFn });
    this.#probeVideoFn = probeVideoFn;
    this.#commandRunner = commandRunner;
    this.#sleep = sleep;
    this.#pollIntervalMs = pollIntervalMs;
    this.#maxPolls = maxPolls;
  }

  async #normalizeVideo(sourcePath, sourceBytes, sourceProbe, limits, modelId) {
    const maxEdge = Math.max(sourceProbe.width, sourceProbe.height);
    const minEdge = Math.min(sourceProbe.width, sourceProbe.height);
    const needsGeometry = maxEdge > limits.maxVideoEdge;
    const needsSize = sourceBytes.length > limits.maxVideoBytes;
    const needsAudioRemoval = sourceProbe.hasAudio === true;
    const needsFormatConversion = !/\.(?:mp4|mov)$/i.test(path.extname(sourcePath));
    const needsEncode = needsGeometry || needsSize || needsFormatConversion;
    if (!needsEncode && !needsAudioRemoval) {
      const isQuickTime = path.extname(sourcePath).toLowerCase() === '.mov';
      return {
        path: sourcePath,
        bytes: sourceBytes,
        sha256: sha256(sourceBytes),
        filename: isQuickTime ? 'motion-reference.mov' : 'motion-reference.mp4',
        mimeType: isQuickTime ? 'video/quicktime' : 'video/mp4',
        normalization: null,
      };
    }

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-fal-video-'));
    const outputPath = path.join(tempRoot, 'motion-reference.mp4');
    const scaleEdge = limits.maxVideoEdge;
    const args = ['-y', '-i', sourcePath, '-map', '0:v:0'];
    if (needsGeometry) {
      args.push(
        '-vf', `scale=w='min(${scaleEdge},iw)':h='min(${scaleEdge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
      );
    }
    args.push(
      '-an',
      '-fps_mode', 'passthrough',
      '-c:v', needsEncode ? 'libx264' : 'copy',
      ...(needsEncode ? ['-preset', 'veryfast', '-crf', modelId === 'seedance-2.0' ? '25' : '23'] : []),
      ...(needsEncode ? ['-pix_fmt', 'yuv420p'] : []),
      '-movflags', '+faststart',
      outputPath,
    );
    try {
      await this.#commandRunner('ffmpeg', args, { maxBuffer: 4 * 1024 * 1024 });
      const bytes = await readFile(outputPath);
      const probe = await this.#probeVideoFn(outputPath);
      if (bytes.length === 0 || bytes.length > limits.maxVideoBytes
        || probe.hasAudio === true
        || Math.abs(probe.durationSeconds - sourceProbe.durationSeconds) > 0.04
        || Math.abs((probe.width / probe.height) / (sourceProbe.width / sourceProbe.height) - 1) > 0.002
        || Math.min(probe.width, probe.height) < limits.minVideoEdge
        || probe.width > scaleEdge || probe.height > scaleEdge
        || Math.abs(probe.fps - sourceProbe.fps) > 0.5) {
        throw new Error('Normalized motion reference failed duration, frame-rate, geometry or size checks');
      }
      return {
        path: outputPath,
        bytes,
        sha256: sha256(bytes),
        filename: 'motion-reference.mp4',
        mimeType: 'video/mp4',
        normalization: {
          method: needsEncode ? 'h264_provider_compatible_encode' : 'remux_audio_removed',
          source_sha256: sha256(sourceBytes),
          uploaded_sha256: sha256(bytes),
          source_bytes: sourceBytes.length,
          uploaded_bytes: bytes.length,
          source_duration_seconds: sourceProbe.durationSeconds,
          uploaded_duration_seconds: probe.durationSeconds,
          source_width: sourceProbe.width,
          source_height: sourceProbe.height,
          uploaded_width: probe.width,
          uploaded_height: probe.height,
          fps: probe.fps,
          audio_removed: needsAudioRemoval,
          duration_preserved: true,
          cut_sheet_sha256: null,
        },
        tempRoot,
      };
    } catch (cause) {
      await rm(tempRoot, { recursive: true, force: true });
      throw new FalVideoProviderError('The motion reference could not be normalized safely; the approved source was preserved and nothing was uploaded.', {
        code: 'VIDEO_REFERENCE_NORMALIZATION_FAILED',
        cause,
      });
    }
  }

  async createJob(request = {}) {
    const model = resolveFalVideoModel(request.videoModel);
    const limits = MODEL_LIMITS[model.id];
    if (typeof request.prompt !== 'string' || request.prompt.trim().length === 0) {
      throw new FalVideoProviderError('Fashion Video prompt is missing', { code: 'MISSING_VIDEO_PROMPT' });
    }
    assertExternalPromptPrivacy(request.prompt);
    if (!['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(request.aspectRatio)) {
      throw new FalVideoProviderError('Fashion Video aspect ratio is not supported by the selected model', {
        code: 'VIDEO_MODEL_ASPECT_RATIO_UNSUPPORTED',
      });
    }
    if (!Array.isArray(request.mediaPaths) || request.mediaPaths.length < 1
      || request.mediaPaths.length > limits.maxImages
      || !Array.isArray(request.videoPaths) || request.videoPaths.length > limits.maxVideos
      || request.mediaPaths.length + request.videoPaths.length > limits.maxFiles
      || request.videoPaths.length !== 1
      || !Number.isInteger(request.durationSeconds) || request.durationSeconds < 4
      || request.durationSeconds > limits.maxOutputDuration) {
      throw new FalVideoProviderError('Fashion Video inputs exceed the selected model limits', {
        code: 'VIDEO_MODEL_MEDIA_LIMITS_INVALID',
      });
    }
    const { imageBindings, videoBinding } = validateBindings(request);

    const images = [];
    for (const [index, mediaPath] of request.mediaPaths.entries()) {
      let bytes;
      try {
        bytes = await readFile(mediaPath);
      } catch (cause) {
        throw new FalVideoProviderError('An approved Fashion Video image cannot be read', {
          code: 'VIDEO_IMAGE_UNREADABLE', cause,
        });
      }
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
        throw new FalVideoProviderError('Each Fashion Video image must be at most 30 MB', {
          code: 'VIDEO_IMAGE_SIZE_UNSUPPORTED',
        });
      }
      const actualSha256 = sha256(bytes);
      if (actualSha256 !== imageBindings[index].sha256) {
        throw new FalVideoProviderError('An approved Fashion Video image changed before upload', {
          code: 'VIDEO_IMAGE_HASH_MISMATCH',
        });
      }
      images.push({
        bytes,
        sha256: actualSha256,
        mimeType: imageMimeType(bytes),
        filename: `image-${index + 1}.${imageMimeType(bytes).slice('image/'.length).replace('jpeg', 'jpg')}`,
        role: imageBindings[index].role,
        providerLabel: `@Image${index + 1}`,
      });
    }

    let sourceVideoBytes;
    let sourceProbe;
    try {
      sourceVideoBytes = await readFile(request.videoPaths[0]);
      sourceProbe = await this.#probeVideoFn(request.videoPaths[0]);
    } catch (cause) {
      throw new FalVideoProviderError('The approved Fashion Video motion reference could not be probed', {
        code: 'VIDEO_REFERENCE_PROBE_FAILED', cause,
      });
    }
    if (typeof sourceProbe?.hasAudio !== 'boolean') {
      throw new FalVideoProviderError('ffprobe did not verify whether the motion reference contains audio', {
        code: 'VIDEO_REFERENCE_PROBE_FAILED',
      });
    }
    if (sha256(sourceVideoBytes) !== videoBinding.sha256) {
      throw new FalVideoProviderError('The approved Fashion Video motion reference changed before upload', {
        code: 'VIDEO_REFERENCE_HASH_MISMATCH',
      });
    }
    if (Math.abs(sourceProbe.durationSeconds - videoBinding.duration_seconds) > 0.04
      || sourceProbe.width !== videoBinding.width || sourceProbe.height !== videoBinding.height
      || !Number.isFinite(sourceProbe.fps) || sourceProbe.fps <= 0
      || Math.abs(sourceProbe.fps - videoBinding.fps) > 0.5) {
      throw new FalVideoProviderError('The actual motion reference does not match its approved probe metadata', {
        code: 'VIDEO_REFERENCE_PROBE_MISMATCH',
      });
    }
    assertGeometry(sourceProbe, limits, model.id);
    const prepared = await this.#normalizeVideo(
      request.videoPaths[0], sourceVideoBytes, sourceProbe, limits, model.id,
    );
    if (prepared.normalization) {
      prepared.normalization.cut_sheet_sha256 = videoBinding.cut_sheet_sha256 ?? null;
    }

    const inputMedia = {
      schema_version: 'fal-video-input-media-v1',
      provider: FAL_VIDEO_PROVIDER,
      video_model: model.id,
      endpoint: model.endpoint,
      files: [],
    };
    try {
      const imageUrls = [];
      for (const image of images) {
        const url = await this.#client.storage.upload(
          new File([image.bytes], image.filename, { type: image.mimeType }),
          { lifecycle: { expiresIn: '1d' } },
        );
        if (typeof url !== 'string' || !url.startsWith('https://')) {
          throw new Error('FAL storage did not return a public HTTPS URL');
        }
        imageUrls.push(url);
        inputMedia.files.push({
          role: image.role,
          source_sha256: image.sha256,
          uploaded_sha256: image.sha256,
          url,
          provider_label: image.providerLabel,
          normalized: false,
        });
      }
      const motionUrl = await this.#client.storage.upload(
        new File([prepared.bytes], prepared.filename, { type: prepared.mimeType }),
        { lifecycle: { expiresIn: '1d' } },
      );
      if (typeof motionUrl !== 'string' || !motionUrl.startsWith('https://')) {
        throw new Error('FAL storage did not return a public HTTPS URL');
      }
      inputMedia.files.push({
        role: 'motion_reference',
        source_sha256: videoBinding.sha256,
        uploaded_sha256: prepared.sha256,
        url: motionUrl,
        provider_label: '@Video1',
        normalized: prepared.normalization !== null,
        normalization: prepared.normalization,
      });
      const input = {
        prompt: falVideoPrompt(request.prompt),
        image_urls: imageUrls,
        video_urls: [motionUrl],
        resolution: '720p',
        duration: String(request.durationSeconds),
        aspect_ratio: request.aspectRatio,
        codec: 'H264',
        generate_audio: false,
        ...(model.id === 'seedance-2.5' ? { task: 'reference' } : {}),
      };
      inputMedia.prompt_sha256 = sha256(Buffer.from(input.prompt));
      const submitClient = this.#clientFactory({
        credentials: this.#apiKey,
        fetch: falQueueSubmissionFetch(this.#fetchFn),
      });
      let queued;
      try {
        queued = await submitClient.queue.submit(model.endpoint, { input });
      } catch (cause) {
        const error = providerFailure(cause, 'create');
        if (error.code === 'CREATE_OUTCOME_UNKNOWN') error.providerInputMedia = inputMedia;
        throw error;
      }
      const requestId = queued?.request_id;
      if (typeof requestId !== 'string' || !SAFE_REQUEST_ID.test(requestId)) {
        throw new FalVideoProviderError('FAL accepted a request without a verifiable request id; another submit is blocked.', {
          code: 'CREATE_OUTCOME_UNKNOWN',
          providerInputMedia: inputMedia,
        });
      }
      return {
        jobId: requestId,
        requestId,
        providerKey: FAL_VIDEO_PROVIDER,
        videoModel: model.id,
        providerEndpoint: model.endpoint,
        inputMedia,
        request: input,
        raw: queued,
      };
    } catch (cause) {
      if (cause instanceof FalVideoProviderError) {
        if (cause.code !== 'CREATE_OUTCOME_UNKNOWN' && !cause.providerInputMedia) {
          cause.providerInputMedia = inputMedia;
        }
        throw cause;
      }
      throw new FalVideoProviderError('FAL could not upload all Fashion Video references; no job was submitted.', {
        code: 'VIDEO_INPUT_UPLOAD_FAILED',
        cause,
        providerInputMedia: inputMedia,
      });
    } finally {
      if (prepared.tempRoot) await rm(prepared.tempRoot, { recursive: true, force: true });
    }
  }

  async waitForJob({
    jobId,
    requestId = jobId,
    providerRequestId = requestId,
    providerEndpoint,
    videoModel,
  } = {}) {
    if (typeof videoModel !== 'string') {
      throw new FalVideoProviderError('Persisted FAL video model is missing; resume cannot choose a model.', {
        code: 'PROVIDER_JOB_BINDING_MISMATCH',
      });
    }
    const model = resolveFalVideoModel(videoModel);
    if (providerEndpoint !== model.endpoint || typeof providerRequestId !== 'string'
      || !SAFE_REQUEST_ID.test(providerRequestId) || providerRequestId !== jobId) {
      throw new FalVideoProviderError('Persisted FAL video model, endpoint and request id do not match.', {
        code: 'PROVIDER_JOB_BINDING_MISMATCH',
      });
    }
    try {
      for (let poll = 0; poll < this.#maxPolls; poll += 1) {
        const status = await this.#client.queue.status(model.endpoint, {
          requestId: providerRequestId,
          logs: false,
        });
        if (status?.request_id !== providerRequestId) {
          throw new FalVideoProviderError('FAL queue status answered about a different request.', {
            code: 'PROVIDER_JOB_MISMATCH',
          });
        }
        if (status?.status === 'COMPLETED') {
          const result = await this.#client.queue.result(model.endpoint, { requestId: providerRequestId });
          if (result?.requestId !== providerRequestId) {
            throw new FalVideoProviderError('FAL result answered about a different request.', {
              code: 'PROVIDER_JOB_MISMATCH',
            });
          }
          const url = result?.data?.video?.url;
          if (typeof url !== 'string' || !url.startsWith('https://')) {
            throw new FalVideoProviderError('FAL completed the request without a video URL.', {
              code: 'MISSING_VIDEO_OUTPUT',
            });
          }
          return {
            jobId,
            requestId: providerRequestId,
            url,
            selectedFieldPath: '/video/url',
            raw: result.data,
          };
        }
        if (['FAILED', 'ERROR'].includes(String(status?.status ?? '').toUpperCase())) {
          throw new FalVideoProviderError('FAL marked this video request as failed.', {
            code: 'PROVIDER_JOB_FAILED',
          });
        }
        if (!['IN_QUEUE', 'IN_PROGRESS'].includes(status?.status)) {
          throw new FalVideoProviderError('FAL returned an unsupported queue status.', {
            code: 'FAL_VIDEO_STATUS_INVALID', retryable: true,
          });
        }
        if (poll + 1 < this.#maxPolls) await this.#sleep(this.#pollIntervalMs);
      }
      throw new FalVideoProviderError('FAL video job is still running; resume polling the same request.', {
        code: 'FAL_VIDEO_WAIT_TIMEOUT', retryable: true,
      });
    } catch (cause) {
      throw providerFailure(cause, 'wait');
    }
  }
}
