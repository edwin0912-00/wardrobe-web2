#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { inspectTarArchive, validateTarManifest } from './tar-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'release', 'MEDIA.lock.json'), 'utf8'));
const markerPath = path.join(root, '.wardrobe-media-bundle.json');

async function fileExists(relativePath) {
  try {
    return (await stat(path.join(root, relativePath))).isFile();
  } catch {
    return false;
  }
}

async function alreadyInstalled() {
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    return false;
  }
  if (marker.sha256 !== lock.sha256) return false;
  return (await Promise.all(lock.required_files.map(fileExists))).every(Boolean);
}

function fail(message) {
  process.stderr.write(`media install failed: ${message}\n`);
  process.exit(1);
}

if (await alreadyInstalled()) {
  process.stdout.write(`Media bundle already verified: ${lock.sha256.slice(0, 12)}\n`);
  process.exit(0);
}

const temporaryDirectory = await mkdir(path.join(os.tmpdir(), 'wardrobe-alpha-media'), { recursive: true })
  .then(() => path.join(os.tmpdir(), 'wardrobe-alpha-media'));
const archivePath = path.join(temporaryDirectory, `${lock.sha256}.tar.part`);
await rm(archivePath, { force: true });

process.stdout.write(`Downloading ${lock.bundle} (${Math.round(lock.size_bytes / 1_000_000)} MB)...\n`);
const response = await fetch(lock.url, { redirect: 'follow' });
if (!response.ok || !response.body) fail(`download returned HTTP ${response.status}`);
const declaredLength = Number(response.headers.get('content-length'));
if (Number.isFinite(declaredLength) && declaredLength !== lock.size_bytes) {
  fail(`download length mismatch: expected ${lock.size_bytes}, got ${declaredLength}`);
}
await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath, { flags: 'wx' }));

const archiveSize = (await stat(archivePath)).size;
if (archiveSize !== lock.size_bytes) {
  fail(`archive size mismatch: expected ${lock.size_bytes}, got ${archiveSize}`);
}
const hash = createHash('sha256');
for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
const digest = hash.digest('hex');
if (digest !== lock.sha256) fail(`archive SHA-256 mismatch: expected ${lock.sha256}, got ${digest}`);

try {
  const manifest = validateTarManifest(inspectTarArchive(archivePath), lock);
  const extraction = spawnSync(
    'tar',
    ['-xf', archivePath, '-C', root, ...manifest.map((entry) => entry.name)],
    { encoding: 'utf8' },
  );
  if (extraction.status !== 0) {
    fail(`tar extraction failed: ${extraction.stderr?.trim() || 'unknown error'}`);
  }
} catch (error) {
  fail(error.message);
}
const missing = [];
for (const relativePath of lock.required_files) {
  if (!(await fileExists(relativePath))) missing.push(relativePath);
}
if (missing.length > 0) fail(`required files are missing after extraction: ${missing.join(', ')}`);

await writeFile(markerPath, `${JSON.stringify({
  schema_version: 1,
  bundle: lock.bundle,
  sha256: lock.sha256,
  verified_at: new Date().toISOString(),
}, null, 2)}\n`);
await rm(archivePath, { force: true });
process.stdout.write(`Media bundle verified and installed: ${lock.sha256}\n`);
