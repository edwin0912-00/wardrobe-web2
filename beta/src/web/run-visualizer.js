import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { sanitizeOutboundString } from '../security/outbound-redaction.js';

const SHA256 = /^[a-f0-9]{64}$/;
const OPAQUE_ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PRESENTATIONS = new Set([
  'SOURCE_SCAN',
  'CANDIDATE_REVEAL',
  'MASK_REVEAL',
  'BEFORE_AFTER',
  'QA_SCAN',
  'OUTPUT',
]);
const TRUTH_STATES = new Set([
  'IMMUTABLE_INPUT',
  'GENERATED_CANDIDATE',
  'DETERMINISTIC_DERIVATIVE',
  'UNVERIFIED_CANDIDATE',
  'QA_IN_PROGRESS',
  'APPROVED_OUTPUT',
]);
const LAYER_ROLES = new Set(['BASE', 'SOURCE', 'CANDIDATE', 'CUTOUT', 'BEFORE', 'AFTER']);
const SUBJECT_KINDS = new Set(['PERSON', 'ITEM', 'LOOK']);
const MAX_VISUAL_ASSETS = 48;
const MAX_VISUAL_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_VISUAL_DIMENSION = 8_192;
const MAX_VISUAL_PIXELS = 40_000_000;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isInside(root, filename) {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  return relative !== ''
    && !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative);
}

function finiteMetrics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([key, item]) => (
      /^[a-z][a-z0-9_]{0,63}$/i.test(key)
      && Number.isFinite(item)
      && item >= 0
      && Number.isSafeInteger(item)
    ))
    .slice(0, 16);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizedSubject(subject) {
  if (!SUBJECT_KINDS.has(subject?.kind)) return null;
  const index = subject.index === null
    ? null
    : (Number.isSafeInteger(subject.index) && subject.index >= 1 ? subject.index : undefined);
  const total = subject.total === null
    ? null
    : (Number.isSafeInteger(subject.total) && subject.total >= 1 ? subject.total : undefined);
  if (index === undefined || total === undefined) return null;
  if (index !== null && total !== null && index > total) return null;
  return { kind: subject.kind, index, total };
}

function safePublicText(value, maxLength) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) return null;
  const sanitized = sanitizeOutboundString(value);
  return sanitized === value ? value : null;
}

function validPresentationClaim(presentation, truthState, roles) {
  const signature = roles.join(',');
  switch (presentation) {
    case 'SOURCE_SCAN':
      return truthState === 'IMMUTABLE_INPUT' && signature === 'SOURCE';
    case 'CANDIDATE_REVEAL':
      return ['GENERATED_CANDIDATE', 'UNVERIFIED_CANDIDATE', 'DETERMINISTIC_DERIVATIVE'].includes(truthState)
        && signature === 'CANDIDATE';
    case 'MASK_REVEAL':
      return truthState === 'DETERMINISTIC_DERIVATIVE' && signature === 'BASE,CUTOUT';
    case 'BEFORE_AFTER':
      return truthState === 'DETERMINISTIC_DERIVATIVE' && signature === 'BEFORE,AFTER';
    case 'QA_SCAN':
      return truthState === 'QA_IN_PROGRESS' && signature === 'CANDIDATE';
    case 'OUTPUT':
      return truthState === 'APPROVED_OUTPUT' && signature === 'AFTER';
    default:
      return false;
  }
}

