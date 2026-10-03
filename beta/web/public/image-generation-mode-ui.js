export const IMAGE_GENERATION_MODE_STORAGE_KEY = 'wardrobe.studio.image_generation_mode';
export const DEFAULT_IMAGE_GENERATION_MODE = 'slow';

export function resolveImageGenerationMode(value = DEFAULT_IMAGE_GENERATION_MODE) {
  if (value !== 'slow' && value !== 'fast') {
    throw new TypeError('Image generation mode must be slow or fast');
  }
  return value;
}

export function readImageGenerationMode(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    const value = target?.getItem(IMAGE_GENERATION_MODE_STORAGE_KEY);
    return value === 'fast' ? 'fast' : DEFAULT_IMAGE_GENERATION_MODE;
  } catch {
    return DEFAULT_IMAGE_GENERATION_MODE;
  }
}

export function writeImageGenerationMode(value, storage) {
  const mode = resolveImageGenerationMode(value);
  try {
    const target = storage ?? globalThis.localStorage;
    target?.setItem(IMAGE_GENERATION_MODE_STORAGE_KEY, mode);
  } catch { /* storage may be blocked */ }
  return mode;
}

export function normalizeImageGenerationModes(health) {
  const modes = health?.image_generation_modes;
  if (!modes || typeof modes !== 'object' || Array.isArray(modes)) {
    const healthy = ['ready', 'ok'].includes(String(health?.status ?? '').toLowerCase());
    return {
      slow: { available: healthy },
      fast: { available: false, legacy: healthy },
    };
  }
  return {
    slow: { available: modes.slow?.available === true },
    fast: { available: modes.fast?.available === true },
  };
}

export function imageGenerationModeAvailable(mode, modes) {
  return (mode === 'slow' || mode === 'fast') && modes?.[mode]?.available === true;
}

export function imageGenerationModeFromJob(job) {
  return job?.image_generation_mode === 'fast' || job?.imageGenerationMode === 'fast'
    ? 'fast'
    : DEFAULT_IMAGE_GENERATION_MODE;
}

export function imageGenerationModeLabel(value) {
  return value === 'fast' ? 'Fast' : 'Slow';
}

export function renderImageGenerationModeControl(value, modes, id) {
  const selected = resolveImageGenerationMode(value);
  const slowAvailable = imageGenerationModeAvailable('slow', modes);
  const fastAvailable = imageGenerationModeAvailable('fast', modes);
  const controlId = String(id).replace(/[^A-Za-z0-9_-]/g, '-');
  const noteId = `${controlId}-availability`;
  let note = '';
  if (!slowAvailable && !fastAvailable) note = 'Генерація зображень зараз недоступна.';
  else if (!slowAvailable) note = 'Slow зараз недоступний на сервері.';
  else if (!fastAvailable) {
    note = modes?.fast?.legacy
      ? 'Fast недоступний: цей сервер підтримує лише Slow.'
      : 'Fast зараз недоступний на сервері.';
  }

  return `<div class="image-generation-mode-control">
    <label for="${controlId}">Режим зображення</label>
    <select id="${controlId}" data-image-generation-mode aria-label="Швидкість створення зображень" aria-describedby="${noteId}"${!slowAvailable && !fastAvailable ? ' disabled' : ''}>
      <option value="slow"${selected === 'slow' ? ' selected' : ''}${!slowAvailable ? ' disabled' : ''}>Slow</option>
      <option value="fast"${selected === 'fast' ? ' selected' : ''}${!fastAvailable ? ' disabled' : ''}>Fast</option>
    </select>
    <small id="${noteId}" role="status" aria-live="polite">${note}</small>
  </div>`;
}
