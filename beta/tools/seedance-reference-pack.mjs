#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { File } from 'node:buffer';
import { access, mkdir, open, readFile, realpath, rename, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL = 'seedance-2.5';
export const ENDPOINT = 'bytedance/seedance-2.5/reference-to-video';
export const SCHEMA_VERSION = 'wardrobe-seedance-reference-pack-v1';
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_IMAGE_BYTES = 30_000_000;
const MAX_VIDEO_BYTES = 200_000_000;
const PRICE_PER_1000_TOKENS = 0.0214;

export class ReplayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReplayError';
    this.code = code;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return JSON.stringify(value);
}

function fraction(value) {
  const match = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(String(value));
  if (!match) throw new ReplayError('VIDEO_METADATA_INVALID', 'Video FPS must be a finite positive number or fraction.');
  const numerator = Number(match[1]);
  const denominator = match[2] === undefined ? 1 : Number(match[2]);
  const result = numerator / denominator;
  if (!Number.isFinite(numerator) || numerator <= 0 || !Number.isFinite(denominator)
      || denominator <= 0 || !Number.isFinite(result) || result <= 0) {
    throw new ReplayError('VIDEO_METADATA_INVALID', 'Video FPS must be a finite positive number or fraction.');
  }
  return result;
}

function sniffMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  return null;
}

export function probeVideo(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,avg_frame_rate,nb_read_frames,duration',
      '-of', 'json', filePath,
    ], { encoding: 'utf8' }));
  } catch {
    throw new ReplayError('VIDEO_PROBE_FAILED', 'A video reference could not be verified with ffprobe.');
  }
  const stream = parsed.streams?.[0];
  if (!stream) throw new ReplayError('VIDEO_PROBE_FAILED', 'A video reference has no readable video stream.');
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: String(stream.avg_frame_rate),
    frame_count: Number(stream.nb_read_frames),
    duration_seconds: Number(stream.duration),
  };
}

function validateMetadata(file, actual) {
  const expected = file.metadata;
  if (!expected || !Number.isInteger(expected.width) || !Number.isInteger(expected.height)
      || expected.width <= 0 || expected.height <= 0
      || !Number.isFinite(expected.duration_seconds) || expected.duration_seconds <= 0
      || !Number.isInteger(expected.frame_count) || expected.frame_count <= 0
      || typeof expected.fps !== 'string') {
    throw new ReplayError('VIDEO_METADATA_INVALID', `${file.label}: expected video metadata is required.`);
  }
  if (!actual || !Number.isInteger(actual.width) || actual.width <= 0
      || !Number.isInteger(actual.height) || actual.height <= 0
      || !Number.isInteger(actual.frame_count) || actual.frame_count <= 0
      || !Number.isFinite(actual.duration_seconds) || actual.duration_seconds <= 0) {
    throw new ReplayError('VIDEO_METADATA_INVALID', `${file.label}: actual video metadata is incomplete or non-finite.`);
  }
  const fps = fraction(actual.fps);
  fraction(expected.fps);
  for (const key of ['width', 'height', 'frame_count', 'fps']) {
    if (actual[key] !== expected[key]) {
      throw new ReplayError('VIDEO_METADATA_CHANGED', `${file.label}: ${key} differs from the approved metadata.`);
    }
  }
  if (Math.abs(actual.duration_seconds - expected.duration_seconds) > 0.001) {
    throw new ReplayError('VIDEO_METADATA_CHANGED', `${file.label}: duration differs from the approved metadata.`);
  }
  const aspect = actual.width / actual.height;
  if (actual.width < 300 || actual.height < 300 || actual.width > 6000 || actual.height > 6000
      || aspect < 0.4 || aspect > 2.5 || fps < 24 || fps > 60
      || actual.duration_seconds < 1.8 || actual.duration_seconds > 30.2) {
    throw new ReplayError('VIDEO_MODEL_LIMIT', `${file.label}: video metadata is outside Seedance 2.5 limits.`);
  }
}

