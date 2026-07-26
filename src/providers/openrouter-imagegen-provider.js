import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_MODEL_NAMES, assertAllowedImageModel } from '../runner/model-policy.js';
import {
  adapterEvaluator,
  atomicWriteProviderJournal,
  orderedReferenceDescriptors,
  readProviderJournal,
  validateMedia,
  validateQaDecision,
} from './higgsfield-cli-provider.js';
import { OpenRouterClient } from './openrouter-client.js';
import { assertExternalPromptPrivacy } from './provider-prompt-privacy.js';

const SHA256 = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function sha256Json(value) { return sha256(JSON.stringify(value)); }

// Real OpenRouter model ids for image OUTPUT — distinct from OPENROUTER_DEFAULT_MODEL
// in openrouter-client.js, which is a text/vision judge model, not an image generator.
// These map the fixed Zeely route (see runner/model-policy.js IMAGE_MODEL_ROUTE) onto
// OpenRouter-hosted equivalents of the same production models.
export const OPENROUTER_IMAGE_MODEL_BY_ROUTE = Object.freeze({
  gpt_image_2: 'openai/gpt-5.4-image-2',
  nano_banana_flash: 'google/gemini-3.1-flash-image',
  nano_banana_2: 'google/gemini-3-pro-image',
});

export class OpenRouterImageGenProviderError extends Error {
  constructor(message, { code = 'OPENROUTER_IMAGEGEN_PROVIDER_ERROR', retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OpenRouterImageGenProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

async function validatePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_OUTPUT_BYTES
    || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new OpenRouterImageGenProviderError('OpenRouter returned no valid PNG bytes', {
      code: 'INVALID_PROVIDER_OUTPUT',
    });
  }
  try {
    const decoder = sharp(bytes, { failOn: 'error', limitInputPixels: 67_108_864 });
    const metadata = await decoder.metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1
      || metadata.width > 8_192 || metadata.height > 8_192) {
      throw new Error('unexpected PNG metadata');
    }
    await decoder.stats();
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    throw new OpenRouterImageGenProviderError('OpenRouter returned no valid PNG bytes', {
      code: 'INVALID_PROVIDER_OUTPUT',
      cause: error,
    });
  }
}

/**
 * Accept any decodable image the provider returns and hand back canonical PNG.
 *
 * The route deliberately falls through several models, and they do not agree on
 * container format: openai/gpt-5.4-image-2 and google/gemini-3-pro-image return
 * PNG, while google/gemini-3.1-flash-image returns JPEG. Rejecting a perfectly
 * good JPEG with "no valid PNG bytes" threw away a finished generation over its
 * envelope and burned a fallback slot, which is how a whole scene ended as
 * GENERATION_FAILED while the image itself was fine.
 *
 * Conversion happens only for a freshly generated image, never when replaying a
 * journaled one: a stored output is already canonical and its receipt binds the
 * exact bytes, so re-encoding there would break the hash it is checked against.
 * Every other guarantee is unchanged — the result is still validated as a
 * single-page PNG within the size and dimension limits before it is stored.
 */
async function normaliseToPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_OUTPUT_BYTES) {
    throw new OpenRouterImageGenProviderError('OpenRouter returned no usable image bytes', {
      code: 'INVALID_PROVIDER_OUTPUT',
    });
  }
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { bytes, dimensions: await validatePng(bytes) };
  }
  let converted;
  try {
    converted = await sharp(bytes, { failOn: 'error', limitInputPixels: 67_108_864 })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (error) {
    throw new OpenRouterImageGenProviderError('OpenRouter returned bytes that are not a decodable image', {
      code: 'INVALID_PROVIDER_OUTPUT',
      cause: error,
    });
  }
  return { bytes: converted, dimensions: await validatePng(converted) };
}

/**
 * Drop-in alternative to HiggsfieldCliProvider / CodexImagegenProvider that
 * generates avatar/outfit/garment/scene images through the OpenRouter API
 * instead of a local CLI or app-server worker. Reuses the same
 * reference-validation, journal and QA-decision helpers as the Higgsfield
 * transport (see higgsfield-cli-provider.js) so referential-integrity and
 * idempotency guarantees stay identical across every generation backend;
 * only "how do we ask a model to render a PNG" differs, and that request is a
 * single synchronous OpenRouter call rather than a create/poll/download CLI
 * job.
 */