async function secureImageBytes(runDirectory, filename, {
  expectedSha256 = null,
  expectedSize = null,
  expectedMediaType = null,
} = {}) {
  const root = path.resolve(runDirectory);
  const target = path.resolve(filename);
  if (!isInside(root, target)) throw new Error('Visual asset escapes its run directory');

  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Visual run directory is not a regular directory');
  }
  let cursor = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error('Visual asset path contains a symbolic link');
    if (cursor === target && !info.isFile()) throw new Error('Visual asset is not a regular file');
    if (cursor !== target && !info.isDirectory()) throw new Error('Visual asset parent is not a directory');
  }
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (!isInside(realRoot, realTarget)) throw new Error('Visual asset resolves outside its run directory');

  const handle = await open(realTarget, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let bytes;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Visual asset is not a regular file');
    if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > MAX_VISUAL_ASSET_BYTES) {
      throw new Error('Visual asset exceeds its byte limit');
    }
    if (expectedSize !== null && expectedSize !== info.size) {
      throw new Error('Visual asset size no longer matches its declaration');
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (bytes.length < 1 || bytes.length > MAX_VISUAL_ASSET_BYTES) {
    throw new Error('Visual asset exceeds its byte limit');
  }
  if (expectedSize !== null && expectedSize !== bytes.length) {
    throw new Error('Visual asset size no longer matches its declaration');
  }
  const digest = sha256(bytes);
  if (expectedSha256 !== null && digest !== expectedSha256) {
    throw new Error('Visual asset bytes no longer match their declaration');
  }

  let metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: 'error',
      animated: false,
      limitInputPixels: MAX_VISUAL_PIXELS,
    }).metadata();
  } catch {
    throw new Error('Visual asset is not a decodable image');
  }
  const mediaType = new Map([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ]).get(metadata.format);
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) throw new Error('Visual asset media type is not allowed');
  if (!Number.isSafeInteger(metadata.width)
    || !Number.isSafeInteger(metadata.height)
    || metadata.width < 1
    || metadata.height < 1
    || metadata.width > MAX_VISUAL_DIMENSION
    || metadata.height > MAX_VISUAL_DIMENSION
    || metadata.width * metadata.height > MAX_VISUAL_PIXELS) {
    throw new Error('Visual asset dimensions exceed the preview limit');
  }
  if (expectedMediaType !== null && mediaType !== expectedMediaType) {
    throw new Error('Visual asset media type no longer matches its declaration');
  }
  return {
    bytes,
    sha256: digest,
    size: bytes.length,
    media_type: mediaType,
    width: metadata.width,
    height: metadata.height,
  };
}

function checkpointSignature(checkpoint) {
  if (!checkpoint) return null;
  return JSON.stringify({
    stage: checkpoint.stage,
    subject: checkpoint.subject,
    presentation: checkpoint.presentation,
    truth_state: checkpoint.truth_state,
    title: checkpoint.title,
    status: checkpoint.status,
    layers: checkpoint.layers,
    metrics: checkpoint.metrics,
  });
}

export function resetVisualState(state) {
  state.visual_epoch = (Number.isSafeInteger(state.visual_epoch) ? state.visual_epoch : 0) + 1;
  state.visual_assets = {};
  state.visual_checkpoint = null;
  return state.visual_epoch;
}

export async function prepareVisualCheckpoint(state, {
  runDirectory,
  clock = () => new Date(),
  stage,
  subject,
  presentation,
  truthState,
  title,
  status,
  layers,
  metrics,
}) {
  if (typeof stage !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(stage)) {
    throw new Error('Visual checkpoint stage is invalid');
  }
  if (!PRESENTATIONS.has(presentation)) throw new Error('Visual checkpoint presentation is invalid');
  if (!TRUTH_STATES.has(truthState)) throw new Error('Visual checkpoint truth state is invalid');
  if (typeof title !== 'string' || title.length < 1 || title.length > 120) {
    throw new Error('Visual checkpoint title is invalid');
  }
  if (typeof status !== 'string' || status.length < 1 || status.length > 180) {
    throw new Error('Visual checkpoint status is invalid');
  }
  const normalizedSubjectValue = normalizedSubject(subject);
  if (!normalizedSubjectValue) throw new Error('Visual checkpoint subject is invalid');
  if (safePublicText(title, 120) === null || safePublicText(status, 180) === null) {
    throw new Error('Visual checkpoint copy contains private infrastructure');
  }
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > 4) {
    throw new Error('Visual checkpoint must declare one to four image layers');
  }
  const roles = layers.map((layer) => layer?.role);
  if (roles.some((role) => !LAYER_ROLES.has(role))
    || !validPresentationClaim(presentation, truthState, roles)) {
    throw new Error('Visual checkpoint presentation contradicts its truth state or layers');
  }

  const epoch = Number.isSafeInteger(state.visual_epoch) && state.visual_epoch >= 1
    ? state.visual_epoch
    : 1;
  const existingAssets = state.visual_assets && typeof state.visual_assets === 'object'
    ? state.visual_assets
    : {};
  const nextAssets = { ...existingAssets };
  const checkpointLayers = [];
  for (const layer of layers) {
    const inspected = await secureImageBytes(runDirectory, layer.path, {
      expectedSha256: layer.sha256 ?? null,
    });
    const existing = Object.entries(nextAssets).find(([, asset]) => (
      asset.epoch === epoch
      && asset.path === path.resolve(layer.path)
      && asset.sha256 === inspected.sha256
      && asset.media_type === inspected.media_type
    ));
    const assetId = existing?.[0] ?? randomUUID();
    nextAssets[assetId] = {
      epoch,
      path: path.resolve(layer.path),
      sha256: inspected.sha256,
      size: inspected.size,
      media_type: inspected.media_type,
      created_at: clock().toISOString(),
    };
    checkpointLayers.push({ role: layer.role, asset_id: assetId });
  }
  if (Object.keys(nextAssets).length > MAX_VISUAL_ASSETS) {
    const retained = Object.entries(nextAssets)
      .filter(([, asset]) => asset.epoch === epoch)
      .slice(-MAX_VISUAL_ASSETS);
    for (const layer of checkpointLayers) {
      const record = nextAssets[layer.asset_id];
      if (!retained.some(([id]) => id === layer.asset_id)) retained.push([layer.asset_id, record]);
    }
    state.visual_assets = Object.fromEntries(retained.slice(-MAX_VISUAL_ASSETS));
  } else {
    state.visual_assets = nextAssets;
  }

  const next = {
    schema_version: '1.0.0',
    epoch,
    sequence: (Number.isSafeInteger(state.visual_sequence) ? state.visual_sequence : 0) + 1,
    stage,
    subject: normalizedSubjectValue,
    presentation,
    truth_state: truthState,
    title,
    status,
    layers: checkpointLayers,
    ...(finiteMetrics(metrics) ? { metrics: finiteMetrics(metrics) } : {}),
    created_at: clock().toISOString(),
  };
  if (checkpointSignature(state.visual_checkpoint) === checkpointSignature(next)) return false;
  state.visual_epoch = epoch;
  state.visual_sequence = next.sequence;
  state.visual_checkpoint = next;
  return true;
}

