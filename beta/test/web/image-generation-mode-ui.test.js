import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMAGE_GENERATION_MODE_STORAGE_KEY,
  imageGenerationModeAvailable,
  imageGenerationModeFromJob,
  imageGenerationModeLabel,
  normalizeImageGenerationModes,
  readImageGenerationMode,
  renderImageGenerationModeControl,
  resolveImageGenerationMode,
  writeImageGenerationMode,
} from '../../web/public/image-generation-mode-ui.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('preference defaults to Slow and Fast survives a browser reload', () => {
  const storage = memoryStorage();
  assert.equal(readImageGenerationMode(storage), 'slow');
  assert.equal(writeImageGenerationMode('fast', storage), 'fast');
  assert.equal(readImageGenerationMode(storage), 'fast');
  assert.equal(storage.getItem(IMAGE_GENERATION_MODE_STORAGE_KEY), 'fast');
  assert.equal(readImageGenerationMode({ getItem: () => 'invalid' }), 'slow');
});

test('legacy health is Slow only, while hard runtime unavailability disables both modes', () => {
  const legacy = normalizeImageGenerationModes({ status: 'ready' });
  assert.equal(imageGenerationModeAvailable('slow', legacy), true);
  assert.equal(imageGenerationModeAvailable('fast', legacy), false);
  assert.equal(renderImageGenerationModeControl('slow', legacy, 'legacy').includes('Fast недоступний'), true);

  const unavailable = normalizeImageGenerationModes({ image_generation_modes: {
    slow: { available: false }, fast: { available: false },
  } });
  const markup = renderImageGenerationModeControl('slow', unavailable, 'hard-fault');
  assert.match(markup, /<select[^>]* disabled>/);
  assert.match(markup, /Генерація зображень зараз недоступна/);
});

test('Fast selector stays explicit when unavailable and both native choices remain labeled', () => {
  const modes = normalizeImageGenerationModes({ image_generation_modes: {
    slow: { available: true }, fast: { available: false },
  } });
  const markup = renderImageGenerationModeControl('fast', modes, 'saved-fast');
  assert.match(markup, /<option value="slow">Slow<\/option>/);
  assert.match(markup, /<option value="fast" selected disabled>Fast<\/option>/);
  assert.match(markup, /Fast зараз недоступний/);
  assert.equal(imageGenerationModeFromJob({ image_generation_mode: 'fast' }), 'fast');
  assert.equal(imageGenerationModeFromJob({}), 'slow');
  assert.equal(imageGenerationModeLabel(imageGenerationModeFromJob({})), 'Slow');
  assert.throws(() => resolveImageGenerationMode(null), /must be slow or fast/);

  const fastOnly = normalizeImageGenerationModes({ image_generation_modes: {
    slow: { available: false }, fast: { available: true },
  } });
  const fastOnlyMarkup = renderImageGenerationModeControl('slow', fastOnly, 'fast-only');
  assert.match(fastOnlyMarkup, /<option value="slow" selected disabled>Slow<\/option>/);
  assert.match(fastOnlyMarkup, /Slow зараз недоступний/);
});
