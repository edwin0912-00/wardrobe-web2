import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { FalVideoProvider, FAL_VIDEO_PROVIDER } from '../providers/fal-video-provider.js';
import { OpenRouterVideoProvider } from '../providers/openrouter-video-provider.js';
import { extractFrame, probeVideo } from './ffprobe-video-probe.js';
import { ClipStore, VideoService } from './video-service.js';
import { salvageVideoFromQa } from './video-qa-salvage.js';
import { createVideoSemanticQaEvaluator } from './video-semantic-qa.js';
import { createVlmEvaluator } from './vlm-provider.js';

const execFileAsync = promisify(execFile);

export class VideoRuntimeError extends Error {
  constructor(message, { code = 'VIDEO_RUNTIME_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'VideoRuntimeError';
    this.code = code;
  }
}

function falVideoProviderWithLegacyWait(fal, openRouter) {
  return Object.freeze({
    async createJob(request) {
      if (!fal) {
        throw new VideoRuntimeError('FAL_KEY is required for new Fashion Video jobs', {
          code: 'FAL_VIDEO_MISCONFIGURED',
        });
      }
      const created = await fal.createJob(request);
      return {
        ...created,
        providerKey: FAL_VIDEO_PROVIDER,
        createAttempt: 1,
        fallbackUsed: false,
      };
    },
    async waitForJob({ providerKey, ...request }) {
      const persistedProvider = providerKey ?? 'openrouter';
      if (persistedProvider === 'openrouter') {
        if (!openRouter) {
          throw new VideoRuntimeError('OPENROUTER_API_KEY is required to resume this legacy video job', {
            code: 'LEGACY_OPENROUTER_WAIT_UNAVAILABLE',
          });
        }
        try {
          return await openRouter.waitForJob(request);
        } catch (cause) {
          if (cause?.code === 'OPENROUTER_VIDEO_JOB_FAILED') {
            throw new VideoRuntimeError('The persisted OpenRouter job completed unsuccessfully.', {
              code: 'PROVIDER_JOB_FAILED', cause,
            });
          }
          if (cause?.status === 404) {
            throw new VideoRuntimeError('The persisted OpenRouter job no longer exists.', {
              code: 'PROVIDER_JOB_NOT_FOUND', cause,
            });
          }
          throw cause;
        }
      }
      if (persistedProvider !== FAL_VIDEO_PROVIDER || !fal) {
        throw new VideoRuntimeError(
          `Persisted video provider is disabled or unsupported: ${String(persistedProvider)}`,
          { code: 'UNKNOWN_PERSISTED_VIDEO_PROVIDER' },
        );
      }
      return fal.waitForJob(request);
    },
  });
}

export async function downloadVideoBytes(url, {
  fetchFn = globalThis.fetch,
  openRouterApiKey = null,
  maximumBytes = 200 * 1024 * 1024,
} = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new VideoRuntimeError('Provider video URL is invalid', {
      code: 'VIDEO_DOWNLOAD_URL_INVALID',
      cause,
    });
  }
  if (parsed.protocol !== 'https:') {
    throw new VideoRuntimeError('Provider video URL must use HTTPS', {
      code: 'VIDEO_DOWNLOAD_URL_INVALID',
    });
  }
  const isOpenRouter = parsed.hostname === 'openrouter.ai';
  const response = await fetchFn(parsed, {
    headers: isOpenRouter && openRouterApiKey
      ? { Authorization: `Bearer ${openRouterApiKey}` }
      : {},
  });
  if (!response.ok) {
    throw new VideoRuntimeError(`Video download failed with HTTP ${response.status}`, {
      code: 'VIDEO_DOWNLOAD_FAILED',
    });
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new VideoRuntimeError('Provider video exceeds the maximum delivery size', {
      code: 'VIDEO_DOWNLOAD_TOO_LARGE',
    });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maximumBytes) {
    throw new VideoRuntimeError('Provider video bytes are empty or too large', {
      code: 'VIDEO_DOWNLOAD_INVALID',
    });
  }
  return bytes;
}

/**
 * Assemble the only file that may be delivered. Provider picture is retained,
 * provider sound is always discarded. If the locked Video 1 reference has an
 * audio stream, exactly that stream is muxed into the delivery; otherwise the
 * result is intentionally silent. All stream selection is explicit, so no
 * provider audio can leak through a default ffmpeg mapping.
 */
