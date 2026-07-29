#!/usr/bin/env node

// Rebinds published standard-scene packs after a framing-contract change.
// It changes only the declared subject-height band and all SHA bindings that
// transitively cover that declaration. It never changes pixels, sources or
// approval state.

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const target = Object.freeze([70, 80]);

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function bytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function writeJson(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, bytes(value));
  await rename(temporary, filename);
}

const catalogPath = path.join(root, 'assets', 'scene-presets', 'index.json');
const catalog = await readJson(catalogPath);
if (!Array.isArray(catalog.selected_preset_ids) || catalog.selected_preset_ids.length === 0) {
  throw new Error('Published standard-scene catalog must declare selected_preset_ids');
}

const rebuiltIndexes = new Map();
for (const presetId of catalog.selected_preset_ids) {
  const directory = path.join(root, 'assets', 'scene-presets', presetId, 'v1');
  const [index, preset, referencePack, composition, promptBytes] = await Promise.all([
    readJson(path.join(directory, 'index.json')),
    readJson(path.join(directory, 'preset.json')),
    readJson(path.join(directory, 'reference-pack.json')),
    readJson(path.join(directory, 'composition-reference.json')),
    readFile(path.join(root, 'prompts', 'scene-presets', presetId, 'v1', 'production-scene.txt')),
  ]);
  if (!preset.camera || !composition.facts || !Array.isArray(referencePack.references)) {
    throw new Error(`${presetId}: incomplete published pack`);
  }
  preset.camera.subject_height_percent = [...target];
  composition.facts.subject_height_percent = [...target];
  const presetSha = sha256(bytes(preset));
  const compositionSha = sha256(bytes(composition));
  const promptSha = sha256(promptBytes);
  const compositionReference = referencePack.references.find((item) => item.role === 'composition_anchor');
  const indexCompositionReference = index.references?.find((item) => item.role === 'composition_anchor');
  if (!compositionReference || !indexCompositionReference) {
    throw new Error(`${presetId}: missing composition_anchor binding`);
  }
  compositionReference.sha256 = compositionSha;
  indexCompositionReference.sha256 = compositionSha;
  referencePack.preset_sha256 = presetSha;
  referencePack.prompt_sha256 = promptSha;
  const referencePackSha = sha256(bytes(referencePack));
  index.preset_sha256 = presetSha;
  index.prompt_sha256 = promptSha;
  index.reference_pack_sha256 = referencePackSha;
  await Promise.all([
    writeJson(path.join(directory, 'preset.json'), preset),
    writeJson(path.join(directory, 'composition-reference.json'), composition),
    writeJson(path.join(directory, 'reference-pack.json'), referencePack),
    writeJson(path.join(directory, 'index.json'), index),
  ]);
  rebuiltIndexes.set(`${presetId}@${index.preset_version}`, {
    index,
    sha256: sha256(bytes(index)),
  });
}

if (Array.isArray(catalog.presets)) {
  catalog.presets = catalog.presets.map((entry) => (
    rebuiltIndexes.get(`${entry.preset_id}@${entry.preset_version}`)?.index ?? entry
  ));
}
if (Array.isArray(catalog.published_preset_indexes)) {
  for (const entry of catalog.published_preset_indexes) {
    const rebuilt = rebuiltIndexes.get(`${entry.preset_id}@${entry.preset_version}`);
    if (rebuilt) entry.index_sha256 = rebuilt.sha256;
  }
}
await writeJson(catalogPath, catalog);
process.stdout.write(`${JSON.stringify({ status: 'PASS', packs: rebuiltIndexes.size, subject_height_percent: target }, null, 2)}\n`);
