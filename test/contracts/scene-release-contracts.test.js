import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(import.meta.dirname, '../..');
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);
const authorityExclusions = [
  'identity',
  'body',
  'hair',
  'outfit',
  'brands',
  'readable_text',
  'exact_architecture',
];

async function loadSchemas() {
  const names = [
    'scene-source-ledger.schema.json',
    'scene-release-manifest.schema.json',
    'scene-qa-receipt.schema.json',
    'scene-privacy-report.schema.json',
  ];
  return Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(path.join(root, 'schemas', name), 'utf8')),
    ),
  );
}

async function validators() {
  const schemas = await loadSchemas();
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  schemas.forEach((schema) => ajv.addSchema(schema));
  return Object.fromEntries(
    schemas.map((schema) => [schema.$id, ajv.getSchema(schema.$id)]),
  );
}

function validSourceLedger() {
  return {
    schema_version: '1.0.0',
    ledger_id: 'ledger.scene.city.001',
    revision: 1,
    preset_id: 'std.city.early_morning_gloss',
    preset_version: '1.0.0',
    status: 'VERIFIED_FOR_RELEASE',
    sources: [
      {
        source_id: 'source.city.primary',
        url: 'https://example.com/source-a',
        role: 'environment_and_composition_inspiration',
        use: 'street scale and calm vanishing-point observations only',
        not_authority_for: authorityExclusions,
        retrieved_at: '2026-07-23T08:00:00Z',
        snapshot_uri: 'evidence/sources/source-a.html',
        content_sha256: hashA,
        rights: {
          status: 'VERIFIED',
          basis: 'LICENSED',
          rights_holder: 'Example Licensor',
          evidence_uri: 'evidence/rights/source-a.json',
          evidence_sha256: hashB,
          verified_at: '2026-07-23T08:01:00Z',
        },
      },
      {
        source_id: 'source.city.secondary',
        url: 'https://example.com/source-b',
        role: 'environment_material_inspiration',
        use: 'secondary stone material and neutral facade rhythm only',
        not_authority_for: authorityExclusions,
        retrieved_at: '2026-07-23T08:02:00Z',
        snapshot_uri: 'evidence/sources/source-b.html',
        content_sha256: hashB,
        rights: {
          status: 'VERIFIED',
          basis: 'OWNED',
          rights_holder: 'Zeely',
          evidence_uri: 'evidence/rights/source-b.json',
          evidence_sha256: hashC,
          verified_at: '2026-07-23T08:03:00Z',
        },
      },
    ],
    created_at: '2026-07-23T08:04:00Z',
  };
}

