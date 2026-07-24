import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(import.meta.dirname, '../..');
const schemaPath = path.join(root, 'schemas', 'scene-preset-catalog.schema.json');
const catalogPath = path.join(root, 'config', 'scene-presets.json');

async function loadCatalog() {
  const [schema, catalog] = await Promise.all([
    readFile(schemaPath, 'utf8').then(JSON.parse),
    readFile(catalogPath, 'utf8').then(JSON.parse),
  ]);
  return { schema, catalog };
}

function compile(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  return ajv.compile(schema);
}

test('launch scene catalog satisfies the strict schema', async () => {
  const { schema, catalog } = await loadCatalog();
  const validate = compile(schema);
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors, null, 2));
});

test('launch catalog has exactly two variants in every standard family', async () => {
  const { catalog } = await loadCatalog();
  const counts = Object.groupBy(catalog.standard_presets, (preset) => preset.family);
  assert.deepEqual(
    Object.fromEntries(Object.entries(counts).map(([family, presets]) => [family, presets.length])),
    {
      city: 2,
      light_studio: 2,
      dramatic_studio: 2,
      interior: 2,
      nature_architecture: 2,
    },
  );
  assert.equal(new Set(catalog.standard_presets.map((preset) => preset.preset_id)).size, 10);
});

test('every standard preset has two role-limited sources and a checked-in exact prompt', async () => {
  const { catalog } = await loadCatalog();
  for (const preset of catalog.standard_presets) {
    assert.ok(preset.source_authorities.length >= 2, preset.preset_id);
    assert.equal(preset.prompt_path, `prompts/scenes/${preset.preset_id}.txt`);
    for (const source of preset.source_authorities) {
      assert.ok(source.not_authority_for.includes('identity'), preset.preset_id);
      assert.ok(source.not_authority_for.includes('outfit'), preset.preset_id);
      assert.ok(source.not_authority_for.includes('exact_architecture'), preset.preset_id);
    }
    await access(path.join(root, preset.prompt_path));
  }
});

test('standard and Edwin editorial namespaces cannot merge implicitly', async () => {
  const { catalog } = await loadCatalog();
  assert.equal(catalog.editorial_program.inherits_standard_automatically, false);
  assert.equal(catalog.editorial_program.modes.length, 4);
  assert.ok(catalog.standard_presets.every((preset) => preset.preset_id.startsWith('std.')));
  assert.ok(catalog.editorial_program.modes.every((mode) => mode.preset_id.startsWith('editorial.edwin_novak.')));
  const expectedEditorialIds = [
    'editorial.edwin_novak.organic_contrast',
    'editorial.edwin_novak.urban_monochrome',
    'editorial.edwin_novak.institutional_modernism',
    'editorial.edwin_novak.luminous_blue_white',
  ];
  assert.deepEqual(catalog.editorial_program.modes.map((mode) => mode.preset_id).sort(), expectedEditorialIds.sort());
  assert.equal(new Set(catalog.editorial_program.modes.map((mode) => mode.preset_id)).size, 4);
  for (const mode of catalog.editorial_program.modes) {
    assert.match(mode.version, /^\d+\.\d+\.\d+$/);
    assert.equal(mode.prompt_path, `prompts/scenes/${mode.preset_id}.txt`);
    for (const source of mode.sources) {
      assert.equal(source.role, 'editorial_style_observation');
      assert.ok(source.not_authority_for.includes('identity'));
      assert.ok(source.not_authority_for.includes('outfit'));
    }
    await access(path.join(root, mode.prompt_path));
  }
});

test('incomplete editorial source sets are explicit and cannot masquerade as release-ready', async () => {
  const { catalog } = await loadCatalog();
  const ready = catalog.editorial_program.modes.filter((mode) => mode.source_set_status === 'READY');
  const blocked = catalog.editorial_program.modes.filter(
    (mode) => mode.source_set_status === 'BLOCKED_MISSING_SECOND_SOURCE',
  );
  assert.equal(ready.length, 2);
  assert.ok(ready.every((mode) => mode.sources.length >= 2));
  assert.deepEqual(
    blocked.map((mode) => mode.preset_id),
    [
      'editorial.edwin_novak.institutional_modernism',
      'editorial.edwin_novak.luminous_blue_white',
    ],
  );
  assert.ok(blocked.every((mode) => mode.sources.length === 1));
  assert.equal(catalog.release_readiness, 'BLOCKED_MISSING_EVIDENCE_AND_PRODUCTION_ASSETS');
});

