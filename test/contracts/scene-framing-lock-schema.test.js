import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { assessSceneFraming, editorialFramingLock, sceneFramingLock } from '../../src/web/scene-contract.js';
import { EDITORIAL_SHOT_SLOTS } from '../../src/web/editorial-shoot-contract.js';
import { renderAllSchemas, framingLockRows } from '../../tools/generate-framing-lock-schema.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const DELIVERY = Object.freeze({ width: 1536, height: 2048 });
const READY_MODE_IDS = Object.freeze([
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
]);
const PRODUCTION_GATE_IDS = Object.freeze([
  'MASTER_LOOK_LOCK',
  'REFERENCE_ROLE_ISOLATION',
  'NEAR_COPY_AND_LEAKAGE',
  'IDENTITY',
  'ITEM_FIDELITY',
  'SCENE_MATCH',
  'LIGHT_AND_CONTACT_SHADOW',
  'FRAMING_AND_ANATOMY',
  'PROVENANCE',
]);

async function schemaValidator(file, pointer = '') {
  const [schema, sourceLedger] = await Promise.all([
    readFile(path.join(root, 'schemas', file), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'schemas', 'scene-source-ledger.schema.json'), 'utf8').then(JSON.parse),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(sourceLedger);
  ajv.addSchema(schema);
  const validate = ajv.getSchema(`${schema.$id}${pointer}`);
  assert.ok(validate, `${file} must expose ${pointer || 'its root'}`);
  return validate;
}

// A frame the lock passes without argument: the subject sits in the middle of its band with
// the headroom the lock asks for. Derived rather than typed out, so a band that moves takes
// the fixture with it instead of leaving a stale one that still happens to validate.
function framedBbox(lock) {
  const middleOfBand = (lock.subject[0] + lock.subject[1]) / 2;
  const height = Math.round(DELIVERY.height * (middleOfBand / 100));
  const top = Math.ceil(DELIVERY.height * (lock.above / 100)) + 1;
  assert.ok(top + height <= DELIVERY.height, 'the derived fixture must fit the canvas');
  return [202, top, 620, height];
}

function assetResult(presetId, framingEvidence, status = 'PASS') {
  return {
    asset_id: 'asset.scene.framing.lock.001',
    preset_id: presetId,
    sha256: 'b'.repeat(64),
    status,
    framing_evidence: framingEvidence,
    gate_results: PRODUCTION_GATE_IDS.map((id) => ({
      id,
      status,
      evidence: `Measured ${id} against the delivered frame.`,
    })),
    named_defects: [],
  };
}

// The runtime writes the evidence; the schema has to accept exactly that and nothing looser.
function measured(presetId, overrides = {}) {
  const assessment = assessSceneFraming({
    subject_bbox_xywh_px: framedBbox(sceneFramingLock(presetId)),
    full_head_visible: true,
    full_footwear_visible: true,
    ...overrides,
  }, { preset: { preset_id: presetId }, ...DELIVERY });
  return assessment;
}

test('every band in the three schemas is the one the framing lock resolver returns', async () => {
  const rows = framingLockRows();
  assert.equal(rows.length, EDITORIAL_SHOT_SLOTS.length + 1);
  for (const file of [
    'scene-qa-receipt.schema.json',
    'scene-job.schema.json',
    'scene-production-receipt.schema.json',
  ]) {
    const schema = JSON.parse(await readFile(path.join(root, 'schemas', file), 'utf8'));
    const defs = schema.$defs?.framingLock?.$defs;
    assert.ok(defs, `${file} must carry a generated framingLock block`);
    rows.forEach(([key, lock], index) => {
      const declared = defs[`declared_${key}`]?.properties;
      assert.ok(declared, `${file} is missing declared_${key}`);
      assert.deepEqual(
        declared.expected_subject_height_percent.const,
        [...lock.subject],
        `${file} declared_${key} subject band`,
      );
      assert.equal(
        declared.minimum_clear_space_above_hair_percent.const,
        lock.above,
        `${file} declared_${key} headroom minimum`,
      );
      assert.equal(
        declared.minimum_clear_space_below_footwear_percent.const,
        lock.below,
        `${file} declared_${key} footwear minimum`,
      );
      const passing = defs.passingEvidenceRows.oneOf[index].properties;
      assert.deepEqual(
        passing.expected_subject_height_percent.const,
        [...lock.subject],
        `${file} passing row ${key} must line up with declared_${key}`,
      );
      assert.equal(passing.subject_height_percent.minimum, lock.subject[0]);
      assert.equal(
        passing.subject_height_percent.maximum,
        lock.deliverySubjectMaximum ?? lock.subject[1],
      );
      assert.equal(
        Object.hasOwn(passing, 'full_footwear_visible'),
        lock.footwear,
        `${file} passing row ${key} footwear requirement`,
      );
    });
  }
});

test('the committed schemas are byte-for-byte what the generator prints', async () => {
  // The drift this catches is not hypothetical: the editorial branches were last written by
  // hand and ended up naming bands ([66, 70] / [62, 70] / [64, 72] / [68, 72]) that no code
  // path had ever produced, under mode ids no receipt carries.
  for (const { file, current, next } of await renderAllSchemas()) {
    assert.equal(
      current,
      next,
      `${path.basename(file)} disagrees with the framing locks — run node tools/generate-framing-lock-schema.mjs`,
    );
  }
});

test('the QA receipt accepts the evidence the runtime writes for all twelve editorial shots', async () => {
  const validate = await schemaValidator('scene-qa-receipt.schema.json', '#/$defs/assetResult');
  for (const modeId of READY_MODE_IDS) {
    for (const slot of EDITORIAL_SHOT_SLOTS) {
      const presetId = `${modeId}.${slot}`;
      const { evidence, defects } = measured(presetId);
      assert.deepEqual(defects, [], `${presetId} fixture must be a passing frame`);
      assert.equal(
        validate(assetResult(presetId, evidence)),
        true,
        `${presetId}: ${JSON.stringify(validate.errors)}`,
      );
    }
  }
});

test('a standard receipt keeps the bands it had before the editorial rows existed', async () => {
  const validate = await schemaValidator('scene-qa-receipt.schema.json', '#/$defs/assetResult');
  const presetId = 'std.city.golden_hour_gloss';
  const { evidence, defects } = measured(presetId);
  assert.deepEqual(defects, []);
  assert.deepEqual(evidence.expected_subject_height_percent, [70, 80]);
  assert.equal(validate(assetResult(presetId, evidence)), true, JSON.stringify(validate.errors));

  for (const [label, mutation] of [
    ['subject under the band', { subject_height_percent: 69.99 }],
    ['subject over the delivery tolerance', {
      subject_height_percent: 88.01,
      subject_height_delivery_tolerance_applied: true,
    }],
    ['headroom under the minimum', { clear_space_above_hair_percent: 7.99 }],
    ['footwear space under the minimum', { clear_space_below_footwear_percent: 1.99 }],
    ['a cropped head', { full_head_visible: false }],
    ['cropped footwear', { full_footwear_visible: false }],
    // The one that matters most: a fitting shot must not reach an art crop's bands by
    // declaring them, or the editorial rows would become an escape hatch for every scene.
    ['an editorial band on a standard shot', {
      expected_subject_height_percent: [50, 94],
      minimum_clear_space_above_hair_percent: 6,
      minimum_clear_space_below_footwear_percent: 0,
    }],
    ['a waived headroom on a standard shot', {
      clear_space_above_hair_waived_by_full_head: true,
    }],
  ]) {
    assert.equal(
      validate(assetResult(presetId, { ...evidence, ...mutation })),
      false,
      `a standard PASS must refuse ${label}`,
    );
  }

  const tolerated = assessSceneFraming({
    subject_bbox_xywh_px: [344, 164, 848, 1762],
    full_head_visible: true,
    full_footwear_visible: true,
  }, { preset: { preset_id: presetId }, ...DELIVERY });
  assert.deepEqual(tolerated.defects, []);
  assert.equal(tolerated.evidence.subject_height_delivery_tolerance_applied, true);
  assert.equal(
    validate(assetResult(presetId, tolerated.evidence)),
    true,
    JSON.stringify(validate.errors),
  );
});

test('a wrong editorial receipt is refused band by band', async () => {
  const validate = await schemaValidator('scene-qa-receipt.schema.json', '#/$defs/assetResult');
  const slot = 'environmental_hero';
  const presetId = `${READY_MODE_IDS[0]}.${slot}`;
  const lock = editorialFramingLock(slot);
  const { evidence } = measured(presetId);
  assert.equal(validate(assetResult(presetId, evidence)), true, JSON.stringify(validate.errors));

  for (const [label, mutation] of [
    ['a band no lock produces', { expected_subject_height_percent: [66, 70] }],
    ['another slot\'s band', { expected_subject_height_percent: [45, 96] }],
    ['a headroom minimum no lock produces', { minimum_clear_space_above_hair_percent: 3 }],
    ['another slot\'s headroom minimum', { minimum_clear_space_above_hair_percent: 4 }],
    ['a footwear minimum this lock does not set', { minimum_clear_space_below_footwear_percent: 2 }],
    ['a subject over its own ceiling', { subject_height_percent: lock.subject[1] + 0.01 }],
    ['a subject under its own floor', { subject_height_percent: lock.subject[0] - 0.01 }],
    ['a claimed waiver it does not need', { clear_space_above_hair_waived_by_full_head: true }],
  ]) {
    assert.equal(
      validate(assetResult(presetId, { ...evidence, ...mutation })),
      false,
      `an editorial PASS must refuse ${label}`,
    );
  }

  // The shape the dead branches were keyed on. Left unpinned it is the one editorial id that
  // would carry no bands at all.
  assert.equal(
    validate(assetResult(READY_MODE_IDS[0], evidence)),
    false,
    'an editorial preset id naming no shot slot must be refused',
  );
  assert.equal(
    validate(assetResult(`${READY_MODE_IDS[0]}.no_such_slot`, evidence)),
    false,
    'an editorial preset id naming an unknown shot slot must be refused',
  );
});

test('an editorial PASS under its headroom minimum has to state the waiver it rests on', async () => {
  const validate = await schemaValidator('scene-qa-receipt.schema.json', '#/$defs/assetResult');
  const presetId = `${READY_MODE_IDS[0]}.clean_identity_hero`;
  const lock = editorialFramingLock(presetId.split('.').pop());
  // The same short-headroom geometry represented on the canonical 1536×2048
  // delivery: 3.2715% against a 6% minimum, with the head observed whole.
  const short = { subject_bbox_xywh_px: [575, 67, 506, 1920] };
  const { evidence, defects } = measured(presetId, short);
  assert.deepEqual(defects, [], 'the waiver must still carry this frame');
  assert.equal(evidence.clear_space_above_hair_percent, 3.2715);
  assert.equal(evidence.minimum_clear_space_above_hair_percent, lock.above);
  assert.equal(evidence.clear_space_above_hair_waived_by_full_head, true);
  assert.equal(validate(assetResult(presetId, evidence)), true, JSON.stringify(validate.errors));

  const unstated = { ...evidence };
  delete unstated.clear_space_above_hair_waived_by_full_head;
  assert.equal(
    validate(assetResult(presetId, unstated)),
    false,
    'a PASS under the headroom minimum must not leave the waiver to be inferred',
  );
  assert.equal(
    validate(assetResult(presetId, { ...evidence, clear_space_above_hair_waived_by_full_head: false })),
    false,
    'a PASS under the headroom minimum cannot deny the waiver it used',
  );
  assert.equal(
    validate(assetResult(presetId, { ...evidence, full_head_visible: false })),
    false,
    'the waiver rests on the whole head, so it cannot outlive the observation',
  );

  // A cropped head is what the waiver is not for, and the runtime says so too.
  const cropped = measured(presetId, { ...short, full_head_visible: false });
  assert.ok(cropped.defects.includes('INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR'));
  assert.equal(cropped.evidence.clear_space_above_hair_waived_by_full_head, false);
  assert.equal(validate(assetResult(presetId, cropped.evidence)), false);
});

test('the job and production receipts carry the same rows at every framing pointer', async () => {
  const cases = [
    ['scene-job.schema.json', '#/$defs/framingEvidence', '#/$defs/passingFramingEvidence'],
    ['scene-production-receipt.schema.json', '#/$defs/observedFramingEvidence', '#/$defs/passingFramingEvidence'],
  ];
  for (const [file, observedPointer, passingPointer] of cases) {
    const observed = await schemaValidator(file, observedPointer);
    const passing = await schemaValidator(file, passingPointer);
    const presetId = `${READY_MODE_IDS[1]}.interference_frame`;
    const { evidence } = measured(presetId);
    assert.equal(observed(evidence), true, `${file} ${observedPointer}: ${JSON.stringify(observed.errors)}`);
    assert.equal(passing(evidence), true, `${file} ${passingPointer}: ${JSON.stringify(passing.errors)}`);
    assert.equal(
      observed({ ...evidence, minimum_clear_space_above_hair_percent: 3 }),
      false,
      `${file} ${observedPointer} must refuse a headroom minimum no lock produces`,
    );
    assert.equal(
      passing({ ...evidence, subject_height_percent: 99 }),
      false,
      `${file} ${passingPointer} must refuse a subject outside the declared band`,
    );
    // The bands are selected by the three numbers the receipt declares, which is what lets
    // them still be checked at a pointer that cannot see which preset the scene used.
    assert.equal(
      observed({ ...evidence, expected_subject_height_percent: [45, 97] }),
      false,
      `${file} ${observedPointer} must refuse a subject band no lock produces`,
    );
  }
});
