#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const catalogPath = path.join(root, 'config', 'scene-presets.json');
const defaultAssets = path.join(root, 'assets', 'scene-mood-cards');
const defaultOutput = path.join(root, 'output', 'scene-mvp');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) args._.push(value);
    else {
      const key = value.slice(2);
      const next = argv[index + 1];
      args[key] = next && !next.startsWith('--') ? argv[++index] : true;
    }
  }
  return args;
}

async function sha256File(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeId(value) {
  if (!/^[a-z0-9._-]+$/.test(value)) throw new Error(`Invalid preset id: ${value}`);
  return value;
}

async function loadCatalog(filename = catalogPath) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

function allEntries(catalog) {
  return [
    ...catalog.standard_presets.map((preset) => ({
      id: preset.preset_id,
      kind: 'standard',
      family: preset.family,
      name: preset.ui_name_uk,
      promptPath: preset.prompt_path,
    })),
    ...catalog.editorial_program.modes.map((mode) => ({
      id: mode.preset_id,
      kind: 'editorial',
      family: 'edwin_novak',
      name: mode.ui_name_uk,
      promptPath: mode.prompt_path,
    })),
  ];
}

async function normalize({ id, input, assetsDirectory = defaultAssets, position = 'south' }) {
  const catalog = await loadCatalog();
  const entry = allEntries(catalog).find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown preset id: ${id}`);
  await access(input);
  await mkdir(assetsDirectory, { recursive: true });
  const output = path.join(assetsDirectory, `${safeId(id)}.webp`);
  const prompt = await readFile(path.join(root, entry.promptPath), 'utf8');
  const sourceMeta = await sharp(input).metadata();
  await sharp(input)
    .rotate()
    .resize({ width: 1024, height: 1280, fit: 'cover', position })
    .webp({ quality: 91, effort: 5, smartSubsample: true })
    .withMetadata({
      exif: {
        IFD0: {
          ImageDescription: `Zeely scene mood card ${id}`,
          Copyright: 'Zeely internal generated reference',
        },
      },
    })
    .toFile(output);
  const finalMeta = await sharp(output).metadata();
  const metadata = {
    schema_version: '1.0.0',
    preset_id: id,
    kind: entry.kind,
    family: entry.family,
    ui_name_uk: entry.name,
    asset_role: 'mood_card',
    file: path.relative(root, output),
    sha256: await sha256File(output),
    prompt_path: entry.promptPath,
    prompt_sha256: sha256Text(prompt),
    generation: {
      provider_path: 'codex_builtin_imagegen',
      model_family: 'gpt-image-2',
      model_version: 'builtin-current',
      source_width: sourceMeta.width,
      source_height: sourceMeta.height,
      crop_position: position,
    },
    delivery: {
      width: finalMeta.width,
      height: finalMeta.height,
      format: finalMeta.format,
      aspect_ratio: '4:5',
    },
    contains_personal_input: false,
    approval: 'PENDING_VISUAL_JUDGE',
    created_at: new Date().toISOString(),
  };
  await writeFile(path.join(assetsDirectory, `${safeId(id)}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'normalized', output, metadata }, null, 2)}\n`);
}

async function reframe({ id, assetsDirectory = defaultAssets, left, top, width, height }) {
  const catalog = await loadCatalog();
  const entry = allEntries(catalog).find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown preset id: ${id}`);
  const crop = Object.fromEntries(Object.entries({ left, top, width, height }).map(([key, value]) => [key, Number(value)]));
  if (Object.values(crop).some((value) => !Number.isInteger(value) || value < 0)) throw new Error('reframe crop values must be non-negative integers');
  if (!crop.width || !crop.height || Math.abs(crop.width / crop.height - 0.8) > 0.002) throw new Error('reframe crop must use a 4:5 aspect ratio');
  const output = path.join(assetsDirectory, `${safeId(id)}.webp`);
  const metadataPath = path.join(assetsDirectory, `${safeId(id)}.json`);
  const [input, metadata] = await Promise.all([
    readFile(output),
    readFile(metadataPath, 'utf8').then(JSON.parse),
  ]);
  const sourceMeta = await sharp(input).metadata();
  if (crop.left + crop.width > sourceMeta.width || crop.top + crop.height > sourceMeta.height) throw new Error(`reframe crop exceeds ${sourceMeta.width}x${sourceMeta.height}`);
  const inputSha256 = createHash('sha256').update(input).digest('hex');
  const temporary = `${output}.tmp-${process.pid}`;
  await sharp(input)
    .extract(crop)
    .resize({ width: 1024, height: 1280, fit: 'fill' })
    .webp({ quality: 91, effort: 5, smartSubsample: true })
    .withMetadata({
      exif: {
        IFD0: {
          ImageDescription: `Zeely scene mood card ${id}`,
          Copyright: 'Zeely internal generated reference',
        },
      },
    })
    .toFile(temporary);
  await rename(temporary, output);
  metadata.sha256 = await sha256File(output);
  metadata.generation.reframe = {
    method: 'deterministic_4x5_extract',
    input_sha256: inputSha256,
    source_width: sourceMeta.width,
    source_height: sourceMeta.height,
    crop_px: crop,
  };
  metadata.approval = 'PENDING_VISUAL_JUDGE';
  metadata.created_at = new Date().toISOString();
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'reframed', output, metadata }, null, 2)}\n`);
}

function xmlEscape(value) {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));
}

async function buildContactSheet(entries, assetsDirectory, outputPath, columns) {
  const tileWidth = 420;
  const imageHeight = 525;
  const labelHeight = 76;
  const gap = 20;
  const padding = 28;
  const rows = Math.ceil(entries.length / columns);
  const width = padding * 2 + columns * tileWidth + (columns - 1) * gap;
  const height = padding * 2 + rows * (imageHeight + labelHeight) + (rows - 1) * gap;
  const composites = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = padding + column * (tileWidth + gap);
    const top = padding + row * (imageHeight + labelHeight + gap);
    const buffer = await sharp(path.join(assetsDirectory, `${entry.id}.webp`))
      .resize(tileWidth, imageHeight, { fit: 'cover', position: 'centre' })
      .toBuffer();
    composites.push({ input: buffer, left, top });
    const label = Buffer.from(`
      <svg width="${tileWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#111611"/>
        <text x="18" y="29" fill="#f4f7ef" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700">${xmlEscape(entry.name)}</text>
        <text x="18" y="54" fill="#b8ff3d" font-family="Menlo, Consolas, monospace" font-size="12">${xmlEscape(entry.id)}</text>
      </svg>`);
    composites.push({ input: label, left, top: top + imageHeight });
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#eef1eb' } })
    .composite(composites)
    .jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
    .toFile(outputPath);
}

async function packageAssets({ assetsDirectory = defaultAssets, outputDirectory = defaultOutput }) {
  const catalog = await loadCatalog();
  const entries = allEntries(catalog);
  const manifestEntries = [];
  for (const entry of entries) {
    const metadataPath = path.join(assetsDirectory, `${entry.id}.json`);
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const actualHash = await sha256File(path.join(root, metadata.file));
    if (actualHash !== metadata.sha256) throw new Error(`${entry.id}: metadata hash mismatch`);
    manifestEntries.push(metadata);
  }
  await mkdir(outputDirectory, { recursive: true });
  await buildContactSheet(entries.filter((entry) => entry.kind === 'standard'), assetsDirectory, path.join(outputDirectory, 'standard-scenes-contact-sheet.jpg'), 2);
  await buildContactSheet(entries.filter((entry) => entry.kind === 'editorial'), assetsDirectory, path.join(outputDirectory, 'edwin-directions-contact-sheet.jpg'), 2);
  const manifest = {
    schema_version: '1.0.0',
    catalog_id: catalog.catalog_id,
    catalog_status: catalog.status,
    asset_count: manifestEntries.length,
    generated_with_personal_inputs: false,
    files: manifestEntries,
    contact_sheets: [
      'output/scene-mvp/standard-scenes-contact-sheet.jpg',
      'output/scene-mvp/edwin-directions-contact-sheet.jpg',
    ],
    created_at: new Date().toISOString(),
  };
  await writeFile(path.join(outputDirectory, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'packaged', asset_count: manifestEntries.length, output_directory: outputDirectory }, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
try {
  if (command === 'normalize') {
    if (!args.id || !args.input) throw new Error('normalize requires --id and --input');
    await normalize({ id: args.id, input: path.resolve(args.input), assetsDirectory: args.assets ? path.resolve(args.assets) : defaultAssets, position: args.position ?? 'south' });
  } else if (command === 'reframe') {
    if (!args.id || args.left === undefined || args.top === undefined || args.width === undefined || args.height === undefined) throw new Error('reframe requires --id, --left, --top, --width and --height');
    await reframe({ id: args.id, assetsDirectory: args.assets ? path.resolve(args.assets) : defaultAssets, left: args.left, top: args.top, width: args.width, height: args.height });
  } else if (command === 'package') {
    await packageAssets({ assetsDirectory: args.assets ? path.resolve(args.assets) : defaultAssets, outputDirectory: args.output ? path.resolve(args.output) : defaultOutput });
  } else {
    throw new Error('Usage: scene-mood-card.mjs normalize --id <preset> --input <image> | reframe --id <preset> --left <px> --top <px> --width <px> --height <px> | package');
  }
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
