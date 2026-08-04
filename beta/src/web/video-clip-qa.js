// Clip QA: every check from the handoff, enforced from the actual bytes via
// ffprobe rather than trusting a provider flag.
//
// The handoff mandates five checks:
// 1. Duration is within the motion mode's window
// 2. Aspect ratio matches the requested surface
// 3. Delivery audio has approved provenance: source-reference audio only, or
//    silence when that reference has no audio. Provider audio never ships.
// 4. First frame is not black
// 5. Last frame is not black
//
// Both `probeFn` and `extractFrameFn` are injected — same pattern as the
// `commandRunner` in higgsfield-video-provider.js — so every test runs without
// ffprobe installed and without spending a credit.

export class ClipQaError extends Error {
  constructor(message, { code = 'CLIP_QA_ERROR' } = {}) {
    super(message);
    this.name = 'ClipQaError';
    this.code = code;
  }
}

// Mean luminance of raw RGB bytes. A truly black frame has mean ≈ 0; we use a
// generous threshold because compressed video rarely delivers exact zeros.
const BLACK_FRAME_THRESHOLD = 8;

function meanLuminance(rgbBytes) {
  if (!rgbBytes || rgbBytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rgbBytes.length; i++) sum += rgbBytes[i];
  return sum / rgbBytes.length;
}

function aspectsMatch(actualWidth, actualHeight, expectedRatio) {
  // expectedRatio is a string like '16:9' or '9:16'.
  const [w, h] = expectedRatio.split(':').map(Number);
  if (!w || !h) return false;
  // Compare by cross-multiplication to avoid floating-point drift.
  // Allow a tolerance of 1% because providers sometimes deliver frames that are
  // a pixel off in one dimension.
  const expected = w / h;
  const actual = actualWidth / actualHeight;
  return Math.abs(actual - expected) / expected < 0.01;
}

/**
 * Run all clip QA checks.
 *
 * @param {object} expected
 * @param {number} expected.durationMin   — minimum duration (seconds) from the mode
 * @param {number} expected.durationMax   — maximum duration (seconds) from the mode
 * @param {string} expected.aspectRatio   — e.g. '16:9'
 * @param {object} probeResult            — output of `probeFn(videoPath)`
 * @param {number} probeResult.durationSeconds
 * @param {number} probeResult.width
 * @param {number} probeResult.height
 * @param {boolean} probeResult.hasAudio
 * @param {Uint8Array|null} probeResult.firstFrameRgb
 * @param {Uint8Array|null} probeResult.lastFrameRgb
 * @returns {{ pass: boolean, defects: Array<{code: string, detail: string}> }}
 */
export function evaluateClipQa(expected, probeResult) {
  if (!probeResult || typeof probeResult !== 'object') {
    throw new ClipQaError('Probe result is required', { code: 'PROBE_MISSING' });
  }
  if (!expected || typeof expected !== 'object') {
    throw new ClipQaError('Expected clip contract is required', { code: 'EXPECTED_MISSING' });
  }

  const defects = [];

  // 1. Duration
  const dur = probeResult.durationSeconds;
  if (typeof dur !== 'number' || !Number.isFinite(dur)) {
    defects.push({ code: 'CLIP_DURATION_UNREADABLE', detail: 'Could not read duration from probe' });
  } else {
    // Allow half-second tolerance either side, matching receiptDefects in motion-contract.js
    if (dur < expected.durationMin - 0.5 || dur > expected.durationMax + 0.5) {
      defects.push({
        code: 'CLIP_DURATION_OUT_OF_RANGE',
        detail: `Expected ${expected.durationMin}–${expected.durationMax}s, got ${dur.toFixed(2)}s`,
      });
    }
  }

  // 2. Aspect
  if (expected.aspectRatio) {
    const { width, height } = probeResult;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      defects.push({ code: 'CLIP_GEOMETRY_UNREADABLE', detail: 'Could not read width/height from probe' });
    } else if (!aspectsMatch(width, height, expected.aspectRatio)) {
      defects.push({
        code: 'CLIP_ASPECT_MISMATCH',
        detail: `Expected ${expected.aspectRatio}, got ${width}x${height}`,
      });
    }
  }

  // 3. Audio provenance. `REFERENCE_REQUIRED` is set only after the runtime
  // has muxed the immutable Video 1 track into the generated picture. A
  // silent source reference deliberately produces a silent delivery.
  const audioPolicy = expected.audioPolicy ?? 'SILENT_REQUIRED';
  if (audioPolicy === 'REFERENCE_REQUIRED' && probeResult.hasAudio !== true) {
    defects.push({
      code: 'CLIP_REFERENCE_AUDIO_MISSING',
      detail: 'The delivery is missing the approved reference audio track',
    });
  } else if (audioPolicy === 'SILENT_REQUIRED' && probeResult.hasAudio === true) {
    defects.push({
      code: 'CLIP_UNAUTHORIZED_AUDIO',
      detail: 'Delivery carries audio although its approved reference is silent',
    });
  } else if (!['REFERENCE_REQUIRED', 'SILENT_REQUIRED'].includes(audioPolicy)) {
    throw new ClipQaError('Unknown delivery audio policy', { code: 'AUDIO_POLICY_INVALID' });
  }

  // 4. First frame not black
  if (probeResult.firstFrameRgb) {
    const lum = meanLuminance(probeResult.firstFrameRgb);
    if (lum < BLACK_FRAME_THRESHOLD) {
      defects.push({
        code: 'CLIP_FIRST_FRAME_BLACK',
        detail: `First frame mean luminance is ${lum.toFixed(1)}, below threshold ${BLACK_FRAME_THRESHOLD}`,
      });
    }
  }

  // 5. Last frame not black
  if (probeResult.lastFrameRgb) {
    const lum = meanLuminance(probeResult.lastFrameRgb);
    if (lum < BLACK_FRAME_THRESHOLD) {
      defects.push({
        code: 'CLIP_LAST_FRAME_BLACK',
        detail: `Last frame mean luminance is ${lum.toFixed(1)}, below threshold ${BLACK_FRAME_THRESHOLD}`,
      });
    }
  }

  return { pass: defects.length === 0, defects };
}

/**
 * Full QA pipeline: probe the file, extract frames, evaluate.
 *
 * `probeFn(videoPath)` must return { durationSeconds, width, height, hasAudio }
 * `extractFrameFn(videoPath, 'first'|'last')` must return Uint8Array of raw RGB
 *
 * Both are injected so tests run without ffprobe.
 */
export async function qaVideoClip(videoPath, expected, { probeFn, extractFrameFn }) {
  if (typeof probeFn !== 'function') {
    throw new ClipQaError('A probeFn is required', { code: 'QA_MISCONFIGURED' });
  }
  if (typeof extractFrameFn !== 'function') {
    throw new ClipQaError('An extractFrameFn is required', { code: 'QA_MISCONFIGURED' });
  }

  const probe = await probeFn(videoPath);
  const [firstFrameRgb, lastFrameRgb] = await Promise.all([
    extractFrameFn(videoPath, 'first'),
    extractFrameFn(videoPath, 'last'),
  ]);

  return evaluateClipQa(expected, {
    ...probe,
    firstFrameRgb,
    lastFrameRgb,
  });
}