function validReleaseManifest() {
  return {
    schema_version: '1.0.0',
    release_id: 'scene.release.launch.001',
    revision: 1,
    release_status: 'APPROVED',
    evidence_subject_sha256: hashA,
    catalog_snapshot: {
      catalog_id: 'zeely.scene-presets.launch-v0.1',
      catalog_sha256: hashA,
      catalog_status: 'APPROVED',
    },
    selection_receipt: {
      status: 'PASS',
      path: 'evidence/selection.json',
      sha256: hashB,
    },
    selected_standard_preset_ids: [
      'std.city.early_morning_gloss',
      'std.studio.peach_soft_gloss',
      'std.studio.taupe_rembrandt_gloss',
      'std.interior.gallery_morning_gloss',
      'std.nature_architecture.stone_terrace_morning',
    ],
    required_asset_roles: [
      'mood_card',
      'environment_plate',
      'lighting_preview',
      'reference_pack',
      'production_scene',
    ],
    asset_count: 1,
    assets: [
      {
        asset_id: 'asset.scene.city.001',
        revision: 1,
        previous_revision: null,
        preset_id: 'std.city.early_morning_gloss',
        preset_version: '1.0.0',
        asset_role: 'production_scene',
        file: 'assets/scenes/city-001.webp',
        sha256: hashC,
        exact_prompt: {
          path: 'prompts/scenes/city-001.txt',
          sha256: hashA,
        },
        generation: {
          provider: 'openai',
          model_family: 'gpt-image-2',
          model_version: 'gpt-image-2-2026-04-21',
          provider_request_id: 'request_scene_001',
          provider_receipt: {
            path: 'evidence/provider/request-scene-001.json',
            sha256: hashB,
          },
          parameters: { width: 1024, height: 1280, quality: 'high' },
        },
        derivation_lineage: {
          lineage_id: 'lineage.scene.city.001',
          revision: 1,
          operations: [
            {
              operation_id: 'generate.001',
              type: 'GENERATE',
              input_sha256s: [],
              output_sha256: hashC,
              prompt_sha256: hashA,
              prompt_path: 'prompts/scenes/city-001.txt',
              provider_request_id: 'request_scene_001',
              parameters: { width: 1024, height: 1280 },
              created_at: '2026-07-23T08:05:00Z',
            },
          ],
        },
        source_ledger: validSourceLedger(),
        delivery: {
          width: 1024,
          height: 1280,
          format: 'webp',
          aspect_ratio: '4:5',
        },
        privacy: {
          contains_personal_input: true,
          privacy_receipt: {
            status: 'PASS',
            path: 'evidence/privacy.json',
            sha256: hashB,
          },
        },
        visual_qa: {
          status: 'PASS',
          path: 'evidence/visual-qa.json',
          sha256: hashC,
        },
        human_approval: {
          status: 'APPROVED',
          receipt_path: 'evidence/human-approval.json',
          receipt_sha256: hashA,
          decided_at: '2026-07-23T08:06:00Z',
        },
        created_at: '2026-07-23T08:05:00Z',
      },
    ],
    created_at: '2026-07-23T08:07:00Z',
  };
}

function validQaReceipt() {
  return {
    schema_version: '1.0.0',
    receipt_id: 'receipt.scene.qa.001',
    revision: 1,
    qa_profile: 'PRODUCTION_SCENE',
    evidence_subject_sha256: hashA,
    reviewer: {
      type: 'MODEL',
      id: 'scene-production-judge',
      version: 'judge-2026-07-23',
    },
    verdict: 'PASS',
    asset_results: [
      {
        asset_id: 'asset.scene.city.001',
        preset_id: 'std.city.early_morning_gloss',
        sha256: hashC,
        status: 'PASS',
        framing_evidence: {
          canvas_width: 1024,
          canvas_height: 1280,
          subject_bbox_xywh_px: [200, 103, 620, 973],
          expected_subject_height_percent: [74, 78],
          subject_height_percent: 76.02,
          minimum_clear_space_above_hair_percent: 8,
          minimum_clear_space_below_footwear_percent: 2,
          clear_space_above_hair_percent: 8.05,
          clear_space_below_footwear_percent: 15.94,
          full_head_visible: true,
          full_footwear_visible: true,
        },
        gate_results: [
          'MASTER_LOOK_LOCK',
          'REFERENCE_ROLE_ISOLATION',
          'NEAR_COPY_AND_LEAKAGE',
          'IDENTITY',
          'ITEM_FIDELITY',
          'SCENE_MATCH',
          'LIGHT_AND_CONTACT_SHADOW',
          'FRAMING_AND_ANATOMY',
          'PROVENANCE',
        ].map((id) => ({
          id,
          status: 'PASS',
          evidence: `Verified ${id} against immutable release evidence.`,
        })),
        named_defects: [],
      },
    ],
    completed_at: '2026-07-23T08:08:00Z',
  };
}

function validPrivacyReport() {
  return {
    schema_version: '1.0.0',
    status: 'PASS',
    scope: ['assets/scenes'],
    excluded_paths: [],
    checked_rules: [
      'NO_ABSOLUTE_USER_PATHS',
      'NO_PRIVATE_RUNTIME_PATHS',
      'NO_SECRET_VALUES',
      'NO_LOCAL_FILE_URIS',
      'PERSONAL_INPUT_POLICY',
    ],
    checked_files: [
      {
        path: 'assets/scenes/city-001.webp',
        sha256: hashC,
        inspection: 'IMAGE_METADATA',
      },
    ],
    findings: [],
    completed_at: '2026-07-23T08:09:00Z',
  };
}

