import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { OpenRouterClient, OPENROUTER_DEFAULT_MODEL, assertNonAmbiguousOpenRouterModel } from '../providers/openrouter-client.js';
import { assertExternalPromptPrivacy } from '../providers/provider-prompt-privacy.js';
import { approvedItemFactsSha256 } from './approved-item-evidence.js';
import {
  ITEM_FIDELITY_SCHEMA_PATH,
  SceneEvaluationInfrastructureError,
  boundedEvaluationText,
  evaluatorPrompt,
  itemDetailZone,
  itemFidelityPrompt,
  mapWithConcurrency,
  referenceEvidence,
  stableRequestId,
  validateEvaluatorPayload,
  validateItemFidelityOutput,
  verifiedImageBinding,
  verifiedItemEvidence,
  verifiedSceneReference,
} from './scene-adapters.js';
import {
  SCENE_EVALUATOR_GATES,
  SCENE_REFERENCE_ROLES,
  sceneQaItemScope,
  sha256,
} from './scene-contract.js';

const DEFAULT_SCHEMA_PATH = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'scene-evaluator-output.schema.json');

/**
 * Drop-in alternative to SceneEvaluatorAdapter (scene-adapters.js) that reaches
 * a vision-capable model through the OpenRouter API instead of shelling out to
 * the local Codex CLI. Reuses every exported prompt-building, image-preparation
 * and JS-side validation helper from scene-adapters.js unchanged, so the
 * six-gate contract, per-item forensic evidence shape and infrastructure-error
 * semantics stay byte-for-byte identical to the Codex-backed evaluator; only
 * "how do we ask a model and get JSON back" differs.
 */
export class OpenRouterSceneEvaluator {
  constructor({
    client,
    model = process.env.ZEELY_OPENROUTER_SCENE_MODEL ?? OPENROUTER_DEFAULT_MODEL,
    evaluatorVersion = 'scene-evaluator-openrouter-v1.0.0',
    timeoutMs = 120_000,
    schemaPath = DEFAULT_SCHEMA_PATH,
    itemSchemaPath = ITEM_FIDELITY_SCHEMA_PATH,
    itemConcurrency = 2,
    itemEvaluatorVersion = 'scene-item-fidelity-openrouter-v1.0.0',
  } = {}) {
    if (!Number.isInteger(itemConcurrency) || itemConcurrency < 1 || itemConcurrency > 4) {
      throw new Error('OpenRouterSceneEvaluator itemConcurrency must be an integer from 1 to 4');
    }
    assertNonAmbiguousOpenRouterModel(model);
    this.client = client ?? new OpenRouterClient();
    this.model = model;
    this.evaluatorVersion = evaluatorVersion;
    this.timeoutMs = timeoutMs;
    this.schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    this.itemSchema = JSON.parse(readFileSync(itemSchemaPath, 'utf8'));
    this.itemConcurrency = itemConcurrency;
    this.itemEvaluatorVersion = itemEvaluatorVersion;
  }

