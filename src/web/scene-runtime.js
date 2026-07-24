import path from 'node:path';
import { HiggsfieldCliProvider } from '../providers/higgsfield-cli-provider.js';
import { OpenRouterImageGenProvider } from '../providers/openrouter-imagegen-provider.js';
import { sanitizeOutboundString } from '../security/outbound-redaction.js';
import { OpenRouterSceneEvaluator } from './openrouter-scene-evaluator.js';
import { SceneEvaluatorAdapter, SceneGeneratorAdapter } from './scene-adapters.js';
import { FilesystemScenePresetResolver } from './scene-resolvers.js';
import { CODEX_VLM_PROVIDER, OPENROUTER_VLM_PROVIDER } from './vlm-provider.js';

const SECRET_ASSIGNMENT = /\b(api[_ -]?key|access[_ -]?token|token|password|secret)\s*[:=]\s*[^\s,;]+/gi;
const SECRET_TOKEN = /\b(?:sk|hf|ghp|glpat|ek_live|AIza)[-_A-Za-z0-9]{8,}\b/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi;
const URL_QUERY = /(https?:\/\/[^\s"'<>?#]+)(?:\?[^\s"'<>#]*)?(?:#[^\s"'<>]*)?/gi;

export const SCENE_PROVIDER_RUNTIME_CONFIG = Object.freeze({
  gpt_image_2: Object.freeze({
    aspectRatio: '3:4',
    resolution: '2k',
    quality: 'high',
  }),
  nano_banana_flash: Object.freeze({
    aspectRatio: '4:5',
    resolution: '2k',
    quality: 'high',
  }),
  nano_banana_2: Object.freeze({
    aspectRatio: '4:5',
    resolution: '2k',
    quality: 'high',
  }),
});

function publicMonitorMessage(value) {
  return sanitizeOutboundString(String(value ?? ''))
    .replace(SECRET_ASSIGNMENT, '$1=[redacted]')
    .replace(SECRET_TOKEN, '[redacted]')
    .replace(BEARER_TOKEN, 'Bearer [redacted]')
    .replace(URL_QUERY, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/**
 * Build the production SceneService dependencies without starting a server or
 * touching disk. Keeping this construction pure makes the exact provider route,
 * isolation boundaries and public monitor projection independently testable.
 */
export function createSceneRuntimeDependencies({
  projectRoot,
  qaEvaluator,
  generationProvider = null,
  monitor = null,
  vlmProvider = process.env.ZEELY_VLM_PROVIDER ?? CODEX_VLM_PROVIDER,
  sceneEvaluator,
} = {}) {
  if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
    throw new TypeError('createSceneRuntimeDependencies projectRoot is required');
  }
  if (typeof qaEvaluator !== 'function') {
    throw new TypeError('createSceneRuntimeDependencies qaEvaluator is required');
  }
  if (generationProvider !== null && typeof generationProvider?.generate !== 'function') {
    throw new TypeError('createSceneRuntimeDependencies generationProvider.generate must be a function');
  }
  if (monitor !== null && typeof monitor?.append !== 'function') {
    throw new TypeError('createSceneRuntimeDependencies monitor.append must be a function');
  }
  if (!sceneEvaluator && vlmProvider !== CODEX_VLM_PROVIDER && vlmProvider !== OPENROUTER_VLM_PROVIDER) {
    throw new Error(`Unknown ZEELY_VLM_PROVIDER: ${vlmProvider}`);
  }

  const resolvedProjectRoot = path.resolve(projectRoot);
  const journalRoot = path.join(resolvedProjectRoot, 'runtime', 'provider-journals', 'scenes');
  // OpenRouterImageGenProvider already routes every job_set_type through its
  // own modelByRoute map, so one shared instance covers all three scene
  // models; every other injected generationProvider keeps the existing
  // gpt_image_2-only wiring so that behavior does not change for it.
  const generationProviderCoversAllRoutes = generationProvider instanceof OpenRouterImageGenProvider;
  const providers = Object.fromEntries(
    Object.entries(SCENE_PROVIDER_RUNTIME_CONFIG).map(([model, config]) => [
      model,
      generationProviderCoversAllRoutes || (model === 'gpt_image_2' && generationProvider)
        ? generationProvider
        : new HiggsfieldCliProvider({
        qaEvaluator,
        ...config,
        journalDirectory: path.join(journalRoot, model),
      }),
    ]),
  );

  const observer = monitor ? async (scene) => {
    const status = typeof scene?.status === 'string' ? scene.status : 'UNKNOWN';
    const phase = typeof scene?.phase === 'string' ? scene.phase : 'UNKNOWN';
    const sceneId = typeof scene?.scene_id === 'string' ? scene.scene_id : undefined;
    await monitor.append({
      source: 'runner',
      type: 'scene.phase',
      severity: status === 'FAILED' ? 'error' : status === 'CANCELLED' ? 'warn' : 'info',
      data: {
        ...(sceneId ? { scene_id: sceneId } : {}),
        status,
        stage: phase,
        message: publicMonitorMessage(scene?.message),
      },
    });
  } : null;

  return {
    rootDirectory: path.join(resolvedProjectRoot, 'runtime', 'scenes'),
    editorialRootDirectory: path.join(resolvedProjectRoot, 'runtime', 'editorial-shoots'),
    generator: new SceneGeneratorAdapter({ providers }),
    evaluator: sceneEvaluator ?? (
      vlmProvider === OPENROUTER_VLM_PROVIDER
        ? new OpenRouterSceneEvaluator({})
        : new SceneEvaluatorAdapter({ model: 'gpt-5.6-terra' })
    ),
    autoRecoverQaInfrastructureFailures: true,
    presetResolver: new FilesystemScenePresetResolver({
      rootDirectory: path.join(resolvedProjectRoot, 'assets', 'scene-presets'),
      projectRoot: resolvedProjectRoot,
    }),
    ...(observer ? { observer } : {}),
  };
}
