import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ClipStore,
  REQUIRED_REFERENCE_CHECKS,
  VideoService,
  VideoServiceError,
} from '../../src/web/video-service.js';
import { HiggsfieldVideoProvider } from '../../src/providers/higgsfield-video-provider.js';
import { sha256 } from '../../src/web/scene-contract.js';

// Stubbed provider that tracks calls and returns predictable results
function makeStubProvider({ jobId = 'job_test_123', videoUrl = 'https://cdn.example/clip.mp4' } = {}) {
  const calls = [];
  const provider = new HiggsfieldVideoProvider({
    commandRunner: async (binary, args) => {
      calls.push({ phase: args[1], args });
      if (args[1] === 'create') {
        return { stdout: JSON.stringify({ job_id: jobId }), stderr: '' };
      }
      return {
        stdout: JSON.stringify({ job_id: jobId, results: [{ url: videoUrl }] }),
        stderr: '',
      };
    },
  });
  return { provider, calls };
}

// Stubbed download that returns fake video bytes
function makeStubDownload(bytes = Buffer.from('fake-video-bytes')) {
  return async () => bytes;
}

// Stubbed probe and frame extraction for QA
function makeStubQa({
  durationSeconds = 5.0,
  width = 1280,
  height = 720,
  hasAudio = false,
  frameLuminance = 128,
} = {}) {
  const probeFn = async () => ({ durationSeconds, width, height, hasAudio });
  const extractFrameFn = async () => new Uint8Array(10).fill(frameLuminance);
  return { probeFn, extractFrameFn };
}

function makeStubCompose({ policy = 'REFERENCE_REQUIRED' } = {}) {
  return async ({ providerVideoPath, outputPath }) => {
    await writeFile(outputPath, await readFile(providerVideoPath));
    return {
      policy,
      referenceAudioAttached: policy === 'REFERENCE_REQUIRED',
      source: policy === 'REFERENCE_REQUIRED' ? 'LOCKED_VIDEO_REFERENCE' : 'SILENT_REFERENCE',
    };
  };
}

function verifiedCutSheet(durationSeconds) {
  const cut_sheet = {
    schema_version: '1.0.0',
    cuts: [{
      cut_index: 0,
      start_ms: 0,
      end_ms: Math.round(durationSeconds * 1000),
      subject_rule: 'APPROVED_AVATAR_OR_EMPTY',
      direction: 'Reconstruct this entire reference interval with the approved avatar only or an empty environment.',
    }],
  };
  return { cut_sheet, cut_sheet_sha256: sha256(Buffer.from(JSON.stringify(cut_sheet))) };
}

function microCutCoverage({
  durationMs = 5_000,
  decision = 'PASS',
  referencePerformerVisible = false,
  visiblePeople = 'APPROVED_AVATAR_ONLY',
} = {}) {
  return {
    sample_rate_fps: 2,
    cuts: [{
      cut_index: 0,
      start_ms: 0,
      end_ms: durationMs,
      sample_count: 10,
      output_frame_sha256s: ['c'.repeat(64)],
      reference_frame_sha256s: ['d'.repeat(64)],
      reference_performer_visible: referencePerformerVisible,
      visible_people: visiblePeople,
      decision,
    }],
  };
}

const referenceTransferCheckNames = [
  'cut_coverage_complete',
  'subject_replacement_every_cut',
  'no_reference_performer_pixels',
  'identity_and_outfit_every_subject_cut',
  'motion_and_pose_timing',
  'camera_and_framing',
  'environment_and_lighting',
  'grade_and_optical_effects',
  'shot_sequence_and_transitions',
];

function referenceTransferChecks(failedName = null) {
  return referenceTransferCheckNames.map((name) => ({
    name,
    decision: name === failedName ? 'FAIL' : 'PASS',
  }));
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-test-'));
  const sourcePath = path.join(dir, 'locked-frame.png');
  await writeFile(sourcePath, Buffer.from('locked-source-image'));
  try {
    await fn(dir, sourcePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('createClip builds a motion plan and persists the job id', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const result = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
    });

    assert.ok(result.clipId);
    assert.equal(result.jobId, 'job_test_123');
    assert.equal(result.status, 'CREATED');
    assert.equal(result.plan.surface, 'tv');
    assert.equal(result.plan.aspectRatio, '16:9');
    assert.equal(result.plan.durationSeconds, 5);

    // Verify the clip was persisted
    const saved = await store.load(result.clipId);
    assert.equal(saved.jobId, 'job_test_123');
    assert.equal(saved.status, 'CREATED');
    assert.equal(saved.surface, 'tv');
    assert.equal(saved.sourceSha256, '6796fa7544369e1a072cc7a76ab119b0150d7b4ef3f4aad47b64c4ef043b50b7');
    assert.ok(saved.createReceiptSha256);
    const receipt = JSON.parse(
      await readFile(path.join(store.clipDir(result.clipId), 'create-receipt.json'), 'utf8'),
    );
    assert.equal(receipt.response.job_id, 'job_test_123');
    assert.equal(receipt.request.source_sha256, saved.sourceSha256);
    assert.equal(receipt.request.prompt.includes(sourcePath), false);

    // Only the create phase should have been called
    assert.equal(calls.length, 1);
    assert.equal(calls[0].phase, 'create');
  });
});

test('reference-bound Fashion Video ignores a stale client surface and uses the style geometry', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'vertical-style.mp4');
    const referenceBytes = Buffer.from('verified-vertical-style');
    await writeFile(referencePath, referenceBytes);
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const videoReference = {
      state: 'READY', reference_id: 'vertical-style', reference_path: referencePath,
      reference_sha256: sha256(referenceBytes), reference_pack_sha256: 'e'.repeat(64),
      duration_seconds: 5, provider_duration_seconds: 5, width: 720, height: 1280, fps: 24,
      ...verifiedCutSheet(5),
    };
    const result = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
      videoReference,
      lookBinding: { whiteBackgroundVerified: true },
    });
    assert.equal(result.plan.surface, 'mirror');
    assert.equal(result.plan.aspectRatio, '9:16');
    assert.equal(calls[0].args[calls[0].args.indexOf('--aspect_ratio') + 1], '9:16');
    const saved = await store.load(result.clipId);
    assert.equal(saved.motionReferenceBinding.presentationSurface, 'mirror');
    assert.equal(saved.motionReferenceBinding.aspectRatio, '9:16');
  });
});

test('explicit retry creates a child only from the failed clip’s locked source and style binding', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'style.mp4');
    await writeFile(referencePath, Buffer.from('verified-style-video'));
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const videoReference = {
      state: 'READY',
      reference_id: 'style-1',
      reference_path: referencePath,
      reference_sha256: sha256(Buffer.from('verified-style-video')),
      reference_pack_sha256: 'e'.repeat(64),
      duration_seconds: 5,
      provider_duration_seconds: 5,
      width: 720,
      height: 1280,
      fps: 24,
      ...verifiedCutSheet(5),
    };
    const parent = await service.createClip({
      modeId: 'walk_stride',
      surfaceId: 'mirror',
      sourceCapabilities: { full_length: true },
      sourceImagePath: sourcePath,
      videoReference,
      appearanceReferences: [],
      lookBinding: {
        sourceSha256: sha256(Buffer.from('locked-source-image')),
        approvedLookReceiptSha256: 'c'.repeat(64),
        whiteBackgroundVerified: true,
      },
    });
    const failedParent = await store.load(parent.clipId);
    await store.save(parent.clipId, { ...failedParent, status: 'FAIL', failureCode: 'CLIP_HAS_AUDIO' });
    const child = await service.retryFailedClip(parent.clipId, { videoReference });
    const childMetadata = await store.load(child.clipId);
    assert.equal(childMetadata.retryOf, parent.clipId);
    assert.equal(childMetadata.sourceSha256, failedParent.sourceSha256);
    assert.deepEqual(childMetadata.appearanceReferences.map((reference) => reference.sha256),
      failedParent.appearanceReferences.map((reference) => reference.sha256));
    assert.equal(childMetadata.motionReferenceBinding.sha256, failedParent.motionReferenceBinding.sha256);
    assert.equal(calls.filter((call) => call.phase === 'create').length, 2);
  });
});

