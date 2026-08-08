/**
 * Deterministic image transport policy.
 *
 * The primary transport is tried first. A fallback is allowed only when the
 * primary failure is known to be safe to retry: no request may be duplicated
 * after a provider has submitted an unknown/paid job, and malformed caller
 * input must not be silently sent to another provider.
 */
const NON_RETRYABLE_CODES = new Set([
  'PROVIDER_JOURNAL_CONFLICT',
  'GENERATION_OUTCOME_UNKNOWN',
  'PRIOR_OUTCOME_UNKNOWN',
  'JOURNALED_OUTPUT_MISMATCH',
  'INVALID_IDEMPOTENCY_KEY',
  'MODEL_CONTEXT_MISMATCH',
  'INVALID_PROMPT',
  'INVALID_GENERATION_PROMPT',
  'UNSAFE_PROVIDER_PROMPT',
  'INVALID_GENERATION_PHASE',
  'INVALID_ORDERED_REFERENCES',
  'DUPLICATE_ORDERED_REFERENCE',
  'INVALID_AVATAR_REFERENCE_ORDER',
  'MISSING_APPROVED_AVATAR',
  'INVALID_GARMENT_REFERENCE_ORDER',
  'MISSING_APPROVED_OUTFIT',
  'REFERENCE_NOT_READABLE',
  'INVALID_REFERENCE_FILE',
  'REFERENCE_HASH_MISMATCH',
  'INVALID_REFERENCE_IMAGE',
  'INVALID_CONDITIONING_INPUT',
]);

function providerName(provider, fallback) {
  return typeof provider?.providerName === 'string' && provider.providerName.trim() !== ''
    ? provider.providerName
    : fallback;
}

function canTryFallback(error) {
  if (NON_RETRYABLE_CODES.has(error?.code)) return false;
  // Explicitly retryable errors are safe by contract. Transport errors without
  // a retryable flag are also safe only when they were thrown before submit;
  // providers must mark an unknown submitted outcome explicitly.
  return error?.retryable === true
    || ['CODEX_APP_SERVER_ERROR', 'CODEX_IMAGEGEN_PROVIDER_ERROR', 'OPENROUTER_IMAGEGEN_PROVIDER_ERROR'].includes(error?.code)
    || ['PROCESS_ERROR', 'PROCESS_EXITED', 'PROCESS_STDOUT_CLOSED', 'PROCESS_STDOUT_ERROR', 'PROCESS_STDERR_ERROR', 'PROCESS_STDIN_CLOSED', 'PROCESS_STDIN_ERROR'].includes(error?.code);
}

export class ImageGenerationRouterError extends Error {
  constructor(message, { code = 'IMAGE_GENERATION_ROUTER_ERROR', retryable = false, cause, attempts = [] } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ImageGenerationRouterError';
    this.code = code;
    this.retryable = retryable;
    this.attempts = attempts;
  }
}

export class ImageGenerationRouter {
  constructor({ primary, fallbacks = [], generationRoute = null } = {}) {
    if (!primary || typeof primary.generate !== 'function') {
      throw new TypeError('primary image provider must implement generate()');
    }
    if (!Array.isArray(fallbacks) || fallbacks.some((provider) => !provider || typeof provider.generate !== 'function')) {
      throw new TypeError('fallback image providers must implement generate()');
    }
    this.primary = primary;
    this.fallbacks = [...fallbacks];
    this.providers = Object.freeze([primary, ...this.fallbacks]);
    this.providerName = 'codex-primary-openrouter-fallback';
    this.generationRoute = Object.freeze([...(generationRoute ?? primary.generationRoute ?? [])]);
    this.maxOrderedReferences = Math.max(
      ...this.providers.map((provider) => Number.isInteger(provider.maxOrderedReferences) ? provider.maxOrderedReferences : 0),
    ) || null;
  }

  healthStatus() {
    const primary = typeof this.primary.healthStatus === 'function' ? this.primary.healthStatus() : { status: 'unknown' };
    return {
      status: primary.status === 'ready' ? 'ready' : 'degraded',
      policy: this.providerName,
      primary: primary.status ?? 'unknown',
      fallbacks: this.fallbacks.map((provider) => providerName(provider, 'fallback')),
    };
  }

  async probe() {
    if (typeof this.primary.probe === 'function') return this.primary.probe();
    return this.healthStatus();
  }

  async condition(context) {
    if (typeof this.primary.condition !== 'function') return context;
    return this.primary.condition(context);
  }

  async generate(context) {
    const attempts = [];
    for (const [index, provider] of this.providers.entries()) {
      const name = providerName(provider, index === 0 ? 'codex' : 'openrouter');
      try {
        const response = await provider.generate(context);
        return {
          ...response,
          metadata: {
            ...(response?.metadata ?? {}),
            routing: {
              policy: this.providerName,
              selected: name,
              fallback_used: index > 0,
              attempts: [...attempts, { provider: name, outcome: 'SUCCEEDED' }],
            },
          },
        };
      } catch (error) {
        attempts.push({ provider: name, outcome: 'FAILED', code: error?.code ?? 'GENERATION_FAILED' });
        if (index === this.providers.length - 1 || !canTryFallback(error)) {
          if (index === 0) throw error;
          throw new ImageGenerationRouterError(
            `All configured image transports failed; last provider: ${name}`,
            { code: error?.code ?? 'IMAGE_GENERATION_FAILED', retryable: error?.retryable === true, cause: error, attempts },
          );
        }
      }
    }
    throw new ImageGenerationRouterError('No image transport is configured', { attempts });
  }

  async qa(context) {
    // Semantic QA is transport-independent and uses the configured VLM. Keep
    // the primary provider's contract for receipts and evaluator attestations.
    if (typeof this.primary.qa !== 'function') throw new ImageGenerationRouterError('Primary image provider has no QA contract');
    return this.primary.qa(context);
  }

  async close() {
    for (const provider of this.providers) await provider.close?.();
  }
}

export function createImageGenerationRouter(options) {
  return new ImageGenerationRouter(options);
}

export { canTryFallback };