test('release, source-ledger, QA and privacy schemas accept complete hash-bound evidence', async () => {
  const byId = await validators();
  const values = [
    ['https://zeely.ai/schemas/scene-source-ledger.schema.json', validSourceLedger()],
    ['https://zeely.ai/schemas/scene-release-manifest.schema.json', validReleaseManifest()],
    ['https://zeely.ai/schemas/scene-qa-receipt.schema.json', validQaReceipt()],
    ['https://zeely.ai/schemas/scene-privacy-report.schema.json', validPrivacyReport()],
  ];
  for (const [id, value] of values) {
    const validate = byId[id];
    assert.equal(validate(value), true, `${id}\n${JSON.stringify(validate.errors, null, 2)}`);
  }
});

test('release contract rejects moving model aliases and unsplit legacy approval', async () => {
  const byId = await validators();
  const validate = byId['https://zeely.ai/schemas/scene-release-manifest.schema.json'];
  const manifest = validReleaseManifest();
  manifest.assets[0].generation.model_version = 'builtin-current';
  manifest.assets[0].approval = 'PASS';
  assert.equal(validate(manifest), false);
  assert.ok(
    validate.errors.some(
      (error) =>
        error.instancePath.includes('/generation/model_version') ||
        error.keyword === 'additionalProperties',
    ),
    JSON.stringify(validate.errors, null, 2),
  );
});

test('source ledger cannot claim release readiness without verified rights evidence', async () => {
  const byId = await validators();
  const validate = byId['https://zeely.ai/schemas/scene-source-ledger.schema.json'];
  const ledger = validSourceLedger();
  ledger.sources[0].rights.status = 'UNVERIFIED';
  delete ledger.sources[1].content_sha256;
  assert.equal(validate(ledger), false);
});

test('approved release requires split PASS visual and APPROVED human receipts', async () => {
  const byId = await validators();
  const validate = byId['https://zeely.ai/schemas/scene-release-manifest.schema.json'];
  const manifest = validReleaseManifest();
  manifest.assets[0].visual_qa.status = 'FAIL';
  manifest.assets[0].human_approval = { status: 'PENDING' };
  assert.equal(validate(manifest), false);
});

test('release manifest rejects family-skewed selection and path traversal', async () => {
  const byId = await validators();
  const validate = byId['https://zeely.ai/schemas/scene-release-manifest.schema.json'];
  const manifest = validReleaseManifest();
  manifest.selected_standard_preset_ids = [
    'std.city.early_morning_gloss',
    'std.city.golden_hour_gloss',
    'std.studio.peach_soft_gloss',
    'std.studio.taupe_rembrandt_gloss',
    'std.interior.gallery_morning_gloss',
  ];
  manifest.assets[0].file = '../private/result.webp';
  assert.equal(validate(manifest), false);
});

test('QA receipt rejects duplicated or reordered gate evidence', async () => {
  const byId = await validators();
  const validate = byId['https://zeely.ai/schemas/scene-qa-receipt.schema.json'];
  const receipt = validQaReceipt();
  receipt.asset_results[0].gate_results[8] = {
    ...receipt.asset_results[0].gate_results[0],
  };
  assert.equal(validate(receipt), false);
});

test('PASS QA receipt rejects failed gates, reversed ranges and margins below canon', async () => {
  const byId = await validators();
  const validate = byId['https://zeely.ai/schemas/scene-qa-receipt.schema.json'];

  const failedGates = validQaReceipt();
  for (const gate of failedGates.asset_results[0].gate_results) {
    gate.status = 'FAIL';
  }
  assert.equal(validate(failedGates), false);

  const reversedRange = validQaReceipt();
  reversedRange.asset_results[0].framing_evidence.expected_subject_height_percent = [78, 74];
  assert.equal(validate(reversedRange), false);

  const insufficientMargins = validQaReceipt();
  insufficientMargins.asset_results[0].framing_evidence.clear_space_above_hair_percent = 7.99;
  insufficientMargins.asset_results[0].framing_evidence.clear_space_below_footwear_percent = 1.99;
  assert.equal(validate(insufficientMargins), false);
});
