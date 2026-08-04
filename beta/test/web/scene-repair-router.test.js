import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCENE_REPAIR_NODE_GRAPH,
  createDeterministicCropRepairPlan,
  nextConfiguredSceneRepairRoute,
  normalizeSceneDefect,
  planSceneRepair,
  validateSceneRepairPlan,
} from '../../src/web/scene-repair-router.js';

const HASHES = Object.freeze({
  approved_look_sha256: 'a'.repeat(64),
  preset_sha256: 'b'.repeat(64),
  reference_pack_sha256: 'c'.repeat(64),
});

function failure(overrides = {}) {
  return {
    status: 'QA_FAILED',
    gate: 'FRAMING_AND_ANATOMY',
    defect_code: 'SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE',
    preset_id: 'std.city.golden_hour_gloss',
    observed: 65,
    protected_hashes: HASHES,
    candidate_sha256: 'd'.repeat(64),
    prompt_sha256: 'e'.repeat(64),
    attempt: 1,
    cycle: 1,
    ...overrides,
  };
}

test('the executable repair graph is fixed and model-independent', () => {
  assert.deepEqual(
    SCENE_REPAIR_NODE_GRAPH.map((node) => node.id),
    [
      'VLM_OBSERVATION',
      'DETERMINISTIC_QA_LOCK',
      'DEFECT_NORMALIZER',
      'REPAIR_ROUTER',
      'IMMUTABLE_CHECKPOINT',
    ],
  );
});

test('normalization signs only gate, defect, direction, preset, and protected hashes', () => {
  const first = normalizeSceneDefect(failure());
  const changedLineage = normalizeSceneDefect(failure({
    candidate_sha256: 'f'.repeat(64),
    prompt_sha256: '0'.repeat(64),
  }));

  assert.equal(first.version, 'scene-normalized-defect-v1');
  assert.deepEqual(first.delivery_band, [70, 88]);
  assert.equal(first.direction, 'INCREASE_SUBJECT_SCALE');
  assert.equal(first.distance_to_delivery_band_pp, 5);
  assert.equal(first.signature_sha256, changedLineage.signature_sha256);
  assert.notEqual(first.candidate_sha256, changedLineage.candidate_sha256);
  assert.throws(() => normalizeSceneDefect(failure({
    protected_hashes: { candidate_sha256: 'f'.repeat(64) },
  })), /ineligible/);
});

test('a standard 65% frame is a large miss and consumes the next immutable route model', () => {
  const plan = planSceneRepair({
    ...failure(),
    current_route_order: 1,
  });

  assert.equal(plan.classification, 'LARGE_MISS');
  assert.equal(plan.mechanism, 'MECHANICAL_GUIDE');
  assert.equal(plan.model_action, 'NEXT_ROUTE_MODEL');
  assert.match(plan.decision_reason, /NEXT_ROUTE_MODEL/);
  assert.equal(nextConfiguredSceneRepairRoute({ current_route_order: 1 }).job_set_type, 'gpt_image_2');
  assert.equal(validateSceneRepairPlan(plan), plan);
});

test('less than one percentage point progress on the same signature is stalled', () => {
  const previous = normalizeSceneDefect(failure({ observed: 64.4 }));
  const plan = planSceneRepair({
    ...failure({ observed: 65 }),
    current_route_order: 2,
    repair_history: [previous],
  });

  assert.equal(plan.classification, 'STALLED_SAME_MODEL');
  assert.equal(plan.mechanism, 'MECHANICAL_GUIDE');
  assert.equal(plan.model_action, 'NEXT_ROUTE_MODEL');
  assert.equal(plan.progress_pp, 0.6);
  assert.equal(nextConfiguredSceneRepairRoute({ current_route_order: 2 }).job_set_type, 'gpt_image_2');
});

test('a guide that already failed for the same signature requires model fallback', () => {
  const normalized = normalizeSceneDefect(failure({ observed: 64 }));
  const plan = planSceneRepair({
    ...failure({ observed: 64.2 }),
    current_route_order: 2,
    repair_history: [{
      status: 'QA_FAILED',
      mechanism: 'MECHANICAL_GUIDE',
      normalized_defect: normalized,
    }],
  });

  assert.equal(plan.classification, 'MODEL_FALLBACK_REQUIRED');
  assert.equal(plan.mechanism, 'MECHANICAL_GUIDE');
  assert.equal(plan.model_action, 'NEXT_ROUTE_MODEL');
});

test('a first small miss uses bounded VLM repair on the next configured model without a materialized guide', () => {
  const plan = planSceneRepair({
    ...failure({ observed: 69.5 }),
    current_route_order: 1,
  });

  assert.equal(plan.classification, 'SMALL_MISS');
  assert.equal(plan.mechanism, 'VLM_GUIDED_REPAIR');
  assert.equal(plan.model_action, 'NEXT_ROUTE_MODEL');
  assert.equal(plan.guide, null);
  assert.equal(plan.request_manifest, null);
});

test('a deterministic crop repairs for free and does not consume a model route', () => {
  const plan = createDeterministicCropRepairPlan({
    ...failure(),
    framing_evidence: {
      subject_bbox_xywh_px: [100, 200, 1000, 1331],
      expected_subject_height_percent: [70, 80],
      subject_height_percent: 65,
      minimum_clear_space_above_hair_percent: 8,
      minimum_clear_space_below_footwear_percent: 2,
      full_head_visible: true,
      full_footwear_visible: true,
    },
  });

  assert.ok(plan);
  assert.equal(plan.mechanism, 'MECHANICAL_CROP');
  assert.equal(plan.model_action, 'NO_MODEL');
  assert.equal(plan.classification, 'DETERMINISTIC_CROP_AVAILABLE');
});

test('threshold weakening and exhausted route entries are rejected', () => {
  assert.throws(() => normalizeSceneDefect(failure({ delivery_band: [65, 88] })), /immutable preset lock/);
  assert.throws(() => planSceneRepair({ ...failure(), current_route_order: 5 }), /No configured next route model/);
});
