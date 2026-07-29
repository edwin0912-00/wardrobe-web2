import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { HiggsfieldVideoProvider } from '../providers/higgsfield-video-provider.js';
import { OpenRouterVideoProvider } from '../providers/openrouter-video-provider.js';
import { VideoProviderRouter } from '../providers/video-provider-router.js';
import { extractFrame, probeVideo } from './ffprobe-video-probe.js';
import { ClipStore, VideoService } from './video-service.js';

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
 * Construct the complete executable video service without importing the
 * image-generation provider. `assetUrlResolver` must return a short-lived
 * private HTTPS URL for OpenRouter's first_frame input.
 */
export function createVideoRuntime({
  runtimeRoot,
  openRouterApiKey,
  assetUrlResolver,
  commandRunner = execFileAsync,
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
  return new VideoService({
    provider,
    clipStore: new ClipStore(path.join(runtimeRoot, 'video-clips')),
    finalizer: {
      downloadFn: (url) => downloadVideoBytes(url, { fetchFn, openRouterApiKey }),
      probeFn: probeVideo,
      extractFrameFn: extractFrame,
    },
  });
}
