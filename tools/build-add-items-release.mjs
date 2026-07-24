#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertResourceCapacity } from './lib/resource-preflight.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArgument = process.argv[2];

if (!outputArgument) {
  throw new Error('Usage: node tools/build-add-items-release.mjs /absolute/new/output-directory');
}

const outputDirectory = path.resolve(outputArgument);
if (outputDirectory === projectRoot || projectRoot.startsWith(`${outputDirectory}${path.sep}`)) {
  throw new Error('Release output must not contain the workspace');
}
const outputParent = path.dirname(outputDirectory);
await mkdir(outputParent, { recursive: true });
await assertResourceCapacity({ mode: 'build', rootDirectory: outputParent });
await assertOutputAbsent();
const temporaryDirectory = await mkdtemp(path.join(
  outputParent,
  `.${path.basename(outputDirectory)}.zeely-build-`,
));
const releaseDirectory = path.join(temporaryDirectory, 'release');
const archivePath = path.join(temporaryDirectory, 'head.tar');
await mkdir(releaseDirectory, { mode: 0o700 });

const cleanHeadFiles = [
  'package.json',
  'package-lock.json',
  'config',
  'prompts',
  'schemas',
  'src',
  'web',
  'inputs/zeely-test/quality-references',
  'tools/run-web-daemon.sh',
  'tools/run-monitor-daemon.sh',
];

const fullWorkspaceFiles = [
  'src/web/draft-service.js',
  'web/public/add-items-flow.js',
  'web/public/draft-file-contract.js',
  'web/public/server-draft.js',
  'web/public/experience.css',
  'web/public/result.css',
  'web/public/upload.css',
  'tools/run-web-daemon.sh',
  'tools/run-monitor-daemon.sh',
  'tools/verify-add-items-release.mjs',
  'test/web/add-items-flow.test.js',
  'test/web/add-items-accessibility.test.js',
  'test/web/draft-file-contract.test.js',
  'test/web/server-draft.test.js',
  'test/web/draft-service.test.js',
  'test/web/profile-service.test.js',
  'test/web/profile-app-integration.test.js',
];

const cacheAuthorityFiles = [
  ...new Set([
    ...fullWorkspaceFiles,
    'src/web/profile-service.js',
    'web/public/app.js',
    'web/public/profile-client.js',
    'web/public/index.html',
  ]),
];

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

