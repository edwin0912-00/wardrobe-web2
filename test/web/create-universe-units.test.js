import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

const REQUIRED_SHEET_ROLES = [
  'camera_lens',
  'blocking',
  'expression_gaze',
  'garment_behaviour',
  'colour_grade',
  'environment',
  'person',
];
const REQUIRED_SHOT_SLOTS = [
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
];
const LEGACY_BLOCKED_SOURCE_IDS = [
];
const PORTFOLIO_READY_IDS = [
  'shoot.skylight_haze',
  'shoot.terracotta_hardlight',
  'shoot.window_gobo_warm',
  'shoot.grey_studio_stride',
  'shoot.sky_dune_surreal',
  'shoot.hardsun_brick_doorway',
  'shoot.overcast_street_stride',
  'shoot.grey_wall_gloss',
  'shoot.ochre_stage_tailoring',
  'shoot.shutter_amber_interior',
  'shoot.zayn_institutional',
  'shoot.liza_luminous',
  'shoot.duckweed_forest_ophelia',
  'shoot.rooftop_veil_monochrome',
  'shoot.autumn_park_mediated_sun',
];
const PORTFOLIO_BLOCKED_SOURCE_IDS = [
  'shoot.hardsun_street_monochrome',
];

function runtimeStyleIsComplete(runtimeStyle) {
  if (!runtimeStyle || typeof runtimeStyle !== 'object') return false;
  const expectedKeys = [
    'visual_system',
    'mood_line',
    'environment',
    'lighting',
    'materials',
    'contrast',
    'expression_signature',
    'garment_behaviour',
    'optical_signature',
    'shot_directions',
  ];
  if (JSON.stringify(Object.keys(runtimeStyle).sort()) !== JSON.stringify(expectedKeys.sort())) {
    return false;
  }
  return Array.isArray(runtimeStyle.materials)
    && runtimeStyle.materials.length > 0
    && Array.isArray(runtimeStyle.optical_signature)
    && runtimeStyle.optical_signature.length > 0
    && REQUIRED_SHOT_SLOTS.every((slot) => {
      const direction = runtimeStyle.shot_directions?.[slot];
      return direction
        && typeof direction.camera_consequence === 'string'
        && typeof direction.pose_joint_chain === 'string'
        && typeof direction.focus === 'string'
        && typeof direction.foreground === 'string'
        && Array.isArray(direction.provenance)
        && direction.provenance.length > 0;
    });
}

test('unrestored mixed-gallery units fail closed', async () => {
  for (const unitId of [...LEGACY_BLOCKED_SOURCE_IDS, ...PORTFOLIO_BLOCKED_SOURCE_IDS]) {
    const directory = path.resolve('docs', 'style-units', unitId);
    const unit = JSON.parse(await readFile(path.join(directory, 'unit.json'), 'utf8'));
    const observation = await readFile(path.join(directory, 'OBSERVATION.md'), 'utf8');

    assert.equal(unit.unit_id, unitId);
    assert.equal(unit.style_unit_status, 'BLOCKED_SOURCE', unitId);
    assert.equal(unit.source_reconciliation?.status, 'BLOCKED_SOURCE', unitId);
    assert.ok(unit.source_reconciliation?.needs_source?.length >= 8, unitId);
    assert.ok(observation.length >= 500, unitId);
    assert.notEqual(
      runtimeStyleIsComplete(unit.runtime_style),
      true,
      `${unitId} must not turn generated sheets into missing source evidence`,
    );
  }
});

