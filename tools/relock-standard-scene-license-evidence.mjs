#!/usr/bin/env node

// Rebinds published standard-scene packs to the exact checked-in license
// evidence bytes. It changes no source facts, pixels, rights status, approval
// state, preset definition or prompt.

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
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
if (!Array.isArray(catalog.presets) || catalog.presets.length === 0) {
  throw new Error('Published standard-scene catalog must contain presets');
}

const rebuiltIndexes = new Map();
let reboundEvidenceCount = 0;

for (const descriptor of catalog.presets) {
  const directory = path.join(
    root,
    'assets',
    'scene-presets',
    descriptor.preset_id,
    `v${descriptor.preset_version.split('.')[0]}`,
  );
  const [index, sourceLedger, referencePack] = await Promise.all([
    readJson(path.join(directory, 'index.json')),
    readJson(path.join(directory, 'source-ledger.json')),
    readJson(path.join(directory, 'reference-pack.json')),
  ]);

  for (const source of sourceLedger.sources) {
    const evidencePath = path.join(root, source.rights.evidence_uri);
    const evidenceSha = sha256(await readFile(evidencePath));
    if (source.rights.evidence_sha256 !== evidenceSha) reboundEvidenceCount += 1;
    source.rights.evidence_sha256 = evidenceSha;
  }

  referencePack.source_ledger = sourceLedger;
  const sourceLedgerBytes = bytes(sourceLedger);
  const referencePackBytes = bytes(referencePack);
  index.source_ledger_sha256 = sha256(sourceLedgerBytes);
  index.reference_pack_sha256 = sha256(referencePackBytes);

  await Promise.all([
    writeJson(path.join(directory, 'source-ledger.json'), sourceLedger),
    writeJson(path.join(directory, 'reference-pack.json'), referencePack),
    writeJson(path.join(directory, 'index.json'), index),
  ]);

  rebuiltIndexes.set(`${descriptor.preset_id}@${descriptor.preset_version}`, {
    index,
    indexSha256: sha256(bytes(index)),
  });
}

catalog.presets = catalog.presets.map((descriptor) => (
  rebuiltIndexes.get(`${descriptor.preset_id}@${descriptor.preset_version}`)?.index
    ?? descriptor
));
if (Array.isArray(catalog.published_preset_indexes)) {
  for (const descriptor of catalog.published_preset_indexes) {
    const rebuilt = rebuiltIndexes.get(`${descriptor.preset_id}@${descriptor.preset_version}`);
    if (rebuilt) descriptor.index_sha256 = rebuilt.indexSha256;
  }
}
await writeJson(catalogPath, catalog);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  preset_count: catalog.presets.length,
  rebound_evidence_count: reboundEvidenceCount,
}, null, 2)}\n`);
