import { File } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createFalClient } from '@fal-ai/client';
import {
  adapterEvaluator,
  atomicWriteProviderJournal,
  orderedReferenceDescriptors,
  readProviderJournal,
  validateMedia,
  validateQaDecision,
} from './image-generation-contract.js';
import { assertExternalPromptPrivacy } from './provider-prompt-privacy.js';

export const FAL_IMAGEGEN_ENDPOINT = 'openai/gpt-image-2.5/sunburst/edit';
export const FAL_IMAGEGEN_PROVIDER_NAME = 'fal-gpt-image-2.5-sunburst';

const SHA256 = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCES = 16;
const MAX_DIMENSION = 3840;
const QUALITY = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function sha256Json(value) { return sha256(JSON.stringify(value)); }

function providerError(message, code, { retryable = false, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'FalImagegenProviderError';
  error.code = code;
  error.retryable = retryable;
  return error;
}

function timestamp(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw providerError('FAL provider clock returned an invalid date', 'INVALID_PROVIDER_CLOCK');
  }
  return value.toISOString();
}

function promptImageSize(context) {
  if (context.width !== undefined || context.height !== undefined) {
    if (!Number.isInteger(context.width) || !Number.isInteger(context.height)
      || context.width < 256 || context.height < 256 || context.width > MAX_DIMENSION || context.height > MAX_DIMENSION) {
      throw providerError('FAL image_size requires bounded integer width and height', 'INVALID_IMAGE_SIZE');
    }
    return { width: context.width, height: context.height };
  }
  const aspect = context.aspectRatio ?? context.aspect_ratio ?? '3:4';
  if (typeof aspect !== 'string') throw providerError('FAL image_size requires a string width:height aspect ratio', 'INVALID_IMAGE_SIZE');
  const dimensions = aspect.split(':').map(Number);
  if (dimensions.length !== 2 || dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw providerError('FAL image_size requires a valid width:height aspect ratio', 'INVALID_IMAGE_SIZE');
  }
  const resolution = String(context.resolution ?? context.generation_profile?.resolution ?? '').toLowerCase();
  const longEdge = ({ '1k': 1024, '2k': 2048, '4k': MAX_DIMENSION })[resolution];
  if (longEdge) {
    // Sunburst caps a custom dimension at 3840 px; the 4k profile uses that maximum while keeping its aspect ratio.
    const scale = longEdge / Math.max(...dimensions);
    return { width: Math.round(dimensions[0] * scale), height: Math.round(dimensions[1] * scale) };
  }
  if (resolution !== '') throw providerError(`Unsupported FAL image resolution: ${resolution}`, 'INVALID_IMAGE_RESOLUTION');
  return ({
    '1:1': 'square_hd',
    '3:4': 'portrait_4_3',
    '4:3': 'landscape_4_3',
    '9:16': 'portrait_16_9',
    '16:9': 'landscape_16_9',
  })[aspect] ?? 'auto';
}