function validateManifest(manifest) {
  if (manifest?.schema_version !== SCHEMA_VERSION) throw new ReplayError('MANIFEST_INVALID', 'Unsupported reference-pack manifest schema.');
  if (manifest.model !== MODEL || manifest.task !== 'reference') throw new ReplayError('MODEL_UNSUPPORTED', 'This replay tool is pinned to Seedance 2.5 reference-to-video.');
  const output = manifest.output;
  if (output?.resolution !== '720p' || output.aspect_ratio !== '9:16'
      || output.codec !== 'H264' || output.generate_audio !== false
      || !Number.isInteger(output.duration_seconds) || output.duration_seconds < 4 || output.duration_seconds > 30) {
    throw new ReplayError('OUTPUT_SETTINGS_INVALID', 'The verified pack uses 720p, 9:16, H264, silent output, and a 4–30 second duration.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 4) {
    throw new ReplayError('REFERENCE_COUNT_INVALID', 'The verified replay shape contains two images and two videos.');
  }
  const images = manifest.files.filter((file) => file.kind === 'image');
  const videos = manifest.files.filter((file) => file.kind === 'video');
  if (images.length !== 2 || videos.length !== 2) {
    throw new ReplayError('REFERENCE_COUNT_INVALID', 'The verified replay shape contains two images and two videos.');
  }
  const expected = [
    ...images.map((_, index) => ({ kind: 'image', label: `@Image${index + 1}` })),
    ...videos.map((_, index) => ({ kind: 'video', label: `@Video${index + 1}` })),
  ];
  if (manifest.files.some((file, index) => file.kind !== expected[index].kind || file.label !== expected[index].label)) {
    throw new ReplayError('REFERENCE_ORDER_INVALID', 'Files must be ordered @Image1, @Image2, @Video1, @Video2.');
  }
  const paths = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !file.path || path.isAbsolute(file.path)
        || file.path.split(/[\\/]/).includes('..') || paths.has(file.path)) {
      throw new ReplayError('SOURCE_PATH_INVALID', `${file.label}: source path must be unique and relative to the media root.`);
    }
    paths.add(file.path);
    if (!SHA256.test(file.sha256 ?? '')) throw new ReplayError('SOURCE_HASH_INVALID', `${file.label}: SHA-256 is invalid.`);
    if (file.kind === 'video' && file.mime_type !== 'video/mp4') {
      throw new ReplayError('SOURCE_MIME_INVALID', `${file.label}: unsupported media MIME type.`);
    }
    if (file.kind === 'image' && !['image/png', 'image/jpeg', 'image/webp'].includes(file.mime_type)) {
      throw new ReplayError('SOURCE_MIME_INVALID', `${file.label}: image MIME type must be PNG, JPEG, or WebP.`);
    }
  }
}

export function estimateUsd({ inputVideoSeconds, outputDurationSeconds }) {
  const tokens = (720 * 1280 * (inputVideoSeconds + outputDurationSeconds) * 24) / 1024;
  return (tokens / 1000) * PRICE_PER_1000_TOKENS * 0.6;
}

