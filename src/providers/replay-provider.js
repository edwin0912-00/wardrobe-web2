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

  qa(context) {
    return this.#next('qa', context);
  }

  assertExhausted() {
    if (this.cursor !== this.operations.length) {
      throw new Error(`Replay fixture has ${this.operations.length - this.cursor} unused operations`);
    }
  }
}