test('exact prompt inventory has no duplicates or orphan files', async () => {
  const { catalog } = await loadCatalog();
  const expectedPaths = [
    ...catalog.standard_presets.map((preset) => preset.prompt_path),
    ...catalog.editorial_program.modes.map((mode) => mode.prompt_path),
  ].sort();
  assert.equal(new Set(expectedPaths).size, 14);
  const actualPaths = (await readdir(path.join(root, 'prompts', 'scenes')))
    .filter((filename) => filename.endsWith('.txt'))
    .map((filename) => `prompts/scenes/${filename}`)
    .sort();
  assert.deepEqual(actualPaths, expectedPaths);
});

test('candidate cards and post-selection production assets are explicit', async () => {
  const { catalog } = await loadCatalog();
  for (const preset of catalog.standard_presets) {
    assert.deepEqual(preset.mvp_assets, ['mood_card']);
    assert.deepEqual([...preset.post_selection_assets].sort(), ['environment_plate', 'lighting_preview']);
  }
});

test('final framing has one measurable bbox definition for standard and editorial cards', async () => {
  const { catalog } = await loadCatalog();
  const framing = catalog.framing_measurement;
  assert.equal(framing.measurement_basis, 'final_1024x1280_delivery');
  assert.equal(framing.percent_formula, 'subject_bbox_height_px / 1280 * 100');
  assert.deepEqual(framing.standard_subject_height_percent, [74, 78]);
  assert.deepEqual(framing.minimum_clear_space_percent, { above_hair: 8, below_footwear: 2 });
  assert.deepEqual(framing.editorial_subject_height_percent, {
    'editorial.edwin_novak.organic_contrast': [66, 70],
    'editorial.edwin_novak.urban_monochrome': [62, 70],
    'editorial.edwin_novak.institutional_modernism': [64, 72],
    'editorial.edwin_novak.luminous_blue_white': [68, 72],
  });
  for (const preset of catalog.standard_presets) {
    assert.deepEqual(preset.camera.subject_height_percent, framing.standard_subject_height_percent, preset.preset_id);
    assert.deepEqual(
      preset.camera.minimum_clear_space_percent,
      framing.minimum_clear_space_percent,
      preset.preset_id,
    );
    assert.ok(preset.camera.lens_mm >= 45 && preset.camera.lens_mm <= 70, preset.preset_id);
  }
});

test('pipeline, QA gates, locks, provenance fields and shot sequence are exact ordered contracts', async () => {
  const { catalog } = await loadCatalog();
  assert.deepEqual(
    catalog.asset_pipeline.map(({ order, id }) => ({ order, id })),
    [
      { order: 1, id: 'SOURCE_EXTRACTION' },
      { order: 2, id: 'ENVIRONMENT_SPEC' },
      { order: 3, id: 'MOOD_CARD' },
      { order: 4, id: 'HUMAN_APPROVAL' },
      { order: 5, id: 'ENVIRONMENT_PLATE' },
      { order: 6, id: 'LIGHTING_PREVIEW' },
      { order: 7, id: 'REFERENCE_PACK' },
      { order: 8, id: 'PRODUCTION_SCENE' },
      { order: 9, id: 'SCENE_QA' },
    ],
  );
  assert.deepEqual(
    catalog.qa_gates.map((gate) => gate.id),
    [
      'MASTER_LOOK_LOCK',
      'REFERENCE_ROLE_ISOLATION',
      'NEAR_COPY_AND_LEAKAGE',
      'IDENTITY',
      'ITEM_FIDELITY',
      'SCENE_MATCH',
      'LIGHT_AND_CONTACT_SHADOW',
      'FRAMING_AND_ANATOMY',
      'PROVENANCE',
    ],
  );
  assert.deepEqual(catalog.editorial_program.shot_sequence, [
    'clean_identity_hero',
    'environmental_hero',
    'sculptural_three_quarter',
    'interference_frame',
    'material_or_accessory_detail',
    'wide_campaign_coda',
  ]);
  assert.equal(catalog.global_locks.length, 8);
  assert.equal(catalog.reference_policy.forbidden_external_authority_fields.length, 6);
  assert.deepEqual(
    new Set(catalog.reference_policy.release_provenance_fields),
    new Set([
      'sha256',
      'revision',
      'exact_prompt_sha256',
      'model_provider',
      'model_family',
      'model_version',
      'provider_request_id',
      'source_ledger',
      'derivation_lineage',
      'created_at',
      'visual_qa_receipt',
      'human_approval',
    ]),
  );
});

