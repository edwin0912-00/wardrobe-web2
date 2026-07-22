import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertModelRoute, IMAGE_MODEL_ROUTE } from './model-policy.js';

const SAFE_JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const OUTFIT_MODES = new Set(['text', 'reference_image', 'reference_image_plus_text']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function deepFreeze(value) {
  if (ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function validateReferencePack(value, field) {
  if (typeof value === 'string') {
    requireString(value, field);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be a path string or an object with a path`);
  }
  requireString(value.path, `${field}.path`);
  if (value.path_base !== undefined) requireString(value.path_base, `${field}.path_base`);
}

export function validateJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new Error('job must be an object');
  requireString(job.job_id, 'job.job_id');
  if (!SAFE_JOB_ID.test(job.job_id)) throw new Error('job.job_id contains unsafe characters');
  requireString(job.identity_reference, 'job.identity_reference');
  if (job.identity_reference_pack !== undefined) {
    validateReferencePack(job.identity_reference_pack, 'job.identity_reference_pack');
  }
  requireString(job.output_directory, 'job.output_directory');
  if (!job.outfit || typeof job.outfit !== 'object') throw new Error('job.outfit must be an object');
  if (!OUTFIT_MODES.has(job.outfit.mode)) throw new Error(`Unsupported outfit mode: ${job.outfit.mode}`);
  if (job.outfit.mode === 'text' || job.outfit.mode === 'reference_image_plus_text') {
    requireString(job.outfit.text, 'job.outfit.text');
  }
  if (job.outfit.mode === 'reference_image' || job.outfit.mode === 'reference_image_plus_text') {
    requireString(job.outfit.reference, 'job.outfit.reference');
  }
  if (job.outfit.reference_pack !== undefined) {
    validateReferencePack(job.outfit.reference_pack, 'job.outfit.reference_pack');
    if (!job.outfit.reference) {
      throw new Error('job.outfit.reference_pack requires job.outfit.reference raw source');
    }
  }
  if (!job.prompts || typeof job.prompts !== 'object') throw new Error('job.prompts must be an object');
  requireString(job.prompts.avatar, 'job.prompts.avatar');
  requireString(job.prompts.outfit, 'job.prompts.outfit');
  if (job.prompts.repair !== undefined) requireString(job.prompts.repair, 'job.prompts.repair');
  if (job.quality_references !== undefined && !Array.isArray(job.quality_references)) {
    throw new Error('job.quality_references must be an array');
  }
  for (const [index, item] of (job.quality_references ?? []).entries()) {
    requireString(item, `job.quality_references[${index}]`);
  }
  const maxAttempts = job.max_attempts ?? IMAGE_MODEL_ROUTE.length;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > IMAGE_MODEL_ROUTE.length) {
    throw new Error(`job.max_attempts must be between 1 and ${IMAGE_MODEL_ROUTE.length}`);
  }
  const conditioningAttempts = job.conditioning_max_attempts ?? 2;
  if (!Number.isInteger(conditioningAttempts) || conditioningAttempts < 1 || conditioningAttempts > 3) {
    throw new Error('job.conditioning_max_attempts must be between 1 and 3');
  }
  assertModelRoute(job.model_route);
  return job;
}

function resolveFile(baseDirectory, value) {
  return path.resolve(baseDirectory, value);
}

function normalizeReferencePack(value, baseDirectory) {
  if (value === undefined) return undefined;
  const descriptor = typeof value === 'string' ? { path: value } : value;
  return {
    ...descriptor,
    path: resolveFile(baseDirectory, descriptor.path),
    path_base: descriptor.path_base ? resolveFile(baseDirectory, descriptor.path_base) : undefined,
  };
}

export function normalizeJob(job, baseDirectory) {
  validateJob(job);
  const outfit = {
    ...job.outfit,
    reference: job.outfit.reference ? resolveFile(baseDirectory, job.outfit.reference) : undefined,
  };
  return deepFreeze({
    ...job,
    identity_reference: resolveFile(baseDirectory, job.identity_reference),
    identity_reference_pack: normalizeReferencePack(job.identity_reference_pack, baseDirectory),
    output_directory: resolveFile(baseDirectory, job.output_directory),
    quality_references: (job.quality_references ?? []).map((item) => resolveFile(baseDirectory, item)),
    prompts: {
      avatar: resolveFile(baseDirectory, job.prompts.avatar),
      outfit: resolveFile(baseDirectory, job.prompts.outfit),
      repair: job.prompts.repair ? resolveFile(baseDirectory, job.prompts.repair) : undefined,
    },
    outfit: {
      ...outfit,
      reference_pack: normalizeReferencePack(job.outfit.reference_pack, baseDirectory),
    },
    max_attempts: job.max_attempts ?? IMAGE_MODEL_ROUTE.length,
    conditioning_max_attempts: job.conditioning_max_attempts ?? 2,
  });
}

export async function loadJobFile(filename) {
  const absolutePath = path.resolve(filename);
  const bytes = await readFile(absolutePath);
  const originalHash = sha256(bytes);
  const parsed = JSON.parse(bytes.toString('utf8'));
  const immutableJob = deepFreeze(parsed);
  const normalizedJob = normalizeJob(immutableJob, path.dirname(absolutePath));
  return deepFreeze({
    sourcePath: absolutePath,
    sourceHash: originalHash,
    sourceBytes: Buffer.from(bytes),
    job: immutableJob,
    normalizedJob,
  });
}

export function loadJobObject(job, { baseDirectory = process.cwd(), source = '<memory>' } = {}) {
  const cloned = structuredClone(job);
  const canonical = Buffer.from(JSON.stringify(cloned));
  const immutableJob = deepFreeze(cloned);
  return deepFreeze({
    sourcePath: source,
    sourceHash: sha256(canonical),
    sourceBytes: canonical,
    job: immutableJob,
    normalizedJob: normalizeJob(immutableJob, path.resolve(baseDirectory)),
  });
}
