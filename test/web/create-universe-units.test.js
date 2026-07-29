import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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

test('audit style units in docs/style-units/ for manifest and sheet completeness', async () => {
  const unitsDir = path.resolve('docs/style-units');
  const entries = await readdir(unitsDir, { withFileTypes: true });
  const unitDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('shoot.')).map((e) => e.name);

  const report = {};

  for (const unitId of unitDirs) {
    const dir = path.join(unitsDir, unitId);
    let unitJson = null;
    let manifestJson = null;

    try {
      unitJson = JSON.parse(await readFile(path.join(dir, 'unit.json'), 'utf8'));
    } catch {
      // unit.json missing
    }

    try {
      manifestJson = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      // manifest.json missing
    }

    const dirFiles = await readdir(dir);
    const existingSheets = dirFiles.filter((f) => f.startsWith('sheet-') && f.endsWith('.png'));

    const missingSheets = [];
    if (manifestJson && Array.isArray(manifestJson.sheets)) {
      const declaredRoles = new Set(manifestJson.sheets.map((s) => s.sheet_id));
      for (const role of REQUIRED_SHEET_ROLES) {
        if (!declaredRoles.has(role)) {
          missingSheets.push(role);
        }
      }
    } else {
      for (const role of REQUIRED_SHEET_ROLES) {
        if (!dirFiles.includes(`sheet-${role}.png`)) {
          missingSheets.push(role);
        }
      }
    }

    const isComplete = Boolean(manifestJson) && missingSheets.length === 0;

    report[unitId] = {
      status: isComplete ? 'PRODUCT_READY' : 'ASSETS_ONLY — NOT IN PRODUCT',
      has_unit_json: Boolean(unitJson),
      has_manifest_json: Boolean(manifestJson),
      existing_sheet_count: existingSheets.length,
      missing_sheet_roles: missingSheets,
    };
  }

  // Every selectable Fashion Shoot is a complete Creative Universe unit. Do
  // not silently publish a directory that has only a mood card or observation.
  const selectableFashionShootIds = [
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
  ];
  assert.equal(selectableFashionShootIds.length, 10);
  for (const unitId of selectableFashionShootIds) {
    assert.equal(report[unitId]?.status, 'PRODUCT_READY', unitId);
    assert.deepEqual(report[unitId]?.missing_sheet_roles, [], unitId);
  }

  // The two male units were completed in BETA-MALE-UNITS-001 (5a70860: full sheet
  // sets + hashed manifests, live since 58703b9) and are product styles now.
  assert.equal(report['shoot.ochre_stage_tailoring']?.has_manifest_json, true);
  assert.equal(report['shoot.shutter_amber_interior']?.has_manifest_json, true);
});
