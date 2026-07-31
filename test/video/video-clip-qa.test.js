import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateClipQa, qaVideoClip, ClipQaError } from '../../src/web/video-clip-qa.js';

// -- evaluateClipQa (synchronous, no probe needed) --

test('a clip that passes all checks returns pass with no defects', () => {
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '16:9' };
  const probe = {
    durationSeconds: 5.0,
    width: 1280,
    height: 720,
    hasAudio: false,
    firstFrameRgb: new Uint8Array(100).fill(128),
    lastFrameRgb: new Uint8Array(100).fill(128),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, true);
  assert.equal(result.defects.length, 0);
});

test('duration below the mode window is a defect', () => {
  const expected = { durationMin: 5, durationMax: 8, aspectRatio: '16:9' };
  const probe = {
    durationSeconds: 3.0,
    width: 1280, height: 720,
    hasAudio: false,
    firstFrameRgb: new Uint8Array(10).fill(200),
    lastFrameRgb: new Uint8Array(10).fill(200),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, false);
  assert.ok(result.defects.some((d) => d.code === 'CLIP_DURATION_OUT_OF_RANGE'));
});

test('duration above the mode window is a defect', () => {
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '16:9' };
  const probe = {
    durationSeconds: 9.0,
    width: 1280, height: 720,
    hasAudio: false,
    firstFrameRgb: new Uint8Array(10).fill(200),
    lastFrameRgb: new Uint8Array(10).fill(200),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, false);
  assert.ok(result.defects.some((d) => d.code === 'CLIP_DURATION_OUT_OF_RANGE'));
});

test('duration within half-second tolerance is accepted', () => {
  const expected = { durationMin: 5, durationMax: 7, aspectRatio: '16:9' };
  const probe = {
    durationSeconds: 4.6, // within 0.5s tolerance of 5
    width: 1280, height: 720,
    hasAudio: false,
    firstFrameRgb: new Uint8Array(10).fill(128),
    lastFrameRgb: new Uint8Array(10).fill(128),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, true);
});

test('wrong aspect ratio is a defect', () => {
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '9:16' };
  const probe = {
    durationSeconds: 5.0,
    width: 1280, height: 720, // 16:9, not 9:16
    hasAudio: false,
    firstFrameRgb: new Uint8Array(10).fill(128),
    lastFrameRgb: new Uint8Array(10).fill(128),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, false);
  assert.ok(result.defects.some((d) => d.code === 'CLIP_ASPECT_MISMATCH'));
});

test('correct 9:16 aspect passes', () => {
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '9:16' };
  const probe = {
    durationSeconds: 5.0,
    width: 720, height: 1280, // 9:16
    hasAudio: false,
    firstFrameRgb: new Uint8Array(10).fill(128),
    lastFrameRgb: new Uint8Array(10).fill(128),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, true);
});

test('audio track is a defect only when a silent delivery is required', () => {
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '16:9' };
  const probe = {
    durationSeconds: 5.0,
    width: 1280, height: 720,
    hasAudio: true,
    firstFrameRgb: new Uint8Array(10).fill(128),
    lastFrameRgb: new Uint8Array(10).fill(128),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, false);
  assert.ok(result.defects.some((d) => d.code === 'CLIP_UNAUTHORIZED_AUDIO'));
});

test('approved reference audio passes when the delivery requires it', () => {
  const result = evaluateClipQa(
    { durationMin: 4, durationMax: 6, aspectRatio: '16:9', audioPolicy: 'REFERENCE_REQUIRED' },
    { durationSeconds: 5, width: 1280, height: 720, hasAudio: true,
      firstFrameRgb: new Uint8Array(10).fill(128), lastFrameRgb: new Uint8Array(10).fill(128) },
  );
  assert.equal(result.pass, true);
});

test('bound reference audio is accepted by the same provenance policy after salvage', () => {
  const probe = {
    durationSeconds: 3,
    width: 720, height: 1280,
    hasAudio: true,
    firstFrameRgb: new Uint8Array(10).fill(128),
    lastFrameRgb: new Uint8Array(10).fill(128),
  };
  const result = evaluateClipQa({
    durationMin: 3,
    durationMax: 3,
    aspectRatio: '9:16',
    audioPolicy: 'REFERENCE_REQUIRED',
  }, probe);
  assert.equal(result.pass, true);
});

