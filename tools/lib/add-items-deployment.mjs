import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const TERMINAL_RUN_STATUSES = new Set([
  'CANCELLED',
  'COMPLETED',
  'FAILED',
  'NEEDS_INPUT',
]);
const SCENE_STATUSES = new Set([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
const ACTIVE_SCENE_STATUSES = new Set(['QUEUED', 'RUNNING']);
const EDITORIAL_SHOOT_STATUSES = new Set([
  'BIBLE_PENDING_APPROVAL',
  'HERO_RUNNING',
  'HERO_PENDING_APPROVAL',
  'SERIES_RUNNING',
  'NEEDS_RETRY',
  'COMPLETED',
  'CANCELLED',
]);
const ACTIVE_EDITORIAL_SHOOT_STATUSES = new Set(['HERO_RUNNING', 'SERIES_RUNNING']);
const SAFE_RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RUNTIME_STATE_JSON_LIMIT = 4 * 1024 * 1024;

const DEPLOY_ROOTS = [
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

const PRODUCT_EDITORIAL_PREVIEW_FILES = new Set([
  'assets/scene-mood-cards/editorial.edwin_novak.institutional_modernism.json',
  'assets/scene-mood-cards/editorial.edwin_novak.institutional_modernism.webp',
  'assets/scene-mood-cards/editorial.edwin_novak.luminous_blue_white.json',
  'assets/scene-mood-cards/editorial.edwin_novak.luminous_blue_white.webp',
  'assets/scene-mood-cards/editorial.edwin_novak.organic_contrast.json',
  'assets/scene-mood-cards/editorial.edwin_novak.organic_contrast.webp',
  'assets/scene-mood-cards/editorial.edwin_novak.urban_monochrome.json',
  'assets/scene-mood-cards/editorial.edwin_novak.urban_monochrome.webp',
]);

const PRODUCT_DEPLOY_ROOTS = [
  'package.json',
  'package-lock.json',
  'assets/editorial-blocking/',
  'assets/scene-presets/',
  // The only docs subtree permitted in a product overlay: immutable Create
  // Universe units consumed by the production resolver.
  'docs/style-units/',
  'config/',
  'prompts/',
  'schemas/',
  'src/',
  'web/',
  'tools/run-web-daemon.sh',
  'tools/run-monitor-daemon.sh',
];

const RELEASE_DESCRIPTORS = Object.freeze([
  Object.freeze({
    releaseType: 'ADD_ITEMS_V1',
    manifestRelativePath: 'ops/add-items-release-manifest.json',
    schemaVersion: '1.1.0',
  }),
  Object.freeze({
    releaseType: 'PRODUCT_SCENES_V1',
    manifestRelativePath: 'ops/product-release-manifest.json',
    schemaVersion: '1.0.0',
  }),
]);

const TRANSACTION_ID_PATTERN = /^\d{14}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRE_SWITCH_PHASES = new Set([
  'VERIFIED',
  'CANDIDATE_READY',
  'STOPPED',
  'DATABASE_BACKED_UP',
  'SWITCH_PREPARED',
]);
const OWNER_JSON_LIMIT = 16 * 1024;
const JOURNAL_JSON_LIMIT = 1024 * 1024;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

export function safeRelativePath(value) {
  invariant(typeof value === 'string' && value.length > 0, 'Release path is missing');
  invariant(value === value.replaceAll('\\', '/'), `Release path is not POSIX-normalized: ${value}`);
  invariant(!path.posix.isAbsolute(value), `Release path must be relative: ${value}`);
  const normalized = path.posix.normalize(value);
  invariant(
    normalized === value && normalized !== '..' && !normalized.startsWith('../'),
    `Unsafe release path: ${value}`,
  );
  return normalized;
}

export function isDeployPath(relativePath) {
  return DEPLOY_ROOTS.some((entry) => (
    entry.endsWith('/')
      ? relativePath.startsWith(entry)
      : relativePath === entry
  ));
}

export function isProductDeployPath(relativePath) {
  return PRODUCT_EDITORIAL_PREVIEW_FILES.has(relativePath)
    || PRODUCT_DEPLOY_ROOTS.some((entry) => (
      entry.endsWith('/')
        ? relativePath.startsWith(entry)
        : relativePath === entry
    ));
}

function collisionKey(relativePath) {
  return relativePath.normalize('NFC').toLocaleLowerCase('en-US');
}

async function syncFile(filePath) {
  const handle = await open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directoryPath) {
  const handle = await open(directoryPath, 'r');
  try {
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
  } finally {
    await handle.close();
  }
}

async function pathExists(candidatePath) {
  try {
    await lstat(candidatePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readBoundedJson(filePath, label, maximumBytes) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(`${label} is missing or unsafe`);
  }
  try {
    const info = await handle.stat();
    invariant(info.isFile(), `${label} is not a regular file`);
    invariant(info.size > 0 && info.size <= maximumBytes, `${label} has an invalid size`);
    const raw = await handle.readFile({ encoding: 'utf8' });
    try {
      const parsed = JSON.parse(raw);
      invariant(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${label} is not an object`);
      return parsed;
    } catch (error) {
      if (error.message === `${label} is not an object`) throw error;
      throw new Error(`${label} is malformed`);
    }
  } finally {
    await handle.close();
  }
}

function safeVersionName(value) {
  invariant(typeof value === 'string' && value.length > 0 && value.length <= 255, 'Journal previous version name is invalid');
  invariant(value === value.normalize('NFC'), 'Journal previous version name is not Unicode-normalized');
  invariant(/^[A-Za-z0-9._-]+$/.test(value), 'Journal previous version name contains unsafe characters');
  invariant(value !== '.' && value !== '..' && path.basename(value) === value, 'Journal previous version name is unsafe');
  return value;
}

async function assertRealDirectory(directoryPath, label) {
  const info = await lstat(directoryPath);
  invariant(info.isDirectory() && !info.isSymbolicLink(), `${label} is not a real directory`);
}

async function ensureDirectory(directoryPath, mode = 0o700) {
  await mkdir(directoryPath, { recursive: true, mode });
  const info = await lstat(directoryPath);
  invariant(info.isDirectory() && !info.isSymbolicLink(), `Expected a real directory: ${directoryPath}`);
}

async function ensureParentDirectories(root, relativePath) {
  const segments = path.posix.dirname(relativePath).split('/').filter((segment) => segment !== '.');
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!await pathExists(current)) {
      await mkdir(current, { mode: 0o755 });
    }
    const info = await lstat(current);
    invariant(info.isDirectory() && !info.isSymbolicLink(), `Unsafe candidate parent: ${relativePath}`);
  }
}

export async function loadPinnedRelease({
  releaseDirectory,
  expectedContentDigest,
  expectedManifestSha256,
  expectedBaseCommit = null,
}) {
  const resolvedRelease = path.resolve(releaseDirectory);
  const discovered = [];
  for (const descriptor of RELEASE_DESCRIPTORS) {
    const candidate = path.join(resolvedRelease, descriptor.manifestRelativePath);
    try {
      const info = await lstat(candidate);
      invariant(
        info.isFile() && !info.isSymbolicLink(),
        `Release manifest is unsafe: ${descriptor.manifestRelativePath}`,
      );
      discovered.push({ ...descriptor, manifestPath: candidate });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  invariant(discovered.length > 0, 'Release manifest is missing');
  invariant(discovered.length === 1, 'Release contains multiple supported manifests');
  const descriptor = discovered[0];
  const manifestPath = descriptor.manifestPath;
  const manifestBytes = await readFile(manifestPath);
  const manifestSha256 = sha256(manifestBytes);
  invariant(
    manifestSha256 === expectedManifestSha256,
    'Release manifest SHA-256 does not match the pinned value',
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  invariant(manifest.schema_version === descriptor.schemaVersion, 'Unsupported release manifest schema');
  invariant(manifest.release === descriptor.releaseType, 'Release identifier does not match its manifest');
  invariant(manifest.package_type === 'RUNTIME_OVERLAY', 'Release is not a runtime overlay');
  invariant(
    manifest.runtime_state_strategy === 'PRESERVE_EXISTING_RUNTIME_AND_NODE_MODULES',
    'Release does not preserve runtime state and installed dependencies',
  );
  invariant(
    manifest.content_digest_sha256 === expectedContentDigest,
    'Release content digest does not match the pinned value',
  );
  if (expectedBaseCommit !== null) {
    invariant(manifest.base_commit === expectedBaseCommit, 'Release base commit does not match the pinned value');
  }
  invariant(Array.isArray(manifest.deploy_files) && manifest.deploy_files.length > 0, 'Release has no deploy files');
  if (descriptor.releaseType === 'ADD_ITEMS_V1') {
    invariant(Array.isArray(manifest.validation_files), 'Release validation inventory is invalid');
  } else {
    invariant(manifest.validation_files === undefined, 'Product release cannot contain validation files');
    invariant(manifest.features?.scene_api === 'ENABLED', 'Product scene API is not enabled');
    invariant(manifest.features?.scene_runtime === 'ENABLED', 'Product scene runtime is not enabled');
    invariant(manifest.features?.scene_ui === 'ENABLED', 'Product scene UI is not enabled');
    invariant(manifest.features?.editorial_preview === 'ACTIVE', 'Product editorial catalog is not active');
    invariant(
      manifest.features?.editorial_generation === 'ENABLED'
        && Array.isArray(manifest.disabled)
        && manifest.disabled.length === 0
        && manifest.editorial_preview?.status === 'ACTIVE'
        && manifest.editorial_preview?.generation === 'ENABLED'
        // Exact mode authority is verified by verify-product-release.mjs from
        // the candidate's own strict source packs. Deployment must not repeat
        // a stale hard-coded catalog here: that previously rejected a valid
        // 14-style release while the builder and trusted verifier accepted it.
        && Array.isArray(manifest.editorial_preview?.mode_ids)
        && manifest.editorial_preview.mode_ids.length > 0
        && new Set(manifest.editorial_preview.mode_ids).size
          === manifest.editorial_preview.mode_ids.length
        && Array.isArray(manifest.editorial_preview?.generation_mode_ids)
        && manifest.editorial_preview.generation_mode_ids.length > 0
        && new Set(manifest.editorial_preview.generation_mode_ids).size
          === manifest.editorial_preview.generation_mode_ids.length
        && manifest.editorial_preview.generation_mode_ids.every(
          (modeId) => manifest.editorial_preview.mode_ids.includes(modeId),
        ),
      'Product editorial generation authority is not enabled for the exact approved modes',
    );
  }

  const records = [
    ...manifest.deploy_files,
    ...(descriptor.releaseType === 'ADD_ITEMS_V1' ? manifest.validation_files : []),
  ];
  const exactPaths = new Set();
  const normalizedPaths = new Map();
  for (const record of records) {
    const relativePath = safeRelativePath(record.path);
    invariant(!exactPaths.has(relativePath), `Duplicate release path: ${relativePath}`);
    exactPaths.add(relativePath);
    const key = collisionKey(relativePath);
    invariant(
      !normalizedPaths.has(key),
      `Case/Unicode-colliding release paths: ${normalizedPaths.get(key)} and ${relativePath}`,
    );
    normalizedPaths.set(key, relativePath);
    if (descriptor.releaseType === 'ADD_ITEMS_V1') {
      invariant(
        record.deploy === isDeployPath(relativePath),
        `Release deploy flag disagrees with the allowlist: ${relativePath}`,
      );
    } else {
      invariant(
        record.deploy === true && isProductDeployPath(relativePath),
        `Product release path is outside the deploy allowlist: ${relativePath}`,
      );
    }
    invariant(Number.isSafeInteger(record.size_bytes) && record.size_bytes >= 0, `Invalid size: ${relativePath}`);
    invariant(/^[a-f0-9]{64}$/.test(record.sha256), `Invalid SHA-256: ${relativePath}`);
    invariant(/^(?:0[4567][0-7]{2})$/.test(record.mode), `Invalid file mode: ${relativePath}`);

    const sourcePath = path.join(resolvedRelease, relativePath);
    const sourceInfo = await lstat(sourcePath);
    invariant(sourceInfo.isFile() && !sourceInfo.isSymbolicLink(), `Unsafe release source: ${relativePath}`);
    const bytes = await readFile(sourcePath);
    invariant(bytes.byteLength === record.size_bytes, `Release size changed: ${relativePath}`);
    invariant(sha256(bytes) === record.sha256, `Release content changed: ${relativePath}`);
    invariant(
      (sourceInfo.mode & 0o777).toString(8).padStart(4, '0') === record.mode,
      `Release mode changed: ${relativePath}`,
    );
  }

  return {
    directory: resolvedRelease,
    manifest,
    manifestSha256,
    manifestRelativePath: descriptor.manifestRelativePath,
    releaseType: descriptor.releaseType,
  };
}

export async function inspectLiveRoot(liveRoot) {
  const resolvedLiveRoot = path.resolve(liveRoot);
  invariant(resolvedLiveRoot !== path.parse(resolvedLiveRoot).root, 'Live root cannot be a filesystem root');
  const liveInfo = await lstat(resolvedLiveRoot);
  invariant(
    liveInfo.isDirectory() || liveInfo.isSymbolicLink(),
    'Live root must be a directory or a version symlink',
  );
  const parent = path.dirname(resolvedLiveRoot);
  const controlRoot = path.join(parent, '.zeely-deploy');
  const versionsRoot = path.join(controlRoot, 'versions');
  const stateRuntimePath = path.join(controlRoot, 'state', 'runtime');
  const stateNodeModulesPath = path.join(controlRoot, 'state', 'node_modules');
  if (liveInfo.isSymbolicLink()) {
    const pointerTarget = path.resolve(parent, await readlink(resolvedLiveRoot));
    invariant(
      path.dirname(pointerTarget) === versionsRoot,
      'Managed live pointer does not target a direct version child',
    );
    const pointerInfo = await lstat(pointerTarget);
    invariant(
      pointerInfo.isDirectory() && !pointerInfo.isSymbolicLink(),
      'Managed live pointer target is not a real version directory',
    );
  } else {
    invariant(liveInfo.uid === process.getuid(), 'Initial live root has an unexpected owner');
    invariant((liveInfo.mode & 0o022) === 0, 'Initial live root is group/world writable');
  }
  const realRoot = await realpath(resolvedLiveRoot);
  const packageJson = JSON.parse(await readFile(path.join(realRoot, 'package.json'), 'utf8'));
  invariant(
    packageJson.name === 'zeely-reference-conditioning-pipeline',
    'Live root is not the ZEELY application',
  );
  const runtimeEntry = path.join(realRoot, 'runtime');
  const nodeModulesEntry = path.join(realRoot, 'node_modules');
  const runtimeEntryInfo = await lstat(runtimeEntry);
  const nodeModulesEntryInfo = await lstat(nodeModulesEntry);
  if (liveInfo.isSymbolicLink()) {
    invariant(runtimeEntryInfo.isSymbolicLink(), 'Managed runtime attachment is not a symlink');
    invariant(nodeModulesEntryInfo.isSymbolicLink(), 'Managed node_modules attachment is not a symlink');
    invariant(
      await realpath(runtimeEntry) === await realpath(stateRuntimePath),
      'Managed runtime attachment points outside shared state',
    );
    invariant(
      await realpath(nodeModulesEntry) === await realpath(stateNodeModulesPath),
      'Managed node_modules attachment points outside shared state',
    );
  } else {
    for (const [label, info] of [
      ['runtime', runtimeEntryInfo],
      ['node_modules', nodeModulesEntryInfo],
    ]) {
      invariant(info.isDirectory() && !info.isSymbolicLink(), `Initial ${label} is not a real directory`);
      invariant(info.uid === process.getuid(), `Initial ${label} has an unexpected owner`);
      invariant((info.mode & 0o022) === 0, `Initial ${label} is group/world writable`);
      invariant(info.dev === liveInfo.dev, `Initial ${label} is on a different filesystem`);
    }
  }
  const runtimePath = await realpath(runtimeEntry);
  const nodeModulesPath = await realpath(nodeModulesEntry);
  const runtimeInfo = await lstat(runtimePath);
  const nodeModulesInfo = await lstat(nodeModulesPath);
  invariant(
    runtimeInfo.isDirectory() && !runtimeInfo.isSymbolicLink(),
    'Live runtime is not a real directory',
  );
  invariant(
    nodeModulesInfo.isDirectory() && !nodeModulesInfo.isSymbolicLink(),
    'Live node_modules is not a real directory',
  );
  invariant(runtimeInfo.uid === process.getuid(), 'Live runtime has an unexpected owner');
  invariant(nodeModulesInfo.uid === process.getuid(), 'Live node_modules has an unexpected owner');
  invariant((runtimeInfo.mode & 0o022) === 0, 'Live runtime is group/world writable');
  invariant((nodeModulesInfo.mode & 0o022) === 0, 'Live node_modules is group/world writable');
  return {
    liveRoot: resolvedLiveRoot,
    realRoot,
    runtimePath,
    nodeModulesPath,
    packageLockSha256: await sha256File(path.join(realRoot, 'package-lock.json')),
    rootWasSymlink: liveInfo.isSymbolicLink(),
  };
}

export async function findActiveRuns(runtimePath) {
  const runsRoot = path.join(runtimePath, 'runs');
  const active = [];
  if (await pathExists(runsRoot)) {
    const rootInfo = await lstat(runsRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      active.push({ run_id: 'runs', status: 'UNSAFE_RUN_ROOT' });
    } else {
      const entries = await readdir(runsRoot, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() || !SAFE_RUNTIME_ID.test(entry.name)) {
          active.push({ run_id: entry.name, status: 'UNSAFE_RUN_ENTRY' });
          continue;
        }
        const runPath = path.join(runsRoot, entry.name, 'run.json');
        if (!await pathExists(runPath)) {
          active.push({ run_id: entry.name, status: 'MISSING_RUN_STATE' });
          continue;
        }
        try {
          const run = await readBoundedJson(
            runPath,
            `Persisted run ${entry.name}`,
            RUNTIME_STATE_JSON_LIMIT,
          );
          if (run.run_id !== undefined && run.run_id !== entry.name) {
            active.push({ run_id: entry.name, status: 'RUN_ID_MISMATCH' });
          } else if (!TERMINAL_RUN_STATUSES.has(run.status)) {
            active.push({ run_id: entry.name, status: String(run.status ?? 'UNKNOWN') });
          }
        } catch {
          active.push({ run_id: entry.name, status: 'MALFORMED' });
        }
      }
    }
  }

  const scenesRoot = path.join(runtimePath, 'scenes');
  if (await pathExists(scenesRoot)) {
    const rootInfo = await lstat(scenesRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      active.push({ scene_id: 'scenes', status: 'UNSAFE_SCENE_ROOT' });
    } else {
      const reserved = new Set(['.locks', '.tombstones', 'incidents', 'quarantine']);
      const entries = await readdir(scenesRoot, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (reserved.has(entry.name)) {
          if (!entry.isDirectory()) {
            active.push({ scene_id: entry.name, status: 'UNSAFE_SCENE_ENTRY' });
          }
          continue;
        }
        if (!entry.isDirectory() || !SAFE_RUNTIME_ID.test(entry.name)) {
          active.push({ scene_id: entry.name, status: 'UNSAFE_SCENE_ENTRY' });
          continue;
        }
        const statePath = path.join(scenesRoot, entry.name, 'scene.json');
        if (!await pathExists(statePath)) {
          active.push({ scene_id: entry.name, status: 'MISSING_SCENE_STATE' });
          continue;
        }
        try {
          const scene = await readBoundedJson(
            statePath,
            `Persisted scene ${entry.name}`,
            RUNTIME_STATE_JSON_LIMIT,
          );
          if (scene.scene_id !== entry.name) {
            active.push({ scene_id: entry.name, status: 'SCENE_ID_MISMATCH' });
          } else if (!SCENE_STATUSES.has(scene.status)) {
            active.push({ scene_id: entry.name, status: 'MALFORMED_SCENE_STATE' });
          } else if (ACTIVE_SCENE_STATUSES.has(scene.status)) {
            active.push({ scene_id: entry.name, status: scene.status });
          }
        } catch {
          active.push({ scene_id: entry.name, status: 'MALFORMED_SCENE_STATE' });
        }
      }
    }
  }

  const editorialRoot = path.join(runtimePath, 'editorial-shoots');
  if (await pathExists(editorialRoot)) {
    const rootInfo = await lstat(editorialRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      active.push({ shoot_id: 'editorial-shoots', status: 'UNSAFE_EDITORIAL_ROOT' });
    } else {
      const reserved = new Set(['.locks', 'incidents']);
      const entries = await readdir(editorialRoot, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (reserved.has(entry.name)) {
          if (!entry.isDirectory()) {
            active.push({ shoot_id: entry.name, status: 'UNSAFE_EDITORIAL_ENTRY' });
          }
          continue;
        }
        if (!entry.isDirectory() || !SAFE_RUNTIME_ID.test(entry.name)) {
          active.push({ shoot_id: entry.name, status: 'UNSAFE_EDITORIAL_ENTRY' });
          continue;
        }
        const statePath = path.join(editorialRoot, entry.name, 'shoot.json');
        if (!await pathExists(statePath)) {
          active.push({ shoot_id: entry.name, status: 'MISSING_EDITORIAL_STATE' });
          continue;
        }
        try {
          const shoot = await readBoundedJson(
            statePath,
            `Persisted editorial shoot ${entry.name}`,
            RUNTIME_STATE_JSON_LIMIT,
          );
          const hasRunnableShot = Array.isArray(shoot.shots)
            && shoot.shots.some((shot) => (
              shot?.status === 'QUEUED' || shot?.status === 'RUNNING'
            ));
          if (shoot.shoot_id !== entry.name) {
            active.push({ shoot_id: entry.name, status: 'EDITORIAL_ID_MISMATCH' });
          } else if (!EDITORIAL_SHOOT_STATUSES.has(shoot.status)) {
            active.push({ shoot_id: entry.name, status: 'MALFORMED_EDITORIAL_STATE' });
          } else if (ACTIVE_EDITORIAL_SHOOT_STATUSES.has(shoot.status)) {
            active.push({ shoot_id: entry.name, status: shoot.status });
          } else if (hasRunnableShot) {
            active.push({ shoot_id: entry.name, status: 'INCONSISTENT_EDITORIAL_STATE' });
          }
        } catch {
          active.push({ shoot_id: entry.name, status: 'MALFORMED_EDITORIAL_STATE' });
        }
      }
    }
  }
  return active;
}

export async function preimageInventory(liveRealRoot, deployRecords) {
  const inventory = [];
  for (const record of [...deployRecords].sort((left, right) => left.path.localeCompare(right.path))) {
    const relativePath = safeRelativePath(record.path);
    const targetPath = path.join(liveRealRoot, relativePath);
    if (!await pathExists(targetPath)) {
      inventory.push({ path: relativePath, present: false });
      continue;
    }
    const info = await lstat(targetPath);
    invariant(info.isFile() && !info.isSymbolicLink(), `Unsafe live deploy target: ${relativePath}`);
    inventory.push({
      path: relativePath,
      present: true,
      size_bytes: info.size,
      sha256: await sha256File(targetPath),
      mode: (info.mode & 0o777).toString(8).padStart(4, '0'),
    });
  }
  return inventory;
}

async function runtimeTreeEntries(root, current = '', records = []) {
  const absolute = current ? path.join(root, current) : root;
  const info = await lstat(absolute);
  invariant(!info.isSymbolicLink(), `Runtime snapshot contains a symlink: ${current || '.'}`);
  if (info.isDirectory()) {
    records.push({
      path: current || '.',
      type: 'directory',
      mode: (info.mode & 0o777).toString(8).padStart(4, '0'),
    });
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = current ? path.posix.join(current, entry.name) : entry.name;
      await runtimeTreeEntries(root, relativePath, records);
    }
    return records;
  }
  invariant(info.isFile(), `Runtime snapshot contains an unsupported entry: ${current}`);
  records.push({
    path: current,
    type: 'file',
    size_bytes: info.size,
    sha256: await sha256File(absolute),
    mode: (info.mode & 0o777).toString(8).padStart(4, '0'),
  });
  return records;
}

export async function runtimeInventory(runtimePath) {
  const records = await runtimeTreeEntries(runtimePath);
  return {
    records,
    file_count: records.filter((record) => record.type === 'file').length,
    size_bytes: records.reduce((total, record) => total + (record.size_bytes ?? 0), 0),
    digest_sha256: sha256(Buffer.from(JSON.stringify(records))),
  };
}

async function cloneRuntimeTree(source, destination) {
  const sourceInfo = await lstat(source);
  invariant(!sourceInfo.isSymbolicLink(), 'Runtime clone source contains a symlink');
  if (sourceInfo.isDirectory()) {
    await mkdir(destination, { mode: sourceInfo.mode & 0o777 });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      await cloneRuntimeTree(path.join(source, entry.name), path.join(destination, entry.name));
    }
    await chmod(destination, sourceInfo.mode & 0o777);
    await utimes(destination, sourceInfo.atime, sourceInfo.mtime);
    await syncDirectory(destination);
    return;
  }
  invariant(sourceInfo.isFile(), 'Runtime clone source contains an unsupported entry');
  try {
    await copyFile(
      source,
      destination,
      constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE,
    );
  } catch (error) {
    if (!['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
  await chmod(destination, sourceInfo.mode & 0o777);
  await utimes(destination, sourceInfo.atime, sourceInfo.mtime);
  await syncFile(destination);
}

export async function createRuntimeSnapshot({
  runtimePath,
  snapshotPath,
}) {
  invariant(!await pathExists(snapshotPath), 'Runtime snapshot destination already exists');
  const sourceInventory = await runtimeInventory(runtimePath);
  await cloneRuntimeTree(runtimePath, snapshotPath);
  const snapshotInventory = await runtimeInventory(snapshotPath);
  invariant(
    snapshotInventory.digest_sha256 === sourceInventory.digest_sha256,
    'Runtime snapshot digest does not match its source',
  );
  await syncDirectory(path.dirname(snapshotPath));
  return snapshotInventory;
}

export async function restoreRuntimeSnapshot({
  stateRuntimePath,
  snapshotPath,
  quarantinePath,
  transactionId,
}) {
  invariant(
    typeof transactionId === 'string'
      && transactionId.length > 0
      && transactionId.length <= 255
      && /^[A-Za-z0-9._-]+$/.test(transactionId)
      && transactionId !== '.'
      && transactionId !== '..',
    'Runtime restore transaction id is unsafe',
  );
  invariant(await pathExists(snapshotPath), 'Runtime snapshot is missing');
  const expected = await runtimeInventory(snapshotPath);
  const restoreStaging = path.join(
    path.dirname(stateRuntimePath),
    `.runtime.${transactionId}.restore`,
  );

  const preserveStaging = async () => {
    if (!await pathExists(restoreStaging)) return null;
    let suffix = 0;
    let preservedPath;
    do {
      preservedPath = `${quarantinePath}.failed-restore${suffix === 0 ? '' : `-${suffix}`}`;
      suffix += 1;
    } while (await pathExists(preservedPath));
    await rename(restoreStaging, preservedPath);
    await syncDirectory(path.dirname(stateRuntimePath));
    return preservedPath;
  };

  if (await pathExists(stateRuntimePath)) {
    const current = await runtimeInventory(stateRuntimePath);
    if (current.digest_sha256 === expected.digest_sha256) return current;
    invariant(
      !await pathExists(quarantinePath),
      'Both a changed shared runtime and its recovery quarantine exist',
    );
    await rename(stateRuntimePath, quarantinePath);
    await syncDirectory(path.dirname(stateRuntimePath));
  } else {
    invariant(await pathExists(quarantinePath), 'Current shared runtime and its recovery quarantine are both missing');
  }
  await assertRealDirectory(quarantinePath, 'Runtime recovery quarantine');

  try {
    if (await pathExists(restoreStaging)) {
      let staged = null;
      try {
        staged = await runtimeInventory(restoreStaging);
      } catch {
        // Preserve malformed or partial bytes before creating a fresh staging tree.
      }
      if (staged?.digest_sha256 === expected.digest_sha256) {
        await rename(restoreStaging, stateRuntimePath);
        await syncDirectory(path.dirname(stateRuntimePath));
        return staged;
      }
      await preserveStaging();
    }
    await cloneRuntimeTree(snapshotPath, restoreStaging);
    const restored = await runtimeInventory(restoreStaging);
    invariant(
      restored.digest_sha256 === expected.digest_sha256,
      'Restored runtime digest does not match the snapshot',
    );
    await rename(restoreStaging, stateRuntimePath);
    await syncDirectory(path.dirname(stateRuntimePath));
    return restored;
  } catch (error) {
    await preserveStaging();
    throw error;
  }
}

export function createTransactionId(now = new Date()) {
  const timestamp = now.toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14);
  return `${timestamp}-${randomUUID()}`;
}

export function deploymentLayout(liveRoot, transactionId, contentDigest) {
  const resolvedLiveRoot = path.resolve(liveRoot);
  const parent = path.dirname(resolvedLiveRoot);
  invariant(path.basename(resolvedLiveRoot).length > 0, 'Live root basename is missing');
  const controlRoot = path.join(parent, '.zeely-deploy');
  const versionsRoot = path.join(controlRoot, 'versions');
  const stateRoot = path.join(controlRoot, 'state');
  const backupsRoot = path.join(controlRoot, 'backups');
  const journalsRoot = path.join(controlRoot, 'journals');
  const receiptsRoot = path.join(controlRoot, 'receipts');
  const candidateName = `release-${contentDigest.slice(0, 16)}-${transactionId}`;
  return {
    parent,
    controlRoot,
    versionsRoot,
    stateRoot,
    backupsRoot,
    journalsRoot,
    receiptsRoot,
    lockPath: path.join(controlRoot, 'transaction.lock'),
    candidatePath: path.join(versionsRoot, candidateName),
    candidateStagingPath: path.join(versionsRoot, `.${candidateName}.staging`),
    backupPath: path.join(backupsRoot, transactionId),
    journalPath: path.join(journalsRoot, `${transactionId}.json`),
    receiptPath: path.join(receiptsRoot, `${transactionId}.json`),
    stateRuntimePath: path.join(stateRoot, 'runtime'),
    stateNodeModulesPath: path.join(stateRoot, 'node_modules'),
  };
}

export async function acquireTransactionLock(layout, transactionId, { writeOwner = writeFile } = {}) {
  await ensureDirectory(layout.controlRoot);
  await ensureDirectory(layout.versionsRoot);
  await ensureDirectory(layout.stateRoot);
  await ensureDirectory(layout.backupsRoot);
  await ensureDirectory(layout.journalsRoot);
  await ensureDirectory(layout.receiptsRoot);
  try {
    await mkdir(layout.lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Another deployment transaction or unresolved recovery is present');
    }
    throw error;
  }
  try {
    await writeOwner(
      path.join(layout.lockPath, 'owner.json'),
      `${JSON.stringify({ transaction_id: transactionId, created_at: new Date().toISOString() })}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await syncDirectory(layout.lockPath);
    await syncDirectory(layout.controlRoot);
  } catch (error) {
    try {
      await rm(layout.lockPath, { recursive: true, force: true });
      await syncDirectory(layout.controlRoot);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Transaction lock initialization failed and its incomplete lock could not be removed',
      );
    }
    throw error;
  }
}

export async function inspectPendingTransaction(liveRoot) {
  const probe = deploymentLayout(liveRoot, 'inspection', '0'.repeat(64));
  if (!await pathExists(probe.lockPath)) return null;

  await assertRealDirectory(probe.controlRoot, 'Deployment control root');
  await assertRealDirectory(probe.lockPath, 'Transaction lock');
  await assertRealDirectory(probe.journalsRoot, 'Deployment journals root');
  await assertRealDirectory(probe.versionsRoot, 'Deployment versions root');
  await assertRealDirectory(probe.stateRoot, 'Deployment state root');

  const owner = await readBoundedJson(
    path.join(probe.lockPath, 'owner.json'),
    'Transaction lock owner',
    OWNER_JSON_LIMIT,
  );
  invariant(
    typeof owner.transaction_id === 'string' && TRANSACTION_ID_PATTERN.test(owner.transaction_id),
    'Transaction lock owner has an invalid transaction id',
  );
  invariant(
    typeof owner.created_at === 'string' && Number.isFinite(Date.parse(owner.created_at)),
    'Transaction lock owner has an invalid creation time',
  );

  const transactionId = owner.transaction_id;
  const journalPath = path.join(probe.journalsRoot, `${transactionId}.json`);
  const journal = await readBoundedJson(journalPath, 'Pending transaction journal', JOURNAL_JSON_LIMIT);
  invariant(journal.transaction_id === transactionId, 'Pending transaction journal belongs to another transaction');
  invariant(
    typeof journal.phase === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(journal.phase),
    'Pending transaction journal phase is invalid',
  );
  const contentDigest = journal.release?.content_digest_sha256;
  invariant(
    typeof contentDigest === 'string' && /^[a-f0-9]{64}$/.test(contentDigest),
    'Pending transaction journal release digest is invalid',
  );
  if (journal.previous_version_name !== undefined) safeVersionName(journal.previous_version_name);
  invariant(
    journal.previous_version === undefined,
    'Pending transaction journal contains an untrusted previous version path',
  );
  invariant(
    journal.first_managed_migration_expected === undefined
      || typeof journal.first_managed_migration_expected === 'boolean',
    'Pending transaction journal migration mode is invalid',
  );

  const layout = deploymentLayout(liveRoot, transactionId, contentDigest);
  invariant(layout.journalPath === journalPath, 'Pending transaction journal path escaped its control root');
  return { transactionId, journal, layout };
}

export async function archiveTransactionLock(layout, transactionId, outcome) {
  const lockArchiveRoot = path.join(layout.controlRoot, 'lock-history');
  await ensureDirectory(lockArchiveRoot);
  const archived = path.join(lockArchiveRoot, `${transactionId}-${outcome.toLowerCase()}`);
  invariant(!await pathExists(archived), 'Transaction lock archive already exists');
  await rename(layout.lockPath, archived);
  await syncDirectory(layout.controlRoot);
  await syncDirectory(lockArchiveRoot);
}

export async function writeJournal(layout, journal) {
  const temporaryPath = `${layout.journalPath}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(journal, null, 2)}\n`;
  await writeFile(temporaryPath, payload, { flag: 'wx', mode: 0o600 });
  await syncFile(temporaryPath);
  await rename(temporaryPath, layout.journalPath);
  await syncDirectory(layout.journalsRoot);
}

export async function stageCandidate({ release, layout }) {
  invariant(!await pathExists(layout.candidatePath), 'Candidate version already exists');
  invariant(!await pathExists(layout.candidateStagingPath), 'Candidate staging directory already exists');
  await mkdir(layout.candidateStagingPath, { mode: 0o700 });
  for (const record of release.manifest.deploy_files) {
    const relativePath = safeRelativePath(record.path);
    await ensureParentDirectories(layout.candidateStagingPath, relativePath);
    const sourcePath = path.join(release.directory, relativePath);
    const sourceInfo = await lstat(sourcePath);
    invariant(sourceInfo.isFile() && !sourceInfo.isSymbolicLink(), `Release source changed: ${relativePath}`);
    const bytes = await readFile(sourcePath);
    invariant(bytes.byteLength === record.size_bytes, `Release size changed during staging: ${relativePath}`);
    invariant(sha256(bytes) === record.sha256, `Release hash changed during staging: ${relativePath}`);
    const sourceMode = (sourceInfo.mode & 0o777).toString(8).padStart(4, '0');
    invariant(sourceMode === record.mode, `Release mode changed during staging: ${relativePath}`);
    const targetPath = path.join(layout.candidateStagingPath, relativePath);
    await writeFile(targetPath, bytes, {
      flag: 'wx',
      mode: Number.parseInt(record.mode, 8),
    });
    await syncFile(targetPath);
    invariant(await sha256File(targetPath) === record.sha256, `Candidate hash mismatch: ${relativePath}`);
  }

  const runtimeLinkTarget = path.relative(layout.candidateStagingPath, layout.stateRuntimePath);
  const nodeModulesLinkTarget = path.relative(layout.candidateStagingPath, layout.stateNodeModulesPath);
  await symlink(runtimeLinkTarget, path.join(layout.candidateStagingPath, 'runtime'));
  await symlink(nodeModulesLinkTarget, path.join(layout.candidateStagingPath, 'node_modules'));
  await syncDirectory(layout.candidateStagingPath);
  await rename(layout.candidateStagingPath, layout.candidatePath);
  await syncDirectory(layout.versionsRoot);
  return layout.candidatePath;
}

async function candidateTree(candidatePath, current = '.', entries = []) {
  const absolutePath = current === '.' ? candidatePath : path.join(candidatePath, current);
  const info = await lstat(absolutePath);
  if (info.isDirectory() && !info.isSymbolicLink()) {
    entries.push({ path: current, type: 'directory' });
    const children = await readdir(absolutePath);
    for (const child of children.sort((left, right) => left.localeCompare(right))) {
      const relativePath = current === '.' ? child : path.posix.join(current, child);
      await candidateTree(candidatePath, relativePath, entries);
    }
    return entries;
  }
  if (info.isFile() && !info.isSymbolicLink()) {
    entries.push({ path: current, type: 'file' });
    return entries;
  }
  if (info.isSymbolicLink()) {
    entries.push({ path: current, type: 'symlink' });
    return entries;
  }
  throw new Error(`Candidate contains an unsupported entry: ${current}`);
}

function exactSetDifference(expected, actual) {
  return {
    missing: [...expected].filter((entry) => !actual.has(entry)).sort(),
    unexpected: [...actual].filter((entry) => !expected.has(entry)).sort(),
  };
}

export async function verifyCandidate({ candidatePath, manifest, stateRuntimePath, stateNodeModulesPath }) {
  const expectedFiles = new Set();
  const expectedDirectories = new Set(['.']);
  for (const record of manifest.deploy_files) {
    const relativePath = safeRelativePath(record.path);
    invariant(!expectedFiles.has(relativePath), `Duplicate candidate manifest path: ${relativePath}`);
    expectedFiles.add(relativePath);
    let parent = path.posix.dirname(relativePath);
    while (parent !== '.') {
      expectedDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const expectedSymlinks = new Set(['runtime', 'node_modules']);
  invariant(!expectedFiles.has('runtime') && !expectedFiles.has('node_modules'), 'Candidate manifest collides with state attachments');

  const actualEntries = await candidateTree(candidatePath);
  const actualFiles = new Set(actualEntries.filter((entry) => entry.type === 'file').map((entry) => entry.path));
  const actualDirectories = new Set(actualEntries.filter((entry) => entry.type === 'directory').map((entry) => entry.path));
  const actualSymlinks = new Set(actualEntries.filter((entry) => entry.type === 'symlink').map((entry) => entry.path));
  for (const [label, expected, actual] of [
    ['file', expectedFiles, actualFiles],
    ['directory', expectedDirectories, actualDirectories],
    ['symlink', expectedSymlinks, actualSymlinks],
  ]) {
    const difference = exactSetDifference(expected, actual);
    invariant(
      difference.missing.length === 0 && difference.unexpected.length === 0,
      `Candidate ${label} set mismatch; missing=${difference.missing.join(',') || 'none'}; unexpected=${difference.unexpected.join(',') || 'none'}`,
    );
  }

  for (const record of manifest.deploy_files) {
    const relativePath = safeRelativePath(record.path);
    const candidateFile = path.join(candidatePath, relativePath);
    const info = await lstat(candidateFile);
    invariant(info.isFile() && !info.isSymbolicLink(), `Candidate file is unsafe: ${relativePath}`);
    invariant(info.size === record.size_bytes, `Candidate size mismatch: ${relativePath}`);
    invariant(await sha256File(candidateFile) === record.sha256, `Candidate hash mismatch: ${relativePath}`);
    invariant(
      (info.mode & 0o777).toString(8).padStart(4, '0') === record.mode,
      `Candidate mode mismatch: ${relativePath}`,
    );
  }
  for (const [name, expectedTarget] of [
    ['runtime', stateRuntimePath],
    ['node_modules', stateNodeModulesPath],
  ]) {
    const linkPath = path.join(candidatePath, name);
    const info = await lstat(linkPath);
    invariant(info.isSymbolicLink(), `Candidate ${name} attachment is not a symlink`);
    const resolvedTarget = path.resolve(candidatePath, await readlink(linkPath));
    invariant(resolvedTarget === expectedTarget, `Candidate ${name} attachment points elsewhere`);
  }
}

async function publishVersionSymlink(liveRoot, versionPath, transactionId) {
  const parent = path.dirname(liveRoot);
  const temporaryLink = path.join(parent, `.${path.basename(liveRoot)}.${transactionId}.next`);
  invariant(!await pathExists(temporaryLink), 'Temporary live pointer already exists');
  await symlink(path.relative(parent, versionPath), temporaryLink);
  await rename(temporaryLink, liveRoot);
  await syncDirectory(parent);
}

async function ensureStateAttachment(versionPath, name, statePath) {
  const versionEntry = path.join(versionPath, name);
  const stateExists = await pathExists(statePath);
  const versionExists = await pathExists(versionEntry);
  if (!stateExists) {
    invariant(versionExists, `Recovery source is missing for ${name}`);
    const versionInfo = await lstat(versionEntry);
    invariant(
      versionInfo.isDirectory() && !versionInfo.isSymbolicLink(),
      `Recovery source is unsafe for ${name}`,
    );
    await rename(versionEntry, statePath);
  } else if (versionExists) {
    const versionInfo = await lstat(versionEntry);
    if (versionInfo.isSymbolicLink()) {
      const resolvedTarget = path.resolve(versionPath, await readlink(versionEntry));
      invariant(resolvedTarget === statePath, `Existing ${name} attachment points elsewhere`);
      return;
    }
    throw new Error(`Both shared state and a version-local ${name} exist`);
  }
  await symlink(path.relative(versionPath, statePath), versionEntry);
  await syncDirectory(versionPath);
  await syncDirectory(path.dirname(statePath));
}

async function repairInitialMigration({
  liveRoot,
  layout,
  previousVersionPath,
  transactionId,
}) {
  invariant(await pathExists(previousVersionPath), 'Initial migration preimage is unavailable');
  await ensureStateAttachment(previousVersionPath, 'runtime', layout.stateRuntimePath);
  await ensureStateAttachment(previousVersionPath, 'node_modules', layout.stateNodeModulesPath);
  if (!await pathExists(liveRoot)) {
    await publishVersionSymlink(liveRoot, previousVersionPath, `${transactionId}.repair`);
    return;
  }
  const liveInfo = await lstat(liveRoot);
  invariant(liveInfo.isSymbolicLink(), 'Initial migration recovery found an unmanaged live root');
  const currentTarget = path.resolve(path.dirname(liveRoot), await readlink(liveRoot));
  if (currentTarget !== previousVersionPath) {
    await publishVersionSymlink(liveRoot, previousVersionPath, `${transactionId}.repair`);
  }
}

function previousVersionPathFromJournal(layout, journal) {
  const versionName = safeVersionName(journal.previous_version_name);
  const previousVersionPath = path.resolve(layout.versionsRoot, versionName);
  invariant(
    path.dirname(previousVersionPath) === layout.versionsRoot,
    'Journal previous version is not a direct child of the managed versions root',
  );
  return previousVersionPath;
}

export async function recoverInterruptedSwitch({
  liveRoot,
  transactionId,
  onPhase = async () => {},
}) {
  invariant(typeof onPhase === 'function', 'Recovery phase callback is invalid');
  const pending = await inspectPendingTransaction(liveRoot);
  invariant(pending, 'No pending deployment transaction is present');
  invariant(pending.transactionId === transactionId, 'Pending deployment transaction id does not match recovery request');
  const { journal, layout } = pending;
  invariant(
    typeof journal.first_managed_migration_expected === 'boolean',
    'Pending transaction journal does not declare its migration mode',
  );
  invariant(
    typeof journal.previous_version_name === 'string',
    'Pending transaction journal does not declare its previous version name',
  );

  const previousVersionPath = previousVersionPathFromJournal(layout, journal);
  const firstMigration = journal.first_managed_migration_expected;
  let action;

  if (firstMigration) {
    invariant(
      journal.previous_version_name === `preimage-${transactionId}`,
      'Initial migration journal does not name its own transaction preimage',
    );
    if (!await pathExists(previousVersionPath)) {
      invariant(
        PRE_SWITCH_PHASES.has(journal.phase),
        'Initial migration journal records mutation but its preimage is missing',
      );
      const liveInfo = await lstat(path.resolve(liveRoot));
      invariant(
        liveInfo.isDirectory() && !liveInfo.isSymbolicLink(),
        'Initial migration preimage is missing and the original live root is not intact',
      );
      action = 'NO_SWITCH_MUTATION';
    } else {
      await assertRealDirectory(previousVersionPath, 'Initial migration preimage');
      const resolvedLiveRoot = path.resolve(liveRoot);
      if (await pathExists(resolvedLiveRoot)) {
        const liveInfo = await lstat(resolvedLiveRoot);
        invariant(liveInfo.isSymbolicLink(), 'Initial recovery found both a preimage and an unmanaged live root');
        const currentTarget = path.resolve(path.dirname(resolvedLiveRoot), await readlink(resolvedLiveRoot));
        invariant(
          currentTarget === previousVersionPath || currentTarget === layout.candidatePath,
          'Initial recovery found an unexpected live version target',
        );
      }
      await repairInitialMigration({
        liveRoot: resolvedLiveRoot,
        layout,
        previousVersionPath,
        transactionId,
      });
      await verifyManagedState({
        liveRoot: path.resolve(liveRoot),
        expectedVersionPath: previousVersionPath,
        stateRuntimePath: layout.stateRuntimePath,
        stateNodeModulesPath: layout.stateNodeModulesPath,
      });
      action = 'INITIAL_PREIMAGE_RESTORED';
    }
  } else {
    await assertRealDirectory(previousVersionPath, 'Managed previous version');
    await assertRealDirectory(layout.stateRuntimePath, 'Shared runtime state');
    await assertRealDirectory(layout.stateNodeModulesPath, 'Shared node_modules state');
    const resolvedLiveRoot = path.resolve(liveRoot);
    if (!await pathExists(resolvedLiveRoot)) {
      await publishVersionSymlink(resolvedLiveRoot, previousVersionPath, `${transactionId}.recovery`);
      action = 'MANAGED_POINTER_RESTORED';
    } else {
      const liveInfo = await lstat(resolvedLiveRoot);
      invariant(liveInfo.isSymbolicLink(), 'Managed recovery found a non-symlink live root');
      const currentTarget = path.resolve(path.dirname(resolvedLiveRoot), await readlink(resolvedLiveRoot));
      invariant(
        currentTarget === previousVersionPath || currentTarget === layout.candidatePath,
        'Managed recovery found an unexpected live version target',
      );
      if (currentTarget === previousVersionPath) {
        action = 'ALREADY_RESTORED';
      } else {
        await publishVersionSymlink(resolvedLiveRoot, previousVersionPath, `${transactionId}.recovery`);
        action = 'MANAGED_POINTER_RESTORED';
      }
    }
    await verifyManagedState({
      liveRoot: path.resolve(liveRoot),
      expectedVersionPath: previousVersionPath,
      stateRuntimePath: layout.stateRuntimePath,
      stateNodeModulesPath: layout.stateNodeModulesPath,
    });
  }

  const result = {
    transactionId,
    previousVersionPath,
    firstMigration,
    journalPhase: journal.phase,
    action,
  };
  await onPhase('SWITCH_RECOVERED', {
    transaction_id: transactionId,
    previous_version_name: journal.previous_version_name,
    first_managed_migration_expected: firstMigration,
    interrupted_phase: journal.phase,
    recovery_action: action,
  });
  return result;
}

export async function switchToCandidate({
  liveRoot,
  layout,
  transactionId,
  onPhase = async () => {},
}) {
  const liveInfo = await lstat(liveRoot);
  if (liveInfo.isSymbolicLink()) {
    invariant(await pathExists(layout.stateRuntimePath), 'Shared runtime state is missing');
    invariant(await pathExists(layout.stateNodeModulesPath), 'Shared node_modules state is missing');
    const previousTarget = path.resolve(path.dirname(liveRoot), await readlink(liveRoot));
    invariant(
      path.dirname(previousTarget) === layout.versionsRoot,
      'Existing live pointer does not target the managed versions directory',
    );
    const switchDetails = {
      previous_version_name: path.basename(previousTarget),
      first_managed_migration_expected: false,
    };
    await onPhase('SWITCH_PREPARED', switchDetails);
    try {
      await publishVersionSymlink(liveRoot, layout.candidatePath, transactionId);
      await onPhase('CANDIDATE_PUBLISHED', switchDetails);
      return { previousVersionPath: previousTarget, firstMigration: false };
    } catch (error) {
      const currentInfo = await lstat(liveRoot);
      invariant(currentInfo.isSymbolicLink(), 'Managed switch recovery found an invalid live root');
      const currentTarget = path.resolve(path.dirname(liveRoot), await readlink(liveRoot));
      if (currentTarget !== previousTarget) {
        await publishVersionSymlink(liveRoot, previousTarget, `${transactionId}.repair`);
      }
      throw error;
    }
  }

  invariant(liveInfo.isDirectory(), 'Initial live root is not a directory');
  invariant(!await pathExists(layout.stateRuntimePath), 'Shared runtime state already exists before initial migration');
  invariant(!await pathExists(layout.stateNodeModulesPath), 'Shared node_modules already exists before initial migration');
  const previousVersionPath = path.join(layout.versionsRoot, `preimage-${transactionId}`);
  invariant(!await pathExists(previousVersionPath), 'Initial preimage version already exists');
  const switchDetails = {
    previous_version_name: path.basename(previousVersionPath),
    first_managed_migration_expected: true,
  };
  await onPhase('SWITCH_PREPARED', switchDetails);

  try {
    await rename(liveRoot, previousVersionPath);
    await syncDirectory(layout.parent);
    await onPhase('PREIMAGE_RENAMED', switchDetails);
    await publishVersionSymlink(liveRoot, previousVersionPath, `${transactionId}.preimage`);
    await onPhase('PREIMAGE_POINTER_PUBLISHED', switchDetails);

    await rename(path.join(previousVersionPath, 'runtime'), layout.stateRuntimePath);
    await syncDirectory(layout.stateRoot);
    await onPhase('RUNTIME_MOVED', switchDetails);
    await symlink(
      path.relative(previousVersionPath, layout.stateRuntimePath),
      path.join(previousVersionPath, 'runtime'),
    );
    await syncDirectory(previousVersionPath);
    await onPhase('RUNTIME_LINKED', switchDetails);

    await rename(path.join(previousVersionPath, 'node_modules'), layout.stateNodeModulesPath);
    await syncDirectory(layout.stateRoot);
    await onPhase('NODE_MODULES_MOVED', switchDetails);
    await symlink(
      path.relative(previousVersionPath, layout.stateNodeModulesPath),
      path.join(previousVersionPath, 'node_modules'),
    );
    await syncDirectory(previousVersionPath);
    await onPhase('NODE_MODULES_LINKED', switchDetails);

    await publishVersionSymlink(liveRoot, layout.candidatePath, transactionId);
    await onPhase('CANDIDATE_PUBLISHED', switchDetails);
    return { previousVersionPath, firstMigration: true };
  } catch (error) {
    await repairInitialMigration({
      liveRoot,
      layout,
      previousVersionPath,
      transactionId,
    });
    throw error;
  }
}

export async function rollbackVersionPointer({
  liveRoot,
  previousVersionPath,
  transactionId,
}) {
  const liveInfo = await lstat(liveRoot);
  invariant(liveInfo.isSymbolicLink(), 'Rollback requires a managed live symlink');
  await publishVersionSymlink(liveRoot, previousVersionPath, `${transactionId}.rollback`);
}

export async function verifyManagedState({
  liveRoot,
  expectedVersionPath,
  stateRuntimePath,
  stateNodeModulesPath,
}) {
  const liveInfo = await lstat(liveRoot);
  invariant(liveInfo.isSymbolicLink(), 'Live root is not a managed version pointer');
  invariant(
    path.resolve(path.dirname(liveRoot), await readlink(liveRoot)) === expectedVersionPath,
    'Live version pointer does not match the expected version',
  );
  invariant(
    path.dirname(expectedVersionPath) === path.join(path.dirname(liveRoot), '.zeely-deploy', 'versions'),
    'Expected version is outside the managed versions directory',
  );
  for (const [name, expectedStatePath] of [
    ['runtime', stateRuntimePath],
    ['node_modules', stateNodeModulesPath],
  ]) {
    const attachmentPath = path.join(expectedVersionPath, name);
    const attachmentInfo = await lstat(attachmentPath);
    invariant(attachmentInfo.isSymbolicLink(), `Managed ${name} attachment is not a symlink`);
    invariant(
      path.resolve(expectedVersionPath, await readlink(attachmentPath)) === expectedStatePath,
      `Managed ${name} attachment points elsewhere`,
    );
    const stateInfo = await lstat(expectedStatePath);
    invariant(
      stateInfo.isDirectory() && !stateInfo.isSymbolicLink(),
      `Managed ${name} state is not a real directory`,
    );
    invariant(stateInfo.uid === process.getuid(), `Managed ${name} state has an unexpected owner`);
    invariant((stateInfo.mode & 0o022) === 0, `Managed ${name} state is group/world writable`);
  }
  invariant(
    await realpath(path.join(liveRoot, 'runtime')) === await realpath(stateRuntimePath),
    'Live runtime attachment changed',
  );
  invariant(
    await realpath(path.join(liveRoot, 'node_modules')) === await realpath(stateNodeModulesPath),
    'Live node_modules attachment changed',
  );
}

export function sanitizeFailure(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replaceAll(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1[redacted-credentials]@')
    .replaceAll(/\/Users\/[A-Za-z0-9._-]+(?:\/[^\s'",)}\]]*)?/g, '[private-path]')
    .replaceAll(/\/home\/[A-Za-z0-9._-]+(?:\/[^\s'",)}\]]*)?/g, '[private-path]')
    .replaceAll(/[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s'",)}\]]*)?/gi, '[private-path]')
    .replaceAll(/\/(?:private|var|tmp|opt|usr)\/[^\s'",)}\]]+/g, '[local-path]')
    .replaceAll(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, '[redacted-secret]')
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[redacted-secret]')
    .replaceAll(/\bek_live_[A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]')
    .replaceAll(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]')
    .replaceAll(/\b(?:sk-|AIza|gh[pousr]_)[A-Za-z0-9_-]{12,}\b/g, '[redacted-secret]')
    .replaceAll(/\b(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s'",)}\]]+/gi, '[redacted-secret]')
    .slice(0, 1000);
}

export const deploymentInternals = {
  DEPLOY_ROOTS,
  TERMINAL_RUN_STATUSES,
  pathExists,
  syncDirectory,
  syncFile,
};
