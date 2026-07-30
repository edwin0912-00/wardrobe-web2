import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './scene-contract.js';

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class VideoReferenceRegistryError extends Error {
  constructor(message, { code = 'VIDEO_REFERENCE_INVALID', status = 409, cause } = {}) {
    super(message, { cause });
    this.name = 'VideoReferenceRegistryError';
    this.code = code;
    this.status = status;
  }
}

function validateManifest(manifest) {
  if (manifest?.schema_version !== '1.0.0'
    || typeof manifest.pack_id !== 'string'
    || !Array.isArray(manifest.references)
    || manifest.references.length === 0) {
    throw new VideoReferenceRegistryError('Fashion Video reference manifest is invalid');
  }
  for (const reference of manifest.references) {
    if (typeof reference?.id !== 'string'
      || !SAFE_FILENAME.test(reference?.filename ?? '')
      || !SHA256.test(reference?.sha256 ?? '')
      || !Number.isInteger(reference?.bytes)
      || reference.bytes < 1
      || !Array.isArray(reference?.motion_modes)
      || reference.motion_modes.length === 0) {
      throw new VideoReferenceRegistryError('Fashion Video reference entry is invalid');
    }
  }
  return manifest;
}

export function createFashionVideoReferenceResolver({
  rootDirectory,
  manifestPath,
} = {}) {
  return async function resolveFashionVideoReference({ motionMode = null } = {}) {
    if (typeof rootDirectory !== 'string' || rootDirectory.length === 0) return null;
    if (typeof manifestPath !== 'string' || manifestPath.length === 0) {
      throw new VideoReferenceRegistryError('Fashion Video reference manifest is not configured', {
        code: 'VIDEO_REFERENCE_MISCONFIGURED',
        status: 500,
      });
    }

    let manifestBytes;
    let manifest;
    try {
      manifestBytes = await readFile(manifestPath);
      manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')));
    } catch (cause) {
      if (cause instanceof VideoReferenceRegistryError) throw cause;
      throw new VideoReferenceRegistryError('Fashion Video reference manifest cannot be read', {
        code: 'VIDEO_REFERENCE_MISCONFIGURED',
        status: 500,
        cause,
      });
    }

    const selected = manifest.references.find(
      (reference) => motionMode && reference.motion_modes.includes(motionMode),
    ) ?? manifest.references[0];
    let root;
    let referencePath;
    let referenceBytes;
    try {
      root = await realpath(rootDirectory);
      referencePath = await realpath(path.join(root, selected.filename));
      if (path.dirname(referencePath) !== root) {
        throw new VideoReferenceRegistryError('Fashion Video reference escaped its root');
      }
      const details = await stat(referencePath);
      if (!details.isFile() || details.size !== selected.bytes) {
        throw new VideoReferenceRegistryError('Fashion Video reference size changed');
      }
      referenceBytes = await readFile(referencePath);
    } catch (cause) {
      if (cause instanceof VideoReferenceRegistryError) throw cause;
      throw new VideoReferenceRegistryError('Fashion Video reference file cannot be verified', {
        cause,
      });
    }
    if (sha256(referenceBytes) !== selected.sha256) {
      throw new VideoReferenceRegistryError('Fashion Video reference hash changed');
    }

    return Object.freeze({
      state: 'READY',
      pack_id: manifest.pack_id,
      reference_id: selected.id,
      reference_path: referencePath,
      reference_sha256: selected.sha256,
      reference_pack_sha256: sha256(manifestBytes),
      motion_modes: Object.freeze([...selected.motion_modes]),
    });
  };
}
