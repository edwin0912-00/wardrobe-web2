import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installMediaBundle } from '../scripts/fetch-media-bundle.mjs';

async function archiveFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-media-fetch-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  await mkdir(path.join(source, 'assets'), { recursive: true });
  await writeFile(path.join(source, 'assets', 'sample.bin'), Buffer.from('fixture media bytes'));
  const archivePath = path.join(directory, 'fixture.tar');
  const tar = spawnSync('tar', ['-cf', archivePath, '-C', source, 'assets/sample.bin'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const bytes = await readFile(archivePath);
  return {
    bytes,
    lock(url, overrides = {}) {
      return {
        bundle: 'fixture.tar',
        url,
        size_bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        file_count: 1,
        allowed_prefixes: ['assets/'],
        required_files: ['assets/sample.bin'],
        ...overrides,
      };
    },
  };
}

async function localServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  return `http://127.0.0.1:${server.address().port}/bundle`;
}

async function tempRoot(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-media-fetch-temp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('concurrent installs use separate temp directories and verify exact bundles', async (t) => {
  const fixture = await archiveFixture(t);
  const workspace = await tempRoot(t);
  const temporaryRoot = path.join(workspace, 'download-tmp');
  await mkdir(temporaryRoot);
  let requestCount = 0;
  let signalBothRequests;
  const bothRequests = new Promise((resolve) => { signalBothRequests = resolve; });
  let releaseResponses;
  const responsesReady = new Promise((resolve) => { releaseResponses = resolve; });
  const url = await localServer(t, async (_request, response) => {
    requestCount += 1;
    if (requestCount === 2) signalBothRequests();
    await responsesReady;
    response.writeHead(200, { 'content-length': String(fixture.bytes.length) });
    response.end(fixture.bytes);
  });
  const firstRoot = path.join(workspace, 'checkout-one');
  const secondRoot = path.join(workspace, 'checkout-two');
  const first = installMediaBundle({ rootDirectory: firstRoot, temporaryRoot, mediaLock: fixture.lock(url) });
  const second = installMediaBundle({ rootDirectory: secondRoot, temporaryRoot, mediaLock: fixture.lock(url) });
  const guard = setTimeout(() => signalBothRequests(), 3000);
  await bothRequests;
  clearTimeout(guard);

  const temporaryEntries = await readdir(temporaryRoot);
  assert.equal(temporaryEntries.length, 2);
  assert.equal(new Set(temporaryEntries).size, 2);
  assert.ok((await Promise.all(temporaryEntries.map((entry) => stat(path.join(temporaryRoot, entry))))).every((info) => info.isDirectory()));

  releaseResponses();
  const results = await Promise.all([first, second]);
  assert.ok(results.every((result) => result.sha256 === fixture.lock(url).sha256));
  assert.deepEqual(await readFile(path.join(firstRoot, 'assets', 'sample.bin')), Buffer.from('fixture media bytes'));
  assert.deepEqual(await readFile(path.join(secondRoot, 'assets', 'sample.bin')), Buffer.from('fixture media bytes'));
  assert.deepEqual(await readdir(temporaryRoot), []);
});

test('truncated transfer fails the locked size check and removes its private temp directory', async (t) => {
  const fixture = await archiveFixture(t);
  const temporaryRoot = await tempRoot(t);
  const rootDirectory = path.join(temporaryRoot, 'checkout');
  const url = await localServer(t, (_request, response) => {
    response.writeHead(200);
    response.end(fixture.bytes.subarray(0, fixture.bytes.length - 1));
  });

  await assert.rejects(
    installMediaBundle({ rootDirectory, temporaryRoot, mediaLock: fixture.lock(url) }),
    /archive size mismatch/,
  );
  assert.deepEqual(await readdir(temporaryRoot), ['checkout']);
  await assert.rejects(readFile(path.join(rootDirectory, '.wardrobe-media-bundle.json')), { code: 'ENOENT' });
});

test('bad archive hash fails closed and removes the downloaded partial', async (t) => {
  const fixture = await archiveFixture(t);
  const temporaryRoot = await tempRoot(t);
  const url = await localServer(t, (_request, response) => {
    response.writeHead(200, { 'content-length': String(fixture.bytes.length) });
    response.end(fixture.bytes);
  });

  await assert.rejects(
    installMediaBundle({
      rootDirectory: path.join(temporaryRoot, 'checkout'),
      temporaryRoot,
      mediaLock: fixture.lock(url, { sha256: '0'.repeat(64) }),
    }),
    /archive SHA-256 mismatch/,
  );
  assert.deepEqual(await readdir(temporaryRoot), ['checkout']);
  await assert.rejects(readFile(path.join(temporaryRoot, 'checkout', '.wardrobe-media-bundle.json')), { code: 'ENOENT' });
});

test('a stalled response is aborted at the total download deadline and cleaned up', async (t) => {
  const fixture = await archiveFixture(t);
  const temporaryRoot = await tempRoot(t);
  const url = await localServer(t, (_request, response) => {
    response.writeHead(200, { 'content-length': String(fixture.bytes.length) });
    response.flushHeaders();
    response.write(fixture.bytes.subarray(0, 8));
  });

  await assert.rejects(
    installMediaBundle({
      rootDirectory: path.join(temporaryRoot, 'checkout'),
      temporaryRoot,
      mediaLock: fixture.lock(url),
      connectTimeoutMs: 1000,
      downloadTimeoutMs: 50,
    }),
    (error) => error.code === 'MEDIA_DOWNLOAD_TIMEOUT',
  );
  assert.deepEqual(await readdir(temporaryRoot), ['checkout']);
});

test('a stalled connection is aborted at the connect deadline and cleaned up', async (t) => {
  const fixture = await archiveFixture(t);
  const temporaryRoot = await tempRoot(t);
  const url = await localServer(t, () => {});

  await assert.rejects(
    installMediaBundle({
      rootDirectory: path.join(temporaryRoot, 'checkout'),
      temporaryRoot,
      mediaLock: fixture.lock(url),
      connectTimeoutMs: 50,
      downloadTimeoutMs: 1000,
    }),
    (error) => error.code === 'MEDIA_DOWNLOAD_CONNECT_TIMEOUT',
  );
  assert.deepEqual(await readdir(temporaryRoot), ['checkout']);
});
