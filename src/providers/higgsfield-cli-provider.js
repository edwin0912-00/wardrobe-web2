import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_PROVIDER_JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MEDIA_TYPES_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});

export const HIGGSFIELD_IMAGE_MODELS = Object.freeze({
  gpt_image_2: Object.freeze({
    displayName: 'GPT Image 2',
    aspectRatios: Object.freeze(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']),
    resolutions: Object.freeze(['1k', '2k', '4k']),
    qualities: Object.freeze(['low', 'medium', 'high']),
  }),
  nano_banana_flash: Object.freeze({
    displayName: 'Nano Banana 2',
    aspectRatios: Object.freeze(['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9']),
    resolutions: Object.freeze(['1k', '2k', '4k']),
  }),
  nano_banana_2: Object.freeze({
    displayName: 'Nano Banana Pro',
    aspectRatios: Object.freeze(['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9']),
    resolutions: Object.freeze(['1k', '2k', '4k']),
  }),
});

export class HiggsfieldProviderError extends Error {
  constructor(message, { code = 'HIGGSFIELD_PROVIDER_ERROR', retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = 'HiggsfieldProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

function assertChoice(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new HiggsfieldProviderError(`${label} is not supported: ${value}`, {
      code: 'INVALID_GENERATION_OPTION',
      retryable: false,
    });
  }
}

function assertDuration(value, label) {
  if (typeof value !== 'string' || !/^\d+(?:ms|s|m|h)$/.test(value)) {
    throw new HiggsfieldProviderError(`${label} must be a bounded CLI duration`, {
      code: 'INVALID_WAIT_OPTION',
      retryable: false,
    });
  }
}

function modelSpec(model) {
  const spec = HIGGSFIELD_IMAGE_MODELS[model];
  if (!spec) {
    throw new HiggsfieldProviderError(`Higgsfield image model is not allowlisted: ${model}`, {
      code: 'MODEL_NOT_ALLOWLISTED',
      retryable: false,
    });
  }
  return spec;
}

function artifactDescriptor(value, role) {
  const artifact = value?.artifact ?? value;
  if (!artifact || typeof artifact.path !== 'string' || artifact.path.trim() === '') return null;
  return {
    role,
    path: path.resolve(artifact.path),
    sha256: typeof artifact.digest === 'string' && SHA256.test(artifact.digest) ? artifact.digest : undefined,
  };
}

function orderedPackDescriptors(phase, references) {
  if (!Array.isArray(references?.ordered)) return null;
  if (references.ordered.length === 0 || references.ordered.length > 8) {
    throw new HiggsfieldProviderError('references.ordered must contain 1–8 media bindings', {
      code: 'INVALID_ORDERED_REFERENCES',
      retryable: false,
    });
  }
  const result = references.ordered.map((binding, index) => {
    if (!binding || typeof binding !== 'object'
      || binding.order !== index + 1
      || typeof binding.path !== 'string'
      || binding.path.trim() === ''
      || typeof binding.role !== 'string'
      || binding.role.trim() === '') {
      throw new HiggsfieldProviderError('references.ordered is not a contiguous, ordered media binding list', {
        code: 'INVALID_ORDERED_REFERENCES',
        retryable: false,
      });
    }
    if (!['identity', 'outfit', 'avatar'].includes(binding.scope)) {
      throw new HiggsfieldProviderError(`Unsupported ordered reference scope: ${binding.scope}`, {
        code: 'INVALID_ORDERED_REFERENCES',
        retryable: false,
      });
    }
    if (!['REFERENCE_PACK', 'CONDITIONED', 'APPROVED_AVATAR'].includes(binding.source)) {
      throw new HiggsfieldProviderError(`Unsupported ordered reference source: ${binding.source}`, {
        code: 'INVALID_ORDERED_REFERENCES',
        retryable: false,
      });
    }
    if (typeof binding.mediaType !== 'string' || binding.mediaType.trim() === '') {
      throw new HiggsfieldProviderError('Ordered reference must declare its mediaType', {
        code: 'INVALID_ORDERED_REFERENCES',
        retryable: false,
      });
    }
    if (!SHA256.test(binding.sha256)) {
      throw new HiggsfieldProviderError('Ordered reference must have a lowercase sha256 digest', {
        code: 'INVALID_ORDERED_REFERENCES',
        retryable: false,
      });
    }
    if (binding.packSha256 !== undefined && !SHA256.test(binding.packSha256)) {
      throw new HiggsfieldProviderError('Ordered reference pack has an invalid sha256 digest', {
        code: 'INVALID_ORDERED_REFERENCES',
        retryable: false,
      });
    }
    if (binding.source === 'REFERENCE_PACK'
      && (typeof binding.packPath !== 'string'
        || binding.packPath.trim() === ''
        || !SHA256.test(binding.packSha256)
        || !Number.isInteger(binding.bindingOrder)
        || binding.bindingOrder < 1)) {
      throw new HiggsfieldProviderError('REFERENCE_PACK bindings require packPath, packSha256, and bindingOrder', {
        code: 'INVALID_ORDERED_REFERENCES',
        retryable: false,
      });
    }
    return {
      order: binding.order,
      scope: binding.scope,
      role: binding.role,
      path: path.resolve(binding.path),
      sha256: binding.sha256,
      mediaType: binding.mediaType,
      source: binding.source,
      packPath: binding.packPath ? path.resolve(binding.packPath) : undefined,
      packSha256: binding.packSha256,
      bindingOrder: binding.bindingOrder,
    };
  });
  if (phase === 'avatar' && result.some((item) => item.scope !== 'identity')) {
    throw new HiggsfieldProviderError('Avatar ordered references may contain only conditioned identity bindings', {
      code: 'INVALID_AVATAR_REFERENCE_ORDER',
      retryable: false,
    });
  }
  if (phase === 'outfit' && result[0]?.scope !== 'avatar') {
    throw new HiggsfieldProviderError('Outfit ordered references must begin with the approved avatar', {
      code: 'MISSING_APPROVED_AVATAR',
      retryable: false,
    });
  }
  if (phase === 'outfit' && result.slice(1).some((item) => item.scope === 'avatar')) {
    throw new HiggsfieldProviderError('The approved avatar may appear only once and first', {
      code: 'INVALID_OUTFIT_REFERENCE_ORDER',
      retryable: false,
    });
  }
  if (phase === 'garment' && result.some((item) => item.scope !== 'outfit')) {
    throw new HiggsfieldProviderError('Підготовка еталонного зображення приймає лише фото речей', {
      code: 'INVALID_GARMENT_REFERENCE_ORDER',
      retryable: false,
    });
  }
  if (phase === 'scene' && result[0]?.scope !== 'avatar') {
    throw new HiggsfieldProviderError('Scene generation must begin with the approved outfit still', {
      code: 'MISSING_APPROVED_OUTFIT',
      retryable: false,
    });
  }
  const paths = result.map((item) => item.path);
  if (new Set(paths).size !== paths.length) {
    throw new HiggsfieldProviderError('Ordered references may not contain duplicate paths', {
      code: 'DUPLICATE_ORDERED_REFERENCE',
      retryable: false,
    });
  }
  return result;
}

function orderedReferenceDescriptors(phase, references) {
  if (!references || typeof references !== 'object') {
    throw new HiggsfieldProviderError('Generation references are required', {
      code: 'MISSING_REFERENCES',
      retryable: false,
    });
  }
  const packDescriptors = orderedPackDescriptors(phase, references);
  if (packDescriptors) return packDescriptors;
  const ordered = phase === 'outfit'
    ? [
        artifactDescriptor(references.avatar, 'approved_avatar'),
        artifactDescriptor(references.identity, 'conditioned_identity'),
        artifactDescriptor(references.outfit, 'conditioned_outfit'),
      ]
    : [artifactDescriptor(references.identity, 'conditioned_identity')];
  const result = [];
  const seen = new Set();
  for (const descriptor of ordered.filter(Boolean)) {
    if (seen.has(descriptor.path)) continue;
    seen.add(descriptor.path);
    result.push(descriptor);
  }
  if (phase === 'avatar' && result.length < 1) {
    throw new HiggsfieldProviderError('Avatar generation requires a conditioned identity image', {
      code: 'MISSING_IDENTITY_REFERENCE',
      retryable: false,
    });
  }
  if (phase === 'outfit' && result[0]?.role !== 'approved_avatar') {
    throw new HiggsfieldProviderError('Outfit generation requires the approved avatar as its first reference', {
      code: 'MISSING_APPROVED_AVATAR',
      retryable: false,
    });
  }
  if (result.length > 8) {
    throw new HiggsfieldProviderError('At most eight generation references are allowed', {
      code: 'TOO_MANY_REFERENCES',
      retryable: false,
    });
  }
  return result;
}

function hasExpectedImageSignature(bytes, extension) {
  if (extension === '.png') {
    return bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (extension === '.webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function normalizedPackBindings(payload) {
  if (Array.isArray(payload.generation_bindings)) {
    return payload.generation_bindings.map((item) => ({
      order: item?.order,
      role: item?.role,
      sha256: item?.sha256,
    }));
  }
  if (Array.isArray(payload.references)) {
    return payload.references
      .filter((item) => item?.role !== 'QUALITY_BENCHMARK' && item?.authority !== 'QUALITY_ONLY')
      .map((item, index) => ({
        order: index + 1,
        role: item?.role,
        sha256: item?.sha256,
      }));
  }
  return null;
}

async function validateMedia(descriptors) {
  const verifiedPacks = new Map();
  for (const descriptor of descriptors) {
    const extension = path.extname(descriptor.path).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new HiggsfieldProviderError(`Unsupported reference image extension: ${extension || '<none>'}`, {
        code: 'UNSUPPORTED_REFERENCE_MEDIA',
        retryable: false,
      });
    }
    if (descriptor.mediaType && descriptor.mediaType !== MEDIA_TYPES_BY_EXTENSION[extension]) {
      throw new HiggsfieldProviderError(`Reference mediaType does not match its extension: ${descriptor.path}`, {
        code: 'REFERENCE_MEDIA_TYPE_MISMATCH',
        retryable: false,
      });
    }
    let bytes;
    try {
      const info = await stat(descriptor.path);
      if (!info.isFile() || info.size === 0) throw new Error('not a non-empty regular file');
      descriptor.size = info.size;
      bytes = await readFile(descriptor.path);
    } catch (error) {
      throw new HiggsfieldProviderError(`Reference image is not readable: ${descriptor.path}`, {
        code: 'REFERENCE_NOT_READABLE',
        retryable: false,
        cause: error,
      });
    }
    if (!hasExpectedImageSignature(bytes, extension)) {
      throw new HiggsfieldProviderError(`Reference content does not match its image extension: ${descriptor.path}`, {
        code: 'INVALID_REFERENCE_MEDIA',
        retryable: false,
      });
    }
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (descriptor.sha256 && descriptor.sha256 !== actualSha256) {
      throw new HiggsfieldProviderError(`Reference image digest does not match: ${descriptor.path}`, {
        code: 'REFERENCE_DIGEST_MISMATCH',
        retryable: false,
      });
    }
    descriptor.sha256 = actualSha256;

    if (descriptor.packPath) {
      let verifiedPack = verifiedPacks.get(descriptor.packPath);
      if (!verifiedPack) {
        let packBytes;
        try {
          const info = await stat(descriptor.packPath);
          if (!info.isFile() || info.size === 0) throw new Error('not a non-empty regular file');
          packBytes = await readFile(descriptor.packPath);
        } catch (error) {
          throw new HiggsfieldProviderError(`Reference pack is not readable: ${descriptor.packPath}`, {
            code: 'REFERENCE_PACK_NOT_READABLE',
            retryable: false,
            cause: error,
          });
        }
        const packSha256 = createHash('sha256').update(packBytes).digest('hex');
        let payload;
        try {
          payload = JSON.parse(packBytes.toString('utf8'));
        } catch (error) {
          throw new HiggsfieldProviderError(`Reference pack is not valid JSON: ${descriptor.packPath}`, {
            code: 'INVALID_REFERENCE_PACK',
            retryable: false,
            cause: error,
          });
        }
        const bindings = payload && typeof payload === 'object' && !Array.isArray(payload)
          ? normalizedPackBindings(payload)
          : null;
        if (!bindings) {
          throw new HiggsfieldProviderError(`Reference pack has no supported media bindings: ${descriptor.packPath}`, {
            code: 'INVALID_REFERENCE_PACK',
            retryable: false,
          });
        }
        verifiedPack = { sha256: packSha256, bindings };
        verifiedPacks.set(descriptor.packPath, verifiedPack);
      }
      if (descriptor.packSha256 && descriptor.packSha256 !== verifiedPack.sha256) {
        throw new HiggsfieldProviderError(`Reference pack digest does not match: ${descriptor.packPath}`, {
          code: 'REFERENCE_PACK_DIGEST_MISMATCH',
          retryable: false,
        });
      }
      descriptor.packSha256 = verifiedPack.sha256;
      if (descriptor.source === 'REFERENCE_PACK') {
        const binding = verifiedPack.bindings.find(
          (item) => item?.order === descriptor.bindingOrder,
        );
        if (!binding || binding.role !== descriptor.role || binding.sha256 !== descriptor.sha256) {
          throw new HiggsfieldProviderError(`Reference does not match its declared pack binding: ${descriptor.path}`, {
            code: 'REFERENCE_PACK_BINDING_MISMATCH',
            retryable: false,
          });
        }
      }
    }
  }
}

/**
 * Compile the exact argv accepted by Higgsfield CLI 0.1.x. Dynamic model
 * parameters retain underscores (`--aspect_ratio`); operational wait flags
 * use hyphens. The caller must execute this argv without a shell.
 */
function buildHiggsfieldCreateBaseArgs({
  model,
  prompt,
  mediaPaths,
  aspectRatio = '3:4',
  resolution = '2k',
  quality = 'high',
}) {
  const spec = modelSpec(model);
  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.length > 100_000) {
    throw new HiggsfieldProviderError('Generation prompt must contain 1–100000 characters', {
      code: 'INVALID_PROMPT',
      retryable: false,
    });
  }
  if (!Array.isArray(mediaPaths) || mediaPaths.length === 0) {
    throw new HiggsfieldProviderError('At least one reference image is required', {
      code: 'MISSING_REFERENCES',
      retryable: false,
    });
  }
  assertChoice(aspectRatio, spec.aspectRatios, 'aspect_ratio');
  assertChoice(resolution, spec.resolutions, 'resolution');
  const args = [
    'generate', 'create', model,
    '--prompt', prompt,
    '--aspect_ratio', aspectRatio,
    '--resolution', resolution,
  ];
  if (spec.qualities) {
    assertChoice(quality, spec.qualities, 'quality');
    args.push('--quality', quality);
  }
  for (const mediaPath of mediaPaths) args.push('--image', mediaPath);
  return args;
}

/** Build the default two-phase create argv. It intentionally does not wait. */
export function buildHiggsfieldCreateArgs(options) {
  return [...buildHiggsfieldCreateBaseArgs(options), '--json', '--no-color'];
}

/** Build the exact live-verified wait argv for an existing provider job. */
export function buildHiggsfieldWaitArgs({ jobId, waitTimeout = '20m', waitInterval = '3s' }) {
  if (typeof jobId !== 'string' || !SAFE_PROVIDER_JOB_ID.test(jobId)) {
    throw new HiggsfieldProviderError('Higgsfield job id is unsafe or invalid', {
      code: 'INVALID_PROVIDER_JOB_ID',
      retryable: false,
    });
  }
  assertDuration(waitTimeout, 'waitTimeout');
  assertDuration(waitInterval, 'waitInterval');
  return [
    'generate', 'wait', jobId,
    '--timeout', waitTimeout,
    '--interval', waitInterval,
    '--json', '--no-color',
  ];
}

/**
 * Legacy one-shot argv. HiggsfieldCliProvider uses it only when explicitly
 * constructed with generationMode: 'oneshot'.
 */
export function buildHiggsfieldGenerateArgs(options) {
  const {
    waitTimeout = '20m',
    waitInterval = '3s',
  } = options;
  assertDuration(waitTimeout, 'waitTimeout');
  assertDuration(waitInterval, 'waitInterval');
  return [
    ...buildHiggsfieldCreateBaseArgs(options),
    '--wait', '--wait-timeout', waitTimeout,
    '--wait-interval', waitInterval,
    '--json', '--no-color',
  ];
}

function parseJson(stdout, code, message, retryable) {
  let payload;
  try {
    payload = JSON.parse(String(stdout).trim());
  } catch (error) {
    throw new HiggsfieldProviderError(message, {
      code,
      retryable,
      cause: error,
    });
  }
  return payload;
}

function parseCreatedJobId(stdout) {
  const payload = parseJson(
    stdout,
    'INVALID_CREATE_RESPONSE',
    'Higgsfield create did not return a valid JSON job-id array',
    false,
  );
  if (!Array.isArray(payload)
    || payload.length !== 1
    || typeof payload[0] !== 'string'
    || !SAFE_PROVIDER_JOB_ID.test(payload[0])) {
    throw new HiggsfieldProviderError('Higgsfield create must return exactly one safe job-id string', {
      code: 'INVALID_CREATE_RESPONSE',
      retryable: false,
    });
  }
  return payload[0];
}

function parseCompletedJob(stdout, requestedModel, { allowArray = true, expectedJobId } = {}) {
  let payload = parseJson(
    stdout,
    'INVALID_CLI_RESPONSE',
    'Higgsfield CLI did not return valid job JSON',
    true,
  );
  if (Array.isArray(payload)) {
    if (!allowArray || payload.length !== 1) {
      throw new HiggsfieldProviderError('Higgsfield CLI response must contain exactly one job', {
        code: 'INVALID_CLI_RESPONSE',
        retryable: true,
      });
    }
    [payload] = payload;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HiggsfieldProviderError('Higgsfield CLI response must resolve to one job object', {
      code: 'INVALID_CLI_RESPONSE',
      retryable: true,
    });
  }
  if (payload.status !== 'completed') {
    throw new HiggsfieldProviderError(`Higgsfield job did not complete successfully: ${payload.status ?? 'unknown'}`, {
      code: 'JOB_NOT_COMPLETED',
      retryable: true,
    });
  }
  if (payload.job_set_type !== requestedModel) {
    throw new HiggsfieldProviderError('Higgsfield response model does not match the requested model', {
      code: 'MODEL_RESPONSE_MISMATCH',
      retryable: false,
    });
  }
  if (typeof payload.id !== 'string' || payload.id.trim() === '') {
    throw new HiggsfieldProviderError('Higgsfield response is missing its job id', {
      code: 'INVALID_CLI_RESPONSE',
      retryable: true,
    });
  }
  if (!SAFE_PROVIDER_JOB_ID.test(payload.id) || (expectedJobId && payload.id !== expectedJobId)) {
    throw new HiggsfieldProviderError('Higgsfield response job id does not match the journaled job', {
      code: 'JOB_ID_RESPONSE_MISMATCH',
      retryable: false,
    });
  }
  if (typeof payload.result_url !== 'string' || payload.result_url.trim() === '') {
    throw new HiggsfieldProviderError('Completed Higgsfield job has no result URL', {
      code: 'MISSING_RESULT_URL',
      retryable: true,
    });
  }
  return payload;
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function readProviderJournal(filename) {
  try {
    const bytes = await readFile(filename);
    let journal;
    try {
      journal = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new HiggsfieldProviderError(`Provider journal is invalid JSON: ${filename}`, {
        code: 'INVALID_PROVIDER_JOURNAL',
        retryable: false,
        cause: error,
      });
    }
    return { journal, bytes };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof HiggsfieldProviderError) throw error;
    throw new HiggsfieldProviderError(`Provider journal is not readable: ${filename}`, {
      code: 'PROVIDER_JOURNAL_READ_FAILED',
      retryable: false,
      cause: error,
    });
  }
}

async function atomicWriteProviderJournal(filename, journal) {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, filename);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        error.cleanupError = cleanupError;
      }
    }
    throw new HiggsfieldProviderError(`Provider journal could not be written atomically: ${filename}`, {
      code: 'PROVIDER_JOURNAL_WRITE_FAILED',
      retryable: false,
      cause: error,
    });
  }
  return filename;
}

