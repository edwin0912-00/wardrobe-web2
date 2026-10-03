#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { inspectTarArchive, validateTarManifest } from './tar-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'release', 'MEDIA.lock.json'), 'utf8'));

export const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

async function fileExists(rootDirectory, relativePath) {
  try {
    return (await stat(path.join(rootDirectory, relativePath))).isFile();
  } catch {
    return false;
  }
}

async function alreadyInstalled(rootDirectory, mediaLock) {
  let marker;
  try {
    marker = JSON.parse(await readFile(path.join(rootDirectory, '.wardrobe-media-bundle.json'), 'utf8'));
  } catch {
    return false;
  }
  if (marker.sha256 !== mediaLock.sha256) return false;
  return (await Promise.all(mediaLock.required_files.map((file) => fileExists(rootDirectory, file)))).every(Boolean);
}

function timeoutError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function installMediaBundle({
  rootDirectory = root,
  mediaLock = lock,
  temporaryRoot = os.tmpdir(),
  fetchImpl = globalThis.fetch,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  onDownload = null,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isInteger(connectTimeoutMs) || connectTimeoutMs < 1) {
    throw new TypeError('connectTimeoutMs must be a positive integer');
  }
  if (!Number.isInteger(downloadTimeoutMs) || downloadTimeoutMs < 1) {
    throw new TypeError('downloadTimeoutMs must be a positive integer');
  }

  const destinationRoot = path.resolve(rootDirectory);
  await mkdir(destinationRoot, { recursive: true });
  if (await alreadyInstalled(destinationRoot, mediaLock)) {
    return { alreadyInstalled: true, sha256: mediaLock.sha256 };
  }

  await mkdir(temporaryRoot, { recursive: true });
  const taskTemporaryDirectory = await mkdtemp(path.join(temporaryRoot, 'wardrobe-alpha-media-'));
  try {
    const archivePath = path.join(taskTemporaryDirectory, `${mediaLock.sha256}.tar.part`);
    onDownload?.({ bundle: mediaLock.bundle, sizeBytes: mediaLock.size_bytes });

    const controller = new AbortController();
    let connectTimer = setTimeout(() => {
      controller.abort(timeoutError('MEDIA_DOWNLOAD_CONNECT_TIMEOUT', 'media bundle connection timed out'));
    }, connectTimeoutMs);
    const downloadTimer = setTimeout(() => {
      controller.abort(timeoutError('MEDIA_DOWNLOAD_TIMEOUT', 'media bundle download timed out'));
    }, downloadTimeoutMs);

    try {
      const response = await fetchImpl(mediaLock.url, {
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(connectTimer);
      connectTimer = null;
      if (!response.ok || !response.body) {
        throw new Error(`download returned HTTP ${response.status}`);
      }
      const lengthHeader = response.headers.get('content-length');
      if (lengthHeader !== null) {
        const declaredLength = Number(lengthHeader);
        if (!Number.isSafeInteger(declaredLength) || declaredLength !== mediaLock.size_bytes) {
          throw new Error(`download length mismatch: expected ${mediaLock.size_bytes}, got ${lengthHeader}`);
        }
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(archivePath, { flags: 'wx' }),
        { signal: controller.signal },
      );
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason ?? error;
      throw error;
    } finally {
      if (connectTimer) clearTimeout(connectTimer);
      clearTimeout(downloadTimer);
    }

    const archiveSize = (await stat(archivePath)).size;
    if (archiveSize !== mediaLock.size_bytes) {
      throw new Error(`archive size mismatch: expected ${mediaLock.size_bytes}, got ${archiveSize}`);
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
    const digest = hash.digest('hex');
    if (digest !== mediaLock.sha256) {
      throw new Error(`archive SHA-256 mismatch: expected ${mediaLock.sha256}, got ${digest}`);
    }

    const manifest = validateTarManifest(inspectTarArchive(archivePath), mediaLock);
    const extraction = spawnSync(
      'tar',
      ['-xf', archivePath, '-C', destinationRoot, ...manifest.map((entry) => entry.name)],
      { encoding: 'utf8' },
    );
    if (extraction.error) throw new Error(`tar extraction could not start: ${extraction.error.message}`);
    if (extraction.status !== 0) {
      throw new Error(`tar extraction failed: ${extraction.stderr?.trim() || 'unknown error'}`);
    }

    const missing = [];
    for (const relativePath of mediaLock.required_files) {
      if (!(await fileExists(destinationRoot, relativePath))) missing.push(relativePath);
    }
    if (missing.length > 0) {
      throw new Error(`required files are missing after extraction: ${missing.join(', ')}`);
    }

    await writeFile(path.join(destinationRoot, '.wardrobe-media-bundle.json'), `${JSON.stringify({
      schema_version: 1,
      bundle: mediaLock.bundle,
      sha256: mediaLock.sha256,
      verified_at: new Date().toISOString(),
    }, null, 2)}\n`);
    return { alreadyInstalled: false, sha256: digest };
  } finally {
    await rm(taskTemporaryDirectory, { recursive: true, force: true });
  }
}

function fail(message) {
  process.stderr.write(`media install failed: ${message}\n`);
  process.exit(1);
}

async function main() {
  try {
    const result = await installMediaBundle({
      onDownload: ({ bundle, sizeBytes }) => {
        process.stdout.write(`Downloading ${bundle} (${Math.round(sizeBytes / 1_000_000)} MB)...\n`);
      },
    });
    if (result.alreadyInstalled) {
      process.stdout.write(`Media bundle already verified: ${result.sha256.slice(0, 12)}\n`);
    } else {
      process.stdout.write(`Media bundle verified and installed: ${result.sha256}\n`);
    }
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
