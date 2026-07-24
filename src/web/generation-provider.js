import { CodexAppServerClient } from '../providers/codex-app-server-client.js';
import { CodexImagegenProvider } from '../providers/codex-imagegen-provider.js';
import { HiggsfieldCliProvider } from '../providers/higgsfield-cli-provider.js';
import { IMAGE_MODEL_ROUTE } from '../runner/model-policy.js';
import { HiggsfieldAssetGenerator as ProviderAssetGenerator } from './higgsfield-asset-generator.js';

export const HIGGSFIELD_MODE = 'higgsfield';
export const CODEX_IMAGEGEN_TEST_MODE = 'codex-imagegen-test';

function timeoutFrom(value) {
  if (value === undefined || value === '') return 6 * 60 * 1000;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 30_000 || parsed > 15 * 60 * 1000) {
    throw new Error('ZEELY_CODEX_IMAGEGEN_TIMEOUT_MS must be between 30000 and 900000');
  }
  return parsed;
}

export async function createGenerationRuntime({
  mode = process.env.ZEELY_GENERATION_PROVIDER ?? HIGGSFIELD_MODE,
  enableCodexTest = process.env.ZEELY_ENABLE_CODEX_IMAGEGEN_TEST_ONLY === 'true',
  vlm,
  projectRoot,
  codexWorker,
  onCloseReady = () => {},
  onFatal = () => {},
} = {}) {
  if (!vlm || typeof vlm.evaluateQa !== 'function') throw new TypeError('vlm evaluator is required');
  if (typeof onCloseReady !== 'function') throw new TypeError('onCloseReady must be a function');
  if (typeof onFatal !== 'function') throw new TypeError('onFatal must be a function');
  if (mode === HIGGSFIELD_MODE) {
    const provider = new HiggsfieldCliProvider({ qaEvaluator: vlm.evaluateQa.bind(vlm) });
    const runtime = {
      mode,
      provider,
      assetGenerator: new ProviderAssetGenerator({ provider }),
      generationRoute: [...IMAGE_MODEL_ROUTE],
      label: 'Higgsfield CLI',
      status: null,
      healthStatus: () => ({ status: 'ready' }),
      close: async () => {},
    };
    onCloseReady(runtime.close);
    return runtime;
  }
  if (mode !== CODEX_IMAGEGEN_TEST_MODE) throw new Error(`Unknown ZEELY_GENERATION_PROVIDER: ${mode}`);
  if (!enableCodexTest) {
    throw new Error('Codex imagegen transport requires ZEELY_ENABLE_CODEX_IMAGEGEN_TEST_ONLY=true');
  }
  const worker = codexWorker ?? new CodexAppServerClient({
    cwd: projectRoot,
    generationTimeoutMs: timeoutFrom(process.env.ZEELY_CODEX_IMAGEGEN_TIMEOUT_MS),
  });
  const provider = new CodexImagegenProvider({ worker, qaEvaluator: vlm.evaluateQa.bind(vlm) });
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
    throw error;
  }
  return {
    mode,
    provider,
    assetGenerator: new ProviderAssetGenerator({ provider }),
    generationRoute: [...provider.generationRoute],
    label: 'Codex Image Generation — test only',
    status,
    healthStatus: () => provider.healthStatus(),
    close,
  };
}