const forbiddenReleaseRoots = new Set([
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

async function assertOutputAbsent() {
  try {
    await lstat(outputDirectory);
    throw new Error(`Release output already exists: ${outputDirectory}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function snapshotCacheAuthorityFiles(relativePaths) {
  const snapshots = [];
  for (const relativePath of [...relativePaths].sort()) {
    const sourcePath = path.join(projectRoot, relativePath);
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new Error(`Cache authority must be a real file: ${relativePath}`);
    }
    const bytes = await readFile(sourcePath);
    snapshots.push({
      path: relativePath,
      mode: (sourceInfo.mode & 0o777).toString(8).padStart(4, '0'),
      bytes,
    });
  }
  return snapshots;
}

function updateLengthPrefixed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

function cacheAuthorityDigest(snapshots) {
  const hash = createHash('sha256');
  updateLengthPrefixed(hash, 'zeely-cache-authority-v1');
  for (const snapshot of snapshots) {
    updateLengthPrefixed(hash, snapshot.path);
    updateLengthPrefixed(hash, snapshot.mode);
    updateLengthPrefixed(hash, snapshot.bytes);
  }
  return hash.digest('hex');
}

async function writeWorkspaceSnapshot(snapshot) {
  const target = path.join(releaseDirectory, snapshot.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, snapshot.bytes);
  await chmod(target, Number.parseInt(snapshot.mode, 8));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isDeployFile(relativePath) {
  return deployRoots.some((entry) => (
    entry.endsWith('/')
      ? relativePath.startsWith(entry)
      : relativePath === entry
  ));
}

async function releaseFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    const fileInfo = await lstat(absolutePath);
    if (fileInfo.isSymbolicLink()) {
      throw new Error(`Release must not contain symlinks: ${relativePath}`);
    }
    if (fileInfo.isDirectory()) {
      files.push(...await releaseFiles(absolutePath, relativePath));
      continue;
    }
    if (!fileInfo.isFile()) {
      throw new Error(`Unsupported release entry: ${relativePath}`);
    }
    const root = relativePath.split('/')[0];
    if (forbiddenReleaseRoots.has(root)) {
      throw new Error(`Forbidden release root was included: ${root}`);
    }
    const bytes = await readFile(absolutePath);
    files.push({
      path: relativePath,
      size_bytes: bytes.byteLength,
      sha256: sha256(bytes),
      mode: (fileInfo.mode & 0o777).toString(8).padStart(4, '0'),
      deploy: isDeployFile(relativePath),
    });
  }
  return files;
}

function replaceRequired(source, expected, replacement, label) {
  if (!source.includes(expected)) {
    throw new Error(`Release transform marker is missing: ${label}`);
  }
  return source.replace(expected, replacement);
}

function replaceUniquePattern(source, pattern, replacement, label) {
  if (!(pattern instanceof RegExp) || !pattern.global) {
    throw new Error(`Release transform pattern must be global: ${label}`);
  }
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Release transform marker must occur exactly once: ${label} (found ${matches.length})`,
    );
  }
  const [{ index, 0: matched }] = matches;
  return `${source.slice(0, index)}${replacement}${source.slice(index + matched.length)}`;
}

function replaceRegion(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) {
    throw new Error(`Release transform region is missing: ${label}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

try {
  const { stdout: baseCommitStdout } = await execute('git', [
    '-C',
    projectRoot,
    'rev-parse',
    'HEAD',
  ]);
  const baseCommit = baseCommitStdout.trim();
  const authoritySnapshots = await snapshotCacheAuthorityFiles(cacheAuthorityFiles);
  const authoritySnapshotByPath = new Map(
    authoritySnapshots.map((snapshot) => [snapshot.path, snapshot]),
  );
  const authorityDigest = cacheAuthorityDigest(authoritySnapshots);
  const releaseCacheToken = `additems-${baseCommit.slice(0, 8)}-${authorityDigest.slice(0, 12)}`;
  await execute('git', [
    '-C',
    projectRoot,
    'archive',
    '--format=tar',
    '--output',
    archivePath,
    'HEAD',
    '--',
    ...cleanHeadFiles,
  ]);
  await execute('tar', ['-xf', archivePath, '-C', releaseDirectory]);

  for (const relativePath of fullWorkspaceFiles) {
    await writeWorkspaceSnapshot(authoritySnapshotByPath.get(relativePath));
  }

  const currentProfileService = authoritySnapshotByPath
    .get('src/web/profile-service.js').bytes.toString('utf8');
  let profileService = await readFile(
    path.join(releaseDirectory, 'src/web/profile-service.js'),
    'utf8',
  );
  profileService = replaceRequired(
    profileService,
    `        source_avatar_id TEXT,
        saved_avatar_id TEXT,
        saved_look_id TEXT,
        claimed_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
        FOREIGN KEY (source_avatar_id) REFERENCES avatars(avatar_id) ON DELETE CASCADE
`,
    `        source_avatar_id TEXT,
        source_look_id TEXT,
        saved_avatar_id TEXT,
        saved_look_id TEXT,
        claimed_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
        FOREIGN KEY (source_avatar_id) REFERENCES avatars(avatar_id) ON DELETE CASCADE,
        FOREIGN KEY (source_look_id) REFERENCES looks(look_id) ON DELETE SET NULL
`,
    'source look claim schema',
  );
  profileService = replaceRequired(
    profileService,
    `      CREATE TABLE IF NOT EXISTS pending_run_deletions (
        run_id TEXT PRIMARY KEY,
        queued_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      ) STRICT;
    \`);
  }
`,
    `      CREATE TABLE IF NOT EXISTS pending_run_deletions (
        run_id TEXT PRIMARY KEY,
        queued_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      ) STRICT;
    \`);
    const claimColumns = this.database.prepare('PRAGMA table_info(run_claims)').all();
    if (!claimColumns.some((column) => column.name === 'source_look_id')) {
      this.database.exec(\`
        ALTER TABLE run_claims
        ADD COLUMN source_look_id TEXT REFERENCES looks(look_id) ON DELETE SET NULL
      \`);
    }
  }
`,
    'source look additive migration',
  );
  const currentClaimStart = currentProfileService.indexOf('  assertAddItemsSource(');
  const currentClaimEnd = currentProfileService.indexOf('  getClaim(', currentClaimStart);
  if (currentClaimStart < 0 || currentClaimEnd <= currentClaimStart) {
    throw new Error('Current source-lineage claim implementation is missing');
  }
  profileService = replaceRegion(
    profileService,
    '  claimRun(',
    '  getClaim(',
    currentProfileService.slice(currentClaimStart, currentClaimEnd),
    'source-lineage claim implementation',
  );
  const currentGetClaimStart = currentProfileService.indexOf('  getClaim(');
  const currentGetClaimEnd = currentProfileService.indexOf('  saveClaimedRun(', currentGetClaimStart);
  profileService = replaceRegion(
    profileService,
    '  getClaim(',
    '  saveClaimedRun(',
    currentProfileService.slice(currentGetClaimStart, currentGetClaimEnd),
    'source-lineage claim read',
  );
  const currentSaveStart = currentProfileService.indexOf('  saveClaimedRun(');
  const currentSaveEnd = currentProfileService.indexOf('  avatarAsset(', currentSaveStart);
  profileService = replaceRegion(
    profileService,
    '  saveClaimedRun(',
    '  avatarAsset(',
    currentProfileService.slice(currentSaveStart, currentSaveEnd),
    'derived look parent lineage',
  );
  const currentClaimHelperStart = currentProfileService.indexOf('  async function claimRunForRequest(');
  const currentClaimHelperEnd = currentProfileService.indexOf(
    '  async function serveProfileImage(',
    currentClaimHelperStart,
  );
  profileService = replaceRegion(
    profileService,
    '  async function claimRunForRequest(',
    '  async function serveProfileImage(',
    currentProfileService.slice(currentClaimHelperStart, currentClaimHelperEnd),
    'lineage-aware HTTP claim helper',
  );
  const currentClaimRouteStart = currentProfileService.indexOf(
    "  app.post('/api/profile/runs/:runId/claim'",
  );
  const currentClaimRouteEnd = currentProfileService.indexOf(
    "  app.post('/api/profile/runs/:runId/save'",
    currentClaimRouteStart,
  );
  profileService = replaceRegion(
    profileService,
    "  app.post('/api/profile/runs/:runId/claim'",
    "  app.post('/api/profile/runs/:runId/save'",
    currentProfileService.slice(currentClaimRouteStart, currentClaimRouteEnd),
    'lineage-aware HTTP claim route',
  );
  await writeFile(path.join(releaseDirectory, 'src/web/profile-service.js'), profileService);

  let appSource = authoritySnapshotByPath.get('web/public/app.js').bytes.toString('utf8');
  for (const [moduleName, expectedVersion] of [
    ['server-draft.js', '20260723-13'],
    ['draft-file-contract.js', '20260723-1'],
    ['profile-client.js', '20260724-5'],
    ['add-items-flow.js', '20260723-4'],
  ]) {
    appSource = replaceRequired(
      appSource,
      `./${moduleName}?v=${expectedVersion}`,
      `./${moduleName}?v=${releaseCacheToken}`,
      `${moduleName} release cache token`,
    );
  }
  appSource = replaceUniquePattern(
    appSource,
    /^import \{ createSceneUi \} from '\.\/scene-ui\.js\?v=[0-9A-Za-z._-]+';\r?\n/gm,
    `import { createSceneUi } from './scene-ui-disabled.js?v=${releaseCacheToken}';\n`,
    'disabled scene UI import',
  );
  await writeFile(path.join(releaseDirectory, 'web/public/app.js'), appSource);

  let serverDraftSource = authoritySnapshotByPath
    .get('web/public/server-draft.js').bytes.toString('utf8');
  serverDraftSource = replaceRequired(
    serverDraftSource,
    './draft-file-contract.js?v=20260723-1',
    `./draft-file-contract.js?v=${releaseCacheToken}`,
    'server draft SHA contract cache token',
  );
  await writeFile(
    path.join(releaseDirectory, 'web/public/server-draft.js'),
    serverDraftSource,
  );

  let profileClient = authoritySnapshotByPath
    .get('web/public/profile-client.js').bytes.toString('utf8');
  const sceneExportsStart = profileClient.indexOf('export function loadScenePresets()');
  const avatarFileStart = profileClient.indexOf('export async function avatarFileFromProfile');
  if (sceneExportsStart < 0 || avatarFileStart <= sceneExportsStart) {
    throw new Error('Profile client scene export markers are missing');
  }
  profileClient = `${profileClient.slice(0, sceneExportsStart)}export function listProfileLookEditorialShoots() {
  return Promise.resolve({ shoots: [] });
}

${profileClient.slice(avatarFileStart)}`;
  await writeFile(path.join(releaseDirectory, 'web/public/profile-client.js'), profileClient);

  let indexSource = authoritySnapshotByPath.get('web/public/index.html').bytes.toString('utf8');
  indexSource = replaceUniquePattern(
    indexSource,
    /^  <link rel="stylesheet" href="\/scene\.css\?v=[0-9A-Za-z._-]+">\r?\n/gm,
    '',
    'scene stylesheet',
  );
  indexSource = replaceRequired(
    indexSource,
    '<body>',
    '<body class="scene-disabled">',
    'body release class',
  );
  indexSource = replaceRequired(
    indexSource,
    '                  <button id="create-scene" class="secondary-result-action" type="button" disabled>Створити сцену</button>',
    '                  <button id="create-scene" class="secondary-result-action hidden" type="button" disabled hidden aria-hidden="true">Сцени вимкнено</button>',
    'result scene action',
  );
  const sceneViewStart = indexSource.indexOf('        <div id="scene-view"');
  const failureViewStart = indexSource.indexOf('        <div id="failure-view"', sceneViewStart);
  if (sceneViewStart < 0 || failureViewStart <= sceneViewStart) {
    throw new Error('Scene view boundary markers are missing');
  }
  indexSource = `${indexSource.slice(0, sceneViewStart)}`
    + '        <div id="scene-view" class="scene-view hidden" hidden aria-hidden="true"></div>\n'
    + `${indexSource.slice(failureViewStart)}`;
  indexSource = replaceRequired(
    indexSource,
    '  <link rel="stylesheet" href="/upload.css?v=20260723-2">',
    `  <link rel="stylesheet" href="/upload.css?v=${releaseCacheToken}">`,
    'upload stylesheet cache token',
  );
  indexSource = replaceRequired(
    indexSource,
    '  <link rel="stylesheet" href="/experience.css?v=20260723-6">',
    `  <link rel="stylesheet" href="/experience.css?v=${releaseCacheToken}">`,
    'experience stylesheet cache token',
  );
  indexSource = replaceRequired(
    indexSource,
    '  <link rel="stylesheet" href="/result.css?v=20260723-3">',
    `  <link rel="stylesheet" href="/result.css?v=${releaseCacheToken}">`,
    'result stylesheet cache token',
  );
  indexSource = replaceUniquePattern(
    indexSource,
    /^  <script type="module" src="\/app\.js\?v=[0-9A-Za-z._-]+"><\/script>$/gm,
    `  <script type="module" src="/app.js?v=${releaseCacheToken}"></script>`,
    'release app cache token',
  );
  indexSource = replaceRequired(
    indexSource,
    '</head>',
    `  <link rel="stylesheet" href="/add-items-release.css?v=${releaseCacheToken}">\n</head>`,
    'release stylesheet',
  );
  await writeFile(path.join(releaseDirectory, 'web/public/index.html'), indexSource);

  await writeFile(
    path.join(releaseDirectory, 'web/public/scene-ui-disabled.js'),
    `export function createSceneUi() {
  const unavailable = async () => {
    throw new Error('Сцени ще не входять до цього релізу');
  };
  return {
    resume: async () => false,
    stopWatching() {},
    openForLook: unavailable,
    openExisting: unavailable,
  };
}
`,
  );
  await writeFile(
    path.join(releaseDirectory, 'web/public/add-items-release.css'),
    `.scene-disabled #create-scene,
.scene-disabled .profile-scene-action,
.scene-disabled .profile-scene-status,
.scene-disabled #scene-view {
  display: none !important;
}
`,
  );

  const qualityReferenceDirectory = path.join(
    releaseDirectory,
    'inputs',
    'zeely-test',
    'quality-references',
  );
  for (const entry of await readdir(qualityReferenceDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      throw new Error(`Unsupported quality reference entry: ${entry.name}`);
    }
    await chmod(path.join(qualityReferenceDirectory, entry.name), 0o600);
  }

  const fileInventory = await releaseFiles(releaseDirectory);
  const deployFiles = fileInventory.filter((entry) => entry.deploy);
  const validationFiles = fileInventory.filter((entry) => !entry.deploy);
  const contentDigest = sha256(Buffer.from(JSON.stringify(fileInventory)));
  const manifest = {
    schema_version: '1.1.0',
    release: 'ADD_ITEMS_V1',
    base: 'HEAD',
    base_commit: baseCommit,
    cache_token: releaseCacheToken,
    cache_authority: {
      hash_format: 'sha256-length-prefixed-path-mode-bytes-v1',
      digest_sha256: authorityDigest,
      files: authoritySnapshots.map((snapshot) => ({
        path: snapshot.path,
        mode: snapshot.mode,
        size_bytes: snapshot.bytes.byteLength,
        sha256: sha256(snapshot.bytes),
      })),
    },
    package_type: 'RUNTIME_OVERLAY',
    runtime_state_strategy: 'PRESERVE_EXISTING_RUNTIME_AND_NODE_MODULES',
    atomic_protocol: [
      'draft_mode',
      'source_avatar_id',
      'source_look_id',
      'sha256_file_descriptors',
      'ordered_file_manifest_v1',
    ],
    disabled: ['scene_routes', 'scene_runtime', 'scene_ui'],
    workspace_overlays: fullWorkspaceFiles.filter(
      (relativePath) => relativePath !== 'web/public/server-draft.js',
    ),
    transformed: [
      'src/web/profile-service.js',
      'web/public/app.js',
      'web/public/server-draft.js',
      'web/public/profile-client.js',
      'web/public/index.html',
    ],
    generated: [
      'web/public/scene-ui-disabled.js',
      'web/public/add-items-release.css',
    ],
    excluded_roots: [...forbiddenReleaseRoots].sort(),
    content_digest_sha256: contentDigest,
    release_size_bytes: fileInventory.reduce((total, entry) => total + entry.size_bytes, 0),
    deploy_files: deployFiles,
    validation_files: validationFiles,
  };
  await mkdir(path.join(releaseDirectory, 'ops'), { recursive: true });
  await writeFile(
    path.join(releaseDirectory, 'ops/add-items-release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await assertOutputAbsent();
  await rename(releaseDirectory, outputDirectory);
  process.stdout.write(`${outputDirectory}\n`);
} catch (error) {
  throw error;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
