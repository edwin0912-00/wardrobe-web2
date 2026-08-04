const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

const SUPPORTED_IMAGE_EXTENSION = /\.(?:avif|heic|heif|jpe?g|png|webp)$/i;

function containsFiles(dataTransfer) {
  return [...(dataTransfer?.types ?? [])].includes('Files')
    || Number(dataTransfer?.files?.length ?? 0) > 0;
}

export function acceptedDroppedImages(files, { multiple = false } = {}) {
  const selected = [...(files ?? [])];
  if (!selected.length) return [];
  const unsupported = selected.filter((file) => {
    const type = String(file?.type ?? '').toLowerCase();
    return !(SUPPORTED_IMAGE_TYPES.has(type)
      || (!type && SUPPORTED_IMAGE_EXTENSION.test(String(file?.name ?? ''))));
  });
  if (unsupported.length) {
    throw new Error('Перетягніть фото у форматі PNG, JPEG, WEBP, AVIF або HEIC.');
  }
  if (!multiple && selected.length > 1) {
    throw new Error('У це поле можна додати лише одне фото.');
  }
  return multiple ? selected : selected.slice(0, 1);
}

export function bindImageDropZone(card, {
  input,
  onFiles,
  onError = () => {},
} = {}) {
  if (!card || !input || typeof onFiles !== 'function') {
    throw new TypeError('bindImageDropZone requires card, input and onFiles');
  }

  let dragDepth = 0;
  const clear = () => {
    dragDepth = 0;
    card.classList.remove('is-dragover');
  };

  card.addEventListener('dragenter', (event) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth += 1;
    card.classList.add('is-dragover');
  });
  card.addEventListener('dragover', (event) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    card.classList.add('is-dragover');
  });
  card.addEventListener('dragleave', (event) => {
    if (!containsFiles(event.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) card.classList.remove('is-dragover');
  });
  card.addEventListener('drop', (event) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    clear();
    try {
      const files = acceptedDroppedImages(event.dataTransfer.files, {
        multiple: input.multiple,
      });
      if (files.length) onFiles(files);
    } catch (error) {
      onError(error);
    }
  });
  window.addEventListener('drop', clear);
  window.addEventListener('dragend', clear);

  return Object.freeze({ clear });
}
