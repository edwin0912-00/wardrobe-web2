#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile, cp, mkdir, mkdtemp, readFile, rename, writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { extractFrame, probeVideo } from '../src/web/ffprobe-video-probe.js';
import { ClipStore, VideoService } from '../src/web/video-service.js';
import { salvageVideoFromQa } from '../src/web/video-qa-salvage.js';
import { createVideoSemanticQaEvaluator } from '../src/web/video-semantic-qa.js';
import { assembleFashionVideoDelivery } from '../src/web/video-runtime.js';
import { createFashionVideoReferenceResolver } from '../src/web/video-reference-registry.js';
import { createVlmEvaluator } from '../src/web/vlm-provider.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const SHA256 = /^[a-f0-9]{64}$/;

function parseArgs(argv) {
  const options = { apply: false };
  const valueFlags = new Set([
    '--runtime-root', '--reference-root', '--clip-id', '--job-id', '--source-sha256',
    '--artifact', '--artifact-sha256', '--manifest',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--apply') { options.apply = true; continue; }
    if (!valueFlags.has(flag) || !argv[index + 1]) throw new Error(`Unknown or incomplete argument: ${flag}`);
    options[flag.slice(2).replaceAll('-', '_')] = argv[++index];
  }
  for (const field of [
    'runtime_root', 'reference_root', 'clip_id', 'job_id', 'source_sha256',
    'artifact', 'artifact_sha256', 'manifest',
  ]) {
    if (!options[field]) throw new Error(`Missing --${field.replaceAll('_', '-')}`);
  }
  return options;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch`);
}

async function writeImmutable(filename, bytes) {
  await writeFile(filename, bytes, { flag: 'wx' });
  return sha256(bytes);
}

const options = parseArgs(process.argv.slice(2));
if (!SHA256.test(options.source_sha256) || !SHA256.test(options.artifact_sha256)) {
  throw new Error('Source and artifact hashes must be lowercase SHA-256 values');
}

const runtimeRoot = path.resolve(options.runtime_root);
const liveStore = new ClipStore(path.join(runtimeRoot, 'video-clips'));
const clip = await liveStore.load(options.clip_id);
if (!clip) throw new Error('Exact clip does not exist');
assertEqual(clip.clipId, options.clip_id, 'clip id');
assertEqual(clip.jobId, options.job_id, 'provider job id');
assertEqual(clip.sourceSha256, options.source_sha256, 'source SHA-256');
if (clip.providerKey !== 'higgsfield') throw new Error('Recovery is restricted to the affected Higgsfield clip');
if (clip.status !== 'FAIL') throw new Error(`Clip status changed from the reviewed FAIL state: ${clip.status}`);
if (!SHA256.test(clip.motionReferenceBinding?.sha256 ?? '')) throw new Error('Clip has no exact motion-reference binding');

const artifactPath = path.resolve(options.artifact);
const artifactBytes = await readFile(artifactPath);
assertEqual(sha256(artifactBytes), options.artifact_sha256, 'artifact SHA-256');
if (options.artifact_sha256 === clip.motionReferenceBinding.sha256) {
  throw new Error('Recovery artifact is the locked motion reference');
}
const sourceBytes = await readFile(path.join(liveStore.clipDir(options.clip_id), clip.sourceFile ?? 'source.png'));
assertEqual(sha256(sourceBytes), options.source_sha256, 'persisted source SHA-256');

const resolver = createFashionVideoReferenceResolver({
  rootDirectory: path.resolve(options.reference_root),
  manifestPath: path.resolve(options.manifest),
});
const reference = await resolver({
  motionMode: clip.mode,
  referenceId: clip.motionReferenceBinding.referenceId,
});
if (reference?.state !== 'READY') throw new Error('Motion reference is not READY');
assertEqual(reference.reference_sha256, clip.motionReferenceBinding.sha256, 'motion-reference SHA-256');
const referenceBytes = await readFile(reference.reference_path);
assertEqual(sha256(referenceBytes), reference.reference_sha256, 'reference bytes SHA-256');
const probe = await probeVideo(artifactPath);
const plan = {
  ok: true,
  mode: options.apply ? 'APPLY' : 'DRY_RUN',
  clip_id: options.clip_id,
  job_id: options.job_id,
  pre_status: clip.status,
  source_sha256: clip.sourceSha256,
  motion_reference_sha256: clip.motionReferenceBinding.sha256,
  artifact_sha256: options.artifact_sha256,
  artifact_probe: probe,
  provider_calls: 0,
};
if (!options.apply) {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
  process.exit(0);
}

// Work on a same-filesystem clone. The public daemon continues to see the
// original terminal clip until the recovered directory is complete, then the
// exact directory is exchanged by two bounded renames. The original becomes
// an incident backup and is never deleted.
const stageRoot = await mkdtemp(path.join(runtimeRoot, '.video-artifact-recovery-'));
const store = new ClipStore(path.join(stageRoot, 'video-clips'));
await mkdir(path.dirname(store.clipDir(options.clip_id)), { recursive: true });
await cp(liveStore.clipDir(options.clip_id), store.clipDir(options.clip_id), {
  recursive: true,
  errorOnExist: true,
});
const clipDir = store.clipDir(options.clip_id);
const preMetadataBytes = await readFile(path.join(clipDir, 'clip.json'));
const existingDeliveryBytes = await readFile(path.join(clipDir, 'clip.mp4'));
const intent = {
  schema_version: '1.0.0',
  operation: 'OPERATOR_SUPPLIED_PROVIDER_ARTIFACT_RECOVERY',
  clip_id: options.clip_id,
  job_id: options.job_id,
  source_sha256: clip.sourceSha256,
  motion_reference_sha256: clip.motionReferenceBinding.sha256,
  artifact_sha256: options.artifact_sha256,
  artifact_filename: path.basename(artifactPath),
  pre_metadata_sha256: sha256(preMetadataBytes),
  preserved_pre_delivery_sha256: sha256(existingDeliveryBytes),
  provider_calls: 0,
  recorded_at: new Date().toISOString(),
};
const intentBytes = Buffer.from(`${JSON.stringify(intent, null, 2)}\n`);
const intentSha256 = await writeImmutable(path.join(clipDir, 'artifact-recovery-intent.json'), intentBytes);
await writeFile(path.join(clipDir, 'pre-artifact-recovery-clip.json'), preMetadataBytes, { flag: 'wx' });
await copyFile(
  path.join(clipDir, 'clip.mp4'),
  path.join(clipDir, 'pre-artifact-recovery-clip.mp4'),
  constants.COPYFILE_EXCL,
);
await store.saveFashionReference(options.clip_id, referenceBytes);

await store.save(options.clip_id, {
  ...clip,
  status: 'CREATED',
  failureCode: null,
  motionReferenceBinding: {
    ...clip.motionReferenceBinding,
    audioSourceFile: 'style-reference.mp4',
    audioSourceSha256: reference.reference_sha256,
  },
  artifactRecovery: {
    status: 'IN_PROGRESS',
    intentFile: 'artifact-recovery-intent.json',
    intentSha256,
    artifactSha256: options.artifact_sha256,
    providerCalls: 0,
  },
  updatedAt: new Date().toISOString(),
});

const localBindingProvider = {
  async createJob() { throw new Error('Recovery must never create a provider job'); },
  async waitForJob({ jobId, providerKey }) {
    assertEqual(jobId, options.job_id, 'recovery wait job id');
    assertEqual(providerKey, 'higgsfield', 'recovery provider key');
    return {
      jobId,
      url: `https://operator-supplied.invalid/${options.artifact_sha256}.mp4`,
      selectedFieldPath: '/operator_supplied_artifact',
      raw: {
        job_id: jobId,
        status: 'completed',
        result: { artifact_sha256: options.artifact_sha256 },
      },
    };
  },
};
const qaDiagnostics = [];
const vlmEvaluator = createVlmEvaluator();
const semanticQaFn = createVideoSemanticQaEvaluator({
  evaluator: {
    async evaluateQa(context) {
      const evaluation = await vlmEvaluator.evaluateQa(context);
      qaDiagnostics.push({
        idempotency_key: context?.idempotencyKey ?? null,
        decision: evaluation?.decision ?? null,
        check_names: Array.isArray(evaluation?.checks)
          ? evaluation.checks.map((check) => check?.name).filter(Boolean)
          : [],
        reason: typeof evaluation?.reason === 'string'
          ? evaluation.reason.replaceAll(/(?:\/[\w. -]+)+/g, '[redacted-path]').slice(0, 500)
          : null,
      });
      return evaluation;
    },
  },
  fashionVideoReferenceResolver: resolver,
  commandRunner: (await import('node:util')).promisify((await import('node:child_process')).execFile),
});
const automaticQaFn = async (clipToReview) => {
  try {
    return await semanticQaFn(clipToReview);
  } catch (cause) {
    qaDiagnostics.push({
      stage: 'semantic_qa',
      code: typeof cause?.code === 'string' ? cause.code : null,
      reason: typeof cause?.message === 'string'
        ? cause.message.replaceAll(/(?:\/[\w. -]+)+/g, '[redacted-path]').slice(0, 500)
        : 'unknown semantic QA failure',
    });
    throw cause;
  }
};
const service = new VideoService({
  provider: localBindingProvider,
  clipStore: store,
  fashionVideoReferenceResolver: resolver,
  automaticQaFn,
  finalizer: {
    probeFn: probeVideo,
    extractFrameFn: extractFrame,
    composeFn: assembleFashionVideoDelivery,
    salvageFn: (request) => salvageVideoFromQa(request, { probeFn: probeVideo }),
  },
});

