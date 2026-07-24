#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const root = process.cwd();
const catalogPath = path.join(root, 'config', 'scene-presets.json');
const candidatePath = path.join(root, 'config', 'scene-release-candidates.json');
const forbiddenAuthorities = [
  'identity',
  'body',
  'hair',
  'outfit',
  'brands',
  'readable_text',
  'exact_architecture',
];
const environmentMaterials = Object.freeze({
  city: ['pale limestone', 'matte stone paving', 'restrained metal details'],
  light_studio: ['seamless painted cyclorama', 'matte studio floor'],
  dramatic_studio: ['matte taupe or charcoal backdrop', 'non-reflective studio floor'],
  interior: ['mineral plaster', 'travertine', 'light oak'],
  nature_architecture: ['light stone or concrete', 'dry grasses', 'restrained natural foliage'],
});

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function atomicWrite(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o644 });
  await rename(temporary, filename);
}

async function writeJson(filename, value) {
  const bytes = jsonBytes(value);
  await atomicWrite(filename, bytes);
  return { bytes, sha256: sha256(bytes) };
}

function relative(filename) {
  return path.relative(root, filename).split(path.sep).join('/');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceSnapshot({ source, evidence, retrievedAt }) {
  return {
    schema_version: '1.0.0',
    source_id: evidence.source_id,
    url: source.url,
    retrieved_at: retrievedAt,
    availability: evidence.availability,
    platform: evidence.platform,
    creator: evidence.creator,
    page_title: evidence.page_title,
    extraction_role: source.role,
    permitted_observation: source.use,
    not_authority_for: source.not_authority_for,
    pixel_policy: 'PAGE_METADATA_AND_ROLE_LIMITS_ONLY_SOURCE_PIXELS_NOT_SHIPPED',
    license_evidence: evidence.license_evidence,
  };
}

async function buildPreset({ preset, candidate }) {
  const presetId = preset.preset_id;
  const directory = path.join(root, 'assets', 'scene-presets', presetId, 'v1');
  const productionPromptPath = path.join(
    root,
    'prompts',
    'scene-presets',
    presetId,
    'v1',
    'production-scene.txt',
  );
  const environmentPath = path.join(directory, 'environment-plate.webp');
  const lightingPath = path.join(directory, 'lighting-preview.webp');

  const [promptBytes, environmentBytes, lightingBytes] = await Promise.all([
    readFile(productionPromptPath),
    readFile(environmentPath),
    readFile(lightingPath),
  ]);
  const [environmentMetadata, lightingMetadata] = await Promise.all([
    sharp(environmentBytes).metadata(),
    sharp(lightingBytes).metadata(),
  ]);
  for (const [label, metadata] of [
    ['environment plate', environmentMetadata],
    ['lighting preview', lightingMetadata],
  ]) {
    assert(metadata.width === 1024 && metadata.height === 1280, `${presetId} ${label} must be 1024x1280`);
    assert(metadata.space === 'srgb', `${presetId} ${label} must be sRGB`);
  }

  // The immutable preset snapshot is the exact standard SceneSpec authored in
  // the catalog. Runtime validation intentionally rejects transport/provenance
  // fields here; those stay hash-bound in index.json instead.
  const presetSnapshot = { ...preset };
  const presetResult = await writeJson(path.join(directory, 'preset.json'), presetSnapshot);

  const environmentReferencePath = path.join(directory, 'environment-reference.json');
  const environmentReferenceResult = await writeJson(environmentReferencePath, {
    schema_version: '1.0.0',
    role: 'environment_anchor',
    facts: {
      description: preset.environment,
      spatial_cues: [
        `Create a new ${preset.family.replaceAll('_', ' ')} layout consistent with the scene description.`,
        'Keep coherent depth, grounded perspective and clean negative space around the subject.',
      ],
      materials: environmentMaterials[preset.family] ?? ['restrained original environmental materials'],
      originality_rules: [
        'Invent new geometry instead of reconstructing any preview, source photograph or recognizable place.',
        'No landmark, signage, storefront brand, other person, vehicle or unauthorized prop.',
      ],
    },
  });

  const lightingReferencePath = path.join(directory, 'lighting-reference.json');
  const lightingReferenceResult = await writeJson(lightingReferencePath, {
    schema_version: '1.0.0',
    role: 'lighting_anchor',
    facts: {
      time_or_setup: preset.lighting.time_or_setup,
      key: preset.lighting.key,
      fill: preset.lighting.fill,
      finish: preset.lighting.finish,
      protected_regions: preset.lighting.protected_regions,
    },
  });

  const compositionReferencePath = path.join(directory, 'composition-reference.json');
  const compositionReferenceResult = await writeJson(compositionReferencePath, {
    schema_version: '1.0.0',
    role: 'composition_anchor',
    facts: {
      aspect_ratio: preset.camera.aspect_ratio,
      lens_mm: preset.camera.lens_mm,
      camera_height: preset.camera.height,
      subject_height_percent: preset.camera.subject_height_percent,
      minimum_clear_space_percent: preset.camera.minimum_clear_space_percent,
      max_vertical_error_deg: preset.camera.max_vertical_error_deg,
      notes: [
        'Show the complete approved head or headwear and both shoes.',
        'Avoid wide-angle distortion, accidental crop and merged limbs.',
      ],
    },
  });

  const palettePath = path.join(directory, 'palette-anchor.json');
  const paletteResult = await writeJson(palettePath, {
    schema_version: '1.0.0',
    role: 'palette_anchor',
    facts: {
      colors: preset.palette,
      contrast: preset.family === 'dramatic_studio' ? 'high' : 'medium',
      materials: [],
      notes: [
        'Apply this palette to the environment and editorial grade only.',
        'Preserve natural skin tone and every approved item color exactly.',
      ],
    },
  });

  const negativePath = path.join(directory, 'negative-reference.json');
  const negativeResult = await writeJson(negativePath, {
    schema_version: '1.0.0',
    role: 'negative_reference',
    facts: {
      avoid: preset.hard_negatives,
      notes: [
        'Never use a scene reference as authority for identity, body, hair or outfit.',
        'Reject any invented, removed, recolored or structurally changed approved item.',
      ],
    },
  });

  const ledgerSources = [];
  for (const source of preset.source_authorities) {
    const evidence = candidate.source_evidence[source.url];
    assert(evidence, `${presetId} has no verified source evidence for ${source.url}`);
    assert(evidence.availability === 'VERIFIED', `${source.url} is not verified`);
    assert(
      JSON.stringify([...source.not_authority_for].sort()) === JSON.stringify([...forbiddenAuthorities].sort()),
      `${source.url} must deny every forbidden authority`,
    );
    const snapshotPath = path.join(root, 'evidence', 'scene-sources', `${evidence.source_id}.json`);
    const snapshotResult = await writeJson(
      snapshotPath,
      sourceSnapshot({ source, evidence, retrievedAt: candidate.retrieved_at }),
    );
    const licensePath = path.join(root, evidence.license_evidence);
    const licenseBytes = await readFile(licensePath);
    ledgerSources.push({
      source_id: evidence.source_id,
      url: source.url,
      role: source.role,
      use: source.use,
      not_authority_for: source.not_authority_for,
      retrieved_at: candidate.retrieved_at,
      snapshot_uri: relative(snapshotPath),
      content_sha256: snapshotResult.sha256,
      rights: {
        status: 'VERIFIED',
        basis: 'LICENSED',
        rights_holder: `${evidence.creator} via ${evidence.platform} license`,
        evidence_uri: relative(licensePath),
        evidence_sha256: sha256(licenseBytes),
        verified_at: candidate.retrieved_at,
      },
    });
  }

  const sourceLedger = {
    schema_version: '1.0.0',
    ledger_id: `ledger.${presetId}.v1`,
    revision: 1,
    preset_id: presetId,
    preset_version: preset.version,
    status: 'VERIFIED_FOR_RELEASE',
    sources: ledgerSources,
    created_at: candidate.retrieved_at,
  };
  const sourceLedgerResult = await writeJson(path.join(directory, 'source-ledger.json'), sourceLedger);

  const references = [
    {
      reference_id: `${presetId}.environment`,
      role: 'environment_anchor',
      sha256: environmentReferenceResult.sha256,
      media_type: 'application/json',
      not_authority_for: ['identity', 'body', 'hair', 'outfit'],
    },
    {
      reference_id: `${presetId}.lighting`,
      role: 'lighting_anchor',
      sha256: lightingReferenceResult.sha256,
      media_type: 'application/json',
      not_authority_for: ['identity', 'body', 'hair', 'outfit'],
    },
    {
      reference_id: `${presetId}.composition`,
      role: 'composition_anchor',
      sha256: compositionReferenceResult.sha256,
      media_type: 'application/json',
      not_authority_for: ['identity', 'body', 'hair', 'outfit'],
    },
    {
      reference_id: `${presetId}.palette`,
      role: 'palette_anchor',
      sha256: paletteResult.sha256,
      media_type: 'application/json',
      not_authority_for: ['identity', 'body', 'hair', 'outfit'],
    },
    {
      reference_id: `${presetId}.negative`,
      role: 'negative_reference',
      sha256: negativeResult.sha256,
      media_type: 'application/json',
      not_authority_for: ['identity', 'body', 'hair', 'outfit'],
    },
  ];

  const referencePack = {
    schema_version: '1.0.0',
    reference_pack_id: `pack.${presetId}.v1.1`,
    version: '1.1.0',
    preset_id: presetId,
    preset_version: preset.version,
    preset_sha256: presetResult.sha256,
    prompt_sha256: sha256(promptBytes),
    references,
    source_ledger: sourceLedger,
  };
  const referencePackPath = path.join(directory, 'reference-pack.json');
  const referencePackResult = await writeJson(referencePackPath, referencePack);

  const bindings = [
    [references[0], environmentReferencePath],
    [references[1], lightingReferencePath],
    [references[2], compositionReferencePath],
    [references[3], palettePath],
    [references[4], negativePath],
  ].map(([reference, filename], index) => ({
    order: index + 1,
    reference_id: reference.reference_id,
    role: reference.role,
    path: relative(filename),
    sha256: reference.sha256,
    media_type: reference.media_type,
  }));

  const index = {
    schema_version: '1.0.0',
    preset_id: presetId,
    preset_version: preset.version,
    preset_path: relative(path.join(directory, 'preset.json')),
    preset_sha256: presetResult.sha256,
    production_prompt_path: relative(productionPromptPath),
    prompt_sha256: sha256(promptBytes),
    reference_pack_path: relative(referencePackPath),
    reference_pack_sha256: referencePackResult.sha256,
    source_ledger_path: relative(path.join(directory, 'source-ledger.json')),
    source_ledger_sha256: sourceLedgerResult.sha256,
    references: bindings,
  };
  await writeJson(path.join(directory, 'index.json'), index);

  const moodPath = path.join(root, 'assets', 'scene-mood-cards', `${presetId}.webp`);
  const moodBytes = await readFile(moodPath);
  const isCity = presetId === 'std.city.golden_hour_gloss';
  await writeJson(path.join(directory, 'candidate-provenance.json'), {
    schema_version: '1.0.0',
    preset_id: presetId,
    preset_version: preset.version,
    release_status: 'BLOCKED_MISSING_STABLE_PROVIDER_RECEIPTS',
    assets: [
      {
        role: 'environment_plate',
        path: relative(environmentPath),
        sha256: sha256(environmentBytes),
        exact_prompt_path: relative(
          path.join(root, 'prompts', 'scene-presets', presetId, 'v1', 'environment-plate.txt'),
        ),
        provider_receipt_status: 'MISSING_FROM_BUILTIN_IMAGE_TOOL',
      },
      {
        role: 'lighting_preview',
        path: relative(lightingPath),
        sha256: sha256(lightingBytes),
        derivation: isCity
          ? {
              operation: 'GENERATED_AND_DETERMINISTICALLY_REFRAMED',
              exact_prompt_path: relative(
                path.join(root, 'prompts', 'scene-presets', presetId, 'v1', 'lighting-preview.txt'),
              ),
            }
          : {
              operation: 'ROLE_REASSIGNMENT_FROM_VISUALLY_APPROVED_MOOD_CARD',
              source_path: relative(moodPath),
              source_sha256: sha256(moodBytes),
              exact_prompt_path: `prompts/scenes/${presetId}.txt`,
            },
        provider_receipt_status: 'MISSING_FROM_BUILTIN_IMAGE_TOOL',
      },
    ],
  });

  return index;
}

const [catalog, candidate] = await Promise.all([
  readJson(catalogPath),
  readJson(candidatePath),
]);

assert(candidate.approval.status === 'PENDING', 'The builder must never fabricate human approval');
assert(candidate.selected_preset_ids.length === 5, 'Exactly five release candidates are required');

const presetById = new Map(catalog.standard_presets.map((preset) => [preset.preset_id, preset]));
const indexes = [];
for (const presetId of candidate.selected_preset_ids) {
  const preset = presetById.get(presetId);
  assert(preset, `Unknown selected preset ${presetId}`);
  indexes.push(await buildPreset({ preset, candidate }));
}

await writeJson(path.join(root, 'assets', 'scene-presets', 'index.json'), {
  schema_version: '1.0.0',
  status: 'READY_FOR_RECORDED_HUMAN_APPROVAL',
  selected_preset_ids: candidate.selected_preset_ids,
  approval: candidate.approval,
  presets: indexes,
});

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  preset_count: indexes.length,
  reference_pack_count: indexes.length,
  human_approval: candidate.approval.status,
}, null, 2)}\n`);