function sceneDescriptors(ordered) {
  if (ordered.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw providerError('Scene references must be ordered image binding objects', 'INVALID_ORDERED_REFERENCES');
  }
  const guideFirst = ordered[0]?.role === 'MECHANICAL_FRAMING_GUIDE';
  const masterIndex = guideFirst ? 1 : 0;
  const master = ordered[masterIndex];
  const masters = ordered.filter((item) => item.role === 'APPROVED_LOOK_MASTER');
  const guides = ordered.filter((item) => item.role === 'MECHANICAL_FRAMING_GUIDE');
  const repairIndex = masterIndex + 1;
  const repairBindings = ordered.filter((item) => item.scope === 'scene');
  const repair = repairBindings[0];
  const permitted = [master, guideFirst ? ordered[0] : null, repair].filter(Boolean);
  const otherBindingsValid = ordered.filter((item) => !permitted.includes(item)).every((item) => (
    item.scope === 'outfit' && ['CONDITIONED', 'REFERENCE_PACK'].includes(item.source)
  ));
  if (master?.scope !== 'avatar' || master.role !== 'APPROVED_LOOK_MASTER' || master.source !== 'APPROVED_AVATAR'
    || masters.length !== 1
    || guides.length !== (guideFirst ? 1 : 0)
    || (guideFirst && (ordered[0].scope !== 'outfit' || ordered[0].source !== 'CONDITIONED'))
    || repairBindings.length > 1
    || (repairBindings.length === 1
      && (ordered[repairIndex] !== repair || repair.role !== 'FAILED_SCENE_CANDIDATE'
        || repair.source !== 'REPAIR_CANDIDATE'))
    || ordered.some((item) => !['avatar', 'outfit', 'scene'].includes(item.scope)
      || !['CONDITIONED', 'REFERENCE_PACK', 'APPROVED_AVATAR', 'REPAIR_CANDIDATE'].includes(item.source)
      || ((item.scope === 'scene') !== (item.source === 'REPAIR_CANDIDATE')))
    || !otherBindingsValid) {
    throw providerError(
      'Scene image bindings must place the mechanical guide first, then the approved look, with any repair candidate immediately after them',
      'INVALID_SCENE_REFERENCE_ORDER',
    );
  }
  const validationOrder = guideFirst
    ? [master, ...ordered.slice(2), ordered[0]]
    : ordered;
  return orderedReferenceDescriptors('scene', {
    ordered: validationOrder.map((item, index) => ({ ...item, order: index + 1 })),
  }, { maxOrdered: MAX_REFERENCES });
}

function orderedDescriptors(phase, references) {
  const ordered = references?.ordered;
  if (!Array.isArray(ordered) || ordered.length < 1 || ordered.length > MAX_REFERENCES) {
    throw providerError(`Generation requires 1–${MAX_REFERENCES} ordered references`, 'INVALID_ORDERED_REFERENCES');
  }
  if (phase !== 'scene') {
    return orderedReferenceDescriptors(phase, references, { maxOrdered: MAX_REFERENCES });
  }
  const validated = sceneDescriptors(ordered);
  const byPath = new Map(validated.map((item) => [item.path, item]));
  return ordered.map((item, index) => ({
    ...byPath.get(path.resolve(item.path)),
    order: index + 1,
  }));
}

async function validateReferences(descriptors) {
  try {
    await validateMedia(descriptors);
  } catch (cause) {
    const code = cause?.code === 'REFERENCE_DIGEST_MISMATCH' ? 'REFERENCE_HASH_MISMATCH' : cause?.code;
    throw providerError(cause?.message ?? 'FAL reference validation failed', code ?? 'INVALID_REFERENCE_FILE', { cause });
  }
  for (const descriptor of descriptors) {
    if (descriptor.size > MAX_REFERENCE_BYTES) {
      throw providerError('FAL references must be no larger than 20 MiB', 'INVALID_REFERENCE_FILE');
    }
    let metadata;
    try {
      const bytes = await readFile(descriptor.path);
      metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
    } catch (cause) {
      throw providerError('FAL reference is not a decodable image', 'INVALID_REFERENCE_IMAGE', { cause });
    }
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      throw providerError('FAL reference must be one still image with dimensions', 'INVALID_REFERENCE_IMAGE');
    }
    descriptor.byteSize = descriptor.size;
    descriptor.width = metadata.width;
    descriptor.height = metadata.height;
  }
}

async function validatePng(bytes, code = 'INVALID_PROVIDER_OUTPUT') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_OUTPUT_BYTES
    || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw providerError('FAL returned no valid PNG bytes', code);
  }
  try {
    const decoder = sharp(bytes, { failOn: 'error', limitInputPixels: 67_108_864 });
    const metadata = await decoder.metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1
      || metadata.width > 8192 || metadata.height > 8192) throw new Error('unexpected PNG metadata');
    await decoder.stats();
    return { width: metadata.width, height: metadata.height };
  } catch (cause) {
    throw providerError('FAL returned no valid PNG bytes', code, { cause });
  }
}

