import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { sha256Object } from '../../src/conditioning/hash-lineage.mjs';
import {
  createCoreQaReceipt,
  qaResultFromReceipt,
  verifyCoreQaReceipt,
} from '../../src/runner/core-qa-receipt.js';

const digest = (character) => character.repeat(64);

const schema = JSON.parse(await readFile(
  path.resolve('schemas/core-semantic-qa-receipt.schema.json'),
  'utf8',
));
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile(schema);

function evidence() {
  return {
    phase: 'outfit',
    attempt: 2,
    job_hash: digest('1'),
    execution_hash: digest('2'),
    subject: {
      kind: 'OUTFIT_CANDIDATE',
      sha256: digest('3'),
      media_type: 'image/png',
    },
    prompt_sha256: digest('4'),
    bindings: [
      {
        order: 1,
        binding_id: 'approved-avatar',
        role: 'APPROVED_AVATAR',
        sha256: digest('5'),
        prepared_sha256: digest('6'),
      },
      {
        order: 2,
        binding_id: 'set-0',
        role: 'GARMENT_TOP',
        sha256: digest('7'),
        reference_pack_sha256: digest('8'),
        facts_sha256: digest('9'),
        prepared_sha256: digest('a'),
      },
    ],
  };
}

function response() {
  return {
    decision: 'PASS',
    reason: 'Every required identity and item-fidelity check passed.',
    checks: [
      {
        name: 'IDENTITY',
        pass: true,
        score: 0.98,
        evidence: 'Face, hair, and visible proportions match the approved avatar.',
      },
      {
        name: 'ITEM_FIDELITY:set-0',
        pass: true,
        score: 0.97,
        evidence: 'Type, green color, construction, and visible logo match binding set-0.',
      },
    ],
    defects: [],
    evaluator: {
      type: 'MODEL',
      provider: 'openai-codex-cli',
      model: 'gpt-5.6-terra',
      version: '2026-07-23',
      evaluation_id: digest('b'),
    },
  };
}

function receipt(input = {}) {
  return createCoreQaReceipt({
    phase: 'outfit',
    attempt: 2,
    jobId: 'web-contract-run',
    runId: 'contract-run',
    evidence: evidence(),
    response: response(),
    ...input,
  });
}

test('runner creates a deterministic strict receipt and preserves ordered item bindings', () => {
  const created = receipt();
  const repeated = receipt();

  assert.deepEqual(created.authority, {
    owner: 'RUNNER',
    component: 'PIPELINE_RUNNER',
    version: '1.0.0',
  });
  assert.deepEqual(created.evidence.bindings, evidence().bindings);
  assert.deepEqual(created.checks.map((check) => check.required), [true, true]);
  assert.equal(created.receipt_id, repeated.receipt_id);
  const unsigned = structuredClone(created);
  delete unsigned.receipt_id;
  assert.equal(created.receipt_id, sha256Object(unsigned));
  assert.equal(validate(created), true, JSON.stringify(validate.errors, null, 2));

  assert.deepEqual(verifyCoreQaReceipt(created, {
    phase: 'outfit',
    attempt: 2,
    jobId: 'web-contract-run',
    runId: 'contract-run',
    evidence: evidence(),
    receiptId: created.receipt_id,
    requirePass: true,
  }), created);

  const artifact = { digest: digest('c'), mediaType: 'application/json' };
  assert.deepEqual(qaResultFromReceipt(created, artifact), {
    decision: 'PASS',
    reason: created.reason,
    checks: created.checks,
    defects: [],
    evaluator: created.evaluator,
    subject_sha256: digest('3'),
    evidence_manifest_sha256: created.evidence.manifest_sha256,
    prompt_sha256: digest('4'),
    receipt_id: created.receipt_id,
    artifact,
  });
});

test('PASS requires nonempty runner-required checks, every check passing, and zero defects', () => {
  for (const [label, mutate, pattern] of [
    ['empty checks', (value) => { value.checks = []; }, /at least one required/i],
    ['failed check', (value) => { value.checks[0].pass = false; }, /failed required check/i],
    ['blocking defect', (value) => { value.defects = ['Old clothing residue']; }, /blocking defects/i],
    ['duplicate check', (value) => { value.checks.push(structuredClone(value.checks[0])); }, /duplicate check/i],
    ['provider-owned required flag', (value) => { value.checks[0].required = true; }, /unexpected property required/i],
    ['provider-owned receipt metadata', (value) => { value.receipt_id = digest('f'); }, /unexpected property receipt_id/i],
  ]) {
    const candidate = response();
    mutate(candidate);
    assert.throws(() => receipt({ response: candidate }), pattern, label);
  }

  const retry = response();
  retry.decision = 'RETRY';
  retry.reason = 'Generated candidate needs another bounded attempt.';
  retry.checks[1].pass = false;
  retry.defects = ['Garment construction mismatch'];
  const retryReceipt = receipt({ response: retry });
  assert.equal(retryReceipt.decision, 'RETRY');
  assert.equal(retryReceipt.checks[1].required, true);
  assert.equal(validate(retryReceipt), true, JSON.stringify(validate.errors, null, 2));

  const invalidSchemaPass = structuredClone(receipt());
  invalidSchemaPass.checks[0].pass = false;
  assert.equal(validate(invalidSchemaPass), false, 'schema must independently reject a dishonest PASS');
  const invalidSchemaDefect = structuredClone(receipt());
  invalidSchemaDefect.defects.push('blocking defect');
  assert.equal(validate(invalidSchemaDefect), false, 'schema must reject PASS with defects');
});

