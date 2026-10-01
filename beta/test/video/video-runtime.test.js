import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assembleFashionVideoDelivery,
  VideoRuntimeError,
  createVideoRuntime,
  downloadVideoBytes,
} from '../../src/web/video-runtime.js';
import { ClipStore, VideoServiceError } from '../../src/web/video-service.js';
import { sha256 } from '../../src/web/scene-contract.js';

test('delivery assembly explicitly replaces provider audio with locked reference audio', async () => {
  const calls = [];
  const result = await assembleFashionVideoDelivery({
    providerVideoPath: '/tmp/provider.mp4',
    referenceVideoPath: '/tmp/reference.mp4',
    outputPath: '/tmp/delivery.mp4',
    probeFn: async () => ({ hasAudio: true }),
    commandRunner: async (binary, args) => { calls.push({ binary, args }); },
  });
  assert.equal(result.policy, 'REFERENCE_REQUIRED');
  assert.equal(result.referenceAudioAttached, true);
  assert.deepEqual(calls, [{
    binary: 'ffmpeg',
    args: [
      '-y', '-i', '/tmp/provider.mp4', '-i', '/tmp/reference.mp4',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', '/tmp/delivery.mp4',
    ],
  }]);
});

test('delivery assembly explicitly strips audio when the locked reference is silent', async () => {
  const calls = [];
  const result = await assembleFashionVideoDelivery({
    providerVideoPath: '/tmp/provider.mp4',
    referenceVideoPath: '/tmp/reference.mp4',
    outputPath: '/tmp/delivery.mp4',
    probeFn: async () => ({ hasAudio: false }),
    commandRunner: async (binary, args) => { calls.push({ binary, args }); },
  });
  assert.equal(result.policy, 'SILENT_REQUIRED');
  assert.equal(result.referenceAudioAttached, false);
  assert.ok(calls[0].args.includes('-an'));
  assert.deepEqual(calls[0].args.filter((value) => value === '-map'), ['-map']);
});

test('download accepts real HTTPS bytes and authenticates OpenRouter content', async () => {
  const calls = [];
  const bytes = await downloadVideoBytes(
    'https://openrouter.ai/api/v1/videos/job-1/content?index=0',
    {
      openRouterApiKey: 'test-key',
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(Buffer.from('mp4-bytes'), {
          status: 200,
          headers: { 'content-length': '9', 'content-type': 'video/mp4' },
        });
      },
    },
  );
  assert.equal(bytes.toString(), 'mp4-bytes');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
});

test('download refuses non-HTTPS and oversized provider output', async () => {
  await assert.rejects(
    () => downloadVideoBytes('http://cdn.example/clip.mp4'),
    (error) => error.code === 'VIDEO_DOWNLOAD_URL_INVALID',
  );
  await assert.rejects(
    () => downloadVideoBytes('https://cdn.example/clip.mp4', {
      maximumBytes: 5,
      fetchFn: async () => new Response(Buffer.from('123456'), {
        headers: { 'content-length': '6' },
      }),
    }),
    (error) => error.code === 'VIDEO_DOWNLOAD_TOO_LARGE',
  );
});

test('runtime boots with the new FAL provider and still requires a runtime root', () => {
  const runtime = createVideoRuntime({ runtimeRoot: '/tmp/runtime', falApiKey: 'test-fal-key' });
  assert.equal(typeof runtime.createClip, 'function');
  assert.throws(
    () => createVideoRuntime({}),
    (error) => error instanceof VideoRuntimeError
      && error.code === 'VIDEO_RUNTIME_MISCONFIGURED',
  );
});

