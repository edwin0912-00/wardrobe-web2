import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createFalClient } from '@fal-ai/client';
import {
  FalVideoProvider,
  FalVideoProviderError,
  FAL_VIDEO_MODELS,
  FAL_VIDEO_POLICY_REJECTION_CODE,
  FAL_VIDEO_POLICY_REJECTION_MESSAGE,
  FAL_VIDEO_RESULT_REJECTION_CODE,
  falVideoModelCompatibility,
} from '../../src/providers/fal-video-provider.js';
import { sha256 } from '../../src/web/scene-contract.js';

const PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('approved-image'),
]);
const CUT_SHEET_SHA256 = 'c'.repeat(64);

async function withRequestFixture(run, { durationSeconds = 13.24, width = 1080, height = 1920 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fal-video-provider-'));
  try {
    const imagePath = path.join(root, 'approved-master.png');
    const videoPath = path.join(root, 'motion-reference.mp4');
    const imageBytes = PNG;
    const videoBytes = Buffer.from('verified-motion-reference');
    await writeFile(imagePath, imageBytes);
    await writeFile(videoPath, videoBytes);
    const request = {
      prompt: 'Reference bindings. @Video 1 is private reference-only directing material, never delivery media. Use it only to reconstruct its complete shot sequence, cut timing, transitions, action timing, pose choreography, camera movement, framing, environment, lighting, colour grade, optical effects, props and environmental text. @Image 1 is the approved master.',
      videoModel: 'seedance-2.0',
      mediaPaths: [imagePath],
      videoPaths: [videoPath],
      durationSeconds: Math.ceil(durationSeconds),
      aspectRatio: '9:16',
      sourceBinding: {
        sourceSha256: sha256(imageBytes),
        motionReferenceSha256: sha256(videoBytes),
      },
      appearanceReferences: [],
      referenceBindings: {
        schema_version: 'fashion-video-reference-bindings-v2',
        motion_reference: {
          role: 'motion_reference',
          provider_label: '@Video 1',
          sha256: sha256(videoBytes),
          duration_seconds: durationSeconds,
          width,
          height,
          fps: 25,
          cut_sheet_sha256: CUT_SHEET_SHA256,
        },
        images: [{
          role: 'approved_white_master',
          provider_label: '@Image 1',
          sha256: sha256(imageBytes),
        }],
      },
    };
    const { client, calls } = mockClient();
    await run({ root, imagePath, videoPath, imageBytes, videoBytes, request, client, calls });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function mockClient({ upload = async (file) => `https://fal.example/${file.name}`, submit, statuses = [], result } = {}) {
  const calls = { uploads: [], submits: [], statuses: [], results: [] };
  const client = {
    storage: {
      async upload(file, options) {
        calls.uploads.push({ file, options, bytes: Buffer.from(await file.arrayBuffer()) });
        return upload(file, options);
      },
    },
    queue: {
      async submit(endpoint, options) {
        calls.submits.push({ endpoint, options });
        return submit?.(endpoint, options) ?? {
          request_id: `fal-request-${calls.submits.length}`,
          status: 'IN_QUEUE',
        };
      },
      async status(endpoint, options) {
        calls.statuses.push({ endpoint, options });
        return statuses.shift() ?? { status: 'COMPLETED', request_id: options.requestId };
      },
      async result(endpoint, options) {
        calls.results.push({ endpoint, options });
        return result ?? {
          requestId: options.requestId,
          data: { video: { url: 'https://fal.example/result.mp4' } },
        };
      },
    },
  };
  return { client, calls };
}

test('Seedance 2.0 uploads approved images before motion video and keeps exact role/hash labels', async () => {
  await withRequestFixture(async ({ root, imageBytes, videoBytes, videoPath, request }) => {
    const identityBytes = Buffer.concat([PNG, Buffer.from('-identity')]);
    const garmentBytes = Buffer.concat([PNG, Buffer.from('-garment')]);
    const identityPath = path.join(root, 'identity-face.png');
    const garmentPath = path.join(root, 'garment-detail.png');
    await writeFile(identityPath, identityBytes);
    await writeFile(garmentPath, garmentBytes);
    request.mediaPaths.push(identityPath, garmentPath);
    request.appearanceReferences.push(
      { role: 'identity_face', sha256: sha256(identityBytes) },
      { role: 'garment_detail', sha256: sha256(garmentBytes) },
    );
    request.referenceBindings.images.push(
      { role: 'identity_face', provider_label: '@Image 2', sha256: sha256(identityBytes) },
      { role: 'garment_detail', provider_label: '@Image 3', sha256: sha256(garmentBytes) },
    );
    request.prompt += ' @Image 2 is optional face detail. @Image 3 is the garment card.';
    const { client, calls } = mockClient();
    const commandCalls = [];
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      clientFactory: () => client,
      probeVideoFn: async (filePath) => filePath === videoPath
        ? { durationSeconds: 13.24, width: 1080, height: 1920, fps: 25, hasAudio: true }
        : { durationSeconds: 13.24, width: 626, height: 1112, fps: 25, hasAudio: false },
      commandRunner: async (_binary, args) => {
        commandCalls.push(args);
        await writeFile(args.at(-1), Buffer.from('normalized-reference'));
      },
    });

    const created = await provider.createJob(request);
    assert.equal(created.providerKey, 'fal');
    assert.equal(created.videoModel, 'seedance-2.0');
    assert.equal(created.providerEndpoint, FAL_VIDEO_MODELS['seedance-2.0'].endpoint);
    assert.equal(created.requestId, created.jobId);
    assert.equal(calls.uploads.length, 4);
    assert.deepEqual(calls.uploads.map(({ file }) => file.name), [
      'image-1.png', 'image-2.png', 'image-3.png', 'motion-reference.mp4',
    ]);
    assert.deepEqual(calls.uploads.map(({ file }) => file.type), [
      'image/png', 'image/png', 'image/png', 'video/mp4',
    ]);
    const { endpoint, options } = calls.submits[0];
    assert.equal(endpoint, 'bytedance/seedance-2.0/reference-to-video');
    assert.deepEqual(options.input.image_urls, [
      'https://fal.example/image-1.png',
      'https://fal.example/image-2.png',
      'https://fal.example/image-3.png',
    ]);
    assert.deepEqual(options.input.video_urls, ['https://fal.example/motion-reference.mp4']);
    assert.equal(options.input.duration, '14');
    assert.equal(options.input.resolution, '720p');
    assert.equal(options.input.codec, 'H264');
    assert.equal(options.input.generate_audio, false);
    assert.equal(options.input.task, undefined);
    assert.match(options.input.prompt, /@Video1 is private motion-only reference material/);
    assert.match(options.input.prompt, /@Image1 is the approved master/);
    assert.match(options.input.prompt, /@Image2 is optional face detail/);
    assert.match(options.input.prompt, /@Image3 is the garment card/);
    assert.doesNotMatch(options.input.prompt, /@(?:Image|Video)\s+\d/);
    assert.ok(commandCalls[0].includes('-an'));
    assert.ok(!commandCalls[0].includes('atempo'));
    assert.equal((await readFile(videoPath)).toString(), videoBytes.toString());
    assert.deepEqual(created.inputMedia.files.map(({ role, source_sha256, provider_label }) => ({
      role, source_sha256, provider_label,
    })), [
      { role: 'approved_white_master', source_sha256: sha256(imageBytes), provider_label: '@Image1' },
      { role: 'identity_face', source_sha256: sha256(identityBytes), provider_label: '@Image2' },
      { role: 'garment_detail', source_sha256: sha256(garmentBytes), provider_label: '@Image3' },
      { role: 'motion_reference', source_sha256: sha256(videoBytes), provider_label: '@Video1' },
    ]);
    assert.equal(created.inputMedia.files[3].normalization.duration_preserved, true);
    assert.equal(created.inputMedia.files[3].normalization.cut_sheet_sha256, CUT_SHEET_SHA256);
    assert.ok(created.inputMedia.files.every((file) => file.url.startsWith('https://')));
  });
});

test('Seedance 2.5 uses its exact reference endpoint and resumes by persisted endpoint and request id', async () => {
  await withRequestFixture(async ({ videoPath, request }) => {
    request.videoModel = 'seedance-2.5';
    request.durationSeconds = 16;
    request.referenceBindings.motion_reference.duration_seconds = 15.16;
    const { client, calls } = mockClient({
      submit: () => ({ request_id: 'seedance-25-id', status: 'IN_QUEUE' }),
      statuses: [
        { status: 'IN_PROGRESS', request_id: 'seedance-25-id' },
        { status: 'COMPLETED', request_id: 'seedance-25-id' },
      ],
    });
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      clientFactory: () => client,
      probeVideoFn: async () => ({ durationSeconds: 15.16, width: 1080, height: 1920, fps: 25, hasAudio: false }),
      sleep: async () => {},
      pollIntervalMs: 0,
    });
    const created = await provider.createJob(request);
    assert.equal(created.jobId, 'seedance-25-id');
    assert.equal(created.providerEndpoint, 'bytedance/seedance-2.5/reference-to-video');
    assert.equal(calls.submits[0].options.input.task, 'reference');
    assert.equal(calls.submits[0].options.input.duration, '16');
    const finished = await provider.waitForJob({
      jobId: 'seedance-25-id',
      providerRequestId: 'seedance-25-id',
      providerEndpoint: created.providerEndpoint,
      videoModel: created.videoModel,
    });
    assert.equal(finished.url, 'https://fal.example/result.mp4');
    assert.deepEqual(calls.statuses.map(({ endpoint, options }) => [endpoint, options.requestId]), [
      ['bytedance/seedance-2.5/reference-to-video', 'seedance-25-id'],
      ['bytedance/seedance-2.5/reference-to-video', 'seedance-25-id'],
    ]);
    assert.deepEqual(calls.results, [{
      endpoint: 'bytedance/seedance-2.5/reference-to-video',
      options: { requestId: 'seedance-25-id' },
    }]);
    await assert.rejects(
      () => provider.waitForJob({
        jobId: 'seedance-25-id',
        providerRequestId: 'seedance-25-id',
        providerEndpoint: 'bytedance/seedance-2.0/reference-to-video',
        videoModel: 'seedance-2.5',
      }),
      (error) => error.code === 'PROVIDER_JOB_BINDING_MISMATCH',
    );
    assert.equal(calls.statuses.length, 2);
    assert.ok(videoPath.endsWith('motion-reference.mp4'));
  });
});

