import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(import.meta.dirname, '../..');
const ATTEMPT_GATE_IDS = [
  'MASTER_LOOK_LOCK',
  'REFERENCE_ROLE_ISOLATION',
  'NEAR_COPY_AND_LEAKAGE',
  'IDENTITY',
  'ITEM_FIDELITY',
  'SCENE_MATCH',
  'LIGHT_AND_CONTACT_SHADOW',
  'FRAMING_AND_ANATOMY',
];
const COMPLETED_GATE_IDS = [...ATTEMPT_GATE_IDS, 'PROVENANCE'];
const SHA256 = 'a'.repeat(64);
const TIMESTAMP = '2026-07-23T08:00:00.000Z';

function gates(ids, failedId = null) {
  return ids.map((id) => ({
    id,
    decision: id === failedId ? 'FAIL' : 'PASS',
    evidence: `Evidence for ${id}.`,
    defects: id === failedId ? [`${id}_DEFECT`] : [],
  }));
}

function passingFraming() {
  return {
    canvas_width: 1024,
    canvas_height: 1280,
    subject_bbox_xywh_px: [202, 104, 620, 973],
    expected_subject_height_percent: [70, 80],
    subject_height_percent: 76.0156,
    minimum_clear_space_above_hair_percent: 8,
    minimum_clear_space_below_footwear_percent: 2,
    clear_space_above_hair_percent: 8.125,
    clear_space_below_footwear_percent: 15.8594,
    full_head_visible: true,
    full_footwear_visible: true,
  };
}

function observedBadFraming() {
  return {
    canvas_width: 1024,
    canvas_height: 1280,
    subject_bbox_xywh_px: [100, 64, 824, 1088],
    expected_subject_height_percent: [70, 80],
    subject_height_percent: 85,
    minimum_clear_space_above_hair_percent: 8,
    minimum_clear_space_below_footwear_percent: 2,
    clear_space_above_hair_percent: 5,
    clear_space_below_footwear_percent: 10,
    full_head_visible: true,
    full_footwear_visible: true,
  };
}

function qa({ decision = 'PASS', gateIds = ATTEMPT_GATE_IDS, failedId = null, framing = passingFraming() } = {}) {
  return {
    decision,
    gates: gates(gateIds, failedId),
    score: decision === 'PASS' ? 100 : 72,
    summary: decision === 'PASS' ? 'All release gates passed.' : 'A blocking visual gate failed.',
    reviewer: {
      type: 'MODEL',
      id: 'scene-evaluator',
      version: '2026-07-23',
      request_id: 'qa-request-1',
    },
    framing_evidence: framing,
  };
}

function attempt({ status = 'QA_PASS', attemptQa = qa() } = {}) {
  return {
    number: 1,
    cycle: 1,
    cycle_attempt: 1,
    status,
    route: {
      order: 1,
      job_set_type: 'gpt_image_2',
      model: 'GPT Image 2',
      model_version: 'gpt_image_2',
      quality: 'high',
    },
    generation_idempotency_key: SHA256,
    started_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    compiled_prompt: null,
    provider_source: null,
    candidate: null,
    provider_metadata: {},
    normalization: null,
    qa_infrastructure_attempts: 0,
    qa: attemptQa,
    error: status === 'QA_FAILED'
      ? { code: 'BLOCKING_QA_FAILED', message: 'FRAMING_AND_ANATOMY' }
      : null,
  };
}