test('all restored portfolio shoots are fully bound Creative Universe units', async () => {
  const unitBindings = new Set();

  for (const unitId of PORTFOLIO_READY_IDS) {
    const directory = path.resolve('docs', 'style-units', unitId);
    const [
      unitBytes,
      manifestBytes,
      observationBytes,
      selfVerificationBytes,
      paletteAuthorityBytes,
    ] = await Promise.all([
      readFile(path.join(directory, 'unit.json')),
      readFile(path.join(directory, 'manifest.json')),
      readFile(path.join(directory, 'OBSERVATION.md')),
      readFile(path.join(directory, 'SELF-VERIFY.md')),
      readFile(path.join(directory, 'palette-strip.svg')),
    ]);
    const unit = JSON.parse(unitBytes.toString('utf8'));
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const selfVerification = selfVerificationBytes.toString('utf8');

    assert.equal(unit.unit_id, unitId);
    assert.equal(unit.style_unit_status, 'READY', unitId);
    assert.equal(runtimeStyleIsComplete(unit.runtime_style), true, unitId);
    assert.ok(observationBytes.length >= 500, unitId);
    assert.ok(selfVerificationBytes.length >= 500, unitId);
    assert.match(selfVerification, /^UNIT VERDICT:\s*APPROVED\s*$/im, unitId);
    for (const label of [...REQUIRED_SHEET_ROLES, ...REQUIRED_SHOT_SLOTS]) {
      assert.ok(selfVerification.includes(label), `${unitId}: ${label}`);
    }

    assert.equal(manifest.unit_id, unitId);
    assert.deepEqual(manifest.palette, unit.palette);
    assert.deepEqual(manifest.source_frames, unit.source_frames);
    assert.deepEqual(manifest.unknowns, unit.unknowns);
    assert.ok(manifest.generated_with, unitId);

    const unitContractSha256 = sha256(unitBytes);
    const observationSha256 = sha256(observationBytes);
    const selfVerificationSha256 = sha256(selfVerificationBytes);
    const runtimeStyleSha256 = sha256(Buffer.from(`${JSON.stringify(unit.runtime_style)}\n`));
    const paletteAuthoritySha256 = sha256(paletteAuthorityBytes);
    assert.deepEqual(manifest.unit_contract, {
      path: 'unit.json',
      sha256: unitContractSha256,
    });
    assert.deepEqual(manifest.observation_log, {
      path: 'OBSERVATION.md',
      sha256: observationSha256,
    });
    assert.deepEqual(manifest.self_verification, {
      path: 'SELF-VERIFY.md',
      sha256: selfVerificationSha256,
      status: 'APPROVED',
    });
    assert.deepEqual(manifest.palette_authority, {
      path: 'palette-strip.svg',
      sha256: paletteAuthoritySha256,
      rendered_not_generated: true,
    });
    assert.equal(manifest.runtime_style_sha256, runtimeStyleSha256);

    assert.equal(manifest.sheets.length, REQUIRED_SHEET_ROLES.length, unitId);
    const byRole = new Map(manifest.sheets.map((sheet) => [sheet.sheet_id, sheet]));
    assert.equal(byRole.size, REQUIRED_SHEET_ROLES.length, unitId);
    const sheetBindingLines = [];
    for (const role of REQUIRED_SHEET_ROLES) {
      const sheet = byRole.get(role);
      assert.equal(sheet?.path, `sheet-${role}.png`, `${unitId}: ${role}`);
      const bytes = await readFile(path.join(directory, sheet.path));
      assert.equal(sha256(bytes), sheet.sha256, `${unitId}: ${role}`);
      const providerBound = sheet.provider_receipt?.output_sha256 === sheet.sha256
        && typeof sheet.provider_receipt?.job_id === 'string';
      const legacyBound = sheet.legacy_artifact_receipt?.kind === 'GIT_PRESERVED_GENERATED_ASSET'
        && sheet.legacy_artifact_receipt?.output_sha256 === sheet.sha256
        && /^[a-f0-9]{64}$/.test(sheet.legacy_artifact_receipt?.original_manifest_sha256 ?? '')
        && sheet.legacy_artifact_receipt?.provider_receipt_status === 'UNAVAILABLE_LEGACY';
      assert.equal(providerBound || legacyBound, true, `${unitId}: ${role}`);
      sheetBindingLines.push(`${role}:${sheet.sha256}`);
    }

    const expectedUnitSha256 = sha256(Buffer.from([
      `unit_contract:${unitContractSha256}`,
      `observation_log:${observationSha256}`,
      `self_verification:${selfVerificationSha256}`,
      `runtime_style:${runtimeStyleSha256}`,
      `palette_authority:${paletteAuthoritySha256}`,
      ...sheetBindingLines,
    ].join('\n')));
    assert.equal(manifest.unit_sha256, expectedUnitSha256, unitId);
    assert.equal(unitBindings.has(expectedUnitSha256), false, unitId);
    unitBindings.add(expectedUnitSha256);

    for (const sourceFrame of unit.source_frames) {
      const label = String(sourceFrame).split(/\s+—\s+/, 1)[0].trim();
      assert.ok(observationBytes.toString('utf8').includes(label), `${unitId}: ${label}`);
    }
  }
});