export async function validateInputPack({ manifest, mediaRoot, prompt, probeVideoFn = probeVideo }) {
  validateManifest(manifest);
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new ReplayError('PROMPT_MISSING', 'A private prompt file with the approved full scene direction is required.');
  for (const file of manifest.files) {
    if (!prompt.includes(file.label)) throw new ReplayError('PROMPT_BINDING_INVALID', `The prompt must name ${file.label}.`);
  }
  let root;
  try {
    root = await realpath(mediaRoot);
  } catch {
    throw new ReplayError('SOURCE_ROOT_INVALID', 'Private media root is missing or unreadable.');
  }
  const files = [];
  let inputVideoSeconds = 0;
  for (const file of manifest.files) {
    const resolved = path.resolve(root, file.path);
    let sourcePath;
    try {
      sourcePath = await realpath(resolved);
    } catch {
      throw new ReplayError('SOURCE_MISSING', `${file.label}: source file is missing or unreadable.`);
    }
    const relativeSource = path.relative(root, sourcePath);
    if (relativeSource === '..' || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource)) {
      throw new ReplayError('SOURCE_PATH_INVALID', `${file.label}: source escaped the media root.`);
    }
    let bytes;
    try {
      bytes = await readFile(sourcePath);
    } catch {
      throw new ReplayError('SOURCE_MISSING', `${file.label}: source file is missing or unreadable.`);
    }
    if (bytes.length === 0 || sha256(bytes) !== file.sha256) throw new ReplayError('SOURCE_HASH_MISMATCH', `${file.label}: source SHA-256 changed.`);
    const actualMime = sniffMime(bytes);
    if (actualMime !== file.mime_type) throw new ReplayError('SOURCE_MIME_MISMATCH', `${file.label}: source bytes do not match the declared MIME type.`);
    if (file.kind === 'image' && bytes.length > MAX_IMAGE_BYTES) throw new ReplayError('IMAGE_MODEL_LIMIT', `${file.label}: image exceeds the Seedance 2.5 size limit.`);
    if (file.kind === 'video') {
      if (bytes.length > MAX_VIDEO_BYTES) throw new ReplayError('VIDEO_MODEL_LIMIT', `${file.label}: video exceeds the Seedance 2.5 size limit.`);
      const actual = await probeVideoFn(sourcePath);
      validateMetadata(file, actual);
      inputVideoSeconds += actual.duration_seconds;
      files.push({ ...file, bytes, actual_metadata: actual });
    } else {
      files.push({ ...file, bytes });
    }
  }
  if (inputVideoSeconds > 30.2) throw new ReplayError('VIDEO_TOTAL_DURATION_LIMIT', 'Combined video reference duration exceeds Seedance 2.5 limits.');
  return {
    manifest,
    prompt,
    prompt_sha256: sha256(Buffer.from(prompt, 'utf8')),
    files,
    input_video_seconds: inputVideoSeconds,
    estimated_usd: estimateUsd({ inputVideoSeconds, outputDurationSeconds: manifest.output.duration_seconds }),
  };
}

export function buildProviderInput(pack, uploadUrls) {
  const byLabel = new Map(pack.files.map((file) => [file.label, file]));
  const urlFor = (label) => {
    const value = uploadUrls.get(label);
    if (typeof value !== 'string') throw new ReplayError('UPLOAD_INCOMPLETE', `Storage upload is missing ${label}.`);
    return value;
  };
  for (const file of pack.files) {
    if (!byLabel.has(file.label)) throw new ReplayError('REFERENCE_ORDER_INVALID', 'Reference labels changed after validation.');
  }
  return {
    prompt: pack.prompt,
    task: 'reference',
    image_urls: pack.files.filter((file) => file.kind === 'image').map((file) => urlFor(file.label)),
    video_urls: pack.files.filter((file) => file.kind === 'video').map((file) => urlFor(file.label)),
    resolution: '720p',
    duration: String(pack.manifest.output.duration_seconds),
    aspect_ratio: '9:16',
    codec: 'H264',
    generate_audio: false,
  };
}

function sourceBindings(pack) {
  return pack.files.map((file) => ({
    label: file.label,
    kind: file.kind,
    path: file.path,
    mime_type: file.mime_type,
    sha256: file.sha256,
    metadata: file.kind === 'video' ? file.actual_metadata : null,
  }));
}