test('content policy violations at FAL create time are terminal and expose only safe copy', async () => {
  await withRequestFixture(async ({ client, request }) => {
    request.videoModel = 'seedance-2.5';
    const actualResponseShape = Object.assign(new Error('Untrusted partner response text'), {
      status: 422,
      body: {
        detail: [{
          type: 'content_policy_violation',
          msg: 'The images or videos provided may contain likenesses of real people or other private information that cannot be processed.',
          ctx: { extra_info: { reason: 'partner_validation_failed' } },
        }],
      },
    });
    client.queue.submit = async () => { throw actualResponseShape; };
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      clientFactory: () => client,
      probeVideoFn: async () => ({
        durationSeconds: 13.24, width: 1080, height: 1920, fps: 25, hasAudio: false,
      }),
      commandRunner: async (_binary, args) => writeFile(args.at(-1), Buffer.from('compatible-video')),
    });
    await assert.rejects(
      () => provider.createJob(request),
      (error) => error.code === FAL_VIDEO_POLICY_REJECTION_CODE
        && error.retryable === false
        && error.message === FAL_VIDEO_POLICY_REJECTION_MESSAGE
        && !error.message.includes('real people'),
    );
  });
});

test('content policy and generic 400/422 result errors are terminal, while request ids remain bound', async () => {
  await withRequestFixture(async ({ client }) => {
    const policyResponse = Object.assign(new Error('Untrusted partner response text'), {
      status: 422,
      body: {
        detail: [{
          type: 'content_policy_violation',
          msg: 'The images or videos provided may contain likenesses of real people or other private information that cannot be processed.',
          ctx: { extra_info: { reason: 'partner_validation_failed' } },
        }],
      },
    });
    client.queue.status = async (_endpoint, { requestId }) => ({
      status: 'COMPLETED', request_id: requestId,
    });
    client.queue.result = async () => { throw policyResponse; };
    const provider = new FalVideoProvider({ apiKey: 'test-key', client });
    await assert.rejects(
      () => provider.waitForJob({
        jobId: 'policy-job',
        providerRequestId: 'policy-job',
        providerEndpoint: FAL_VIDEO_MODELS['seedance-2.0'].endpoint,
        videoModel: 'seedance-2.0',
      }),
      (error) => error.code === FAL_VIDEO_POLICY_REJECTION_CODE
        && error.retryable === false
        && !error.message.includes('real people'),
    );

    for (const status of [400, 422]) {
      client.queue.result = async () => {
        throw Object.assign(new Error('Untrusted validation details'), {
          status,
          body: { detail: [{ type: 'value_error', msg: 'private validation details' }] },
        });
      };
      await assert.rejects(
        () => provider.waitForJob({
          jobId: 'policy-job',
          providerRequestId: 'policy-job',
          providerEndpoint: FAL_VIDEO_MODELS['seedance-2.0'].endpoint,
          videoModel: 'seedance-2.0',
        }),
        (error) => error.code === FAL_VIDEO_RESULT_REJECTION_CODE
          && error.retryable === false
          && !error.message.includes('private validation details'),
      );
    }
  });
});