function parseTrustedResultUrl(value, allowedResultHost) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new HiggsfieldProviderError('Higgsfield result URL is invalid', {
      code: 'INVALID_RESULT_URL',
      retryable: false,
      cause: error,
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password || !allowedResultHost(url.hostname)) {
    throw new HiggsfieldProviderError('Higgsfield result URL is not an allowlisted HTTPS endpoint', {
      code: 'UNTRUSTED_RESULT_URL',
      retryable: false,
    });
  }
  return url;
}

function defaultAllowedResultHost(hostname) {
  return hostname === 'higgsfield.ai'
    || hostname.endsWith('.higgsfield.ai')
    || hostname === 'cloudfront.net'
    || hostname.endsWith('.cloudfront.net');
}

async function defaultCommandRunner(binary, args, { timeoutMs }) {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    throw new HiggsfieldProviderError('Higgsfield CLI execution failed', {
      code: error?.code === 'ENOENT' ? 'CLI_NOT_INSTALLED' : 'CLI_EXECUTION_FAILED',
      retryable: error?.code !== 'ENOENT',
      cause: error,
    });
  }
}

async function downloadPng(url, {
  fetchImpl,
  downloadTimeoutMs,
  maxDownloadBytes,
}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(downloadTimeoutMs),
      headers: { accept: 'image/png' },
    });
  } catch (error) {
    throw new HiggsfieldProviderError('Failed to download the Higgsfield result', {
      code: 'RESULT_DOWNLOAD_FAILED',
      retryable: true,
      cause: error,
    });
  }
  if (!response || response.ok !== true) {
    const status = Number(response?.status) || 0;
    const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
    throw new HiggsfieldProviderError(`Higgsfield result download returned HTTP ${status || 'unknown'}`, {
      code: 'RESULT_DOWNLOAD_HTTP_ERROR',
      retryable,
    });
  }
  const mediaType = response.headers?.get?.('content-type')?.split(';', 1)[0]?.trim()?.toLowerCase();
  if (mediaType !== 'image/png') {
    throw new HiggsfieldProviderError(`Higgsfield result is not image/png: ${mediaType ?? 'missing content-type'}`, {
      code: 'INVALID_RESULT_MEDIA_TYPE',
      retryable: false,
    });
  }
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxDownloadBytes) {
    throw new HiggsfieldProviderError('Higgsfield result exceeds the download size limit', {
      code: 'RESULT_TOO_LARGE',
      retryable: false,
    });
  }
  let image;
  try {
    image = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new HiggsfieldProviderError('Failed while reading the Higgsfield result body', {
      code: 'RESULT_BODY_READ_FAILED',
      retryable: true,
      cause: error,
    });
  }
  if (image.length === 0 || image.length > maxDownloadBytes) {
    throw new HiggsfieldProviderError('Higgsfield result has an invalid byte length', {
      code: 'INVALID_RESULT_SIZE',
      retryable: false,
    });
  }
  if (image.length < PNG_SIGNATURE.length || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new HiggsfieldProviderError('Higgsfield result does not have a valid PNG signature', {
      code: 'INVALID_RESULT_PNG',
      retryable: false,
    });
  }
  return image;
}