export async function syncDirectory(directory, { platform = process.platform, openDirectory = open } = {}) {
  // Windows does not support this directory-handle sync path. File contents are synced separately.
  if (platform === 'win32') return;
  const handle = await openDirectory(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeExclusiveJson(filePath, value, syncDirectoryFn = syncDirectory) {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectoryFn(path.dirname(filePath));
}

async function writeAtomicJson(filePath, value, syncDirectoryFn = syncDirectory) {
  const temporary = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
  await syncDirectoryFn(path.dirname(filePath));
}

async function pathExists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

async function createDefaultFalClient(key) {
  const { createFalClient } = await import('@fal-ai/client');
  return createFalClient({ credentials: key });
}

function storageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'));
  } catch {
    return false;
  }
}

function queueUrl(value, requestId) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'queue.fal.run'
      && url.pathname.includes(`/requests/${requestId}`);
  } catch {
    return false;
  }
}

function privateStatePaths(stateDir) {
  const directory = path.resolve(stateDir);
  return {
    directory,
    uploads: path.join(directory, 'uploads.json'),
    submission: path.join(directory, 'submission.json'),
  };
}

async function loadUploads(filePath, pack) {
  if (!(await pathExists(filePath))) return { binding_sha256: sha256(stableJson(sourceBindings(pack))), files: [] };
  let previous;
  try { previous = JSON.parse(await readFile(filePath, 'utf8')); } catch {
    throw new ReplayError('UPLOAD_RECEIPT_INVALID', 'Private upload receipt is unreadable; request creation is blocked.');
  }
  if (previous.binding_sha256 !== sha256(stableJson(sourceBindings(pack)))) {
    throw new ReplayError('UPLOAD_RECEIPT_MISMATCH', 'Private upload receipt belongs to different source inputs.');
  }
  const expected = sourceBindings(pack);
  if (!Array.isArray(previous.files) || previous.files.length > expected.length
      || previous.files.some((item, index) => {
        const file = expected[index];
        return !file || item.label !== file.label || item.kind !== file.kind
          || item.sha256 !== file.sha256 || item.mime_type !== file.mime_type || !storageUrl(item.url);
      })) {
    throw new ReplayError('UPLOAD_RECEIPT_INVALID', 'Private upload receipt does not match the verified source inputs.');
  }
  return previous;
}

function validateBudget(pack, maxEstimateUsd) {
  if (!Number.isFinite(pack?.estimated_usd) || pack.estimated_usd <= 0) {
    throw new ReplayError('COST_ESTIMATE_INVALID', 'A finite positive cost estimate is required before submission.');
  }
  if (!Number.isFinite(maxEstimateUsd) || maxEstimateUsd <= 0) {
    throw new ReplayError('BUDGET_REQUIRED', 'Explicit --max-estimate-usd is required before submission.');
  }
  if (pack.estimated_usd > maxEstimateUsd) {
    throw new ReplayError('BUDGET_EXCEEDED', 'The estimated request cost exceeds the supplied maximum.');
  }
}