test('Seedance 2.0 rejects an overlong motion reference before any upload or queue submit', async () => {
  await withRequestFixture(async ({ client, videoPath, request }) => {
    let uploadCount = 0;
    client.storage.upload = async () => { uploadCount += 1; return 'https://fal.example/file'; };
    request.videoModel = 'seedance-2.0';
    request.referenceBindings.motion_reference.duration_seconds = 15.16;
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      clientFactory: () => client,
      probeVideoFn: async () => ({ durationSeconds: 15.16, width: 1080, height: 1920, fps: 25, hasAudio: false }),
    });
    await assert.rejects(
      () => provider.createJob(request),
      (error) => error.code === 'VIDEO_MODEL_REFERENCE_DURATION_UNSUPPORTED',
    );
    assert.equal(uploadCount, 0);
    assert.equal((await readFile(videoPath)).length, Buffer.from('verified-motion-reference').length);
  });
});

test('per-style model compatibility blocks 2.0 over 15s and never truncates a 2.5 cut sheet past 30s', () => {
  const atFifteenPointSixteen = falVideoModelCompatibility({
    durationSeconds: 15.16, width: 1080, height: 1920, fps: 25, bytes: 100,
  });
  assert.equal(atFifteenPointSixteen.find(({ id }) => id === 'seedance-2.0').available, false);
  assert.equal(atFifteenPointSixteen.find(({ id }) => id === 'seedance-2.5').available, true);

  const atThirtySeconds = falVideoModelCompatibility({
    durationSeconds: 30, width: 1080, height: 1920, fps: 25, bytes: 100,
  });
  assert.equal(atThirtySeconds.find(({ id }) => id === 'seedance-2.5').available, true);
  const pastOutputLimit = falVideoModelCompatibility({
    durationSeconds: 30.01, width: 1080, height: 1920, fps: 25, bytes: 100,
  }).find(({ id }) => id === 'seedance-2.5');
  assert.equal(pastOutputLimit.available, false);
  assert.equal(pastOutputLimit.reason_code, 'VIDEO_MODEL_OUTPUT_DURATION_UNSUPPORTED');
  assert.match(pastOutputLimit.reason_uk, /не буде скорочено/);
});