export class OpenRouterImageGenProvider {
  constructor({
    client,
    modelByRoute = OPENROUTER_IMAGE_MODEL_BY_ROUTE,
    qaEvaluator,
    journalDirectory,
    timeoutMs = 4 * 60 * 1000,
    clock = () => new Date(),
  } = {}) {
    if (qaEvaluator !== undefined && typeof qaEvaluator !== 'function') throw new TypeError('qaEvaluator must be a function');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (journalDirectory !== undefined && (typeof journalDirectory !== 'string' || journalDirectory.trim() === '')) {
      throw new TypeError('journalDirectory must be a non-empty string');
    }
    this.client = client ?? new OpenRouterClient();
    this.modelByRoute = { ...modelByRoute };
    this.qaEvaluator = qaEvaluator;
    this.journalDirectory = journalDirectory ? path.resolve(journalDirectory) : undefined;
    this.timeoutMs = timeoutMs;
    this.clock = clock;
    // Both routed models honour an explicit 4:5 request (measured 2026-07-25:
    // gpt-image → 896×1120, gemini → 928×1152), so this transport never needs
    // the 3:4 detour the Higgsfield CLI was limited to.
    this.transportAspectRatio = '4:5';
    // Ten, not the inherited eight, because eight is a Higgsfield CLI limit and this
    // transport does not share it: references travel as chat content parts. At eight,
    // an editorial shot carrying the approved look plus five item cutouts had two
    // slots left for its blocking diagram, its hero-continuity frame and any image
    // scene role — so the budget, not the art direction, decided what the model saw.
    this.maxOrderedReferences = 10;
  }

