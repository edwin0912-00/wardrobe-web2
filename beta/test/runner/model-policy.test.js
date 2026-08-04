import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAST_LOOK_IMAGE_MODEL_ROUTE,
  GPT_IMAGE_2_LADDER,
  IMAGE_MODEL_ROUTE,
  assertModelRoute,
  generationProfileForAttempt,
  resolveLookImageRoute,
} from '../../src/runner/model-policy.js';

test('new look routes use the immutable GPT Image 2 low-to-high ladder, including legacy fast mode', () => {
  assert.deepEqual(resolveLookImageRoute('quality'), IMAGE_MODEL_ROUTE);
  assert.deepEqual(resolveLookImageRoute('fast'), FAST_LOOK_IMAGE_MODEL_ROUTE);
  assert.deepEqual(IMAGE_MODEL_ROUTE, [
    'gpt_image_2',
    'gpt_image_2',
    'gpt_image_2',
    'gpt_image_2',
    'gpt_image_2',
  ]);
  assert.deepEqual(GPT_IMAGE_2_LADDER.map(({ resolution, quality, repair_kind }) => ({ resolution, quality, repair_kind })), [
    { resolution: '1k', quality: 'low', repair_kind: 'INITIAL' },
    { resolution: '1k', quality: 'low', repair_kind: 'QA_REPAIR_1' },
    { resolution: '1k', quality: 'low', repair_kind: 'QA_REPAIR_2' },
    { resolution: '2k', quality: 'medium', repair_kind: 'QUALITY_ESCALATION_MEDIUM' },
    { resolution: '4k', quality: 'high', repair_kind: 'QUALITY_ESCALATION_HIGH' },
  ]);
  assert.deepEqual(generationProfileForAttempt(2, IMAGE_MODEL_ROUTE), GPT_IMAGE_2_LADDER[1]);
  assert.throws(() => resolveLookImageRoute('whatever'), /ZEELY_LOOK_IMAGE_ROUTE/);
});

test('new GPT ladder and historic Nano routes remain distinguishable and bounded', () => {
  assert.doesNotThrow(() => assertModelRoute(['gpt_image_2']));
  assert.doesNotThrow(() => assertModelRoute(['gpt_image_2', 'gpt_image_2', 'gpt_image_2']));
  assert.doesNotThrow(() => assertModelRoute(['gpt_image_2', 'nano_banana_flash', 'nano_banana_2']));
  assert.throws(
    () => assertModelRoute(['gpt_image_2', 'nano_banana_2']),
    /approved Zeely model route prefix/,
  );
});
