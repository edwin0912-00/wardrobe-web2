#!/usr/bin/env node
// Build one shoot unit: seven sheets, a master gamma, a manifest.
//
// Dependency-free on purpose. This runs on whatever machine holds the frames, and a skill that
// needs an npm install before it can be used is a skill that gets skipped.
//
// Usage:
//   OPENROUTER_API_KEY=$(cat <keyfile>) node build-unit.mjs <unit-dir>
//   node build-unit.mjs --higgsfield <unit-dir>
//   node build-unit.mjs --dry-run <unit-dir>
//   node build-unit.mjs --bind-existing <unit-dir>
//
// <unit-dir> must contain unit.json:
//   {
//     "unit_id": "shoot.skylight_haze",
//     "title": "...",
//     "palette": [{ "name": "warm cream", "hex": "#EFE0CE", "role": "brightest highlight" }, ...],
//     "sheets": { "<sheet_id>": { "aspect": "16:9", "quality": "medium", "prompt": "..." }, ... }
//   }
// Sheets are written next to it as sheet-<sheet_id>.png, and the run is recorded in manifest.json.
//
// The gate lives in assertUnit(): a unit that is missing a sheet, a hex row, or a palette size is
// refused before a single call is made, because discovering it after twenty paid generations is how
// this gets abandoned.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-5.4-image-2';
const HIGGSFIELD_MODEL = 'nano_banana_2';

// The seven sheets, in ATTACHMENT order (§6), not in the order they happen to be written. A model
// attends sharply to the first few references and less after that, so positions 1-4 go to what prose
// cannot carry — camera, geometry, face muscles, cloth in motion. Colour and environment sit below
// because hex and compiled facts are exact as text, and the person comes from the approved look, not
// from the style. The manifest preserves this order so the generator can attach by index.
const REQUIRED_SHEETS = Object.freeze([
  'camera_lens',
  'blocking',
  'expression_gaze',
  'garment_behaviour',
  'colour_grade',
  'environment',
  'person',
]);

// Positions 1-4 are the image slots a real generation can usually afford. Everything at or below
// TEXT_CARRIED_FROM must survive as structured text, and the sheet exists for human approval.
const TEXT_CARRIED_FROM = 4;
const SHOT_SLOTS = Object.freeze([
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
]);

const HEX = /^#[0-9a-fA-F]{6}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function runtimeStyleSha256(unit) {
  return sha256(Buffer.from(`${JSON.stringify(unit.runtime_style)}\n`));
}

function unitBindingSha256({
  unitContractSha256,
  observationSha256,
  selfVerificationSha256,
  runtimeSha256,
  paletteAuthoritySha256,
  sheets,
}) {
  return sha256(Buffer.from([
    `unit_contract:${unitContractSha256}`,
    `observation_log:${observationSha256}`,
    `self_verification:${selfVerificationSha256 ?? 'MISSING'}`,
    `runtime_style:${runtimeSha256}`,
    `palette_authority:${paletteAuthoritySha256}`,
    ...REQUIRED_SHEETS.map((id) => {
      const sheet = sheets.find((entry) => entry.sheet_id === id);
      return `${id}:${sheet?.sha256 ?? 'MISSING'}`;
    }),
  ].join('\n')));
}

function assertSelfVerification(bytes) {
  if (!bytes || bytes.length < 500) {
    throw new Error('Unit refused before binding:\n  - SELF-VERIFY.md is missing or too thin; inspect every sheet before approval');
  }
  const text = bytes.toString('utf8');
  const omissions = [
    ...REQUIRED_SHEETS.filter((id) => !text.includes(id)),
    ...SHOT_SLOTS.filter((slot) => !text.includes(slot)),
  ];
  if (omissions.length > 0) {
    throw new Error(`Unit refused before binding:\n  - SELF-VERIFY.md does not name every reviewed sheet and shot direction: ${omissions.join(', ')}`);
  }
  if (!/^UNIT VERDICT:\s*APPROVED\s*$/im.test(text)) {
    throw new Error('Unit refused before binding:\n  - SELF-VERIFY.md must end the review with UNIT VERDICT: APPROVED');
  }
}

