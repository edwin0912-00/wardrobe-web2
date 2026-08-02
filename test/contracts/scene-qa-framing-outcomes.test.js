import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { editorialFramingLock } from '../../src/web/scene-contract.js';

const root = path.resolve(import.meta.dirname, '../..');
const schemaPath = path.join(root, 'schemas', 'scene-qa-receipt.schema.json');
const productionGateIds = [
  'MASTER_LOOK_LOCK',
  'REFERENCE_ROLE_ISOLATION',
  'NEAR_COPY_AND_LEAKAGE',
  'IDENTITY',
  'ITEM_FIDELITY',
  'SCENE_MATCH',
  'LIGHT_AND_CONTACT_SHADOW',
  'FRAMING_AND_ANATOMY',
  'PROVENANCE',
];

async function validator() {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  return ajv.compile(schema);
}

function receipt({
  verdict = 'PASS',
  assetStatus = verdict,
  presetId = 'std.city.golden_hour_gloss',
  expectedRange = [70, 80],
  subjectHeight = 76,
  minAbove = 8,
  minBelow = 2,
  clearAbove = 8,
  clearBelow = 2,
  fullHead = true,
  fullFootwear = true,
  gateStatuses = {},
  namedDefects = [],
} = {}) {
  return {
    schema_version: '1.0.0',
    receipt_id: 'receipt.scene.qa.framing.001',
    revision: 1,
    qa_profile: 'PRODUCTION_SCENE',
    evidence_subject_sha256: 'a'.repeat(64),
    reviewer: {
      type: 'MODEL',
      id: 'scene-production-judge',
      version: 'judge-2026-07-23',
    },
    verdict,
    asset_results: [
      {
        asset_id: 'asset.scene.framing.001',
        preset_id: presetId,
        sha256: 'b'.repeat(64),
        status: assetStatus,
        framing_evidence: {
          canvas_width: 1536,
          canvas_height: 2048,
          subject_bbox_xywh_px: [100, 0, 824, 1088],
          expected_subject_height_percent: expectedRange,
          subject_height_percent: subjectHeight,
          minimum_clear_space_above_hair_percent: minAbove,
          minimum_clear_space_below_footwear_percent: minBelow,
          clear_space_above_hair_percent: clearAbove,
          clear_space_below_footwear_percent: clearBelow,
          full_head_visible: fullHead,
          full_footwear_visible: fullFootwear,
        },
        gate_results: productionGateIds.map((id) => ({
          id,
          status: gateStatuses[id] ?? (assetStatus === 'PASS' ? 'PASS' : 'FAIL'),
          evidence: `Measured evidence for ${id}.`,
        })),
        named_defects: namedDefects,
      },
    ],
    completed_at: '2026-07-23T12:00:00Z',
  };
}

function assertInvalid(validate, value, label) {
  assert.equal(validate(value), false, label);
  assert.ok(validate.errors?.length, `${label}: expected validation errors`);
}

test('FAIL receipt preserves honest out-of-range framing evidence', async () => {
  const validate = await validator();
  const failed = receipt({
    verdict: 'FAIL',
    assetStatus: 'FAIL',
    subjectHeight: 85,
    clearAbove: 0,
    clearBelow: 0,
    fullHead: false,
    fullFootwear: false,
    namedDefects: [
      'SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE',
      'INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR',
      'INSUFFICIENT_CLEAR_SPACE_BELOW_FOOTWEAR',
      'FULL_HEAD_NOT_VISIBLE',
      'FULL_FOOTWEAR_NOT_VISIBLE',
    ],
  });

  assert.equal(validate(failed), true, JSON.stringify(validate.errors, null, 2));
});

test('FAIL receipt remains structurally bounded and preset-bound', async () => {
  const validate = await validator();

  assertInvalid(validate, receipt({
    verdict: 'FAIL',
    assetStatus: 'FAIL',
    subjectHeight: 101,
    namedDefects: ['INVALID_MEASUREMENT'],
  }), 'subject height above 100');

  assertInvalid(validate, receipt({
    verdict: 'FAIL',
    assetStatus: 'FAIL',
    clearAbove: -0.01,
    namedDefects: ['INVALID_MEASUREMENT'],
  }), 'negative clear space');

  assertInvalid(validate, receipt({
    verdict: 'FAIL',
    assetStatus: 'FAIL',
    expectedRange: [70, 90],
    subjectHeight: 85,
    namedDefects: ['SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE'],
  }), 'non-canonical expected range');
});

