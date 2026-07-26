import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  assessSceneFraming,
  editorialFramingLock,
  sceneFramingLock,
} from '../../src/web/scene-contract.js';

const root = path.resolve(import.meta.dirname, '../..');
const WEB_ROOT = path.join(root, 'src', 'web');
const EDITORIAL_MODE_IDS = [
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
];
const EDITORIAL_SHOT_SLOTS = [
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
];
// The four framing assessments used to source their options from three different
// places, so a rule could reach some of them and not the others. These are the names
// only the one owner is allowed to spell now; finding any of them in a second module
// means a framing verdict has grown a second definition again.
const LOCK_OPTION_NAMES = [
  'expectedSubjectHeightPercent',
  'minimumAboveHairPercent',
  'minimumBelowFootwearPercent',
  'aboveIsAdvisoryWhenHeadVisible',
];
// aboveIsAdvisoryWhenHeadVisible is also the name of a field in the lock tables
// themselves, which is where the rule belongs, so the single-mention check inside
// scene-contract.js can only cover the three names that exist purely as call options.
const CALL_OPTION_NAMES = LOCK_OPTION_NAMES
  .filter((option) => option !== 'aboveIsAdvisoryWhenHeadVisible');
// The measured frame of scene_13313d49: 3.2813% of headroom against the identity
// hero's 6% minimum, head observed whole, everything else inside the lock.
const WAIVED_EDITORIAL_FRAME = Object.freeze({
  subject_bbox_xywh_px: [383, 42, 337, 1200],
  full_head_visible: true,
  full_footwear_visible: true,
});
const DELIVERY = Object.freeze({ width: 1024, height: 1280 });

// The expression scene-service.js built by hand before the collapse, kept as the
// oracle: the owner may only replace it if it reproduces it for every preset that
// exists, standard and editorial.
function handBuiltLockOptions(preset) {
  return {
    subject: [...preset.camera.subject_height_percent],
    above: preset.camera.minimum_clear_space_percent?.above_hair ?? 8,
    below: preset.camera.minimum_clear_space_percent?.below_footwear ?? 2,
    head: preset.camera.required_visibility?.full_head ?? true,
    footwear: preset.camera.required_visibility?.full_footwear ?? true,
    aboveIsAdvisoryWhenHeadVisible: Boolean(preset.editorial),
  };
}

function resolvedOptions(preset) {
  const lock = sceneFramingLock(preset);
  return {
    subject: [...lock.subject],
    above: lock.above,
    below: lock.below,
    head: lock.head,
    footwear: lock.footwear,
    aboveIsAdvisoryWhenHeadVisible: lock.aboveIsAdvisoryWhenHeadVisible === true,
  };
}

function declaredFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must still exist`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${signature} must be a complete declaration`);
  return source.slice(start, end + 3);
}

function standardFramingEvidence(overrides = {}) {
  return {
    canvas_width: 1024,
    canvas_height: 1280,
    subject_bbox_xywh_px: [202, 104, 620, 973],
    expected_subject_height_percent: [74, 78],
    subject_height_percent: 76.0156,
    minimum_clear_space_above_hair_percent: 8,
    minimum_clear_space_below_footwear_percent: 2,
    clear_space_above_hair_percent: 8.125,
    clear_space_below_footwear_percent: 15.8594,
    full_head_visible: true,
    full_footwear_visible: true,
    ...overrides,
  };
}

async function subschemaValidator(schemaFile, pointer) {
  const [schema, sourceLedgerSchema] = await Promise.all([
    readFile(path.join(root, 'schemas', schemaFile), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'schemas', 'scene-source-ledger.schema.json'), 'utf8').then(JSON.parse),
  ]);
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  ajv.addSchema(sourceLedgerSchema);
  ajv.addSchema(schema);
  const validate = ajv.getSchema(`${schema.$id}${pointer}`);
  assert.ok(validate, `${schemaFile} must expose ${pointer}`);
  return validate;
}