  /**
   * Mirrors HiggsfieldCliProvider.condition()/CodexImagegenProvider.condition():
   * an explicit validated pass-through. Crops, cutouts and readiness decisions
   * belong to the separate reference-conditioning stage, not this provider.
   */
  async condition(context) {
    const source = context?.source;
    if (source?.path) {
      const filename = path.resolve(source.path);
      const descriptors = [{ role: context.role ?? 'reference', path: filename }];
      await validateMedia(descriptors);
      return {
        reference: { path: filename },
        extension: path.extname(filename).toLowerCase(),
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
      return { facts: { conditioning_mode: 'text_passthrough', role: 'outfit', text: source.text }, risks: [] };
    }
    throw new OpenRouterImageGenProviderError('Conditioning input is missing or unsupported', {
      code: 'INVALID_CONDITIONING_INPUT',
    });
  }

  #timestamp() {
    const value = this.clock();
    if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
      throw new OpenRouterImageGenProviderError('Provider clock returned an invalid date', {
        code: 'INVALID_PROVIDER_CLOCK',
      });
    }
    return value.toISOString();
  }

  #journalPath(context) {
    const key = context?.idempotencyKey;
    if (typeof key !== 'string' || !SHA256.test(key)) {
      throw new OpenRouterImageGenProviderError('Generation requires a lowercase SHA-256 idempotencyKey', {
        code: 'INVALID_IDEMPOTENCY_KEY',
      });
    }
    const root = this.journalDirectory
      ?? (typeof context?.workDirectory === 'string' && context.workDirectory.trim() !== ''
        ? path.join(path.resolve(context.workDirectory), 'provider-jobs')
        : null);
    if (!root) {
      throw new OpenRouterImageGenProviderError('Journaled generation requires context.workDirectory or journalDirectory', {
        code: 'MISSING_PROVIDER_JOURNAL_DIRECTORY',
      });
    }
    return path.join(root, `openrouter-imagegen-${key}.json`);
  }

  async generate(context) {
    if (context?.job_set_type !== undefined
      && context?.model !== undefined
      && context.job_set_type !== context.model) {
      throw new OpenRouterImageGenProviderError('Generation context model and job_set_type disagree', {
        code: 'MODEL_CONTEXT_MISMATCH',
      });
    }
    const route = context?.job_set_type ?? context?.model;
    assertAllowedImageModel(route);
    const openRouterModel = this.modelByRoute[route];
    if (typeof openRouterModel !== 'string' || openRouterModel.trim() === '') {
      throw new OpenRouterImageGenProviderError(`No OpenRouter image model is configured for route ${route}`, {
        code: 'MODEL_NOT_SUPPORTED_BY_OPENROUTER_IMAGEGEN',
      });
    }
    const phase = context?.phase;
    if (!['avatar', 'outfit', 'garment', 'scene'].includes(phase)) {
      throw new OpenRouterImageGenProviderError(`Unsupported generation phase: ${phase}`, {
        code: 'INVALID_GENERATION_PHASE',
      });
    }
    try {
      assertExternalPromptPrivacy(context?.prompt, { runtimeRoot: context?.workDirectory });
    } catch (error) {
      throw new OpenRouterImageGenProviderError('Generation prompt contains private local metadata', {
        code: 'UNSAFE_PROVIDER_PROMPT',
        cause: error,
      });
    }
    if (typeof context.prompt !== 'string' || context.prompt.trim() === '' || context.prompt.length > 100_000) {
      throw new OpenRouterImageGenProviderError('Generation prompt must contain 1–100000 characters', {
        code: 'INVALID_PROMPT',
      });
    }
    const descriptors = orderedReferenceDescriptors(phase, context.references, {
      maxOrdered: this.maxOrderedReferences,
    });
    await validateMedia(descriptors);

    const journalPath = this.#journalPath(context);
    const request = {
      provider: 'openrouter-imagegen',
      model: openRouterModel,
      job_set_type: route,
      phase,
      attempt: context.attempt,
      runner_job_id: context.jobId,
      idempotency_key: context.idempotencyKey,
      prompt_sha256: sha256(context.prompt),
      // Part of the request identity: it changes the returned pixels. Left out,
      // a journal written before the aspect was sent would replay as a match and
      // hand back the square frame the fix exists to stop producing.
      aspect_ratio: context.aspectRatio ?? null,
      input_media: descriptors.map((item, index) => ({
        order: index + 1,
        scope: item.scope ?? null,
        role: item.role,
        sha256: item.sha256,
      })),
    };
    const requestSha256 = sha256Json(request);

    const existing = await readProviderJournal(journalPath);
    if (existing) {
      const { journal } = existing;
      if (journal.schema_version !== '1.0.0' || journal.provider !== 'openrouter-imagegen'
        || journal.idempotency_key !== context.idempotencyKey || journal.request_sha256 !== requestSha256) {
        throw new OpenRouterImageGenProviderError('Provider journal conflicts with the immutable generation request', {
          code: 'PROVIDER_JOURNAL_CONFLICT',
        });
      }
      if (journal.state !== 'OUTPUT_STORED' || !journal.output?.path) {
        throw new OpenRouterImageGenProviderError('A prior OpenRouter imagegen submission has an unknown or failed outcome; refusing a duplicate', {
          code: 'PRIOR_OUTCOME_UNKNOWN',
        });
      }
      let image;
      try {
        image = await readFile(journal.output.path);
      } catch (error) {
        throw new OpenRouterImageGenProviderError('Journaled OpenRouter output is not readable', {
          code: 'JOURNALED_OUTPUT_MISMATCH',
          cause: error,
        });
      }
      const dimensions = await validatePng(image);
      if (sha256(image) !== journal.output.sha256 || journal.output.byte_size !== image.length
        || journal.output.width !== dimensions.width || journal.output.height !== dimensions.height) {
        throw new OpenRouterImageGenProviderError('Journaled OpenRouter output no longer matches its receipt', {
          code: 'JOURNALED_OUTPUT_MISMATCH',
        });
      }
      return this.#response(image, descriptors, journal, { route, openRouterModel, resumed: true });
    }

    const now = this.#timestamp();
    let journal = {
      schema_version: '1.0.0',
      provider: 'openrouter-imagegen',
      idempotency_key: context.idempotencyKey,
      request_sha256: requestSha256,
      request,
      state: 'STARTED',
      created_at: now,
      updated_at: now,
      events: [{ type: 'STARTED', at: now }],
    };
    await atomicWriteProviderJournal(journalPath, journal);

    let image;
    let dimensions;
    try {
      const generated = await this.client.generateImage({
        model: openRouterModel,
        prompt: context.prompt,
        imagePaths: descriptors.map((item) => item.path),
        aspectRatio: context.aspectRatio,
        timeoutMs: this.timeoutMs,
      });
      // Reassign `image` to the canonical PNG: the journal receipt below records
      // sha256, byte size and dimensions of exactly the bytes that get stored.
      ({ bytes: image, dimensions } = await normaliseToPng(generated));
    } catch (error) {
      const at = this.#timestamp();
      journal = {
        ...journal,
        state: 'FAILED',
        updated_at: at,
        error: { name: error?.name ?? 'Error', code: error?.code ?? 'GENERATION_FAILED', message: error?.message ?? String(error) },
        events: [...journal.events, { type: 'FAILED', at, code: error?.code ?? 'GENERATION_FAILED' }],
      };
      try { await atomicWriteProviderJournal(journalPath, journal); } catch { /* retain the original failure */ }
      if (error instanceof OpenRouterImageGenProviderError) throw error;
      throw new OpenRouterImageGenProviderError(`OpenRouter imagegen failed: ${error?.message ?? String(error)}`, {
        code: error?.code ?? 'GENERATION_FAILED',
        retryable: error?.retryable !== false,
        cause: error,
      });
    }
    const outputPath = journalPath.replace(/\.json$/, '.png');
    const temporaryOutput = `${outputPath}.${process.pid}.tmp`;
    await writeFile(temporaryOutput, image, { flag: 'wx', mode: 0o600 });
    await rename(temporaryOutput, outputPath);
    const outputSha256 = sha256(image);
    const at = this.#timestamp();
    journal = {
      ...journal,
      state: 'OUTPUT_STORED',
      updated_at: at,
      output: {
        path: outputPath, sha256: outputSha256, byte_size: image.length,
        media_type: 'image/png', width: dimensions.width, height: dimensions.height,
      },
      events: [...journal.events, { type: 'OUTPUT_STORED', at, output_sha256: outputSha256 }],
    };
    await atomicWriteProviderJournal(journalPath, journal);
    return this.#response(image, descriptors, journal, { route, openRouterModel, resumed: false });
  }

  #response(image, descriptors, journal, { route, openRouterModel, resumed }) {
    return {
      image,
      extension: '.png',
      mediaType: 'image/png',
      metadata: {
        provider: 'openrouter-imagegen',
        transport: 'openrouter-api',
        job_set_type: route,
        model_name: IMAGE_MODEL_NAMES[route],
        provider_internal_model: openRouterModel,
        output_sha256: journal.output.sha256,
        width: journal.output.width,
        height: journal.output.height,
        input_media: descriptors.map((item, index) => ({
          index: index + 1,
          scope: item.scope,
          role: item.role,
          path: item.path,
          sha256: item.sha256,
          byte_size: item.size,
          source: item.source,
        })),
        idempotency_key: journal.idempotency_key,
        provider_journal: { path: journal.output.path, state: journal.state, resumed },
      },
    };
  }

  async qa(context) {
    if (!this.qaEvaluator) {
      return validateQaDecision({
        decision: 'NEEDS_INPUT',
        checks: [{
          name: 'EXTERNAL_QA_CONFIGURED',
          pass: false,
          score: 0,
          evidence: 'No production semantic evaluator is configured',
        }],
        defects: ['No production QA evaluator is configured'],
        reason: 'openrouter_imagegen_provider_does_not_auto_approve_semantic_quality',
        evaluator: adapterEvaluator(context, 'NEEDS_INPUT', 'no-semantic-evaluator'),
      }, context);
    }
    const decision = await this.qaEvaluator(context);
    return validateQaDecision(decision, context);
  }
}

export function createOpenRouterImagegenProvider(options) {
  return new OpenRouterImageGenProvider(options);
}