test('reference-performer QA automatically creates at most two materially distinct child attempts', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'style.mp4');
    const referenceBytes = Buffer.from('verified-style-video');
    await writeFile(referencePath, referenceBytes);
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const videoReference = {
      state: 'READY',
      reference_id: 'style-1',
      reference_path: referencePath,
      reference_sha256: sha256(referenceBytes),
      reference_pack_sha256: 'e'.repeat(64),
      duration_seconds: 5,
      provider_duration_seconds: 5,
      width: 720,
      height: 1280,
      fps: 24,
      ...verifiedCutSheet(5),
    };
    const parent = await service.createClip({
      modeId: 'walk_stride',
      surfaceId: 'mirror',
      sourceCapabilities: { full_length: true },
      sourceImagePath: sourcePath,
      videoReference,
      lookBinding: {
        sourceSha256: sha256(Buffer.from('locked-source-image')),
        approvedLookReceiptSha256: 'c'.repeat(64),
        whiteBackgroundVerified: true,
      },
    });
    const failedParent = await store.load(parent.clipId);
    await store.save(parent.clipId, {
      ...failedParent,
      status: 'FAIL',
      failureCode: 'VIDEO_REFERENCE_QA_FAILED',
      referenceAdherenceQaSha256: 'f'.repeat(64),
    });

    const first = await service.automaticRetryReferenceQaFailure(parent.clipId, { videoReference });
    assert.equal(first.created, true);
    assert.equal(first.retryNumber, 1);
    const firstChild = await store.load(first.childClipId);
    assert.equal(firstChild.retryOf, parent.clipId);
    assert.equal(firstChild.automaticRetry.retry_number, 1);
    assert.equal(firstChild.automaticRetry.id, 'full-subject-replacement-pass');
    assert.match(firstChild.prompt, /REFERENCE REPAIR full-subject-replacement-pass/);
    assert.equal(calls.filter((call) => call.phase === 'create').length, 2);

    const duplicate = await service.automaticRetryReferenceQaFailure(parent.clipId, { videoReference });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.childClipId, first.childClipId);
    assert.equal(calls.filter((call) => call.phase === 'create').length, 2);

    await store.save(firstChild.clipId, {
      ...firstChild,
      status: 'FAIL',
      failureCode: 'VIDEO_REFERENCE_QA_FAILED',
      referenceAdherenceQaSha256: 'a'.repeat(64),
    });
    const second = await service.automaticRetryReferenceQaFailure(firstChild.clipId, { videoReference });
    assert.equal(second.created, true);
    assert.equal(second.retryNumber, 2);
    const secondChild = await store.load(second.childClipId);
    assert.equal(secondChild.retryOf, firstChild.clipId);
    assert.equal(secondChild.automaticRetry.retry_number, 2);
    assert.equal(secondChild.automaticRetry.id, 'cut-boundary-subject-isolation-pass');
    assert.match(secondChild.prompt, /REFERENCE REPAIR cut-boundary-subject-isolation-pass/);
    assert.equal(calls.filter((call) => call.phase === 'create').length, 3);

    await store.save(secondChild.clipId, {
      ...secondChild,
      status: 'FAIL',
      failureCode: 'VIDEO_REFERENCE_QA_FAILED',
      referenceAdherenceQaSha256: 'b'.repeat(64),
    });
    const exhausted = await service.automaticRetryReferenceQaFailure(secondChild.clipId, { videoReference });
    assert.equal(exhausted.exhausted, true);
    assert.equal(exhausted.retryNumber, 2);
    assert.equal(calls.filter((call) => call.phase === 'create').length, 3);
  });
});

test('an attested Higgsfield terminal failure automatically creates at most two bound child attempts', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'style.mp4');
    const referenceBytes = Buffer.from('verified-style-video');
    await writeFile(referencePath, referenceBytes);
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const videoReference = {
      state: 'READY',
      reference_id: 'style-1',
      reference_path: referencePath,
      reference_sha256: sha256(referenceBytes),
      reference_pack_sha256: 'e'.repeat(64),
      duration_seconds: 5,
      provider_duration_seconds: 5,
      width: 720,
      height: 1280,
      fps: 24,
      ...verifiedCutSheet(5),
    };
    const parent = await service.createClip({
      modeId: 'walk_stride',
      surfaceId: 'mirror',
      sourceCapabilities: { full_length: true },
      sourceImagePath: sourcePath,
      videoReference,
      lookBinding: {
        sourceSha256: sha256(Buffer.from('locked-source-image')),
        approvedLookReceiptSha256: 'c'.repeat(64),
        whiteBackgroundVerified: true,
      },
    });
    const failedParent = await store.load(parent.clipId);
    await store.save(parent.clipId, {
      ...failedParent,
      status: 'FAILED',
      failureCode: 'VIDEO_PROVIDER_JOB_FAILED',
      providerTerminal: { code: 'VIDEO_PROVIDER_JOB_FAILED', retryable: true },
    });

    const first = await service.automaticRetryReferenceQaFailure(parent.clipId, { videoReference });
    assert.equal(first.created, true);
    assert.equal(first.retryNumber, 1);
    const firstChild = await store.load(first.childClipId);
    assert.equal(firstChild.retryOf, parent.clipId);
    assert.equal(firstChild.automaticRetry.reason_code, 'VIDEO_PROVIDER_JOB_FAILED');
    assert.match(firstChild.prompt, /REFERENCE REPAIR full-subject-replacement-pass/);

    await store.save(firstChild.clipId, {
      ...firstChild,
      status: 'FAILED',
      failureCode: 'VIDEO_PROVIDER_JOB_FAILED',
      providerTerminal: { code: 'VIDEO_PROVIDER_JOB_FAILED', retryable: true },
    });
    const second = await service.automaticRetryReferenceQaFailure(firstChild.clipId, { videoReference });
    assert.equal(second.created, true);
    assert.equal(second.retryNumber, 2);
    const secondChild = await store.load(second.childClipId);
    assert.equal(secondChild.retryOf, firstChild.clipId);
    assert.equal(secondChild.automaticRetry.reason_code, 'VIDEO_PROVIDER_JOB_FAILED');

    await store.save(secondChild.clipId, {
      ...secondChild,
      status: 'FAILED',
      failureCode: 'VIDEO_PROVIDER_JOB_FAILED',
      providerTerminal: { code: 'VIDEO_PROVIDER_JOB_FAILED', retryable: true },
    });
    const exhausted = await service.automaticRetryReferenceQaFailure(secondChild.clipId, { videoReference });
    assert.equal(exhausted.exhausted, true);
    assert.equal(exhausted.retryNumber, 2);
    assert.equal(calls.filter((call) => call.phase === 'create').length, 3);
  });
});

test('retry refuses a changed video-style hash before a second provider create', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'style.mp4');
    await writeFile(referencePath, Buffer.from('verified-style-video'));
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const videoReference = {
      state: 'READY', reference_id: 'style-1', reference_path: referencePath,
      reference_sha256: sha256(Buffer.from('verified-style-video')), reference_pack_sha256: 'e'.repeat(64),
      duration_seconds: 5, provider_duration_seconds: 5, width: 720, height: 1280, fps: 24,
      ...verifiedCutSheet(5),
    };
    const parent = await service.createClip({
      modeId: 'walk_stride', surfaceId: 'mirror', sourceCapabilities: { full_length: true },
      sourceImagePath: sourcePath, videoReference,
      lookBinding: { whiteBackgroundVerified: true },
    });
    const failedParent = await store.load(parent.clipId);
    await store.save(parent.clipId, { ...failedParent, status: 'FAIL' });
    await assert.rejects(
      () => service.retryFailedClip(parent.clipId, {
        ...videoReference, reference_sha256: 'f'.repeat(64),
      }),
      (error) => error instanceof VideoServiceError && error.code === 'VIDEO_RETRY_REFERENCE_MISMATCH',
    );
    assert.equal(calls.filter((call) => call.phase === 'create').length, 1);
  });
});

test('createClip settles a definite provider rejection instead of leaving a phantom submitting clip', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const provider = {
      async createJob() {
        const error = new Error('CLI rejected the media shape before submission');
        error.code = 'INVALID_MEDIA_SET';
        throw error;
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({
      provider,
      clipStore: store,
      clock: () => Date.parse('2026-07-30T22:00:00.000Z'),
    });

    await assert.rejects(
      () => service.createClip({
        modeId: 'editorial_micro_moment',
        surfaceId: 'tv',
        sourceImagePath: sourcePath,
      }),
      (error) => error.code === 'VIDEO_CREATE_REJECTED',
    );

    const [clipId] = await readdir(path.join(dir, 'clips'));
    const saved = await store.load(clipId);
    assert.equal(saved.status, 'FAILED');
    assert.equal(saved.failureCode, 'VIDEO_CREATE_REJECTED');
    assert.equal(saved.jobId, null);
  });
});

test('createClip retries one exact input-media IP check with the same immutable request', async () => {
  await withTempDir(async (dir, sourcePath) => {
    let attempts = 0;
    const requests = [];
    const provider = {
      async createJob(request) {
        requests.push(request);
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('IP check not finished for input media');
          error.code = 'PROVIDER_INPUT_MEDIA_IP_CHECK_PENDING';
          throw error;
        }
        return { jobId: 'job_ip_check_ready', raw: { job_id: 'job_ip_check_ready' } };
      },
    };
    const sleeps = [];
    const store = new ClipStore(dir);
    const service = new VideoService({
      provider,
      clipStore: store,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      clock: () => Date.parse('2026-08-03T10:00:00.000Z'),
    });

    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
    });

    assert.equal(created.jobId, 'job_ip_check_ready');
    assert.equal(attempts, 2);
    assert.equal(requests[0], requests[1]);
    assert.deepEqual(sleeps, [3_000]);
    const saved = await store.load(created.clipId);
    assert.deepEqual(saved.providerInputMedia, {
      state: 'READY',
      attempt: 2,
      max_attempts: 2,
    });
  });
});

