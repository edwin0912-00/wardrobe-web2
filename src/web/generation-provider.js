import { CodexAppServerClient } from '../providers/codex-app-server-client.js';
import { CodexImagegenProvider } from '../providers/codex-imagegen-provider.js';
import { OpenRouterImageGenProvider } from '../providers/openrouter-imagegen-provider.js';
import { ImageGenerationRouter } from '../providers/image-generation-router.js';
import { resolveLookImageRoute } from '../runner/model-policy.js';
import { ImageAssetGenerator as ProviderAssetGenerator } from './image-asset-generator.js';

export const CODEX_IMAGEGEN_TEST_MODE = 'codex-imagegen-test';
export const CODEX_PRIMARY_IMAGEGEN_MODE = 'codex-primary';
export const OPENROUTER_IMAGEGEN_MODE = 'openrouter';

function hasOpenRouterKey() {
  return String(process.env.OPENROUTER_API_KEY ?? '').trim().length > 0;
}

class UnavailableGenerationProvider {
  constructor({ generationRoute, cause } = {}) {
    this.providerName = 'generation-unavailable';
    this.generationRoute = Object.freeze([...(generationRoute ?? [])]);
    this.maxOrderedReferences = null;
    this.causeCode = cause?.code ?? 'GENERATION_PREFLIGHT_FAILED';
  }

  healthStatus() {
    return { status: 'degraded', code: this.causeCode };
  }

  async probe() {
    return this.healthStatus();
  }

  async condition() {
    throw this.#error();
  }

  async generate() {
    throw this.#error();
  }

  async qa() {
    throw this.#error();
  }

  async close() {}

  #error() {
    const error = new Error('Generation transport is unavailable; authenticate a configured provider and restart');
    error.code = 'GENERATION_UNAVAILABLE';
    error.retryable = true;
    return error;
  }
}

function timeoutFrom(value) {
  if (value === undefined || value === '') return 6 * 60 * 1000;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 30_000 || parsed > 15 * 60 * 1000) {
    throw new Error('ZEELY_CODEX_IMAGEGEN_TIMEOUT_MS must be between 30000 and 900000');
  }
  return parsed;
}

export async function createGenerationRuntime({
  mode = process.env.ZEELY_GENERATION_PROVIDER ?? CODEX_PRIMARY_IMAGEGEN_MODE,
  enableCodexTest = process.env.ZEELY_ENABLE_CODEX_IMAGEGEN_TEST_ONLY === 'true',
  vlm,
  projectRoot,
  codexWorker,
  lookImageRoute = resolveLookImageRoute(process.env.ZEELY_LOOK_IMAGE_ROUTE ?? 'quality'),
  onCloseReady = () => {},
  onFatal = () => {},
} = {}) {
  if (!vlm || typeof vlm.evaluateQa !== 'function') throw new TypeError('vlm evaluator is required');
  if (typeof onCloseReady !== 'function') throw new TypeError('onCloseReady must be a function');
  if (typeof onFatal !== 'function') throw new TypeError('onFatal must be a function');
  const openRouter = mode === CODEX_PRIMARY_IMAGEGEN_MODE && hasOpenRouterKey()
    ? new OpenRouterImageGenProvider({ qaEvaluator: vlm.evaluateQa.bind(vlm) })
    : null;
  if (mode === OPENROUTER_IMAGEGEN_MODE) {
    const provider = new OpenRouterImageGenProvider({ qaEvaluator: vlm.evaluateQa.bind(vlm) });
    const runtime = {
      mode,
      provider,
      assetGenerator: new ProviderAssetGenerator({ provider }),
      generationRoute: [...lookImageRoute],
      label: 'OpenRouter Image Generation',
      status: null,
      healthStatus: () => ({ status: 'ready' }),
      close: async () => {},
    };
    onCloseReady(runtime.close);
    return runtime;
  }
  if (![CODEX_IMAGEGEN_TEST_MODE, CODEX_PRIMARY_IMAGEGEN_MODE].includes(mode)) {
    if (mode === 'higgsfield') throw new Error('HIGGSFIELD_DISABLED: Higgsfield is prohibited by the active provider policy');
    throw new Error(`Unknown ZEELY_GENERATION_PROVIDER: ${mode}`);
  }
  if (mode === CODEX_IMAGEGEN_TEST_MODE && !enableCodexTest) {
    throw new Error('Codex imagegen transport requires ZEELY_ENABLE_CODEX_IMAGEGEN_TEST_ONLY=true');
  }
  const worker = codexWorker ?? new CodexAppServerClient({
    cwd: projectRoot,
    generationTimeoutMs: timeoutFrom(process.env.ZEELY_CODEX_IMAGEGEN_TIMEOUT_MS),
  });
  const codex = new CodexImagegenProvider({
    worker,
    qaEvaluator: vlm.evaluateQa.bind(vlm),
    testOnly: mode === CODEX_IMAGEGEN_TEST_MODE,
  });
  const provider = mode === CODEX_PRIMARY_IMAGEGEN_MODE
    ? new ImageGenerationRouter({
        primary: codex,
        fallbacks: openRouter ? [openRouter] : [],
        generationRoute: lookImageRoute,
      })
    : codex;
  const fatalListener = (error) => onFatal(error);
  if (typeof worker.on === 'function') worker.on('fatal', fatalListener);
  const close = async () => {
    if (typeof worker.off === 'function') worker.off('fatal', fatalListener);
    await provider.close();
  };
  onCloseReady(close);
  let status;
  try {
    status = await provider.probe();
  } catch (error) {
    await close().catch(() => {});
    const unavailable = new UnavailableGenerationProvider({
      generationRoute: lookImageRoute,
      cause: error,
    });
    const degradedStatus = unavailable.healthStatus();
    return {
      mode,
      provider: unavailable,
      assetGenerator: new ProviderAssetGenerator({ provider: unavailable }),
      generationRoute: [...lookImageRoute],
      label: 'Image generation unavailable',
      status: degradedStatus,
      healthStatus: () => degradedStatus,
      close: async () => {},
    };
  }
  const label = mode === CODEX_PRIMARY_IMAGEGEN_MODE
    ? openRouter
      ? 'Codex Image Generation → OpenRouter fallback'
      : 'Codex Image Generation'
    : 'Codex Image Generation — test only';
  return {
    mode,
    provider,
    assetGenerator: new ProviderAssetGenerator({ provider }),
    generationRoute: [...provider.generationRoute],
    label,
    status,
    healthStatus: () => provider.healthStatus(),
    close,
  };
}