export async function submitPrepared(pack, {
  stateDir,
  maxEstimateUsd,
  falKey = process.env.FAL_KEY,
  falClientFactory = createDefaultFalClient,
  fetchImpl = globalThis.fetch,
  syncDirectoryFn = syncDirectory,
  now = () => new Date().toISOString(),
} = {}) {
  validateBudget(pack, maxEstimateUsd);
  if (typeof falKey !== 'string' || !falKey.trim()) throw new ReplayError('FAL_KEY_MISSING', 'FAL_KEY must be supplied through the operator environment.');
  if (typeof fetchImpl !== 'function') throw new ReplayError('FETCH_UNAVAILABLE', 'Fetch is unavailable for the explicit submit action.');
  if (!stateDir) throw new ReplayError('STATE_DIR_REQUIRED', 'A private --state-dir is required for submit and resume receipts.');
  const paths = privateStatePaths(stateDir);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32' && ((await stat(paths.directory)).mode & 0o077) !== 0) {
    throw new ReplayError('STATE_DIR_PERMISSIONS', 'Private state directory must not be readable by group or other users.');
  }
  if (await pathExists(paths.submission)) throw new ReplayError('SUBMISSION_EXISTS', 'A prior submission receipt exists; this pack cannot be submitted again.');

  let client;
  try { client = await falClientFactory(falKey); } catch {
    throw new ReplayError('FAL_CLIENT_UNAVAILABLE', 'The existing @fal-ai/client package could not be loaded.');
  }
  if (typeof client?.storage?.upload !== 'function') throw new ReplayError('FAL_CLIENT_UNAVAILABLE', 'The FAL client has no storage upload method.');
  let uploads = await loadUploads(paths.uploads, pack);
  const uploadedByLabel = new Map(uploads.files.map((item) => [item.label, item.url]));
  for (const file of pack.files) {
    if (uploadedByLabel.has(file.label)) continue;
    let url;
    try {
      url = await client.storage.upload(
        new File([file.bytes], path.basename(file.path), { type: file.mime_type }),
        { lifecycle: { expiresIn: '1d' } },
      );
    } catch {
      throw new ReplayError('UPLOAD_FAILED', 'A reference upload failed; no generation request was created. Inspect the private upload receipt before any retry.');
    }
    if (!storageUrl(url)) throw new ReplayError('UPLOAD_FAILED', 'A reference upload returned an invalid URL; no generation request was created.');
    const record = { label: file.label, kind: file.kind, sha256: file.sha256, mime_type: file.mime_type, url };
    uploads = { ...uploads, files: [...uploads.files, record] };
    if (await pathExists(paths.uploads)) await writeAtomicJson(paths.uploads, uploads, syncDirectoryFn);
    else await writeExclusiveJson(paths.uploads, uploads, syncDirectoryFn);
    uploadedByLabel.set(file.label, url);
  }
  if (pack.files.some((file) => !uploadedByLabel.has(file.label))) throw new ReplayError('UPLOAD_INCOMPLETE', 'Not every reference has a verified upload; no generation request was created.');

  const input = buildProviderInput(pack, uploadedByLabel);
  const receipt = {
    schema_version: 'wardrobe-seedance-submission-v1',
    state: 'SUBMITTING',
    created_at: now(),
    endpoint: ENDPOINT,
    model: MODEL,
    task: 'reference',
    source_bindings: sourceBindings(pack),
    prompt_sha256: pack.prompt_sha256,
    input_sha256: sha256(stableJson(input)),
    input,
    uploads: uploads.files,
    estimated_usd: pack.estimated_usd,
    max_estimate_usd: maxEstimateUsd,
    retryable: false,
  };
  await writeExclusiveJson(paths.submission, receipt, syncDirectoryFn);

  let response;
  let body;
  try {
    response = await fetchImpl(`https://queue.fal.run/${ENDPOINT}`, {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120000),
    });
    body = await response.json();
  } catch {
    receipt.state = 'UNKNOWN';
    receipt.outcome_code = 'CREATE_OUTCOME_UNKNOWN';
    receipt.checked_at = now();
    await writeAtomicJson(paths.submission, receipt, syncDirectoryFn);
    throw new ReplayError('CREATE_OUTCOME_UNKNOWN', 'The single create request has an unknown outcome. Its receipt is terminal and must not be resubmitted.');
  }

  receipt.http_status = response.status;
  if (!response.ok) {
    receipt.state = response.status >= 400 && response.status < 500 ? 'REJECTED' : 'UNKNOWN';
    receipt.outcome_code = receipt.state === 'REJECTED' ? 'PROVIDER_REJECTED' : 'CREATE_OUTCOME_UNKNOWN';
    receipt.checked_at = now();
    if (typeof body?.request_id === 'string' && REQUEST_ID.test(body.request_id)) {
      receipt.request_id = body.request_id;
      if (queueUrl(body.status_url, body.request_id) && queueUrl(body.response_url, body.request_id)) {
        receipt.status_url = body.status_url;
        receipt.response_url = body.response_url;
      }
    }
    await writeAtomicJson(paths.submission, receipt, syncDirectoryFn);
    throw new ReplayError(receipt.outcome_code, receipt.state === 'REJECTED'
      ? `The provider rejected the single create request with HTTP ${response.status}; it will not be resubmitted.`
      : 'The create request has an unknown outcome. Its receipt is terminal and must not be resubmitted.');
  }

  const requestId = body?.request_id;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)
      || !queueUrl(body?.status_url, requestId) || !queueUrl(body?.response_url, requestId)) {
    receipt.state = 'UNKNOWN';
    receipt.outcome_code = 'CREATE_RECEIPT_INVALID';
    receipt.checked_at = now();
    if (typeof requestId === 'string' && REQUEST_ID.test(requestId)) receipt.request_id = requestId;
    await writeAtomicJson(paths.submission, receipt, syncDirectoryFn);
    throw new ReplayError('CREATE_RECEIPT_INVALID', 'The provider response did not include an exact resumable request receipt; resubmission is blocked.');
  }
  receipt.state = 'SUBMITTED';
  receipt.request_id = requestId;
  receipt.status_url = body.status_url;
  receipt.response_url = body.response_url;
  receipt.checked_at = now();
  await writeAtomicJson(paths.submission, receipt, syncDirectoryFn);
  return {
    state: receipt.state,
    endpoint: ENDPOINT,
    model: MODEL,
    request_id: requestId,
    estimated_usd: pack.estimated_usd,
  };
}

