import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { OpenRouterVlmEvaluator } from '../../src/providers/openrouter-vlm-evaluator.js';

async function imageFixture(background = '#ffffff', basename = 'image.png') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-openrouter-test-'));
  const filename = path.join(root, basename);
  await sharp({ create: { width: 300, height: 400, channels: 3, background } }).png().toFile(filename);
  return filename;
}

function clientFor(payload, calls) {
  return {
    completeWithSchema: async (options) => {
      calls.push(options);
      return JSON.stringify(payload);
    },
  };
}

test('OpenRouter evaluator sends low-effort structured-schema requests and returns provider QA', async () => {
  const filename = await imageFixture();
  const calls = [];
  const evaluator = new OpenRouterVlmEvaluator({ client: clientFor({
    decision: 'PASS', reason: 'all visible locks match',
    checks: [{ name: 'IDENTITY', pass: true, score: 0.95, evidence: 'same face and hair' }], defects: [],
  }, calls) });
  const result = await evaluator.evaluateQa({ phase: 'avatar', evidence: { identity: { artifact: { path: filename } }, candidate: { artifact: { path: filename } } } });
  assert.equal(result.decision, 'PASS');
  assert.deepEqual(result.evaluator, {
    type: 'MODEL',
    provider: 'openrouter',
    model: 'openai/gpt-5.6-terra',
    version: 'openai/gpt-5.6-terra',
    evaluation_id: result.evaluator.evaluation_id,
  });
  assert.match(result.evaluator.evaluation_id, /^[a-f0-9]{64}$/);
  assert.equal(result.prepared_evidence.length, 1);
  assert.deepEqual(result.prepared_evidence[0].roles, ['IDENTITY_REFERENCE', 'GENERATED_CANDIDATE']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'openai/gpt-5.6-terra');
  assert.equal(calls[0].schemaName, 'codex_vlm_qa');
  assert.equal(calls[0].reasoningEffort, 'low');
  assert.equal(calls[0].imagePaths.length, 1, 'identical QA evidence must be deduplicated');
  assert.equal(calls[0].schema.required.length, 4);
});

test('OpenRouter evaluator returns a strict structured garment analysis and blocks low-confidence READY', async () => {
  const filename = await imageFixture();
  const valid = { status: 'READY', reason: 'visible item', items: [{ source_index: 0, category: 'top', confidence: 0.94,
    observed: { garment_type: 'green hoodie', colors: ['green'], material: ['fleece'], pattern: [], logo_text: [], construction: ['hood'] }, unknowns: [], blockers: [] }],
  reference_sets: [{ source_indexes: [0], primary_source_index: 0, same_item_confidence: 1, evidence: ['one clear view'] }] };
  const evaluator = new OpenRouterVlmEvaluator({ client: clientFor(valid, []) });
  assert.equal((await evaluator.inspectGarments([filename])).items[0].category, 'top');
  const invalid = structuredClone(valid); invalid.items[0].confidence = 0.4;
  const low = new OpenRouterVlmEvaluator({ client: clientFor(invalid, []) });
  await assert.rejects(() => low.inspectGarments([filename]), /низькою впевненістю/);
});

test('OpenRouter evaluator fails closed when the API cannot produce evidence', async () => {
  const filename = await imageFixture();
  const evaluator = new OpenRouterVlmEvaluator({ client: { completeWithSchema: async () => { throw new Error('OpenRouter request failed: network error'); } } });
  const result = await evaluator.evaluateQa({ phase: 'avatar', evidence: { candidate: { artifact: { path: filename } } } });
  assert.equal(result.decision, 'NEEDS_INPUT');
  assert.match(result.reason, /network error/);
  assert.equal(result.evaluator.type, 'MODEL');
  assert.equal(result.evaluator.provider, 'openrouter');
  assert.match(result.evaluator.evaluation_id, /^[a-f0-9]{64}$/);
});

test('OpenRouter garment QA infrastructure failure is retryable and never claims raw evidence is missing', async () => {
  const filename = await imageFixture();
  const evaluator = new OpenRouterVlmEvaluator({ client: { completeWithSchema: async () => { throw new Error('temporary evaluator outage'); } } });
  const result = await evaluator.evaluateQa({ phase: 'garment', evidence: { candidate: { artifact: { path: filename } } } });
  assert.equal(result.decision, 'RETRY');
  assert.match(result.reason, /temporary evaluator outage/);
  assert.equal(result.evaluator.version, 'openai/gpt-5.6-terra');
});

test('OpenRouter evaluator rejects floating/ambiguous OpenRouter model aliases before executing QA', () => {
  assert.throws(() => new OpenRouterVlmEvaluator({ client: {}, model: 'openrouter/auto' }), /exact non-ambiguous model id/);
  assert.throws(() => new OpenRouterVlmEvaluator({ client: {}, model: 'openrouter/auto-beta' }), /exact non-ambiguous model id/);
  assert.throws(() => new OpenRouterVlmEvaluator({ client: {}, model: '~openai/gpt-latest' }), /exact non-ambiguous model id/);
});

test('OpenRouter garment prompt preserves raw-versus-generated roles and decision semantics', async () => {
  const primary = await imageFixture('#263f72', 'shirt-front.png');
  const candidate = await imageFixture('#8d2231', 'canonical-candidate.png');
  const detail = await imageFixture('#d4d9e2', 'shirt-detail.png');
  const calls = [];
  const evaluator = new OpenRouterVlmEvaluator({ client: clientFor({
    decision: 'RETRY', reason: 'candidate color differs from usable raw evidence',
    checks: [{ name: 'COLOR', pass: false, score: 0.2, evidence: 'candidate is red while raw shirt is blue' }],
    defects: ['wrong candidate color'],
  }, calls) });
  const result = await evaluator.evaluateQa({ phase: 'garment', evidence: {
    identity: { artifact: { path: primary } },
    candidate: { artifact: { path: candidate } },
    reference_packs: { outfit: { bindings: [
      { artifact: { path: primary } },
      { artifact: { path: detail } },
    ] } },
  } });

  assert.equal(result.decision, 'RETRY');
  const prompt = calls[0].prompt;
  assert.match(prompt, /ATTACHMENT_1 \[RAW_GARMENT_PRIMARY\]/);
  assert.match(prompt, /ATTACHMENT_2 \[GENERATED_CANONICAL_CANDIDATE\]/);
  assert.match(prompt, /ATTACHMENT_3 \[RAW_GARMENT_VIEW_2\]/);
  assert.doesNotMatch(prompt, /shirt-front|canonical-candidate|shirt-detail|\/Users\/|\/tmp\/|\bzeely\b/i);
  assert.equal(calls[0].imagePaths.length, 3, 'duplicate primary binding must be removed without erasing image roles');
});

test('OpenRouter QA schema requests carry every required top-level field for OpenAI-style strict mode', async () => {
  const filename = await imageFixture();
  const calls = [];
  const evaluator = new OpenRouterVlmEvaluator({ client: clientFor({
    decision: 'PASS', reason: 'ok', checks: [{ name: 'X', pass: true, score: 1, evidence: 'e' }], defects: [],
  }, calls) });
  await evaluator.evaluateQa({ phase: 'avatar', evidence: { candidate: { artifact: { path: filename } } } });
  const { schema } = calls[0];
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
});
