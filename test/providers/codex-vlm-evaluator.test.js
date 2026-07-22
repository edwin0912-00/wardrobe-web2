import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { CodexVlmEvaluator } from '../../src/providers/codex-vlm-evaluator.js';

async function imageFixture(background = '#ffffff', basename = 'image.png') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-codex-test-'));
  const filename = path.join(root, basename);
  await sharp({ create: { width: 300, height: 400, channels: 3, background } }).png().toFile(filename);
  return filename;
}

function runnerFor(payload, calls) {
  return async (binary, args, options) => {
    calls.push({ binary, args, options });
    const outputIndex = args.indexOf('--output-last-message');
    await writeFile(args[outputIndex + 1], JSON.stringify(payload));
    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

test('Codex evaluator uses ephemeral read-only strict-schema execution and returns provider QA', async () => {
  const filename = await imageFixture();
  const calls = [];
  const evaluator = new CodexVlmEvaluator({ commandRunner: runnerFor({
    decision: 'PASS', reason: 'all visible locks match',
    checks: [{ name: 'IDENTITY', pass: true, score: 0.95, evidence: 'same face and hair' }], defects: [],
  }, calls) });
  const result = await evaluator.evaluateQa({ phase: 'avatar', evidence: { identity: { artifact: { path: filename } }, candidate: { artifact: { path: filename } } } });
  assert.equal(result.decision, 'PASS');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('--ephemeral'));
  assert.ok(calls[0].args.includes('read-only'));
  assert.ok(calls[0].args.includes('--output-schema'));
  assert.ok(calls[0].args.includes('--image'));
  assert.equal(calls[0].args.filter((value) => value === '--image').length, 1, 'identical QA evidence must be deduplicated');
  assert.ok(calls[0].args.includes('model_reasoning_effort="low"'));
  assert.ok(calls[0].args.indexOf('--image') > 1, 'positional prompt must precede variadic image arguments');
  assert.equal(calls[0].options.timeoutMs, 60_000);
});

test('Codex evaluator returns a strict structured garment analysis and blocks low-confidence READY', async () => {
  const filename = await imageFixture();
  const valid = { status: 'READY', reason: 'visible item', items: [{ source_index: 0, category: 'top', confidence: 0.94,
    observed: { garment_type: 'green hoodie', colors: ['green'], material: ['fleece'], pattern: [], logo_text: [], construction: ['hood'] }, unknowns: [], blockers: [] }],
  reference_sets: [{ source_indexes: [0], primary_source_index: 0, same_item_confidence: 1, evidence: ['one clear view'] }] };
  const evaluator = new CodexVlmEvaluator({ commandRunner: runnerFor(valid, []) });
  assert.equal((await evaluator.inspectGarments([filename])).items[0].category, 'top');
  const invalid = structuredClone(valid); invalid.items[0].confidence = 0.4;
  const low = new CodexVlmEvaluator({ commandRunner: runnerFor(invalid, []) });
  await assert.rejects(() => low.inspectGarments([filename]), /низькою впевненістю/);
});

test('garment reference sets are a strict full partition and multi-view grouping needs high confidence', async () => {
  const first = await imageFixture();
  const second = await imageFixture();
  const items = [0, 1].map((source_index) => ({ source_index, category: 'top', confidence: 0.95,
    observed: { garment_type: 'blue pinstriped shirt', colors: ['blue', 'white'], material: ['woven'], pattern: ['pinstripe'], logo_text: [], construction: ['point collar'] },
    unknowns: [], blockers: [] }));
  const valid = { status: 'READY', reason: 'same exact shirt from two views', items,
    reference_sets: [{ source_indexes: [0, 1], primary_source_index: 1, same_item_confidence: 0.97, evidence: ['same stripe spacing, collar and buttons'] }] };
  assert.equal((await new CodexVlmEvaluator({ commandRunner: runnerFor(valid, []) }).inspectGarments([first, second])).reference_sets[0].source_indexes.length, 2);

  const lowConfidence = structuredClone(valid);
  lowConfidence.reference_sets[0].same_item_confidence = 0.7;
  await assert.rejects(() => new CodexVlmEvaluator({ commandRunner: runnerFor(lowConfidence, []) }).inspectGarments([first, second]), /нижча за 0.90/);

  const missingIndex = structuredClone(valid);
  missingIndex.reference_sets[0].source_indexes = [0];
  missingIndex.reference_sets[0].primary_source_index = 0;
  await assert.rejects(() => new CodexVlmEvaluator({ commandRunner: runnerFor(missingIndex, []) }).inspectGarments([first, second]), /охоплювати кожне вихідне фото/);
});

test('garment response schema stays inside the OpenAI strict-schema subset', async () => {
  const schema = JSON.parse(await readFile(path.resolve('schemas/garment-passport.schema.json'), 'utf8'));
  assert.equal(JSON.stringify(schema).includes('uniqueItems'), false);
});

test('Codex evaluator fails closed when the CLI cannot produce evidence', async () => {
  const filename = await imageFixture();
  const evaluator = new CodexVlmEvaluator({ commandRunner: async () => { throw new Error('not authenticated'); } });
  const result = await evaluator.evaluateQa({ phase: 'avatar', evidence: { candidate: { artifact: { path: filename } } } });
  assert.equal(result.decision, 'NEEDS_INPUT');
  assert.match(result.reason, /not authenticated/);
});

test('garment QA infrastructure failure is retryable and never claims raw evidence is missing', async () => {
  const filename = await imageFixture();
  const evaluator = new CodexVlmEvaluator({ commandRunner: async () => { throw new Error('temporary evaluator outage'); } });
  const result = await evaluator.evaluateQa({ phase: 'garment', evidence: { candidate: { artifact: { path: filename } } } });
  assert.equal(result.decision, 'RETRY');
  assert.match(result.reason, /temporary evaluator outage/);
});

test('garment QA prompt preserves raw-versus-generated roles and decision semantics', async () => {
  const primary = await imageFixture('#263f72', 'shirt-front.png');
  const candidate = await imageFixture('#8d2231', 'canonical-candidate.png');
  const detail = await imageFixture('#d4d9e2', 'shirt-detail.png');
  const calls = [];
  const evaluator = new CodexVlmEvaluator({ commandRunner: runnerFor({
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
  const prompt = calls[0].args[1];
  assert.match(prompt, /ATTACHMENT_1 \[RAW_GARMENT_PRIMARY\]/);
  assert.match(prompt, /ATTACHMENT_2 \[GENERATED_CANONICAL_CANDIDATE\]/);
  assert.match(prompt, /ATTACHMENT_3 \[RAW_GARMENT_VIEW_2\]/);
  assert.doesNotMatch(prompt, /shirt-front|canonical-candidate|shirt-detail|\/Users\/|\/tmp\/|\bzeely\b/i);
  assert.match(prompt, /Use NEEDS_INPUT only when the raw garment photos themselves are insufficient/);
  assert.match(prompt, /Never use NEEDS_INPUT merely because the generated candidate differs from usable raw evidence/);
  assert.equal(calls[0].args.filter((value) => value === '--image').length, 3, 'duplicate primary binding must be removed without erasing image roles');
});

test('outfit QA receives authoritative text and separates it from identity clothing', async () => {
  const filename = await imageFixture();
  const calls = [];
  const evaluator = new CodexVlmEvaluator({ commandRunner: runnerFor({
    decision: 'PASS', reason: 'target outfit is present',
    checks: [{ name: 'OUTFIT', pass: true, score: 0.96, evidence: 'cobalt blazer over white top' }], defects: [],
  }, calls) });
  await evaluator.evaluateQa({ phase: 'outfit', evidence: {
    identity: { artifact: { path: filename } }, candidate: { artifact: { path: filename } },
    outfit: { facts: { text: 'A cobalt-blue blazer over a plain white crew-neck top.' } },
  } });
  assert.match(calls[0].args[1], /AUTHORITATIVE TARGET OUTFIT TEXT/);
  assert.match(calls[0].args[1], /cobalt-blue blazer/);
  assert.match(calls[0].args[1], /identity photos is identity context only/);
});

test('outfit QA redacts incidental local metadata from authoritative user text', async () => {
  const filename = await imageFixture();
  const calls = [];
  const evaluator = new CodexVlmEvaluator({ commandRunner: runnerFor({
    decision: 'PASS', reason: 'target outfit is present',
    checks: [{ name: 'OUTFIT', pass: true, score: 0.96, evidence: 'target outfit matches' }], defects: [],
  }, calls) });
  await evaluator.evaluateQa({ phase: 'outfit', evidence: {
    candidate: { artifact: { path: filename } },
    source_outfit: 'Use /Users/local-user/private/item.png from the Zeely draft',
  } });
  const prompt = calls[0].args[1];
  assert.match(prompt, /ATTACHED_REFERENCE/);
  assert.doesNotMatch(prompt, /\/Users\/|local-user|\bzeely\b/i);
});
