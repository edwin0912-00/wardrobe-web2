#!/usr/bin/env node

/**
 * Rebuilds the six neutral editorial blocking guides from the canonical slot
 * facts. These are mechanical references, not generated fashion imagery. Keep
 * the source deterministic so a framing-lock change cannot leave an old guide
 * silently attached to a new request.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'assets', 'editorial-blocking', 'v1');
const magick = '/opt/homebrew/bin/magick';

function renderSvg(svg, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn(magick, [
      '-background', 'none',
      '-font', '/System/Library/Fonts/SFNSMono.ttf',
      'svg:-',
      '-stroke', '#5a5b58', '-strokewidth', '3', '-fill', 'none',
      '-draw', 'rectangle 36,34 854,682 rectangle 910,82 1238,392 line 110,125 780,125 line 110,592 780,592 circle 445,206 503,206 circle 1074,210 1116,210',
      '-type', 'TrueColor', '-strip', destination,
    ]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`magick failed (${code}): ${stderr}`));
    });
    child.stdin.end(svg);
  });
}

const slots = [
  { slot: 'clean_identity_hero', lens: 50, framing: 'three_quarter', subject: [50, 100], above: 6, below: 0, head: false, footwear: false },
  { slot: 'environmental_hero', lens: 50, framing: 'three_quarter', subject: [40, 100], above: 5, below: 0, head: false, footwear: false },
  { slot: 'sculptural_three_quarter', lens: 65, framing: 'three_quarter', subject: [50, 100], above: 5, below: 0, head: false, footwear: false },
  { slot: 'interference_frame', lens: 55, framing: 'three_quarter', subject: [45, 100], above: 4, below: 0, head: false, footwear: false },
  { slot: 'material_or_accessory_detail', lens: 85, framing: 'detail', subject: [45, 100], above: 0, below: 0, head: false, footwear: false },
  { slot: 'wide_campaign_coda', lens: 35, framing: 'wide_full_body', subject: [30, 100], above: 8, below: 2, head: false, footwear: true },
];

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function svgFor(fact) {
  const [min, max] = fact.subject;
  const title = fact.slot.replaceAll('_', ' ').toUpperCase();
  const head = fact.head ? 'REQUIRED' : 'ART-DIRECTION CROP OK';
  const footwear = fact.footwear ? 'REQUIRED' : 'NOT REQUIRED';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#ebe9e4"/>
  <g style="fill:none;stroke:#5a5b58;stroke-width:3">
    <rect x="36" y="34" width="818" height="648" rx="4"/>
    <rect x="910" y="82" width="328" height="310" rx="4"/>
    <line x1="110" y1="125" x2="780" y2="125" stroke-dasharray="10 9"/>
    <line x1="110" y1="592" x2="780" y2="592"/>
    <circle cx="445" cy="206" r="58"/>
    <path d="M400 264 Q445 240 490 264 L535 410 Q445 450 355 410 Z"/>
    <path d="M380 304 L310 485 M510 304 L580 485 M390 415 L360 592 M500 415 L530 592"/>
    <path d="M310 485 L270 592 M580 485 L620 592 M340 592 H382 M508 592 H550"/>
    <circle cx="1074" cy="210" r="42"/>
    <path d="M1030 210 L965 310 M1118 210 L1180 310 M965 310 H1180"/>
  </g>
  <g fill="#30312f" font-family="SFNSMono">
    <text x="48" y="24" font-size="22" letter-spacing="2">BLOCKING — ${esc(title)}</text>
    <text x="70" y="105" font-size="19" letter-spacing="1">TOP EDGE / INTENTIONAL CROP BOUNDARY</text>
    <text x="70" y="635" font-size="19" letter-spacing="1">GROUND / LOWER FRAME BOUNDARY</text>
    <text x="926" y="120" font-size="20" letter-spacing="1">TOP-DOWN PLAN</text>
    <text x="925" y="435" font-size="18">LENS ${fact.lens} MM</text>
    <text x="925" y="468" font-size="18">FRAMING ${esc(fact.framing)}</text>
    <text x="925" y="501" font-size="18">SUBJ HEIGHT ${min}–${max}%</text>
    <text x="925" y="534" font-size="18">HEADROOM TARGET ${fact.above}%</text>
    <text x="925" y="567" font-size="18">FULL HEAD: ${esc(head)}</text>
    <text x="925" y="600" font-size="18">FULL FOOTWEAR: ${esc(footwear)}</text>
    <text x="925" y="647" font-size="15" fill="#666">GEOMETRY AID ONLY · IDENTITY AND ITEMS STAY LOCKED</text>
  </g>
</svg>`;
}

await mkdir(output, { recursive: true });
for (const fact of slots) {
  const svg = svgFor(fact);
  await renderSvg(svg, path.join(output, `${fact.slot}.png`));
}

const manifestPath = path.join(output, 'index.json');
const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'));
manifest.created_at = '2026-08-02T00:00:00.000Z';
manifest.generation.provider_path = 'deterministic_mechanical_guide';
manifest.generation.model_family = 'deterministic_svg_to_png';
manifest.generation.model_version = 'deterministic_svg_to_png';
manifest.diagrams = [];
for (const fact of slots) {
  const file = path.join(output, `${fact.slot}.png`);
  const { stdout: sha256 } = await exec('shasum', ['-a', '256', file]);
  const { stdout: identify } = await exec(magick, ['identify', '-format', '%w %h %[channels]', file]);
  const [width, height, channels] = identify.trim().split(/\s+/);
  manifest.diagrams.push({
    slot: fact.slot,
    file: `assets/editorial-blocking/v1/${fact.slot}.png`,
    sha256: sha256.trim().split(/\s+/)[0],
    media_type: 'image/png',
    width: Number(width),
    height: Number(height),
    drawn_facts: {
      lens_mm: fact.lens,
      framing: fact.framing,
      subject_height_percent: fact.subject,
      minimum_clear_space_percent: { above_hair: fact.above, below_footwear: fact.below },
      require_full_head: fact.head,
      require_full_footwear: fact.footwear,
    },
  });
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