test('evaluator metadata is exact, fully attested, and contains no moving aliases', () => {
  for (const [field, value] of [
    ['provider', 'latest'],
    ['provider', 'vendor-current'],
    ['model', 'unknown-model'],
    ['model', 'gpt-unattested'],
    ['version', 'current'],
    ['version', ' builtin-current '],
    ['version', ''],
  ]) {
    const candidate = response();
    candidate.evaluator[field] = value;
    assert.throws(
      () => receipt({ response: candidate }),
      /exact attested value|exact non-empty string/i,
      `${field}=${JSON.stringify(value)}`,
    );
    const schemaCandidate = structuredClone(receipt());
    schemaCandidate.evaluator[field] = value;
    assert.equal(
      validate(schemaCandidate),
      false,
      `schema must reject ${field}=${JSON.stringify(value)}`,
    );
  }

  const badType = response();
  badType.evaluator.type = 'AGENT';
  assert.throws(() => receipt({ response: badType }), /evaluator type is invalid/i);
  const badId = response();
  badId.evaluator.evaluation_id = digest('B');
  assert.throws(() => receipt({ response: badId }), /lowercase SHA-256/i);
  const extraMetadata = response();
  extraMetadata.evaluator.endpoint = 'internal';
  assert.throws(() => receipt({ response: extraMetadata }), /unexpected property endpoint/i);

});

test('evidence bindings are closed, contiguous, uniquely identified, and hash exact', () => {
  for (const [label, mutate, pattern] of [
    [
      'noncontiguous order',
      (value) => { value.bindings[1].order = 3; },
      /contiguous from 1/i,
    ],
    [
      'duplicate binding id',
      (value) => { value.bindings[1].binding_id = value.bindings[0].binding_id; },
      /repeats binding_id/i,
    ],
    [
      'unknown binding field',
      (value) => { value.bindings[0].path = '/private/candidate.png'; },
      /unexpected property path/i,
    ],
    [
      'invalid facts digest',
      (value) => { value.bindings[1].facts_sha256 = 'not-a-digest'; },
      /facts_sha256 must be a lowercase SHA-256/i,
    ],
  ]) {
    const candidate = evidence();
    mutate(candidate);
    assert.throws(() => receipt({ evidence: candidate }), pattern, label);
  }

  const schemaExtra = receipt();
  schemaExtra.evidence.bindings[0].path = '/private/candidate.png';
  assert.equal(validate(schemaExtra), false, 'schema must close every binding object');
});

test('subject, evidence, authority, and receipt mutations fail closed', () => {
  const original = receipt();

  const subjectMutation = structuredClone(original);
  subjectMutation.subject = {
    ...subjectMutation.subject,
    sha256: digest('d'),
  };
  assert.throws(
    () => verifyCoreQaReceipt(subjectMutation),
    /integrity check failed/i,
  );

  const evidenceMutation = structuredClone(original);
  evidenceMutation.evidence.bindings[1].sha256 = digest('e');
  assert.throws(
    () => verifyCoreQaReceipt(evidenceMutation),
    /manifest SHA-256 does not match/i,
  );

  const receiptMutation = structuredClone(original);
  receiptMutation.reason = 'Receipt text changed after approval.';
  assert.throws(
    () => verifyCoreQaReceipt(receiptMutation),
    /integrity check failed/i,
  );
  assert.throws(
    () => qaResultFromReceipt(receiptMutation, null),
    /integrity check failed/i,
  );

  const authorityMutation = structuredClone(original);
  authorityMutation.authority.owner = 'EVALUATOR';
  assert.throws(
    () => verifyCoreQaReceipt(authorityMutation),
    /owned by the pipeline runner/i,
  );

  const extraField = structuredClone(original);
  extraField.provider_receipt = { trusted: true };
  assert.throws(
    () => verifyCoreQaReceipt(extraField),
    /unexpected property provider_receipt/i,
  );

  const currentEvidence = evidence();
  currentEvidence.subject.sha256 = digest('f');
  assert.throws(
    () => verifyCoreQaReceipt(original, { evidence: currentEvidence }),
    /stale for the current evidence/i,
  );

  const rehashedMutation = structuredClone(original);
  rehashedMutation.reason = 'Mutated and recomputed receipt.';
  delete rehashedMutation.receipt_id;
  rehashedMutation.receipt_id = sha256Object(rehashedMutation);
  assert.throws(
    () => verifyCoreQaReceipt(rehashedMutation, { receiptId: original.receipt_id }),
    /immutable receipt binding/i,
    'an expected receipt id must reject even a self-consistent replacement receipt',
  );
});
