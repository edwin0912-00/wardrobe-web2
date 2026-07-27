#!/usr/bin/env node
// Build one shoot unit: seven sheets, a master gamma, a manifest.
//
// Dependency-free on purpose. This runs on whatever machine holds the frames, and a skill that
// needs an npm install before it can be used is a skill that gets skipped.
//
// Usage:
//   OPENROUTER_API_KEY=$(cat <keyfile>) node build-unit.mjs <unit-dir>
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

const HEX = /^#[0-9a-fA-F]{6}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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
  return Buffer.from(match[1], 'base64');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const unitDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');

  const unit = JSON.parse(await readFile(path.join(unitDir, 'unit.json'), 'utf8'));

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

  const apiKey = String(process.env.OPENROUTER_API_KEY ?? '').trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for the OpenRouter transport (read it from a file; never inline it). Use --dry-run to run the gate alone.');

  // Already written above the dry-run return, so the colour authority exists even if generation dies.
  const strip = stripOnly;

  const results = [];

  for (const id of REQUIRED_SHEETS) {
    const sheet = unit.sheets[id];
    const aspect = sheet.aspect ?? '16:9';
    let bytes;
    let attempt = 0;
    // Three attempts, because a text-heavy sheet occasionally comes back with unreadable labels and
    // the cheapest fix is another draw. More than three means the prompt is wrong, not the draw.
    while (attempt < 3) {
      attempt += 1;
      try {
        bytes = await generateSheet({ apiKey, prompt: sheet.prompt, aspect });
        if (pngSize(bytes) || bytes.length > 20_000) break;
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
    palette_authority: { path: 'palette-strip.svg', sha256: sha256(Buffer.from(strip)), rendered_not_generated: true },
    source_frames: unit.source_frames,
    unknowns: unit.unknowns,
    sheets: results,
    // Bound so a later frame cannot claim this unit while a sheet has been swapped underneath it.
    unit_sha256: sha256(Buffer.from(results.map((r) => `${r.sheet_id}:${r.sha256}`).join('\n'))),
    generated_with: { model: MODEL, transport: 'openrouter' },
  };
  await writeFile(path.join(unitDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(`\nunit_sha256 ${manifest.unit_sha256}\n`);
  process.stdout.write('NOT APPROVED. Look at every sheet, run the §6 self-verify, then approve the unit as a whole.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