async function loadSubmission(paths) {
  let receipt;
  try { receipt = JSON.parse(await readFile(paths.submission, 'utf8')); } catch {
    throw new ReplayError('SUBMISSION_RECEIPT_MISSING', 'No private submission receipt exists for resume.');
  }
  return receipt;
}

function validateResumeBinding(receipt, pack, requestedId) {
  if (receipt.request_id !== requestedId || !REQUEST_ID.test(requestedId ?? '')) {
    throw new ReplayError('RESUME_ID_MISMATCH', 'Resume request ID does not exactly match the saved provider receipt.');
  }
  if (receipt.endpoint !== ENDPOINT || receipt.model !== MODEL || receipt.schema_version !== 'wardrobe-seedance-submission-v1'
      || receipt.prompt_sha256 !== pack.prompt_sha256
      || stableJson(receipt.source_bindings) !== stableJson(sourceBindings(pack))
      || !receipt.input || sha256(stableJson(receipt.input)) !== receipt.input_sha256
      || sha256(Buffer.from(receipt.input.prompt ?? '', 'utf8')) !== receipt.prompt_sha256) {
    throw new ReplayError('RESUME_BINDING_MISMATCH', 'Current prompt or source bindings do not match the saved provider receipt.');
  }
  if (receipt.input.task !== 'reference' || receipt.input.resolution !== '720p'
      || receipt.input.aspect_ratio !== '9:16' || receipt.input.codec !== 'H264'
      || receipt.input.generate_audio !== false || receipt.input.duration !== String(pack.manifest.output.duration_seconds)) {
    throw new ReplayError('RESUME_BINDING_MISMATCH', 'Saved provider input settings do not match the verified pack.');
  }
  if (!queueUrl(receipt.status_url, requestedId) || !queueUrl(receipt.response_url, requestedId)) {
    throw new ReplayError('RESUME_RECEIPT_INVALID', 'Saved status/result URLs do not match the exact FAL request ID.');
  }
  const expectedImages = receipt.uploads.filter((item) => item.kind === 'image').map((item) => item.url);
  const expectedVideos = receipt.uploads.filter((item) => item.kind === 'video').map((item) => item.url);
  if (stableJson(receipt.uploads.map(({ label, kind, sha256: sourceSha, mime_type }) => ({ label, kind, sha256: sourceSha, mime_type })))
        !== stableJson(pack.files.map(({ label, kind, sha256: sourceSha, mime_type }) => ({ label, kind, sha256: sourceSha, mime_type })))
      || stableJson(receipt.input.image_urls) !== stableJson(expectedImages)
      || stableJson(receipt.input.video_urls) !== stableJson(expectedVideos)
      || receipt.uploads.some((item) => !storageUrl(item.url))) {
    throw new ReplayError('RESUME_RECEIPT_INVALID', 'Saved ordered media URLs do not match their verified source roles.');
  }
}

