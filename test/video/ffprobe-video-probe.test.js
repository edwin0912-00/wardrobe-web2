import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { probeVideo, extractFrame } from '../../src/web/ffprobe-video-probe.js';

const execFileAsync = promisify(execFile);

// These tests always run — they check exports and basic contract
test('probeVideo and extractFrame are exported functions', () => {
  assert.equal(typeof probeVideo, 'function');
  assert.equal(typeof extractFrame, 'function');
});

// Detect whether ffprobe/ffmpeg are available for integration tests
let ffprobeAvailable = false;
try {
  await execFileAsync('ffprobe', ['-version']);
  await execFileAsync('ffmpeg', ['-version']);
  ffprobeAvailable = true;
} catch {
  // tools not on PATH — skip integration tests
}

test('probeVideo rejects for a non-existent file', { skip: !ffprobeAvailable && 'ffprobe not found on PATH' }, async () => {
  await assert.rejects(
    () => probeVideo('/tmp/definitely-does-not-exist-12345.mp4'),
    /Failed to probe video/,
  );
});

test('extractFrame rejects for a non-existent file', { skip: !ffprobeAvailable && 'ffmpeg not found on PATH' }, async () => {
  await assert.rejects(
    () => extractFrame('/tmp/definitely-does-not-exist-12345.mp4', 'first'),
    /Failed to extract.*frame/,
  );
});

test('probeVideo reports dimensions, duration and FPS from real MP4 bytes', {
  skip: !ffprobeAvailable && 'ffprobe not found on PATH',
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-probe-'));
  const videoPath = path.join(directory, 'probe.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=160x90:r=24:d=1',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      videoPath,
    ]);
    const probe = await probeVideo(videoPath);
    assert.equal(probe.width, 160);
    assert.equal(probe.height, 90);
    assert.ok(Math.abs(probe.durationSeconds - 1) < 0.1);
    assert.ok(Math.abs(probe.fps - 24) < 0.01);
    assert.equal(probe.hasAudio, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