async function validators() {
  const [schema, sourceLedgerSchema] = await Promise.all([
    readFile(path.join(root, 'schemas', 'scene-job.schema.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'schemas', 'scene-source-ledger.schema.json'), 'utf8').then(JSON.parse),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(sourceLedgerSchema);
  ajv.addSchema(schema);
  return {
    validateAttempt: ajv.compile({ $ref: `${schema.$id}#/$defs/attempt` }),
    validateCompletedQa: ajv.compile({ $ref: `${schema.$id}#/$defs/completedQa` }),
  };
}

function validationMessage(validate) {
  return JSON.stringify(validate.errors, null, 2);
}

test('QA_FAILED attempt stores observed out-of-range framing without weakening gate order', async () => {
  const { validateAttempt } = await validators();
  const failed = attempt({
    status: 'QA_FAILED',
    attemptQa: qa({
      decision: 'FAIL',
      failedId: 'FRAMING_AND_ANATOMY',
      framing: observedBadFraming(),
    }),
  });

  assert.equal(validateAttempt(failed), true, validationMessage(validateAttempt));

  const reordered = structuredClone(failed);
  [reordered.qa.gates[3], reordered.qa.gates[4]] = [reordered.qa.gates[4], reordered.qa.gates[3]];
  assert.equal(validateAttempt(reordered), false, 'QA_FAILED gates must retain their canonical order');

  const duplicated = structuredClone(failed);
  duplicated.qa.gates[4] = structuredClone(duplicated.qa.gates[3]);
  assert.equal(validateAttempt(duplicated), false, 'QA_FAILED gates must not contain duplicate gate ids');
});

test('non-final attempt states retain their existing nullable QA contract', async () => {
  const { validateAttempt } = await validators();
  for (const status of [
    'GENERATING',
    'NORMALIZATION_PENDING',
    'QA_PENDING',
    'GENERATION_FAILED',
  ]) {
    const current = attempt();
    current.status = status;
    current.qa = null;
    current.error = status === 'GENERATION_FAILED'
      ? { code: 'PROVIDER_FAILED', message: 'Provider did not return an image.' }
      : null;
    assert.equal(validateAttempt(current), true, `${status}: ${validationMessage(validateAttempt)}`);
  }
});

test('QA_PASS attempt requires exactly eight ordered PASS gates and strict 70-80 framing', async () => {
  const { validateAttempt } = await validators();
  const valid = attempt();
  assert.equal(validateAttempt(valid), true, validationMessage(validateAttempt));

  const badFraming = structuredClone(valid);
  badFraming.qa.framing_evidence = observedBadFraming();
  assert.equal(validateAttempt(badFraming), false, 'QA_PASS must reject observed framing outside 70-80%');

  const failedGate = structuredClone(valid);
  failedGate.qa.gates[4].decision = 'FAIL';
  failedGate.qa.gates[4].defects = ['ITEM_DRIFT'];
  assert.equal(validateAttempt(failedGate), false, 'QA_PASS must reject any FAIL gate');

  const reordered = structuredClone(valid);
  [reordered.qa.gates[2], reordered.qa.gates[3]] = [reordered.qa.gates[3], reordered.qa.gates[2]];
  assert.equal(validateAttempt(reordered), false, 'QA_PASS gates must retain their canonical order');

  const duplicated = structuredClone(valid);
  duplicated.qa.gates[3] = structuredClone(duplicated.qa.gates[2]);
  assert.equal(validateAttempt(duplicated), false, 'QA_PASS gates must not contain duplicate gate ids');
});

test('COMPLETED QA requires exactly nine ordered PASS gates and strict framing', async () => {
  const { validateCompletedQa } = await validators();
  const completed = qa({ gateIds: COMPLETED_GATE_IDS });
  assert.equal(validateCompletedQa(completed), true, validationMessage(validateCompletedQa));

  const badFraming = structuredClone(completed);
  badFraming.framing_evidence.subject_height_percent = 78.0001;
  assert.equal(validateCompletedQa(badFraming), false, 'COMPLETED must reject framing above 78%');

  const failedGate = structuredClone(completed);
  failedGate.gates[8].decision = 'FAIL';
  failedGate.gates[8].defects = ['MISSING_PROVENANCE'];
  assert.equal(validateCompletedQa(failedGate), false, 'COMPLETED must reject any FAIL gate');

  const reordered = structuredClone(completed);
  [reordered.gates[7], reordered.gates[8]] = [reordered.gates[8], reordered.gates[7]];
  assert.equal(validateCompletedQa(reordered), false, 'COMPLETED gates must retain their canonical order');

  const duplicated = structuredClone(completed);
  duplicated.gates[8] = structuredClone(duplicated.gates[7]);
  assert.equal(validateCompletedQa(duplicated), false, 'COMPLETED gates must not contain duplicate gate ids');
});