export async function resumePrepared(pack, {
  stateDir,
  requestId,
  falKey = process.env.FAL_KEY,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof falKey !== 'string' || !falKey.trim()) throw new ReplayError('FAL_KEY_MISSING', 'FAL_KEY must be supplied through the operator environment.');
  if (!stateDir) throw new ReplayError('STATE_DIR_REQUIRED', 'A private --state-dir is required for submit and resume receipts.');
  const paths = privateStatePaths(stateDir);
  const receipt = await loadSubmission(paths);
  validateResumeBinding(receipt, pack, requestId);
  if (receipt.state === 'REJECTED' || receipt.state === 'COMPLETED') {
    return { state: receipt.state, endpoint: ENDPOINT, model: MODEL, request_id: requestId };
  }
  if (!['SUBMITTED', 'RUNNING', 'UNKNOWN'].includes(receipt.state)) {
    throw new ReplayError('RESUME_STATE_INVALID', 'Only an existing exact provider receipt can be resumed.');
  }

  let statusResponse;
  let status;
  try {
    statusResponse = await fetchImpl(receipt.status_url, { method: 'GET', headers: { Authorization: `Key ${falKey}` } });
    status = await statusResponse.json();
  } catch {
    throw new ReplayError('RESUME_STATUS_UNKNOWN', 'Status read failed; the same request ID remains saved and no create request was made.');
  }
  if (!statusResponse.ok) throw new ReplayError('RESUME_STATUS_UNKNOWN', `Status read returned HTTP ${statusResponse.status}; no new create request was made.`);
  receipt.provider_status = status.status ?? 'UNKNOWN';
  receipt.checked_at = now();
  if (status.status === 'COMPLETED') {
    let resultResponse;
    let result;
    try {
      resultResponse = await fetchImpl(receipt.response_url, { method: 'GET', headers: { Authorization: `Key ${falKey}` } });
      result = await resultResponse.json();
    } catch {
      receipt.state = 'RUNNING';
      await writeAtomicJson(paths.submission, receipt);
      throw new ReplayError('RESUME_RESULT_UNKNOWN', 'Result read failed; the same request ID remains saved for another read.');
    }
    if (resultResponse.status >= 400 && resultResponse.status < 500) {
      receipt.state = 'REJECTED';
      receipt.outcome_code = 'PROVIDER_RESULT_REJECTED';
      await writeAtomicJson(paths.submission, receipt);
      return { state: receipt.state, endpoint: ENDPOINT, model: MODEL, request_id: requestId };
    }
    if (!resultResponse.ok || typeof result?.video?.url !== 'string' || !result.video.url.startsWith('https://')) {
      receipt.state = 'RUNNING';
      await writeAtomicJson(paths.submission, receipt);
      throw new ReplayError('RESUME_RESULT_UNKNOWN', 'Result response was incomplete; the same request ID remains saved for another read.');
    }
    receipt.state = 'COMPLETED';
    receipt.result_url = result.video.url;
    receipt.result_sha256 = null;
  } else if (['FAILED', 'CANCELLED', 'REJECTED'].includes(status.status)) {
    receipt.state = 'REJECTED';
    receipt.outcome_code = 'PROVIDER_JOB_TERMINAL';
  } else {
    receipt.state = 'RUNNING';
  }
  await writeAtomicJson(paths.submission, receipt);
  return { state: receipt.state, endpoint: ENDPOINT, model: MODEL, request_id: requestId, provider_status: receipt.provider_status };
}

