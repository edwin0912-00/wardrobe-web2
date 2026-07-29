#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { HiggsfieldCliProvider } from '../src/providers/higgsfield-cli-provider.js';
import { FilesystemScenePresetResolver } from '../src/web/scene-resolvers.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const assetsRoot = path.join(projectRoot, 'assets', 'scene-mood-cards');
const candidateRoot = path.join('/private/tmp', 'zeely-create-universe-mood-cards');
const journalRoot = path.join('/private/tmp', 'zeely-create-universe-mood-card-jobs');
const model = 'nano_banana_2';
const promptContractVersion = 'create-universe-mood-card-v1';

const unitNames = Object.freeze({
  'shoot.skylight_haze': 'Скляний дах · теплий серпанок',
  'shoot.terracotta_hardlight': 'Теракота · жорстке сонце',
  'shoot.window_gobo_warm': 'Тепле вікно · gobo-тінь',
  'shoot.grey_studio_stride': 'Сіра студія · крок',
  'shoot.sky_dune_surreal': 'Небо й дюна · сюрреалізм',
  'shoot.hardsun_brick_doorway': 'Жорстке сонце · цегляна брама',
  'shoot.overcast_street_stride': 'Хмарна вулиця · крок',
  'shoot.grey_wall_gloss': 'Сіра стіна · глянець',
  'shoot.ochre_stage_tailoring': 'Охра · сценічний кравець',
  'shoot.shutter_amber_interior': 'Жалюзі · бурштиновий інтерʼєр',
  'shoot.zayn_institutional': 'Інституційний модернізм · ритуальна симетрія',
  'shoot.liza_luminous': 'Блакитне поле · білий тюль',
  'shoot.duckweed_forest_ophelia': 'Ряска й ліс · Ophelia',
  'shoot.rooftop_veil_monochrome': 'Дах і вуаль · монохром',
  'shoot.autumn_park_mediated_sun': 'Осінній парк · мʼяке сонце',
});

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return args;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeUnitId(value) {
  if (!Object.hasOwn(unitNames, value)) throw new Error(`Unsupported unit id: ${value}`);
  return value;
}

function safeRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1 || revision > 20) {
    throw new Error('--revision must be an integer from 1 to 20');
  }
  return revision;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

function sanitizeRuntimeText(value) {
  return String(value)
    .replace(/\bone approved subject\b/gi, 'one fictional model')
    .replace(/\bthe approved subject\b/gi, 'the fictional model')
    .replace(/\bapproved subject\b/gi, 'fictional model')
    .replace(/\bthe approved person\b/gi, 'the fictional model')
    .replace(/\bapproved person\b/gi, 'fictional model')
    .replace(/\bthe approved item\b/gi, 'the original unbranded styling')
    .replace(/\bapproved items\b/gi, 'original unbranded styling')
    .replace(/\bapproved item\b/gi, 'original unbranded styling')
    .replace(/\bapproved material\b/gi, 'original unbranded material');
}

function listText(values) {
  return values.map((value) => `- ${sanitizeRuntimeText(value)}`).join('\n');
}

function buildPrompt(unit, slot, revisionNote = '') {
  const runtime = unit.runtime_style;
  const direction = runtime.shot_directions[slot];
  const palette = unit.palette
    .map(({ name, hex, role }) => `${hex} — ${name}: ${role}`)
    .join('; ');
  const prompt = [
    'Use case: photorealistic-natural',
    'Asset type: 4:5 Create Universe fashion mood-card preview',
    'Primary request: Generate one original editorial fashion photograph. Interpret the supplied style contract as a reusable visual universe; do not reconstruct, imitate, or closely copy any source photograph, source person, source outfit, approved look, or known campaign image.',
    `Visual system: ${sanitizeRuntimeText(runtime.visual_system)}`,
    `Mood: ${sanitizeRuntimeText(runtime.mood_line)}`,
    `Scene/backdrop: ${sanitizeRuntimeText(runtime.environment)}`,
    'Subject: Exactly one fictional, non-identifiable, non-celebrity adult fashion model with newly invented generic features and natural anatomy. The model must not resemble any real person or recognizable source identity. The adult is fully clothed in an opaque, non-revealing, full-coverage fashion outfit. Use original, plain, unbranded editorial styling whose material behaviour follows the contract; do not reproduce a source garment, accessory, uniform, mask, strap, motif, or approved item.',
    `Composition slot: ${slot}`,
    `Camera and framing: ${sanitizeRuntimeText(direction.camera_consequence)}`,
    `Pose joint chain: ${sanitizeRuntimeText(direction.pose_joint_chain)}`,
    `Focus: ${sanitizeRuntimeText(direction.focus)}`,
    `Foreground: ${sanitizeRuntimeText(direction.foreground)}`,
    `Lighting: ${sanitizeRuntimeText(runtime.lighting)}`,
    `Contrast: ${sanitizeRuntimeText(runtime.contrast)}`,
    `Expression: ${sanitizeRuntimeText(runtime.expression_signature)}`,
    `Garment behaviour: ${sanitizeRuntimeText(runtime.garment_behaviour)}`,
    `Materials:\n${listText(runtime.materials)}`,
    `Fixed optical signature:\n${listText(runtime.optical_signature)}`,
    `Closed palette authority: ${palette}`,
    'Input image role: The sole attached image is a deterministic rendered palette strip. It is colour authority only. Never copy its text, swatch layout, typography, border, or diagram structure into the photograph. It is not authority for identity, body, pose, garment, item, scene, architecture, or composition.',
    'Output intent: A single polished full-bleed vertical fashion photograph that works as a small product-selection card while retaining believable photographic detail.',
    'Constraints: One person only. Fully clothed, non-sexual editorial fashion; no nudity, lingerie, swimwear, transparent clothing, fetish styling, provocative pose, or erotic framing. A translucent environmental scrim or veil may appear only when the style contract explicitly calls for it, and it must never expose the body. One coherent exposure and one camera viewpoint. Preserve the selected environmental composition and the fixed optical signature. Keep face and hands anatomically plausible. No recognizable person, celebrity, source identity, personal input, copied outfit, brand, logo, watermark, caption, letters, numbers, typography, diagram, palette chart, contact sheet, collage, split panel, border, UI, or metadata.',
    revisionNote ? `Targeted revision: ${revisionNote}` : '',
  ].filter(Boolean).join('\n\n');
  return `${prompt}\n`;
}