test('black first frame is a defect', () => {
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '16:9' };
  const probe = {
    durationSeconds: 5.0,
    width: 1280, height: 720,
    hasAudio: false,
    firstFrameRgb: new Uint8Array(100).fill(0), // black
    lastFrameRgb: new Uint8Array(100).fill(128),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, false);
  assert.ok(result.defects.some((d) => d.code === 'CLIP_FIRST_FRAME_BLACK'));
});

test('black last frame is a defect', () => {
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '16:9' };
  const probe = {
    durationSeconds: 5.0,
    width: 1280, height: 720,
    hasAudio: false,
    firstFrameRgb: new Uint8Array(100).fill(128),
    lastFrameRgb: new Uint8Array(100).fill(2), // nearly black
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, false);
  assert.ok(result.defects.some((d) => d.code === 'CLIP_LAST_FRAME_BLACK'));
});

test('multiple defects are collected, not short-circuited', () => {
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '16:9' };
  const probe = {
    durationSeconds: 20.0,
    width: 720, height: 1280, // wrong aspect
    hasAudio: true,
    firstFrameRgb: new Uint8Array(10).fill(0), // black
    lastFrameRgb: new Uint8Array(10).fill(0), // black
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, false);
  assert.ok(result.defects.length >= 4);
  const codes = new Set(result.defects.map((d) => d.code));
  assert.ok(codes.has('CLIP_DURATION_OUT_OF_RANGE'));
  assert.ok(codes.has('CLIP_ASPECT_MISMATCH'));
  assert.ok(codes.has('CLIP_UNAUTHORIZED_AUDIO'));
  assert.ok(codes.has('CLIP_FIRST_FRAME_BLACK'));
  assert.ok(codes.has('CLIP_LAST_FRAME_BLACK'));
});

test('no aspect check when aspectRatio is not provided', () => {
  const expected = { durationMin: 4, durationMax: 6 };
  const probe = {
    durationSeconds: 5.0,
    width: 999, height: 111, // weird ratio, but no check
    hasAudio: false,
    firstFrameRgb: new Uint8Array(10).fill(128),
    lastFrameRgb: new Uint8Array(10).fill(128),
  };
  const result = evaluateClipQa(expected, probe);
  assert.equal(result.pass, true);
});

test('missing probe result throws', () => {
  assert.throws(
    () => evaluateClipQa({ durationMin: 4, durationMax: 6 }, null),
    (error) => {
      assert.equal(error.code, 'PROBE_MISSING');
      return true;
    },
  );
});

// -- qaVideoClip (async, requires injected functions) --

test('qaVideoClip calls probeFn and extractFrameFn and evaluates', async () => {
  const probeFn = async () => ({
    durationSeconds: 5.0,
    width: 1280, height: 720,
    hasAudio: false,
  });
  const extractFrameFn = async (_, which) => new Uint8Array(10).fill(which === 'first' ? 200 : 180);
  const expected = { durationMin: 4, durationMax: 6, aspectRatio: '16:9' };
  const result = await qaVideoClip('/tmp/clip.mp4', expected, { probeFn, extractFrameFn });
  assert.equal(result.pass, true);
});

test('qaVideoClip refuses to run without probeFn', async () => {
  await assert.rejects(
    () => qaVideoClip('/tmp/clip.mp4', {}, { probeFn: null, extractFrameFn: async () => null }),
    (error) => {
      assert.equal(error.code, 'QA_MISCONFIGURED');
      return true;
    },
  );
});

test('qaVideoClip refuses to run without extractFrameFn', async () => {
  await assert.rejects(
    () => qaVideoClip('/tmp/clip.mp4', {}, { probeFn: async () => ({}), extractFrameFn: null }),
    (error) => {
      assert.equal(error.code, 'QA_MISCONFIGURED');
      return true;
    },
  );
});
