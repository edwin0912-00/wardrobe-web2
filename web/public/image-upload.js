export const MAX_UPLOAD_FILE_BYTES = 18 * 1024 * 1024;
const MAX_EDGE = 4096;
const JPEG_QUALITIES = [0.9, 0.82, 0.72, 0.62];
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function mimeFromFilename(name) {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return null;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Browser не зміг закодувати image')),
    type,
    quality,
  ));
}

export async function prepareImageFile(file) {
  if (file.size <= MAX_UPLOAD_FILE_BYTES && ALLOWED_MIME_TYPES.has(file.type)) return { file, changed: false };
  const inferredMime = mimeFromFilename(file.name);
  if (file.size <= MAX_UPLOAD_FILE_BYTES && inferredMime) {
    return {
      file: new File([file], file.name, { type: inferredMime, lastModified: file.lastModified }),
      changed: true,
      originalBytes: file.size,
      preparedBytes: file.size,
    };
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`${file.name}: браузер не зміг прочитати або конвертувати цей image format`);
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const initialScale = Math.min(1, MAX_EDGE / longest);
  let width = Math.max(1, Math.round(bitmap.width * initialScale));
  let height = Math.max(1, Math.round(bitmap.height * initialScale));
  let blob = null;

  try {
    for (const quality of JPEG_QUALITIES) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas unavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      blob = await canvasBlob(canvas, 'image/jpeg', quality);
      canvas.width = 1;
      canvas.height = 1;
      if (blob.size <= MAX_UPLOAD_FILE_BYTES) break;
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
  } finally {
    bitmap.close();
  }
  if (!blob || blob.size > MAX_UPLOAD_FILE_BYTES) throw new Error(`${file.name}: не вдалося зменшити image до 18 MB`);
  const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
  return {
    file: new File([blob], `${stem}-upload.jpg`, { type: 'image/jpeg', lastModified: file.lastModified }),
    changed: true,
    originalBytes: file.size,
    preparedBytes: blob.size,
  };
}

export function uploadFormData(url, data, { timeoutMs = 180_000, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.responseType = 'json';
    request.timeout = timeoutMs;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded, event.total);
    };
    request.onload = () => resolve({
      ok: request.status >= 200 && request.status < 300,
      status: request.status,
      body: request.response || { error: request.status === 413 ? 'Файли завеликі навіть після обробки' : undefined },
    });
    request.onerror = () => reject(new Error('Мережевий збій під час завантаження'));
    request.ontimeout = () => reject(new Error('Завантаження тривало понад 3 хвилини й було зупинене'));
    request.onabort = () => reject(new Error('Завантаження скасовано'));
    request.send(data);
  });
}
