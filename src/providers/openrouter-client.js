import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Same underlying model the app already prompts against via the local Codex
// CLI (see codex-vlm-evaluator.js / scene-adapters.js `model: 'gpt-5.6-terra'`).
// Reusing it here keeps evaluation behavior close to the tuned Codex prompts
// while removing the dependency on the ChatGPT/Codex CLI session entirely.
export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-5.6-terra';

export class OpenRouterAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpenRouterAuthError';
  }
}

export class OpenRouterTransportError extends Error {
  constructor(message, { code = 'OPENROUTER_TRANSPORT_FAILED', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OpenRouterTransportError';
    this.code = code;
  }
}

const MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
});

async function imageDataUrl(filename) {
  const bytes = await readFile(filename);
  const mime = MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? 'image/jpeg';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function requireApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new OpenRouterAuthError('OpenRouter API key is required (set OPENROUTER_API_KEY)');
  }
  return apiKey;
}

// OpenRouter's catalog includes floating routing aliases (`openrouter/auto`,
// `openrouter/auto-beta`) and `~`-prefixed "latest" aliases whose underlying
// model can change without notice. Evaluator identity/version must stay exact
// and immutable (see CodexVlmEvaluator's own ambiguous-version guard and
// scene-contract.js's MOVING_MODEL_VERSION check), so reject those here too.
const AMBIGUOUS_OPENROUTER_MODEL = /^(?:openrouter\/auto(?:-beta)?|~.+)$/i;

export function assertNonAmbiguousOpenRouterModel(model) {
  if (typeof model !== 'string' || model.trim() === '' || AMBIGUOUS_OPENROUTER_MODEL.test(model.trim())) {
    throw new TypeError('OpenRouter model must be an exact non-ambiguous model id');
  }
  return model;
}

/**
 * Thin, injectable transport around OpenRouter's OpenAI-compatible chat
 * completions endpoint. Every evaluator-facing prompt/validation rule lives in
 * the calling evaluator (openrouter-vlm-evaluator.js, openrouter-scene-evaluator.js);
 * this class only knows how to package local image files plus a prompt into one
 * request and hand back the raw JSON text the model produced.
 */
export class OpenRouterClient {
  constructor({
    apiKey = process.env.OPENROUTER_API_KEY,
    baseUrl = process.env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL,
    httpClient = fetch,
    referer = process.env.ZEELY_OPENROUTER_REFERER ?? 'https://www.madeforthisjob.com',
    title = 'Zeely VLM Evaluator',
  } = {}) {
    this.apiKey = requireApiKey(apiKey);
    this.baseUrl = baseUrl;
    this.httpClient = httpClient;
    this.referer = referer;
    this.title = title;
  }

  async #send(body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await this.httpClient(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.referer,
          'X-Title': this.title,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new OpenRouterTransportError(`OpenRouter request failed: ${error.message}`, {
        code: 'OPENROUTER_REQUEST_FAILED',
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new OpenRouterTransportError('OpenRouter returned a non-JSON response', {
        code: 'OPENROUTER_INVALID_RESPONSE',
        cause: error,
      });
    }
    if (!response.ok || payload?.error) {
      const message = payload?.error?.message ?? `OpenRouter request failed with status ${response.status}`;
      throw new OpenRouterTransportError(message, { code: 'OPENROUTER_API_ERROR' });
    }
    return payload;
  }

