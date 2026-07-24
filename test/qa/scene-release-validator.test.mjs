import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateScenePrivacy } from '../../tools/validate-scene-privacy.mjs';
import {
  auditQaReceiptEvidence,
  computeReleaseEvidenceSubjectSha256,
  validateSceneRelease,
} from '../../tools/validate-scene-release.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('current mood-card package fails release readiness with named production blockers', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'zeely-scene-release-test-'));
  const privacy = await validateScenePrivacy({ forbidPersonalInput: true });
  const privacyPath = path.join(temp, 'privacy.json');
  await writeFile(privacyPath, `${JSON.stringify(privacy, null, 2)}\n`);

  const result = await validateSceneRelease({ privacyReport: privacyPath });
  const codes = new Set(result.blockers.map((blocker) => blocker.code));
  assert.equal(result.status, 'FAIL');
  assert.equal(result.release_ready, false);
  assert.ok(codes.has('CATALOG_NOT_APPROVED'));
  assert.ok(codes.has('FIVE_PRESET_SELECTION_NOT_APPROVED'));
  assert.ok(codes.has('EDITORIAL_SOURCE_SETS_INCOMPLETE'));
  assert.ok(codes.has('SOURCE_LEDGER_MISSING'));
  assert.ok(codes.has('PRODUCTION_ASSET_COVERAGE_UNVERIFIABLE'));
  assert.ok(codes.has('PER_ASSET_QA_EVIDENCE_MISSING'));
  assert.equal(codes.has('PRIVACY_REPORT_SCHEMA_INVALID'), false);

  const reportSchema = JSON.parse(
    await readFile(
      path.join(root, 'schemas', 'scene-release-readiness-report.schema.json'),
      'utf8',
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(reportSchema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors, null, 2));
});

test('privacy validator covers declared text and image scope and emits schema-valid evidence', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'zeely-scene-privacy-test-'));
  await writeFile(
    path.join(temp, 'safe.json'),
    `${JSON.stringify({ contains_personal_input: false, file: 'assets/scenes/result.webp' })}\n`,
  );
  const result = await validateScenePrivacy({
    scopes: [temp],
    forbidPersonalInput: true,
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.checked_files.length, 1);

  const schema = JSON.parse(
    await readFile(path.join(root, 'schemas', 'scene-privacy-report.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors, null, 2));
});

test('privacy validator reports path, runtime, local URI, secret and personal-input violations without echoing secret values', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'zeely-scene-privacy-leak-test-'));
  const fakeSecret = `sk_live_${'x'.repeat(20)}`;
  await writeFile(
    path.join(temp, 'leak.json'),
    `${JSON.stringify({
      local_path: '/Users/example/private/file.webp',
      runtime_path: 'runtime/runs/private-run/input.webp',
      local_uri: 'file:///Users/example/private/file.webp',
      api_key: fakeSecret,
      contains_personal_input: true,
    })}\n`,
  );
  const result = await validateScenePrivacy({
    scopes: [temp],
    forbidPersonalInput: true,
  });
  const rules = new Set(result.findings.map((finding) => finding.rule));
  assert.equal(result.status, 'FAIL');
  assert.ok(rules.has('NO_ABSOLUTE_USER_PATHS'));
  assert.ok(rules.has('NO_PRIVATE_RUNTIME_PATHS'));
  assert.ok(rules.has('NO_LOCAL_FILE_URIS'));
  assert.ok(rules.has('NO_SECRET_VALUES'));
  assert.ok(rules.has('PERSONAL_INPUT_POLICY'));
  assert.equal(JSON.stringify(result).includes(fakeSecret), false);
});

test('release validator recomputes bbox percentages instead of trusting claimed framing numbers', () => {
  const sha256 = 'a'.repeat(64);
  const gateIds = [
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
  const blockers = auditQaReceiptEvidence(
    {
      assets: [{ asset_id: 'asset.scene.001', sha256 }],
    },
    {
      qa_profile: 'PRODUCTION_SCENE',
      verdict: 'PASS',
      asset_results: [
        {
          asset_id: 'asset.scene.001',
          sha256,
          status: 'PASS',
          framing_evidence: {
            canvas_width: 1024,
            canvas_height: 1280,
            subject_bbox_xywh_px: [200, 103, 620, 700],
            expected_subject_height_percent: [74, 78],
            subject_height_percent: 76,
            minimum_clear_space_above_hair_percent: 8,
            minimum_clear_space_below_footwear_percent: 2,
            clear_space_above_hair_percent: 8.05,
            clear_space_below_footwear_percent: 15.95,
            full_head_visible: true,
            full_footwear_visible: true,
          },
          gate_results: gateIds.map((id) => ({
            id,
            status: 'PASS',
            evidence: 'hash-bound evidence',
          })),
          named_defects: [],
        },
      ],
    },
  );
  assert.ok(
    blockers.some((blocker) => blocker.code === 'FRAMING_EVIDENCE_OUTSIDE_CONTRACT'),
  );
});

test('release evidence subject is stable without creating a QA-receipt hash cycle', () => {
  const baseAsset = {
    asset_id: 'asset.scene.001',
    revision: 1,
    previous_revision: null,
    preset_id: 'std.city.early_morning_gloss',
    preset_version: '1.0.0',
    asset_role: 'production_scene',
    file: 'assets/scenes/scene.webp',
    sha256: 'a'.repeat(64),
    exact_prompt: { path: 'prompts/scenes/scene.txt', sha256: 'b'.repeat(64) },
    generation: { provider_request_id: 'request-1' },
    derivation_lineage: { lineage_id: 'lineage-1' },
    source_ledger: { ledger_id: 'ledger-1' },
    delivery: { width: 1024, height: 1280, format: 'webp', aspect_ratio: '4:5' },
    privacy: {
      contains_personal_input: true,
      privacy_receipt: { path: 'evidence/privacy-a.json', sha256: 'c'.repeat(64) },
    },
    visual_qa: { path: 'evidence/qa-a.json', sha256: 'd'.repeat(64) },
    human_approval: { status: 'PENDING' },
    created_at: '2026-07-23T08:00:00Z',
  };
  const manifest = {
    catalog_snapshot: { catalog_id: 'catalog', catalog_sha256: 'e'.repeat(64) },
    selected_standard_preset_ids: ['std.city.early_morning_gloss'],
    required_asset_roles: ['production_scene'],
    assets: [baseAsset],
  };
  const initial = computeReleaseEvidenceSubjectSha256(manifest);
  const receiptOnlyMutation = structuredClone(manifest);
  receiptOnlyMutation.assets[0].visual_qa = {
    path: 'evidence/qa-b.json',
    sha256: 'f'.repeat(64),
  };
  receiptOnlyMutation.assets[0].human_approval = { status: 'APPROVED' };
  assert.equal(computeReleaseEvidenceSubjectSha256(receiptOnlyMutation), initial);

  const evidenceMutation = structuredClone(manifest);
  evidenceMutation.assets[0].sha256 = '0'.repeat(64);
  assert.notEqual(computeReleaseEvidenceSubjectSha256(evidenceMutation), initial);
});
