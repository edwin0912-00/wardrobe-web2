import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './artifact-store.js';
import { deepFreeze } from './job.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function mediaTypeFor(filename) {
  const extension = path.extname(filename).toLowerCase();
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }[extension] ?? 'application/octet-stream';
}

function inferredBaseFromRawSource(rawSourcePath, declaredSourcePath) {
  if (path.isAbsolute(declaredSourcePath)) {
    if (path.resolve(declaredSourcePath) !== path.resolve(rawSourcePath)) {
      throw new Error('Reference pack source.path does not bind to the job raw source');
    }
    return path.dirname(declaredSourcePath);
  }

  const normalized = path.normalize(declaredSourcePath);
  const segments = normalized.split(path.sep).filter((segment) => segment && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    throw new Error('Reference pack source.path must be a safe relative path');
  }

  let base = path.dirname(path.resolve(rawSourcePath));
  for (let index = 1; index < segments.length; index += 1) base = path.dirname(base);
  if (path.resolve(base, normalized) !== path.resolve(rawSourcePath)) {
    throw new Error('Reference pack source.path does not bind to the job raw source');
  }
  return base;
}

function resolvePackBase(descriptor, document, rawSourcePath) {
  if (descriptor.path_base) return descriptor.path_base;
  if (document.source?.path) {
    return inferredBaseFromRawSource(rawSourcePath, document.source.path);
  }
  return path.dirname(descriptor.path);
}

function resolveLocalReference(baseDirectory, value, field) {
  requireNonEmptyString(value, field);
  if (value.startsWith('file:')) return fileURLToPath(value);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error(`${field} must point to a local file, not an external URI`);
  }
  return path.resolve(baseDirectory, value);
}

function rawBindings(document) {
  if (Array.isArray(document.generation_bindings)) {
    return document.generation_bindings.map((binding, index) => ({
      bindingOrder: binding.order,
      role: binding.role,
      relativePath: binding.path,
      declaredSha256: binding.sha256,
      bindingId: binding.binding_id ?? null,
      refType: binding.ref_type ?? 'DERIVATIVE',
      sourceIndex: index,
    }));
  }
  if (Array.isArray(document.references)) {
    return document.references
      .filter((binding) => binding.role !== 'QUALITY_BENCHMARK' && binding.authority !== 'QUALITY_ONLY')
      .map((binding, index) => ({
        bindingOrder: index + 1,
        role: binding.role,
        relativePath: binding.uri,
        declaredSha256: binding.sha256,
        bindingId: binding.binding_id ?? null,
        refType: binding.ref_type ?? null,
        sourceIndex: index,
      }));
  }
  throw new Error('Reference pack must contain generation_bindings or references');
}

