import { assertExternalPromptPrivacy } from './provider-prompt-privacy.js';

export const OPENROUTER_VIDEO_API = 'https://openrouter.ai/api/v1/videos';
export const OPENROUTER_SEEDANCE_MODEL = 'bytedance/seedance-2.0';

const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class OpenRouterVideoError extends Error {
  constructor(message, {
    code = 'OPENROUTER_VIDEO_ERROR',
    retryable = false,
    status = null,
    cause,
  } = {}) {
    super(message, { cause });
    this.name = 'OpenRouterVideoError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function responsePayload(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text };
  }
}

/**
 * OpenRouter's video endpoint needs an HTTPS-fetchable image. The resolver is
 * deliberately injected: the provider must not expose a local runtime path or
 * silently upload personal media to an undeclared host.
 */
export class OpenRouterVideoProvider {
  constructor({
    apiKey,
    fetchFn = globalThis.fetch,
    assetUrlResolver,
    baseUrl = OPENROUTER_VIDEO_API,
    model = OPENROUTER_SEEDANCE_MODEL,
    pollIntervalMs = 30_000,
    maxPolls = 60,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new OpenRouterVideoError('OPENROUTER_API_KEY is required', {
        code: 'OPENROUTER_VIDEO_MISCONFIGURED',
      });
    }
    if (typeof fetchFn !== 'function' || typeof assetUrlResolver !== 'function') {
      throw new OpenRouterVideoError('fetchFn and assetUrlResolver are required', {
        code: 'OPENROUTER_VIDEO_MISCONFIGURED',
      });
    }
    if (!Number.isInteger(maxPolls) || maxPolls < 1 || pollIntervalMs < 0) {
      throw new OpenRouterVideoError('Polling limits are invalid', {
        code: 'OPENROUTER_VIDEO_MISCONFIGURED',
      });
    }
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
    this.assetUrlResolver = assetUrlResolver;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.pollIntervalMs = pollIntervalMs;
    this.maxPolls = maxPolls;
    this.sleep = sleep;
  }

  headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createJob(request = {}) {
    const {
      prompt,
      mediaPaths,
      aspectRatio,
      durationSeconds,
      resolution = '720p',
      openRouterModel = this.model,
    } = request;
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new OpenRouterVideoError('A motion prompt is required', {
        code: 'MISSING_VIDEO_PROMPT',
      });
    }
    assertExternalPromptPrivacy(prompt);
    if (!Array.isArray(mediaPaths) || mediaPaths.length !== 1) {
      throw new OpenRouterVideoError('Exactly one locked source frame is required', {
        code: 'MISSING_VIDEO_SOURCE',
      });
    }
    const sourceUrl = await this.assetUrlResolver(mediaPaths[0]);
    if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('https://')) {
      throw new OpenRouterVideoError('Source resolver must return a private HTTPS asset URL', {
        code: 'VIDEO_SOURCE_URL_INVALID',
      });
    }

    const response = await this.fetchFn(this.baseUrl, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: openRouterModel,
        prompt,
        duration: durationSeconds,
        resolution,
        aspect_ratio: aspectRatio,
        generate_audio: false,
        frame_images: [{
          type: 'image_url',
          image_url: { url: sourceUrl },
          frame_type: 'first_frame',
        }],
      }),
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new OpenRouterVideoError('OpenRouter video create failed', {
        code: 'OPENROUTER_VIDEO_CREATE_FAILED',
        retryable: retryableStatus(response.status),
        status: response.status,
      });
    }
    if (typeof payload.id !== 'string' || !SAFE_JOB_ID.test(payload.id)) {
      throw new OpenRouterVideoError('OpenRouter did not return a safe video job id', {
        code: 'MISSING_PROVIDER_JOB_ID',
        retryable: true,
      });
    }
    return { jobId: payload.id, raw: payload };
  }

  async waitForJob({ jobId }) {
    if (typeof jobId !== 'string' || !SAFE_JOB_ID.test(jobId)) {
      throw new OpenRouterVideoError('OpenRouter video job id is invalid', {
        code: 'INVALID_VIDEO_JOB_ID',
      });
    }
    for (let poll = 1; poll <= this.maxPolls; poll += 1) {
      const response = await this.fetchFn(`${this.baseUrl}/${encodeURIComponent(jobId)}`, {
        headers: this.headers(),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new OpenRouterVideoError('OpenRouter video poll failed', {
          code: 'OPENROUTER_VIDEO_POLL_FAILED',
          retryable: retryableStatus(response.status),
          status: response.status,
        });
      }
      if (payload.status === 'completed') {
        const url = payload.unsigned_urls?.[0]
          ?? `${this.baseUrl}/${encodeURIComponent(jobId)}/content?index=0`;
        return { jobId, url, raw: payload };
      }
      if (['failed', 'cancelled', 'expired'].includes(payload.status)) {
        throw new OpenRouterVideoError(`OpenRouter video job ${payload.status}`, {
          code: 'OPENROUTER_VIDEO_JOB_FAILED',
          retryable: false,
        });
      }
      if (poll < this.maxPolls) await this.sleep(this.pollIntervalMs);
    }
    throw new OpenRouterVideoError('OpenRouter video job did not finish before the poll limit', {
      code: 'OPENROUTER_VIDEO_POLL_TIMEOUT',
      retryable: true,
    });
  }
}