test('createClip reports input-media IP verification after its bounded automatic retry', async () => {
  await withTempDir(async (dir, sourcePath) => {
    let attempts = 0;
    const provider = {
      async createJob() {
        attempts += 1;
        const error = new Error('IP check not finished for input media');
        error.code = 'PROVIDER_INPUT_MEDIA_IP_CHECK_PENDING';
        throw error;
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({
      provider,
      clipStore: store,
      sleep: async () => {},
      clock: () => Date.parse('2026-08-03T10:00:00.000Z'),
    });

    await assert.rejects(
      () => service.createClip({
        modeId: 'editorial_micro_moment',
        surfaceId: 'tv',
        sourceImagePath: sourcePath,
      }),
      (error) => error.code === 'VIDEO_INPUT_MEDIA_IP_CHECK_PENDING' && error.status === 503,
    );

    assert.equal(attempts, 2);
    const [clipId] = await readdir(path.join(dir, 'clips'));
    const saved = await store.load(clipId);
    assert.equal(saved.status, 'FAILED');
    assert.equal(saved.failureCode, 'VIDEO_INPUT_MEDIA_IP_CHECK_PENDING');
    assert.deepEqual(saved.providerInputMedia, {
      state: 'PENDING',
      attempt: 2,
      max_attempts: 2,
    });
  });
});

test('recoverSubmittedClip refuses an ambiguous paid job even when the caller echoes the local binding', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referenceBytes = Buffer.from('recovery-style-video');
    const referencePath = path.join(dir, 'recovery-style.mp4');
    const garmentBytes = Buffer.from('recovery-garment-card');
    await writeFile(referencePath, referenceBytes);
    const provider = {
      async createJob() {
        const error = new Error('accepted response could not be parsed');
        error.code = 'CREATE_OUTCOME_UNKNOWN';
        throw error;
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await assert.rejects(
      () => service.createClip({
        modeId: 'walk_stride',
        surfaceId: 'mirror',
        sourceCapabilities: { full_length: true },
        sourceImagePath: sourcePath,
        lookBinding: {
          sourceSha256: sha256(Buffer.from('locked-source-image')),
          approvedLookReceiptSha256: 'c'.repeat(64),
          whiteBackgroundVerified: true,
        },
        videoReference: {
          state: 'READY',
          reference_id: 'recovery-style',
          reference_path: referencePath,
          reference_sha256: sha256(referenceBytes),
          reference_pack_sha256: 'e'.repeat(64),
          duration_seconds: 5,
          provider_duration_seconds: 5,
          width: 720,
          height: 1280,
          ...verifiedCutSheet(5),
        },
        appearanceReferences: [{
          role: 'garment_detail',
          bytes: garmentBytes,
          sha256: sha256(garmentBytes),
          white_background_verified: true,
        }],
      }),
      (error) => error.code === 'CREATE_OUTCOME_UNKNOWN',
    );
    const [clipId] = await readdir(path.join(dir, 'clips'));
    const submitting = await store.load(clipId);
    const raw = {
      id: 'job_recovered',
      job_set_type: 'seedance_2_0',
      params: {
        prompt: submitting.prompt,
        aspect_ratio: '9:16',
        duration: 5,
      },
    };

    assert.equal(submitting.immutableRequestBinding.motion_reference.sha256, sha256(referenceBytes));
    assert.deepEqual(submitting.immutableRequestBinding.appearance_references, [{
      role: 'garment_detail',
      sha256: sha256(garmentBytes),
      provider_label: '[Image 2]',
      white_background_verified: true,
    }]);
    await assert.rejects(
      () => service.recoverSubmittedClip(clipId, {
        jobId: 'job_recovered',
        raw,
        requestBinding: structuredClone(submitting.immutableRequestBinding),
      }),
      (error) => error.code === 'RECOVERY_PROVIDER_BINDING_UNVERIFIABLE',
    );
    const unchanged = await store.load(clipId);
    assert.equal(unchanged.status, 'SUBMITTING');
    assert.equal(unchanged.jobId, null);
    await assert.rejects(
      () => readFile(path.join(store.clipDir(clipId), 'create-receipt.json')),
      (error) => error.code === 'ENOENT',
    );
  });
});

test('recoverSubmittedClip refuses legacy prompt-only recovery without provider media attestation', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('mismatch', {
      clipId: 'mismatch',
      jobId: null,
      status: 'SUBMITTING',
      prompt: 'locked prompt',
      aspectRatio: '9:16',
      durationSeconds: 5,
      sourceSha256: 'a'.repeat(64),
      createdAt: '2026-07-29T21:00:13.025Z',
    });
    await assert.rejects(
      () => service.recoverSubmittedClip('mismatch', {
        jobId: 'wrong_job',
        raw: {
          job_set_type: 'seedance_2_0',
          params: { prompt: 'locked prompt', aspect_ratio: '16:9', duration: 5 },
        },
      }),
      (error) => {
        assert.equal(error.code, 'RECOVERY_PROVIDER_BINDING_UNVERIFIABLE');
        return true;
      },
    );
  });
});

test('createClip with mirror surface uses 9:16 aspect', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const result = await service.createClip({
      modeId: 'camera_drift',
      surfaceId: 'mirror',
      sourceImagePath: sourcePath,
    });

    assert.equal(result.plan.surface, 'mirror');
    assert.equal(result.plan.aspectRatio, '9:16');

    // The transport should receive 9:16
    const createArgs = calls[0].args;
    const aspectIdx = createArgs.indexOf('--aspect_ratio');
    assert.equal(createArgs[aspectIdx + 1], '9:16');
  });
});

test('createClip without sourceImagePath is refused', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    await assert.rejects(
      () => service.createClip({ modeId: 'editorial_micro_moment', surfaceId: 'tv' }),
      (error) => {
        assert.equal(error.code, 'MISSING_SOURCE');
        return true;
      },
    );
  });
});

test('createClip refuses approved-look bytes that do not match their binding', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await assert.rejects(
      () => service.createClip({
        modeId: 'editorial_micro_moment',
        surfaceId: 'tv',
        sourceImagePath: sourcePath,
        lookBinding: {
          sourceSha256: 'f'.repeat(64),
          approvedLookReceiptSha256: 'e'.repeat(64),
        },
      }),
      (error) => {
        assert.equal(error.code, 'VIDEO_SOURCE_HASH_MISMATCH');
        return true;
      },
    );
  });
});

test('createClip passes exact clip/source/receipt binding to the provider', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const requests = [];
    const provider = {
      async createJob(request) {
        requests.push(request);
        return { jobId: 'job_bound', raw: { job_id: 'job_bound' } };
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const sourceSha256 = '6796fa7544369e1a072cc7a76ab119b0150d7b4ef3f4aad47b64c4ef043b50b7';
    const receiptSha256 = 'e'.repeat(64);
    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
      lookBinding: {
        sourceSha256,
        approvedLookReceiptSha256: receiptSha256,
      },
    });
    assert.deepEqual(requests[0].sourceBinding, {
      clipId: created.clipId,
      sourceSha256,
      approvedLookReceiptSha256: receiptSha256,
    });
    const receipt = JSON.parse(
      await readFile(path.join(store.clipDir(created.clipId), 'create-receipt.json'), 'utf8'),
    );
    assert.equal(receipt.request.approved_look_receipt_sha256, receiptSha256);
  });
});

test('createClip rechecks and passes the exact video reference binding', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'motion.mp4');
    const referenceBytes = Buffer.from('motion-reference-bytes');
    const identityBytes = Buffer.from('identity-reference-bytes');
    const garmentBytes = Buffer.from('garment-reference-bytes');
    await writeFile(referencePath, referenceBytes);
    const requests = [];
    const provider = {
      async createJob(request) {
        requests.push(request);
        return { jobId: 'job_reference', raw: { job_id: 'job_reference' } };
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const referenceSha256 = sha256(referenceBytes);
    await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'mirror',
      sourceImagePath: sourcePath,
      lookBinding: { whiteBackgroundVerified: true },
      videoReference: {
        state: 'READY',
        reference_id: 'editorial-detail',
        reference_path: referencePath,
        reference_sha256: referenceSha256,
        reference_pack_sha256: 'f'.repeat(64),
        duration_seconds: 13.24,
        provider_duration_seconds: 13,
        width: 1080,
        height: 1920,
        fps: 25,
        ...verifiedCutSheet(13.24),
      },
      appearanceReferences: [
        {
          role: 'identity_face',
          bytes: identityBytes,
          sha256: sha256(identityBytes),
          white_background_verified: true,
        },
        {
          role: 'garment_detail',
          bytes: garmentBytes,
          sha256: sha256(garmentBytes),
          white_background_verified: true,
        },
      ],
    });
    assert.deepEqual(requests[0].videoPaths.map((file) => path.basename(file)), ['style-reference.mp4']);
    assert.equal(requests[0].durationSeconds, 13);
    assert.match(requests[0].prompt, /^Reference bindings\. \[Video 1\] is private reference-only directing material, never delivery media/);
    assert.match(requests[0].prompt, /\[Image 2\] is an optional white-background face-detail reference/);
    assert.match(requests[0].prompt, /\[Image 3\] is a white-background garment-only evidence card/);
    assert.match(requests[0].prompt, /Every final frame must be newly generated/);
    assert.match(requests[0].prompt, /No source performer face, body, skin, hair, clothing, silhouette or motion-blurred fragment may survive/);
    assert.deepEqual(
      requests[0].mediaPaths.map((mediaPath) => path.basename(mediaPath)),
      ['source.png', 'identity-face.png', 'garment-detail.png'],
    );
    assert.equal(requests[0].sourceBinding.motionReferenceSha256, referenceSha256);
    assert.equal(requests[0].sourceBinding.referencePackSha256, 'f'.repeat(64));
    const saved = await store.load(requests[0].sourceBinding.clipId);
    assert.equal(saved.motionReferenceBinding.durationSeconds, 13.24);
    assert.equal(saved.motionReferenceBinding.audioSourceFile, 'style-reference.mp4');
    assert.equal(saved.motionReferenceBinding.audioSourceSha256, referenceSha256);
    assert.deepEqual(
      saved.appearanceReferences.map((reference) => reference.role),
      ['identity_face', 'garment_detail'],
    );
    assert.deepEqual(
      saved.appearanceReferences.map((reference) => reference.provider_label),
      ['[Image 2]', '[Image 3]'],
    );
    const receipt = JSON.parse(await readFile(
      path.join(store.clipDir(requests[0].sourceBinding.clipId), 'create-receipt.json'),
      'utf8',
    ));
    assert.equal(
      receipt.request.reference_bindings.schema_version,
      'fashion-video-reference-bindings-v3',
    );
    assert.deepEqual(
      receipt.request.reference_bindings.images.map((binding) => binding.provider_label),
      ['[Image 1]', '[Image 2]', '[Image 3]'],
    );
  });
});

