#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assessImageQuality,
  createGarmentReferenceAssets,
  createHumanReferenceCrops,
  createLineageRecord,
  decideReferenceReadiness,
  extractQualityTarget,
  normalizeReference,
  sha256Input,
} from '../src/conditioning/index.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(repositoryRoot, 'artifacts', 'conditioning');
const recordedAt = new Date().toISOString();

const humanSpecs = [
  {
    id: '001',
    assetId: 'user-input-001',
    source: 'inputs/zeely-test/users/input1.webp',
    faceBbox: [0.24, 0.2, 0.54, 0.37],
    personBbox: [0, 0.14, 1, 0.86],
    bodyVisibility: 'PARTIAL',
    observed: {
      face: 'round-to-oval facial geometry with full cheeks and broad jaw',
      hair: 'dark brown short dense wavy hair',
      skin: 'light natural skin tone with visible texture',
      body: 'broad upper torso; lower-body proportions are not visible',
    },
  },
  {
    id: '002',
    assetId: 'user-input-002',
    source: 'inputs/zeely-test/users/input2.jpg',
    faceBbox: [0.15, 0.12, 0.76, 0.62],
    personBbox: [0, 0.08, 1, 0.92],
    bodyVisibility: 'NONE',
    observed: {
      face: 'long narrow facial geometry with defined jaw and full lips',
      hair: 'chin-length blonde bob with darker roots and short bangs',
      skin: 'light natural skin tone with subtle freckles/texture',
      distinctive: 'round rose-gold eyeglasses and small teal geometric tattoo at lower center neck',
      body: 'not evaluable beyond face and shoulders',
    },
  },
  {
    id: '003',
    assetId: 'user-input-003',
    source: 'inputs/zeely-test/users/input3.webp',
    faceBbox: [0.08, 0.01, 0.84, 0.82],
    personBbox: [0, 0, 1, 1],
    bodyVisibility: 'NONE',
    observed: {
      face: 'long facial geometry, high forehead, light brows and grey-green eyes',
      hair: 'long light-brown hair pulled back with loose fine strands',
      facialHair: 'full brown beard and moustache with lighter strands',
      skin: 'light natural skin tone with visible forehead and cheek texture',
      body: 'not evaluable beyond face and shoulders',
    },
  },
  {
    id: '004',
    assetId: 'user-input-004',
    source: 'inputs/zeely-test/users/input4.jpg',
    faceBbox: [0.28, 0.17, 0.3, 0.23],
    personBbox: [0.15, 0.13, 0.6, 0.84],
    bodyVisibility: 'FULL',
    observed: {
      face: 'oval facial geometry with short red-brown hair and black rectangular glasses',
      hair: 'short red-brown textured crop',
      skin: 'light natural skin tone',
      body: 'full body visible in mirror; phone partially occludes torso',
    },
  },
];

const garmentSpecs = [
  {
    id: 'hoodie-green',
    assetId: 'outfit-green-hoodie',
    source: 'inputs/zeely-test/outfits/180827-1.webp',
    category: 'TOP',
    bbox: null,
    allowFullImage: false,
    requireExactDetail: true,
    observed: {
      garmentType: 'forest-green pullover hoodie',
      structure: ['hood', 'green drawstrings with metal tips', 'long sleeves', 'ribbed cuffs and hem'],
      graphic: ['GUCCI', 'central double-G emblem', 'red and dark-navy braided stripe', 'FIRENZE', '1921'],
    },
  },
  {
    id: 'sneaker-black',
    assetId: 'outfit-black-sneaker',
    source: 'inputs/zeely-test/outfits/68d39339521f3-6389105.webp',
    category: 'FOOTWEAR',
    bbox: [0, 0, 1, 1],
    allowFullImage: false,
    requireExactDetail: false,
    observed: {
      garmentType: 'all-black athletic sneaker',
      structure: ['mesh and synthetic upper', 'black laces', 'sculpted sole', 'visible air units'],
    },
  },
  {
    id: 'hat-western',
    assetId: 'outfit-cowboy-hat',
    source: 'inputs/zeely-test/outfits/images.jpeg',
    category: 'HEADWEAR',
    bbox: [0.03, 0.03, 0.94, 0.78],
    allowFullImage: false,
    requireExactDetail: true,
    observed: {
      garmentType: 'brown western hat',
      structure: ['creased crown', 'wide curved brim', 'decorative band', 'thin chin cord'],
      limitations: ['exact material and fine band details are not reliable at source resolution'],
    },
  },
];