  async completeWithSchema({
    model,
    prompt,
    imagePaths = [],
    schema,
    schemaName,
    reasoningEffort,
    timeoutMs = 90_000,
    maxOutputTokens = 8_000,
  }) {
    if (typeof model !== 'string' || model.trim() === '') {
      throw new TypeError('OpenRouterClient.completeWithSchema requires a model id');
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new TypeError('OpenRouterClient.completeWithSchema requires a prompt');
    }
    const content = [{ type: 'text', text: prompt }];
    for (const filename of imagePaths) {
      content.push({ type: 'image_url', image_url: { url: await imageDataUrl(filename) } });
    }
    const payload = await this.#send({
      model,
      messages: [{ role: 'user', content }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
      max_tokens: maxOutputTokens,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    }, timeoutMs);
    const raw = payload?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new OpenRouterTransportError('OpenRouter returned no completion content', {
        code: 'OPENROUTER_EMPTY_RESPONSE',
      });
    }
    return raw;
  }

  /**
   * Request one generated image back from an image-output-capable OpenRouter
   * model (e.g. openai/gpt-5.4-image-2, google/gemini-3-pro-image). OpenRouter
   * follows the Gemini-style inline-image convention for multimodal output:
   * the assistant message carries an `images` array of data-URL entries
   * alongside (or instead of) text. This has not yet been exercised against a
   * real, paid OpenRouter call in this codebase — treat the first live smoke
   * test as verification of this response-shape assumption, not just of
   * credentials/model availability.
   */
  async generateImage({
    model,
    prompt,
    imagePaths = [],
    aspectRatio,
    timeoutMs = 240_000,
  }) {
    if (typeof model !== 'string' || model.trim() === '') {
      throw new TypeError('OpenRouterClient.generateImage requires a model id');
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new TypeError('OpenRouterClient.generateImage requires a prompt');
    }
    if (aspectRatio !== undefined && !/^\d{1,2}:\d{1,2}$/.test(String(aspectRatio))) {
      throw new TypeError('OpenRouterClient.generateImage aspectRatio must look like "4:5"');
    }
    const content = [{ type: 'text', text: prompt }];
    for (const filename of imagePaths) {
      content.push({ type: 'image_url', image_url: { url: await imageDataUrl(filename) } });
    }
    // The aspect belongs in the request, not only in the prompt. Measured
    // 2026-07-25 against both routed models: with no image_config, gpt-image
    // returns 1024×1024 and ignores the "4:5" the prompt asks for; with
    // image_config it returns 896×1120, exactly 4:5. Gemini honours it too
    // (1:1 → 1024×1024, 4:5 → 928×1152). Every square scene frame this pipeline
    // has produced traces back to this field being absent. `size` is not a
    // substitute — it was measured to be ignored.
    const payload = await this.#send({
      model,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
      ...(aspectRatio === undefined ? {} : { image_config: { aspect_ratio: String(aspectRatio) } }),
    }, timeoutMs);
    const message = payload?.choices?.[0]?.message;
    const imageEntry = Array.isArray(message?.images) ? message.images[0] : undefined;
    const imageUrl = imageEntry?.image_url?.url
      ?? imageEntry?.url
      ?? (Array.isArray(message?.content)
        ? message.content.find((part) => part?.type === 'image_url')?.image_url?.url
        : undefined);
    if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
      throw new OpenRouterTransportError('OpenRouter returned no generated image', {
        code: 'OPENROUTER_NO_IMAGE_OUTPUT',
      });
    }
    const dataUrlMatch = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/is.exec(imageUrl.trim());
    if (dataUrlMatch) {
      return Buffer.from(dataUrlMatch[1], 'base64');
    }
    if (/^https?:\/\//i.test(imageUrl)) {
      let downloadResponse;
      try {
        downloadResponse = await this.httpClient(imageUrl);
      } catch (error) {
        throw new OpenRouterTransportError(`OpenRouter generated-image download failed: ${error.message}`, {
          code: 'OPENROUTER_IMAGE_DOWNLOAD_FAILED',
          cause: error,
        });
      }
      if (!downloadResponse.ok) {
        throw new OpenRouterTransportError(`OpenRouter generated-image download failed with status ${downloadResponse.status}`, {
          code: 'OPENROUTER_IMAGE_DOWNLOAD_FAILED',
        });
      }
      return Buffer.from(await downloadResponse.arrayBuffer());
    }
    throw new OpenRouterTransportError('OpenRouter returned an unrecognized generated-image format', {
      code: 'OPENROUTER_UNRECOGNIZED_IMAGE_FORMAT',
    });
  }
}
