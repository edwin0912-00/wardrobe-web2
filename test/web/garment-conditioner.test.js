import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { IMAGE_MODEL_ROUTE } from '../../src/runner/model-policy.js';
import {
  GarmentConditioner,
  GarmentNeedsInputError,
  GarmentRouteExhaustedError,
} from '../../src/web/garment-conditioner.js';

function qa(decision, reason) {
  return {
    decision,
    reason,
    checks: [{ name: 'GARMENT_FIDELITY', pass: decision === 'PASS', score: decision === 'PASS' ? 0.98 : 0.2, evidence: reason }],
    defects: decision === 'PASS' ? [] : [reason],
  };
}

function readyPassport() {
  return {
    status: 'READY',
    reason: 'raw garment evidence is clear',
    items: [{
      source_index: 0,
      category: 'top',
      confidence: 0.98,
      observed: {
        garment_type: 'blue button-up shirt',
        colors: ['blue'],
        material: ['woven cotton'],
        pattern: [],
        logo_text: [],
        construction: ['point collar', 'front buttons'],
      },
      unknowns: [],
      blockers: [],
    }],
    reference_sets: [{ source_indexes: [0], primary_source_index: 0, same_item_confidence: 1, evidence: ['clear front view'] }],
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-garment-conditioner-'));
  const sourcePath = path.join(root, 'raw-shirt.png');
  await sharp({ create: { width: 120, height: 160, channels: 3, background: '#294b80' } }).png().toFile(sourcePath);
  const candidate = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 70, height: 110, channels: 3, background: '#294b80' } }).png().toBuffer(), left: 25, top: 25 }])
    .png().toBuffer();
  return { root, sourcePath, candidate };
}

function conditionerFor({ passport = readyPassport(), decisions, candidate, generatorCalls = [], qaCalls = [] }) {
  const queue = [...decisions];
  return new GarmentConditioner({
    vlm: {
      inspectGarments: async () => passport,
      evaluateQa: async (context) => {
        qaCalls.push(context);
        return queue.shift();
      },
    },
    generator: {
      generateGarment: async (context) => {
        generatorCalls.push(context);
        return { image: candidate, metadata: { provider: 'test-provider' } };
      },
    },
  });
}

test('a REJECT candidate advances to the next fixed image-model route', async () => {
  const { root, sourcePath, candidate } = await fixture();
  const generatorCalls = [];
  const qaCalls = [];
  const conditioner = conditionerFor({
    candidate,
    generatorCalls,
    qaCalls,
    decisions: [
      qa('REJECT', 'first generated candidate is the wrong shirt'),
      qa('PASS', 'second generated candidate matches the raw shirt'),
    ],
  });

  const result = await conditioner.condition({ imagePaths: [sourcePath], outputDirectory: path.join(root, 'conditioned'), runId: 'route-retry' });
  assert.deepEqual(generatorCalls.map((call) => call.model), IMAGE_MODEL_ROUTE.slice(0, 2));
  assert.equal(qaCalls.length, 2);
  assert.equal(result.items[0].attempts.length, 2);
  assert.equal(result.items[0].attempts[0].qa.decision, 'REJECT');
  assert.equal(result.items[0].attempts[0].candidate.path.endsWith('candidate-1.png'), true);
  assert.equal(result.items[0].selected_model, IMAGE_MODEL_ROUTE[1]);
  assert.match(generatorCalls[0].prompt, /ATTACHMENT_1 \[GARMENT_RAW_VIEW_1\]/);
  assert.doesNotMatch(generatorCalls[0].prompt, /\/Users\/|\/tmp\/|\bzeely\b/i);
});

test('canonical item prompt removes private product metadata from extracted locks', async () => {
  const { root, sourcePath, candidate } = await fixture();
  const passport = readyPassport();
  passport.items[0].observed.logo_text = ['ZEELY'];
  passport.items[0].observed.construction.push('/Users/local-user/private/detail.png');
  const generatorCalls = [];
  const conditioner = conditionerFor({
    passport,
    candidate,
    generatorCalls,
    decisions: [qa('PASS', 'candidate matches')],
  });
  await conditioner.condition({ imagePaths: [sourcePath], outputDirectory: path.join(root, 'conditioned'), runId: 'private-locks' });
  assert.match(generatorCalls[0].prompt, /ATTACHED_REFERENCE/);
  assert.doesNotMatch(generatorCalls[0].prompt, /\/Users\/|local-user|\bzeely\b/i);
});

test('exhausted generated-candidate route fails with bounded attempt evidence, not NEEDS_INPUT', async () => {
  const { root, sourcePath, candidate } = await fixture();
  const generatorCalls = [];
  const conditioner = conditionerFor({
    candidate,
    generatorCalls,
    decisions: IMAGE_MODEL_ROUTE.map((_, index) => qa(index % 2 === 0 ? 'REJECT' : 'RETRY', `candidate route failure ${index + 1}`)),
  });

  await assert.rejects(
    () => conditioner.condition({ imagePaths: [sourcePath], outputDirectory: path.join(root, 'conditioned'), runId: 'route-exhausted' }),
    (error) => {
      assert.ok(error instanceof GarmentRouteExhaustedError);
      assert.equal(error instanceof GarmentNeedsInputError, false);
      assert.deepEqual(error.details.route, IMAGE_MODEL_ROUTE);
      assert.equal(error.details.attempts.length, IMAGE_MODEL_ROUTE.length);
      assert.deepEqual(error.details.attempts.map((attempt) => attempt.model), IMAGE_MODEL_ROUTE);
      assert.ok(error.details.attempts.every((attempt) => attempt.candidate.path && attempt.candidate.sha256));
      return true;
    },
  );
  assert.equal(generatorCalls.length, IMAGE_MODEL_ROUTE.length);
});

test('genuinely insufficient raw evidence remains NEEDS_INPUT and does not consume another route', async () => {
  const { root, sourcePath, candidate } = await fixture();
  const generatorCalls = [];
  const conditioner = conditionerFor({
    candidate,
    generatorCalls,
    decisions: [qa('NEEDS_INPUT', 'raw photo is too obscured to establish garment construction')],
  });

  await assert.rejects(
    () => conditioner.condition({ imagePaths: [sourcePath], outputDirectory: path.join(root, 'conditioned'), runId: 'raw-needs-input' }),
    (error) => {
      assert.ok(error instanceof GarmentNeedsInputError);
      assert.equal(error.details.qa.decision, 'NEEDS_INPUT');
      assert.equal(error.details.attempts.length, 1);
      return true;
    },
  );
  assert.equal(generatorCalls.length, 1);
});
