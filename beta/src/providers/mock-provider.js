import { createHash } from 'node:crypto';

// Valid 3x3 opaque sRGB RGB PNG, used only by an explicitly selected mock provider.
// Its white border and dark center make it suitable for decode and white-normalization tests.
export const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFklEQVQImWP4DwMM////19DQgLIgAABtzRhhmlbJTQAAAABJRU5ErkJggg==',
  'base64',
);

function scripted(script, operation, context, fallback) {
  const handler = script?.[operation];
  if (typeof handler === 'function') return handler(context);
  if (Array.isArray(handler)) {
    if (handler.length === 0) throw new Error(`Mock script exhausted for ${operation}`);
    const next = handler.shift();
    if (next instanceof Error) throw next;
    return structuredClone(next);
  }
  if (handler !== undefined) return structuredClone(handler);
  return fallback();
}

export class MockProvider {
  constructor({ script = {}, image = MOCK_PNG } = {}) {
    this.script = script;
    this.image = image;
    this.calls = [];
  }

  async condition(context) {
    this.calls.push({ operation: 'condition', context });
    return scripted(this.script, 'condition', context, async () => {
      if (context.role === 'identity' || context.source?.path) {
        return {
          reference: { path: context.source.path },
          extension: context.source.extension ?? '.bin',
          mediaType: context.source.mediaType ?? 'application/octet-stream',
          facts: { role: context.role, conditioned: true },
          risks: [],
        };
      }
      return {
        facts: { role: context.role, conditioned: true, text: context.source?.text },
        risks: [],
      };
    });
  }

  async generate(context) {
    this.calls.push({ operation: 'generate', context });
    return scripted(this.script, 'generate', context, () => ({
      image: this.image,
      extension: '.png',
      mediaType: 'image/png',
      metadata: {
        mock: true,
        model: context.model,
        model_name: context.model_name,
        job_set_type: context.job_set_type,
      },
    }));
  }

  async qa(context) {
    this.calls.push({ operation: 'qa', context });
    const response = await scripted(this.script, 'qa', context, () => ({
      decision: 'PASS',
      checks: [{
        name: 'MOCK',
        pass: true,
        score: 1,
        evidence: 'Deterministic fixture explicitly approves this candidate',
      }],
      defects: [],
      reason: 'Explicit mock provider auto-pass',
    }));
    const decision = response?.decision;
    const checks = Array.isArray(response?.checks) && response.checks.length > 0
      ? response.checks.map((check, index) => ({
        name: check?.name ?? `MOCK_CHECK_${index + 1}`,
        pass: check?.pass ?? decision === 'PASS',
        score: check?.score ?? ((check?.pass ?? (decision === 'PASS')) ? 1 : 0),
        evidence: check?.evidence ?? response?.reason ?? 'Deterministic mock QA evidence',
      }))
      : [{
        name: 'MOCK_SEMANTIC_QA',
        pass: decision === 'PASS',
        score: decision === 'PASS' ? 1 : 0,
        evidence: response?.reason ?? `Mock decision: ${decision}`,
      }];
    const evaluatorCore = {
      type: 'FIXTURE',
      provider: 'mock-provider',
      model: 'deterministic-fixture',
      version: '1.0.0',
      phase: context.phase,
      attempt: context.attempt,
      idempotency_key: context.idempotencyKey,
      decision,
    };
    return {
      ...response,
      reason: response?.reason ?? `Explicit mock decision: ${decision}`,
      checks,
      defects: Array.isArray(response?.defects) ? response.defects : [],
      evaluator: response?.evaluator ?? {
        type: evaluatorCore.type,
        provider: evaluatorCore.provider,
        model: evaluatorCore.model,
        version: evaluatorCore.version,
        evaluation_id: createHash('sha256').update(JSON.stringify(evaluatorCore)).digest('hex'),
      },
    };
  }
}
