/*
 * Beta-compatible image preparation for the cinematic site.
 *
 * The backend accepts JPEG/PNG/WebP up to 18 MB. iPhone Photos commonly exposes
 * HEIC/HEIF, so we first try a native decoder, then the optional heic2any decoder,
 * and finally the same-origin beta conversion route. The original File is never
 * mutated; the returned File is safe to submit to the shared Zeely adapter.
 */
export const MAX_UPLOAD_FILE_BYTES = 18 * 1024 * 1024;
const MAX_EDGE = 4096;
const JPEG_QUALITIES = [0.9, 0.82, 0.72, 0.62];
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);
const HEIC_EXTENSION = /\.(?:heic|heif)$/i;

function mimeFromFilename(name) {
  const extension = String(name || '').toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return null;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('image encode failed')),
    type,
    quality,
  ));
}

export function isHeicImage(file) {
  return HEIC_MIME_TYPES.has(String(file?.type || '').toLowerCase())
    || HEIC_EXTENSION.test(String(file?.name || ''));
}

export async function requestServerHeicConversion(file, { fetchFn = globalThis.fetch } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('HEIC conversion unavailable');
  const body = new FormData();
  body.append('image', file, file.name);
  const response = await fetchFn('/api/uploads/heic-to-jpeg', {
    method: 'POST', credentials: 'same-origin', body,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `HEIC conversion failed: HTTP ${response.status}`);
  }
  const converted = await response.blob();
  if (converted.type !== 'image/jpeg' || converted.size < 1) throw new Error('Invalid HEIC conversion');
  return converted;
}

export async function decodeBitmapForUpload(file, {
  bitmapDecoder = globalThis.createImageBitmap,
  heicDecoder = globalThis.heic2any,
  serverHeicDecoder = typeof globalThis.document === 'object' ? requestServerHeicConversion : null,
} = {}) {
  if (typeof bitmapDecoder !== 'function') throw new Error('Image decoder unavailable');
  try {
    return await bitmapDecoder(file, { imageOrientation: 'from-image' });
  } catch (nativeError) {
    if (!isHeicImage(file)) throw nativeError;
    let converted = null;
    if (typeof heicDecoder === 'function') {
      try { converted = await heicDecoder({ blob: file, toType: 'image/jpeg', quality: 0.92 }); } catch {}
    }
    let primary = Array.isArray(converted) ? converted[0] : converted;
    if (!(primary instanceof Blob) || primary.size < 1) {
      if (typeof serverHeicDecoder !== 'function') throw new Error('HEIC decoder unavailable');
      primary = await serverHeicDecoder(file);
    }
    if (!(primary instanceof Blob) || primary.size < 1) throw new Error('HEIC decoder returned no image');
    return bitmapDecoder(primary, { imageOrientation: 'from-image' });
  }
}

export async function prepareImageFile(file) {
  if (!file) throw new Error('No image selected');
  if (file.size <= MAX_UPLOAD_FILE_BYTES && ALLOWED_MIME_TYPES.has(String(file.type || '').toLowerCase())) {
    return { file, changed: false };
  }
  const inferredMime = mimeFromFilename(file.name);
  if (file.size <= MAX_UPLOAD_FILE_BYTES && inferredMime) {
    return {
      file: new File([file], file.name, { type: inferredMime, lastModified: file.lastModified }),
      changed: true, originalBytes: file.size, preparedBytes: file.size,
    };
  }

  let bitmap;
  try { bitmap = await decodeBitmapForUpload(file); }
  catch { throw new Error('Не вдалося прочитати або конвертувати це фото'); }
  const longest = Math.max(bitmap.width, bitmap.height);
  const initialScale = Math.min(1, MAX_EDGE / longest);
  let width = Math.max(1, Math.round(bitmap.width * initialScale));
  let height = Math.max(1, Math.round(bitmap.height * initialScale));
  let blob = null;
  try {
    for (const quality of JPEG_QUALITIES) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas unavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      blob = await canvasBlob(canvas, 'image/jpeg', quality);
      canvas.width = 1; canvas.height = 1;
      if (blob.size <= MAX_UPLOAD_FILE_BYTES) break;
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
  } finally { bitmap.close?.(); }
  if (!blob || blob.size > MAX_UPLOAD_FILE_BYTES) throw new Error('Не вдалося підготувати це фото');
  const stem = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
  return {
    file: new File([blob], `${stem}-upload.jpg`, { type: 'image/jpeg', lastModified: file.lastModified }),
    changed: true, originalBytes: file.size, preparedBytes: blob.size,
  };
}
