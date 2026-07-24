import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { OpenRouterSceneEvaluator } from '../../src/web/openrouter-scene-evaluator.js';
import { SceneEvaluationInfrastructureError } from '../../src/web/scene-adapters.js';
import {
  SCENE_EVALUATOR_GATES,
  SCENE_REFERENCE_ROLES,
  normalizeEvaluatorResult,
  sha256,
  validateFramingEvidence,
} from '../../src/web/scene-contract.js';

async function imageFile(root, name, { width = 1024, height = 1280, color = '#806050' } = {}) {
  const filename = path.join(root, name);
  const bytes = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  await writeFile(filename, bytes);
  return { path: filename, sha256: sha256(bytes), media_type: 'image/png' };
}

async function contextFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openrouter-scene-evaluator-'));
  const approved = await imageFile(root, 'approved-look.png', { color: '#ddd3c8' });
  const references = [];
  for (const [index, role] of SCENE_REFERENCE_ROLES.entries()) {
    references.push({
      ...(await imageFile(root, `${role}.png`, { color: `#${String(22 + index * 17).repeat(3)}` })),
      role,
      reference_id: `ref-${index + 1}`,
    });
  }
  return { root, approved, references };
}

async function approvedItemEvidenceFixture(root) {
  const definitions = [
    {
      item_id: 'set-0',
      role: 'ITEM_TOP',
      category: 'top',
      color: '#264f3a',
      observed: {
        garment_type: 'hooded sweatshirt',
        colors: ['dark green', 'white', 'red', 'navy'],
        material: ['fleece knit'],
        pattern: ['braided red and navy stripe'],
        logo_text: ['GUCCI', 'FIRENZE', '1921', 'interlocking GG'],
        construction: ['hood', 'drawcords', 'rib cuffs'],
      },
    },
    {
      item_id: 'set-2',
      role: 'ITEM_BAG',
      category: 'bag',
      color: '#dddde2',
      observed: {
        garment_type: 'structured top-handle flap handbag',
        colors: ['light grey', 'silver'],
        material: ['leather', 'metal hardware'],
        pattern: ['repeating M-in-octagon monogram'],
        logo_text: ['M', 'MKM'],
        construction: ['rounded handle', 'front flap', 'oval clasp', 'gusseted sides'],
      },
    },
  ];
  return Promise.all(definitions.map(async (item, index) => ({
    ...item,
    order: index + 1,
    reference_set_id: item.item_id,
    ...(await imageFile(root, `approved-${item.item_id}.png`, { color: item.color })),
  })));
}

function evaluatorPayload() {
  return {
    gates: SCENE_EVALUATOR_GATES.map((id) => ({
      id,
      decision: 'PASS',
      evidence: `${id} visibly verified`,
      defects: [],
    })),
    score: 96,
    summary: 'All six visual gates pass',
    framing_evidence: {
      subject_bbox_xywh_px: [162, 128, 700, 960],
      full_head_visible: true,
      full_footwear_visible: true,
    },
  };
}

function clientFor(payloadOrFn, calls) {
  return {
    completeWithSchema: async (options) => {
      calls.push(options);
      const payload = typeof payloadOrFn === 'function' ? payloadOrFn(options) : payloadOrFn;
      return JSON.stringify(payload);
    },
  };
}

function itemFidelityClient(calls) {
  return {
    completeWithSchema: async (options) => {
      calls.push(options);
      const itemId = /ITEM_ID: ([A-Za-z0-9._-]+)/.exec(options.prompt)?.[1];
      const revise = itemId === 'set-2';
      return JSON.stringify({
        item_id: itemId,
        verdict: revise ? 'REVISE' : 'PASS',
        evidence: revise
          ? 'The generated bag is only category-similar to the approved product.'
          : 'Exact visible product details match the approved reference.',
        matching_features: revise ? ['light grey top-handle silhouette'] : ['all visible locked details'],
        defects: revise
          ? [
            'generic diamond pattern replaced the repeating M-in-octagon monogram',
            'central M/MKM emblem changed',
          ]
          : [],
        confidence: 0.98,
      });
    },
  };
}

