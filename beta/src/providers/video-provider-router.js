export const HIGGSFIELD_VIDEO_PROVIDER = 'higgsfield';
export const OPENROUTER_VIDEO_PROVIDER = 'openrouter';
export const DEFAULT_HIGGSFIELD_CREATE_ATTEMPTS = 3;

export class VideoProviderRouterError extends Error {
  constructor(message, { code = 'VIDEO_PROVIDER_ROUTER_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'VideoProviderRouterError';
    this.code = code;
  }
}

function assertProvider(provider, label) {
  if (typeof provider?.createJob !== 'function' || typeof provider?.waitForJob !== 'function') {
    throw new VideoProviderRouterError(
      `${label} must implement createJob and waitForJob`,
      { code: 'VIDEO_PROVIDER_ROUTER_MISCONFIGURED' },
    );
  }
}

/**
 * Routes a new paid create through Higgsfield first and OpenRouter only after
 * three retryable create failures.
 *
 * Once a provider returns a job id, that provider becomes immutable for the
 * clip. Polling never falls through to the other provider: doing so would
 * create or observe a different paid job.
 */
export class VideoProviderRouter {
  constructor({
    primary,
    fallback,
    primaryCreateAttempts = DEFAULT_HIGGSFIELD_CREATE_ATTEMPTS,
  } = {}) {
    assertProvider(primary, 'primary video provider');
    assertProvider(fallback, 'fallback video provider');
    if (!Number.isInteger(primaryCreateAttempts) || primaryCreateAttempts !== 3) {
      throw new VideoProviderRouterError(
        'Higgsfield create attempts must be exactly 3',
        { code: 'INVALID_VIDEO_RETRY_POLICY' },
      );
    }
    this.providers = new Map([
      [HIGGSFIELD_VIDEO_PROVIDER, primary],
      [OPENROUTER_VIDEO_PROVIDER, fallback],
    ]);
    this.primaryCreateAttempts = primaryCreateAttempts;
  }

  async createJob(request) {
    const primary = this.providers.get(HIGGSFIELD_VIDEO_PROVIDER);
    const failures = [];

    for (let attempt = 1; attempt <= this.primaryCreateAttempts; attempt += 1) {
      try {
        const created = await primary.createJob(request);
        return {
          ...created,
          providerKey: HIGGSFIELD_VIDEO_PROVIDER,
          createAttempt: attempt,
          fallbackUsed: false,
        };
      } catch (error) {
        failures.push(error);
        if (error?.retryable !== true) throw error;
      }
    }

    if (Array.isArray(request?.videoPaths) && request.videoPaths.length > 0) {
      throw new VideoProviderRouterError(
        'Higgsfield could not create the reference-bound Fashion Video job; no fallback may drop Video 1',
        {
          code: 'VIDEO_REFERENCE_FALLBACK_UNAVAILABLE',
          cause: failures.at(-1),
        },
      );
    }

    try {
      const created = await this.providers.get(OPENROUTER_VIDEO_PROVIDER).createJob(request);
      return {
        ...created,
        providerKey: OPENROUTER_VIDEO_PROVIDER,
        createAttempt: 1,
        fallbackUsed: true,
        primaryFailures: failures.map((error) => error?.code ?? error?.name ?? 'ERROR'),
      };
    } catch (cause) {
      throw new VideoProviderRouterError(
        'Higgsfield failed three create attempts and OpenRouter fallback also failed',
        { code: 'ALL_VIDEO_PROVIDERS_FAILED', cause },
      );
    }
  }

  async waitForJob({ providerKey, ...request }) {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new VideoProviderRouterError(
        `Unknown persisted video provider: ${String(providerKey)}`,
        { code: 'UNKNOWN_PERSISTED_VIDEO_PROVIDER' },
      );
    }
    return provider.waitForJob(request);
  }
}