async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
}

async function writeJson(filename, value) {
  await ensureDirectory(path.dirname(filename));
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeArtifact(filename, bytes) {
  await ensureDirectory(path.dirname(filename));
  await writeFile(filename, bytes);
  return {
    path: path.relative(repositoryRoot, filename),
    sha256: await sha256Input(bytes),
    bytes: bytes.length,
  };
}

async function conditionHuman(spec) {
  const sourcePath = path.join(repositoryRoot, spec.source);
  const outputDirectory = path.join(artifactRoot, 'humans', spec.id);
  await ensureDirectory(outputDirectory);
  const sourceSha256 = await sha256Input(sourcePath);
  const preflight = await assessImageQuality(sourcePath, {
    hardMinWidth: 192,
    hardMinHeight: 192,
    preferredLongEdge: 1536,
    maxUpscaleFactor: 2,
    subjectBbox: spec.personBbox,
    minEdgeEnergy: 0.015,
  });
  const normalized = await normalizeReference(sourcePath, {
    targetLongEdge: 2048,
    maxLongEdge: 4096,
    maxUpscaleFactor: 2,
    format: 'png',
  });
  const normalizedArtifact = await writeArtifact(
    path.join(outputDirectory, 'normalized.png'),
    normalized.buffer,
  );
  const crops = await createHumanReferenceCrops(sourcePath, {
    faceBbox: spec.faceBbox,
    personBbox: spec.personBbox,
    requiredCrops: ['face', 'person'],
    facePaddingRatio: 0.08,
    personPaddingRatio: 0.01,
  });
  const faceArtifact = await writeArtifact(path.join(outputDirectory, 'face.png'), crops.crops.face.buffer);
  const personArtifact = await writeArtifact(path.join(outputDirectory, 'person.png'), crops.crops.person.buffer);

  const evidence = {
    face: { bbox: spec.faceBbox },
    person: { bbox: spec.personBbox },
    bodyVisibility: spec.bodyVisibility,
    consent: { authorized: true },
  };
  const strictProduction = decideReferenceReadiness({
    kind: 'HUMAN',
    assessment: preflight,
    evidence,
    requirements: {
      requiredEvidence: ['face', 'consent.authorized'],
      requiresBodyProportions: true,
      allowPartialBodyEvidence: false,
    },
  });
  const taskCompatibility = decideReferenceReadiness({
    kind: 'HUMAN',
    assessment: { ...preflight, repairable_issues: [], fatal_issues: [] },
    evidence,
    requirements: {
      requiredEvidence: ['face', 'consent.authorized'],
      requiresBodyProportions: false,
    },
  });

  const lineage = [
    createLineageRecord({
      artifactId: `${spec.assetId}-normalized`,
      outputBytes: normalized.buffer,
      parents: [{ assetId: spec.assetId, sha256: sourceSha256, role: 'IDENTITY_SOURCE' }],
      operations: normalized.operations,
      recordedAt,
    }),
    createLineageRecord({
      artifactId: `${spec.assetId}-face`,
      outputBytes: crops.crops.face.buffer,
      parents: [{ assetId: spec.assetId, sha256: sourceSha256, role: 'IDENTITY_SOURCE' }],
      operations: [{ type: 'EXPLICIT_BBOX_CROP', role: 'FACE', bbox: spec.faceBbox }],
      recordedAt,
    }),
    createLineageRecord({
      artifactId: `${spec.assetId}-person`,
      outputBytes: crops.crops.person.buffer,
      parents: [{ assetId: spec.assetId, sha256: sourceSha256, role: 'IDENTITY_SOURCE' }],
      operations: [{ type: 'EXPLICIT_BBOX_CROP', role: 'PERSON', bbox: spec.personBbox }],
      recordedAt,
    }),
  ];

  const manifest = {
    schema_version: '1.0.0',
    asset_id: spec.assetId,
    kind: 'HUMAN',
    source: {
      path: spec.source,
      sha256: sourceSha256,
      immutable: true,
      consent: 'AUTHORIZED_TEST_DATASET',
    },
    extraction: {
      method: 'explicit_visual_review_with_bboxes',
      observed_facts: spec.observed,
      evidence: { face_bbox_xywh_norm: spec.faceBbox, person_bbox_xywh_norm: spec.personBbox },
      provenance: 'OBSERVED',
      unknowns: spec.bodyVisibility === 'FULL' ? [] : [
        {
          path: '/human/body/full_proportions',
          provenance: 'UNKNOWN',
          reason: 'NOT_VISIBLE',
          production_blocking: true,
        },
      ],
    },
    technical_assessment: preflight,
    conditioning: {
      normalized: normalizedArtifact,
      face_crop: faceArtifact,
      person_crop: personArtifact,
      resize_plan: normalized.resize_plan,
      lineage,
    },
    readiness: {
      strict_production: strictProduction,
      task_compatibility: taskCompatibility,
      policy: 'Strict production requires observable body proportions. The test lane may continue with body_build=NOT_EVALUABLE and must not claim body preservation.',
    },
    generation_bindings: [
      { order: 1, role: 'IDENTITY_PRIMARY', path: normalizedArtifact.path, sha256: normalizedArtifact.sha256 },
      { order: 2, role: 'IDENTITY_FACE_DETAIL', path: faceArtifact.path, sha256: faceArtifact.sha256 },
      { order: 3, role: 'IDENTITY_PERSON_CONTEXT', path: personArtifact.path, sha256: personArtifact.sha256 },
    ],
    created_at: recordedAt,
  };
  await writeJson(path.join(outputDirectory, 'reference-pack.json'), manifest);
  return {
    asset_id: spec.assetId,
    strict_production_decision: strictProduction.decision,
    task_compatibility_decision: taskCompatibility.decision,
    reference_pack: path.relative(repositoryRoot, path.join(outputDirectory, 'reference-pack.json')),
    generation_bindings: manifest.generation_bindings,
  };
}

async function conditionGarment(spec) {
  const sourcePath = path.join(repositoryRoot, spec.source);
  const outputDirectory = path.join(artifactRoot, 'garments', spec.id);
  await ensureDirectory(outputDirectory);
  const sourceSha256 = await sha256Input(sourcePath);
  const preflight = await assessImageQuality(sourcePath, {
    hardMinWidth: 192,
    hardMinHeight: 192,
    preferredLongEdge: 1024,
    maxUpscaleFactor: 2,
    minEdgeEnergy: 0.01,
  });
  const normalized = await normalizeReference(sourcePath, {
    targetLongEdge: 1536,
    maxLongEdge: 4096,
    maxUpscaleFactor: 2,
    format: 'png',
  });
  const normalizedArtifact = await writeArtifact(path.join(outputDirectory, 'normalized.png'), normalized.buffer);
  const garment = await createGarmentReferenceAssets(sourcePath, {
    bbox: spec.bbox,
    allowFullImage: spec.allowFullImage,
    cardWidth: 1024,
    cardHeight: 1280,
    cardPadding: 48,
    allowCardUpscale: false,
  });
  const cutoutArtifact = await writeArtifact(path.join(outputDirectory, 'cutout.png'), garment.cutout.buffer);
  const cardArtifact = await writeArtifact(path.join(outputDirectory, 'reference-card.png'), garment.card.buffer);
  const evidence = {
    category: spec.category,
    isIsolated: garment.cutout.is_isolated,
    bbox: spec.bbox,
  };
  const readiness = decideReferenceReadiness({
    kind: 'GARMENT',
    assessment: preflight,
    evidence,
    requirements: {
      targetFraming: 'FULL_LENGTH',
      requireIsolatedGarment: spec.id === 'hoodie-green',
      requiresExactDetail: spec.requireExactDetail,
    },
  });
  const manifest = {
    schema_version: '1.0.0',
    asset_id: spec.assetId,
    kind: 'GARMENT',
    source: { path: spec.source, sha256: sourceSha256, immutable: true },
    extraction: {
      method: 'explicit_visual_review',
      category: spec.category,
      observed_facts: spec.observed,
      provenance: 'OBSERVED',
      unknowns: spec.observed.limitations ?? [],
    },
    technical_assessment: preflight,
    conditioning: {
      normalized: normalizedArtifact,
      cutout: { ...cutoutArtifact, is_isolated: garment.cutout.is_isolated, isolation_method: garment.cutout.isolation_method },
      reference_card: cardArtifact,
      warnings: garment.warnings,
      operations: garment.operations,
    },
    readiness,
    generation_bindings: readiness.decision === 'INCOMPATIBLE' || readiness.decision === 'NEEDS_INPUT'
      ? []
      : [
          { order: 1, role: 'GARMENT_PRIMARY', path: cutoutArtifact.path, sha256: cutoutArtifact.sha256 },
          { order: 2, role: 'GARMENT_REFERENCE_CARD', path: cardArtifact.path, sha256: cardArtifact.sha256 },
        ],
    created_at: recordedAt,
  };
  await writeJson(path.join(outputDirectory, 'reference-pack.json'), manifest);
  return {
    asset_id: spec.assetId,
    decision: readiness.decision,
    reasons: readiness.reasons,
    reference_pack: path.relative(repositoryRoot, path.join(outputDirectory, 'reference-pack.json')),
    generation_bindings: manifest.generation_bindings,
  };
}

const humanResults = [];
for (const spec of humanSpecs) humanResults.push(await conditionHuman(spec));
const garmentResults = [];
for (const spec of garmentSpecs) garmentResults.push(await conditionGarment(spec));

const qualityTarget = await extractQualityTarget({
  writtenRules: {
    background_color: '#FFFFFF',
    framing: 'FULL_LENGTH_HEAD_TO_SOLES',
    pose: 'NEUTRAL_FRONTAL',
    lighting: 'SOFT_DIFFUSED_STUDIO',
    white_balance: 'NEUTRAL',
    finish: 'PHOTOREALISTIC',
    detail: 'NATURAL_SKIN_HAIR_FABRIC',
  },
  sampleImage: path.join(repositoryRoot, 'inputs/zeely-test/quality-references/output1.png'),
  defaults: { background_color: '#FFFFFF' },
});
await writeJson(path.join(artifactRoot, 'quality-target.json'), {
  ...qualityTarget,
  policy: {
    exact_background_rgb: [255, 255, 255],
    written_rules_override_benchmark_pixels: true,
    benchmark_use: ['FRAMING', 'LIGHTING', 'FINISH', 'DETAIL'],
    benchmark_must_not_define: ['IDENTITY', 'BODY', 'GARMENT', 'EXACT_BACKGROUND_COLOR'],
  },
});

const summary = {
  schema_version: '1.0.0',
  created_at: recordedAt,
  policy: {
    raw_assets_immutable: true,
    generated_hypotheses_are_locks: false,
    strict_production_body_evidence_required: true,
    task_compatibility_unknowns_must_be_explicit: true,
  },
  humans: humanResults,
  garments: garmentResults,
  quality_target: path.relative(repositoryRoot, path.join(artifactRoot, 'quality-target.json')),
};
await writeJson(path.join(artifactRoot, 'summary.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
