#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const releaseArgument = process.argv[2];
if (!releaseArgument) {
  throw new Error('Usage: node tools/verify-add-items-release.mjs /absolute/release-directory');
}

const releaseDirectory = path.resolve(releaseArgument);
const manifestRelativePath = 'ops/add-items-release-manifest.json';
const manifestPath = path.join(releaseDirectory, manifestRelativePath);
const forbiddenRoots = new Set([
  'artifacts',
  'docs',
  'evidence',
  'fixtures',
  'jobs',
  'node_modules',
  'output',
  'plans',
  'reviews',
  'runtime',
  'secrets',
  'spec',
]);
const deployRoots = [
  'package.json',
  'package-lock.json',
  'config/',
  'prompts/',
  'schemas/',
  'src/',
  'web/',
  'inputs/zeely-test/quality-references/',
  'tools/run-web-daemon.sh',
  'tools/run-monitor-daemon.sh',
];
const privateTextPatterns = [
  { label: 'macOS home path', pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: 'Linux home path', pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { label: 'Windows home path', pattern: /[A-Za-z]:\\Users\\[^\\]+\\/i },
  { label: 'OpenAI-style secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Google-style secret', pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Engram secret', pattern: /\bek_live_[A-Za-z0-9_-]{12,}\b/ },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRelativePath(value) {
  assert(typeof value === 'string' && value.length > 0, 'Manifest file path is missing');
  assert(value === value.replaceAll('\\', '/'), `Manifest path is not POSIX-normalized: ${value}`);
  assert(!path.posix.isAbsolute(value), `Manifest path must be relative: ${value}`);
  const normalized = path.posix.normalize(value);
  assert(normalized === value && normalized !== '..' && !normalized.startsWith('../'), `Unsafe manifest path: ${value}`);
  return normalized;
}

function isDeployPath(relativePath) {
  return deployRoots.some((entry) => (
    entry.endsWith('/')
      ? relativePath.startsWith(entry)
      : relativePath === entry
  ));
}

async function walk(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    const fileInfo = await lstat(absolutePath);
    assert(!fileInfo.isSymbolicLink(), `Release contains a symlink: ${relativePath}`);
    if (fileInfo.isDirectory()) {
      files.push(...await walk(absolutePath, relativePath));
      continue;
    }
    assert(fileInfo.isFile(), `Release contains an unsupported entry: ${relativePath}`);
    files.push(relativePath);
  }
  return files;
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert(manifest.schema_version === '1.1.0', 'Unexpected release manifest schema');
assert(manifest.release === 'ADD_ITEMS_V1', 'Unexpected release identifier');
assert(manifest.package_type === 'RUNTIME_OVERLAY', 'Release must be a runtime overlay');
assert(
  manifest.runtime_state_strategy === 'PRESERVE_EXISTING_RUNTIME_AND_NODE_MODULES',
  'Release must preserve existing runtime state and installed dependencies',
);
assert(/^[a-f0-9]{40}$/.test(manifest.base_commit), 'Release base_commit must be a full Git SHA-1');
assert(/^[a-f0-9]{64}$/.test(manifest.content_digest_sha256), 'Release content digest is invalid');
assert(/^additems-[a-f0-9]{8}-[a-f0-9]{12}$/.test(manifest.cache_token), 'Release cache token is invalid');
assert(Array.isArray(manifest.deploy_files) && manifest.deploy_files.length > 0, 'Release has no deploy files');
assert(Array.isArray(manifest.validation_files), 'Release validation_files is invalid');

const records = [...manifest.deploy_files, ...manifest.validation_files]
  .map((record) => {
    const relativePath = safeRelativePath(record.path);
    assert(Number.isSafeInteger(record.size_bytes) && record.size_bytes >= 0, `Invalid size for ${relativePath}`);
    assert(/^[a-f0-9]{64}$/.test(record.sha256), `Invalid SHA-256 for ${relativePath}`);
    assert(/^(?:0[4567][0-7]{2})$/.test(record.mode), `Invalid file mode for ${relativePath}`);
    assert(typeof record.deploy === 'boolean', `Missing deploy flag for ${relativePath}`);
    return { ...record, path: relativePath };
  })
  .sort((left, right) => left.path.localeCompare(right.path));
const recordPaths = records.map((record) => record.path);
assert(new Set(recordPaths).size === recordPaths.length, 'Release manifest contains duplicate paths');
const normalizedRecordPaths = recordPaths.map((recordPath) => (
  recordPath.normalize('NFC').toLocaleLowerCase('en-US')
));
assert(
  new Set(normalizedRecordPaths).size === normalizedRecordPaths.length,
  'Release manifest contains case/Unicode-colliding paths',
);
assert(
  manifest.deploy_files.every((record) => record.deploy === true && isDeployPath(record.path)),
  'deploy_files contains a validation or non-allowlisted path',
);
assert(
  manifest.validation_files.every((record) => record.deploy === false && !isDeployPath(record.path)),
  'validation_files contains a deploy path or deploy flag',
);

const actualPaths = (await walk(releaseDirectory))
  .filter((relativePath) => relativePath !== manifestRelativePath)
  .sort((left, right) => left.localeCompare(right));
assert(
  JSON.stringify(actualPaths) === JSON.stringify(recordPaths),
  'Release file set does not match the manifest',
);

for (const record of records) {
  const root = record.path.split('/')[0];
  assert(!forbiddenRoots.has(root), `Forbidden release root is present: ${root}`);
  assert(!/(^|\/)\.env(?:\.|$)/.test(record.path), `Environment file is present: ${record.path}`);
  assert(!/\.(?:key|pem|p12|pfx)$/i.test(record.path), `Private key material is present: ${record.path}`);
  const bytes = await readFile(path.join(releaseDirectory, record.path));
  const fileInfo = await lstat(path.join(releaseDirectory, record.path));
  const actualMode = (fileInfo.mode & 0o777).toString(8).padStart(4, '0');
  assert(actualMode === record.mode, `File mode mismatch for ${record.path}`);
  assert((fileInfo.mode & 0o022) === 0, `Group/world-writable release file: ${record.path}`);
  assert((fileInfo.mode & 0o6000) === 0, `setuid/setgid release file: ${record.path}`);
  assert(bytes.byteLength === record.size_bytes, `Size mismatch for ${record.path}`);
  assert(sha256(bytes) === record.sha256, `SHA-256 mismatch for ${record.path}`);
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  for (const candidate of privateTextPatterns) {
    assert(!candidate.pattern.test(text), `${candidate.label} found in deploy file ${record.path}`);
  }
}

const calculatedSize = records.reduce((total, record) => total + record.size_bytes, 0);
assert(calculatedSize === manifest.release_size_bytes, 'Release size total does not match the manifest');
assert(
  sha256(Buffer.from(JSON.stringify(records))) === manifest.content_digest_sha256,
  'Release content digest does not match its file inventory',
);

const indexHtml = await readFile(path.join(releaseDirectory, 'web/public/index.html'), 'utf8');
assert(indexHtml.includes(`app.js?v=${manifest.cache_token}`), 'Release app cache token is missing');
assert(indexHtml.includes(`upload.css?v=${manifest.cache_token}`), 'Upload stylesheet cache token is missing');
assert(indexHtml.includes(`experience.css?v=${manifest.cache_token}`), 'Experience stylesheet cache token is missing');
assert(indexHtml.includes(`result.css?v=${manifest.cache_token}`), 'Result stylesheet cache token is missing');
assert(indexHtml.includes(`add-items-release.css?v=${manifest.cache_token}`), 'Release stylesheet cache token is missing');
assert(!indexHtml.includes('/scene.css'), 'Scene stylesheet is still reachable');
assert(indexHtml.includes('id="scene-view" class="scene-view hidden" hidden'), 'Scene view is not disabled');

const appSource = await readFile(path.join(releaseDirectory, 'web/public/app.js'), 'utf8');
for (const moduleName of [
  'server-draft.js',
  'draft-file-contract.js',
  'profile-client.js',
  'add-items-flow.js',
  'scene-ui-disabled.js',
]) {
  assert(
    appSource.includes(`./${moduleName}?v=${manifest.cache_token}`),
    `Release cache token is missing for ${moduleName}`,
  );
}
assert(!appSource.includes("from './scene-ui.js"), 'Live scene UI adapter is still imported');

const serverDraftSource = await readFile(
  path.join(releaseDirectory, 'web/public/server-draft.js'),
  'utf8',
);
assert(
  serverDraftSource.includes(`./draft-file-contract.js?v=${manifest.cache_token}`),
  'Server draft client can load a stale SHA draft contract',
);
const draftContractSource = await readFile(
  path.join(releaseDirectory, 'web/public/draft-file-contract.js'),
  'utf8',
);
assert(
  draftContractSource.includes('sha256Blob')
    && draftContractSource.includes('sameDraftFile')
    && draftContractSource.includes('reconcileDraftFileBindings'),
  'Released browser draft contract does not enforce SHA-bound reconciliation',
);
const draftServiceSource = await readFile(
  path.join(releaseDirectory, 'src/web/draft-service.js'),
  'utf8',
);
assert(
  /const DRAFT_MODE_ADD_ITEMS = 'ADD_ITEMS'/.test(draftServiceSource)
    && /version:\s*4/.test(draftServiceSource)
    && /sha256:\s*item\.sha256/.test(draftServiceSource),
  'Released server draft is not compatible with v4 ADD_ITEMS SHA descriptors',
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  release: manifest.release,
  base_commit: manifest.base_commit,
  deploy_files: manifest.deploy_files.length,
  validation_files: manifest.validation_files.length,
  release_size_bytes: manifest.release_size_bytes,
  cache_token: manifest.cache_token,
  content_digest_sha256: manifest.content_digest_sha256,
})}\n`);
