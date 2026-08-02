import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { HiggsfieldVideoProvider } from '../providers/higgsfield-video-provider.js';
import { OpenRouterVideoProvider } from '../providers/openrouter-video-provider.js';
import { VideoProviderRouter } from '../providers/video-provider-router.js';
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
 * Construct the complete executable video service without importing the
 * image-generation provider. `assetUrlResolver` must return a short-lived
 * private HTTPS URL for OpenRouter's first_frame input.
 */
export function createVideoRuntime({
  runtimeRoot,
  openRouterApiKey,
  assetUrlResolver,
  fashionVideoReferenceResolver = null,
  fashionVideoQaMode = 'strict',
  qaEvaluator = null,
  commandRunner = execFileAsync,
  ffmpegRunner = execFileAsync,
  fetchFn = globalThis.fetch,
} = {}) {
  if (typeof runtimeRoot !== 'string' || runtimeRoot.length === 0) {
    throw new VideoRuntimeError('runtimeRoot is required', {
      code: 'VIDEO_RUNTIME_MISCONFIGURED',
    });
  }
  const higgsfield = new HiggsfieldVideoProvider({ commandRunner });
  const openRouter = new OpenRouterVideoProvider({
    apiKey: openRouterApiKey,
    assetUrlResolver,
    fetchFn,
  });
  const provider = new VideoProviderRouter({
    primary: higgsfield,
    fallback: openRouter,
  });
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