test('retry uses the immutable style duration rather than an obsolete motion-mode duration', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'style-reference.mp4');
    const referenceBytes = Buffer.from('style-duration-authority');
    await writeFile(referencePath, referenceBytes);
    const requests = [];
    const provider = {
      async createJob(request) {
        requests.push(request);
        return { jobId: `job_style_duration_${requests.length}`, raw: {} };
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const videoReference = {
      state: 'READY',
      reference_id: 'long-camera-drift-style',
      reference_path: referencePath,
      reference_sha256: sha256(referenceBytes),
      reference_pack_sha256: 'd'.repeat(64),
      duration_seconds: 13.24,
      provider_duration_seconds: 13,
      width: 1080,
      height: 1920,
      fps: 25,
      ...verifiedCutSheet(13.24),
    };
    const parent = await service.createClip({
      modeId: 'camera_drift',
      sourceImagePath: sourcePath,
      lookBinding: { whiteBackgroundVerified: true },
      videoReference,
    });
    const persistedParent = await store.load(parent.clipId);
    // This is the exact legacy state that caused the live retry to be rejected
    // with "Camera drift runs 5–7 seconds" before provider submission.
    await store.save(parent.clipId, {
      ...persistedParent,
      durationSeconds: 6,
      status: 'FAIL',
      failureCode: 'VIDEO_PROVIDER_JOB_NOT_FOUND',
    });
    const child = await service.retryFailedClip(parent.clipId, { videoReference });
    const persistedChild = await store.load(child.clipId);
    assert.equal(requests.at(-1).durationSeconds, 13);
    assert.equal(persistedChild.durationSeconds, 13);
    assert.equal(persistedChild.motionReferenceBinding.providerDurationSeconds, 13);
  });
});

test('reference-bound Fashion Video refuses a raw identity-photo side input before provider spend', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'motion.mp4');
    const referenceBytes = Buffer.from('motion-reference-bytes');
    await writeFile(referencePath, referenceBytes);
    let calls = 0;
    const service = new VideoService({
      provider: { async createJob() { calls += 1; return { jobId: 'must-not-run' }; } },
      clipStore: new ClipStore(dir),
    });
    const identity = Buffer.from('original-user-photo-with-a-background');
    await assert.rejects(
      () => service.createClip({
        modeId: 'editorial_micro_moment', surfaceId: 'mirror', sourceImagePath: sourcePath,
        lookBinding: { whiteBackgroundVerified: true },
        videoReference: {
          state: 'READY', reference_id: 'style-1', reference_path: referencePath,
          reference_sha256: sha256(referenceBytes), reference_pack_sha256: 'f'.repeat(64),
          duration_seconds: 5, provider_duration_seconds: 5, width: 1080, height: 1920, fps: 25,
          ...verifiedCutSheet(5),
        },
        appearanceReferences: [{ role: 'identity_face', bytes: identity, sha256: sha256(identity) }],
      }),
      (error) => error instanceof VideoServiceError
        && error.code === 'VIDEO_IDENTITY_FACE_BACKGROUND_INVALID',
    );
    assert.equal(calls, 0);
  });
});

test('createClip refuses a changed video reference before provider spend', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'motion.mp4');
    await writeFile(referencePath, 'changed');
    let providerCalls = 0;
    const provider = {
      async createJob() {
        providerCalls += 1;
        return { jobId: 'must-not-run' };
      },
    };
    const service = new VideoService({ provider, clipStore: new ClipStore(dir) });
    await assert.rejects(
      () => service.createClip({
        modeId: 'editorial_micro_moment',
        surfaceId: 'mirror',
        sourceImagePath: sourcePath,
        lookBinding: { whiteBackgroundVerified: true },
        videoReference: {
          state: 'READY',
          reference_path: referencePath,
          reference_sha256: 'a'.repeat(64),
          reference_pack_sha256: 'b'.repeat(64),
          duration_seconds: 13.24,
          provider_duration_seconds: 13,
          width: 1080,
          height: 1920,
          fps: 25,
          ...verifiedCutSheet(13.24),
        },
      }),
      (error) => error.code === 'VIDEO_REFERENCE_HASH_MISMATCH',
    );
    assert.equal(providerCalls, 0);
  });
});

test('reference-bound clip stays NEEDS_QA until reference adherence is proven', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const referencePath = path.join(dir, 'motion.mp4');
    const referenceBytes = Buffer.from('motion-reference-bytes');
    await writeFile(referencePath, referenceBytes);
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'mirror',
      sourceImagePath: sourcePath,
      lookBinding: { whiteBackgroundVerified: true },
      videoReference: {
        state: 'READY',
        reference_path: referencePath,
        reference_sha256: sha256(referenceBytes),
        reference_pack_sha256: 'f'.repeat(64),
        duration_seconds: 5,
        provider_duration_seconds: 5,
        width: 1080,
        height: 1920,
        fps: 25,
        ...verifiedCutSheet(5),
      },
    });
    const finalized = await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      ...makeStubQa({ width: 720, height: 1280, hasAudio: true }),
      composeFn: makeStubCompose(),
    });
    assert.equal(finalized.qa.pass, true);
    assert.equal(finalized.status, 'NEEDS_QA');
  });
});

test('reference adherence becomes PASS only with exact bindings and every semantic check', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('reference-qa-clip', {
      clipId: 'reference-qa-clip',
      jobId: 'job_reference_qa',
      status: 'NEEDS_QA',
      durationSeconds: 5,
      sourceSha256: 'a'.repeat(64),
      qa: { pass: true },
      identityItemQa: { pass: true },
      motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const result = await service.recordReferenceAdherenceQa('reference-qa-clip', {
      clip_id: 'reference-qa-clip',
      job_id: 'job_reference_qa',
      source_sha256: 'a'.repeat(64),
      motion_reference_sha256: 'b'.repeat(64),
      cut_coverage: microCutCoverage(),
      evaluator: 'test/reference-evaluator',
      checks: referenceTransferChecks(),
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.referenceAdherenceQa.pass, true);
    assert.match(result.referenceAdherenceQaSha256, /^[a-f0-9]{64}$/);
  });
});

test('reference QA can arrive before identity QA without permanently failing a valid clip', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('reference-first', {
      clipId: 'reference-first',
      jobId: 'job_reference_first',
      status: 'NEEDS_QA',
      durationSeconds: 5,
      sourceSha256: 'a'.repeat(64),
      qa: { pass: true },
      motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const referenceResult = await service.recordReferenceAdherenceQa('reference-first', {
      clip_id: 'reference-first',
      job_id: 'job_reference_first',
      source_sha256: 'a'.repeat(64),
      motion_reference_sha256: 'b'.repeat(64),
      cut_coverage: microCutCoverage(),
      checks: referenceTransferChecks(),
    });
    assert.equal(referenceResult.status, 'NEEDS_QA');
    const identityResult = await service.recordIdentityItemQa('reference-first', {
      clip_id: 'reference-first',
      job_id: 'job_reference_first',
      source_sha256: 'a'.repeat(64),
      results: {
        first: { decision: 'PASS' },
        last: { decision: 'PASS' },
      },
    });
    assert.equal(identityResult.status, 'PASS');
  });
});

test('one failed reference-adherence dimension blocks the clip', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('reference-qa-fail', {
      clipId: 'reference-qa-fail',
      jobId: 'job_reference_fail',
      status: 'NEEDS_QA',
      durationSeconds: 5,
      sourceSha256: 'a'.repeat(64),
      qa: { pass: true },
      identityItemQa: { pass: true },
      motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const checks = referenceTransferChecks('shot_sequence_and_transitions');
    const result = await service.recordReferenceAdherenceQa('reference-qa-fail', {
      clip_id: 'reference-qa-fail',
      job_id: 'job_reference_fail',
      source_sha256: 'a'.repeat(64),
      motion_reference_sha256: 'b'.repeat(64),
      cut_coverage: microCutCoverage({ decision: 'FAIL', referencePerformerVisible: true, visiblePeople: 'REFERENCE_PERFORMER' }),
      checks,
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.referenceAdherenceQa.pass, false);
  });
});

test('reference transfer QA refuses delivery when any covered cut exposes the reference performer', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('reference-performer-leak', {
      clipId: 'reference-performer-leak', jobId: 'job_reference_leak', status: 'NEEDS_QA',
      durationSeconds: 5, sourceSha256: 'a'.repeat(64), qa: { pass: true },
      identityItemQa: { pass: true }, motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const checks = referenceTransferChecks('no_reference_performer_pixels');
    const result = await service.recordReferenceAdherenceQa('reference-performer-leak', {
      clip_id: 'reference-performer-leak', job_id: 'job_reference_leak',
      source_sha256: 'a'.repeat(64), motion_reference_sha256: 'b'.repeat(64), checks,
      cut_coverage: microCutCoverage({ decision: 'FAIL', referencePerformerVisible: true, visiblePeople: 'REFERENCE_PERFORMER' }),
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.referenceAdherenceQa.cutCoverage.pass, false);
  });
});

// video-semantic-qa.js marks the deterministic exact-reference-copy path with a fixed
// `evaluator: 'deterministic/exact-reference-copy-v1'` string precisely so it can be told
// apart from an ordinary VLM rejection. Before this, both collapsed into the same generic
// VIDEO_REFERENCE_QA_FAILED, so a delivery that was byte-identical to the directing
// reference — meaning nothing was ever generated — was indistinguishable in the failure
// code from a normal creative rejection. A viewer or a QA report reading only failureCode
// could not tell "the model said no" from "the provider returned the reference itself".
test('an exact reference-copy delivery is reported with its own failure code, not the generic one', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('exact-copy-clip', {
      clipId: 'exact-copy-clip', jobId: 'job_exact_copy', status: 'NEEDS_QA',
      durationSeconds: 5, sourceSha256: 'a'.repeat(64), qa: { pass: true },
      identityItemQa: { pass: true }, motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const checks = referenceTransferChecks('subject_replacement_every_cut');
    const result = await service.recordReferenceAdherenceQa('exact-copy-clip', {
      clip_id: 'exact-copy-clip', job_id: 'job_exact_copy',
      source_sha256: 'a'.repeat(64), motion_reference_sha256: 'b'.repeat(64), checks,
      evaluator: 'deterministic/exact-reference-copy-v1',
      cut_coverage: microCutCoverage({ decision: 'FAIL', referencePerformerVisible: true, visiblePeople: 'REFERENCE_PERFORMER' }),
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.referenceAdherenceQa.cutCoverage.pass, false);
    const stored = await store.load('exact-copy-clip');
    assert.equal(stored.failureCode, 'VIDEO_REFERENCE_NOT_REPLACED');
  });
});

