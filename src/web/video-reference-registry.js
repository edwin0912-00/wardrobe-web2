import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './scene-contract.js';
import { surfaceForReferenceGeometry } from './video-motion-plan.js';

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validCutSheet(sheet, durationSeconds) {
  if (sheet?.schema_version !== '1.0.0' || !Array.isArray(sheet.cuts)
    || sheet.cuts.length < 1 || sheet.cuts.length > 24) return false;
  let end = 0;
  for (const [index, cut] of sheet.cuts.entries()) {
    if (cut?.cut_index !== index
      || !Number.isInteger(cut.start_ms) || !Number.isInteger(cut.end_ms)
      || cut.start_ms !== end || cut.end_ms <= cut.start_ms
      || cut.subject_rule !== 'APPROVED_AVATAR_OR_EMPTY'
      || typeof cut.direction !== 'string' || cut.direction.length < 24 || cut.direction.length > 500) {
      return false;
    }
    end = cut.end_ms;
  }
  return Math.abs(end - Math.round(durationSeconds * 1000)) <= 40;
}

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
      || typeof reference?.ui_title_uk !== 'string'
      || !SAFE_FILENAME.test(reference?.filename ?? '')
      || !SAFE_FILENAME.test(reference?.playback_filename ?? '')
      || !SAFE_FILENAME.test(reference?.preview_filename ?? '')
      || !SHA256.test(reference?.sha256 ?? '')
      || !SHA256.test(reference?.playback_sha256 ?? '')
      || !SHA256.test(reference?.preview_sha256 ?? '')
      || !Number.isInteger(reference?.bytes)
      || reference.bytes < 1
      || !Number.isInteger(reference?.playback_bytes)
      || reference.playback_bytes < 1
      || !Number.isInteger(reference?.preview_bytes)
      || reference.preview_bytes < 1
      || !Number.isFinite(reference?.duration_seconds)
      || reference.duration_seconds < 3
      || reference.duration_seconds > 15.5
      || !Number.isInteger(reference?.width)
      || !Number.isInteger(reference?.height)
      || reference.width < 1
      || reference.height < 1
      || !Number.isFinite(reference?.fps)
      || reference.fps <= 0
      || !Array.isArray(reference?.motion_modes)
      || reference.motion_modes.length === 0
      || !reference.motion_modes.includes(reference?.default_motion_mode)) {
      throw new VideoReferenceRegistryError('Fashion Video reference entry is invalid');
    }
    if (!validCutSheet(reference.cut_sheet, reference.duration_seconds)) {
      throw new VideoReferenceRegistryError('Fashion Video reference has no valid cut sheet');
    }
    try {
      surfaceForReferenceGeometry(reference.width, reference.height);
    } catch (cause) {
      throw new VideoReferenceRegistryError(
        'Fashion Video reference geometry has no supported presentation surface',
        { code: 'VIDEO_REFERENCE_ASPECT_UNSUPPORTED', cause },
      );
    }
  }
  return manifest;
}

export function createFashionVideoReferenceResolver({
  rootDirectory,
  manifestPath,
} = {}) {
  return async function resolveFashionVideoReference({
    motionMode = null,
    referenceId = null,
  } = {}) {
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
      (reference) => referenceId && reference.id === referenceId,
    ) ?? manifest.references.find(
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

    const availableStyles = [];
    for (const reference of manifest.references) {
      const presentationSurface = surfaceForReferenceGeometry(reference.width, reference.height);
      const playbackPath = await realpath(path.join(root, reference.playback_filename));
      if (path.dirname(playbackPath) !== root) {
        throw new VideoReferenceRegistryError('Fashion Video playback escaped its root');
      }
      const playbackDetails = await stat(playbackPath);
      if (!playbackDetails.isFile() || playbackDetails.size !== reference.playback_bytes) {
        throw new VideoReferenceRegistryError('Fashion Video playback size changed');
      }
      const playbackBytes = await readFile(playbackPath);
      if (sha256(playbackBytes) !== reference.playback_sha256) {
        throw new VideoReferenceRegistryError('Fashion Video playback hash changed');
      }
      const previewPath = await realpath(path.join(root, reference.preview_filename));
      if (path.dirname(previewPath) !== root) {
        throw new VideoReferenceRegistryError('Fashion Video preview escaped its root');
      }
      const previewDetails = await stat(previewPath);
      if (!previewDetails.isFile() || previewDetails.size !== reference.preview_bytes) {
        throw new VideoReferenceRegistryError('Fashion Video preview size changed');
      }
      const previewBytes = await readFile(previewPath);
      if (sha256(previewBytes) !== reference.preview_sha256) {
        throw new VideoReferenceRegistryError('Fashion Video preview hash changed');
      }
      availableStyles.push(Object.freeze({
        id: reference.id,
        title: reference.ui_title_uk,
        motion_mode: reference.default_motion_mode,
        // Safe UI metadata from the immutable, already-validated cut sheet.
        // No path, hash, or private source media is exposed here.
        cut_count: reference.cut_sheet.cuts.length,
        presentation_surface: presentationSurface.id,
        aspect_ratio: presentationSurface.aspectRatio,
        width: reference.width,
        height: reference.height,
        playback_path: playbackPath,
        playback_sha256: reference.playback_sha256,
        preview_path: previewPath,
        preview_sha256: reference.preview_sha256,
      }));
    }

    return Object.freeze({
      state: 'READY',
      pack_id: manifest.pack_id,
      reference_id: selected.id,
      reference_path: referencePath,
      reference_sha256: selected.sha256,
      reference_pack_sha256: sha256(manifestBytes),
      duration_seconds: selected.duration_seconds,
      provider_duration_seconds: Math.min(15, Math.round(selected.duration_seconds)),
      width: selected.width,
      height: selected.height,
      presentation_surface: surfaceForReferenceGeometry(selected.width, selected.height).id,
      aspect_ratio: surfaceForReferenceGeometry(selected.width, selected.height).aspectRatio,
      fps: selected.fps,
      cut_sheet: selected.cut_sheet,
      cut_sheet_sha256: sha256(Buffer.from(JSON.stringify(selected.cut_sheet))),
      motion_modes: Object.freeze([...selected.motion_modes]),
      available_styles: Object.freeze(availableStyles),
      selected_style_id: selected.id,
      playback_path: availableStyles.find((style) => style.id === selected.id)?.playback_path,
      preview_path: availableStyles.find((style) => style.id === selected.id)?.preview_path,
    });
  };
}
