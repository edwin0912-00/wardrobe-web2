import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenRouterVideoError,
  OpenRouterVideoProvider,
} from '../../src/providers/openrouter-video-provider.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const request = Object.freeze({
  prompt: 'The subject holds the approved pose while the camera moves gently.',
  mediaPaths: ['/private/runtime/look.png'],
  aspectRatio: '9:16',
  durationSeconds: 6,
});

test('create submits one exact first frame with audio disabled', async () => {
  const calls = [];
  const resolverCalls = [];
  const provider = new OpenRouterVideoProvider({
    apiKey: 'test-key',
    assetUrlResolver: async (...args) => {
      resolverCalls.push(args);
      return 'https://assets.example/signed/look.png';
    },
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ id: 'openrouter-job-1', status: 'pending' }, 202);
    },
  });

  const sourceBinding = {
    clipId: 'clip-1',
    sourceSha256: 'a'.repeat(64),
    approvedLookReceiptSha256: 'b'.repeat(64),
  };
  const created = await provider.createJob({ ...request, sourceBinding });
  assert.equal(created.jobId, 'openrouter-job-1');
  assert.deepEqual(resolverCalls, [[request.mediaPaths[0], sourceBinding]]);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'bytedance/seedance-2.0');
  assert.equal(body.aspect_ratio, '9:16');
  assert.equal(body.duration, 6);
  assert.equal(body.generate_audio, false);
  assert.deepEqual(body.frame_images, [{
    type: 'image_url',
    image_url: { url: 'https://assets.example/signed/look.png' },
    frame_type: 'first_frame',
  }]);
  assert.ok(!calls[0].init.body.includes('/private/runtime'));
});

test('poll resumes the same job and returns its completed URL', async () => {
  const urls = [];
  const provider = new OpenRouterVideoProvider({
    apiKey: 'test-key',
    assetUrlResolver: async () => 'https://assets.example/look.png',
    pollIntervalMs: 0,
    maxPolls: 2,
    sleep: async () => {},
    fetchFn: async (url) => {
      urls.push(url);
      return jsonResponse(urls.length === 1
        ? { id: 'openrouter-job-1', status: 'processing' }
        : {
            id: 'openrouter-job-1',
            status: 'completed',
            unsigned_urls: ['https://cdn.example/result.mp4'],
          });
    },
  });

  const finished = await provider.waitForJob({ jobId: 'openrouter-job-1' });
  assert.equal(finished.url, 'https://cdn.example/result.mp4');
  assert.deepEqual(urls, [
    'https://openrouter.ai/api/v1/videos/openrouter-job-1',
    'https://openrouter.ai/api/v1/videos/openrouter-job-1',
  ]);
});

test('retryability follows HTTP status and never retries invalid input locally', async () => {
  const provider = new OpenRouterVideoProvider({
    apiKey: 'test-key',
    assetUrlResolver: async () => 'https://assets.example/look.png',
    fetchFn: async () => jsonResponse({ error: 'busy' }, 429),
  });
  await assert.rejects(
    () => provider.createJob(request),
    (error) => error.code === 'OPENROUTER_VIDEO_CREATE_FAILED' && error.retryable === true,
  );

  await assert.rejects(
    () => provider.createJob({ ...request, mediaPaths: [] }),
    (error) => error instanceof OpenRouterVideoError
      && error.code === 'MISSING_VIDEO_SOURCE'
      && error.retryable === false,
  );
});

test('terminal provider status cannot be mistaken for a retryable transport failure', async () => {
  const provider = new OpenRouterVideoProvider({
    apiKey: 'test-key',
    assetUrlResolver: async () => 'https://assets.example/look.png',
    pollIntervalMs: 0,
    maxPolls: 1,
    fetchFn: async () => jsonResponse({ id: 'job-1', status: 'failed', error: 'moderated' }),
  });
  await assert.rejects(
    () => provider.waitForJob({ jobId: 'job-1' }),
    (error) => error.code === 'OPENROUTER_VIDEO_JOB_FAILED' && error.retryable === false,
  );
});