test('OpenRouterSceneEvaluator attaches candidate, look and all five roles and returns the exact six-gate service contract', async () => {
  const fixture = await contextFixture();
  const candidate = await imageFile(fixture.root, 'candidate.png', { color: '#b98f72' });
  const calls = [];
  const evaluator = new OpenRouterSceneEvaluator({
    client: clientFor(evaluatorPayload(), calls),
    evaluatorVersion: 'scene-evaluator-openrouter-v1.2.3',
  });
  const result = await evaluator.evaluateScene({
    scene_id: 'scene_or_test',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: {
      aspect_ratio: '4:5',
      width: 1024,
      height: 1280,
      media_type: 'image/png',
      extension: '.png',
      color_space: 'srgb',
    },
  });
  assert.deepEqual(result.gates.map((gate) => gate.id), SCENE_EVALUATOR_GATES);
  assert.equal(calls[0].imagePaths.length, 11);
  assert.equal(calls[0].reasoningEffort, 'high');
  assert.equal(calls[0].model, 'openai/gpt-5.6-terra');
  assert.match(calls[0].prompt, /ATTACHMENT_1 \[GENERATED_SCENE_CANDIDATE\]/);
  assert.match(calls[0].prompt, /ATTACHMENT_7 \[SCENE_NEGATIVE_REFERENCE\]/);
  assert.match(calls[0].prompt, /ATTACHMENT_8 \[CANDIDATE_UPPER_ITEM_DETAIL\]/);
  assert.match(calls[0].prompt, /ATTACHMENT_11 \[APPROVED_LOOK_LOWER_ITEM_DETAIL\]/);
  assert.doesNotMatch(calls[0].prompt, /candidate\.png|approved-look\.png|\/Users\/|\/tmp\//);
  assert.equal(result.reviewer.type, 'MODEL');
  assert.match(result.reviewer.version, /scene-evaluator-openrouter-v1\.2\.3\+openai\/gpt-5\.6-terra/);
  assert.equal(result.reviewer.request_id.length, 64);

  const normalized = normalizeEvaluatorResult(result);
  const framing = validateFramingEvidence(normalized.framing_evidence, {
    width: 1024,
    height: 1280,
    expectedSubjectHeightPercent: [74, 78],
  });
  assert.equal(framing.subject_height_percent, 75);
});

test('OpenRouterSceneEvaluator runs independent per-item forensic checks and blocks a category-similar product', async () => {
  const fixture = await contextFixture();
  const itemEvidence = await approvedItemEvidenceFixture(fixture.root);
  const candidate = await imageFile(fixture.root, 'candidate-item-qa.png', { color: '#b98f72' });
  const mainCalls = [];
  const itemCalls = [];
  const evaluator = new OpenRouterSceneEvaluator({
    client: clientFor(evaluatorPayload(), mainCalls),
  });
  // Item-fidelity calls use a second, dedicated client because the item
  // evaluator's own prompt (ITEM_ID-bearing) differs from the main
  // six-gate prompt.
  evaluator.client = {
    completeWithSchema: async (options) => {
      if (/^Perform one forensic product-fidelity comparison/.test(options.prompt)) {
        return itemFidelityClient(itemCalls).completeWithSchema(options);
      }
      return clientFor(evaluatorPayload(), mainCalls).completeWithSchema(options);
    },
  };
  const result = await evaluator.evaluateScene({
    scene_id: 'scene_or_item_qa',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    item_evidence: itemEvidence,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: {
      aspect_ratio: '4:5',
      width: 1024,
      height: 1280,
      media_type: 'image/png',
      extension: '.png',
      color_space: 'srgb',
    },
  });
  const itemGate = result.gates.find((gate) => gate.id === 'ITEM_FIDELITY');
  assert.equal(itemGate.decision, 'FAIL');
  assert.equal(result.item_fidelity_evidence.length, 2);
  assert.ok(result.item_fidelity_evidence.some((item) => item.item_id === 'set-2' && item.verdict === 'REVISE'));
  assert.ok(itemCalls.every((call) => call.reasoningEffort === 'high' && call.schemaName === 'scene_item_fidelity'));
});

test('OpenRouterSceneEvaluator marks transport and malformed-output failures as QA infrastructure failures', async () => {
  const fixture = await contextFixture();
  const candidate = await imageFile(fixture.root, 'candidate-fail.png', { color: '#b98f72' });
  const context = {
    scene_id: 'scene_or_fail',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: {
      aspect_ratio: '4:5',
      width: 1024,
      height: 1280,
      media_type: 'image/png',
      extension: '.png',
      color_space: 'srgb',
    },
  };
  const executionFailure = new OpenRouterSceneEvaluator({
    client: { completeWithSchema: async () => { throw new Error('network unreachable'); } },
  });
  await assert.rejects(
    () => executionFailure.evaluateScene(context),
    (error) => error instanceof SceneEvaluationInfrastructureError && error.code === 'SCENE_EVALUATOR_EXECUTION_FAILED',
  );

  const contractFailure = new OpenRouterSceneEvaluator({
    client: { completeWithSchema: async () => '{"not":"the right shape"}' },
  });
  await assert.rejects(
    () => contractFailure.evaluateScene(context),
    (error) => error instanceof SceneEvaluationInfrastructureError && error.code === 'SCENE_EVALUATOR_CONTRACT_FAILED',
  );
});

test('OpenRouterSceneEvaluator rejects floating/ambiguous OpenRouter model aliases', () => {
  assert.throws(() => new OpenRouterSceneEvaluator({ client: {}, model: 'openrouter/auto' }), /exact non-ambiguous model id/);
  assert.throws(() => new OpenRouterSceneEvaluator({ client: {}, model: '~anthropic/claude-sonnet-latest' }), /exact non-ambiguous model id/);
});
