import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { CodexVlmEvaluator } from '../../src/providers/codex-vlm-evaluator.js';

async function imageFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-codex-test-'));
  const filename = path.join(root, 'image.png');
  await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ffffff' } }).png().toFile(filename);
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

test('Codex evaluator returns a strict garment passport and blocks low-confidence READY', async () => {
  const filename = await imageFixture();
  const valid = { status: 'READY', reason: 'visible item', items: [{ source_index: 0, category: 'top', confidence: 0.94,
    observed: { garment_type: 'green hoodie', colors: ['green'], material: ['fleece'], pattern: [], logo_text: [], construction: ['hood'] }, unknowns: [], blockers: [] }],
  reference_sets: [{ source_indexes: [0], primary_source_index: 0, same_item_confidence: 1, evidence: ['one clear view'] }] };
  const evaluator = new CodexVlmEvaluator({ commandRunner: runnerFor(valid, []) });
  assert.equal((await evaluator.inspectGarments([filename])).items[0].category, 'top');
  const invalid = structuredClone(valid); invalid.items[0].confidence = 0.4;
  const low = new CodexVlmEvaluator({ commandRunner: runnerFor(invalid, []) });
  await assert.rejects(() => low.inspectGarments([filename]), /Low-confidence/);
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
  await assert.rejects(() => new CodexVlmEvaluator({ commandRunner: runnerFor(lowConfidence, []) }).inspectGarments([first, second]), /below 0.90/);

  const missingIndex = structuredClone(valid);
  missingIndex.reference_sets[0].source_indexes = [0];
  missingIndex.reference_sets[0].primary_source_index = 0;
  await assert.rejects(() => new CodexVlmEvaluator({ commandRunner: runnerFor(missingIndex, []) }).inspectGarments([first, second]), /cover every source index/);
});

test('Codex evaluator fails closed when the CLI cannot produce evidence', async () => {
  const filename = await imageFixture();
  const evaluator = new CodexVlmEvaluator({ commandRunner: async () => { throw new Error('not authenticated'); } });
  const result = await evaluator.evaluateQa({ phase: 'avatar', evidence: { candidate: { artifact: { path: filename } } } });
  assert.equal(result.decision, 'NEEDS_INPUT');
  assert.match(result.reason, /not authenticated/);
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