test('new clips use FAL while OpenRouter is kept only for persisted legacy waits', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'fal-video-runtime-'));
  try {
    const imagePath = path.join(runtimeRoot, 'approved.png');
    const referencePath = path.join(runtimeRoot, 'style.mp4');
    const imageBytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('approved-master'),
    ]);
    const referenceBytes = Buffer.from('approved-motion-reference');
    await writeFile(imagePath, imageBytes);
    await writeFile(referencePath, referenceBytes);
    const createdClients = [];
    const providerSubmits = [];
    const falClientFactory = () => {
      const client = {
        storage: { upload: async (file) => `https://fal.example/${file.name}` },
        queue: {
          submit: async (endpoint, options) => {
            providerSubmits.push({ endpoint, options });
            return { request_id: 'new-fal-job', status: 'IN_QUEUE' };
          },
          status: async () => ({ status: 'IN_PROGRESS', request_id: 'new-fal-job' }),
          result: async () => ({ data: { video: { url: 'https://fal.example/result.mp4' } } }),
        },
      };
      createdClients.push(client);
      return client;
    };
    let openRouterCreates = 0;
    const runtime = createVideoRuntime({
      runtimeRoot,
      falApiKey: 'test-fal-key',
      openRouterApiKey: 'legacy-openrouter-key',
      assetUrlResolver: async () => {
        openRouterCreates += 1;
        return 'https://assets.example/legacy.png';
      },
      falClientFactory,
      probeVideoFn: async () => ({
        durationSeconds: 5, width: 720, height: 1280, fps: 25, hasAudio: false,
      }),
      commandRunner: async () => {},
      ffmpegRunner: async () => {},
      fetchFn: async () => new Response(JSON.stringify({
        id: 'legacy-openrouter-job',
        status: 'failed',
        error: 'terminal test fixture',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const cutSheet = {
      schema_version: '1.0.0',
      cuts: [{
        cut_index: 0,
        start_ms: 0,
        end_ms: 5000,
        subject_rule: 'APPROVED_AVATAR_OR_EMPTY',
        direction: 'Reconstruct the motion with the approved person only or an empty environment.',
      }],
    };
    const clip = await runtime.createClip({
      modeId: 'editorial_micro_moment',
      sourceImagePath: imagePath,
      lookBinding: {
        sourceSha256: sha256(imageBytes),
        approvedLookReceiptSha256: 'b'.repeat(64),
        whiteBackgroundVerified: true,
      },
      videoReference: {
        state: 'READY',
        reference_id: 'style-1',
        reference_path: referencePath,
        reference_sha256: sha256(referenceBytes),
        reference_pack_sha256: 'c'.repeat(64),
        duration_seconds: 5,
        provider_duration_seconds: 5,
        width: 720,
        height: 1280,
        fps: 25,
        cut_sheet: cutSheet,
        cut_sheet_sha256: sha256(Buffer.from(JSON.stringify(cutSheet))),
      },
      videoModel: 'seedance-2.5',
    });
    const persisted = await runtime.getClip(clip.clipId);
    assert.equal(persisted.providerKey, 'fal');
    assert.equal(persisted.videoModel, 'seedance-2.5');
    assert.equal(persisted.providerEndpoint, 'bytedance/seedance-2.5/reference-to-video');
    assert.equal(persisted.providerRequestId, 'new-fal-job');
    assert.equal(providerSubmits[0].endpoint, persisted.providerEndpoint);
    assert.equal(openRouterCreates, 0);

    const legacyClipId = '11111111-1111-4111-8111-111111111111';
    const store = new ClipStore(path.join(runtimeRoot, 'video-clips'));
    await store.save(legacyClipId, {
      clipId: legacyClipId,
      jobId: 'legacy-openrouter-job',
      providerKey: 'openrouter',
      status: 'CREATED',
      mode: 'editorial_micro_moment',
    });
    await assert.rejects(
      () => runtime.finalizeClip(legacyClipId),
      (error) => error instanceof VideoServiceError && error.code === 'VIDEO_PROVIDER_JOB_FAILED',
    );
    assert.equal(providerSubmits.length, 1, 'legacy recovery must not create a replacement FAL job');
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
