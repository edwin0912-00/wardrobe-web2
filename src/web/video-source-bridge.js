import { createHash, randomBytes } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const CLIP_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const ROUTE_PREFIX = '/api/video-source/';
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAXIMUM_BYTES = 20 * 1024 * 1024;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function mediaType(bytes) {
  if (bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function safeOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new VideoSourceBridgeError('A valid deployment HTTPS origin is required', {
      code: 'VIDEO_SOURCE_ORIGIN_INVALID',
    });
  }
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw new VideoSourceBridgeError('A bare deployment HTTPS origin is required', {
      code: 'VIDEO_SOURCE_ORIGIN_INVALID',
    });
  }
  return parsed.origin;
}

function bindingFrom(value) {
  const clipId = value?.clipId;
  const sourceSha256 = value?.sourceSha256;
  const approvedLookReceiptSha256 = value?.approvedLookReceiptSha256;
  if (!CLIP_ID.test(clipId ?? '')
    || !SHA256.test(sourceSha256 ?? '')
    || !SHA256.test(approvedLookReceiptSha256 ?? '')) {
    throw new VideoSourceBridgeError('Video source binding is incomplete or invalid', {
      code: 'VIDEO_SOURCE_BINDING_INVALID',
    });
  }
  return { clipId, sourceSha256, approvedLookReceiptSha256 };
}

function tokenFrom(value) {
  if (typeof value !== 'string') return null;
  if (CAPABILITY.test(value)) return value;
  try {
    const parsed = new URL(value);
    const token = parsed.pathname.startsWith(ROUTE_PREFIX)
      ? parsed.pathname.slice(ROUTE_PREFIX.length)
      : null;
    return CAPABILITY.test(token ?? '') ? token : null;
  } catch {
    return null;
  }
}

export class VideoSourceBridgeError extends Error {
  constructor(message, {
    code = 'VIDEO_SOURCE_BRIDGE_ERROR',
    status = 409,
  } = {}) {
    super(message);
    this.name = 'VideoSourceBridgeError';
    this.code = code;
    this.status = status;
  }
}

export function isVideoSourceCapabilityPath(value) {
  if (typeof value !== 'string') return false;
  const pathname = value.split('?')[0];
  return pathname.startsWith(ROUTE_PREFIX);
}

export function redactVideoSourceRequestPath(value) {
  return isVideoSourceCapabilityPath(value)
    ? `${ROUTE_PREFIX}[redacted-capability]`
    : value;
}

/**
 * Create an in-memory, short-lived capability bridge.
 *
 * The returned resolver is passed directly to OpenRouterVideoProvider. The
 * capability token is random state only: clip id, hashes and local paths stay
 * server-side and never appear in the URL.
 */
