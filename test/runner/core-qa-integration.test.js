import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { verifyCoreQaReceipt } from '../../src/runner/core-qa-receipt.js';
import { PipelineRunner } from '../../src/runner/pipeline-runner.js';
import { STATES } from '../../src/runner/state-machine.js';

const SHA256 = /^[a-f0-9]{64}$/;

async function fixture(jobId = 'core-receipt-integration') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'core-receipt-runner-'));
  await mkdir(path.join(directory, 'input'));
  await writeFile(path.join(directory, 'input', 'person.jpg'), Buffer.from('identity-source'));
  await writeFile(path.join(directory, 'avatar.txt'), 'avatar={{IDENTITY_REFERENCE}}\n');
  await writeFile(
    path.join(directory, 'outfit.txt'),
    'identity={{ORIGINAL_IDENTITY_REFERENCE}} avatar={{APPROVED_AVATAR_REFERENCE}} outfit={{OUTFIT_TEXT}}\n',
  );
  const jobPath = path.join(directory, 'job.json');
  await writeFile(jobPath, `${JSON.stringify({
    job_id: jobId,
    identity_reference: './input/person.jpg',
    output_directory: './output',
    prompts: { avatar: './avatar.txt', outfit: './outfit.txt' },
    outfit: { mode: 'text', text: 'Structured cream blazer' },
    quality_references: [],
  }, null, 2)}\n`);
  return { directory, jobPath, output: path.join(directory, 'output') };
}

async function completedRun(jobId = 'core-receipt-integration') {
  const files = await fixture(jobId);
  const provider = new MockProvider();
  const runner = new PipelineRunner({ provider });
  const result = await runner.runJobFile(files.jobPath);
  assert.equal(result.status, STATES.COMPLETED);
  const checkpoint = JSON.parse(await readFile(result.checkpointPath, 'utf8'));
  return { files, provider, runner, result, checkpoint };
}

test('completed core run exposes three hash-bound runner-owned semantic QA receipts', async () => {
  const { files, provider, result, checkpoint } = await completedRun();
  const manifest = JSON.parse(await readFile(path.join(files.output, 'run-manifest.json'), 'utf8'));

  for (const phase of ['conditioning', 'avatar', 'outfit']) {
    const projected = manifest.qa[phase];
    const stored = checkpoint.qa[phase];
    assert.match(projected.receipt_id, SHA256);
    assert.match(projected.subject_sha256, SHA256);
    assert.match(projected.evidence_manifest_sha256, SHA256);
    assert.match(projected.evaluator.evaluation_id, SHA256);
    assert.equal(projected.decision, 'PASS');
    assert.equal(projected.receipt_id, stored.receipt_id);
    assert.equal(projected.artifact.digest, stored.artifact.digest);
    const receipt = JSON.parse(await readFile(stored.artifact.path, 'utf8'));
    assert.equal(verifyCoreQaReceipt(receipt, {
      phase,
      attempt: checkpoint.attempts[phase],
      jobId: checkpoint.job_id,
      runId: checkpoint.run_id,
      receiptId: stored.receipt_id,
      requirePass: true,
    }).receipt_id, stored.receipt_id);
  }

  assert.equal(manifest.qa.avatar.subject_sha256, manifest.outputs.avatar.sha256);
  assert.equal(manifest.qa.outfit.subject_sha256, manifest.outputs.avatar_outfit.sha256);
  assert.equal(checkpoint.artifacts.run_manifest.digest.length, 64);
  for (const call of provider.calls.filter((entry) => entry.operation === 'qa')) {
    assert.match(call.context.evidence_manifest_sha256, SHA256);
    assert.match(call.context.idempotencyKey, SHA256);
  }
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /\/Users\/|\/private\/|\/tmp\/|"path"|"text"/iu,
  );
  assert.equal(result.reused, false);
});

test('completed replay fails closed when a semantic QA artifact is mutated', async () => {
  const { runner, files, checkpoint } = await completedRun('core-mutated-qa');
  const avatarReceiptPath = checkpoint.qa.avatar.artifact.path;
  const receipt = JSON.parse(await readFile(avatarReceiptPath, 'utf8'));
  receipt.reason = 'mutated after approval';
  await writeFile(avatarReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  await assert.rejects(
    () => runner.runJobFile(files.jobPath),
    /artifact failed integrity verification|receipt integrity/i,
  );
});

test('completed replay rejects a QA receipt swapped between pipeline phases', async () => {
  const { runner, files, checkpoint, result } = await completedRun('core-swapped-qa');
  checkpoint.qa.avatar = structuredClone(checkpoint.qa.outfit);
  await writeFile(result.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);

  await assert.rejects(
    () => runner.runJobFile(files.jobPath),
    /phase mismatch|binding count is stale|bindings are stale|stale for the current run/i,
  );
});

test('completed replay rejects a mutated candidate blob before serving outputs', async () => {
  const { runner, files, checkpoint } = await completedRun('core-mutated-candidate');
  await writeFile(checkpoint.artifacts.avatar.artifact.path, Buffer.from('not-the-approved-png'));

  await assert.rejects(
    () => runner.runJobFile(files.jobPath),
    /artifact failed integrity verification|bytes no longer match/i,
  );
});

test('completed replay rejects a mutated public-manifest artifact', async () => {
  const { runner, files, checkpoint } = await completedRun('core-mutated-manifest');
  const manifestPath = checkpoint.artifacts.run_manifest.path;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.qa.avatar.receipt_id = '0'.repeat(64);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(
    () => runner.runJobFile(files.jobPath),
    /artifact failed integrity verification|public manifest is stale/i,
  );
});

test('a provider cannot complete core QA with an unattested bare PASS', async () => {
  const files = await fixture('core-bare-pass');
  const delegate = new MockProvider();
  const provider = {
    condition: delegate.condition.bind(delegate),
    generate: delegate.generate.bind(delegate),
    async qa() {
      return {
        decision: 'PASS',
        reason: 'looks good',
        checks: [{ name: 'VISUAL', pass: true, score: 1, evidence: 'fixture claim' }],
        defects: [],
      };
    },
  };
  const result = await new PipelineRunner({ provider }).runJobFile(files.jobPath);
  assert.equal(result.status, STATES.FAILED);
  assert.equal(delegate.calls.some((call) => call.operation === 'generate'), false);
});

test('MODEL PASS cannot omit any runner-bound visual evidence', async () => {
  const files = await fixture('core-model-omits-evidence');
  const delegate = new MockProvider();
  const provider = {
    condition: delegate.condition.bind(delegate),
    generate: delegate.generate.bind(delegate),
    async qa(context) {
      return {
        decision: 'PASS',
        reason: 'model claims a pass without attaching the evidence',
        checks: [{ name: 'VISUAL', pass: true, score: 1, evidence: 'unbound claim' }],
        defects: [],
        prepared_evidence: [],
        evaluator: {
          type: 'MODEL',
          provider: 'test-model-provider',
          model: 'test-vision-model-1',
          version: '1.0.0',
          evaluation_id: context.idempotencyKey,
        },
      };
    },
  };
  const result = await new PipelineRunner({ provider }).runJobFile(files.jobPath);
  assert.equal(result.status, STATES.FAILED);
  assert.equal(delegate.calls.some((call) => call.operation === 'generate'), false);
});