function stableUrlForProvenance(url) {
  return `${url.origin}${url.pathname}`;
}

export class HiggsfieldCliProvider {
  constructor({
    binary = 'higgsfield',
    commandRunner = defaultCommandRunner,
    fetchImpl = globalThis.fetch,
    qaEvaluator,
    aspectRatio = '3:4',
    resolution = '2k',
    quality = 'high',
    waitTimeout = '20m',
    waitInterval = '3s',
    waitCommandAttempts = 3,
    commandTimeoutMs = 21 * 60 * 1000,
    downloadTimeoutMs = 2 * 60 * 1000,
    maxDownloadBytes = 64 * 1024 * 1024,
    allowedResultHost = defaultAllowedResultHost,
    generationMode = 'journaled',
    journalDirectory,
    clock = () => new Date(),
  } = {}) {
    if (typeof binary !== 'string' || binary.trim() === '') throw new TypeError('binary must be a non-empty string');
    if (typeof commandRunner !== 'function') throw new TypeError('commandRunner must be a function');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    if (qaEvaluator !== undefined && typeof qaEvaluator !== 'function') throw new TypeError('qaEvaluator must be a function');
    if (typeof allowedResultHost !== 'function') throw new TypeError('allowedResultHost must be a function');
    if (!['journaled', 'oneshot'].includes(generationMode)) {
      throw new TypeError("generationMode must be 'journaled' or 'oneshot'");
    }
    if (journalDirectory !== undefined && (typeof journalDirectory !== 'string' || journalDirectory.trim() === '')) {
      throw new TypeError('journalDirectory must be a non-empty string');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (!Number.isInteger(commandTimeoutMs) || commandTimeoutMs < 1_000) {
      throw new TypeError('commandTimeoutMs must be an integer of at least 1000');
    }
    if (!Number.isInteger(waitCommandAttempts) || waitCommandAttempts < 1 || waitCommandAttempts > 5) {
      throw new TypeError('waitCommandAttempts must be an integer from 1 to 5');
    }
    if (!Number.isInteger(downloadTimeoutMs) || downloadTimeoutMs < 1_000) {
      throw new TypeError('downloadTimeoutMs must be an integer of at least 1000');
    }
    if (!Number.isInteger(maxDownloadBytes) || maxDownloadBytes < PNG_SIGNATURE.length) {
      throw new TypeError(`maxDownloadBytes must be an integer of at least ${PNG_SIGNATURE.length}`);
    }
    this.binary = binary;
    this.commandRunner = commandRunner;
    this.fetchImpl = fetchImpl;
    this.qaEvaluator = qaEvaluator;
    this.aspectRatio = aspectRatio;
    this.resolution = resolution;
    this.quality = quality;
    this.waitTimeout = waitTimeout;
    this.waitInterval = waitInterval;
    this.waitCommandAttempts = waitCommandAttempts;
    this.commandTimeoutMs = commandTimeoutMs;
    this.downloadTimeoutMs = downloadTimeoutMs;
    this.maxDownloadBytes = maxDownloadBytes;
    this.allowedResultHost = allowedResultHost;
    this.generationMode = generationMode;
    this.journalDirectory = journalDirectory ? path.resolve(journalDirectory) : undefined;
    this.clock = clock;
  }

  /**
   * This adapter deliberately treats inputs as already conditioned. It validates
   * and fingerprints them; the separate reference-conditioning stage owns crops,
   * color conversion, cutouts, and readiness decisions.
   */
  async condition(context) {
    const source = context?.source;
    if (source?.path) {
      const descriptors = [{ role: context.role ?? 'reference', path: path.resolve(source.path) }];
      await validateMedia(descriptors);
      return {
        reference: { path: descriptors[0].path },
        extension: path.extname(descriptors[0].path).toLowerCase(),
        mediaType: source.mediaType,
        facts: {
          conditioning_mode: 'preconditioned_passthrough',
          role: context.role,
          byte_size: descriptors[0].size,
        },
        risks: ['READINESS_MUST_BE_CONFIRMED_BY_CONDITIONING_QA'],
      };
    }
    if (context?.role === 'outfit' && typeof source?.text === 'string' && source.text.trim() !== '') {
      return {
        facts: { conditioning_mode: 'text_passthrough', role: 'outfit', text: source.text },
        risks: [],
      };
    }
    throw new HiggsfieldProviderError('Conditioning input is missing or unsupported', {
      code: 'INVALID_CONDITIONING_INPUT',
      retryable: false,
    });
  }

  #timestamp() {
    const value = this.clock();
    if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
      throw new HiggsfieldProviderError('Provider clock returned an invalid date', {
        code: 'INVALID_PROVIDER_CLOCK',
        retryable: false,
      });
    }
    return value.toISOString();
  }

  #journalPath(context) {
    const key = context?.idempotencyKey;
    if (typeof key !== 'string' || !SHA256.test(key)) {
      throw new HiggsfieldProviderError('Journaled generation requires a lowercase SHA-256 idempotencyKey', {
        code: 'INVALID_IDEMPOTENCY_KEY',
        retryable: false,
      });
    }
    const root = this.journalDirectory
      ?? (typeof context?.workDirectory === 'string' && context.workDirectory.trim() !== ''
        ? path.join(path.resolve(context.workDirectory), 'provider-jobs')
        : null);
    if (!root) {
      throw new HiggsfieldProviderError('Journaled generation requires context.workDirectory or journalDirectory', {
        code: 'MISSING_PROVIDER_JOURNAL_DIRECTORY',
        retryable: false,
      });
    }
    return path.join(root, `${key}.json`);
  }

  #event(type, data = {}) {
    return { type, at: this.#timestamp(), ...data };
  }

  async #runCommand(args, { operation, retryable }) {
    let commandResult;
    try {
      commandResult = await this.commandRunner(this.binary, args, {
        timeoutMs: this.commandTimeoutMs,
        shell: false,
      });
    } catch (error) {
      if (error instanceof HiggsfieldProviderError) {
        if (operation === 'create') {
          throw new HiggsfieldProviderError('Higgsfield create outcome is unknown; refusing an automatic duplicate', {
            code: 'CREATE_OUTCOME_UNKNOWN',
            retryable: false,
            cause: error,
          });
        }
        throw error;
      }
      throw new HiggsfieldProviderError(`Higgsfield CLI ${operation} execution failed`, {
        code: operation === 'create' ? 'CREATE_OUTCOME_UNKNOWN' : 'CLI_EXECUTION_FAILED',
        retryable: operation === 'create' ? false : retryable,
        cause: error,
      });
    }
    if (!commandResult || (commandResult.exitCode ?? 0) !== 0) {
      throw new HiggsfieldProviderError(`Higgsfield CLI ${operation} exited unsuccessfully`, {
        code: operation === 'create' ? 'CREATE_OUTCOME_UNKNOWN' : 'CLI_NONZERO_EXIT',
        retryable: operation === 'create' ? false : retryable,
      });
    }
    return commandResult;
  }

  #requestRecord(context, model, descriptors) {
    return {
      job_set_type: model,
      phase: context.phase,
      attempt: context.attempt,
      runner_job_id: context.jobId,
      prompt_sha256: createHash('sha256').update(context.prompt).digest('hex'),
      aspect_ratio: this.aspectRatio,
      resolution: this.resolution,
      quality: HIGGSFIELD_IMAGE_MODELS[model].qualities ? this.quality : null,
      input_media: descriptors.map((item, index) => ({
        order: index + 1,
        scope: item.scope ?? null,
        role: item.role,
        sha256: item.sha256,
        pack_sha256: item.packSha256 ?? null,
        binding_order: item.bindingOrder ?? null,
      })),
    };
  }

  #assertJournal(journal, { context, model, requestSha256 }) {
    const states = new Set([
      'CREATED', 'WAITING', 'WAIT_FAILED', 'COMPLETED', 'DOWNLOAD_FAILED', 'OUTPUT_DOWNLOADED',
    ]);
    if (!journal || typeof journal !== 'object' || Array.isArray(journal)
      || journal.schema_version !== '1.0.0'
      || journal.provider !== 'higgsfield'
      || journal.idempotency_key !== context.idempotencyKey
      || journal.request_sha256 !== requestSha256
      || journal.job_set_type !== model
      || !SAFE_PROVIDER_JOB_ID.test(journal.provider_job_id ?? '')
      || !states.has(journal.state)
      || !Array.isArray(journal.events)) {
      throw new HiggsfieldProviderError('Provider journal conflicts with the immutable generation request', {
        code: 'PROVIDER_JOURNAL_CONFLICT',
        retryable: false,
      });
    }
    if (['COMPLETED', 'DOWNLOAD_FAILED', 'OUTPUT_DOWNLOADED'].includes(journal.state)
      && (!journal.provider_job || typeof journal.provider_job !== 'object')) {
      throw new HiggsfieldProviderError('Completed provider journal is missing its provider job response', {
        code: 'INVALID_PROVIDER_JOURNAL',
        retryable: false,
      });
    }
  }

  async #writeJournal(filename, journal) {
    await atomicWriteProviderJournal(filename, journal);
    return journal;
  }

  async #journaledJob(context, model, descriptors) {
    const journalPath = this.#journalPath(context);
    const request = this.#requestRecord(context, model, descriptors);
    const requestSha256 = sha256Json(request);
    const existing = await readProviderJournal(journalPath);
    let journal;
    let resumed = false;

    if (existing) {
      journal = existing.journal;
      this.#assertJournal(journal, { context, model, requestSha256 });
      resumed = true;
    } else {
      const createArgs = buildHiggsfieldCreateArgs({
        model,
        prompt: context.prompt,
        mediaPaths: descriptors.map((item) => item.path),
        aspectRatio: this.aspectRatio,
        resolution: this.resolution,
        quality: this.quality,
      });
      const created = await this.#runCommand(createArgs, { operation: 'create', retryable: false });
      const providerJobId = parseCreatedJobId(created.stdout);
      // Irreducible transport window: the process could be killed after the
      // remote create response is received but before this atomic local write.
      // Once the write completes, every restart resumes by providerJobId.
      const now = this.#timestamp();
      journal = {
        schema_version: '1.0.0',
        provider: 'higgsfield',
        transport: 'higgsfield-cli',
        idempotency_key: context.idempotencyKey,
        request_sha256: requestSha256,
        request,
        job_set_type: model,
        provider_job_id: providerJobId,
        state: 'CREATED',
        created_at: now,
        updated_at: now,
        events: [{ type: 'CREATED', at: now, provider_job_id: providerJobId }],
      };
      await this.#writeJournal(journalPath, journal);
    }

    let job;
    if (['COMPLETED', 'OUTPUT_DOWNLOADED'].includes(journal.state)) {
      job = parseCompletedJob(JSON.stringify(journal.provider_job), model, {
        allowArray: false,
        expectedJobId: journal.provider_job_id,
      });
    } else {
      for (let waitAttempt = 1; waitAttempt <= this.waitCommandAttempts; waitAttempt += 1) {
        journal = {
          ...journal,
          state: 'WAITING',
          updated_at: this.#timestamp(),
          events: [...journal.events, this.#event('WAIT_STARTED', { provider_job_id: journal.provider_job_id, wait_attempt: waitAttempt })],
        };
        await this.#writeJournal(journalPath, journal);
        try {
          const waitArgs = buildHiggsfieldWaitArgs({
            jobId: journal.provider_job_id,
            waitTimeout: this.waitTimeout,
            waitInterval: this.waitInterval,
          });
          const waited = await this.#runCommand(waitArgs, { operation: 'wait', retryable: true });
          job = parseCompletedJob(waited.stdout, model, {
            allowArray: false,
            expectedJobId: journal.provider_job_id,
          });
          break;
        } catch (error) {
          journal = {
            ...journal,
            state: 'WAIT_FAILED',
            updated_at: this.#timestamp(),
            events: [...journal.events, this.#event('WAIT_FAILED', {
              code: error?.code ?? 'WAIT_FAILED',
              retryable: error?.retryable !== false,
              wait_attempt: waitAttempt,
            })],
          };
          await this.#writeJournal(journalPath, journal);
          if (error?.retryable === false || waitAttempt === this.waitCommandAttempts) throw error;
        }
      }
      journal = {
        ...journal,
        state: 'COMPLETED',
        provider_job: {
          id: job.id,
          status: job.status,
          display_name: job.display_name,
          job_set_type: job.job_set_type,
          result_url: job.result_url,
          created_at: job.created_at,
          params: {
            width: job.params?.width,
            height: job.params?.height,
            aspect_ratio: job.params?.aspect_ratio,
            quality: job.params?.quality,
            resolution: job.params?.resolution,
            model: job.params?.model,
          },
        },
        updated_at: this.#timestamp(),
        completed_at: this.#timestamp(),
        events: [...journal.events, this.#event('COMPLETED', {
          provider_job_id: job.id,
          result_url_sha256: createHash('sha256').update(job.result_url).digest('hex'),
        })],
      };
      await this.#writeJournal(journalPath, journal);
    }

    return { job, journal, journalPath, requestSha256, resumed };
  }

  async generate(context) {
    if (context?.job_set_type !== undefined
      && context?.model !== undefined
      && context.job_set_type !== context.model) {
      throw new HiggsfieldProviderError('Generation context model and job_set_type disagree', {
        code: 'MODEL_CONTEXT_MISMATCH',
        retryable: false,
      });
    }
    const model = context?.job_set_type ?? context?.model;
    const spec = modelSpec(model);
    const phase = context?.phase;
    if (!['avatar', 'outfit', 'garment', 'scene'].includes(phase)) {
      throw new HiggsfieldProviderError(`Unsupported generation phase: ${phase}`, {
        code: 'INVALID_GENERATION_PHASE',
        retryable: false,
      });
    }
    const descriptors = orderedReferenceDescriptors(phase, context.references);
    await validateMedia(descriptors);
    let job;
    let journalInfo;
    if (this.generationMode === 'oneshot') {
      const args = buildHiggsfieldGenerateArgs({
        model,
        prompt: context.prompt,
        mediaPaths: descriptors.map((item) => item.path),
        aspectRatio: this.aspectRatio,
        resolution: this.resolution,
        quality: this.quality,
        waitTimeout: this.waitTimeout,
        waitInterval: this.waitInterval,
      });
      const commandResult = await this.#runCommand(args, { operation: 'oneshot', retryable: true });
      job = parseCompletedJob(commandResult.stdout, model);
    } else {
      journalInfo = await this.#journaledJob(context, model, descriptors);
      job = journalInfo.job;
    }

    let resultUrl;
    let image;
    try {
      resultUrl = parseTrustedResultUrl(job.result_url, this.allowedResultHost);
      image = await downloadPng(resultUrl, {
        fetchImpl: this.fetchImpl,
        downloadTimeoutMs: this.downloadTimeoutMs,
        maxDownloadBytes: this.maxDownloadBytes,
      });
    } catch (error) {
      if (journalInfo) {
        const journal = {
          ...journalInfo.journal,
          state: 'DOWNLOAD_FAILED',
          updated_at: this.#timestamp(),
          events: [...journalInfo.journal.events, this.#event('DOWNLOAD_FAILED', {
            code: error?.code ?? 'DOWNLOAD_FAILED',
            retryable: error?.retryable !== false,
          })],
        };
        await this.#writeJournal(journalInfo.journalPath, journal);
      }
      throw error;
    }
    const imageSha256 = createHash('sha256').update(image).digest('hex');
    let providerJournal;
    if (journalInfo) {
      const previousOutputSha256 = journalInfo.journal.output?.sha256;
      if (previousOutputSha256 && previousOutputSha256 !== imageSha256) {
        throw new HiggsfieldProviderError('Downloaded output differs from the journaled provider output', {
          code: 'JOURNALED_OUTPUT_MISMATCH',
          retryable: false,
        });
      }
      const eventType = journalInfo.journal.state === 'OUTPUT_DOWNLOADED'
        ? 'OUTPUT_REDOWNLOADED'
        : 'OUTPUT_DOWNLOADED';
      const journal = {
        ...journalInfo.journal,
        state: 'OUTPUT_DOWNLOADED',
        updated_at: this.#timestamp(),
        output: {
          sha256: imageSha256,
          byte_size: image.length,
          media_type: 'image/png',
          result_url: stableUrlForProvenance(resultUrl),
          result_url_sha256: createHash('sha256').update(job.result_url).digest('hex'),
        },
        events: [...journalInfo.journal.events, this.#event(eventType, {
          output_sha256: imageSha256,
          byte_size: image.length,
        })],
      };
      await this.#writeJournal(journalInfo.journalPath, journal);
      const journalBytes = await readFile(journalInfo.journalPath);
      providerJournal = {
        path: journalInfo.journalPath,
        sha256: createHash('sha256').update(journalBytes).digest('hex'),
        request_sha256: journalInfo.requestSha256,
        state: journal.state,
        resumed: journalInfo.resumed,
        event_count: journal.events.length,
      };
    }

    return {
      image,
      extension: '.png',
      mediaType: 'image/png',
      metadata: {
        provider: 'higgsfield',
        transport: 'higgsfield-cli',
        generation_mode: this.generationMode,
        job_id: job.id,
        status: job.status,
        job_set_type: model,
        model_name: job.display_name ?? spec.displayName,
        provider_internal_model: job.params?.model,
        aspect_ratio: job.params?.aspect_ratio ?? this.aspectRatio,
        resolution: job.params?.resolution ?? this.resolution,
        quality: job.params?.quality ?? (spec.qualities ? this.quality : undefined),
        result_url: stableUrlForProvenance(resultUrl),
        result_url_sha256: createHash('sha256').update(job.result_url).digest('hex'),
        output_sha256: imageSha256,
        input_media: descriptors.map((item, index) => ({
          index: index + 1,
          scope: item.scope,
          role: item.role,
          path: item.path,
          sha256: item.sha256,
          byte_size: item.size,
          media_type: item.mediaType ?? MEDIA_TYPES_BY_EXTENSION[path.extname(item.path).toLowerCase()],
          source: item.source,
          pack_path: item.packPath,
          pack_sha256: item.packSha256,
          binding_order: item.bindingOrder,
        })),
        idempotency_key: context.idempotencyKey,
        provider_journal: providerJournal,
      },
    };
  }

  async qa(context) {
    if (!this.qaEvaluator) {
      return {
        decision: 'NEEDS_INPUT',
        checks: [{ name: 'EXTERNAL_QA_CONFIGURED', pass: false }],
        defects: ['No production QA evaluator is configured'],
        reason: 'higgsfield_provider_does_not_auto_approve_semantic_quality',
      };
    }
    const decision = await this.qaEvaluator(context);
    if (!decision || !['PASS', 'RETRY', 'NEEDS_INPUT', 'REJECT'].includes(decision.decision)) {
      throw new HiggsfieldProviderError('QA evaluator returned an invalid decision', {
        code: 'INVALID_QA_DECISION',
        retryable: false,
      });
    }
    return decision;
  }
}

export function createProvider(options) {
  return new HiggsfieldCliProvider(options);
}