let result = await service.awaitAndFinalize(options.clip_id, {
  downloadFn: async () => artifactBytes,
  probeFn: probeVideo,
  extractFrameFn: extractFrame,
  composeFn: assembleFashionVideoDelivery,
});
if (result.status === 'NEEDS_QA') result = await service.runAutomaticQa(options.clip_id);
const recovered = await store.load(options.clip_id);
const stagedPrefix = `${stageRoot}${path.sep}`;
const liveClipDir = liveStore.clipDir(options.clip_id);
const rebased = {
  ...recovered,
  videoPath: typeof recovered.videoPath === 'string' && recovered.videoPath.startsWith(stagedPrefix)
    ? path.join(liveClipDir, path.basename(recovered.videoPath))
    : recovered.videoPath,
  originalProviderVideoPath: typeof recovered.originalProviderVideoPath === 'string'
      && recovered.originalProviderVideoPath.startsWith(stagedPrefix)
    ? path.join(liveClipDir, path.basename(recovered.originalProviderVideoPath))
    : recovered.originalProviderVideoPath,
};
const recoveryReceipt = {
  ...intent,
  intent_sha256: intentSha256,
  final_status: rebased.status,
  failure_code: rebased.failureCode ?? null,
  provider_video_sha256: rebased.providerVideoSha256 ?? null,
  delivery_video_sha256: rebased.videoSha256 ?? null,
  salvage: rebased.salvage ?? null,
  completed_at: new Date().toISOString(),
};
const recoveryReceiptBytes = Buffer.from(`${JSON.stringify(recoveryReceipt, null, 2)}\n`);
const recoveryReceiptSha256 = await writeImmutable(
  path.join(clipDir, 'artifact-recovery-receipt.json'),
  recoveryReceiptBytes,
);
await store.save(options.clip_id, {
  ...rebased,
  artifactRecovery: {
    ...rebased.artifactRecovery,
    status: 'COMPLETED',
    receiptFile: 'artifact-recovery-receipt.json',
    receiptSha256: recoveryReceiptSha256,
    providerCalls: 0,
  },
  updatedAt: new Date().toISOString(),
});

const liveMetadataBytes = await readFile(path.join(liveStore.clipDir(options.clip_id), 'clip.json'));
assertEqual(sha256(liveMetadataBytes), sha256(preMetadataBytes), 'live clip changed during recovery');
const incidentName = `incident-pre-artifact-recovery-${options.clip_id}-${Date.now()}`;
const incidentRoot = path.join(runtimeRoot, 'video-clips', 'incidents');
await mkdir(incidentRoot, { recursive: true });
const incidentPath = path.join(incidentRoot, incidentName);
await rename(liveStore.clipDir(options.clip_id), incidentPath);
await rename(store.clipDir(options.clip_id), liveStore.clipDir(options.clip_id));

process.stdout.write(`${JSON.stringify({
  ...plan,
  final_status: rebased.status,
  failure_code: rebased.failureCode ?? null,
  provider_video_sha256: rebased.providerVideoSha256 ?? null,
  delivery_video_sha256: rebased.videoSha256 ?? null,
  salvage: rebased.salvage ?? null,
  qa_diagnostics: qaDiagnostics,
  intent_sha256: intentSha256,
  recovery_receipt_sha256: recoveryReceiptSha256,
  preserved_incident_directory: incidentName,
})}\n`);
