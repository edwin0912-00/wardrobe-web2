import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assembleFashionVideoDelivery,
  VideoRuntimeError,
  createVideoRuntime,
  downloadVideoBytes,
} from '../../src/web/video-runtime.js';

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

test('runtime refuses incomplete paid-provider configuration', () => {
  assert.throws(
    () => createVideoRuntime({
      runtimeRoot: '/tmp/runtime',
      openRouterApiKey: '',
      assetUrlResolver: async () => 'https://assets.example/look.png',
      commandRunner: async () => ({ stdout: '{}', stderr: '' }),
    }),
    (error) => error.code === 'OPENROUTER_VIDEO_MISCONFIGURED',
  );
  assert.throws(
    () => createVideoRuntime({}),
    (error) => error instanceof VideoRuntimeError
      && error.code === 'VIDEO_RUNTIME_MISCONFIGURED',
  );
});
