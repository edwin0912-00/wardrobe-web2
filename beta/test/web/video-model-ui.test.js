import assert from 'node:assert/strict';
import test from 'node:test';
import {
  realtimeLookStatusLabel,
  resolveVideoModelId,
  videoModelLabel,
  videoModelOptions,
  videoRetryAvailable,
  videoStyleAvailability,
} from '../../web/public/video-model-ui.js';

const capability = {
  video_models: [
    { id: 'seedance-2.0', label: 'Seedance 2.0', default: true },
    { id: 'seedance-2.5', label: 'Seedance 2.5', default: false },
  ],
  styles: [
    {
      id: 'studio-air',
      video_models: [
        { id: 'seedance-2.0', available: true, reason_code: null, reason_uk: null, normalization_required: false },
        { id: 'seedance-2.5', available: true, reason_code: null, reason_uk: null, normalization_required: false },
      ],
    },
    {
      id: 'walk-camera-energy15.16s',
      video_models: [
        { id: 'seedance-2.0', available: false, reason_code: 'VIDEO_MODEL_STYLE_UNSUPPORTED', reason_uk: 'Потрібна Seedance 2.5.', normalization_required: false },
        { id: 'seedance-2.5', available: true, reason_code: null, reason_uk: null, normalization_required: true },
      ],
    },
    {
      id: 'hard-sun-pose15.12s',
      video_models: [
        { id: 'seedance-2.0', available: false, reason_code: 'VIDEO_MODEL_STYLE_UNSUPPORTED', reason_uk: 'Потрібна Seedance 2.5.', normalization_required: false },
        { id: 'seedance-2.5', available: true, reason_code: null, reason_uk: null, normalization_required: true },
      ],
    },
  ],
};

test('Seedance selector defaults to the API default and keeps only API model choices', () => {
  assert.deepEqual(videoModelOptions(capability).map(({ id }) => id), ['seedance-2.0', 'seedance-2.5']);
  assert.equal(resolveVideoModelId(capability), 'seedance-2.0');
  assert.equal(resolveVideoModelId(capability, 'seedance-2.5'), 'seedance-2.5');
  assert.equal(resolveVideoModelId(capability, 'stale-model'), 'seedance-2.0');
});

test('terminal provider refusals never offer another paid retry', () => {
  assert.equal(videoRetryAvailable({ retryable: false }, 'clip-1'), false);
  assert.equal(videoRetryAvailable({ body: { retryable: false } }, 'clip-1'), false);
  assert.equal(videoRetryAvailable({}, null), false);
  assert.equal(videoRetryAvailable({ retryable: true }, 'clip-1'), true);
});

test('changing Seedance selection reevaluates every style and clears old incompatibility', () => {
  const before = capability.styles.map((style) => videoStyleAvailability(style, 'seedance-2.0'));
  assert.deepEqual(before.map(({ available }) => available), [true, false, false]);
  assert.equal(before[1].reason, 'Потрібна Seedance 2.5.');

  const after = capability.styles.map((style) => videoStyleAvailability(style, 'seedance-2.5'));
  assert.deepEqual(after.map(({ available }) => available), [true, true, true]);
  assert.equal(after.some(({ reason }) => reason.length > 0), false);
  assert.equal(capability.styles[1].video_models[1].normalization_required, true);
  assert.equal(videoModelLabel(capability, 'seedance-2.5'), 'Seedance 2.5');
});

test('Live status uses the API blocked reason before generic camera copy', () => {
  assert.equal(
    realtimeLookStatusLabel({ paidLiveReady: false, blockedReason: 'Спершу додайте повний збережений образ.' }),
    'Спершу додайте повний збережений образ.',
  );
  assert.equal(realtimeLookStatusLabel({ paidLiveReady: true }), 'Камера й AI доступні');
  assert.equal(realtimeLookStatusLabel({ paidLiveReady: false }), 'Камера доступна · AI тимчасово ні');
});