test('strict schema rejects the loopholes that previously produced false green checks', async () => {
  const { schema, catalog } = await loadCatalog();
  const mutations = [
    {
      label: 'duplicate pipeline stage',
      mutate(value) {
        value.asset_pipeline[1] = structuredClone(value.asset_pipeline[0]);
      },
    },
    {
      label: 'duplicate QA gate',
      mutate(value) {
        value.qa_gates[8] = structuredClone(value.qa_gates[0]);
      },
    },
    {
      label: 'missing global lock',
      mutate(value) {
        value.global_locks.pop();
      },
    },
    {
      label: '85 mm lens outside canon',
      mutate(value) {
        value.standard_presets[4].camera.lens_mm = 85;
      },
    },
    {
      label: 'ambiguous old margin tuple',
      mutate(value) {
        delete value.standard_presets[0].camera.minimum_clear_space_percent;
        value.standard_presets[0].camera.head_foot_margin_percent = [2, 6];
      },
    },
    {
      label: 'READY editorial mode with one source',
      mutate(value) {
        value.editorial_program.modes[2].source_set_status = 'READY';
      },
    },
    {
      label: 'duplicate art-fashion shot slot',
      mutate(value) {
        value.editorial_program.shot_sequence[5] = value.editorial_program.shot_sequence[0];
      },
    },
    {
      label: 'approved catalog with pending selection',
      mutate(value) {
        value.status = 'APPROVED';
        value.release_readiness = 'READY_FOR_RELEASE';
      },
    },
    {
      label: 'approved selection while editorial source sets remain incomplete',
      mutate(value) {
        value.status = 'APPROVED';
        value.release_readiness = 'READY_FOR_RELEASE';
        value.launch_selection = {
          status: 'APPROVED',
          selected_preset_ids: [
            'std.city.early_morning_gloss',
            'std.studio.peach_soft_gloss',
            'std.studio.taupe_rembrandt_gloss',
            'std.interior.gallery_morning_gloss',
            'std.nature_architecture.stone_terrace_morning',
          ],
        };
      },
    },
    {
      label: 'approved launch selects two city presets and omits nature architecture',
      mutate(value) {
        value.status = 'APPROVED';
        value.release_readiness = 'READY_FOR_RELEASE';
        value.launch_selection = {
          status: 'APPROVED',
          selected_preset_ids: [
            'std.city.early_morning_gloss',
            'std.city.golden_hour_gloss',
            'std.studio.peach_soft_gloss',
            'std.studio.taupe_rembrandt_gloss',
            'std.interior.gallery_morning_gloss',
          ],
        };
        for (const [index, mode] of value.editorial_program.modes.entries()) {
          if (mode.source_set_status === 'READY') continue;
          mode.source_set_status = 'READY';
          mode.sources.push({
            ...structuredClone(mode.sources[0]),
            url: `https://example.com/synthetic-schema-test-${index}`,
          });
        }
      },
    },
  ];

  for (const { label, mutate } of mutations) {
    const candidate = structuredClone(catalog);
    mutate(candidate);
    const validate = compile(schema);
    assert.equal(validate(candidate), false, `${label} unexpectedly passed schema validation`);
  }
});

test('catalog truthfully records that no launch winners have been approved yet', async () => {
  const { catalog } = await loadCatalog();
  assert.equal(catalog.status, 'DRAFT_FOR_APPROVAL');
  assert.deepEqual(catalog.launch_selection, {
    status: 'PENDING',
    selected_preset_ids: [],
  });
});

test('strict schema has one explicit path from honest draft to fully sourced five-family approval', async () => {
  const { schema, catalog } = await loadCatalog();
  const candidate = structuredClone(catalog);
  candidate.status = 'APPROVED';
  candidate.release_readiness = 'READY_FOR_RELEASE';
  candidate.launch_selection = {
    status: 'APPROVED',
    selected_preset_ids: [
      'std.city.early_morning_gloss',
      'std.studio.peach_soft_gloss',
      'std.studio.taupe_rembrandt_gloss',
      'std.interior.gallery_morning_gloss',
      'std.nature_architecture.stone_terrace_morning',
    ],
  };
  for (const [index, mode] of candidate.editorial_program.modes.entries()) {
    if (mode.source_set_status === 'READY') continue;
    mode.source_set_status = 'READY';
    mode.sources.push({
      ...structuredClone(mode.sources[0]),
      url: `https://example.com/synthetic-schema-test-source-${index}`,
    });
  }
  const validate = compile(schema);
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors, null, 2));
});
