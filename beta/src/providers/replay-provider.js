import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function matches(expected, context) {
  if (!expected) return true;
  return Object.entries(expected).every(([key, value]) => context[key] === value);
}

function decodeBinary(value) {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.base64 === 'string') return Buffer.from(value.base64, 'base64');
  return value;
}

function hydrateResponse(operation, response) {
  const hydrated = structuredClone(response);
  if (operation === 'generate' && hydrated.image) hydrated.image = decodeBinary(hydrated.image);
  if (operation === 'condition' && hydrated.reference) hydrated.reference = decodeBinary(hydrated.reference);
  return hydrated;
}

function normalizedReplayQa(response, context) {
  const decision = response?.decision;
  const checks = Array.isArray(response?.checks) && response.checks.length > 0
    ? response.checks.map((check, index) => ({
      name: check?.name ?? `REPLAY_CHECK_${index + 1}`,
      pass: check?.pass ?? decision === 'PASS',
      score: check?.score ?? ((check?.pass ?? (decision === 'PASS')) ? 1 : 0),
      evidence: check?.evidence ?? response?.reason ?? 'Recorded replay evidence',
    }))
    : [{
      name: 'REPLAY_SEMANTIC_QA',
      pass: decision === 'PASS',
      score: decision === 'PASS' ? 1 : 0,
      evidence: response?.reason ?? `Recorded replay decision: ${decision}`,
    }];
  const evaluatorCore = {
    type: 'REPLAY',
    provider: 'replay-provider',
    model: 'recorded-fixture',
    version: '1.0.0',
    phase: context?.phase ?? null,
    attempt: Number.isInteger(context?.attempt) ? context.attempt : null,
    idempotency_key: context?.idempotencyKey ?? null,
    decision,
  };
  return {
    ...response,
    reason: response?.reason ?? `Recorded replay decision: ${decision}`,
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

export class ReplayProvider {
  constructor(fixture) {
    if (!fixture || !Array.isArray(fixture.operations)) {
      throw new Error('Replay fixture must contain an operations array');
    }
    this.operations = structuredClone(fixture.operations);
    this.cursor = 0;
    this.calls = [];
  }

  static async fromFile(filename) {
    return new ReplayProvider(JSON.parse(await readFile(filename, 'utf8')));
  }

  async #next(operation, context) {
    const entry = this.operations[this.cursor];
    if (!entry) throw new Error(`Replay fixture exhausted before ${operation}`);
    if (entry.operation !== operation || !matches(entry.match, context)) {
      throw new Error(
        `Replay mismatch at ${this.cursor}: expected ${entry.operation}, received ${operation}`,
      );
    }
    this.cursor += 1;
    this.calls.push({ operation, context });
    if (entry.error) {
      const error = new Error(entry.error.message ?? String(entry.error));
      error.retryable = entry.error.retryable !== false;
      throw error;
    }
    return hydrateResponse(operation, entry.response);
  }

  condition(context) {
    return this.#next('condition', context);
  }

  generate(context) {
    return this.#next('generate', context);
  }

  async qa(context) {
    return normalizedReplayQa(await this.#next('qa', context), context);
  }

  assertExhausted() {
    if (this.cursor !== this.operations.length) {
      throw new Error(`Replay fixture has ${this.operations.length - this.cursor} unused operations`);
    }
  }
}