function expectedAspect(value) {
  const match = /^([1-9][0-9]*):([1-9][0-9]*)$/.exec(String(value ?? ''));
  return match ? Number(match[1]) / Number(match[2]) : null;
}

function assertSheetGeometry({ id, bytes, size, aspect }) {
  if (!size || size.width < 640 || size.height < 640 || bytes.length < 20_000) {
    throw new Error(`Unit refused before binding:\n  - sheet-${id}.png is not a substantial decodable PNG`);
  }
  const requestedRatio = expectedAspect(aspect);
  if (!requestedRatio) {
    throw new Error(`Unit refused before binding:\n  - sheets.${id}.aspect must be a positive W:H ratio`);
  }
  const actualRatio = size.width / size.height;
  if (Math.abs(actualRatio - requestedRatio) / requestedRatio > 0.04) {
    throw new Error(`Unit refused before binding:\n  - sheet-${id}.png is ${size.width}x${size.height}, outside the declared ${aspect} aspect`);
  }
}

// Refuse before spending. Every condition here is one the skill's §2 and §5 state in prose; this is
// the same list made runnable, because a rule with no STOP is not a rule.
function assertUnit(unit) {
  const problems = [];

  if (!/^shoot\.[a-z0-9_]+$/.test(unit.unit_id ?? '')) {
    problems.push('unit_id must look like shoot.<lower_snake> — it becomes the selectable style id');
  }

  const palette = unit.palette;
  if (!Array.isArray(palette) || palette.length < 3) {
    problems.push('palette must be a closed set of at least three entries read off the frames');
  } else {
    palette.forEach((entry, i) => {
      if (!HEX.test(entry?.hex ?? '')) problems.push(`palette[${i}] has no #RRGGBB hex — a swatch without a hex does not exist`);
      if (!entry?.role) problems.push(`palette[${i}] has no role (deepest shadow / ground / key / accent / highlight)`);
    });
    // §5.1: the count is declared as a number, not inferred later and not "about five".
    if (unit.palette_size !== palette.length) {
      problems.push(`palette_size must be declared and equal the palette length (declared ${unit.palette_size}, actual ${palette.length})`);
    }
  }

  const sheets = unit.sheets ?? {};
  for (const id of REQUIRED_SHEETS) {
    const sheet = sheets[id];
    if (!sheet) { problems.push(`sheet "${id}" is missing — seven sheets or the unit is incomplete`); continue; }
    if (!sheet.prompt || sheet.prompt.length < 200) {
      problems.push(`sheet "${id}" has no substantial prompt; a thin prompt produces a decorative sheet`);
    }
    if (!expectedAspect(sheet.aspect)) {
      problems.push(`sheet "${id}" has no valid positive W:H aspect`);
    }
    // §2 master-gamma gate: every sheet carries its own hex row derived from the master.
    const carriesHex = palette?.some?.((entry) => sheet.prompt?.includes(entry.hex));
    if (!carriesHex) problems.push(`sheet "${id}" prompt names no palette hex — the master-gamma gate fails it before approval`);
    // Rule 2: the first colour sheet printed "V1.0" and "DATE 25.05.20", neither supplied. Invented
    // provenance is indistinguishable from real provenance a week later, so the negative is required
    // in the prompt rather than hoped for.
    if (!/no version number|no invented metadata|no date/i.test(sheet.prompt ?? '')) {
      problems.push(`sheet "${id}" prompt does not forbid invented metadata (version numbers, dates, board codes, credits) — Rule 2`);
    }
  }
  for (const id of Object.keys(sheets)) {
    if (!REQUIRED_SHEETS.includes(id)) problems.push(`sheet "${id}" is not one of the seven; an eighth sheet means something belongs inside another`);
  }

  // §0: provenance is what separates extraction from invention.
  if (!unit.source_frames || unit.source_frames.length < 1) {
    problems.push('source_frames must name the frames every value was read from');
  }
  if (!Array.isArray(unit.unknowns)) {
    problems.push('unknowns must be an array, even an empty one — an absent list means nobody looked');
  }

  const runtime = unit.runtime_style;
  const runtimeKeys = [
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
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    problems.push('runtime_style is missing — sheets without a machine-readable style contract cannot drive a shoot');
  } else {
    const actualKeys = Object.keys(runtime).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify([...runtimeKeys].sort())) {
      problems.push(`runtime_style must contain exactly: ${runtimeKeys.join(', ')}`);
    }
    for (const field of [
      'visual_system',
      'mood_line',
      'environment',
      'lighting',
      'contrast',
      'expression_signature',
      'garment_behaviour',
    ]) {
      if (typeof runtime[field] !== 'string' || runtime[field].trim().length < 8) {
        problems.push(`runtime_style.${field} must be substantive observed text`);
      }
    }
    for (const field of ['materials', 'optical_signature']) {
      if (!Array.isArray(runtime[field])
        || runtime[field].length < 1
        || runtime[field].some((item) => typeof item !== 'string' || item.trim().length < 3)) {
        problems.push(`runtime_style.${field} must be a non-empty observed-text list`);
      }
    }
    const directions = runtime.shot_directions;
    if (!directions || typeof directions !== 'object' || Array.isArray(directions)
      || JSON.stringify(Object.keys(directions).sort()) !== JSON.stringify([...SHOT_SLOTS].sort())) {
      problems.push('runtime_style.shot_directions must cover all six canonical slots');
    } else {
      const compositionSignatures = new Set();
      for (const slot of SHOT_SLOTS) {
        const direction = directions[slot];
        const keys = ['camera_consequence', 'pose_joint_chain', 'focus', 'foreground', 'provenance'];
        const allowedKeys = [...keys, 'subject_lighting'];
        if (!direction || typeof direction !== 'object' || Array.isArray(direction)
          || Object.keys(direction).some((key) => !allowedKeys.includes(key))
          || keys.some((key) => !Object.hasOwn(direction, key))) {
          problems.push(`runtime_style.shot_directions.${slot} must contain ${keys.join(', ')} and may add subject_lighting`);
          continue;
        }
        for (const field of ['camera_consequence', 'pose_joint_chain', 'focus', 'foreground']) {
          if (typeof direction[field] !== 'string' || direction[field].trim().length < 8) {
            problems.push(`runtime_style.shot_directions.${slot}.${field} must be observed text`);
          }
        }
        if (Object.hasOwn(direction, 'subject_lighting')
          && (typeof direction.subject_lighting !== 'string' || direction.subject_lighting.trim().length < 8)) {
          problems.push(`runtime_style.shot_directions.${slot}.subject_lighting must be observed text when present`);
        }
        if (!Array.isArray(direction.provenance)
          || direction.provenance.length < 1
          || direction.provenance.some((item) => typeof item !== 'string' || item.trim().length < 3)) {
          problems.push(`runtime_style.shot_directions.${slot}.provenance must name source-frame observations`);
        }
        compositionSignatures.add(JSON.stringify([
          direction.camera_consequence?.trim(),
          direction.pose_joint_chain?.trim(),
          direction.focus?.trim(),
          direction.foreground?.trim(),
        ]));
      }
      if (compositionSignatures.size !== SHOT_SLOTS.length) {
        problems.push('runtime_style.shot_directions must contain six unique camera/pose/focus/foreground compositions');
      }
    }
  }

  if (problems.length) {
    throw new Error(`Unit refused before generation:\n  - ${problems.join('\n  - ')}`);
  }
}

