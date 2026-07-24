import { CodexVlmEvaluator } from '../providers/codex-vlm-evaluator.js';
import { OpenRouterVlmEvaluator } from '../providers/openrouter-vlm-evaluator.js';

export const CODEX_VLM_PROVIDER = 'codex';
export const OPENROUTER_VLM_PROVIDER = 'openrouter';

/**
 * Selects the semantic-QA / garment-classification evaluator the same way
 * createGenerationRuntime() selects the image-generation provider: an env var
 * with a safe, unchanged-by-default value. Set ZEELY_VLM_PROVIDER=openrouter
 * to evaluate through OpenRouter instead of the local Codex CLI when the
 * Codex/ChatGPT session is rate limited or unauthenticated.
 */
export function createVlmEvaluator({
  provider = process.env.ZEELY_VLM_PROVIDER ?? CODEX_VLM_PROVIDER,
  codexOptions,
  openRouterOptions,
} = {}) {
  if (provider === OPENROUTER_VLM_PROVIDER) return new OpenRouterVlmEvaluator(openRouterOptions);
  if (provider !== CODEX_VLM_PROVIDER) throw new Error(`Unknown ZEELY_VLM_PROVIDER: ${provider}`);
  return new CodexVlmEvaluator(codexOptions);
}
