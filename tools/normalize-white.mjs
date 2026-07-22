#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizeWhiteFile } from '../src/qa/white-normalizer.mjs';

function parseArguments(argv) {
  const result = {
    outputDir: 'output',
    minimumChannel: 245,
    maximumChroma: 10,
    backup: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--output') result.outputDir = argv[++index];
    else if (token === '--min-channel') result.minimumChannel = Number(argv[++index]);
    else if (token === '--max-chroma') result.maximumChroma = Number(argv[++index]);
    else if (token === '--backup') result.backup = true;
    else if (token === '--help') result.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return result;
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(
    'Usage: node tools/normalize-white.mjs [--output output] [--min-channel 245] [--max-chroma 10] [--backup]\n',
  );
  process.exit(0);
}

const outputDir = path.resolve(options.outputDir);
const entries = await readdir(outputDir, { withFileTypes: true });
const subjectIds = entries
  .filter((entry) => entry.isDirectory() && /^\d{3}$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
if (subjectIds.length === 0) throw new Error(`No NNN output folders found in ${outputDir}`);

const results = [];
for (const subjectId of subjectIds) {
  for (const filename of ['avatar.png', 'avatar_outfit.png']) {
    results.push(await normalizeWhiteFile(path.join(outputDir, subjectId, filename), options));
  }
}
process.stdout.write(`${JSON.stringify({
  algorithm: '4-connected flood-fill from image border; no global thresholding',
  results,
  totals: {
    files: results.length,
    changed_pixels: results.reduce((sum, item) => sum + item.changed_pixels, 0),
    exact_white_pixels_before: results.reduce((sum, item) => sum + item.exact_white_pixels_before, 0),
    exact_white_pixels_after: results.reduce((sum, item) => sum + item.exact_white_pixels_after, 0),
  },
}, null, 2)}\n`);