// Rule 1: a generative model prints a hex faithfully and paints something else — measured drift up to
// 31 units, and 81 on one swatch. A palette row is flat rectangles and text, so it is rendered here
// with the exact declared values and THIS file is the colour authority. Nothing may sample colour
// from a generated sheet.
function paletteStripSvg(unit) {
  const w = 1600;
  const h = 260;
  const cell = w / unit.palette.length;
  const swatches = unit.palette.map((entry, i) => {
    const x = i * cell;
    return [
      `  <rect x="${x + 8}" y="40" width="${cell - 16}" height="130" fill="${entry.hex}"/>`,
      `  <text x="${x + cell / 2}" y="196" text-anchor="middle" font-family="monospace" font-size="22" fill="#e8e8e6">${entry.hex.toUpperCase()}</text>`,
      `  <text x="${x + cell / 2}" y="224" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#9a9a97">${entry.name}</text>`,
      `  <text x="${x + cell / 2}" y="246" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#6e6e6b">${entry.role}</text>`,
    ].join('\n');
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#141413"/>
  <text x="16" y="26" font-family="sans-serif" font-size="18" fill="#e8e8e6">${unit.unit_id} — CLOSED PALETTE · palette_size ${unit.palette_size} · rendered, not generated</text>
${swatches}
</svg>
`;
}

async function generateSheet({ apiKey, prompt, aspect }) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      modalities: ['image', 'text'],
      // The aspect belongs in the request. Asked for in prose only, both routed image models ignore
      // it and return a square, which then has to be faked back to shape.
      image_config: { aspect_ratio: aspect },
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`OpenRouter refused: ${payload?.error?.message ?? response.status}`);
  }
  const url = payload?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/is.exec(String(url ?? '').trim());
  if (!match) throw new Error('OpenRouter returned no inline image');
  if (typeof payload.id !== 'string' || payload.id.trim() === '') {
    throw new Error('OpenRouter returned no provider job receipt');
  }
  const bytes = Buffer.from(match[1], 'base64');
  return {
    bytes,
    receipt: {
      provider: 'openrouter',
      transport: 'openrouter',
      job_id: payload.id,
      model: MODEL,
      model_name: MODEL,
      output_sha256: sha256(bytes),
      provider_journal_sha256: null,
    },
  };
}

async function generateSheetWithHiggsfield({
  prompt,
  aspect,
  unit,
  sheetId,
  unitDir,
  paletteSeedPath,
}) {
  const { HiggsfieldCliProvider } = await import('../../../src/providers/higgsfield-cli-provider.js');
  const providerPrompt = [
    prompt,
    'The sole attached image is a deterministic rendered palette strip. It is colour authority only.',
    'It is not authority for person, identity, scene, architecture, pose, garment, typography, metadata, or composition.',
  ].join('\n\n');
  const provider = new HiggsfieldCliProvider({
    aspectRatio: aspect,
    resolution: '2k',
    generationMode: 'journaled',
    journalDirectory: path.join('/private/tmp', 'zeely-creative-universe-jobs', unit.unit_id),
  });
  const generated = await provider.generate({
    job_set_type: HIGGSFIELD_MODEL,
    phase: 'scene',
    attempt: 1,
    jobId: `${unit.unit_id}.${sheetId}`,
    idempotencyKey: sha256(Buffer.from([
      'creative-universe-sheet-v2',
      unit.unit_id,
      sheetId,
      aspect,
      providerPrompt,
    ].join('\n'))),
    prompt: providerPrompt,
    references: { identity: { artifact: { path: paletteSeedPath } } },
    workDirectory: unitDir,
  });
  return {
    bytes: generated.image,
    receipt: {
      provider: generated.metadata.provider,
      transport: generated.metadata.transport,
      job_id: generated.metadata.job_id,
      model: generated.metadata.job_set_type,
      model_name: generated.metadata.model_name,
      output_sha256: generated.metadata.output_sha256,
      provider_journal_sha256: generated.metadata.provider_journal?.sha256 ?? null,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bindExisting = args.includes('--bind-existing');
  const useHiggsfield = args.includes('--higgsfield');
  if (dryRun && bindExisting) {
    throw new Error('--dry-run and --bind-existing are mutually exclusive');
  }
  if ((dryRun || bindExisting) && useHiggsfield) {
    throw new Error('--higgsfield is only valid for new sheet generation');
  }
  const unitDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');

  const unitBytes = await readFile(path.join(unitDir, 'unit.json'));
  const unit = JSON.parse(unitBytes.toString('utf8'));
  const observationBytes = await readFile(path.join(unitDir, 'OBSERVATION.md')).catch(() => null);
  if (!observationBytes || observationBytes.length < 500) {
    throw new Error('Unit refused before generation:\n  - OBSERVATION.md is missing or too thin; inspect every source frame before any sheet');
  }
  const observation = observationBytes.toString('utf8');
  for (const sourceFrame of unit.source_frames ?? []) {
    const sourceLabel = String(sourceFrame).split(/\s+—\s+/, 1)[0].trim();
    if (sourceLabel.length > 0 && !observation.includes(sourceLabel)) {
      throw new Error(`Unit refused before generation:\n  - OBSERVATION.md does not name source frame ${sourceLabel}`);
    }
  }

  // The gate is the valuable half and it must not depend on which transport is alive. OpenRouter died
  // mid-session with a 401 and the gate went down with it, which is backwards: refusing a malformed
  // unit costs nothing and should always be available. --dry-run runs every check and writes the
  // colour authority, then stops before a single paid call.
  assertUnit(unit);
  await mkdir(unitDir, { recursive: true });
  const stripOnly = paletteStripSvg(unit);
  await writeFile(path.join(unitDir, 'palette-strip.svg'), stripOnly);
  if (dryRun) {
    process.stdout.write(`gate PASSED for ${unit.unit_id}: ${REQUIRED_SHEETS.length} sheets declared, palette_size ${unit.palette_size}, ${unit.unknowns.length} unknowns recorded\n`);
    process.stdout.write('palette-strip.svg written — it is the colour authority, not the generated sheet\n');
    process.stdout.write('no generation attempted (--dry-run). Sheets may be produced on any transport.\n');
    return;
  }

  const paletteAuthoritySha256 = sha256(Buffer.from(stripOnly));
  const observationSha256 = sha256(observationBytes);
  const contractSha256 = sha256(unitBytes);
  const runtimeSha256 = runtimeStyleSha256(unit);
  const previousManifest = await readFile(path.join(unitDir, 'manifest.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);

  if (bindExisting) {
    if (unit.style_unit_status !== 'READY') {
      throw new Error('Unit refused before binding:\n  - unit.json style_unit_status must be READY after sheet review');
    }
    const selfVerificationBytes = await readFile(path.join(unitDir, 'SELF-VERIFY.md')).catch(() => null);
    assertSelfVerification(selfVerificationBytes);
    if (!previousManifest?.generated_with) {
      throw new Error('Unit refused before binding:\n  - existing sheets have no prior generated_with receipt');
    }

    const results = [];
    for (const id of REQUIRED_SHEETS) {
      const file = path.join(unitDir, `sheet-${id}.png`);
      const bytes = await readFile(file).catch(() => null);
      if (!bytes) {
        throw new Error(`Unit refused before binding:\n  - sheet-${id}.png is missing`);
      }
      const size = pngSize(bytes);
      assertSheetGeometry({ id, bytes, size, aspect: unit.sheets[id].aspect });
      const previous = Array.isArray(previousManifest.sheets)
        ? previousManifest.sheets.find((entry) => entry?.sheet_id === id)
        : null;
      const currentSha256 = sha256(bytes);
      const receipt = previous?.provider_receipt;
      const legacyReceipt = previous?.legacy_artifact_receipt;
      const hasProviderReceipt = Boolean(receipt
        && receipt.output_sha256 === currentSha256
        && typeof receipt.provider === 'string'
        && receipt.provider.trim() !== ''
        && typeof receipt.transport === 'string'
        && receipt.transport.trim() !== ''
        && typeof receipt.job_id === 'string'
        && receipt.job_id.trim() !== '');
      const hasLegacyReceipt = Boolean(legacyReceipt
        && legacyReceipt.kind === 'GIT_PRESERVED_GENERATED_ASSET'
        && legacyReceipt.output_sha256 === currentSha256
        && /^[a-f0-9]{64}$/.test(legacyReceipt.original_manifest_sha256 ?? '')
        && Array.isArray(legacyReceipt.preserving_commits)
        && legacyReceipt.preserving_commits.length > 0
        && legacyReceipt.preserving_commits.every((commit) => /^[a-f0-9]{7,40}$/.test(commit))
        && legacyReceipt.provider_receipt_status === 'UNAVAILABLE_LEGACY');
      if (!hasProviderReceipt && !hasLegacyReceipt) {
        throw new Error(`Unit refused before binding:\n  - sheet-${id}.png has neither a matching provider receipt nor a verified legacy artifact receipt`);
      }
      results.push({
        sheet_id: id,
        path: `sheet-${id}.png`,
        sha256: currentSha256,
        byte_size: bytes.length,
        width: size.width,
        height: size.height,
        requested_aspect: unit.sheets[id].aspect,
        attempts: Number.isInteger(previous?.attempts) ? previous.attempts : null,
        provider_receipt: hasProviderReceipt ? receipt : null,
        legacy_artifact_receipt: hasLegacyReceipt ? legacyReceipt : null,
        colour_authoritative: false,
      });
    }
    const selfVerificationSha256 = sha256(selfVerificationBytes);
    const manifest = {
      unit_id: unit.unit_id,
      title: unit.title ?? null,
      palette_size: unit.palette_size,
      palette: unit.palette,
      item_colours_exempt: true,
      palette_authority: {
        path: 'palette-strip.svg',
        sha256: paletteAuthoritySha256,
        rendered_not_generated: true,
      },
      source_frames: unit.source_frames,
      unknowns: unit.unknowns,
      unit_contract: { path: 'unit.json', sha256: contractSha256 },
      observation_log: { path: 'OBSERVATION.md', sha256: observationSha256 },
      self_verification: {
        path: 'SELF-VERIFY.md',
        sha256: selfVerificationSha256,
        status: 'APPROVED',
      },
      runtime_style_sha256: runtimeSha256,
      sheets: results,
      unit_sha256: unitBindingSha256({
        unitContractSha256: contractSha256,
        observationSha256,
        selfVerificationSha256,
        runtimeSha256,
        paletteAuthoritySha256,
        sheets: results,
      }),
      generated_with: previousManifest.generated_with,
    };
    await writeFile(path.join(unitDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`bound and APPROVED ${unit.unit_id}: ${REQUIRED_SHEETS.length} existing sheets\n`);
    process.stdout.write(`unit_sha256 ${manifest.unit_sha256}\n`);
    return;
  }

  const apiKey = String(process.env.OPENROUTER_API_KEY ?? '').trim();
  if (!useHiggsfield && !apiKey) throw new Error('OPENROUTER_API_KEY is required for the OpenRouter transport (read it from a file; never inline it), or pass --higgsfield for the authenticated project transport. Use --dry-run to run the gate alone.');
  let paletteSeedPath = null;
  if (useHiggsfield) {
    const { default: sharp } = await import('sharp');
    const seedRoot = path.join('/private/tmp', 'zeely-creative-universe-seeds');
    await mkdir(seedRoot, { recursive: true });
    paletteSeedPath = path.join(seedRoot, `${unit.unit_id}.palette-authority.png`);
    await sharp(Buffer.from(stripOnly)).png().toFile(paletteSeedPath);
  }

  // Already written above the dry-run return, so the colour authority exists even if generation dies.
  const results = [];

  for (const id of REQUIRED_SHEETS) {
    const sheet = unit.sheets[id];
    const aspect = sheet.aspect ?? '16:9';
    let bytes;
    let providerReceipt = null;
    let attempt = 0;
    // Three attempts, because a text-heavy sheet occasionally comes back with unreadable labels and
    // the cheapest fix is another draw. More than three means the prompt is wrong, not the draw.
    while (attempt < 3) {
      attempt += 1;
      try {
        if (useHiggsfield) {
          const generated = await generateSheetWithHiggsfield({
            prompt: sheet.prompt,
            aspect,
            unit,
            sheetId: id,
            unitDir,
            paletteSeedPath,
          });
          bytes = generated.bytes;
          providerReceipt = generated.receipt;
        } else {
          const generated = await generateSheet({ apiKey, prompt: sheet.prompt, aspect });
          bytes = generated.bytes;
          providerReceipt = generated.receipt;
        }
        const size = pngSize(bytes);
        if (size) {
          assertSheetGeometry({ id, bytes, size, aspect });
          break;
        }
        bytes = undefined;
      } catch (error) {
        if (attempt === 3) throw error;
        process.stderr.write(`  ${id}: attempt ${attempt} failed (${error.message}); retrying\n`);
      }
    }
    if (!bytes) throw new Error(`sheet ${id} produced nothing usable in three attempts`);

    const file = path.join(unitDir, `sheet-${id}.png`);
    await writeFile(file, bytes);
    const size = pngSize(bytes);
    results.push({
      sheet_id: id,
      path: path.relative(unitDir, file),
      sha256: sha256(bytes),
      byte_size: bytes.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      requested_aspect: aspect,
      attempts: attempt,
      provider_receipt: providerReceipt,
      // Rule 1: a swatch a model painted is never the colour. The generated colour sheet is for a
      // human to read; palette-strip.svg and the manifest hex are what anything else may trust.
      colour_authoritative: false,
    });
    process.stdout.write(`${id.padEnd(20)} ${size ? `${size.width}x${size.height}` : 'non-png'} ${bytes.length}B attempts=${attempt}\n`);
  }

  const manifest = {
    unit_id: unit.unit_id,
    title: unit.title ?? null,
    palette_size: unit.palette_size,
    palette: unit.palette,
    item_colours_exempt: true,
    // The single colour authority. Rule 1: never sample a swatch off a generated sheet.
    palette_authority: {
      path: 'palette-strip.svg',
      sha256: paletteAuthoritySha256,
      rendered_not_generated: true,
    },
    source_frames: unit.source_frames,
    unknowns: unit.unknowns,
    unit_contract: { path: 'unit.json', sha256: contractSha256 },
    observation_log: { path: 'OBSERVATION.md', sha256: observationSha256 },
    self_verification: null,
    runtime_style_sha256: runtimeSha256,
    sheets: results,
    // A generation manifest is intentionally not approval-ready. --bind-existing adds a reviewed
    // SELF-VERIFY.md and rebinds all evidence after a person/agent has inspected every sheet.
    unit_sha256: unitBindingSha256({
      unitContractSha256: contractSha256,
      observationSha256,
      selfVerificationSha256: null,
      runtimeSha256,
      paletteAuthoritySha256,
      sheets: results,
    }),
    generated_with: useHiggsfield
      ? { model: HIGGSFIELD_MODEL, transport: 'higgsfield-cli' }
      : { model: MODEL, transport: 'openrouter' },
  };
  await writeFile(path.join(unitDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(`\nunit_sha256 ${manifest.unit_sha256}\n`);
  process.stdout.write('NOT APPROVED. Look at every sheet, run the §6 self-verify, then approve the unit as a whole.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
