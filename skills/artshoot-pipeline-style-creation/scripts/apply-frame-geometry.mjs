#!/usr/bin/env node
// Apply a unit's whole-frame geometry to a generated frame: roll, then crop to the exact delivery.
//
//   node apply-frame-geometry.mjs <in.png> <out.png> --roll -6 --width 1024 --height 1280
//
// Why this exists rather than a sentence in a prompt. Camera roll was asked for in the prompt, in the
// blocking diagram and on the camera board, and came back level all three times. Roll is not
// something the subject does, it is what the camera is — a geometric property of the whole frame,
// already known exactly, and therefore never a generative model's job. Same family as aspect ratio
// and delivery size (Rule 5).
//
// Every delivered pixel is the provider's own, turned. Nothing is invented and nothing is padded: the
// rotation leaves transparent corners, and the crop's whole purpose is to fall entirely inside the
// rotated image so those corners never reach the delivery. If the requested crop cannot fit, this
// fails loudly rather than shipping a frame with a soft empty corner — that would be the blur-padding
// mistake wearing a different hat.
//
// The generation that feeds this must leave margin: no limb, hand or crown touching a frame edge.
// Generate square or wider than the delivery, then rotate and crop.

import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const input = args[0];
const output = args[1];
const roll = Number(flag('roll', 0));
const width = Number(flag('width', 1024));
const height = Number(flag('height', 1280));

if (!input || !output || input.startsWith('--')) {
  process.stderr.write('usage: apply-frame-geometry.mjs <in.png> <out.png> [--roll deg] [--width n] [--height n]\n');
  process.exit(1);
}
if (!Number.isFinite(roll) || Math.abs(roll) > 45) {
  process.stderr.write('--roll must be a finite angle within ±45°; beyond that the crop cannot survive\n');
  process.exit(1);
}
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
  process.stderr.write('--width and --height must be positive integers\n');
  process.exit(1);
}

// sharp does arbitrary-angle rotation with a real resample. It is the one dependency here, and it is
// already present wherever this pipeline runs; the alternative is hand-rolling bilinear resampling,
// which is a lot of code to get subtly wrong.
const require = createRequire(import.meta.url);
let sharp;
for (const candidate of [
  'sharp',
  '/Users/jarvis1/.local/share/madeforthisjob/.zeely-deploy/state/node_modules/sharp',
]) {
  try { sharp = require(candidate); break; } catch { /* try the next */ }
}
if (!sharp) {
  process.stderr.write('sharp is not resolvable. Install it, or run this where the pipeline lives.\n');
  process.exit(1);
}

// The largest w×h rectangle, at the delivery aspect, that fits inside a source of `sw`×`sh` rotated by
// `deg`. Derived rather than guessed: a rotated rectangle's inscribed axis-aligned box shrinks by
// |cos| and |sin| mixing both source dimensions, so the limit is whichever of width or height binds
// first.
function inscribedBox(sw, sh, deg, aspect) {
  const a = Math.abs((deg * Math.PI) / 180);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Solve for the tallest h such that (h*aspect, h) fits: w = h*aspect must satisfy both
  // w*cos + h*sin <= sw and w*sin + h*cos <= sh.
  const hByWidth = sw / (aspect * cos + sin);
  const hByHeight = sh / (aspect * sin + cos);
  const h = Math.floor(Math.min(hByWidth, hByHeight));
  return { width: Math.floor(h * aspect), height: h };
}

const rotated = await sharp(input)
  .rotate(roll, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
const meta = await sharp(rotated).metadata();
const source = await sharp(input).metadata();

const aspect = width / height;
const box = inscribedBox(source.width, source.height, roll, aspect);
if (box.height < 8 || box.width < 8) {
  process.stderr.write(`a ${roll}° roll leaves no usable ${width}×${height} crop inside ${source.width}×${source.height}\n`);
  process.exit(1);
}

// Centre the crop in the rotated canvas. Rounding down keeps it strictly inside, so a transparent
// corner can never survive into the delivery.
const left = Math.floor((meta.width - box.width) / 2);
const top = Math.floor((meta.height - box.height) / 2);

await sharp(rotated)
  .extract({ left, top, width: box.width, height: box.height })
  .resize({ width, height, fit: 'fill', kernel: 'lanczos3' })
  .flatten({ background: { r: 0, g: 0, b: 0 } })
  .toColourspace('srgb')
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(output);

// Printed so the receipt can record what geometry actually did, rather than what it was asked to do.
process.stdout.write(JSON.stringify({
  file: path.basename(output),
  source: `${source.width}x${source.height}`,
  roll_deg: roll,
  rotated: `${meta.width}x${meta.height}`,
  inscribed_crop: `${box.width}x${box.height}`,
  delivered: `${width}x${height}`,
  crop_fraction_of_source: Number((1 - (box.width * box.height) / (source.width * source.height)).toFixed(4)),
  strategy: 'declared_roll_then_inscribed_crop',
}, null, 2) + '\n');