async function loadApprovedUnit(unitId) {
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.join(projectRoot, 'assets', 'scene-presets'),
    projectRoot,
  });
  await resolver.initialize();
  const mode = (await resolver.listEditorialModes()).modes.find(
    (candidate) => candidate.mode_id === unitId,
  );
  if (mode?.source_set_status !== 'READY' || mode.generation_available !== true) {
    throw new Error(`${unitId} does not pass the complete runtime integrity resolver`);
  }
  const unitDir = path.join(projectRoot, 'docs', 'style-units', unitId);
  const unitPath = path.join(unitDir, 'unit.json');
  const manifestPath = path.join(unitDir, 'manifest.json');
  const palettePath = path.join(unitDir, 'palette-strip.svg');
  const [unitBytes, manifest, paletteBytes] = await Promise.all([
    readFile(unitPath),
    readJson(manifestPath),
    readFile(palettePath),
  ]);
  const unit = JSON.parse(unitBytes.toString('utf8'));
  if (unit.unit_id !== unitId) throw new Error(`unit.json id mismatch for ${unitId}`);
  if (unit.style_unit_status !== 'READY') {
    throw new Error(`${unitId} is not READY; current status is ${unit.style_unit_status ?? 'missing'}`);
  }
  if (manifest.self_verification?.status !== 'APPROVED') {
    throw new Error(`${unitId} manifest is not self-verified APPROVED`);
  }
  const contractSha256 = sha256(unitBytes);
  if (manifest.unit_contract?.sha256 !== contractSha256) {
    throw new Error(`${unitId} manifest does not bind the current unit.json`);
  }
  const runtimeSha256 = sha256(Buffer.from(`${JSON.stringify(unit.runtime_style)}\n`));
  if (manifest.runtime_style_sha256 !== runtimeSha256) {
    throw new Error(`${unitId} manifest runtime_style hash mismatch`);
  }
  const paletteSha256 = sha256(paletteBytes);
  if (manifest.palette_authority?.sha256 !== paletteSha256
    || manifest.palette_authority?.rendered_not_generated !== true) {
    throw new Error(`${unitId} deterministic palette authority is not bound`);
  }
  return {
    unit,
    unitDir,
    unitPath,
    manifest,
    palettePath,
    paletteBytes,
    contractSha256,
    runtimeSha256,
    paletteSha256,
  };
}

function candidatePaths(unitId, revision) {
  const directory = path.join(candidateRoot, unitId);
  return {
    directory,
    candidate: path.join(directory, `candidate-r${revision}.png`),
    receipt: path.join(directory, `candidate-r${revision}.json`),
    seed: path.join(directory, 'palette-authority.png'),
  };
}

