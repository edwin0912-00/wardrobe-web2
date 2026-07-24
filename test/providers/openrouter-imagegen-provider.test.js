import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MOCK_PNG } from '../../src/providers/mock-provider.js';
import {
  OpenRouterImageGenProvider,
  OpenRouterImageGenProviderError,
} from '../../src/providers/openrouter-imagegen-provider.js';

const MOCK_SHA256 = createHash('sha256').update(MOCK_PNG).digest('hex');
const KEY = 'a'.repeat(64);

async function mediaFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zeely-openrouter-imagegen-'));
  const identityPath = path.join(directory, 'identity.png');
  await writeFile(identityPath, MOCK_PNG);
  return { directory, identityPath };
}

function baseContext(fixture, overrides = {}) {
  return {
    phase: 'avatar',
    attempt: 1,
    model: 'gpt_image_2',
    job_set_type: 'gpt_image_2',
    model_name: 'GPT Image 2',
    prompt: 'Generate a studio avatar from the identity reference.',
    references: { identity: { artifact: { path: fixture.identityPath, digest: MOCK_SHA256 } } },
    idempotencyKey: KEY,
    jobId: 'job-1',
    workDirectory: fixture.directory,
    ...overrides,
  };
}

function clientReturning(image, calls = []) {
  return { generateImage: async (options) => { calls.push(options); return image; } };
}

test('generates one PNG through OpenRouter and returns full provenance metadata', async () => {
  const fixture = await mediaFixture();
  const calls = [];
  const provider = new OpenRouterImageGenProvider({ client: clientReturning(MOCK_PNG, calls) });
  const result = await provider.generate(baseContext(fixture));
  assert.equal(result.mediaType, 'image/png');
  assert.ok(result.image.equals(MOCK_PNG));
  assert.equal(calls[0].model, 'openai/gpt-5.4-image-2');
  assert.equal(calls[0].imagePaths.length, 1);
  assert.equal(result.metadata.provider, 'openrouter-imagegen');
  assert.equal(result.metadata.job_set_type, 'gpt_image_2');
  assert.equal(result.metadata.provider_internal_model, 'openai/gpt-5.4-image-2');
  assert.equal(result.metadata.provider_journal.resumed, false);
});

test('a repeated idempotencyKey resumes from the journal without calling OpenRouter again', async () => {
  const fixture = await mediaFixture();
  const calls = [];
  const provider = new OpenRouterImageGenProvider({ client: clientReturning(MOCK_PNG, calls) });
  await provider.generate(baseContext(fixture));
  assert.equal(calls.length, 1);
  const resumed = await provider.generate(baseContext(fixture));
  assert.equal(calls.length, 1, 'a second call with the same idempotencyKey must not re-invoke OpenRouter');
  assert.equal(resumed.metadata.provider_journal.resumed, true);
  assert.ok(resumed.image.equals(MOCK_PNG));
});

test('a conflicting request under the same idempotencyKey is rejected as a journal conflict', async () => {
  const fixture = await mediaFixture();
  const provider = new OpenRouterImageGenProvider({ client: clientReturning(MOCK_PNG) });
  await provider.generate(baseContext(fixture));
  await assert.rejects(
    () => provider.generate(baseContext(fixture, { prompt: 'A completely different prompt.' })),
    (error) => error instanceof OpenRouterImageGenProviderError && error.code === 'PROVIDER_JOURNAL_CONFLICT',
  );
});

test('rejects non-PNG or malformed output from OpenRouter', async () => {
  const fixture = await mediaFixture();
  const provider = new OpenRouterImageGenProvider({ client: clientReturning(Buffer.from('not a png')) });
  await assert.rejects(
    () => provider.generate(baseContext(fixture)),
    (error) => error instanceof OpenRouterImageGenProviderError && error.code === 'INVALID_PROVIDER_OUTPUT',
  );
});

test('rejects an unsupported generation phase and a model/job_set_type mismatch', async () => {
  const fixture = await mediaFixture();
  const provider = new OpenRouterImageGenProvider({ client: clientReturning(MOCK_PNG) });
  await assert.rejects(
    () => provider.generate(baseContext(fixture, { phase: 'not-a-real-phase' })),
    (error) => error instanceof OpenRouterImageGenProviderError && error.code === 'INVALID_GENERATION_PHASE',
  );
  await assert.rejects(
    () => provider.generate(baseContext(fixture, { model: 'gpt_image_2', job_set_type: 'nano_banana_2' })),
    (error) => error instanceof OpenRouterImageGenProviderError && error.code === 'MODEL_CONTEXT_MISMATCH',
  );
});

test('rejects a route with no configured OpenRouter model', async () => {
  const fixture = await mediaFixture();
  const provider = new OpenRouterImageGenProvider({
    client: clientReturning(MOCK_PNG),
    modelByRoute: { gpt_image_2: 'openai/gpt-5.4-image-2' },
  });
  await assert.rejects(
    () => provider.generate(baseContext(fixture, { model: 'nano_banana_2', job_set_type: 'nano_banana_2' })),
    (error) => error instanceof OpenRouterImageGenProviderError && error.code === 'MODEL_NOT_SUPPORTED_BY_OPENROUTER_IMAGEGEN',
  );
});

test('a transport failure journals FAILED; the same idempotencyKey then refuses a silent duplicate, matching CodexImagegenProvider', async () => {
  const fixture = await mediaFixture();
  const provider = new OpenRouterImageGenProvider({
    client: { generateImage: async () => { throw new Error('network unreachable'); } },
  });
  await assert.rejects(() => provider.generate(baseContext(fixture)), /network unreachable/);

  // Same key after a failure: refuse rather than silently retry an unknown outcome.
  const calls = [];
  const retriedSameKey = new OpenRouterImageGenProvider({ client: clientReturning(MOCK_PNG, calls) });
  await assert.rejects(
    () => retriedSameKey.generate(baseContext(fixture)),
    (error) => error instanceof OpenRouterImageGenProviderError && error.code === 'PRIOR_OUTCOME_UNKNOWN',
  );
  assert.equal(calls.length, 0, 'a refused duplicate must never reach the OpenRouter client');

  // A genuinely new attempt (fresh idempotencyKey) can still complete.
  const newKey = 'b'.repeat(64);
  const result = await retriedSameKey.generate(baseContext(fixture, { idempotencyKey: newKey, jobId: 'job-2' }));
  assert.equal(calls.length, 1);
  assert.ok(result.image.equals(MOCK_PNG));
});

test('qa() never auto-passes and delegates to an explicit evaluator when configured', async () => {
  const fixture = await mediaFixture();
  const withoutEvaluator = new OpenRouterImageGenProvider({ client: clientReturning(MOCK_PNG) });
  const fallback = await withoutEvaluator.qa(baseContext(fixture));
  assert.equal(fallback.decision, 'NEEDS_INPUT');
  assert.equal(fallback.evaluator.type, 'ADAPTER');

  const withEvaluator = new OpenRouterImageGenProvider({
    client: clientReturning(MOCK_PNG),
    qaEvaluator: async () => ({
      decision: 'PASS',
      checks: [{ name: 'IDENTITY', pass: true, score: 0.95, evidence: 'matches' }],
      defects: [],
      reason: 'ok',
      evaluator: {
        type: 'MODEL',
        provider: 'openrouter',
        model: 'openai/gpt-5.6-terra',
        version: 'openai/gpt-5.6-terra',
        evaluation_id: MOCK_SHA256,
      },
    }),
  });
  const decision = await withEvaluator.qa(baseContext(fixture));
  assert.equal(decision.decision, 'PASS');
});
