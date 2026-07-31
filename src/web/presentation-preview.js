import { createReadStream } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

/**
 * The immutable PNG/JPEG is generation evidence and download material.  It is
 * never appropriate as a browser thumbnail.  Routes opt into this helper via
 * `?preview=1`; the derivative is intentionally not written back beside the
 * evidence, so a preview can never alter a QA binding.
 */
export async function sendPresentationImage(request, reply, {
  filename = null,
  bytes = null,
  mediaType = null,
  disposition = 'inline',
  downloadName = 'image.png',
  cacheControl = 'private, max-age=900',
}) {
  const preview = request.query?.preview === '1' && disposition === 'inline';
  const source = bytes ?? filename;
  if (!source) return reply.code(404).send({ error: 'Image not found' });

  if (preview) {
    try {
      const derivative = await sharp(source, {
        failOn: 'error',
        limitInputPixels: 100_000_000,
      })
        .rotate()
        .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 70, effort: 4 })
        .toBuffer();
      return reply
        .type('image/webp')
        .header('Cache-Control', cacheControl)
        .header('Vary', 'Cookie')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', 'inline; filename="preview.webp"')
        .header('X-Zeely-Presentation', 'webp-640')
        .send(derivative);
    } catch {
      return reply.code(422).send({ error: 'Не вдалося підготувати легке preview-зображення' });
    }
  }

  const type = mediaType
    ?? (filename ? IMAGE_TYPES.get(path.extname(filename).toLowerCase()) : null)
    ?? 'application/octet-stream';
  const payload = bytes ?? createReadStream(filename);
  return reply
    .type(type)
    // The lightweight derivative is disposable presentation data and may be
    // cached privately for a bounded window. The original is immutable QA /
    // generation evidence and must not be retained by the browser cache.
    .header('Cache-Control', 'private, no-store')
    .header('Vary', 'Cookie')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Disposition', `${disposition}; filename="${downloadName}"`)
    .send(payload);
}
