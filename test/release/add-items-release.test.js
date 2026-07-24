import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..', '..');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function updateLengthPrefixed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

test('add-items release is runtime-only, private-path-free, and tamper-evident', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-add-items-release-test-'));
  const releaseDirectory = path.join(temporaryRoot, 'release');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  await execute(process.execPath, [
    path.join(projectRoot, 'tools', 'build-add-items-release.mjs'),
    releaseDirectory,
  ]);
  const verified = await execute(process.execPath, [
    path.join(projectRoot, 'tools', 'verify-add-items-release.mjs'),
    releaseDirectory,
  ]);
  const result = JSON.parse(verified.stdout);
  assert.equal(result.ok, true);
  assert.ok(result.release_size_bytes < 10 * 1024 * 1024);

  const manifest = JSON.parse(await readFile(
    path.join(releaseDirectory, 'ops', 'add-items-release-manifest.json'),
    'utf8',
  ));
  assert.equal(manifest.package_type, 'RUNTIME_OVERLAY');
  assert.equal(manifest.runtime_state_strategy, 'PRESERVE_EXISTING_RUNTIME_AND_NODE_MODULES');
  assert.match(manifest.cache_token, /^additems-[a-f0-9]{8}-[a-f0-9]{12}$/);
  assert.equal(
    manifest.cache_authority.hash_format,
    'sha256-length-prefixed-path-mode-bytes-v1',
  );
  const authorityPaths = manifest.cache_authority.files.map((entry) => entry.path);
  assert.deepEqual(authorityPaths, [...authorityPaths].sort());
  assert.equal(new Set(authorityPaths).size, authorityPaths.length);
  const authorityHash = createHash('sha256');
  updateLengthPrefixed(authorityHash, 'zeely-cache-authority-v1');
  for (const entry of manifest.cache_authority.files) {
    const sourcePath = path.join(projectRoot, entry.path);
    const sourceInfo = await lstat(sourcePath);
    const sourceBytes = await readFile(sourcePath);
    const sourceMode = (sourceInfo.mode & 0o777).toString(8).padStart(4, '0');
    assert.equal(entry.mode, sourceMode);
    assert.equal(entry.size_bytes, sourceBytes.byteLength);
    assert.equal(entry.sha256, sha256(sourceBytes));
    updateLengthPrefixed(authorityHash, entry.path);
    updateLengthPrefixed(authorityHash, entry.mode);
    updateLengthPrefixed(authorityHash, sourceBytes);
  }
  const authorityDigest = authorityHash.digest('hex');
  assert.equal(manifest.cache_authority.digest_sha256, authorityDigest);
  assert.equal(manifest.cache_token.slice(-12), authorityDigest.slice(0, 12));

  const authorityByPath = new Map(
    manifest.cache_authority.files.map((entry) => [entry.path, entry]),
  );
  const releaseByPath = new Map(
    [...manifest.deploy_files, ...manifest.validation_files]
      .map((entry) => [entry.path, entry]),
  );
  for (const relativePath of manifest.workspace_overlays) {
    const snapshot = authorityByPath.get(relativePath);
    const released = releaseByPath.get(relativePath);
    assert.ok(snapshot, `Missing authority snapshot for ${relativePath}`);
    assert.ok(released, `Missing released overlay for ${relativePath}`);
    assert.equal(released.sha256, snapshot.sha256);
    assert.equal(released.mode, snapshot.mode);
  }
  assert.ok(manifest.deploy_files.every((entry) => entry.deploy === true));
  assert.ok(manifest.validation_files.every((entry) => entry.deploy === false));
  assert.ok([...manifest.deploy_files, ...manifest.validation_files]
    .every((entry) => /^(?:0[4567][0-7]{2})$/.test(entry.mode)));
  assert.ok(
    manifest.deploy_files
      .filter((entry) => entry.path.startsWith('inputs/zeely-test/quality-references/'))
      .every((entry) => entry.mode === '0600'),
  );
  assert.ok(manifest.deploy_files.every((entry) => !entry.path.startsWith('runtime/')));
  assert.ok(manifest.deploy_files.every((entry) => !entry.path.startsWith('secrets/')));
  assert.ok(manifest.deploy_files.every((entry) => !entry.path.startsWith('output/')));
  assert.ok(manifest.deploy_files.every((entry) => !entry.path.startsWith('artifacts/')));

  const releasedApp = await readFile(
    path.join(releaseDirectory, 'web', 'public', 'app.js'),
    'utf8',
  );
  const releasedServerDraft = await readFile(
    path.join(releaseDirectory, 'web', 'public', 'server-draft.js'),
    'utf8',
  );
  const releasedDraftContract = await readFile(
    path.join(releaseDirectory, 'web', 'public', 'draft-file-contract.js'),
    'utf8',
  );
  const releasedDraftService = await readFile(
    path.join(releaseDirectory, 'src', 'web', 'draft-service.js'),
    'utf8',
  );
  const releasedIndex = await readFile(
    path.join(releaseDirectory, 'web', 'public', 'index.html'),
    'utf8',
  );
  assert.ok(releasedApp.includes(`./draft-file-contract.js?v=${manifest.cache_token}`));
  assert.ok(releasedServerDraft.includes(`./draft-file-contract.js?v=${manifest.cache_token}`));
  assert.ok(releasedIndex.includes(`/result.css?v=${manifest.cache_token}`));
  assert.doesNotMatch(releasedServerDraft, /draft-file-contract\.js\?v=20260723-/);
  assert.match(releasedDraftContract, /export async function sha256Blob/);
  assert.match(releasedDraftContract, /left\.sha256 === right\.sha256/);
  assert.match(releasedDraftService, /const DRAFT_MODE_ADD_ITEMS = 'ADD_ITEMS'/);
  assert.match(releasedDraftService, /version:\s*4/);
  assert.match(releasedDraftService, /sha256:\s*item\.sha256/);
  assert.equal(
    releaseByPath.get('web/public/draft-file-contract.js').sha256,
    sha256(releasedDraftContract),
  );

  const appPath = path.join(releaseDirectory, 'web', 'public', 'app.js');
  const originalApp = await readFile(appPath, 'utf8');
  await writeFile(appPath, `${originalApp}\n// tampered\n`);
  await assert.rejects(
    execute(process.execPath, [
      path.join(projectRoot, 'tools', 'verify-add-items-release.mjs'),
      releaseDirectory,
    ]),
    /(?:Size|SHA-256) mismatch/,
  );
});

test('a destination created after staging starts is never overwritten or cleaned up', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-add-items-publish-race-'));
  const releaseDirectory = path.join(temporaryRoot, 'release');
  const sentinelPath = path.join(releaseDirectory, 'belongs-to-another-process.txt');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const child = spawn(process.execPath, [
    path.join(projectRoot, 'tools', 'build-add-items-release.mjs'),
    releaseDirectory,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  const stagingPrefix = '.release.zeely-build-';
  let stagingObserved = false;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && child.exitCode === null) {
    const entries = await readdir(temporaryRoot);
    if (entries.some((entry) => entry.startsWith(stagingPrefix))) {
      stagingObserved = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(stagingObserved, true, `Owned staging was not observed: ${stderr}`);

  await mkdir(releaseDirectory);
  await writeFile(sentinelPath, 'do not delete\n');
  const result = await completion;
  assert.notEqual(result.code, 0);
  assert.equal(await readFile(sentinelPath, 'utf8'), 'do not delete\n');
  assert.equal(
    (await readdir(temporaryRoot)).some((entry) => entry.startsWith(stagingPrefix)),
    false,
  );
});
