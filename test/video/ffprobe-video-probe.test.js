import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