test('reference-performer leakage is cut into a hero-only delivery and must pass semantic QA again', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const originalPath = await store.saveVideo(
      'salvage-clip',
      Buffer.from('provider-video-with-reference-person'),
    );
    const referencePath = path.join(dir, 'reference.mp4');
    await writeFile(referencePath, Buffer.from('motion-reference-with-original-music'));
    const referenceSha = sha256(Buffer.from('motion-reference-with-original-music'));
    const salvageCalls = [];
    const service = new VideoService({
      provider,
      clipStore: store,
      fashionVideoReferenceResolver: async () => ({
        state: 'READY',
        reference_path: referencePath,
        reference_sha256: referenceSha,
      }),
      finalizer: {
        salvageFn: async (request) => {
          salvageCalls.push(request);
          await writeFile(request.outputVideoPath, Buffer.from('hero-only-with-reference-music'));
          return {
            outputVideoPath: request.outputVideoPath,
            durationSeconds: 3,
            segmentCount: request.segments.length,
            segments: request.segments,
            audioSource: 'MOTION_REFERENCE',
          };
        },
        probeFn: async () => ({
          durationSeconds: 3, width: 720, height: 1280, fps: 24, hasAudio: true,
        }),
        extractFrameFn: async () => new Uint8Array(20).fill(128),
      },
    });
    await store.save('salvage-clip', {
      clipId: 'salvage-clip', jobId: 'job_salvage', status: 'NEEDS_QA',
      mode: 'walk_stride', aspectRatio: '9:16', durationSeconds: 5,
      sourceSha256: 'a'.repeat(64), videoPath: originalPath,
      videoSha256: sha256(Buffer.from('provider-video-with-reference-person')),
      qa: { pass: true }, identityItemQa: { pass: true },
      motionReferenceBinding: { referenceId: 'style-salvage', sha256: referenceSha },
    });
    const leakCoverage = {
      sample_rate_fps: 4,
      cuts: [
        {
          cut_index: 0, start_ms: 0, end_ms: 1_000, sample_count: 4,
          output_frame_sha256s: ['1'.repeat(64)], reference_frame_sha256s: ['2'.repeat(64)],
          reference_performer_visible: false, visible_people: 'APPROVED_AVATAR_ONLY', decision: 'PASS',
        },
        {
          cut_index: 1, start_ms: 1_000, end_ms: 3_000, sample_count: 8,
          output_frame_sha256s: ['3'.repeat(64)], reference_frame_sha256s: ['4'.repeat(64)],
          reference_performer_visible: true, visible_people: 'REFERENCE_PERFORMER', decision: 'FAIL',
        },
        {
          cut_index: 2, start_ms: 3_000, end_ms: 5_000, sample_count: 8,
          output_frame_sha256s: ['5'.repeat(64)], reference_frame_sha256s: ['6'.repeat(64)],
          reference_performer_visible: false, visible_people: 'APPROVED_AVATAR_ONLY', decision: 'PASS',
        },
      ],
    };
    const leakChecks = referenceTransferCheckNames.map((name) => ({
      name,
      decision: [
        'subject_replacement_every_cut',
        'no_reference_performer_pixels',
        'identity_and_outfit_every_subject_cut',
      ].includes(name) ? 'FAIL' : 'PASS',
    }));
    const firstQa = await service.recordReferenceAdherenceQa('salvage-clip', {
      clip_id: 'salvage-clip', job_id: 'job_salvage', source_sha256: 'a'.repeat(64),
      motion_reference_sha256: referenceSha, evaluator: 'qa/coverage-v1',
      cut_coverage: leakCoverage, checks: leakChecks,
    });
    assert.equal(firstQa.status, 'NEEDS_QA');
    assert.equal(firstQa.salvage.status, 'NEEDS_QA');
    assert.deepEqual(salvageCalls[0].segments, [
      { start_ms: 0, end_ms: 1_000 },
      { start_ms: 3_000, end_ms: 5_000 },
    ]);
    let saved = await store.load('salvage-clip');
    assert.equal(saved.originalProviderVideoPath, originalPath);
    assert.equal(saved.deliveryDurationSeconds, 3);
    assert.equal(saved.qa.pass, true, 'bound reference audio is allowed only on the salvage derivative');

    const salvageSha = saved.videoSha256;
    const identityQa = await service.recordIdentityItemQa('salvage-clip', {
      clip_id: 'salvage-clip', job_id: 'job_salvage', source_sha256: 'a'.repeat(64),
      output_sha256: salvageSha,
      results: { first: { decision: 'PASS' }, last: { decision: 'PASS' } },
    });
    assert.equal(identityQa.status, 'NEEDS_QA');
    const finalQa = await service.recordReferenceAdherenceQa('salvage-clip', {
      clip_id: 'salvage-clip', job_id: 'job_salvage', source_sha256: 'a'.repeat(64),
      output_sha256: salvageSha, motion_reference_sha256: referenceSha,
      cut_coverage: microCutCoverage({ durationMs: 3_000 }),
      checks: referenceTransferChecks(),
    });
    assert.equal(finalQa.status, 'PASS');
    assert.equal(finalQa.salvage.status, 'PASS');
    saved = await store.load('salvage-clip');
    assert.equal(saved.salvageIdentityItemQa.pass, true);
    assert.equal(saved.salvageReferenceAdherenceQa.pass, true);
    assert.equal(saved.status, 'PASS');
  });
});

test('reference leakage salvages PASSed hero cuts even when rejected cuts fail another creative dimension', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const originalPath = await store.saveVideo('repairable-creative-fail', Buffer.from('provider-result'));
    const referencePath = path.join(dir, 'reference.mp4');
    await writeFile(referencePath, Buffer.from('reference'));
    const referenceSha = sha256(Buffer.from('reference'));
    let salvageCalls = 0;
    const service = new VideoService({
      provider,
      clipStore: store,
      fashionVideoReferenceResolver: async () => ({
        state: 'READY', reference_path: referencePath, reference_sha256: referenceSha,
      }),
      finalizer: {
        salvageFn: async ({ outputVideoPath, segments }) => {
          salvageCalls += 1;
          await writeFile(outputVideoPath, Buffer.from('hero-only'));
          return {
            durationSeconds: 2, segmentCount: segments.length, segments,
            audioSource: 'MOTION_REFERENCE', audioPolicy: 'REFERENCE_REQUIRED',
          };
        },
        probeFn: async () => ({ durationSeconds: 2, width: 720, height: 1280, hasAudio: true }),
        extractFrameFn: async () => new Uint8Array(20).fill(128),
      },
    });
    await store.save('repairable-creative-fail', {
      clipId: 'repairable-creative-fail', jobId: 'job_repairable', status: 'NEEDS_QA',
      durationSeconds: 5, aspectRatio: '9:16', sourceSha256: 'a'.repeat(64),
      videoPath: originalPath, videoSha256: sha256(Buffer.from('provider-result')),
      qa: { pass: true }, identityItemQa: { pass: true },
      audioBinding: { policy: 'REFERENCE_REQUIRED' },
      motionReferenceBinding: { referenceId: 'style', sha256: referenceSha },
    });
    const checks = referenceTransferCheckNames.map((name) => ({
      name,
      decision: ['no_reference_performer_pixels', 'camera_and_framing'].includes(name)
        ? 'FAIL' : 'PASS',
    }));
    const result = await service.recordReferenceAdherenceQa('repairable-creative-fail', {
      clip_id: 'repairable-creative-fail', job_id: 'job_repairable',
      source_sha256: 'a'.repeat(64), motion_reference_sha256: referenceSha, checks,
      cut_coverage: {
        sample_rate_fps: 2,
        cuts: [
          { cut_index: 0, start_ms: 0, end_ms: 2_000, sample_count: 4,
            output_frame_sha256s: ['1'.repeat(64)], reference_frame_sha256s: ['2'.repeat(64)],
            reference_performer_visible: false, visible_people: 'APPROVED_AVATAR_ONLY', decision: 'PASS' },
          { cut_index: 1, start_ms: 2_000, end_ms: 5_000, sample_count: 6,
            output_frame_sha256s: ['3'.repeat(64)], reference_frame_sha256s: ['4'.repeat(64)],
            reference_performer_visible: true, visible_people: 'REFERENCE_PERFORMER', decision: 'FAIL' },
        ],
      },
    });
    assert.equal(result.status, 'NEEDS_QA');
    assert.equal(result.salvage.status, 'NEEDS_QA');
    assert.equal(salvageCalls, 1);
  });
});

test('fresh salvage safety failure persists an explicit terminal failure code', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('failed-salvage-review', {
      clipId: 'failed-salvage-review', jobId: 'job_failed_salvage', status: 'NEEDS_QA',
      durationSeconds: 5, deliveryDurationSeconds: 3, sourceSha256: 'a'.repeat(64),
      videoSha256: 'b'.repeat(64), qa: { pass: true },
      salvage: { status: 'NEEDS_QA', segments: [{ start_ms: 0, end_ms: 3_000 }] },
      salvageIdentityItemQa: { pass: true },
      motionReferenceBinding: { sha256: 'c'.repeat(64) },
    });
    const result = await service.recordReferenceAdherenceQa('failed-salvage-review', {
      clip_id: 'failed-salvage-review', job_id: 'job_failed_salvage',
      source_sha256: 'a'.repeat(64), motion_reference_sha256: 'c'.repeat(64),
      output_sha256: 'b'.repeat(64),
      cut_coverage: microCutCoverage({ durationMs: 3_000 }),
      checks: referenceTransferChecks('no_reference_performer_pixels'),
    });
    assert.equal(result.status, 'FAIL');
    const persisted = await store.load('failed-salvage-review');
    assert.equal(persisted.failureCode, 'VIDEO_SALVAGE_REFERENCE_QA_FAILED');
    assert.equal(persisted.salvage.status, 'FAIL');
  });
});

