import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_JPEG_BYTES = 18 * 1024 * 1024;
const HEIF_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1',
]);

export class HeicConversionError extends Error {
  constructor(message, { code = 'HEIC_CONVERSION_FAILED', status = 422 } = {}) {
    super(message);
    this.name = 'HeicConversionError';
    this.code = code;
    this.status = status;
  }
}

export function isHeicContainer(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
    return false;
  }
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
    if (HEIF_BRANDS.has(bytes.subarray(offset, offset + 4).toString('ascii'))) return true;
  }
  return false;
}

function isJpeg(bytes) {
  return Buffer.isBuffer(bytes)
    && bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes.at(-2) === 0xff
    && bytes.at(-1) === 0xd9;
}

export async function convertHeicToJpeg(bytes, {
  commandRunner = execFileAsync,
  temporaryRoot = os.tmpdir(),
} = {}) {
  if (!isHeicContainer(bytes)) {
    throw new HeicConversionError('Файл не є підтримуваним HEIC/HEIF зображенням', {
      code: 'HEIC_CONTAINER_INVALID',
    });
  }
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw new HeicConversionError('HEIC файл перевищує 20 MB', {
      code: 'HEIC_SOURCE_TOO_LARGE',
      status: 413,
    });
  }

  const directory = await mkdtemp(path.join(temporaryRoot, 'wardrobe-heic-'));
  const source = path.join(directory, 'source.heic');
  const output = path.join(directory, 'prepared.jpg');
  try {
    await writeFile(source, bytes, { mode: 0o600 });
    try {
      await commandRunner('/usr/bin/sips', [
        '-s', 'format', 'jpeg',
        '-s', 'formatOptions', '90',
        source,
        '--out', output,
      ], {
        timeout: 90_000,
        maxBuffer: 1024 * 1024,
      });
    } catch (cause) {
      throw new HeicConversionError('Сервер не зміг декодувати цей HEIC файл', {
        code: 'HEIC_CODEC_UNSUPPORTED',
      }, { cause });
    }
    const jpeg = await readFile(output);
    if (!isJpeg(jpeg) || jpeg.length > MAX_JPEG_BYTES) {
      throw new HeicConversionError('Конвертований JPEG пошкоджений або завеликий', {
        code: 'HEIC_JPEG_INVALID',
      });
    }
    return jpeg;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sameOrigin(request) {
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

export async function registerHeicConversionRoute(app, {
  converter = convertHeicToJpeg,
} = {}) {
  app.post('/api/uploads/heic-to-jpeg', async (request, reply) => {
    if (!sameOrigin(request)) {
      return reply.code(403).send({ error: 'Cross-origin upload is not allowed', code: 'ORIGIN_FORBIDDEN' });
    }
    const part = await request.file({ limits: { files: 1, fileSize: MAX_SOURCE_BYTES } });
    if (!part) return reply.code(400).send({ error: 'HEIC file is required', code: 'HEIC_FILE_REQUIRED' });
    try {
      const jpeg = await converter(await part.toBuffer());
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type('image/jpeg')
        .send(jpeg);
    } catch (error) {
      if (error instanceof HeicConversionError) {
        return reply.code(error.status).send({ error: error.message, code: error.code });
      }
      throw error;
    }
  });
}
