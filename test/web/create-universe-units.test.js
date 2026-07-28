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

  // Verify complete units
  assert.equal(report['shoot.skylight_haze']?.status, 'PRODUCT_READY');
  assert.equal(report['shoot.terracotta_hardlight']?.status, 'PRODUCT_READY');
  assert.equal(report['shoot.window_gobo_warm']?.status, 'PRODUCT_READY');
  assert.equal(report['shoot.grey_studio_stride']?.status, 'PRODUCT_READY');
  assert.equal(report['shoot.sky_dune_surreal']?.status, 'PRODUCT_READY');

  // Verify incomplete male units are strictly classified as ASSETS_ONLY — NOT IN PRODUCT
  assert.equal(report['shoot.ochre_stage_tailoring']?.status, 'ASSETS_ONLY — NOT IN PRODUCT');
  assert.deepEqual(report['shoot.ochre_stage_tailoring']?.missing_sheet_roles, ['colour_grade', 'environment', 'person']);
  assert.equal(report['shoot.ochre_stage_tailoring']?.has_manifest_json, false);

  assert.equal(report['shoot.shutter_amber_interior']?.status, 'ASSETS_ONLY — NOT IN PRODUCT');
  assert.deepEqual(report['shoot.shutter_amber_interior']?.missing_sheet_roles, ['colour_grade', 'environment', 'person']);
  assert.equal(report['shoot.shutter_amber_interior']?.has_manifest_json, false);
});
