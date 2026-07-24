const REQUIRED_METHODS = ['condition', 'qa', 'generate'];

/**
 * Provider contract consumed by PipelineRunner.
 *
 * condition(context) -> {
 *   reference?: Buffer | Uint8Array | { path } | { base64 },
 *   extension?: string,
 *   mediaType?: string,
 *   facts?: object,
 *   risks?: array
 * }
 *
 * generate(context) -> {
 *   // context.model and context.job_set_type are the exact Higgsfield route
 *   // identifier; context.model_name is its locked display name.
 *   // context.references keeps the legacy identity/outfit/avatar values and adds:
 *   //   ordered: [{ order, scope, role, path, sha256, mediaType, source,
 *   //               bindingOrder?, packPath?, packSha256? }]
 *   // `ordered` is the only provider-media order; REFERENCE_PACK entries always
 *   // include their pack-local binding order and immutable pack identity.
 *   // Scene repair uses one typed `{ scope: 'scene',
 *   // role: 'FAILED_SCENE_CANDIDATE', source: 'REPAIR_CANDIDATE' }` directly
 *   // after the approved look. It is never silently relabeled as outfit input.
 *   // context.workDirectory is the durable per-run root for provider journals;
 *   // context.idempotencyKey is a lowercase SHA-256 operation identity.
 *   image: Buffer | Uint8Array | { path } | { base64 },
 *   mediaType: 'image/png',
 *   extension?: '.png',
 *   metadata?: object
 * }
 *
 * qa(context) -> {
 *   decision: 'PASS' | 'RETRY' | 'NEEDS_INPUT' | 'REJECT',
 *   checks?: array,
 *   defects?: array,
 *   reason?: string
 * }
 */
export function assertProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new Error('A provider instance is required');
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') throw new Error(`Provider must implement ${method}(context)`);
  }
  return provider;
}

export function assertQaDecision(result) {
  const decisions = new Set(['PASS', 'RETRY', 'NEEDS_INPUT', 'REJECT']);
  if (!result || !decisions.has(result.decision)) {
    throw new Error('Provider QA result must include PASS, RETRY, NEEDS_INPUT, or REJECT');
  }
  return result;
}