test('an image over 30 MB is refused before upload', async () => {
  await withRequestFixture(async ({ client, imagePath, request }) => {
    await writeFile(imagePath, Buffer.alloc(30 * 1024 * 1024 + 1));
    let uploads = 0;
    client.storage.upload = async () => { uploads += 1; return 'https://fal.example/file'; };
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      clientFactory: () => client,
      probeVideoFn: async () => ({ durationSeconds: 13.24, width: 1080, height: 1920, fps: 25, hasAudio: false }),
    });
    await assert.rejects(
      () => provider.createJob(request),
      (error) => error.code === 'VIDEO_IMAGE_SIZE_UNSUPPORTED',
    );
    assert.equal(uploads, 0);
  });
});

test('a partial FAL storage upload never reaches paid queue submission', async () => {
  await withRequestFixture(async ({ client, request }) => {
    request.videoModel = 'seedance-2.5';
    let submitCalls = 0;
    client.storage.upload = async (file) => {
      if (file.name === 'motion-reference.mp4') throw new Error('upload interrupted');
      return `https://fal.example/${file.name}`;
    };
    client.queue.submit = async () => { submitCalls += 1; return { request_id: 'must-not-run' }; };
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      clientFactory: () => client,
      probeVideoFn: async () => ({ durationSeconds: 13.24, width: 1080, height: 1920, fps: 25, hasAudio: false }),
    });
    await assert.rejects(
      () => provider.createJob(request),
      (error) => error.code === 'VIDEO_INPUT_UPLOAD_FAILED'
        && error.providerInputMedia.files[0].role === 'approved_white_master',
    );
    assert.equal(submitCalls, 0);
  });
});