function usage() {
  return [
    'Usage: node beta/tools/seedance-reference-pack.mjs --manifest <private.json> --media-root <private-media> --prompt-file <private-prompt.txt> [--state-dir <private-state>] [--max-estimate-usd <amount>] [--submit | --resume <request-id>]',
    'Default: validate and estimate only; no upload or provider request is made.',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const parsed = { submit: false, resume: null };
  const values = new Set(['--manifest', '--media-root', '--prompt-file', '--state-dir', '--max-estimate-usd', '--resume']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--submit') { parsed.submit = true; continue; }
    if (!values.has(flag) || typeof argv[index + 1] !== 'string') throw new ReplayError('CLI_ARGUMENT_INVALID', `Unknown or incomplete option: ${flag}`);
    const value = argv[++index];
    if (flag === '--max-estimate-usd') parsed.maxEstimateUsd = Number(value);
    else if (flag === '--resume') parsed.resume = value;
    else parsed[{
      '--manifest': 'manifestPath',
      '--media-root': 'mediaRoot',
      '--prompt-file': 'promptFile',
      '--state-dir': 'stateDir',
    }[flag]] = value;
  }
  if (parsed.submit && parsed.resume) throw new ReplayError('CLI_ARGUMENT_INVALID', '--submit and --resume cannot be used together.');
  for (const name of ['manifestPath', 'mediaRoot', 'promptFile']) {
    if (!parsed[name]) throw new ReplayError('CLI_ARGUMENT_INVALID', `${name} is required.`);
  }
  return parsed;
}

async function prepareFromPaths(options, dependencies = {}) {
  let manifest;
  let prompt;
  try {
    manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'));
    prompt = await readFile(options.promptFile, 'utf8');
  } catch {
    throw new ReplayError('INPUT_FILE_UNREADABLE', 'Manifest or prompt file is missing or unreadable.');
  }
  return validateInputPack({ manifest, mediaRoot: options.mediaRoot, prompt, probeVideoFn: dependencies.probeVideoFn ?? probeVideo });
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  let options;
  try { options = parseArgs(argv); } catch (error) {
    return { exitCode: 2, output: { status: 'FAIL', code: error.code ?? 'CLI_ARGUMENT_INVALID', message: error.message } };
  }
  if (options.help) return { exitCode: 0, output: usage() };
  try {
    const pack = await prepareFromPaths(options, dependencies);
    let output;
    if (options.submit) {
      output = await submitPrepared(pack, {
        stateDir: options.stateDir,
        maxEstimateUsd: options.maxEstimateUsd,
        ...(dependencies.submit ?? {}),
      });
    } else if (options.resume) {
      output = await resumePrepared(pack, {
        stateDir: options.stateDir,
        requestId: options.resume,
        ...(dependencies.resume ?? {}),
      });
    } else {
      output = {
        state: 'DRY_RUN',
        endpoint: ENDPOINT,
        model: MODEL,
        task: 'reference',
        image_count: 2,
        video_count: 2,
        total_input_video_seconds: pack.input_video_seconds,
        output_duration_seconds: pack.manifest.output.duration_seconds,
        estimated_usd: pack.estimated_usd,
        prompt_sha256: pack.prompt_sha256,
        files: pack.files.map((file) => ({ label: file.label, kind: file.kind, mime_type: file.mime_type, sha256: file.sha256 })),
      };
    }
    return { exitCode: 0, output };
  } catch (error) {
    return {
      exitCode: 1,
      output: {
        status: 'FAIL',
        code: error.code ?? 'REFERENCE_REPLAY_FAILED',
        message: error.message ?? 'Reference replay failed.',
      },
    };
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await main();
  if (typeof result.output === 'string') process.stdout.write(`${result.output}\n`);
  else process.stdout.write(`${JSON.stringify(result.output)}\n`);
  process.exitCode = result.exitCode;
}
