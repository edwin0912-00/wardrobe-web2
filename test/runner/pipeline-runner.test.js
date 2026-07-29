import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { PipelineRunner } from '../../src/runner/pipeline-runner.js';
import { IMAGE_MODEL_NAMES, IMAGE_MODEL_ROUTE } from '../../src/runner/model-policy.js';
import { STATES } from '../../src/runner/state-machine.js';

async function fixture({ jobOverrides = {}, outfitOverrides = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zeely-runner-'));
  await mkdir(path.join(directory, 'input'));
  await writeFile(path.join(directory, 'input', 'person.jpg'), Buffer.from('identity-source'));
  await writeFile(path.join(directory, 'avatar.txt'), 'avatar={{IDENTITY_REFERENCE}}\n');
  await writeFile(
    path.join(directory, 'outfit.txt'),
    'identity={{ORIGINAL_IDENTITY_REFERENCE}} avatar={{APPROVED_AVATAR_REFERENCE}} outfit={{OUTFIT_TEXT}}\n',
  );
  const job = {
    job_id: 'test-001',
    identity_reference: './input/person.jpg',
    output_directory: './output',
    prompts: { avatar: './avatar.txt', outfit: './outfit.txt' },
    outfit: { mode: 'text', text: 'Structured cream blazer', ...outfitOverrides },
    quality_references: [],
    ...jobOverrides,
  };
  const jobPath = path.join(directory, 'job.json');
  await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`);
  return { directory, jobPath, output: path.join(directory, 'output') };
}

test('runs the complete conditioning -> avatar -> outfit state machine and exports exact filenames', async () => {
  const files = await fixture();
  const before = await readFile(files.jobPath);
  const provider = new MockProvider();
  const runner = new PipelineRunner({ provider });
  const result = await runner.runJobFile(files.jobPath);

  assert.equal(result.status, STATES.COMPLETED);
  assert.equal(result.reused, false);
  assert.deepEqual(await readFile(files.jobPath), before, 'immutable job JSON must not change');
  assert.ok((await readFile(path.join(files.output, 'avatar.png'))).length > 0);
  assert.ok((await readFile(path.join(files.output, 'avatar_outfit.png'))).length > 0);
  const exportedManifest = JSON.parse(await readFile(path.join(files.output, 'run-manifest.json'), 'utf8'));
  const serializedManifest = JSON.stringify(exportedManifest);
  assert.doesNotMatch(serializedManifest, /\/Users\/|\/private\/|\/tmp\/|\.zeely-run|"path"|"text"/iu);
  assert.deepEqual(Object.keys(exportedManifest.prompts.avatar).sort(), ['attempt', 'phase', 'sha256']);
  assert.equal(exportedManifest.outputs.avatar.sha256.length, 64);
  assert.equal(exportedManifest.qa.avatar.decision, 'PASS');
  assert.equal(exportedManifest.qa.avatar.artifact.digest.length, 64);

  const events = (await readFile(result.eventsPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
  const transitions = events
    .filter((event) => event.type === 'STATE_TRANSITION')
    .map((event) => event.data.to);
  assert.deepEqual(transitions, [
    STATES.VALIDATING,
    STATES.CONDITIONING_IDENTITY,
    STATES.CONDITIONING_OUTFIT,
    STATES.CONDITIONING_QA,
    STATES.REFERENCES_READY,
    STATES.GENERATING_AVATAR,
    STATES.AVATAR_QA,
    STATES.AVATAR_READY,
    STATES.GENERATING_OUTFIT,
    STATES.OUTFIT_QA,
    STATES.OUTFIT_READY,
    STATES.EXPORTING,
    STATES.COMPLETED,
  ]);
  const generationRoutes = provider.calls
    .filter((call) => call.operation === 'generate')
    .map((call) => ({
      model: call.context.model,
      model_name: call.context.model_name,
      job_set_type: call.context.job_set_type,
    }));
  assert.deepEqual(generationRoutes, [
    { model: 'gpt_image_2', model_name: 'GPT Image 2', job_set_type: 'gpt_image_2' },
    { model: 'gpt_image_2', model_name: 'GPT Image 2', job_set_type: 'gpt_image_2' },
  ]);
  for (const call of provider.calls.filter((item) => item.operation === 'generate')) {
    assert.equal(call.context.workDirectory, result.workDirectory, 'provider receives its per-run journal root');
  }
});

test('imports a hash-bound PASS avatar receipt and generates only the new outfit', async () => {
  const source = await fixture();
  const sourceProvider = new MockProvider();
  const sourceResult = await new PipelineRunner({ provider: sourceProvider }).runJobFile(source.jobPath);
  const sourceAvatar = await readFile(path.join(source.output, 'avatar.png'));
  const sourceReceipt = await readFile(path.join(source.output, 'run-manifest.json'));

  const target = await fixture({ jobOverrides: { job_id: 'test-new-look' } });
  const importedAvatarPath = path.join(target.directory, 'input', 'approved-avatar.png');
  const importedReceiptPath = path.join(target.directory, 'input', 'approved-avatar-receipt.json');
  await writeFile(importedAvatarPath, sourceAvatar);
  await writeFile(importedReceiptPath, sourceReceipt);
  const targetJob = JSON.parse(await readFile(target.jobPath, 'utf8'));
  targetJob.approved_avatar_reference = {
    path: './input/approved-avatar.png',
    sha256: createHash('sha256').update(sourceAvatar).digest('hex'),
    source_run_id: sourceResult.runId,
    qa_receipt: {
      path: './input/approved-avatar-receipt.json',
      sha256: createHash('sha256').update(sourceReceipt).digest('hex'),
      decision: 'PASS',
    },
  };
  await writeFile(target.jobPath, `${JSON.stringify(targetJob, null, 2)}\n`);

  const provider = new MockProvider();
  const result = await new PipelineRunner({ provider }).runJobFile(target.jobPath);
  assert.equal(result.status, STATES.COMPLETED);
  assert.equal(result.attempts.avatar, 0);
  assert.deepEqual(await readFile(path.join(target.output, 'avatar.png')), sourceAvatar, 'approved avatar bytes must be reused exactly');
  assert.equal(createHash('sha256').update(await readFile(path.join(target.output, 'avatar.png'))).digest('hex'), targetJob.approved_avatar_reference.sha256);
  assert.deepEqual(provider.calls.filter((call) => call.operation === 'generate').map((call) => call.context.phase), ['outfit']);
  assert.equal(provider.calls.some((call) => call.operation === 'qa' && call.context.phase === 'avatar'), false);
  const manifest = JSON.parse(await readFile(path.join(target.output, 'run-manifest.json'), 'utf8'));
  assert.equal(manifest.qa.avatar.decision, 'PASS');
  assert.equal(manifest.qa.avatar.reused, true);
  assert.equal(manifest.models.avatar.source_run_id, sourceResult.runId);
  assert.equal(manifest.outputs.avatar.sha256, targetJob.approved_avatar_reference.sha256);
  const events = (await readFile(result.eventsPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(events.some((event) => event.type === 'APPROVED_AVATAR_IMPORTED'));
  assert.equal(events.some((event) => event.type === 'PROVIDER_CALL_STARTED' && event.data.phase === 'avatar'), false);
});

test('rejects approved avatar reuse when the declared avatar hash is not exact', async () => {
  const source = await fixture();
  const sourceResult = await new PipelineRunner({ provider: new MockProvider() }).runJobFile(source.jobPath);
  const avatar = await readFile(path.join(source.output, 'avatar.png'));
  const receipt = await readFile(path.join(source.output, 'run-manifest.json'));
  const target = await fixture({ jobOverrides: {
    job_id: 'test-bad-approved-avatar',
    approved_avatar_reference: {
      path: path.join(source.output, 'avatar.png'),
      sha256: '0'.repeat(64),
      source_run_id: sourceResult.runId,
      qa_receipt: {
        path: path.join(source.output, 'run-manifest.json'),
        sha256: createHash('sha256').update(receipt).digest('hex'),
        decision: 'PASS',
      },
    },
  } });
  assert.ok(avatar.length > 0);
  const provider = new MockProvider();
  const result = await new PipelineRunner({ provider }).runJobFile(target.jobPath);
  assert.equal(result.status, STATES.FAILED);
  assert.equal(provider.calls.some((call) => call.operation === 'generate' && call.context.phase === 'avatar'), false);
});

test('is idempotent after completion and does not call the provider again', async () => {
  const files = await fixture();
  const provider = new MockProvider();
  const runner = new PipelineRunner({ provider });
  const first = await runner.runJobFile(files.jobPath);
  const callsAfterFirstRun = provider.calls.length;
  const second = await runner.runJobFile(files.jobPath);

  assert.equal(first.status, STATES.COMPLETED);
  assert.equal(second.status, STATES.COMPLETED);
  assert.equal(second.reused, true);
  assert.equal(provider.calls.length, callsAfterFirstRun);
});

test('refuses to reuse receipts when an input file changes under the same immutable job JSON', async () => {
  const files = await fixture();
  const provider = new MockProvider();
  const runner = new PipelineRunner({ provider });
  await runner.runJobFile(files.jobPath);
  await writeFile(path.join(files.directory, 'input', 'person.jpg'), Buffer.from('changed-identity-source'));
  await assert.rejects(
    () => runner.runJobFile(files.jobPath),
    /referenced input or prompt changed/,
  );
});

test('uses the fixed GPT Image 2 -> Nano Banana 2 -> Nano Banana Pro route after QA retries', async () => {
  const files = await fixture();
  const provider = new MockProvider({
    script: {
      qa(context) {
        if (context.phase === 'avatar' && context.attempt < 3) {
          return { decision: 'RETRY', defects: [`avatar-attempt-${context.attempt}`] };
        }
        return { decision: 'PASS', checks: [], defects: [] };
      },
    },
  });
  const result = await new PipelineRunner({ provider }).runJobFile(files.jobPath);
  assert.equal(result.status, STATES.COMPLETED);
  assert.equal(result.attempts.avatar, 3);
  const avatarJobSetTypes = provider.calls
    .filter((call) => call.operation === 'generate' && call.context.phase === 'avatar')
    .map((call) => call.context.job_set_type);
  assert.deepEqual(avatarJobSetTypes, IMAGE_MODEL_ROUTE);
  assert.deepEqual(
    provider.calls
      .filter((call) => call.operation === 'generate' && call.context.phase === 'avatar')
      .map((call) => call.context.model_name),
    IMAGE_MODEL_ROUTE.map((jobSetType) => IMAGE_MODEL_NAMES[jobSetType]),
  );
});

test('stops after the bounded model route is exhausted', async () => {
  const files = await fixture();
  const provider = new MockProvider({
    script: {
      qa(context) {
        if (context.phase === 'avatar') return { decision: 'RETRY', defects: ['identity drift'] };
        return { decision: 'PASS', checks: [], defects: [] };
      },
    },
  });
  const result = await new PipelineRunner({ provider }).runJobFile(files.jobPath);
  assert.equal(result.status, STATES.FAILED);
  assert.equal(result.attempts.avatar, 3);
  const avatarJobSetTypes = provider.calls
    .filter((call) => call.operation === 'generate' && call.context.phase === 'avatar')
    .map((call) => call.context.job_set_type);
  assert.deepEqual(avatarJobSetTypes, IMAGE_MODEL_ROUTE);
});

test('routes unusable conditioned references to NEEDS_INPUT before generation', async () => {
  const files = await fixture();
  const provider = new MockProvider({
    script: {
      qa(context) {
        if (context.phase === 'conditioning') {
          return { decision: 'NEEDS_INPUT', reason: 'face too occluded', defects: ['identity evidence missing'] };
        }
        return { decision: 'PASS', checks: [], defects: [] };
      },
    },
  });
  const result = await new PipelineRunner({ provider }).runJobFile(files.jobPath);
  assert.equal(result.status, STATES.NEEDS_INPUT);
  assert.equal(provider.calls.filter((call) => call.operation === 'generate').length, 0);
});

test('reconditions references after a retryable conditioning failure and remains bounded', async () => {
  const files = await fixture();
  const provider = new MockProvider({
    script: {
      condition(context) {
        if (context.role === 'identity' && context.attempt === 1) {
          const error = new Error('temporary conditioning failure');
          error.retryable = true;
          throw error;
        }
        if (context.source.path) {
          return {
            reference: { path: context.source.path },
            extension: context.source.extension,
            mediaType: context.source.mediaType,
            facts: { conditioned: true },
          };
        }
        return { facts: { conditioned: true, text: context.source.text } };
      },
    },
  });
  const result = await new PipelineRunner({ provider }).runJobFile(files.jobPath);
  assert.equal(result.status, STATES.COMPLETED);
  assert.equal(result.attempts.conditioning, 2);
});

test('rejects any job model route that differs from an approved route order', async () => {
  const files = await fixture({
    jobOverrides: { model_route: ['nano_banana_2', 'gpt_image_2', 'nano_banana_flash'] },
  });
  await assert.rejects(
    () => new PipelineRunner({ provider: new MockProvider() }).runJobFile(files.jobPath),
    /must exactly match an approved Zeely model route prefix/,
  );
});