test('PASS receipt accepts exact preset framing contract and ordered PASS gates', async () => {
  const validate = await validator();
  const passed = receipt();

  assert.equal(validate(passed), true, JSON.stringify(validate.errors, null, 2));
});

test('PASS receipt rejects each measured framing violation', async () => {
  const validate = await validator();
  const violations = [
    ['subject below preset range', { subjectHeight: 69.99 }],
    ['subject above preset range', { subjectHeight: 80.01 }],
    ['insufficient space above hair', { clearAbove: 7.99 }],
    ['insufficient space below footwear', { clearBelow: 1.99 }],
    ['cropped head', { fullHead: false }],
    ['cropped footwear', { fullFootwear: false }],
    ['wrong expected preset range', { expectedRange: [73, 79] }],
  ];

  for (const [label, overrides] of violations) {
    assertInvalid(validate, receipt(overrides), label);
  }
});

test('PASS receipt rejects non-PASS, reordered, missing, or duplicated gate evidence', async () => {
  const validate = await validator();

  assertInvalid(validate, receipt({
    gateStatuses: { FRAMING_AND_ANATOMY: 'FAIL' },
  }), 'failed gate');

  const reordered = receipt();
  [
    reordered.asset_results[0].gate_results[0],
    reordered.asset_results[0].gate_results[1],
  ] = [
    reordered.asset_results[0].gate_results[1],
    reordered.asset_results[0].gate_results[0],
  ];
  assertInvalid(validate, reordered, 'reordered gates');

  const missing = receipt();
  missing.asset_results[0].gate_results.pop();
  assertInvalid(validate, missing, 'missing gate');

  const duplicated = receipt();
  duplicated.asset_results[0].gate_results[8] = structuredClone(
    duplicated.asset_results[0].gate_results[0],
  );
  assertInvalid(validate, duplicated, 'duplicated gate');
});

// This test used to assert the editorial contract on the mode id
// editorial.edwin_novak.organic_contrast with a [66, 70] band. No receipt has ever carried
// a bare mode id — the preset id is `<mode_id>.<shot_slot>` — and no code has ever produced
// [66, 70]; the band was hand-written beside a branch that could not match, so the case was
// passing on the standard [74, 78] pins underneath it and the editorial rules it named were
// never exercised. It now asks the slot lock what the bands are.
test('editorial PASS uses the bands its per-shot preset id resolves to', async () => {
  const validate = await validator();
  const slot = 'sculptural_three_quarter';
  const lock = editorialFramingLock(slot);
  const editorial = {
    presetId: `editorial.edwin_novak.organic_contrast.${slot}`,
    expectedRange: [...lock.subject],
    minAbove: lock.above,
    minBelow: lock.below,
    subjectHeight: 92.1875,
    clearAbove: 5.3125,
    clearBelow: 2.5,
  };
  assert.equal(validate(receipt(editorial)), true, JSON.stringify(validate.errors, null, 2));

  assertInvalid(validate, receipt({
    ...editorial,
    subjectHeight: lock.subject[1] + 0.01,
  }), 'editorial subject outside preset range');

  assertInvalid(validate, receipt({
    ...editorial,
    expectedRange: [66, 70],
    subjectHeight: 68,
  }), 'editorial band no lock produces');

  assertInvalid(validate, receipt({
    ...editorial,
    presetId: 'editorial.edwin_novak.organic_contrast',
  }), 'editorial preset id naming no shot slot');

  const editorialFail = receipt({
    ...editorial,
    verdict: 'FAIL',
    assetStatus: 'FAIL',
    subjectHeight: 20,
    clearAbove: 0,
    clearBelow: 0,
    fullHead: false,
    fullFootwear: false,
    namedDefects: ['SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE'],
  });
  assert.equal(validate(editorialFail), true, JSON.stringify(validate.errors, null, 2));
});