test('the framing lock owner reproduces the hand-built options for every catalog preset', async () => {
  const catalog = path.join(root, 'assets', 'scene-presets');
  const presetIds = [];
  const families = (await readdir(catalog, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const family of families) {
    for (const version of await readdir(path.join(catalog, family))) {
      const preset = JSON.parse(
        await readFile(path.join(catalog, family, version, 'preset.json'), 'utf8'),
      );
      assert.deepEqual(resolvedOptions(preset), handBuiltLockOptions(preset), preset.preset_id);
      presetIds.push(preset.preset_id);
    }
  }
  assert.ok(presetIds.length >= 5, `expected the standard catalog, got ${presetIds.length} presets`);
});

test('the framing lock owner reproduces them for every compiled editorial shot', () => {
  for (const modeId of EDITORIAL_MODE_IDS) {
    for (const slot of EDITORIAL_SHOT_SLOTS) {
      const lock = editorialFramingLock(slot);
      // The camera block compileEditorialShotPack writes, and which
      // validateEditorialPresetSnapshot refuses to let drift from the slot lock.
      const compiled = {
        preset_id: `${modeId}.${slot}`,
        editorial: { mode_id: modeId, shot_slot: slot },
        camera: {
          subject_height_percent: [...lock.subject],
          minimum_clear_space_percent: { above_hair: lock.above, below_footwear: lock.below },
          required_visibility: { full_head: lock.head, full_footwear: lock.footwear },
        },
      };
      assert.deepEqual(
        resolvedOptions(compiled),
        handBuiltLockOptions(compiled),
        compiled.preset_id,
      );
      assert.equal(
        sceneFramingLock(compiled).aboveIsAdvisoryWhenHeadVisible,
        true,
        `${compiled.preset_id} must keep its headroom waiver`,
      );
    }
  }
});

test('a preset without an id cannot resolve a framing lock at all', () => {
  // Silently answering with the standard lock is how an editorial shot would get judged
  // as a fitting shot: [74, 78] with footwear required, on an art crop.
  assert.throws(() => sceneFramingLock({}), /requires a preset carrying its preset_id/);
  assert.throws(() => sceneFramingLock(undefined), /requires a preset carrying its preset_id/);
});

test('no module outside the framing lock owner may build assessment options', async () => {
  const modules = (await readdir(WEB_ROOT))
    .filter((name) => name.endsWith('.js') && name !== 'scene-contract.js');
  assert.ok(modules.includes('scene-service.js'), 'the live QA path must be in scope');
  for (const name of modules) {
    const source = await readFile(path.join(WEB_ROOT, name), 'utf8');
    assert.ok(
      !source.includes('assessFramingEvidence'),
      `${name} must reach the lock through assessSceneFraming, not the measurement primitive`,
    );
    for (const option of LOCK_OPTION_NAMES) {
      assert.ok(
        !source.includes(option),
        `${name} must not restate the ${option} framing lock`,
      );
    }
  }
});

test('inside the owner the framing lock options are spelled in exactly one place', async () => {
  const source = await readFile(path.join(WEB_ROOT, 'scene-contract.js'), 'utf8');
  const entryPoint = declaredFunction(source, 'export function assessSceneFraming(');
  const primitive = declaredFunction(source, 'export function assessFramingEvidence(');
  const elsewhere = source.replace(entryPoint, '').replace(primitive, '');
  for (const option of CALL_OPTION_NAMES) {
    assert.ok(entryPoint.includes(option), `assessSceneFraming must resolve ${option}`);
    assert.ok(
      !elsewhere.includes(option),
      `${option} is stated a second time in scene-contract.js`,
    );
  }
});

test('an editorial receipt states the headroom waiver instead of leaving it to be inferred', () => {
  const waived = assessSceneFraming(WAIVED_EDITORIAL_FRAME, {
    preset: { preset_id: `${EDITORIAL_MODE_IDS[0]}.clean_identity_hero` },
    ...DELIVERY,
  });
  assert.equal(waived.evidence.clear_space_above_hair_percent, 3.2813);
  assert.equal(waived.evidence.minimum_clear_space_above_hair_percent, 6);
  assert.equal(waived.evidence.clear_space_above_hair_waived_by_full_head, true);
  assert.deepEqual(waived.defects, []);

  // The waiver rests on the observation, so it disappears with it — and says so.
  const cropped = assessSceneFraming(
    { ...WAIVED_EDITORIAL_FRAME, full_head_visible: false },
    { preset: { preset_id: `${EDITORIAL_MODE_IDS[0]}.clean_identity_hero` }, ...DELIVERY },
  );
  assert.equal(cropped.evidence.clear_space_above_hair_waived_by_full_head, false);
  assert.ok(cropped.defects.includes('INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR'));

  // A standard scene has no waiver to state: headroom there is the product.
  const standard = assessSceneFraming({
    subject_bbox_xywh_px: [202, 64, 620, 973],
    full_head_visible: true,
    full_footwear_visible: true,
  }, { preset: { preset_id: 'std.city.golden_hour_gloss' }, ...DELIVERY });
  assert.equal(standard.evidence.clear_space_above_hair_waived_by_full_head, false);
  assert.ok(standard.defects.includes('INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR'));
});

test('the receipt reports the waiver the assessment found, never one the evaluator claims', () => {
  const claimed = assessSceneFraming({
    subject_bbox_xywh_px: [202, 128, 620, 973],
    full_head_visible: true,
    full_footwear_visible: true,
    clear_space_above_hair_waived_by_full_head: true,
  }, { preset: { preset_id: 'std.city.golden_hour_gloss' }, ...DELIVERY });
  assert.deepEqual(claimed.defects, []);
  assert.equal(claimed.evidence.clear_space_above_hair_waived_by_full_head, false);
});

test('all three receipt schemas accept the waiver flag and refuse it on the standard path', async () => {
  const jobFraming = await subschemaValidator(
    'scene-job.schema.json',
    '#/$defs/framingEvidence',
  );
  const productionFraming = await subschemaValidator(
    'scene-production-receipt.schema.json',
    '#/$defs/observedFramingEvidence',
  );
  for (const [label, validate] of [['job', jobFraming], ['production', productionFraming]]) {
    assert.equal(
      validate(standardFramingEvidence({ clear_space_above_hair_waived_by_full_head: false })),
      true,
      `${label}: ${JSON.stringify(validate.errors)}`,
    );
    // Receipts written before the waiver was stated omit the flag entirely.
    assert.equal(validate(standardFramingEvidence()), true, `${label}: legacy receipt`);
    assert.equal(
      validate(standardFramingEvidence({ clear_space_above_hair_waived_by_full_head: true })),
      false,
      `${label}: a standard scene must not ship a waived headroom`,
    );
  }

  const assetResult = await subschemaValidator(
    'scene-qa-receipt.schema.json',
    '#/$defs/assetResult',
  );
  const result = (presetId, framingOverrides) => ({
    asset_id: 'asset.scene.framing.waiver.001',
    preset_id: presetId,
    sha256: 'b'.repeat(64),
    status: 'PASS',
    framing_evidence: standardFramingEvidence(framingOverrides),
    gate_results: [
      { id: 'FRAMING_AND_ANATOMY', status: 'PASS', evidence: 'Measured framing evidence.' },
    ],
    named_defects: [],
  });
  assert.equal(
    assetResult(result('std.city.golden_hour_gloss', {
      clear_space_above_hair_waived_by_full_head: false,
    })),
    true,
    JSON.stringify(assetResult.errors),
  );
  assert.equal(
    assetResult(result('std.city.golden_hour_gloss', {
      clear_space_above_hair_waived_by_full_head: true,
    })),
    false,
    'a standard scene must not ship a waived headroom',
  );
  assert.equal(
    assetResult(result(`${EDITORIAL_MODE_IDS[0]}.clean_identity_hero`, {
      clear_space_above_hair_waived_by_full_head: true,
    })),
    true,
    JSON.stringify(assetResult.errors),
  );
});
