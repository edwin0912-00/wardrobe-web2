import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { createVideoSemanticQaEvaluator } from '../../src/web/video-semantic-qa.js';
import { REQUIRED_REFERENCE_CHECKS } from '../../src/web/video-service.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('pixel-identical source-video copy is automatically rejected without waiting for manual QA', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-semantic-qa-'));
  try {
    const clipDir = path.join(root, 'clip');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(clipDir, { recursive: true }));
    const sourceBytes = Buffer.from('approved-look');
    const referenceBytes = Buffer.from('reference-video');
    const sourcePath = path.join(clipDir, 'source.png');
    const referencePath = path.join(clipDir, 'style-reference.mp4');
    const videoPath = path.join(clipDir, 'clip.mp4');
    await Promise.all([
      writeFile(sourcePath, sourceBytes),
      writeFile(referencePath, referenceBytes),
      writeFile(videoPath, Buffer.from('provider-output')),
    ]);
    let modelCalls = 0;
    const evaluate = createVideoSemanticQaEvaluator({
      evaluator: { async evaluateQa() { modelCalls += 1; throw new Error('must not call model'); } },
      fashionVideoReferenceResolver: async () => ({
        state: 'READY', reference_sha256: sha256(referenceBytes),
        cut_sheet: { cuts: [{ cut_index: 0, start_ms: 0, end_ms: 1_000 }] },
      }),
      commandRunner: async (binary, args) => {
        assert.equal(binary, 'ffmpeg');
        await writeFile(args.at(-1), Buffer.from('same-frame'));
      },
    });
    const receipts = await evaluate({
      clipId: 'clip-id', jobId: 'job-id', mode: 'mode', status: 'NEEDS_QA',
      sourceSha256: sha256(sourceBytes), videoPath, videoSha256: 'a'.repeat(64),
      motionReferenceBinding: {
        referenceId: 'style', sha256: sha256(referenceBytes), audioSourceFile: 'style-reference.mp4',
      },
    });
    assert.equal(receipts.exactReferenceCopy, true);
    assert.equal(receipts.identityReceipt.results.first.decision, 'RETRY');
    assert.equal(receipts.referenceReceipt.cut_coverage.cuts[0].visible_people, 'REFERENCE_PERFORMER');
    assert.equal(modelCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('non-identical output runs the model contract and emits complete PASS receipts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-semantic-model-'));
  try {
    const clipDir = path.join(root, 'clip');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(clipDir, { recursive: true }));
    const sourceBytes = Buffer.from('approved-look');
    const referenceBytes = Buffer.from('reference-video');
    const sourcePath = path.join(clipDir, 'source.png');
    const referencePath = path.join(clipDir, 'style-reference.mp4');
    const videoPath = path.join(clipDir, 'clip.mp4');
    await Promise.all([
      writeFile(sourcePath, sourceBytes),
      writeFile(referencePath, referenceBytes),
      writeFile(videoPath, Buffer.from('provider-output')),
    ]);
    const evaluate = createVideoSemanticQaEvaluator({
      evaluator: {
        async evaluateQa(context) {
          assert.match(
            context.evidence.outfit.facts.text,
            /(?:cut_coverage_complete|CUT_0_APPROVED_AVATAR_ONLY)/,
          );
          return {
            evaluator: { type: 'MODEL', provider: 'test', model: 'fixed', version: 'fixed', evaluation_id: 'e'.repeat(64) },
            checks: [
              ...REQUIRED_REFERENCE_CHECKS,
              'CUT_0_APPROVED_AVATAR_ONLY',
              'CUT_0_REFERENCE_PERFORMER_ABSENT',
            ].map((name) => ({ name, pass: true, score: 1, evidence: 'visible proof' })),
          };
        },
      },
      fashionVideoReferenceResolver: async () => ({
        state: 'READY', reference_sha256: sha256(referenceBytes),
        cut_sheet: { cuts: [{ cut_index: 0, start_ms: 0, end_ms: 1_000 }] },
      }),
      commandRunner: async (binary, args) => {
        const input = args[args.indexOf('-i') + 1];
        await sharp({
          create: {
            width: 32, height: 48, channels: 3,
            background: path.basename(input) === 'clip.mp4' ? '#336699' : '#993366',
          },
        }).jpeg().toFile(args.at(-1));
      },
    });
    const receipts = await evaluate({
      clipId: 'clip-id', jobId: 'job-id', mode: 'mode', status: 'NEEDS_QA',
      sourceSha256: sha256(sourceBytes), videoPath, videoSha256: 'a'.repeat(64),
      motionReferenceBinding: {
        referenceId: 'style', sha256: sha256(referenceBytes), audioSourceFile: 'style-reference.mp4',
      },
    });
    assert.equal(receipts.exactReferenceCopy, false);
    assert.equal(receipts.identityReceipt.results.first.decision, 'PASS');
    assert.ok(receipts.referenceReceipt.checks.every((check) => check.decision === 'PASS'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('output sampling scales the reference cut sheet to the measured delivery duration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-semantic-duration-'));
  try {
    const clipDir = path.join(root, 'clip');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(clipDir, { recursive: true }));
    const sourceBytes = Buffer.from('approved-look');
    const referenceBytes = Buffer.from('reference-video');
    const sourcePath = path.join(clipDir, 'source.png');
    const referencePath = path.join(clipDir, 'style-reference.mp4');
    const videoPath = path.join(clipDir, 'clip.mp4');
    await Promise.all([
      writeFile(sourcePath, sourceBytes),
      writeFile(referencePath, referenceBytes),
      writeFile(videoPath, Buffer.from('provider-output')),
    ]);
    const samples = [];
    const evaluate = createVideoSemanticQaEvaluator({
      evaluator: { async evaluateQa() { throw new Error('identical fixture must be deterministic'); } },
      fashionVideoReferenceResolver: async () => ({
        state: 'READY', reference_sha256: sha256(referenceBytes),
        cut_sheet: { cuts: [
          { cut_index: 0, start_ms: 0, end_ms: 13_040 },
          { cut_index: 1, start_ms: 13_040, end_ms: 13_240 },
        ] },
      }),
      commandRunner: async (binary, args) => {
        samples.push({
          input: path.basename(args[args.indexOf('-i') + 1]),
          seconds: Number(args[args.indexOf('-ss') + 1]),
        });
        await writeFile(args.at(-1), Buffer.from('same-frame'));
      },
    });
    await evaluate({
      clipId: 'clip-id', jobId: 'job-id', mode: 'mode', status: 'NEEDS_QA',
      sourceSha256: sha256(sourceBytes), videoPath, videoSha256: 'a'.repeat(64),
      durationSeconds: 13,
      deliveryDurationSeconds: 13.041667,
      motionReferenceBinding: {
        referenceId: 'style', sha256: sha256(referenceBytes), audioSourceFile: 'style-reference.mp4',
      },
    });
    const lastOutput = samples.filter((sample) => sample.input === 'clip.mp4').at(-1).seconds;
    const lastReference = samples.filter((sample) => sample.input === 'style-reference.mp4').at(-1).seconds;
    assert.ok(lastOutput < 13.041667, `output sample escaped delivery: ${lastOutput}`);
    assert.ok(lastReference > 13.04, `reference sample did not retain cut timing: ${lastReference}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('salvage review samples both segment boundaries so a short reference leak cannot hide between interior samples', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-semantic-boundaries-'));
  try {
    const clipDir = path.join(root, 'clip');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(clipDir, { recursive: true }));
    const sourceBytes = Buffer.from('approved-look');
    const referenceBytes = Buffer.from('reference-video');
    const sourcePath = path.join(clipDir, 'source.png');
    const referencePath = path.join(clipDir, 'style-reference.mp4');
    const videoPath = path.join(clipDir, 'clip.mp4');
    await Promise.all([
      writeFile(sourcePath, sourceBytes),
      writeFile(referencePath, referenceBytes),
      writeFile(videoPath, Buffer.from('salvaged-output')),
    ]);
    const outputSamples = [];
    const evaluate = createVideoSemanticQaEvaluator({
      evaluator: {
        async evaluateQa() {
          return {
            evaluator: { type: 'MODEL', provider: 'test', model: 'fixed', version: 'fixed', evaluation_id: 'e'.repeat(64) },
            checks: [
              ...REQUIRED_REFERENCE_CHECKS,
              ...Array.from({ length: 6 }, (_, index) => [
                `CUT_${index}_APPROVED_AVATAR_ONLY`,
                `CUT_${index}_REFERENCE_PERFORMER_ABSENT`,
              ]).flat(),
            ].map((name) => ({ name, pass: true })),
          };
        },
      },
      fashionVideoReferenceResolver: async () => ({
        state: 'READY', reference_sha256: sha256(referenceBytes),
        cut_sheet: { cuts: [{ cut_index: 0, start_ms: 0, end_ms: 6_000 }] },
      }),
      commandRunner: async (binary, args) => {
        const input = path.basename(args[args.indexOf('-i') + 1]);
        if (input === 'clip.mp4') outputSamples.push(Number(args[args.indexOf('-ss') + 1]));
        await sharp({
          create: { width: 32, height: 48, channels: 3, background: input === 'clip.mp4' ? '#336699' : '#993366' },
        }).jpeg().toFile(args.at(-1));
      },
    });
    await evaluate({
      clipId: 'clip-id', jobId: 'job-id', mode: 'mode', status: 'NEEDS_QA',
      sourceSha256: sha256(sourceBytes), videoPath, videoSha256: 'a'.repeat(64),
      durationSeconds: 13, deliveryDurationSeconds: 6,
      salvage: { status: 'NEEDS_QA', segments: [{ start_ms: 0, end_ms: 6_000 }] },
      motionReferenceBinding: {
        referenceId: 'style', sha256: sha256(referenceBytes), audioSourceFile: 'style-reference.mp4',
      },
    });
    assert.equal(outputSamples.length, 24);
    assert.deepEqual(outputSamples.slice(0, 4), [0.02, 0.333, 0.667, 0.98]);
    assert.deepEqual(outputSamples.slice(-4), [5.02, 5.333, 5.667, 5.95]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
