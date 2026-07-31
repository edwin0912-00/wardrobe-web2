import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VideoQaSalvageError,
  salvageVideoFromQa,
} from '../../src/web/video-qa-salvage.js';

test('salvage emits only approved spans and restores continuous reference audio', async () => {
  const calls = [];
  const result = await salvageVideoFromQa({
    sourceVideoPath: '/runtime/clip.mp4',
    referenceVideoPath: '/runtime/reference.mp4',
    outputVideoPath: '/runtime/clip-salvaged.mp4',
    segments: [
      { start_ms: 0, end_ms: 1_000 },
      { start_ms: 3_000, end_ms: 5_000 },
    ],
  }, {
    probeFn: async (videoPath) => videoPath.includes('reference')
      ? { durationSeconds: 13, hasAudio: true }
      : { durationSeconds: 5, hasAudio: false },
    commandRunner: async (binary, args) => calls.push({ binary, args }),
  });

  assert.equal(result.durationSeconds, 3);
  assert.equal(result.segmentCount, 2);
  assert.equal(result.audioSource, 'MOTION_REFERENCE');
  assert.equal(calls[0].binary, 'ffmpeg');
  const filter = calls[0].args[calls[0].args.indexOf('-filter_complex') + 1];
  assert.match(filter, /trim=start=0\.000:end=1\.000/);
  assert.match(filter, /trim=start=3\.000:end=5\.000/);
  assert.match(filter, /\[1:a:0\]atrim=duration=3\.000/);
  assert.ok(calls[0].args.includes('+faststart'));
});
test('salvage fails closed without original reference audio or enough hero footage', async () => {
  await assert.rejects(
    () => salvageVideoFromQa({
      sourceVideoPath: '/runtime/clip.mp4',
      referenceVideoPath: '/runtime/reference.mp4',
      outputVideoPath: '/runtime/out.mp4',
      segments: [{ start_ms: 0, end_ms: 1_000 }],
    }, {
      probeFn: async (videoPath) => ({
        durationSeconds: 5,
        hasAudio: !videoPath.includes('reference'),
      }),
      commandRunner: async () => {},
    }),
    (error) => error instanceof VideoQaSalvageError
      && error.code === 'VIDEO_QA_SALVAGE_REFERENCE_AUDIO_MISSING',
  );
  await assert.rejects(
    () => salvageVideoFromQa({
      sourceVideoPath: '/runtime/clip.mp4',
      referenceVideoPath: '/runtime/reference.mp4',
      outputVideoPath: '/runtime/out.mp4',
      segments: [{ start_ms: 0, end_ms: 999 }],
    }, {
      probeFn: async () => ({ durationSeconds: 5, hasAudio: true }),
      commandRunner: async () => {},
    }),
    (error) => error.code === 'VIDEO_QA_SALVAGE_TOO_SHORT',
  );
});