function guardedSdkFetch(fetchImpl) {
  const submittedSignals = new WeakSet();
  return async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && rawUrl) {
      const url = new URL(rawUrl);
      if (url.hostname === 'queue.fal.run' && url.pathname === `/${FAL_IMAGEGEN_ENDPOINT}`) {
        const signal = init.signal;
        if (!signal || typeof signal !== 'object' || submittedSignals.has(signal)) {
          throw providerError('Blocked a repeated FAL paid submit for the same request', 'FAL_SUBMIT_RETRY_BLOCKED');
        }
        submittedSignals.add(signal);
      }
    }
    return fetchImpl(input, init);
  };
}

function sceneOrderFingerprint(descriptors) {
  return descriptors.map((item) => ({
    order: item?.order,
    scope: item?.scope,
    role: item?.role,
    sha256: item?.sha256,
    mediaType: item?.mediaType,
    source: item?.source,
    packSha256: item?.packSha256,
    bindingOrder: item?.bindingOrder,
  }));
}

export class FalImagegenProvider {
  constructor({
    client,
    clientFactory = createFalClient,
    credentials = process.env.FAL_KEY,
    qaEvaluator,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15 * 60 * 1000,
    pollIntervalMs = 1000,
    clock = () => new Date(),
  } = {}) {
    if (!client && (typeof credentials !== 'string' || credentials.trim() === '')) {
      throw new TypeError('FAL_KEY is required for the FAL image provider');
    }
    if (typeof clientFactory !== 'function' || typeof fetchImpl !== 'function') throw new TypeError('FAL client and fetch implementations are required');
    if (qaEvaluator !== undefined && typeof qaEvaluator !== 'function') throw new TypeError('qaEvaluator must be a function');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15 * 60 * 1000) throw new TypeError('timeoutMs must be between 1 and 900000');
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 60_000) throw new TypeError('pollIntervalMs must be between 1 and 60000');
    this.fetchImpl = fetchImpl;
    this.client = client ?? clientFactory({ credentials: credentials.trim(), fetch: guardedSdkFetch(fetchImpl) });
    this.qaEvaluator = qaEvaluator;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.clock = clock;
    this.providerName = FAL_IMAGEGEN_PROVIDER_NAME;
    this.providerId = 'fal-imagegen';
    this.generationRoute = Object.freeze(['gpt_image_2']);
    this.maxOrderedReferences = MAX_REFERENCES;
    this.transportAspectRatio = '3:4';
    this.inflight = new Map();
  }

  healthStatus() { return { status: 'ready', provider: this.providerName, endpoint: FAL_IMAGEGEN_ENDPOINT }; }
  async probe() { return this.healthStatus(); }
  async close() {}

  async generate(context) {
    const key = context?.idempotencyKey;
    if (typeof key !== 'string' || !SHA256.test(key)) {
      throw providerError('Generation requires a lowercase SHA-256 idempotencyKey', 'INVALID_IDEMPOTENCY_KEY');
    }
    const fingerprint = sha256Json({
      phase: context?.phase,
      model: context?.model,
      job_set_type: context?.job_set_type,
      prompt: context?.prompt,
      jobId: context?.jobId,
      workDirectory: context?.workDirectory,
      aspectRatio: context?.aspectRatio,
      aspect_ratio: context?.aspect_ratio,
      width: context?.width,
      height: context?.height,
      resolution: context?.resolution,
      quality: context?.quality,
      generation_profile: context?.generation_profile,
      ordered: Array.isArray(context?.references?.ordered) ? sceneOrderFingerprint(context.references.ordered) : context?.references?.ordered,
    });
    const current = this.inflight.get(key);
    if (current) {
      if (current.fingerprint !== fingerprint) throw providerError('An in-flight FAL request conflicts with its idempotency key', 'PROVIDER_JOURNAL_CONFLICT');
      return current.promise;
    }
    const promise = this.#generate(context).finally(() => {
      if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, { fingerprint, promise });
    return promise;
  }

  async #generate(context) {
    if (context?.model !== context?.job_set_type) throw providerError('Generation context model and job_set_type disagree', 'MODEL_CONTEXT_MISMATCH');
    if (context?.job_set_type !== 'gpt_image_2') throw providerError('Sunburst fallback supports only the GPT Image 2 product route', 'MODEL_NOT_SUPPORTED_BY_FAL_IMAGEGEN');
    if (!['avatar', 'outfit', 'garment', 'scene'].includes(context?.phase)) throw providerError(`Unsupported generation phase: ${context?.phase}`, 'INVALID_GENERATION_PHASE');
    if (typeof context.prompt !== 'string' || context.prompt.trim() === '' || context.prompt.length > 100_000) {
      throw providerError('Generation prompt must contain 1–100000 characters', 'INVALID_PROMPT');
    }
    if (typeof context.workDirectory !== 'string' || context.workDirectory.trim() === '') throw providerError('FAL imagegen requires an isolated workDirectory', 'MISSING_WORK_DIRECTORY');
    try { assertExternalPromptPrivacy(context.prompt, { runtimeRoot: context.workDirectory }); } catch (cause) {
      throw providerError('Generation prompt contains private local metadata', 'UNSAFE_PROVIDER_PROMPT', { cause });
    }
    const descriptors = orderedDescriptors(context.phase, context.references);
    await validateReferences(descriptors);
    const quality = context.quality ?? context.generation_profile?.quality ?? 'high';
    if (!QUALITY.has(quality)) throw providerError(`Unsupported FAL image quality: ${quality}`, 'INVALID_IMAGE_QUALITY');
    const imageSize = promptImageSize(context);
    const workDirectory = path.resolve(context.workDirectory);
    const journalDirectory = path.join(workDirectory, 'provider-jobs');
    const journalPath = path.join(journalDirectory, `fal-imagegen-${context.idempotencyKey}.json`);
    const outputPath = path.join(journalDirectory, `fal-imagegen-${context.idempotencyKey}.png`);
    const route = context.job_set_type;
    const request = {
      provider: this.providerId,
      transport: 'fal-queue',
      endpoint: FAL_IMAGEGEN_ENDPOINT,
      model: route,
      phase: context.phase,
      attempt: context.attempt,
      runner_job_id: context.jobId,
      idempotency_key: context.idempotencyKey,
      prompt_sha256: sha256(context.prompt),
      aspect_ratio: context.aspectRatio ?? context.aspect_ratio ?? null,
      image_size: imageSize,
      quality,
      resolution: context.resolution ?? context.generation_profile?.resolution ?? null,
      generation_profile: context.generation_profile?.id ?? null,
      input_media: descriptors.map((item) => ({
        order: item.order,
        scope: item.scope ?? null,
        role: item.role,
        sha256: item.sha256,
        media_type: item.mediaType,
        source: item.source,
        byte_size: item.byteSize,
        width: item.width,
        height: item.height,
        pack_sha256: item.packSha256 ?? null,
        binding_order: item.bindingOrder ?? null,
      })),
    };
    const requestSha256 = sha256Json(request);
    const existing = await readProviderJournal(journalPath);
    if (existing) {
      const { journal } = existing;
      if (journal.schema_version !== '1.0.0' || journal.provider !== this.providerId
        || journal.request_sha256 !== requestSha256 || journal.idempotency_key !== context.idempotencyKey) {
        throw providerError('FAL provider journal conflicts with the immutable generation request', 'PROVIDER_JOURNAL_CONFLICT');
      }
      if (journal.state === 'OUTPUT_STORED') {
        const image = await this.#readStoredOutput(journal, outputPath);
        return this.#response(image, descriptors, journal, journalPath, sha256(existing.bytes), requestSha256, true);
      }
      if (journal.state === 'SUBMITTED' && typeof journal.provider_request_id === 'string') {
        return this.#finishRequest(journal, descriptors, journalPath, requestSha256, true);
      }
      throw providerError('A prior FAL imagegen submission has an unknown or failed outcome; refusing a duplicate', 'PRIOR_OUTCOME_UNKNOWN');
    }

    const now = timestamp(this.clock);
    let journal = {
      schema_version: '1.0.0', provider: this.providerId, transport: 'fal-queue',
      state: 'STARTED', idempotency_key: context.idempotencyKey, request_sha256: requestSha256,
      request, created_at: now, updated_at: now, provider_request_id: null,
      events: [{ type: 'STARTED', at: now }],
    };
    await atomicWriteProviderJournal(journalPath, journal);
    try {
      const imageUrls = await this.#uploadReferences(descriptors);
      let at = timestamp(this.clock);
      journal = { ...journal, state: 'UPLOADED', updated_at: at, input_urls: imageUrls, events: [...journal.events, { type: 'UPLOADED', at }] };
      await atomicWriteProviderJournal(journalPath, journal);
      at = timestamp(this.clock);
      journal = { ...journal, state: 'SUBMITTING', updated_at: at, events: [...journal.events, { type: 'SUBMITTING', at }] };
      await atomicWriteProviderJournal(journalPath, journal);
      const abortController = new AbortController();
      const queued = await this.client.queue.submit(FAL_IMAGEGEN_ENDPOINT, {
        abortSignal: abortController.signal,
        input: {
          prompt: context.prompt,
          image_urls: imageUrls,
          image_size: imageSize,
          quality,
          output_format: 'png',
          num_images: 1,
        },
      });
      const requestId = queued?.request_id ?? queued?.requestId;
      if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw providerError('FAL queue accepted a submit without returning a request id', 'FAL_SUBMIT_ID_MISSING');
      }
      at = timestamp(this.clock);
      journal = { ...journal, state: 'SUBMITTED', provider_request_id: requestId, updated_at: at, events: [...journal.events, { type: 'SUBMITTED', at, provider_request_id: requestId }] };
      await atomicWriteProviderJournal(journalPath, journal);
    } catch (cause) {
      const uncertain = journal.state === 'SUBMITTING' || journal.state === 'SUBMITTED' || cause?.code === 'FAL_SUBMIT_ID_MISSING';
      const at = timestamp(this.clock);
      journal = {
        ...journal,
        state: uncertain ? 'FAILED_OUTCOME_UNKNOWN' : 'FAILED_BEFORE_SUBMIT',
        updated_at: at,
        error: { code: cause?.code ?? 'FAL_GENERATION_FAILED', message: cause?.message ?? String(cause) },
        events: [...journal.events, { type: uncertain ? 'FAILED_OUTCOME_UNKNOWN' : 'FAILED_BEFORE_SUBMIT', at, code: cause?.code ?? 'FAL_GENERATION_FAILED' }],
      };
      try { await atomicWriteProviderJournal(journalPath, journal); } catch { /* preserve the original failure */ }
      if (uncertain) {
        throw providerError(`FAL imagegen outcome is unknown after submission: ${cause?.message ?? String(cause)}`, 'GENERATION_OUTCOME_UNKNOWN', { cause });
      }
      if (cause?.code) throw cause;
      throw providerError(`FAL imagegen failed before submission: ${cause?.message ?? String(cause)}`, 'FAL_GENERATION_FAILED', { retryable: cause?.retryable === true, cause });
    }
    return this.#finishRequest(journal, descriptors, journalPath, requestSha256, false, outputPath);
  }

  async #uploadReferences(descriptors) {
    const urls = [];
    for (const descriptor of descriptors) {
      const bytes = await readFile(descriptor.path);
      if (sha256(bytes) !== descriptor.sha256) throw providerError('Reference SHA-256 changed before FAL upload', 'REFERENCE_HASH_MISMATCH');
      const extension = path.extname(descriptor.path).toLowerCase();
      const url = await this.client.storage.upload(
        new File([bytes], `reference-${descriptor.order}-${descriptor.sha256}${extension}`, { type: descriptor.mediaType }),
        { lifecycle: { expiresIn: '1h' } },
      );
      let parsed;
      try { parsed = new URL(url); } catch (cause) { throw providerError('FAL storage returned an invalid reference URL', 'INVALID_FAL_UPLOAD_URL', { cause }); }
      if (parsed.protocol !== 'https:' || !(parsed.hostname === 'fal.media' || parsed.hostname.endsWith('.fal.media'))) {
        throw providerError('FAL storage returned a non-FAL reference URL', 'INVALID_FAL_UPLOAD_URL');
      }
      urls.push(url);
    }
    return urls;
  }

  async #finishRequest(journal, descriptors, journalPath, requestSha256, resumed, outputPath = path.join(path.dirname(journalPath), `fal-imagegen-${journal.idempotency_key}.png`)) {
    const deadline = Date.now() + this.timeoutMs;
    try {
      while (true) {
        if (Date.now() >= deadline) throw providerError('FAL imagegen is still running; its request id is journaled for safe resume', 'GENERATION_OUTCOME_UNKNOWN');
        const status = await this.client.queue.status(FAL_IMAGEGEN_ENDPOINT, { requestId: journal.provider_request_id });
        if (status?.status === 'COMPLETED') break;
        if (status?.status === 'FAILED' || status?.status === 'CANCELLED') {
          const at = timestamp(this.clock);
          const failed = { ...journal, state: 'FAILED', updated_at: at, error: { code: 'FAL_GENERATION_FAILED', message: `FAL request ${status.status.toLowerCase()}` }, events: [...journal.events, { type: 'FAILED', at, status: status.status }] };
          await atomicWriteProviderJournal(journalPath, failed);
          throw providerError(`FAL imagegen request ${status.status.toLowerCase()}`, 'FAL_GENERATION_FAILED');
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(this.pollIntervalMs, Math.max(1, deadline - Date.now()))));
      }
      const result = await this.client.queue.result(FAL_IMAGEGEN_ENDPOINT, { requestId: journal.provider_request_id });
      const output = (result?.data ?? result)?.images?.[0];
      let outputUrl;
      try { outputUrl = new URL(output?.url); } catch (cause) { throw providerError('FAL returned no valid image URL', 'INVALID_PROVIDER_OUTPUT', { cause }); }
      if (outputUrl.protocol !== 'https:' || !(outputUrl.hostname === 'fal.media' || outputUrl.hostname.endsWith('.fal.media'))) {
        throw providerError('FAL returned a non-FAL image URL', 'INVALID_PROVIDER_OUTPUT');
      }
      const response = await this.fetchImpl(outputUrl, { signal: AbortSignal.timeout(60_000) });
      const contentLength = Number(response.headers?.get?.('content-length'));
      if (!response.ok || (Number.isFinite(contentLength) && contentLength > MAX_OUTPUT_BYTES)) {
        throw providerError('FAL image download failed or exceeded its size limit', 'FAL_OUTPUT_DOWNLOAD_FAILED');
      }
      const image = Buffer.from(await response.arrayBuffer());
      const dimensions = await validatePng(image);
      await mkdir(path.dirname(outputPath), { recursive: true });
      const temporaryOutput = `${outputPath}.${process.pid}.tmp`;
      await writeFile(temporaryOutput, image, { flag: 'wx', mode: 0o600 });
      await rename(temporaryOutput, outputPath);
      const outputSha256 = sha256(image);
      const at = timestamp(this.clock);
      const completed = {
        ...journal,
        state: 'OUTPUT_STORED',
        updated_at: at,
        output: { path: outputPath, sha256: outputSha256, byte_size: image.length, media_type: 'image/png', width: dimensions.width, height: dimensions.height },
        events: [...journal.events, { type: 'OUTPUT_STORED', at, output_sha256: outputSha256 }],
      };
      await atomicWriteProviderJournal(journalPath, completed);
      return this.#response(image, descriptors, completed, journalPath, sha256(`${JSON.stringify(completed, null, 2)}\n`), requestSha256, resumed);
    } catch (cause) {
      if (cause?.code === 'FAL_GENERATION_FAILED') throw cause;
      if (cause?.code === 'GENERATION_OUTCOME_UNKNOWN') throw cause;
      throw providerError(`FAL request ${journal.provider_request_id} has not produced a stored image; it can be resumed without resubmitting`, 'GENERATION_OUTCOME_UNKNOWN', { cause });
    }
  }

  async #readStoredOutput(journal, outputPath) {
    if (!journal.output || path.resolve(journal.output.path ?? '') !== path.resolve(outputPath)
      || !SHA256.test(journal.output.sha256 ?? '')) throw providerError('Journaled FAL output no longer matches its receipt', 'JOURNALED_OUTPUT_MISMATCH');
    let image;
    try { image = await readFile(outputPath); } catch (cause) { throw providerError('Journaled FAL output is not readable', 'JOURNALED_OUTPUT_MISMATCH', { cause }); }
    const dimensions = await validatePng(image, 'JOURNALED_OUTPUT_MISMATCH');
    if (sha256(image) !== journal.output.sha256 || image.length !== journal.output.byte_size
      || dimensions.width !== journal.output.width || dimensions.height !== journal.output.height) {
      throw providerError('Journaled FAL output no longer matches its receipt', 'JOURNALED_OUTPUT_MISMATCH');
    }
    return image;
  }

  #response(image, descriptors, journal, journalPath, journalSha256, requestSha256, resumed) {
    return {
      image,
      extension: '.png',
      mediaType: 'image/png',
      metadata: {
        provider: this.providerId,
        transport: 'fal-queue',
        endpoint: FAL_IMAGEGEN_ENDPOINT,
        model_name: 'GPT Image 2.5 Sunburst',
        provider_internal_model: FAL_IMAGEGEN_ENDPOINT,
        job_set_type: journal.request.model,
        resolution: journal.request.resolution,
        quality: journal.request.quality,
        generation_profile: journal.request.generation_profile,
        image_size: journal.request.image_size,
        provider_request_id: journal.provider_request_id,
        output_sha256: journal.output.sha256,
        width: journal.output.width,
        height: journal.output.height,
        idempotency_key: journal.idempotency_key,
        input_media: descriptors.map((item) => ({
          order: item.order, scope: item.scope, role: item.role, sha256: item.sha256,
          byte_size: item.byteSize, media_type: item.mediaType, source: item.source,
          width: item.width, height: item.height,
        })),
        provider_journal: { path: journalPath, sha256: journalSha256, request_sha256: requestSha256, state: journal.state, resumed },
      },
    };
  }

  async qa(context) {
    if (!this.qaEvaluator) {
      return validateQaDecision({
        decision: 'NEEDS_INPUT',
        checks: [{ name: 'EXTERNAL_QA_CONFIGURED', pass: false, score: 0, evidence: 'No production semantic evaluator is configured' }],
        defects: ['No production semantic evaluator is configured'],
        reason: 'fal_imagegen_provider_does_not_auto_approve_semantic_quality',
        evaluator: adapterEvaluator(context, 'NEEDS_INPUT', 'no-semantic-evaluator'),
      }, context);
    }
    return validateQaDecision(await this.qaEvaluator(context), context);
  }
}

export function createFalImagegenProvider(options) { return new FalImagegenProvider(options); }