async function loadOneReferencePack(scope, descriptor, rawSourcePath) {
  const packBytes = await readFile(descriptor.path);
  let document;
  try {
    document = JSON.parse(packBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid ${scope} reference pack JSON: ${error.message}`);
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${scope} reference pack must contain a JSON object`);
  }
  const expectedKind = scope === 'identity' ? 'HUMAN' : 'GARMENT';
  if (document.kind && document.kind !== expectedKind) {
    throw new Error(`${scope} reference pack kind must be ${expectedKind}`);
  }

  const packSha256 = sha256(packBytes);
  const pathBase = resolvePackBase(descriptor, document, rawSourcePath);
  const rawBytes = await readFile(rawSourcePath);
  const rawSha256 = sha256(rawBytes);
  if (document.source?.sha256 && document.source.sha256 !== rawSha256) {
    throw new Error(`${scope} reference pack source sha256 does not match the job raw source`);
  }
  if (document.source?.path && path.resolve(pathBase, document.source.path) !== path.resolve(rawSourcePath)) {
    throw new Error(`${scope} reference pack source.path does not bind to the job raw source`);
  }

  const candidates = rawBindings(document);
  if (candidates.length === 0) throw new Error(`${scope} reference pack has no generation media bindings`);
  const seenOrders = new Set();
  for (const [index, candidate] of candidates.entries()) {
    if (!Number.isInteger(candidate.bindingOrder) || candidate.bindingOrder < 1) {
      throw new Error(`${scope} reference pack binding ${index} must have a positive integer order`);
    }
    if (seenOrders.has(candidate.bindingOrder)) {
      throw new Error(`${scope} reference pack contains duplicate binding order ${candidate.bindingOrder}`);
    }
    seenOrders.add(candidate.bindingOrder);
    requireNonEmptyString(candidate.role, `${scope} reference pack binding ${index}.role`);
    requireNonEmptyString(candidate.relativePath, `${scope} reference pack binding ${index}.path`);
    if (!SHA256_PATTERN.test(candidate.declaredSha256 ?? '')) {
      throw new Error(`${scope} reference pack binding ${index}.sha256 must be a lowercase SHA-256`);
    }
  }
  candidates.sort((left, right) => left.bindingOrder - right.bindingOrder);
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.bindingOrder !== index + 1) {
      throw new Error(`${scope} reference pack binding orders must be contiguous from 1`);
    }
  }

  const bindings = [];
  for (const candidate of candidates) {
    const filename = resolveLocalReference(
      pathBase,
      candidate.relativePath,
      `${scope} reference pack binding ${candidate.bindingOrder}.path`,
    );
    const digest = sha256(await readFile(filename));
    if (digest !== candidate.declaredSha256) {
      throw new Error(
        `${scope} reference pack binding ${candidate.bindingOrder} sha256 mismatch for ${filename}`,
      );
    }
    bindings.push({
      bindingOrder: candidate.bindingOrder,
      role: candidate.role,
      path: filename,
      sha256: digest,
      mediaType: mediaTypeFor(filename),
      bindingId: candidate.bindingId,
      refType: candidate.refType,
    });
  }

  return deepFreeze({
    scope,
    path: descriptor.path,
    sha256: packSha256,
    pathBase,
    assetId: document.asset_id ?? document.pack_id ?? null,
    kind: document.kind ?? null,
    source: {
      path: rawSourcePath,
      sha256: rawSha256,
    },
    bindings,
  });
}

export async function resolveReferencePacks(job) {
  const [identity, outfit] = await Promise.all([
    job.identity_reference_pack
      ? loadOneReferencePack('identity', job.identity_reference_pack, job.identity_reference)
      : null,
    job.outfit.reference_pack
      ? loadOneReferencePack('outfit', job.outfit.reference_pack, job.outfit.reference)
      : null,
  ]);
  return deepFreeze({ identity, outfit });
}

export function referencePackInputFiles(referencePacks) {
  const entries = [];
  for (const scope of ['identity', 'outfit']) {
    const pack = referencePacks[scope];
    if (!pack) continue;
    entries.push([
      `${scope}_reference_pack`,
      pack.path,
      { kind: 'REFERENCE_PACK', scope },
    ]);
    for (const [index, binding] of pack.bindings.entries()) {
      entries.push([
        `${scope}_reference_pack_binding_${String(index + 1).padStart(3, '0')}`,
        binding.path,
        {
          kind: 'REFERENCE_PACK_MEDIA',
          scope,
          role: binding.role,
          binding_order: binding.bindingOrder,
          declared_sha256: binding.sha256,
          ...(binding.bindingId ? { binding_id: binding.bindingId } : {}),
        },
      ]);
    }
  }
  return entries;
}

export function providerReferencesFromPack(pack) {
  if (!pack) return [];
  return pack.bindings.map((binding) => ({
    scope: pack.scope,
    role: binding.role,
    path: binding.path,
    sha256: binding.sha256,
    mediaType: binding.mediaType,
    source: 'REFERENCE_PACK',
    bindingOrder: binding.bindingOrder,
    bindingId: binding.bindingId,
    refType: binding.refType,
    packPath: pack.path,
    packSha256: pack.sha256,
  }));
}

export function providerPackSummary(pack) {
  if (!pack) return null;
  return {
    path: pack.path,
    sha256: pack.sha256,
    assetId: pack.assetId,
    kind: pack.kind,
    source: pack.source,
    bindings: pack.bindings,
  };
}
