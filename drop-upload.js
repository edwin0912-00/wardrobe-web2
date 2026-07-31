/* Beta-compatible drag-and-drop validation. DOM ownership remains with the main UI. */
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif',
]);
const SUPPORTED_IMAGE_EXTENSION = /\.(?:avif|heic|heif|jpe?g|png|webp)$/i;

export function acceptedDroppedImages(files, { multiple = false } = {}) {
  const selected = [...(files || [])];
  if (!selected.length) return [];
  const unsupported = selected.some((file) => {
    const type = String(file?.type || '').toLowerCase();
    return !(SUPPORTED_IMAGE_TYPES.has(type)
      || (!type && SUPPORTED_IMAGE_EXTENSION.test(String(file?.name || ''))));
  });
  if (unsupported) throw new Error('Перетягніть фото у форматі PNG, JPEG, WEBP, AVIF або HEIC.');
  if (!multiple && selected.length > 1) throw new Error('У це поле можна додати лише одне фото.');
  return multiple ? selected : selected.slice(0, 1);
}
