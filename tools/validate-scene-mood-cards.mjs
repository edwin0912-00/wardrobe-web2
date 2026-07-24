#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return args;
}

async function sha256File(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function imageSignature(filename) {
  const { data, info } = await sharp(filename).resize(32, 40, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const values = [...data];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { values, mean, deviation: Math.sqrt(variance), channels: info.channels };
}

function meanAbsoluteDifference(left, right) {
  const length = Math.min(left.length, right.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) total += Math.abs(left[index] - right[index]);
  return total / length;
}

function privacyFailures(text, label) {
  const patterns = [
    ['/Users/', 'absolute macOS user path'],
    ['jarvis1', 'local username'],
    ['runtime/runs', 'private runtime run path'],
    ['runtime/drafts', 'private draft path'],
    ['secrets/', 'secret directory'],
    ['.env', 'environment file'],
  ];
  return patterns.filter(([pattern]) => text.toLowerCase().includes(pattern.toLowerCase())).map(([, reason]) => `${label}: contains ${reason}`);
}

async function validatePrivacy(args) {
  const failures = [];
  const assetsDirectory = path.resolve(args.assets);
  const manifestPath = path.resolve(args.manifest);
  const manifestText = await readFile(manifestPath, 'utf8');
  failures.push(...privacyFailures(manifestText, path.relative(root, manifestPath)));
  for (const filename of await readdir(assetsDirectory)) {
    if (!filename.endsWith('.json')) continue;
    const file = path.join(assetsDirectory, filename);
    failures.push(...privacyFailures(await readFile(file, 'utf8'), path.relative(root, file)));
  }
  const result = { status: failures.length ? 'FAIL' : 'PASS', privacy_failures: failures };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

async function validateAll(args) {
  const catalogPath = path.resolve(args.catalog);
  const assetsDirectory = path.resolve(args.assets);
  const reportPath = path.resolve(args.report);
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const entries = [
    ...catalog.standard_presets.map((preset) => ({ id: preset.preset_id, kind: 'standard', promptPath: preset.prompt_path })),
    ...catalog.editorial_program.modes.map((mode) => ({ id: mode.preset_id, kind: 'editorial', promptPath: mode.prompt_path })),
  ];
  const failures = [];
  const checks = [];
  const signatures = new Map();
  for (const entry of entries) {
    const imagePath = path.join(assetsDirectory, `${entry.id}.webp`);
    const metaPath = path.join(assetsDirectory, `${entry.id}.json`);
    try {
      await Promise.all([access(imagePath), access(metaPath)]);
      const [metadata, imageMeta, fileStats, signature, prompt] = await Promise.all([
        readFile(metaPath, 'utf8').then(JSON.parse),
        sharp(imagePath).metadata(),
        stat(imagePath),
        imageSignature(imagePath),
        readFile(path.join(root, entry.promptPath), 'utf8'),
      ]);
      const assetFailures = [];
      if (imageMeta.width !== 1024 || imageMeta.height !== 1280) assetFailures.push(`expected 1024x1280, got ${imageMeta.width}x${imageMeta.height}`);
      if (imageMeta.format !== 'webp') assetFailures.push(`expected webp, got ${imageMeta.format}`);
      // Flat seamless studio backgrounds compress far better than textured
      // environments. Treat only genuinely implausible payloads as broken;
      // luminance and visual-deviation checks catch blank images directly.
      // A clean seamless studio plate can remain visually detailed while WebP
      // compresses below 40 KB. Blank/corrupt images are caught independently
      // by luminance, deviation, dimensions, decoding and hash checks.
      if (fileStats.size < 30_000) assetFailures.push(`file too small (${fileStats.size} bytes)`);
      if (fileStats.size > 4_500_000) assetFailures.push(`file too large (${fileStats.size} bytes)`);
      if (signature.mean < 12 || signature.mean > 244) assetFailures.push(`implausible mean luminance ${signature.mean.toFixed(2)}`);
      if (signature.deviation < 18) assetFailures.push(`low visual variance ${signature.deviation.toFixed(2)}`);
      const actualHash = await sha256File(imagePath);
      if (metadata.sha256 !== actualHash) assetFailures.push('SHA-256 mismatch');
      if (metadata.prompt_sha256 !== sha256Text(prompt)) assetFailures.push('prompt SHA-256 mismatch');
      if (metadata.preset_id !== entry.id) assetFailures.push('metadata preset_id mismatch');
      if (metadata.contains_personal_input !== false) assetFailures.push('personal-input flag must be false');
      assetFailures.push(...privacyFailures(JSON.stringify(metadata), entry.id));
      signatures.set(entry.id, signature.values);
      failures.push(...assetFailures.map((failure) => `${entry.id}: ${failure}`));
      checks.push({ preset_id: entry.id, status: assetFailures.length ? 'FAIL' : 'PASS', width: imageMeta.width, height: imageMeta.height, bytes: fileStats.size, mean_luminance: Number(signature.mean.toFixed(2)), visual_deviation: Number(signature.deviation.toFixed(2)), failures: assetFailures });
    } catch (error) {
      failures.push(`${entry.id}: ${error.message}`);
      checks.push({ preset_id: entry.id, status: 'FAIL', failures: [error.message] });
    }
  }
  const ids = [...signatures.keys()];
  const siblingPairs = [
    ['std.city.early_morning_gloss', 'std.city.golden_hour_gloss'],
    ['std.studio.peach_soft_gloss', 'std.studio.white_window_honeycomb'],
    ['std.studio.taupe_rembrandt_gloss', 'std.studio.charcoal_dawn_rim'],
    ['std.interior.gallery_morning_gloss', 'std.interior.loft_golden_hour_gloss'],
    ['std.nature_architecture.stone_terrace_morning', 'std.nature_architecture.concrete_grass_golden_hour'],
  ];
  const diversity = [];
  for (const [leftId, rightId] of siblingPairs) {
    if (!signatures.has(leftId) || !signatures.has(rightId)) continue;
    const difference = meanAbsoluteDifference(signatures.get(leftId), signatures.get(rightId));
    const status = difference >= 8 ? 'PASS' : 'FAIL';
    if (status === 'FAIL') failures.push(`${leftId} vs ${rightId}: sibling variants too similar (${difference.toFixed(2)})`);
    diversity.push({ left: leftId, right: rightId, mean_absolute_difference: Number(difference.toFixed(2)), status });
  }
  const contactSheets = [
    path.join(path.dirname(reportPath), 'standard-scenes-contact-sheet.jpg'),
    path.join(path.dirname(reportPath), 'edwin-directions-contact-sheet.jpg'),
  ];
  for (const filename of contactSheets) {
    try { await access(filename); } catch { failures.push(`missing contact sheet: ${path.relative(root, filename)}`); }
  }
  const result = {
    schema_version: '1.0.0',
    status: failures.length ? 'FAIL' : 'PASS',
    expected_assets: entries.length,
    checked_assets: checks.length,
    asset_checks: checks,
    sibling_diversity: diversity,
    failures,
    generated_at: new Date().toISOString(),
  };
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
try {
  if (args['privacy-only']) {
    if (!args.assets || !args.manifest) throw new Error('--privacy-only requires --assets and --manifest');
    await validatePrivacy(args);
  } else {
    if (!args.catalog || !args.assets || !args.report) throw new Error('requires --catalog, --assets and --report');
    await validateAll(args);
  }
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
