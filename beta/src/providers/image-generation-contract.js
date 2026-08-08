import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MEDIA_TYPES_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});

export class ImageGenerationContractError extends Error {
  constructor(message, { code = 'IMAGE_GENERATION_CONTRACT_ERROR', retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ImageGenerationContractError';
    this.code = code;
    this.retryable = retryable;
  }
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

function invalid(message, code = 'INVALID_ORDERED_REFERENCES') {
  return new ImageGenerationContractError(message, { code });
}

function orderedPackDescriptors(phase, references, maxOrdered) {
  if (!Array.isArray(references?.ordered)) return null;
  if (references.ordered.length === 0 || references.ordered.length > maxOrdered) {
    throw invalid(`references.ordered must contain 1–${maxOrdered} media bindings`);
  }
  const result = references.ordered.map((binding, index) => {
    if (!binding || typeof binding !== 'object' || binding.order !== index + 1
      || typeof binding.path !== 'string' || binding.path.trim() === ''
      || typeof binding.role !== 'string' || binding.role.trim() === '') {
      throw invalid('references.ordered is not a contiguous, ordered media binding list');
    }
    if (!['identity', 'outfit', 'avatar', 'scene'].includes(binding.scope)) {
      throw invalid(`Unsupported ordered reference scope: ${binding.scope}`);
    }
    if (!['REFERENCE_PACK', 'CONDITIONED', 'APPROVED_AVATAR', 'REPAIR_CANDIDATE'].includes(binding.source)) {
      throw invalid(`Unsupported ordered reference source: ${binding.source}`);
    }
    if ((binding.scope === 'scene') !== (binding.source === 'REPAIR_CANDIDATE')) {
      throw invalid('A scene-scoped binding must be the explicit repair candidate', 'INVALID_SCENE_REPAIR_BINDING');
    }
    if (typeof binding.mediaType !== 'string' || binding.mediaType.trim() === '') throw invalid('Ordered reference must declare its mediaType');
    if (!SHA256.test(binding.sha256)) throw invalid('Ordered reference must have a lowercase sha256 digest');
    if (binding.packSha256 !== undefined && !SHA256.test(binding.packSha256)) throw invalid('Ordered reference pack has an invalid sha256 digest');
    if (binding.source === 'REFERENCE_PACK' && (typeof binding.packPath !== 'string'
      || binding.packPath.trim() === '' || !SHA256.test(binding.packSha256)
      || !Number.isInteger(binding.bindingOrder) || binding.bindingOrder < 1)) {
      throw invalid('REFERENCE_PACK bindings require packPath, packSha256, and bindingOrder');
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
  if (phase === 'avatar' && result.some((item) => item.scope !== 'identity')) throw invalid('Avatar ordered references may contain only conditioned identity bindings', 'INVALID_AVATAR_REFERENCE_ORDER');
  if (phase === 'outfit' && result[0]?.scope !== 'avatar') throw invalid('Outfit ordered references must begin with the approved avatar', 'MISSING_APPROVED_AVATAR');
  if (phase === 'outfit' && result.slice(1).some((item) => item.scope === 'avatar')) throw invalid('The approved avatar may appear only once and first', 'INVALID_OUTFIT_REFERENCE_ORDER');
  if (phase === 'garment' && result.some((item) => item.scope !== 'outfit')) throw invalid('Підготовка еталонного зображення приймає лише фото речей', 'INVALID_GARMENT_REFERENCE_ORDER');
  if (phase === 'scene' && result[0]?.scope !== 'avatar') throw invalid('Scene generation must begin with the approved outfit still', 'MISSING_APPROVED_OUTFIT');
  if (phase === 'scene' && result.slice(1).some((item) => item.scope === 'avatar')) throw invalid('The approved outfit may appear only once and first in scene generation', 'INVALID_SCENE_REFERENCE_ORDER');
  const repairBindings = result.filter((item) => item.scope === 'scene');
  if (phase !== 'scene' && repairBindings.length > 0) throw invalid('A failed-scene repair candidate is valid only during scene generation', 'INVALID_SCENE_REPAIR_BINDING');
  if (phase === 'scene' && (repairBindings.length > 1 || (repairBindings.length === 1 && (result[1] !== repairBindings[0] || repairBindings[0].role !== 'FAILED_SCENE_CANDIDATE')))) {
    throw invalid('Scene repair accepts at most one FAILED_SCENE_CANDIDATE immediately after the approved look', 'INVALID_SCENE_REPAIR_BINDING');
  }
  const paths = result.map((item) => item.path);
  if (new Set(paths).size !== paths.length) throw invalid('Ordered references may not contain duplicate paths', 'DUPLICATE_ORDERED_REFERENCE');
  return result;
}

export function orderedReferenceDescriptors(phase, references, { maxOrdered = 8 } = {}) {
  if (!references || typeof references !== 'object') throw invalid('Generation references are required', 'MISSING_REFERENCES');
  const packed = orderedPackDescriptors(phase, references, maxOrdered);
  if (packed) return packed;
  const ordered = phase === 'outfit'
    ? [artifactDescriptor(references.avatar, 'approved_avatar'), artifactDescriptor(references.identity, 'conditioned_identity'), artifactDescriptor(references.outfit, 'conditioned_outfit')]
    : [artifactDescriptor(references.identity, 'conditioned_identity')];
  const result = [];
  const seen = new Set();
  for (const descriptor of ordered.filter(Boolean)) {
    if (!seen.has(descriptor.path)) { seen.add(descriptor.path); result.push(descriptor); }
  }
  if (phase === 'avatar' && result.length < 1) throw invalid('Avatar generation requires a conditioned identity image', 'MISSING_IDENTITY_REFERENCE');
  if (phase === 'outfit' && result[0]?.role !== 'approved_avatar') throw invalid('Outfit generation requires the approved avatar as its first reference', 'MISSING_APPROVED_AVATAR');
  if (result.length > maxOrdered) throw invalid(`At most ${maxOrdered} generation references are allowed`, 'TOO_MANY_REFERENCES');
  return result;
}

function hasExpectedImageSignature(bytes, extension) {
  if (extension === '.png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (extension === '.jpg' || extension === '.jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === '.webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function normalizedPackBindings(payload) {
  if (Array.isArray(payload?.generation_bindings)) return payload.generation_bindings.map((item) => ({ order: item?.order, role: item?.role, sha256: item?.sha256 }));
  if (Array.isArray(payload?.references)) return payload.references.filter((item) => item?.role !== 'QUALITY_BENCHMARK' && item?.authority !== 'QUALITY_ONLY').map((item, index) => ({ order: index + 1, role: item?.role, sha256: item?.sha256 }));
  return null;
}

export async function validateMedia(descriptors) {
  const verifiedPacks = new Map();
  for (const descriptor of descriptors) {
    const extension = path.extname(descriptor.path).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) throw invalid(`Unsupported reference image extension: ${extension || '<none>'}`, 'UNSUPPORTED_REFERENCE_MEDIA');
    if (descriptor.mediaType && descriptor.mediaType !== MEDIA_TYPES_BY_EXTENSION[extension]) throw invalid(`Reference mediaType does not match its extension: ${descriptor.path}`, 'REFERENCE_MEDIA_TYPE_MISMATCH');
    let bytes;
    try {
      const info = await stat(descriptor.path);
      if (!info.isFile() || info.size === 0) throw new Error('not a non-empty regular file');
      descriptor.size = info.size;
      bytes = await readFile(descriptor.path);
    } catch (cause) {
      throw new ImageGenerationContractError(`Reference image is not readable: ${descriptor.path}`, { code: 'REFERENCE_NOT_READABLE', cause });
    }
    if (!hasExpectedImageSignature(bytes, extension)) throw invalid(`Reference content does not match its image extension: ${descriptor.path}`, 'INVALID_REFERENCE_MEDIA');
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (descriptor.sha256 && descriptor.sha256 !== actualSha256) throw invalid(`Reference image digest does not match: ${descriptor.path}`, 'REFERENCE_DIGEST_MISMATCH');
    descriptor.sha256 = actualSha256;
    if (!descriptor.packPath) continue;
    let pack = verifiedPacks.get(descriptor.packPath);
    if (!pack) {
      let packBytes;
      try {
        const info = await stat(descriptor.packPath);
        if (!info.isFile() || info.size === 0) throw new Error('not a non-empty regular file');
        packBytes = await readFile(descriptor.packPath);
      } catch (cause) {
        throw new ImageGenerationContractError(`Reference pack is not readable: ${descriptor.packPath}`, { code: 'REFERENCE_PACK_NOT_READABLE', cause });
      }
      let payload;
      try { payload = JSON.parse(packBytes.toString('utf8')); } catch (cause) { throw new ImageGenerationContractError(`Reference pack is not valid JSON: ${descriptor.packPath}`, { code: 'INVALID_REFERENCE_PACK', cause }); }
      const bindings = normalizedPackBindings(payload);
      if (!bindings) throw invalid(`Reference pack has no supported media bindings: ${descriptor.packPath}`, 'INVALID_REFERENCE_PACK');
      pack = { sha256: createHash('sha256').update(packBytes).digest('hex'), bindings };
      verifiedPacks.set(descriptor.packPath, pack);
    }
    if (descriptor.packSha256 && descriptor.packSha256 !== pack.sha256) throw invalid(`Reference pack digest does not match: ${descriptor.packPath}`, 'REFERENCE_PACK_DIGEST_MISMATCH');
    descriptor.packSha256 = pack.sha256;
    if (descriptor.source === 'REFERENCE_PACK') {
      const binding = pack.bindings.find((item) => item?.order === descriptor.bindingOrder);
      if (!binding || binding.role !== descriptor.role || binding.sha256 !== descriptor.sha256) throw invalid(`Reference does not match its declared pack binding: ${descriptor.path}`, 'REFERENCE_PACK_BINDING_MISMATCH');
    }
  }
}

function sha256Json(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function adapterEvaluator(context, decision, model = 'qa-adapter') {
  const core = { type: 'ADAPTER', provider: 'image-generation-contract', model, version: '1.0.0', phase: context?.phase ?? null, attempt: Number.isInteger(context?.attempt) ? context.attempt : null, idempotency_key: context?.idempotencyKey ?? null, evidence_manifest_sha256: context?.evidence_manifest_sha256 ?? null, decision };
  return { ...core, evaluation_id: sha256Json(core) };
}

export function validateQaDecision(value, context) {
  if (!value || !['PASS', 'RETRY', 'NEEDS_INPUT', 'REJECT'].includes(value.decision)) throw invalid('QA evaluator returned an invalid decision', 'INVALID_QA_DECISION');
  const checksValid = Array.isArray(value.checks) && value.checks.length > 0 && value.checks.every((check) => check && typeof check.name === 'string' && check.name.trim() !== '' && typeof check.pass === 'boolean' && typeof check.score === 'number' && check.score >= 0 && check.score <= 1 && typeof check.evidence === 'string' && check.evidence.trim() !== '');
  if (typeof value.reason !== 'string' || value.reason.trim() === '' || !checksValid || !Array.isArray(value.defects)) throw invalid('QA evaluator returned incomplete evidence', 'INVALID_QA_EVIDENCE');
  if (value.decision === 'PASS' && (value.checks.some((check) => !check.pass) || value.defects.length > 0)) throw invalid('QA evaluator returned an internally contradictory PASS', 'INVALID_QA_PASS');
  const evaluator = value.evaluator;
  const ambiguous = /^(?:latest|current|unknown|unattested)$/i;
  const evaluatorValid = evaluator && ['MODEL', 'FIXTURE', 'REPLAY', 'ADAPTER', 'IMPORTED_RECEIPT'].includes(evaluator.type) && ['provider', 'model', 'version'].every((field) => typeof evaluator[field] === 'string' && evaluator[field].trim() !== '' && !ambiguous.test(evaluator[field].trim())) && typeof evaluator.evaluation_id === 'string' && SHA256.test(evaluator.evaluation_id);
  if (!evaluatorValid) {
    if (value.decision !== 'PASS') return { ...value, evaluator: adapterEvaluator(context, value.decision, 'external-qa-failure-adapter') };
    throw invalid('QA PASS is missing exact evaluator attestation', 'INVALID_QA_EVALUATOR_ATTESTATION');
  }
  return value;
}

export async function readProviderJournal(filename) {
  try {
    const bytes = await readFile(filename);
    let journal;
    try { journal = JSON.parse(bytes.toString('utf8')); } catch (cause) { throw new ImageGenerationContractError(`Provider journal is invalid JSON: ${filename}`, { code: 'INVALID_PROVIDER_JOURNAL', cause }); }
    return { journal, bytes };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof ImageGenerationContractError) throw error;
    throw new ImageGenerationContractError(`Provider journal is not readable: ${filename}`, { code: 'PROVIDER_JOURNAL_READ_FAILED', cause: error });
  }
}

export async function atomicWriteProviderJournal(filename, journal) {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, filename);
  } catch (cause) {
    try { await unlink(temporary); } catch (cleanupError) { if (cleanupError?.code !== 'ENOENT') cause.cleanupError = cleanupError; }
    throw new ImageGenerationContractError(`Provider journal could not be written atomically: ${filename}`, { code: 'PROVIDER_JOURNAL_WRITE_FAILED', cause });
  }
  return filename;
}