export function createVideoAssetUrlResolver({
  clipStoreRoot,
  httpsOrigin,
  ttlMs = DEFAULT_TTL_MS,
  maxFetches = 1,
  maximumBytes = DEFAULT_MAXIMUM_BYTES,
  clock = () => Date.now(),
  randomBytesFn = randomBytes,
} = {}) {
  if (typeof clipStoreRoot !== 'string' || !path.isAbsolute(clipStoreRoot)) {
    throw new VideoSourceBridgeError('An absolute clipStoreRoot is required', {
      code: 'VIDEO_SOURCE_ROOT_INVALID',
    });
  }
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 10 * 60 * 1000
    || !Number.isInteger(maxFetches) || maxFetches < 1 || maxFetches > 5
    || !Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 50 * 1024 * 1024) {
    throw new VideoSourceBridgeError('Video source capability limits are invalid', {
      code: 'VIDEO_SOURCE_LIMITS_INVALID',
    });
  }
  const origin = safeOrigin(httpsOrigin);
  const root = path.resolve(clipStoreRoot);
  const capabilities = new Map();

  async function videoAssetUrlResolver(sourcePath, sourceBinding) {
    const binding = bindingFrom(sourceBinding);
    const expectedPath = path.join(root, 'clips', binding.clipId, 'source.png');
    if (typeof sourcePath !== 'string'
      || sourcePath.split(path.sep).includes('..')
      || path.resolve(sourcePath) !== expectedPath
      || path.relative(root, expectedPath).startsWith('..')) {
      throw new VideoSourceBridgeError('Video source path is outside its exact clip binding', {
        code: 'VIDEO_SOURCE_PATH_INVALID',
      });
    }
    let fileStat;
    let bytes;
    try {
      fileStat = await lstat(expectedPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('not a regular file');
      bytes = await readFile(expectedPath);
    } catch {
      throw new VideoSourceBridgeError('Bound video source is unavailable', {
        code: 'VIDEO_SOURCE_UNAVAILABLE',
        status: 404,
      });
    }
    const lockedMediaType = mediaType(bytes);
    if (!lockedMediaType || bytes.length < 1 || bytes.length > maximumBytes) {
      throw new VideoSourceBridgeError('Bound video source type or size is invalid', {
        code: 'VIDEO_SOURCE_MEDIA_INVALID',
      });
    }
    if (sha256(bytes) !== binding.sourceSha256) {
      throw new VideoSourceBridgeError('Bound video source hash does not match', {
        code: 'VIDEO_SOURCE_HASH_MISMATCH',
      });
    }

    const token = randomBytesFn(32).toString('base64url');
    if (!CAPABILITY.test(token)) {
      throw new VideoSourceBridgeError('Capability entropy source returned an invalid token', {
        code: 'VIDEO_SOURCE_TOKEN_INVALID',
      });
    }
    const tokenHash = sha256(token);
    if (capabilities.has(tokenHash)) {
      throw new VideoSourceBridgeError('Capability entropy source repeated a token', {
        code: 'VIDEO_SOURCE_TOKEN_COLLISION',
      });
    }
    const issuedAt = clock();
    capabilities.set(tokenHash, {
      status: 'ACTIVE',
      sourcePath: expectedPath,
      ...binding,
      mediaType: lockedMediaType,
      size: bytes.length,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      fetchCount: 0,
    });
    return `${origin}${ROUTE_PREFIX}${token}`;
  }

  async function consume(capability) {
    const token = tokenFrom(capability);
    const record = token ? capabilities.get(sha256(token)) : null;
    if (!record) {
      throw new VideoSourceBridgeError('Video source capability is invalid', {
        code: 'VIDEO_SOURCE_CAPABILITY_INVALID',
        status: 404,
      });
    }
    if (record.status === 'REVOKED') {
      throw new VideoSourceBridgeError('Video source capability was revoked', {
        code: 'VIDEO_SOURCE_CAPABILITY_REVOKED',
        status: 410,
      });
    }
    if (record.status === 'CONSUMED' || record.fetchCount >= maxFetches) {
      throw new VideoSourceBridgeError('Video source capability fetch limit reached', {
        code: 'VIDEO_SOURCE_REPLAY_LIMIT',
        status: 410,
      });
    }
    if (clock() >= record.expiresAt) {
      record.status = 'EXPIRED';
      throw new VideoSourceBridgeError('Video source capability expired', {
        code: 'VIDEO_SOURCE_CAPABILITY_EXPIRED',
        status: 410,
      });
    }
    if (record.status === 'EXPIRED') {
      throw new VideoSourceBridgeError('Video source capability expired', {
        code: 'VIDEO_SOURCE_CAPABILITY_EXPIRED',
        status: 410,
      });
    }

    // Reserve before I/O so concurrent fetches cannot both pass the replay gate.
    record.fetchCount += 1;
    if (record.fetchCount >= maxFetches) record.status = 'CONSUMED';
    let fileStat;
    let bytes;
    try {
      fileStat = await lstat(record.sourcePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('not a regular file');
      bytes = await readFile(record.sourcePath);
    } catch {
      record.status = 'REVOKED';
      throw new VideoSourceBridgeError('Bound video source is unavailable', {
        code: 'VIDEO_SOURCE_UNAVAILABLE',
        status: 404,
      });
    }
    const actualMediaType = mediaType(bytes);
    if (bytes.length !== record.size
      || bytes.length > maximumBytes
      || actualMediaType !== record.mediaType) {
      record.status = 'REVOKED';
      throw new VideoSourceBridgeError('Bound video source media lock changed', {
        code: 'VIDEO_SOURCE_MEDIA_MISMATCH',
      });
    }
    if (sha256(bytes) !== record.sourceSha256) {
      record.status = 'REVOKED';
      throw new VideoSourceBridgeError('Bound video source hash changed', {
        code: 'VIDEO_SOURCE_HASH_MISMATCH',
      });
    }
    return {
      bytes,
      mediaType: record.mediaType,
      size: record.size,
      expiresAt: record.expiresAt,
      fetchCount: record.fetchCount,
    };
  }

  function revoke(capability) {
    const token = tokenFrom(capability);
    const record = token ? capabilities.get(sha256(token)) : null;
    if (!record) return false;
    record.status = 'REVOKED';
    return true;
  }

  function expire() {
    const now = clock();
    let count = 0;
    for (const record of capabilities.values()) {
      if (record.status === 'ACTIVE' && now >= record.expiresAt) {
        record.status = 'EXPIRED';
        count += 1;
      }
    }
    return count;
  }

  return Object.freeze({
    videoAssetUrlResolver,
    consume,
    revoke,
    expire,
  });
}

export async function registerVideoSourceBridgeRoutes(app, { videoSourceBridge } = {}) {
  if (!videoSourceBridge || typeof videoSourceBridge.consume !== 'function') {
    throw new TypeError('registerVideoSourceBridgeRoutes requires videoSourceBridge');
  }
  app.get(`${ROUTE_PREFIX}:capability`, {
    logLevel: 'silent',
  }, async (request, reply) => {
    try {
      const source = await videoSourceBridge.consume(request.params.capability);
      return reply
        .type(source.mediaType)
        .header('Cache-Control', 'private, no-store, max-age=0')
        .header('Pragma', 'no-cache')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Length', source.size)
        .send(source.bytes);
    } catch (error) {
      const status = error instanceof VideoSourceBridgeError ? error.status : 404;
      const code = error instanceof VideoSourceBridgeError
        ? error.code
        : 'VIDEO_SOURCE_CAPABILITY_INVALID';
      return reply.code(status).send({
        error: 'Video source capability unavailable',
        code,
      });
    }
  });
}