export function publicVisualCheckpoint(runId, checkpoint, assets) {
  if (!checkpoint || typeof checkpoint !== 'object' || checkpoint.schema_version !== '1.0.0') {
    return null;
  }
  const subject = normalizedSubject(checkpoint.subject);
  const title = safePublicText(checkpoint.title, 120);
  const status = safePublicText(checkpoint.status, 180);
  if (!Number.isSafeInteger(checkpoint.epoch)
    || checkpoint.epoch < 1
    || !Number.isSafeInteger(checkpoint.sequence)
    || checkpoint.sequence < 1
    || typeof checkpoint.stage !== 'string'
    || !/^[A-Z][A-Z0-9_]{0,63}$/.test(checkpoint.stage)
    || !subject
    || title === null
    || status === null) {
    return null;
  }
  if (!Array.isArray(checkpoint.layers)
    || checkpoint.layers.length < 1
    || checkpoint.layers.length > 4) {
    return null;
  }
  const layers = [];
  for (const layer of checkpoint.layers) {
    const asset = assets?.[layer?.asset_id];
    if (!LAYER_ROLES.has(layer?.role)
      || !OPAQUE_ASSET_ID.test(layer?.asset_id ?? '')
      || asset?.epoch !== checkpoint.epoch
      || !SHA256.test(asset?.sha256 ?? '')
      || !Number.isSafeInteger(asset?.size)
      || asset.size < 1
      || typeof asset?.path !== 'string'
      || !IMAGE_MEDIA_TYPES.has(asset?.media_type)) {
      return null;
    }
    layers.push({
      role: layer.role,
      asset_id: layer.asset_id,
      url: `/api/runs/${runId}/visual-assets/${layer.asset_id}`,
      media_type: asset.media_type,
    });
  }
  if (!layers.length
    || !PRESENTATIONS.has(checkpoint.presentation)
    || !TRUTH_STATES.has(checkpoint.truth_state)
    || !validPresentationClaim(
      checkpoint.presentation,
      checkpoint.truth_state,
      layers.map((layer) => layer.role),
    )) {
    return null;
  }
  return {
    schema_version: '1.0.0',
    epoch: checkpoint.epoch,
    sequence: checkpoint.sequence,
    stage: checkpoint.stage,
    subject,
    presentation: checkpoint.presentation,
    truth_state: checkpoint.truth_state,
    title,
    status,
    layers,
    ...(finiteMetrics(checkpoint.metrics) ? { metrics: finiteMetrics(checkpoint.metrics) } : {}),
  };
}

export async function readVisualAsset(state, runDirectory, assetId) {
  if (!OPAQUE_ASSET_ID.test(assetId ?? '')) return null;
  const asset = state?.visual_assets?.[assetId];
  if (!asset
    || asset.epoch !== state.visual_epoch
    || !SHA256.test(asset.sha256 ?? '')
    || !Number.isSafeInteger(asset.size)
    || asset.size < 1
    || !IMAGE_MEDIA_TYPES.has(asset.media_type)) {
    return null;
  }
  try {
    const inspected = await secureImageBytes(runDirectory, asset.path, {
      expectedSha256: asset.sha256,
      expectedSize: asset.size,
      expectedMediaType: asset.media_type,
    });
    return {
      bytes: inspected.bytes,
      media_type: inspected.media_type,
      size: inspected.size,
    };
  } catch {
    return null;
  }
}
