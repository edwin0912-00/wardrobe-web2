import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAST_LOOK_IMAGE_MODEL_ROUTE,
  IMAGE_MODEL_ROUTE,
  assertModelRoute,
  resolveLookImageRoute,
} from '../../src/runner/model-policy.js';

test('look image route has an explicit fast Nano Banana 2 first policy', () => {
  assert.deepEqual(resolveLookImageRoute('quality'), IMAGE_MODEL_ROUTE);
  assert.deepEqual(resolveLookImageRoute('fast'), FAST_LOOK_IMAGE_MODEL_ROUTE);
  assert.deepEqual(FAST_LOOK_IMAGE_MODEL_ROUTE, [
    'nano_banana_flash',
    'gpt_image_2',
    'nano_banana_2',
  ]);
  assert.throws(() => resolveLookImageRoute('whatever'), /ZEELY_LOOK_IMAGE_ROUTE/);
});

test('job route accepts only a prefix of an explicitly approved route', () => {
  assert.doesNotThrow(() => assertModelRoute(['gpt_image_2']));
  assert.doesNotThrow(() => assertModelRoute(['nano_banana_flash', 'gpt_image_2']));
  assert.throws(
    () => assertModelRoute(['nano_banana_flash', 'nano_banana_2']),
    /approved Zeely model route prefix/,
  );
});