test('one localized leak in a salvage creates one hash-bound boundary repair', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const videoPath = await store.saveVideo('boundary-repair', Buffer.from('salvage-v1'));
    const clipDir = store.clipDir('boundary-repair');
    const referenceBytes = Buffer.from('locked-reference');
    await writeFile(path.join(clipDir, 'style-reference.mp4'), referenceBytes);
    let salvageCalls = 0;
    const service = new VideoService({
      provider,
      clipStore: store,
      finalizer: {
        salvageFn: async ({ outputVideoPath, segments }) => {
          salvageCalls += 1;
          await writeFile(outputVideoPath, Buffer.from('salvage-v2'));
          return {
            durationSeconds: 2, segmentCount: segments.length, segments,
            audioSource: 'MOTION_REFERENCE', audioPolicy: 'REFERENCE_REQUIRED',
          };
        },
        probeFn: async () => ({ durationSeconds: 2, width: 720, height: 1280, hasAudio: true }),
        extractFrameFn: async () => new Uint8Array(20).fill(128),
      },
    });
    await store.save('boundary-repair', {
      clipId: 'boundary-repair', jobId: 'job_boundary', status: 'NEEDS_QA',
      durationSeconds: 5, deliveryDurationSeconds: 3, aspectRatio: '9:16',
      sourceSha256: 'a'.repeat(64), videoPath, videoSha256: sha256(Buffer.from('salvage-v1')),
      qa: { pass: true }, salvageIdentityItemQa: { pass: true },
      audioBinding: { policy: 'REFERENCE_REQUIRED' },
      salvage: { status: 'NEEDS_QA', revision: 0, segments: [{ start_ms: 0, end_ms: 3_000 }] },
      motionReferenceBinding: {
        sha256: sha256(referenceBytes), audioSourceFile: 'style-reference.mp4',
      },
    });
    const result = await service.recordReferenceAdherenceQa('boundary-repair', {
      clip_id: 'boundary-repair', job_id: 'job_boundary', source_sha256: 'a'.repeat(64),
      motion_reference_sha256: sha256(referenceBytes), output_sha256: sha256(Buffer.from('salvage-v1')),
      cut_coverage: {
        sample_rate_fps: 2,
        cuts: [
          { cut_index: 0, start_ms: 0, end_ms: 2_000, sample_count: 4,
            output_frame_sha256s: ['1'.repeat(64)], reference_frame_sha256s: ['2'.repeat(64)],
            reference_performer_visible: false, visible_people: 'APPROVED_AVATAR_ONLY', decision: 'PASS' },
          { cut_index: 1, start_ms: 2_000, end_ms: 3_000, sample_count: 2,
            output_frame_sha256s: ['3'.repeat(64)], reference_frame_sha256s: ['4'.repeat(64)],
            reference_performer_visible: true, visible_people: 'REFERENCE_PERFORMER', decision: 'FAIL' },
        ],
      },
      checks: referenceTransferChecks('no_reference_performer_pixels'),
    });
    assert.equal(result.status, 'NEEDS_QA');
    const persisted = await store.load('boundary-repair');
    assert.equal(salvageCalls, 1);
    assert.equal(persisted.salvage.revision, 1);
    assert.equal(persisted.salvage.status, 'NEEDS_QA');
    assert.match(persisted.videoPath, /clip-salvaged-v2\.mp4$/);
    assert.equal(persisted.salvageIdentityItemQa, null);
    assert.equal(persisted.salvageReferenceAdherenceQa, null);
  });
});

test('hero-only salvage accepts safe approved spans while preserving creative losses as audit evidence', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('safe-short-salvage', {
      clipId: 'safe-short-salvage', jobId: 'job_safe_short', status: 'FAIL',
      durationSeconds: 13, deliveryDurationSeconds: 6, sourceSha256: 'a'.repeat(64),
      videoSha256: 'b'.repeat(64), qa: { pass: true },
      salvage: { status: 'FAIL', segments: [{ start_ms: 0, end_ms: 6_000 }] },
      salvageIdentityItemQa: { pass: true },
      motionReferenceBinding: { sha256: 'c'.repeat(64) },
    });
    const creativeFailures = new Set([
      'cut_coverage_complete',
      'subject_replacement_every_cut',
      'motion_and_pose_timing',
      'camera_and_framing',
      'environment_and_lighting',
      'grade_and_optical_effects',
      'shot_sequence_and_transitions',
    ]);
    const result = await service.recordReferenceAdherenceQa('safe-short-salvage', {
      clip_id: 'safe-short-salvage', job_id: 'job_safe_short',
      source_sha256: 'a'.repeat(64), motion_reference_sha256: 'c'.repeat(64),
      output_sha256: 'b'.repeat(64),
      cut_coverage: microCutCoverage({ durationMs: 6_000 }),
      checks: REQUIRED_REFERENCE_CHECKS.map((name) => ({
        name,
        decision: creativeFailures.has(name) ? 'FAIL' : 'PASS',
      })),
    });
    assert.equal(result.status, 'PASS');
    const persisted = await store.load('safe-short-salvage');
    assert.equal(persisted.failureCode, null);
    assert.equal(persisted.salvage.status, 'PASS');
    assert.equal(persisted.salvageReferenceAdherenceQa.pass, true);
    assert.equal(
      persisted.salvageReferenceAdherenceQa.acceptanceContract,
      'SALVAGE_HERO_ONLY_V1',
    );
    assert.deepEqual(
      persisted.salvageReferenceAdherenceQa.nonBlockingFailures,
      [...creativeFailures],
    );
  });
});

test('awaitAndFinalize downloads video, runs QA, and marks PASS', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
    });

    const result = await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      ...makeStubQa(),
    });

    assert.equal(result.status, 'PASS');
    assert.ok(result.videoSha256);
    assert.equal(result.qa.pass, true);
    assert.equal(result.qa.defects.length, 0);
  });
});

test('awaitAndFinalize rejects unapproved audio only when a silent delivery is required', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
    });

    const result = await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      ...makeStubQa({ hasAudio: true }),
    });

    assert.equal(result.status, 'FAIL');
    assert.equal(result.qa.pass, false);
    assert.ok(result.qa.defects.some((d) => d.code === 'CLIP_UNAUTHORIZED_AUDIO'));
  });
});

test('awaitAndFinalize marks a missing provider job FAILED without a second create', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const provider = {
      async createJob() { return { jobId: 'missing-job', providerKey: 'higgsfield' }; },
      async waitForJob() {
        const error = new Error('job vanished');
        error.code = 'PROVIDER_JOB_NOT_FOUND';
        throw error;
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const created = await service.createClip({
      modeId: 'editorial_micro_moment', surfaceId: 'tv', sourceImagePath: sourcePath,
    });
    await assert.rejects(
      () => service.awaitAndFinalize(created.clipId, { downloadFn: makeStubDownload(), ...makeStubQa() }),
      (error) => error.code === 'VIDEO_PROVIDER_JOB_NOT_FOUND',
    );
    const persisted = await store.load(created.clipId);
    assert.equal(persisted.status, 'FAILED');
    assert.equal(persisted.failureCode, 'VIDEO_PROVIDER_JOB_NOT_FOUND');
  });
});

test('awaitAndFinalize persists a failed provider job instead of polling it forever', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const provider = {
      async createJob() { return { jobId: 'failed-job', providerKey: 'higgsfield' }; },
      async waitForJob() {
        const error = new Error('provider marked job failed');
        error.code = 'PROVIDER_JOB_FAILED';
        throw error;
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const created = await service.createClip({
      modeId: 'editorial_micro_moment', surfaceId: 'tv', sourceImagePath: sourcePath,
    });
    await assert.rejects(
      () => service.awaitAndFinalize(created.clipId, { downloadFn: makeStubDownload(), ...makeStubQa() }),
      (error) => error.code === 'VIDEO_PROVIDER_JOB_FAILED',
    );
    const persisted = await store.load(created.clipId);
    assert.equal(persisted.status, 'FAILED');
    assert.equal(persisted.failureCode, 'VIDEO_PROVIDER_JOB_FAILED');
    assert.equal(persisted.providerTerminal.jobId, 'failed-job');
    assert.equal(persisted.providerTerminal.retryable, true);
    assert.equal(persisted.providerWaitLease, undefined);
  });
});

test('awaitAndFinalize persists terminal missing video output instead of leaving GENERATING', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const provider = {
      async createJob() { return { jobId: 'no-output-job', providerKey: 'higgsfield' }; },
      async waitForJob() {
        const error = new Error('completed without video output');
        error.code = 'MISSING_VIDEO_OUTPUT';
        throw error;
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const created = await service.createClip({
      modeId: 'editorial_micro_moment', surfaceId: 'tv', sourceImagePath: sourcePath,
    });
    await assert.rejects(
      () => service.awaitAndFinalize(created.clipId, { downloadFn: makeStubDownload(), ...makeStubQa() }),
      (error) => error.code === 'MISSING_VIDEO_OUTPUT',
    );
    const persisted = await store.load(created.clipId);
    assert.equal(persisted.status, 'FAILED');
    assert.equal(persisted.failureCode, 'MISSING_VIDEO_OUTPUT');
    assert.equal(persisted.providerTerminal.jobId, 'no-output-job');
    assert.equal(persisted.providerTerminal.retryable, true);
    assert.equal(persisted.providerWaitLease, undefined);
  });
});