test('prompt privacy and aspect ratio are validated before external upload', async () => {
  await withRequestFixture(async ({ client, request }) => {
    let uploads = 0;
    client.storage.upload = async () => { uploads += 1; return 'https://fal.example/file'; };
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      clientFactory: () => client,
      probeVideoFn: async () => ({ durationSeconds: 13.24, width: 1080, height: 1920, fps: 25, hasAudio: false }),
    });
    const safePrompt = request.prompt;
    request.prompt = `${safePrompt} /Users/private/customer/source.png`;
    await assert.rejects(
      () => provider.createJob(request),
      (error) => error.code === 'UNSAFE_PROVIDER_PROMPT',
    );
    request.prompt = safePrompt;
    request.aspectRatio = '2:1';
    await assert.rejects(
      () => provider.createJob(request),
      (error) => error.code === 'VIDEO_MODEL_ASPECT_RATIO_UNSUPPORTED',
    );
    assert.equal(uploads, 0);
  });
});

test('a generic lost create response stays unknown without a second queue post', async () => {
  await withRequestFixture(async ({ client, request }) => {
    request.videoModel = 'seedance-2.5';
    let queuePosts = 0;
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      probeVideoFn: async () => ({ durationSeconds: 13.24, width: 1080, height: 1920, fps: 25, hasAudio: false }),
      fetchFn: async (input) => {
        if (new URL(input).hostname === 'queue.fal.run') {
          queuePosts += 1;
          throw new Error('response lost after dispatch');
        }
        throw new Error('unexpected external request');
      },
    });
    await assert.rejects(
      () => provider.createJob(request),
      (error) => error.code === 'CREATE_OUTCOME_UNKNOWN',
    );
    assert.equal(queuePosts, 1);
  });
});

test('SDK retries cannot duplicate a possibly accepted queue submit; a later independent clip can submit', async () => {
  await withRequestFixture(async ({ client, request }) => {
    request.videoModel = 'seedance-2.5';
    const networkQueuePosts = [];
    const fetchFn = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname !== 'queue.fal.run') throw new Error(`Unexpected request: ${url.hostname}`);
      networkQueuePosts.push({ url: url.href, input: JSON.parse(init.body) });
      if (networkQueuePosts.length === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({
        request_id: 'independent-second-job',
        status: 'IN_QUEUE',
        response_url: 'https://queue.fal.run/response',
        status_url: 'https://queue.fal.run/status',
        cancel_url: 'https://queue.fal.run/cancel',
        queue_position: 1,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new FalVideoProvider({
      apiKey: 'test-key',
      client,
      fetchFn,
      probeVideoFn: async () => ({ durationSeconds: 13.24, width: 1080, height: 1920, fps: 25, hasAudio: false }),
    });
    await assert.rejects(
      () => provider.createJob(request),
      (error) => error instanceof FalVideoProviderError && error.code === 'CREATE_OUTCOME_UNKNOWN',
    );
    assert.equal(networkQueuePosts.length, 1);
    const second = await provider.createJob(request);
    assert.equal(second.requestId, 'independent-second-job');
    assert.equal(networkQueuePosts.length, 2);
    assert.ok(networkQueuePosts.every(({ url }) => url.endsWith('/bytedance/seedance-2.5/reference-to-video')));
  });
});
