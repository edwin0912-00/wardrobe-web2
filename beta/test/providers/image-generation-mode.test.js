import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IMAGE_GENERATION_MODE, resolveImageGenerationMode } from '../../src/providers/image-generation-mode.js';

test('old clients retain Slow and explicit image modes remain unchanged', () => {
  assert.equal(DEFAULT_IMAGE_GENERATION_MODE, 'slow');
  assert.equal(resolveImageGenerationMode(), 'slow');
  assert.equal(resolveImageGenerationMode('slow'), 'slow');
  assert.equal(resolveImageGenerationMode('fast'), 'fast');
});

test('invalid image modes fail as non-retryable client errors', () => {
  for (const value of [null, '', 'FAST', 'codex', 'fal', 1, false, {}, ['fast']]) {
    assert.throws(() => resolveImageGenerationMode(value), (error) => {
      assert.equal(error.code, 'IMAGE_GENERATION_MODE_INVALID');
      assert.equal(error.statusCode, 400);
      assert.equal(error.retryable, false);
      return true;
    });
  }
});