test('a download failure is distinct and resumes from the captured provider URL without polling again', async () => {
  await withTempDir(async (dir, sourcePath) => {
    let waitCalls = 0;
    const provider = {
      async createJob() { return { jobId: 'download-job', providerKey: 'higgsfield' }; },
      async waitForJob() {
        waitCalls += 1;
        return {
          jobId: 'download-job',
          url: 'https://cdn.example/generated-output.mp4',
          selectedFieldPath: '/result_url',
          raw: { job_id: 'download-job', result_url: 'https://cdn.example/generated-output.mp4' },
        };
      },
    };
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const created = await service.createClip({
      modeId: 'editorial_micro_moment', surfaceId: 'tv', sourceImagePath: sourcePath,
    });

    await assert.rejects(
      () => service.awaitAndFinalize(created.clipId, {
        downloadFn: async () => { throw Object.assign(new Error('upstream timeout'), { code: 'VIDEO_DOWNLOAD_FAILED' }); },
        ...makeStubQa(),
      }),
      (error) => error.code === 'VIDEO_OUTPUT_DOWNLOAD_FAILED',
    );
    let persisted = await store.load(created.clipId);
    assert.equal(persisted.status, 'OUTPUT_DOWNLOAD_FAILED');
    assert.equal(persisted.failureCode, 'VIDEO_OUTPUT_DOWNLOAD_FAILED');
    assert.equal(persisted.providerOutputUrl, 'https://cdn.example/generated-output.mp4');
    assert.equal(waitCalls, 1);

    const resumed = await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      ...makeStubQa(),
    });
    assert.equal(resumed.status, 'PASS');
    assert.equal(waitCalls, 1);
    persisted = await store.load(created.clipId);
    assert.equal(persisted.status, 'PASS');
  });
});

test('awaitAndFinalize rejects provider bytes equal to the locked motion reference before QA', async () => {
  await withTempDir(async (dir) => {
    const referenceBytes = Buffer.from('exact-private-motion-reference');
    const referenceSha256 = sha256(referenceBytes);
    const { provider } = makeStubProvider({ jobId: 'job_wrong_artifact' });
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('wrong-artifact-clip', {
      clipId: 'wrong-artifact-clip',
      status: 'CREATED',
      jobId: 'job_wrong_artifact',
      providerKey: 'higgsfield',
      motionReferenceBinding: { sha256: referenceSha256 },
    });

    let probeCalls = 0;
    await assert.rejects(
      () => service.awaitAndFinalize('wrong-artifact-clip', {
        downloadFn: async () => referenceBytes,
        probeFn: async () => { probeCalls += 1; return {}; },
        extractFrameFn: async () => new Uint8Array(10),
      }),
      (error) => error.code === 'VIDEO_PROVIDER_OUTPUT_IS_REFERENCE',
    );
    assert.equal(probeCalls, 0);
    const persisted = await store.load('wrong-artifact-clip');
    assert.equal(persisted.status, 'FAIL');
    assert.equal(persisted.failureCode, 'VIDEO_PROVIDER_OUTPUT_IS_REFERENCE');
    assert.equal(persisted.providerVideoSha256, referenceSha256);
    assert.equal(persisted.providerOutputFieldPath, '/results/0/url');
    assert.match(persisted.providerWaitReceiptSha256, /^[a-f0-9]{64}$/);
    const receipt = JSON.parse(await readFile(
      path.join(store.clipDir('wrong-artifact-clip'), persisted.providerWaitReceiptFile),
      'utf8',
    ));
    assert.equal(receipt.selected_field_path, '/results/0/url');
    assert.equal(receipt.selected_url_sanitized, 'https://cdn.example/clip.mp4');
  });
});

test('recordIdentityItemQa makes a semantic RETRY fail a technically valid clip', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('semantic-clip', {
      clipId: 'semantic-clip',
      jobId: 'job_semantic',
      status: 'PASS',
      sourceSha256: 'b'.repeat(64),
    });
    const receipt = {
      clip_id: 'semantic-clip',
      job_id: 'job_semantic',
      source_sha256: 'b'.repeat(64),
      evaluator: 'test/evaluator',
      results: {
        first: { decision: 'RETRY' },
        last: { decision: 'PASS' },
      },
    };
    const result = await service.recordIdentityItemQa('semantic-clip', receipt);
    assert.equal(result.status, 'FAIL');
    assert.deepEqual(result.identityItemQa, {
      pass: false,
      strictPass: false,
      advisory: false,
      firstDecision: 'RETRY',
      lastDecision: 'PASS',
      evaluator: 'test/evaluator',
    });
    assert.ok(result.identityItemQaSha256);
    const saved = await store.load('semantic-clip');
    assert.equal(saved.status, 'FAIL');
    assert.equal(saved.identityItemQaFile, 'identity-item-qa.json');
  });
});

test('delivery QA mode records visual misses but delivers an otherwise safe Fashion Video', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({
      provider,
      clipStore: store,
      fashionVideoQaMode: 'delivery',
    });
    await store.save('delivery-qa-clip', {
      clipId: 'delivery-qa-clip', jobId: 'job_delivery_qa', status: 'NEEDS_QA',
      durationSeconds: 5, sourceSha256: 'a'.repeat(64), qa: { pass: true },
      motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const identity = await service.recordIdentityItemQa('delivery-qa-clip', {
      clip_id: 'delivery-qa-clip', job_id: 'job_delivery_qa', source_sha256: 'a'.repeat(64),
      results: { first: { decision: 'RETRY' }, last: { decision: 'PASS' } },
    });
    assert.equal(identity.status, 'NEEDS_QA');
    assert.deepEqual(identity.identityItemQa, {
      pass: true,
      strictPass: false,
      advisory: true,
      firstDecision: 'RETRY',
      lastDecision: 'PASS',
      evaluator: null,
    });
    const reference = await service.recordReferenceAdherenceQa('delivery-qa-clip', {
      clip_id: 'delivery-qa-clip', job_id: 'job_delivery_qa',
      source_sha256: 'a'.repeat(64), motion_reference_sha256: 'b'.repeat(64),
      cut_coverage: microCutCoverage(),
      checks: referenceTransferChecks('camera_and_framing'),
    });
    assert.equal(reference.status, 'PASS');
    assert.equal(reference.referenceAdherenceQa.pass, true);
    assert.equal(reference.referenceAdherenceQa.strictPass, false);
    assert.equal(reference.referenceAdherenceQa.deliverySafetyPass, true);
    assert.deepEqual(reference.referenceAdherenceQa.nonBlockingFailures, ['camera_and_framing']);
  });
});

test('delivery QA mode treats model cut-completeness styling judgment as advisory when deterministic coverage is safe', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({
      provider,
      clipStore: store,
      fashionVideoQaMode: 'delivery',
    });
    await store.save('delivery-cut-style-clip', {
      clipId: 'delivery-cut-style-clip', jobId: 'job_delivery_cut_style', status: 'NEEDS_QA',
      durationSeconds: 5, sourceSha256: 'a'.repeat(64), qa: { pass: true },
      identityItemQa: { pass: true }, motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const result = await service.recordReferenceAdherenceQa('delivery-cut-style-clip', {
      clip_id: 'delivery-cut-style-clip', job_id: 'job_delivery_cut_style',
      source_sha256: 'a'.repeat(64), motion_reference_sha256: 'b'.repeat(64),
      cut_coverage: microCutCoverage(),
      checks: referenceTransferChecks('cut_coverage_complete'),
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.referenceAdherenceQa.pass, true);
    assert.equal(result.referenceAdherenceQa.strictPass, false);
    assert.equal(result.referenceAdherenceQa.deliverySafetyPass, true);
    assert.deepEqual(result.referenceAdherenceQa.blockingChecks, ['no_reference_performer_pixels']);
    assert.deepEqual(result.referenceAdherenceQa.nonBlockingFailures, ['cut_coverage_complete']);
  });
});

test('delivery QA mode still blocks a reference performer leak', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({
      provider,
      clipStore: store,
      fashionVideoQaMode: 'delivery',
    });
    await store.save('delivery-leak-clip', {
      clipId: 'delivery-leak-clip', jobId: 'job_delivery_leak', status: 'NEEDS_QA',
      durationSeconds: 5, sourceSha256: 'a'.repeat(64), qa: { pass: true },
      identityItemQa: { pass: true }, motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const result = await service.recordReferenceAdherenceQa('delivery-leak-clip', {
      clip_id: 'delivery-leak-clip', job_id: 'job_delivery_leak',
      source_sha256: 'a'.repeat(64), motion_reference_sha256: 'b'.repeat(64),
      cut_coverage: microCutCoverage({
        decision: 'FAIL', referencePerformerVisible: true, visiblePeople: 'REFERENCE_PERFORMER',
      }),
      checks: referenceTransferChecks('no_reference_performer_pixels'),
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.referenceAdherenceQa.pass, false);
    assert.equal(result.referenceAdherenceQa.deliverySafetyPass, false);
  });
});

test('reference-bound identity failure waits for per-cut salvage analysis instead of becoming a dead end', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    await store.save('semantic-reference-clip', {
      clipId: 'semantic-reference-clip', jobId: 'job_semantic_reference',
      status: 'NEEDS_QA', durationSeconds: 5,
      sourceSha256: 'c'.repeat(64), qa: { pass: true },
      motionReferenceBinding: { sha256: 'd'.repeat(64) },
    });
    const result = await service.recordIdentityItemQa('semantic-reference-clip', {
      clip_id: 'semantic-reference-clip', job_id: 'job_semantic_reference',
      source_sha256: 'c'.repeat(64),
      results: { first: { decision: 'RETRY' }, last: { decision: 'PASS' } },
    });
    assert.equal(result.status, 'NEEDS_QA');
    const persisted = await store.load('semantic-reference-clip');
    assert.equal(persisted.identityItemQa.pass, false);
    assert.equal(persisted.failureCode, null);

    const referenceResult = await service.recordReferenceAdherenceQa('semantic-reference-clip', {
      clip_id: 'semantic-reference-clip', job_id: 'job_semantic_reference',
      source_sha256: 'c'.repeat(64), motion_reference_sha256: 'd'.repeat(64),
      cut_coverage: microCutCoverage({ durationMs: 5_000 }),
      checks: referenceTransferChecks(),
    });
    assert.equal(referenceResult.status, 'FAIL');
  });
});