async function generate({ unitId, slot, revision, revisionNote }) {
  const approved = await loadApprovedUnit(unitId);
  if (!['environmental_hero', 'wide_campaign_coda'].includes(slot)) {
    throw new Error('--slot must be environmental_hero or wide_campaign_coda');
  }
  if (!approved.unit.runtime_style?.shot_directions?.[slot]) {
    throw new Error(`${unitId} has no runtime direction ${slot}`);
  }
  const files = candidatePaths(unitId, revision);
  await mkdir(files.directory, { recursive: true });
  await sharp(approved.paletteBytes).png().toFile(files.seed);
  const seedBytes = await readFile(files.seed);
  const prompt = buildPrompt(approved.unit, slot, revisionNote);
  const promptSha256 = sha256(Buffer.from(prompt));
  const idempotencyKey = sha256(Buffer.from([
    promptContractVersion,
    unitId,
    String(revision),
    slot,
    approved.manifest.unit_sha256,
    approved.paletteSha256,
    prompt,
  ].join('\n')));
  const provider = new HiggsfieldCliProvider({
    aspectRatio: '4:5',
    resolution: '2k',
    quality: 'high',
    generationMode: 'journaled',
    journalDirectory: path.join(journalRoot, unitId),
  });
  const generated = await provider.generate({
    job_set_type: model,
    phase: 'scene',
    attempt: revision,
    jobId: `${unitId}.mood-card.r${revision}`,
    idempotencyKey,
    prompt,
    references: {
      identity: {
        artifact: {
          path: files.seed,
        },
      },
    },
    workDirectory: approved.unitDir,
  });
  if (generated.metadata.input_media?.length !== 1) {
    throw new Error(`${unitId} provider receipt does not prove exactly one palette-only input`);
  }
  const paletteSeedSha256 = sha256(seedBytes);
  if (generated.metadata.input_media[0]?.sha256 !== paletteSeedSha256) {
    throw new Error(`${unitId} provider receipt does not bind the deterministic palette-only input`);
  }
  const candidateSha256 = sha256(generated.image);
  if (candidateSha256 !== generated.metadata.output_sha256) {
    throw new Error(`${unitId} provider output hash mismatch`);
  }
  await writeFile(files.candidate, generated.image);
  const imageMeta = await sharp(generated.image).metadata();
  const receipt = {
    schema_version: '1.0.0',
    prompt_contract_version: promptContractVersion,
    unit_id: unitId,
    revision,
    composition_slot: slot,
    unit_contract_sha256: approved.contractSha256,
    unit_binding_sha256: approved.manifest.unit_sha256,
    runtime_style_sha256: approved.runtimeSha256,
    palette_authority_sha256: approved.paletteSha256,
    palette_seed_sha256: paletteSeedSha256,
    prompt_sha256: promptSha256,
    provider_receipt: {
      provider: generated.metadata.provider,
      transport: generated.metadata.transport,
      generation_mode: generated.metadata.generation_mode,
      job_id: generated.metadata.job_id,
      job_set_type: generated.metadata.job_set_type,
      model_name: generated.metadata.model_name,
      provider_internal_model: generated.metadata.provider_internal_model ?? null,
      requested_aspect_ratio: generated.metadata.aspect_ratio,
      requested_resolution: generated.metadata.resolution,
      requested_quality: generated.metadata.quality ?? null,
      output_sha256: generated.metadata.output_sha256,
      provider_journal_sha256: generated.metadata.provider_journal?.sha256 ?? null,
      request_sha256: generated.metadata.provider_journal?.request_sha256 ?? null,
      palette_input_sha256: generated.metadata.input_media[0]?.sha256 ?? null,
    },
    candidate: {
      file: path.basename(files.candidate),
      sha256: candidateSha256,
      byte_size: generated.image.length,
      width: imageMeta.width,
      height: imageMeta.height,
      format: imageMeta.format,
    },
  };
  await writeFile(files.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: 'GENERATED_PENDING_VISUAL_REVIEW',
    candidate: files.candidate,
    receipt: files.receipt,
    ...receipt,
  }, null, 2)}\n`);
}

async function finalize({
  unitId,
  revision,
  verdict,
  reviewNotes,
  position,
}) {
  if (verdict !== 'APPROVED') {
    throw new Error('--verdict must be APPROVED; rejected candidates must never be normalized');
  }
  if (typeof reviewNotes !== 'string' || reviewNotes.trim().length < 40) {
    throw new Error('--review-notes must record a substantive full-size visual review');
  }
  const approved = await loadApprovedUnit(unitId);
  const files = candidatePaths(unitId, revision);
  const [candidateBytes, receipt] = await Promise.all([
    readFile(files.candidate),
    readJson(files.receipt),
  ]);
  if (receipt.unit_binding_sha256 !== approved.manifest.unit_sha256
    || receipt.unit_contract_sha256 !== approved.contractSha256
    || receipt.runtime_style_sha256 !== approved.runtimeSha256
    || receipt.palette_authority_sha256 !== approved.paletteSha256) {
    throw new Error(`${unitId} candidate was generated from a stale unit binding`);
  }
  if (sha256(candidateBytes) !== receipt.candidate?.sha256
    || receipt.candidate?.sha256 !== receipt.provider_receipt?.output_sha256) {
    throw new Error(`${unitId} candidate or provider receipt hash mismatch`);
  }
  await mkdir(assetsRoot, { recursive: true });
  const output = path.join(assetsRoot, `${unitId}.webp`);
  await sharp(candidateBytes)
    .rotate()
    .resize({
      width: 1024,
      height: 1280,
      fit: 'cover',
      position,
    })
    .webp({
      quality: 91,
      effort: 5,
      smartSubsample: true,
    })
    .withMetadata({
      exif: {
        IFD0: {
          ImageDescription: `Zeely Create Universe mood card ${unitId}`,
          Copyright: 'Zeely original generated preview',
        },
      },
    })
    .toFile(output);
  const [outputBytes, outputMeta] = await Promise.all([
    readFile(output),
    sharp(output).metadata(),
  ]);
  if (outputMeta.format !== 'webp'
    || outputMeta.width !== 1024
    || outputMeta.height !== 1280
    || (outputMeta.pages ?? 1) !== 1) {
    throw new Error(`${unitId} normalization did not produce one 1024x1280 WebP`);
  }
  const now = new Date().toISOString();
  const outputSha256 = sha256(outputBytes);
  const sidecar = {
    schema_version: '1.0.0',
    preset_id: unitId,
    kind: 'editorial',
    family: 'create_universe',
    ui_name_uk: unitNames[unitId],
    asset_role: 'mood_card',
    file: `assets/scene-mood-cards/${unitId}.webp`,
    sha256: outputSha256,
    origin: {
      kind: 'OWN_GENERATED_PREVIEW',
      note: 'Original preview generated solely from the immutable runtime_style contract and deterministic palette authority. No source photographs, approved looks, source identity, or personal input were supplied to the provider.',
      unit_contract: `docs/style-units/${unitId}/unit.json`,
      unit_contract_sha256: approved.contractSha256,
      unit_binding_sha256: approved.manifest.unit_sha256,
      runtime_style_sha256: approved.runtimeSha256,
      palette_authority: {
        file: `docs/style-units/${unitId}/palette-strip.svg`,
        sha256: approved.paletteSha256,
        rendered_not_generated: true,
      },
    },
    generation: {
      provider_path: 'higgsfield-cli',
      prompt_contract_version: promptContractVersion,
      prompt_sha256: receipt.prompt_sha256,
      composition_slot: receipt.composition_slot,
      provider_receipt: receipt.provider_receipt,
      source_width: receipt.candidate.width,
      source_height: receipt.candidate.height,
      normalization: {
        method: 'deterministic_4x5_cover',
        crop_position: position,
        width: 1024,
        height: 1280,
        format: 'webp',
      },
    },
    delivery: {
      width: 1024,
      height: 1280,
      format: 'webp',
      aspect_ratio: '4:5',
    },
    contains_personal_input: false,
    approval: 'APPROVED',
    visual_review: {
      status: 'APPROVED',
      reviewed_at: now,
      reviewed_source_width: receipt.candidate.width,
      reviewed_source_height: receipt.candidate.height,
      notes: reviewNotes.trim(),
    },
    created_at: now,
  };
  const sidecarPath = path.join(assetsRoot, `${unitId}.json`);
  await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: 'NORMALIZED_AFTER_VISUAL_APPROVAL',
    output,
    sidecar: sidecarPath,
    sha256: outputSha256,
    provider_output_sha256: receipt.provider_receipt.output_sha256,
    width: outputMeta.width,
    height: outputMeta.height,
  }, null, 2)}\n`);
}

async function cleanup({ unitId, revision }) {
  const files = candidatePaths(unitId, revision);
  for (const filename of [files.candidate, files.receipt, files.seed]) {
    await rm(filename, { force: true });
  }
  process.stdout.write(`${JSON.stringify({
    status: 'CANDIDATE_TEMP_CLEANED',
    unit_id: unitId,
    revision,
  })}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const unitId = safeUnitId(args._[1]);
  const revision = safeRevision(args.revision ?? 1);
  if (command === 'generate') {
    await generate({
      unitId,
      slot: args.slot,
      revision,
      revisionNote: typeof args['revision-note'] === 'string' ? args['revision-note'] : '',
    });
    return;
  }
  if (command === 'finalize') {
    await finalize({
      unitId,
      revision,
      verdict: args.verdict,
      reviewNotes: args['review-notes'],
      position: typeof args.position === 'string' ? args.position : 'centre',
    });
    return;
  }
  if (command === 'cleanup') {
    await cleanup({ unitId, revision });
    return;
  }
  throw new Error('Usage: create-universe-mood-card.mjs <generate|finalize|cleanup> <unit-id> --revision N [--slot environmental_hero|wide_campaign_coda] [--revision-note text] [--verdict APPROVED --review-notes text]');
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
