import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  collectQaImages,
  evaluatorResult,
  garmentPrompt,
  prepareTransportEvidence,
  qaPrompt,
  validatePassport,
  validateQa,
} from './codex-vlm-evaluator.js';
import { OpenRouterClient, OPENROUTER_DEFAULT_MODEL, assertNonAmbiguousOpenRouterModel } from './openrouter-client.js';
import { assertExternalPromptPrivacy, sanitizeExternalPrompt } from './provider-prompt-privacy.js';

const DEFAULT_QA_SCHEMA_PATH = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'codex-vlm-qa.schema.json');
const DEFAULT_PASSPORT_SCHEMA_PATH = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'garment-passport.schema.json');

/**
 * Drop-in alternative to CodexVlmEvaluator that reaches a vision-capable model
 * through the OpenRouter API instead of the local Codex CLI, so semantic QA and
 * garment classification keep working when the ChatGPT/Codex session is rate
 * limited or unauthenticated. Reuses the exact prompt-building, evidence
 * preparation and JS-side validation from codex-vlm-evaluator.js so evaluation
 * behavior does not drift between backends; only the transport differs.
 */
export class OpenRouterVlmEvaluator {
  constructor({
    client,
    model = process.env.ZEELY_OPENROUTER_VLM_MODEL ?? OPENROUTER_DEFAULT_MODEL,
    timeoutMs = 90_000,
    qaSchemaPath = DEFAULT_QA_SCHEMA_PATH,
    passportSchemaPath = DEFAULT_PASSPORT_SCHEMA_PATH,
  } = {}) {
    assertNonAmbiguousOpenRouterModel(model);
    this.client = client ?? new OpenRouterClient();
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.qaSchema = JSON.parse(readFileSync(qaSchemaPath, 'utf8'));
    this.passportSchema = JSON.parse(readFileSync(passportSchemaPath, 'utf8'));
  }

  async #run({ images, promptBuilder, schema, schemaName, deduplicate = true }) {
    if (!Array.isArray(images) || images.length === 0) throw new Error('OpenRouter VLM requires at least one image');
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-openrouter-vlm-'));
    try {
      const { qaImages, preparedEvidence } = await prepareTransportEvidence({
        images,
        temporaryRoot,
        deduplicate,
      });
      const prompt = sanitizeExternalPrompt(promptBuilder(qaImages));
      assertExternalPromptPrivacy(prompt, { runtimeRoot: temporaryRoot });
      const raw = await this.client.completeWithSchema({
        model: this.model,
        prompt,
        imagePaths: qaImages.map((image) => image.path),
        schema,
        schemaName,
        // The Codex CLI transport pins every VLM call (QA and garment
        // classification alike) to low reasoning effort; match that here so
        // latency/behavior stay comparable across backends.
        reasoningEffort: 'low',
        timeoutMs: this.timeoutMs,
      });
      let value;
      try {
        value = JSON.parse(raw);
      } catch (error) {
        throw new Error(`OpenRouter VLM returned invalid JSON: ${error.message}`);
      }
      return { value, preparedEvidence };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async evaluateQa(context) {
    const images = collectQaImages(context?.evidence, context?.phase);
    try {
      const result = await this.#run({
        images,
        promptBuilder: (prepared) => qaPrompt(context?.phase, prepared, context?.evidence),
        schema: this.qaSchema,
        schemaName: 'codex_vlm_qa',
      });
      return evaluatorResult(validateQa(result.value), {
        model: this.model,
        context,
        preparedEvidence: result.preparedEvidence,
        provider: 'openrouter',
      });
    } catch (error) {
      // A garment QA infrastructure failure says nothing about source-photo
      // sufficiency. Route it to the next bounded image-model attempt instead
      // of asking the user for new evidence — same degrade rule as the Codex
      // transport.
      const decision = context?.phase === 'garment' ? 'RETRY' : 'NEEDS_INPUT';
      return evaluatorResult({
        decision,
        reason: `automatic_semantic_qa_unavailable: ${error.message}`,
        checks: [{
          name: 'AUTOMATIC_SEMANTIC_QA',
          pass: false,
          score: 0,
          evidence: error.message,
        }],
        defects: ['Automatic semantic QA did not return valid evidence'],
      }, { model: this.model, context, provider: 'openrouter' });
    }
  }

  async inspectGarments(images) {
    if (!Array.isArray(images) || images.length < 1 || images.length > 5) throw new Error('Для аналізу потрібно від одного до п’яти фото речей');
    const result = await this.#run({
      images,
      promptBuilder: garmentPrompt,
      schema: this.passportSchema,
      schemaName: 'garment_passport',
      deduplicate: false,
    });
    return validatePassport(result.value, images.length);
  }
}

export function createOpenRouterQaEvaluator(options) {
  const evaluator = new OpenRouterVlmEvaluator(options);
  return evaluator.evaluateQa.bind(evaluator);
}