  async #evaluateItem({
    item,
    candidate,
    temporaryRoot,
    sceneId,
    attempt,
    index,
  }) {
    const candidateMetadata = await sharp(candidate.path).metadata();
    if (!candidateMetadata.width || !candidateMetadata.height) {
      throw new SceneEvaluationInfrastructureError('Scene item evaluator candidate is invalid', {
        code: 'SCENE_ITEM_EVALUATOR_CONTRACT_FAILED',
      });
    }
    const zone = itemDetailZone(item.category, candidateMetadata.height);
    const detailPath = path.join(temporaryRoot, `item-${String(index + 1).padStart(2, '0')}-candidate-zone.jpg`);
    const referencePath = path.join(temporaryRoot, `item-${String(index + 1).padStart(2, '0')}-approved.jpg`);
    const fullPath = path.join(temporaryRoot, `item-${String(index + 1).padStart(2, '0')}-candidate-full.jpg`);
    await Promise.all([
      sharp(candidate.path)
        .rotate()
        .extract({
          left: 0,
          top: zone.top,
          width: candidateMetadata.width,
          height: zone.height,
        })
        .resize({ width: 2048, height: 2048, fit: 'inside' })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
        .toFile(detailPath),
      sharp(item.path)
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
        .toFile(referencePath),
      sharp(candidate.path)
        .rotate()
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toFile(fullPath),
    ]);
    const prompt = itemFidelityPrompt(item);
    assertExternalPromptPrivacy(prompt, { runtimeRoot: temporaryRoot });
    let raw;
    try {
      raw = await this.client.completeWithSchema({
        model: this.model,
        prompt,
        imagePaths: [detailPath, referencePath, fullPath],
        schema: this.itemSchema,
        schemaName: 'scene_item_fidelity',
        reasoningEffort: 'high',
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      throw new SceneEvaluationInfrastructureError(
        `Scene item evaluator execution failed for ${item.item_id}: ${error.message}`,
        { code: 'SCENE_ITEM_EVALUATOR_EXECUTION_FAILED', cause: error },
      );
    }
    let payload;
    try {
      payload = JSON.parse(raw);
      if (!validateItemFidelityOutput(payload)
        || payload.item_id !== item.item_id
        || (payload.verdict === 'PASS' && payload.defects.length !== 0)
        || (payload.verdict === 'REVISE' && payload.defects.length === 0)) {
        throw new Error('item fidelity output failed its strict contract');
      }
    } catch (error) {
      throw new SceneEvaluationInfrastructureError(
        `Scene item evaluator contract failed for ${item.item_id}: ${error.message}`,
        { code: 'SCENE_ITEM_EVALUATOR_CONTRACT_FAILED', cause: error },
      );
    }
    return {
      ...payload,
      item_sha256: item.sha256,
      item_category: item.category,
      item_facts_sha256: approvedItemFactsSha256(item),
      request_id: stableRequestId([
        this.itemEvaluatorVersion,
        this.model,
        sceneId,
        String(attempt),
        candidate.sha256,
        item.sha256,
        item.item_id,
      ]),
    };
  }

  async evaluateScene(context) {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'scene-evaluator-openrouter-'));
    try {
      if (!Array.isArray(context.required_gates)
        || context.required_gates.join(':') !== SCENE_EVALUATOR_GATES.join(':')) {
        throw new Error('Scene evaluator required_gates do not match the six-gate contract');
      }
      const bindings = [
        await verifiedImageBinding(
          { ...context.candidate, role: 'candidate', media_type: 'image/png' },
          'candidate',
          'evaluation attachment 1',
        ),
        await verifiedImageBinding(
          { ...context.approved_look, role: 'look_master', media_type: 'image/png' },
          'look_master',
          'evaluation attachment 2',
        ),
      ];
      const byRole = new Map((context.references ?? []).map((item) => [item.role, item]));
      const references = [];
      for (const [index, role] of SCENE_REFERENCE_ROLES.entries()) {
        references.push(await verifiedSceneReference(byRole.get(role), role, `evaluation reference ${index + 1}`));
      }
      const allItems = await verifiedItemEvidence(context.item_evidence);
      let preset = null;
      if (context.preset?.path) {
        try {
          preset = JSON.parse(await readFile(context.preset.path, 'utf8'));
        } catch (error) {
          throw new Error(`Scene evaluator preset is invalid: ${error.message}`);
        }
      }
      const items = sceneQaItemScope(allItems, preset);
      bindings.push(...references.filter((item) => item.transport === 'image'));
      const prepared = [];
      for (const [index, binding] of bindings.entries()) {
        const filename = path.join(temporaryRoot, `attachment-${String(index + 1).padStart(2, '0')}.jpg`);
        await sharp(binding.path)
          .rotate()
          .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
          .toFile(filename);
        prepared.push(filename);
      }
      const detailSources = [
        { binding: bindings[0], zone: 'upper', label: 'candidate-upper' },
        { binding: bindings[1], zone: 'upper', label: 'approved-upper' },
        { binding: bindings[0], zone: 'lower', label: 'candidate-lower' },
        { binding: bindings[1], zone: 'lower', label: 'approved-lower' },
      ];
      for (const [index, detail] of detailSources.entries()) {
        const metadata = await sharp(detail.binding.path).metadata();
        if (!metadata.width || !metadata.height) {
          throw new Error(`Scene evaluator ${detail.label} detail source is invalid`);
        }
        const top = detail.zone === 'upper' ? 0 : Math.floor(metadata.height * 0.3);
        const height = detail.zone === 'upper'
          ? Math.max(1, Math.ceil(metadata.height * 0.7))
          : metadata.height - top;
        const filename = path.join(
          temporaryRoot,
          `attachment-${String(bindings.length + index + 1).padStart(2, '0')}.jpg`,
        );
        await sharp(detail.binding.path)
          .rotate()
          .extract({ left: 0, top, width: metadata.width, height })
          .resize({ width: 2048, height: 2048, fit: 'inside' })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
          .toFile(filename);
        prepared.push(filename);
      }
      const prompt = evaluatorPrompt(context.delivery, references, preset, items);
      assertExternalPromptPrivacy(prompt, { runtimeRoot: temporaryRoot });
      let raw;
      try {
        raw = await this.client.completeWithSchema({
          model: this.model,
          prompt,
          imagePaths: prepared,
          schema: this.schema,
          schemaName: 'scene_evaluator_output',
          reasoningEffort: 'high',
          timeoutMs: this.timeoutMs,
        });
      } catch (error) {
        throw new SceneEvaluationInfrastructureError(`Scene evaluator execution failed: ${error.message}`, {
          code: 'SCENE_EVALUATOR_EXECUTION_FAILED',
          cause: error,
        });
      }
      let payload;
      try { payload = validateEvaluatorPayload(JSON.parse(raw), context.delivery); } catch (error) {
        throw new SceneEvaluationInfrastructureError(`Scene evaluator contract failed: ${error.message}`, {
          code: 'SCENE_EVALUATOR_CONTRACT_FAILED',
          cause: error,
        });
      }
      const itemResults = await mapWithConcurrency(
        items,
        this.itemConcurrency,
        (item, index) => this.#evaluateItem({
          item,
          candidate: bindings[0],
          temporaryRoot,
          sceneId: context.scene_id,
          attempt: context.attempt,
          index,
        }),
      );
      const itemGate = payload.gates.find((gate) => gate.id === 'ITEM_FIDELITY');
      const itemFailures = itemResults.filter((result) => result.verdict === 'REVISE');
      if (itemFailures.length > 0) {
        itemGate.decision = 'FAIL';
        itemGate.evidence = boundedEvaluationText(
          `Independent forensic item checks rejected ${itemFailures.map((item) => item.item_id).join(', ')}.`,
          1_000,
        );
        itemGate.defects = itemFailures
          .flatMap((item) => (
            item.defects.map((defect) => boundedEvaluationText(`${item.item_id}: ${defect}`, 200))
          ))
          .filter(Boolean)
          .slice(0, 20);
        payload.score = Math.min(payload.score, 60);
        payload.summary = boundedEvaluationText(
          `${payload.summary}; exact product fidelity failed for ${itemFailures.map((item) => item.item_id).join(', ')}`,
          1_000,
        );
      } else if (itemResults.length > 0 && itemGate.decision === 'PASS') {
        itemGate.evidence = boundedEvaluationText(
          `${itemGate.evidence}; independent forensic PASS: ${itemResults.map((item) => item.item_id).join(', ')}`,
          1_000,
        );
      }
      const requestId = stableRequestId([
        this.evaluatorVersion,
        this.model,
        context.scene_id,
        String(context.attempt),
        context.candidate.sha256,
        context.approved_look.sha256,
        ...references.map((item) => item.sha256),
        ...itemResults.flatMap((item) => [
          item.item_sha256,
          item.item_id,
          item.item_category,
          item.item_facts_sha256,
          item.verdict,
          sha256(Buffer.from(JSON.stringify(item.defects))),
        ]),
      ]);
      return {
        ...payload,
        reviewer: {
          type: 'MODEL',
          id: 'openrouter-scene-evaluator',
          version: `${this.evaluatorVersion}+${this.model}`,
          request_id: requestId,
        },
        reference_evidence: referenceEvidence(references),
        item_fidelity_evidence: itemResults,
      };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}