test('automatic QA consumes NEEDS_QA and returns a terminal retryable failure', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({
      provider,
      clipStore: store,
      automaticQaFn: async (clip) => ({
        identityReceipt: {
          clip_id: clip.clipId, job_id: clip.jobId, source_sha256: clip.sourceSha256,
          results: { first: { decision: 'RETRY' }, last: { decision: 'RETRY' } },
        },
        referenceReceipt: {
          clip_id: clip.clipId, job_id: clip.jobId, source_sha256: clip.sourceSha256,
          motion_reference_sha256: clip.motionReferenceBinding.sha256,
          cut_coverage: microCutCoverage({
            durationMs: 5_000, decision: 'FAIL',
            referencePerformerVisible: true, visiblePeople: 'REFERENCE_PERFORMER',
          }),
          checks: referenceTransferCheckNames.map((name) => ({
            name, decision: name === 'cut_coverage_complete' ? 'PASS' : 'FAIL',
          })),
        },
      }),
      finalizer: makeStubQa(),
    });
    await store.save('automatic-qa-clip', {
      clipId: 'automatic-qa-clip', jobId: 'automatic-job', status: 'NEEDS_QA',
      durationSeconds: 5, sourceSha256: 'a'.repeat(64), qa: { pass: true },
      motionReferenceBinding: { sha256: 'b'.repeat(64) },
    });
    const result = await service.finalizeClip('automatic-qa-clip');
    assert.equal(result.status, 'FAIL');
    const persisted = await store.load('automatic-qa-clip');
    assert.equal(persisted.identityItemQa.pass, false);
    assert.equal(persisted.referenceAdherenceQa.pass, false);
    assert.equal(persisted.failureCode, 'VIDEO_REFERENCE_QA_FAILED');
  });
});

test('automatic QA never persists a numeric process exit code as a public failure code', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const processError = new Error('ffmpeg failed');
    processError.code = 234;
    const service = new VideoService({
      provider,
      clipStore: store,
      automaticQaFn: async () => { throw processError; },
    });
    await store.save('numeric-error-clip', {
      clipId: 'numeric-error-clip', status: 'NEEDS_QA', videoSha256: 'a'.repeat(64),
    });
    const result = await service.runAutomaticQa('numeric-error-clip');
    assert.equal(result.failureCode, 'VIDEO_AUTOMATIC_QA_FAILED');
    const persisted = await store.load('numeric-error-clip');
    assert.equal(persisted.failureCode, 'VIDEO_AUTOMATIC_QA_FAILED');
  });
});

test('awaitAndFinalize marks NEEDS_QA when no probeFn provided', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
    });

    const result = await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      probeFn: undefined,
      extractFrameFn: undefined,
    });

    assert.equal(result.status, 'NEEDS_QA');
    assert.equal(result.qa, null);
  });
});

test('generateClip runs the full flow in one call', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider, calls } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const result = await service.generateClip(
      {
        modeId: 'garment_gesture',
        surfaceId: 'tv',
        sourceImagePath: sourcePath,
      },
      {
        downloadFn: makeStubDownload(),
        ...makeStubQa(),
      },
    );

    assert.equal(result.status, 'PASS');
    assert.ok(result.clipId);
    assert.ok(result.videoSha256);
    // Both phases should have been called
    assert.equal(calls.length, 2);
    assert.equal(calls[0].phase, 'create');
    assert.equal(calls[1].phase, 'wait');
  });
});

test('awaitAndFinalize on a non-existent clip throws CLIP_NOT_FOUND', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    await assert.rejects(
      () => service.awaitAndFinalize('nonexistent', { downloadFn: makeStubDownload() }),
      (error) => {
        assert.equal(error.code, 'CLIP_NOT_FOUND');
        return true;
      },
    );
  });
});

test('getClip returns persisted metadata', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const created = await service.createClip({
      modeId: 'camera_drift',
      surfaceId: 'mirror',
      sourceImagePath: sourcePath,
    });

    const loaded = await service.getClip(created.clipId);
    assert.ok(loaded);
    assert.equal(loaded.clipId, created.clipId);
    assert.equal(loaded.jobId, 'job_test_123');
    assert.equal(loaded.surface, 'mirror');
    assert.equal(loaded.aspectRatio, '9:16');
    assert.equal(loaded.providerKey, 'higgsfield');
    assert.equal(loaded.providerCreateAttempt, 1);
    assert.equal(loaded.fallbackUsed, false);
  });
});

test('resumableClipIds returns only persisted jobs that can continue after restart', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });
    const created = await service.createClip({
      modeId: 'camera_drift',
      surfaceId: 'mirror',
      sourceImagePath: sourcePath,
    });
    await store.save('22222222-2222-4222-8222-222222222222', {
      clipId: '22222222-2222-4222-8222-222222222222', status: 'PASS', jobId: 'old-job',
    });
    assert.deepEqual(await service.resumableClipIds(), [created.clipId]);
    const persisted = await store.load(created.clipId);
    await store.save(created.clipId, { ...persisted, status: 'GENERATING' });
    assert.deepEqual(await service.resumableClipIds(), [created.clipId]);
  });
});

test('awaitAndFinalize polls only the provider persisted at create time', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const calls = [];
    const provider = {
      async createJob() {
        return {
          jobId: 'openrouter-job-1',
          providerKey: 'openrouter',
          createAttempt: 1,
          fallbackUsed: true,
        };
      },
      async waitForJob(request) {
        calls.push(request);
        return { jobId: request.jobId, url: 'https://cdn.example/clip.mp4' };
      },
    };
    const service = new VideoService({ provider, clipStore: new ClipStore(dir) });
    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
    });

    await service.awaitAndFinalize(created.clipId, {
      downloadFn: makeStubDownload(),
      ...makeStubQa(),
    });

    assert.deepEqual(calls, [{
      jobId: 'openrouter-job-1',
      providerKey: 'openrouter',
    }]);
  });
});

test('VideoService refuses to construct without provider', () => {
  assert.throws(
    () => new VideoService({ clipStore: new ClipStore('/tmp') }),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISCONFIGURED');
      return true;
    },
  );
});

test('finalizeClip refuses a runtime without real download and ffprobe dependencies', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({
      provider,
      clipStore: store,
    });
    await store.save('missing-runtime', { clipId: 'missing-runtime', status: 'CREATED' });
    await assert.rejects(
      () => service.finalizeClip('missing-runtime'),
      (error) => error.code === 'FINALIZER_MISCONFIGURED' && error.status === 503,
    );
  });
});

test('finalizeClip resumes through configured runtime dependencies', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const service = new VideoService({
      provider,
      clipStore: new ClipStore(dir),
      finalizer: {
        downloadFn: makeStubDownload(),
        ...makeStubQa(),
      },
    });
    const created = await service.createClip({
      modeId: 'editorial_micro_moment',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
    });
    const finalized = await service.finalizeClip(created.clipId);
    assert.equal(finalized.status, 'PASS');
  });
});

test('VideoService refuses to construct without clipStore', () => {
  const { provider } = makeStubProvider();
  assert.throws(
    () => new VideoService({ provider }),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISCONFIGURED');
      return true;
    },
  );
});

test('ClipStore refuses to construct without root directory', () => {
  assert.throws(
    () => new ClipStore(''),
    (error) => {
      assert.equal(error.code, 'STORE_MISCONFIGURED');
      return true;
    },
  );
});

test('walk_stride mode is refused without full_length capability', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    await assert.rejects(
      () => service.createClip({
        modeId: 'walk_stride',
        surfaceId: 'tv',
        sourceImagePath: sourcePath,
        sourceCapabilities: {},
      }),
      (error) => {
        assert.equal(error.code, 'MOTION_MODE_SOURCE_MISMATCH');
        return true;
      },
    );
  });
});

test('walk_stride mode with full_length capability succeeds', async () => {
  await withTempDir(async (dir, sourcePath) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    const result = await service.createClip({
      modeId: 'walk_stride',
      surfaceId: 'tv',
      sourceImagePath: sourcePath,
      sourceCapabilities: { full_length: true },
    });

    assert.equal(result.plan.mode, 'walk_stride');
    assert.equal(result.status, 'CREATED');
  });
});

// registerVideoRoutes calls videoService.claimRetry(...) and
// videoService.completeRetryClaim(...) directly on the VideoService facade
// (see src/web/video-routes.js). Those methods were defined only on the
// private ClipStore, so every production retry click threw
// "videoService.claimRetry is not a function" before this delegation
// existed. This exercises the real, unmocked facade end to end so the
// route-level test's monkeypatched fixture cannot hide the gap again.
test('claimRetry and completeRetryClaim are callable on the VideoService facade, not just the store', async () => {
  await withTempDir(async (dir) => {
    const { provider } = makeStubProvider();
    const store = new ClipStore(dir);
    const service = new VideoService({ provider, clipStore: store });

    assert.equal(typeof service.claimRetry, 'function');
    assert.equal(typeof service.completeRetryClaim, 'function');

    const key = 'retry-key-that-is-long-enough-1234567890';
    const first = await service.claimRetry('parent-clip-1', key);
    assert.equal(first.created, true);
    assert.equal(first.claim.state, 'SUBMITTING');

    // A second claim with the same key must be idempotent, matching the
    // route's duplicate-tap handling.
    const duplicate = await service.claimRetry('parent-clip-1', key);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.claim.state, 'SUBMITTING');

    const completed = await service.completeRetryClaim(first.claimPath, 'child-clip-1');
    assert.equal(completed.state, 'CREATED');
    assert.equal(completed.child_clip_id, 'child-clip-1');
  });
});