export async function assembleFashionVideoDelivery({
  providerVideoPath,
  referenceVideoPath,
  outputPath,
  commandRunner = execFileAsync,
  probeFn = probeVideo,
} = {}) {
  if (![providerVideoPath, referenceVideoPath, outputPath].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new VideoRuntimeError('Provider, reference and output paths are required for delivery assembly', {
      code: 'VIDEO_DELIVERY_ASSEMBLY_INVALID',
    });
  }
  const referenceProbe = await probeFn(referenceVideoPath);
  const hasReferenceAudio = referenceProbe?.hasAudio === true;
  const args = hasReferenceAudio
    ? [
        '-y', '-i', providerVideoPath, '-i', referenceVideoPath,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outputPath,
      ]
    : [
        '-y', '-i', providerVideoPath,
        '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', outputPath,
      ];
  try {
    await commandRunner('ffmpeg', args, { maxBuffer: 4 * 1024 * 1024 });
  } catch (cause) {
    throw new VideoRuntimeError('ffmpeg could not assemble the delivery audio', {
      code: 'VIDEO_DELIVERY_ASSEMBLY_FAILED', cause,
    });
  }
  return {
    policy: hasReferenceAudio ? 'REFERENCE_REQUIRED' : 'SILENT_REQUIRED',
    referenceAudioAttached: hasReferenceAudio,
    source: hasReferenceAudio ? 'LOCKED_VIDEO_REFERENCE' : 'SILENT_REFERENCE',
  };
}

/**
 * New video creates use FAL. OpenRouter remains configured only to wait on
 * persisted legacy jobs and to authenticate their output downloads.
 */
export function createVideoRuntime({
  runtimeRoot,
  falApiKey = process.env.FAL_KEY ?? null,
  openRouterApiKey = process.env.OPENROUTER_API_KEY ?? null,
  assetUrlResolver,
  fashionVideoReferenceResolver = null,
  fashionVideoQaMode = 'strict',
  qaEvaluator = null,
  commandRunner = execFileAsync,
  ffmpegRunner = execFileAsync,
  fetchFn = globalThis.fetch,
  probeVideoFn = probeVideo,
  falClientFactory,
} = {}) {
  if (typeof runtimeRoot !== 'string' || runtimeRoot.length === 0) {
    throw new VideoRuntimeError('runtimeRoot is required', {
      code: 'VIDEO_RUNTIME_MISCONFIGURED',
    });
  }
  const fal = typeof falApiKey === 'string' && falApiKey.trim().length > 0
    ? new FalVideoProvider({
        apiKey: falApiKey,
        ...(falClientFactory ? { clientFactory: falClientFactory } : {}),
        fetchFn,
        probeVideoFn,
        commandRunner,
      })
    : null;
  const openRouter = typeof openRouterApiKey === 'string' && openRouterApiKey.trim().length > 0
    ? new OpenRouterVideoProvider({
        apiKey: openRouterApiKey,
        assetUrlResolver: assetUrlResolver ?? (async () => {
          throw new VideoRuntimeError('Legacy OpenRouter assets are wait-only', {
            code: 'LEGACY_OPENROUTER_CREATE_DISABLED',
          });
        }),
        fetchFn,
      })
    : null;
  const provider = falVideoProviderWithLegacyWait(fal, openRouter);
  const semanticEvaluator = qaEvaluator ?? createVlmEvaluator();
  return new VideoService({
    provider,
    clipStore: new ClipStore(path.join(runtimeRoot, 'video-clips')),
    fashionVideoReferenceResolver,
    fashionVideoQaMode,
    automaticQaFn: fashionVideoReferenceResolver
      ? createVideoSemanticQaEvaluator({
          evaluator: semanticEvaluator,
          fashionVideoReferenceResolver,
          commandRunner: ffmpegRunner,
        })
      : null,
    finalizer: {
      downloadFn: (url) => downloadVideoBytes(url, { fetchFn, openRouterApiKey }),
      probeFn: probeVideo,
      extractFrameFn: extractFrame,
      composeFn: (args) => assembleFashionVideoDelivery({ ...args, commandRunner }),
      salvageFn: (request) => salvageVideoFromQa(request, {
        commandRunner: ffmpegRunner,
        probeFn: probeVideo,
      }),
    },
  });
}
