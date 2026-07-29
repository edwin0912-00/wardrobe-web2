#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  acquireTransactionLock,
  archiveTransactionLock,
  createRuntimeSnapshot,
  createTransactionId,
  deploymentInternals,
  deploymentLayout,
  findActiveRuns,
  inspectLiveRoot,
  isProductDeployPath,
  loadPinnedRelease,
  preimageInventory,
  rollbackVersionPointer,
  restoreRuntimeSnapshot,
  runtimeInventory,
  sanitizeFailure,
  sha256File,
  stageCandidate,
  switchToCandidate,
  verifyCandidate,
  verifyManagedState,
  writeJournal,
} from './lib/add-items-deployment.mjs';
import { assertCanonicalExternalHealthUrl } from './lib/deployment-target.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SERVICE_LABELS = Object.freeze({
  web: 'com.madeforthisjob.zeely',
  monitor: 'com.madeforthisjob.monitor',
  tunnel: 'com.madeforthisjob.cloudflared',
});
const HEALTH_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ZeelyReleaseVerifier/1.0';
const ADD_ITEMS_CHANGE_ALLOWLIST = new Set([
  'src/web/draft-service.js',
  'src/web/profile-service.js',
  'tools/run-monitor-daemon.sh',
  'tools/run-web-daemon.sh',
  'web/public/add-items-flow.js',
  'web/public/add-items-release.css',
  'web/public/app.js',
  'web/public/draft-file-contract.js',
  'web/public/experience.css',
  'web/public/index.html',
  'web/public/profile-client.js',
  'web/public/scene-ui-disabled.js',
  'web/public/server-draft.js',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseArguments(argv) {
  const options = { apply: false };
  const valueFlags = new Set([
    '--release',
    '--live-root',
    '--expected-digest',
    '--expected-manifest-sha256',
    '--expected-base-commit',
    '--web-plist',
    '--monitor-plist',
    '--tunnel-plist',
    '--local-health-url',
    '--monitor-health-url',
    '--external-health-url',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') {
      options.apply = true;
      continue;
    }
    invariant(valueFlags.has(token), `Unknown deployment argument: ${token}`);
    const value = argv[index + 1];
    invariant(value && !value.startsWith('--'), `Missing value for ${token}`);
    options[token.slice(2).replaceAll('-', '_')] = value;
    index += 1;
  }
  for (const required of [
    'release',
    'live_root',
    'expected_digest',
    'expected_manifest_sha256',
    'expected_base_commit',
  ]) {
    invariant(options[required], `Missing --${required.replaceAll('_', '-')}`);
  }
  invariant(path.isAbsolute(options.release), '--release must be an absolute path');
  invariant(path.isAbsolute(options.live_root), '--live-root must be an absolute path');
  invariant(/^[a-f0-9]{64}$/.test(options.expected_digest), '--expected-digest must be SHA-256');
  invariant(
    /^[a-f0-9]{64}$/.test(options.expected_manifest_sha256),
    '--expected-manifest-sha256 must be SHA-256',
  );
  invariant(/^[a-f0-9]{40}$/.test(options.expected_base_commit), '--expected-base-commit must be a Git SHA-1');
  if (options.external_health_url !== undefined) {
    options.external_health_url = assertCanonicalExternalHealthUrl(options.external_health_url);
  }
  if (options.apply) {
    for (const required of [
      'web_plist',
      'monitor_plist',
      'tunnel_plist',
      'external_health_url',
    ]) {
      invariant(options[required], `--apply requires --${required.replaceAll('_', '-')}`);
      if (required.endsWith('_plist')) {
        invariant(path.isAbsolute(options[required]), `--${required.replaceAll('_', '-')} must be an absolute path`);
      }
    }
  }
  options.local_health_url ??= 'http://127.0.0.1:4173/api/health';
  options.monitor_health_url ??= 'http://127.0.0.1:4174/api/health';
  return options;
}

export async function verifyWithTrustedVerifier(release, expectedDigest) {
  const verifierName = release.releaseType === 'PRODUCT_SCENES_V1'
    ? 'verify-product-release.mjs'
    : 'verify-add-items-release.mjs';
  const verifier = path.join(projectRoot, 'tools', verifierName);
  const result = await execute(process.execPath, [verifier, release.directory], {
    maxBuffer: 1024 * 1024,
  });
  const verification = JSON.parse(result.stdout);
  invariant(verification.ok === true, 'Trusted release verifier did not pass');
  invariant(
    verification.content_digest_sha256 === expectedDigest,
    'Trusted verifier returned a different release digest',
  );
  return verification;
}

export async function sqliteQuickCheck(databasePath) {
  const databaseInfo = await lstat(databasePath);
  invariant(
    databaseInfo.isFile() && !databaseInfo.isSymbolicLink(),
    'SQLite database is missing or unsafe',
  );
  const readOnlyUri = `${pathToFileURL(databasePath).href}?mode=ro`;
  const result = await execute('/usr/bin/sqlite3', [readOnlyUri, 'PRAGMA quick_check;'], {
    maxBuffer: 1024 * 1024,
  });
  invariant(result.stdout.trim() === 'ok', 'SQLite quick_check did not return ok');
}

export async function checkpointAndBackupDatabase(databasePath, backupPath) {
  const databaseInfo = await lstat(databasePath);
  invariant(
    databaseInfo.isFile() && !databaseInfo.isSymbolicLink(),
    'SQLite database is missing or unsafe',
  );
  const checkpoint = await execute('/usr/bin/sqlite3', [
    databasePath,
    'PRAGMA wal_checkpoint(TRUNCATE); PRAGMA quick_check;',
  ], { maxBuffer: 1024 * 1024 });
  const lines = checkpoint.stdout.trim().split(/\r?\n/);
  invariant(lines[0]?.startsWith('0|'), 'SQLite WAL checkpoint remained busy');
  invariant(lines.at(-1) === 'ok', 'SQLite quick_check failed after checkpoint');
  const escapedBackup = backupPath.replaceAll("'", "''");
  await execute('/usr/bin/sqlite3', [databasePath, `VACUUM INTO '${escapedBackup}';`], {
    maxBuffer: 1024 * 1024,
  });
  await chmod(backupPath, databaseInfo.mode & 0o777);
  await deploymentInternals.syncFile(backupPath);
  await sqliteQuickCheck(backupPath);
  return sha256File(backupPath);
}

export async function restoreDatabase(databasePath, backupPath, transactionBackupPath) {
  const databaseDirectory = path.dirname(databasePath);
  const quarantineRoot = path.join(transactionBackupPath, 'post-failure-database');
  await mkdir(quarantineRoot, { mode: 0o700 });
  for (const suffix of ['', '-wal', '-shm']) {
    const currentPath = `${databasePath}${suffix}`;
    try {
      await lstat(currentPath);
      await rename(currentPath, path.join(quarantineRoot, `profiles.sqlite${suffix}`));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const temporaryRestore = path.join(databaseDirectory, `.profiles.sqlite.${path.basename(transactionBackupPath)}.restore`);
  await copyFile(backupPath, temporaryRestore);
  const backupInfo = await lstat(backupPath);
  await chmod(temporaryRestore, backupInfo.mode & 0o777);
  const restoreHandle = await open(temporaryRestore, 'r');
  try {
    await restoreHandle.sync();
  } finally {
    await restoreHandle.close();
  }
  await rename(temporaryRestore, databasePath);
  await deploymentInternals.syncDirectory(databaseDirectory);
  await sqliteQuickCheck(databasePath);
}

async function plistLabel(plistPath) {
  const result = await execute('/usr/bin/plutil', [
    '-extract',
    'Label',
    'raw',
    '-o',
    '-',
    plistPath,
  ]);
  const label = result.stdout.trim();
  invariant(/^[A-Za-z0-9._-]+$/.test(label), 'LaunchAgent label is invalid');
  return label;
}

async function plistPayload(plistPath) {
  const info = await lstat(plistPath);
  invariant(info.isFile() && !info.isSymbolicLink(), 'LaunchAgent plist is missing or unsafe');
  invariant(info.uid === process.getuid(), 'LaunchAgent plist has an unexpected owner');
  invariant((info.mode & 0o022) === 0, 'LaunchAgent plist is group/world writable');
  const result = await execute('/usr/bin/plutil', [
    '-convert',
    'json',
    '-o',
    '-',
    plistPath,
  ], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout);
}

export async function validateServicePlist({ role, plist, liveRoot }) {
  const payload = await plistPayload(plist);
  invariant(payload.Label === EXPECTED_SERVICE_LABELS[role], `Unexpected LaunchAgent label for ${role}`);
  invariant(payload.KeepAlive === true && payload.RunAtLoad === true, `LaunchAgent is not persistent: ${role}`);
  invariant(Array.isArray(payload.ProgramArguments), `LaunchAgent arguments are missing: ${role}`);
  if (role === 'web' || role === 'monitor') {
    const scriptName = role === 'web' ? 'run-web-daemon.sh' : 'run-monitor-daemon.sh';
    invariant(
      JSON.stringify(payload.ProgramArguments) === JSON.stringify([
        '/bin/zsh',
        path.join(liveRoot, 'tools', scriptName),
      ]),
      `LaunchAgent arguments do not match the managed ${role} service`,
    );
    invariant(payload.WorkingDirectory === liveRoot, `LaunchAgent working directory is wrong: ${role}`);
  } else {
    invariant(
      payload.ProgramArguments[0] === '/opt/homebrew/bin/cloudflared'
        && payload.ProgramArguments.includes('tunnel')
        && payload.ProgramArguments.includes('run'),
      'Tunnel LaunchAgent does not run the expected cloudflared tunnel',
    );
  }
  return payload.Label;
}

export async function serviceLoaded(domain, label) {
  try {
    await execute('/bin/launchctl', ['print', `${domain}/${label}`], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function bootoutService(domain, service) {
  invariant(await serviceLoaded(domain, service.label), `Required LaunchAgent is not loaded: ${service.role}`);
  await execute('/bin/launchctl', ['bootout', domain, service.plist], {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  invariant(!await serviceLoaded(domain, service.label), `LaunchAgent did not stop: ${service.role}`);
}

export async function bootstrapService(domain, service) {
  invariant(!await serviceLoaded(domain, service.label), `LaunchAgent is already loaded: ${service.role}`);
  await execute('/bin/launchctl', ['bootstrap', domain, service.plist], {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  invariant(await serviceLoaded(domain, service.label), `LaunchAgent did not start: ${service.role}`);
}

export async function bootoutIfLoaded(domain, service) {
  if (!await serviceLoaded(domain, service.label)) return;
  await execute('/bin/launchctl', ['bootout', domain, service.plist], {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  invariant(!await serviceLoaded(domain, service.label), `LaunchAgent did not stop: ${service.role}`);
}

export async function waitForJson(url, predicate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'user-agent': HEALTH_USER_AGENT },
        signal: AbortSignal.timeout(2_500),
      });
      lastStatus = response.status;
      if (response.ok) {
        const body = await response.json();
        if (predicate(body)) return body;
      }
    } catch {
      // The service may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Health gate timed out${lastStatus === null ? '' : ` with HTTP ${lastStatus}`}`);
}

export async function waitUntilUnavailable(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(1_000) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Stopped web service is still reachable');
}

export async function postStartSmoke({ origin, release }) {
  const health = await waitForJson(
    `${origin}/api/health`,
    (body) => body?.status === 'ready'
      && body?.service === 'web'
      && body?.generation === 'available'
      && body?.semantic_qa === 'available',
  );
  if (release.releaseType === 'PRODUCT_SCENES_V1') {
    invariant(
      health.editorial_generation === 'available',
      'Product health does not report editorial generation as available',
    );
  }

  const publicRecords = release.manifest.deploy_files
    .filter((entry) => entry.path.startsWith('web/public/'))
    .sort((left, right) => left.path.localeCompare(right.path));
  invariant(
    publicRecords.some((entry) => entry.path === 'web/public/index.html'),
    'Release smoke record is missing: web/public/index.html',
  );
  if (release.releaseType === 'PRODUCT_SCENES_V1') {
    for (const required of [
      'web/public/scene-ui.js',
      'web/public/scene.css',
      'web/public/editorial-shoot-ui.js',
      'web/public/editorial-state.js',
    ]) {
      invariant(
        publicRecords.some((entry) => entry.path === required),
        `Product release smoke record is missing: ${required}`,
      );
    }
    invariant(
      !publicRecords.some((entry) => entry.path === 'web/public/scene-ui-disabled.js'),
      'Product release contains the disabled scene UI',
    );
  }
  for (const record of publicRecords) {
    const relativePath = record.path;
    const publicName = relativePath.replace('web/public/', '');
    const publicUrl = publicName === 'index.html'
      ? `${origin}/?deploy=${release.manifest.cache_token}`
      : `${origin}/${publicName}?v=${release.manifest.cache_token}`;
    const response = await fetch(publicUrl, {
      cache: 'no-store',
      headers: { 'user-agent': HEALTH_USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    invariant(response.ok, `Live asset smoke failed: ${publicName}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    invariant(bytes.byteLength === record.size_bytes, `Live asset size mismatch: ${publicName}`);
    invariant(sha256(bytes) === record.sha256, `Live asset hash mismatch: ${publicName}`);
    if (publicName === 'index.html') {
      const indexHtml = bytes.toString('utf8');
      invariant(
        indexHtml.includes(`app.js?v=${release.manifest.cache_token}`),
        'Live index does not reference the new cache token',
      );
      if (release.releaseType === 'PRODUCT_SCENES_V1') {
        invariant(
          indexHtml.includes(`scene.css?v=${release.manifest.cache_token}`),
          'Live index does not load the pinned scene stylesheet',
        );
        invariant(
          !indexHtml.includes('Це mood-board, не кнопки запуску')
            && !indexHtml.includes('ще не підключені'),
          'Live index still exposes the preview-only editorial blocker',
        );
      }
    }
    if (publicName === 'app.js') {
      const source = bytes.toString('utf8');
      invariant(
        source.includes('async function beginDraft({ avatar = null, look = null } = {})'),
        'Live app is missing the exact add-items draft entry point',
      );
      invariant(
        source.includes(`./add-items-flow.js?v=${release.manifest.cache_token}`),
        'Live app does not load the pinned add-items module',
      );
      if (release.releaseType === 'PRODUCT_SCENES_V1') {
        invariant(
          source.includes(`./scene-ui.js?v=${release.manifest.cache_token}`),
          'Live app does not load the pinned scene UI',
        );
        invariant(
          !source.includes('scene-ui-disabled'),
          'Live app still loads the disabled scene UI',
        );
      } else {
        invariant(
          source.includes(`./scene-ui-disabled.js?v=${release.manifest.cache_token}`),
          'Live app unexpectedly exposes the unfinished scene UI',
        );
      }
    }
    if (release.releaseType === 'PRODUCT_SCENES_V1' && publicName === 'scene-ui.js') {
      const source = bytes.toString('utf8');
      invariant(
        source.includes('createEditorialShootUi')
          && !source.includes('PREVIEW_ONLY'),
        'Live scene UI does not activate the editorial shoot controller',
      );
    }
    if (release.releaseType === 'PRODUCT_SCENES_V1' && publicName === 'profile-client.js') {
      const source = bytes.toString('utf8');
      invariant(
        source.includes('editorial-shoots'),
        'Live profile client does not expose editorial shoot API methods',
      );
    }
    if (release.releaseType === 'PRODUCT_SCENES_V1' && publicName === 'editorial-shoot-ui.js') {
      const source = bytes.toString('utf8');
      invariant(
        source.includes('export function createEditorialShootUi')
          && source.includes('approveProfileEditorialBible')
          && source.includes('approveProfileEditorialHero'),
        'Live editorial controller is missing approval-gated generation controls',
      );
    }
    if (release.releaseType === 'PRODUCT_SCENES_V1' && publicName === 'editorial-state.js') {
      const source = bytes.toString('utf8');
      invariant(
        source.includes('zeely_active_editorial_shoot_v1'),
        'Live editorial state cannot resume a shoot after reload',
      );
    }
  }

  if (release.releaseType !== 'PRODUCT_SCENES_V1') {
    return { ...health, verified_public_assets: publicRecords.length };
  }

  const fetchProductJson = async (pathname) => {
    const response = await fetch(`${origin}${pathname}`, {
      cache: 'no-store',
      headers: { 'user-agent': HEALTH_USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    invariant(response.ok, `Product API smoke failed: ${pathname}`);
    invariant(
      response.headers.get('content-type')?.toLowerCase().startsWith('application/json'),
      `Product API smoke returned non-JSON: ${pathname}`,
    );
    return response.json();
  };
  const sceneCatalog = await fetchProductJson('/api/scene-presets');
  invariant(Array.isArray(sceneCatalog?.presets), 'Scene preset API returned an invalid catalog');
  const releasedCatalog = JSON.parse(await readFile(path.join(release.directory, 'assets', 'scene-presets', 'index.json'), 'utf8'));
  const expectedPresetIds = [...releasedCatalog.selected_preset_ids].sort();
  const actualPresetIds = sceneCatalog.presets.map((entry) => entry?.preset_id).sort();
  invariant(
    JSON.stringify(actualPresetIds) === JSON.stringify(expectedPresetIds),
    'Scene preset API did not expose the exact approved product presets',
  );
  invariant(
    sceneCatalog.presets.every((entry) => (
      typeof entry?.preset_version === 'string'
      && entry.preset_version.length > 0
      && entry.preview_url
        === `/api/scene-presets/${encodeURIComponent(entry.preset_id)}/${encodeURIComponent(entry.preset_version)}/preview`
    )),
    'Scene preset API returned an invalid preview contract',
  );

  const editorial = await fetchProductJson('/api/editorial-modes');
  invariant(
    editorial?.status === 'ACTIVE' && editorial?.generation_available === true,
    'Editorial mode API is not active',
  );
  invariant(Array.isArray(editorial.modes), 'Editorial mode API returned an invalid catalog');
  const expectedEditorialIds = [...release.manifest.editorial_preview.mode_ids].sort();
  const expectedGenerationIds = [...release.manifest.editorial_preview.generation_mode_ids].sort();
  const actualEditorialIds = editorial.modes.map((entry) => entry?.mode_id).sort();
  const actualGenerationIds = editorial.modes
    .filter((entry) => entry?.generation_available === true)
    .map((entry) => entry?.mode_id)
    .sort();
  invariant(
    JSON.stringify(actualEditorialIds) === JSON.stringify(expectedEditorialIds),
    'Editorial mode API did not expose the exact approved previews',
  );
  invariant(
    JSON.stringify(actualGenerationIds) === JSON.stringify(expectedGenerationIds)
      && JSON.stringify([...(editorial.generation_mode_ids ?? [])].sort())
        === JSON.stringify(expectedGenerationIds),
    'Editorial mode API did not expose the exact approved generation modes',
  );
  invariant(
    editorial.modes.every((entry) => (
      entry?.generation_available
        === expectedGenerationIds.includes(entry?.mode_id)
      && typeof entry?.version === 'string'
      && entry.preview_url
        === `/api/editorial-modes/${encodeURIComponent(entry.mode_id)}/${encodeURIComponent(entry.version)}/preview`
    )),
    'Editorial mode API returned invalid per-mode generation authority or preview contract',
  );

  const fetchProductPreview = async (previewUrl, expectedRecord, label) => {
    invariant(
      expectedRecord && /^[a-f0-9]{64}$/.test(expectedRecord.sha256),
      `Product manifest is missing preview authority: ${label}`,
    );
    const response = await fetch(`${origin}${previewUrl}`, {
      cache: 'no-store',
      headers: { 'user-agent': HEALTH_USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    invariant(response.ok, `Product preview smoke failed: ${label}`);
    invariant(
      response.headers.get('content-type')?.toLowerCase().startsWith('image/webp'),
      `Product preview is not WebP: ${label}`,
    );
    invariant(
      response.headers.get('cache-control') === 'public, max-age=31536000, immutable',
      `Product preview is not immutable: ${label}`,
    );
    invariant(
      response.headers.get('etag') === `"${expectedRecord.sha256}"`,
      `Product preview ETag does not match its release authority: ${label}`,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    invariant(bytes.byteLength > 0, `Product preview is empty: ${label}`);
    invariant(bytes.byteLength === expectedRecord.size_bytes, `Product preview size mismatch: ${label}`);
    invariant(sha256(bytes) === expectedRecord.sha256, `Product preview hash mismatch: ${label}`);
  };
  const deployRecords = release.manifest.deploy_files;
  for (const preset of sceneCatalog.presets) {
    const matches = deployRecords.filter((record) => (
      record.path.startsWith(`assets/scene-presets/${preset.preset_id}/`)
      && record.path.endsWith('/environment-plate.webp')
    ));
    invariant(matches.length === 1, `Product manifest has ambiguous scene preview authority: ${preset.preset_id}`);
    await fetchProductPreview(preset.preview_url, matches[0], `scene:${preset.preset_id}`);
  }
  for (const mode of editorial.modes) {
    const authority = release.manifest.editorial_preview.assets
      .find((entry) => entry.mode_id === mode.mode_id);
    const record = deployRecords.find((entry) => entry.path === authority?.image_path);
    invariant(
      authority?.image_sha256 === record?.sha256,
      `Product editorial authority disagrees with its deploy record: ${mode.mode_id}`,
    );
    await fetchProductPreview(mode.preview_url, record, `editorial:${mode.mode_id}`);
  }
  return {
    ...health,
    verified_public_assets: publicRecords.length,
    scene_presets: actualPresetIds.length,
    editorial_modes: actualEditorialIds.length,
    editorial_generation_modes: actualGenerationIds.length,
    editorial_generation: 'ENABLED',
  };
}

async function assertDependencyCompatibility(live, release) {
  const releaseLockHash = await sha256File(path.join(release.directory, 'package-lock.json'));
  invariant(
    releaseLockHash === live.packageLockSha256,
    'Live installed dependencies do not match the release lockfile',
  );
  const npmExecutable = '/opt/homebrew/bin/npm';
  const npmLinkInfo = await lstat(npmExecutable);
  invariant(npmLinkInfo.isSymbolicLink(), 'Pinned npm launcher is missing or unsafe');
  const npmRealPath = await realpath(npmExecutable);
  invariant(
    npmRealPath === '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js'
      || npmRealPath.startsWith('/opt/homebrew/Cellar/node/'),
    'Pinned npm launcher resolves outside Homebrew Node',
  );
  const npmInfo = await lstat(npmRealPath);
  invariant(npmInfo.isFile() && !npmInfo.isSymbolicLink(), 'Pinned npm target is unsafe');
  invariant(npmInfo.uid === process.getuid(), 'Pinned npm target has an unexpected owner');
  invariant((npmInfo.mode & 0o022) === 0, 'Pinned npm target is group/world writable');
  await execute(npmExecutable, [
    'ls',
    '--omit=dev',
    '--depth=0',
    '--prefix',
    live.realRoot,
  ], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      NODE_ENV: 'production',
    },
  });
}

async function assertDiskCapacity(parent, releaseSize, databasePath, runtimeSize) {
  const filesystem = await statfs(parent);
  const database = await stat(databasePath);
  const available = filesystem.bavail * filesystem.bsize;
  const required = Math.max(
    128 * 1024 * 1024,
    releaseSize * 4 + database.size * 4 + runtimeSize * 2,
  );
  invariant(available >= required, 'Insufficient free space for candidate, backup, and rollback');
  return { available_bytes: available, required_bytes: required };
}

function sameFileIdentity(actual, expected) {
  return actual.dev === expected.dev && actual.ino === expected.ino;
}

function exactJsonMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeDurableReceipt(receiptPath, receipt) {
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await deploymentInternals.syncFile(receiptPath);
  await deploymentInternals.syncDirectory(path.dirname(receiptPath));
}

export function scopedLiveChanges(preimage, deployRecords, releaseType = 'ADD_ITEMS_V1') {
  const records = new Map(deployRecords.map((record) => [record.path, record]));
  const changedFiles = preimage.filter((entry) => {
    if (!entry.present) return true;
    const releaseRecord = records.get(entry.path);
    invariant(releaseRecord, `Preimage path is missing from the release: ${entry.path}`);
    return releaseRecord.sha256 !== entry.sha256 || releaseRecord.mode !== entry.mode;
  });
  invariant(
    releaseType === 'ADD_ITEMS_V1' || releaseType === 'PRODUCT_SCENES_V1',
    'Unsupported deployment change scope',
  );
  const unexpectedChanges = changedFiles.filter((entry) => (
    releaseType === 'PRODUCT_SCENES_V1'
      ? !isProductDeployPath(entry.path)
      : !ADD_ITEMS_CHANGE_ALLOWLIST.has(entry.path)
  ));
  invariant(
    unexpectedChanges.length === 0,
    `Release would overwrite ${unexpectedChanges.length} non-${
      releaseType === 'PRODUCT_SCENES_V1' ? 'product' : 'add-items'
    } live file(s)`,
  );
  return changedFiles;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const release = await loadPinnedRelease({
    releaseDirectory: options.release,
    expectedContentDigest: options.expected_digest,
    expectedManifestSha256: options.expected_manifest_sha256,
    expectedBaseCommit: options.expected_base_commit,
  });
  const verification = await verifyWithTrustedVerifier(release, options.expected_digest);
  const live = await inspectLiveRoot(options.live_root);
  const activeRuns = await findActiveRuns(live.runtimePath);
  invariant(activeRuns.length === 0, `Deployment refused: ${activeRuns.length} active or malformed run(s)`);
  const databasePath = path.join(live.runtimePath, 'profiles.sqlite');
  await sqliteQuickCheck(databasePath);
  await assertDependencyCompatibility(live, release);
  const runtimePreflight = await runtimeInventory(live.runtimePath);
  const disk = await assertDiskCapacity(
    path.dirname(live.liveRoot),
    release.manifest.release_size_bytes,
    databasePath,
    runtimePreflight.size_bytes,
  );
  const preimage = await preimageInventory(live.realRoot, release.manifest.deploy_files);
  const changedFiles = scopedLiveChanges(
    preimage,
    release.manifest.deploy_files,
    release.releaseType,
  );
  const liveRuntimeInfo = await stat(live.runtimePath);
  const liveNodeModulesInfo = await stat(live.nodeModulesPath);

  const plan = {
    ok: true,
    mode: options.apply ? 'APPLY' : 'DRY_RUN',
    release: {
      base_commit: release.manifest.base_commit,
      type: release.releaseType,
      content_digest_sha256: release.manifest.content_digest_sha256,
      manifest_sha256: release.manifestSha256,
      cache_token: release.manifest.cache_token,
      deploy_files: release.manifest.deploy_files.length,
    },
    live: {
      active_runs: 0,
      sqlite_quick_check: 'ok',
      package_lock_match: true,
      root_is_managed_symlink: live.rootWasSymlink,
      runtime_snapshot: {
        file_count: runtimePreflight.file_count,
        size_bytes: runtimePreflight.size_bytes,
        source_digest_sha256: runtimePreflight.digest_sha256,
      },
      runtime_identity: {
        device: String(liveRuntimeInfo.dev),
        inode: String(liveRuntimeInfo.ino),
      },
      node_modules_identity: {
        device: String(liveNodeModulesInfo.dev),
        inode: String(liveNodeModulesInfo.ino),
      },
      changed_files: changedFiles.filter((entry) => entry.present).length,
      new_files: changedFiles.filter((entry) => !entry.present).length,
      unexpected_changes: 0,
    },
    disk,
  };
  if (!options.apply) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }

  const transactionId = createTransactionId();
  const layout = deploymentLayout(live.liveRoot, transactionId, release.manifest.content_digest_sha256);
  const parentDevice = (await stat(layout.parent)).dev;
  invariant((await stat(release.directory)).dev === parentDevice, 'Release and live root are on different filesystems');

  const uid = process.getuid();
  const domain = `gui/${uid}`;
  const services = {
    web: {
      role: 'web',
      plist: options.web_plist,
      label: await validateServicePlist({
        role: 'web',
        plist: options.web_plist,
        liveRoot: live.liveRoot,
      }),
    },
    monitor: {
      role: 'monitor',
      plist: options.monitor_plist,
      label: await validateServicePlist({
        role: 'monitor',
        plist: options.monitor_plist,
        liveRoot: live.liveRoot,
      }),
    },
    tunnel: {
      role: 'tunnel',
      plist: options.tunnel_plist,
      label: await validateServicePlist({
        role: 'tunnel',
        plist: options.tunnel_plist,
        liveRoot: live.liveRoot,
      }),
    },
  };
  for (const service of Object.values(services)) {
    invariant(await serviceLoaded(domain, service.label), `Required LaunchAgent is not loaded: ${service.role}`);
  }

  let journal = {
    schema_version: '1.0.0',
    transaction_id: transactionId,
    phase: 'VERIFIED',
    started_at: new Date().toISOString(),
    release: plan.release,
    preimage: {
      inventory_sha256: sha256(Buffer.from(JSON.stringify(preimage))),
      package_lock_sha256: live.packageLockSha256,
      root_was_symlink: live.rootWasSymlink,
      runtime_device: String(liveRuntimeInfo.dev),
      runtime_inode: String(liveRuntimeInfo.ino),
      node_modules_device: String(liveNodeModulesInfo.dev),
      node_modules_inode: String(liveNodeModulesInfo.ino),
    },
    events: [{ phase: 'VERIFIED', at: new Date().toISOString() }],
  };
  let lockAcquired = false;
  let switched = null;
  let databaseBackupPath = null;
  let databaseBackupSha256 = null;
  let runtimeSnapshotPath = null;
  let runtimeSnapshotDigest = null;
  const stopped = new Set();
  let serviceMutationStarted = false;
  let finalOutcome = 'ABORTED';
  let terminationSignal = null;
  const requestTermination = (signal) => {
    terminationSignal ??= signal;
  };
  const onSigint = () => requestTermination('SIGINT');
  const onSigterm = () => requestTermination('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  const rollbackPhases = new Set(['ABORTED', 'ROLLED_BACK', 'ROLLBACK_FAILED']);

  const advance = async (phase, details = {}) => {
    journal = {
      ...journal,
      phase,
      ...details,
      events: [...journal.events, { phase, at: new Date().toISOString() }],
    };
    await writeJournal(layout, journal);
    if (terminationSignal && !rollbackPhases.has(phase)) {
      throw new Error(`Deployment interrupted by ${terminationSignal}`);
    }
  };

  try {
    await acquireTransactionLock(layout, transactionId);
    lockAcquired = true;
    await writeJournal(layout, journal);
    await stageCandidate({ release, layout });
    await verifyCandidate({
      candidatePath: layout.candidatePath,
      manifest: release.manifest,
      stateRuntimePath: layout.stateRuntimePath,
      stateNodeModulesPath: layout.stateNodeModulesPath,
    });
    await advance('CANDIDATE_READY');

    serviceMutationStarted = true;
    await bootoutService(domain, services.tunnel);
    stopped.add('tunnel');
    await advance('TUNNEL_STOPPED');
    await bootoutService(domain, services.monitor);
    stopped.add('monitor');
    await advance('MONITOR_STOPPED');
    await bootoutService(domain, services.web);
    stopped.add('web');
    await waitUntilUnavailable(options.local_health_url);
    await advance('WEB_STOPPED');

    const afterIngressDrain = await findActiveRuns(live.runtimePath);
    invariant(afterIngressDrain.length === 0, 'A run became active during ingress drain');
    const stoppedRuntimeInfo = await stat(live.runtimePath);
    const stoppedNodeModulesInfo = await stat(live.nodeModulesPath);
    invariant(
      sameFileIdentity(stoppedRuntimeInfo, liveRuntimeInfo),
      'Runtime identity changed between preflight and service stop',
    );
    invariant(
      sameFileIdentity(stoppedNodeModulesInfo, liveNodeModulesInfo),
      'node_modules identity changed between preflight and service stop',
    );
    const stoppedPreimage = await preimageInventory(live.realRoot, release.manifest.deploy_files);
    invariant(
      exactJsonMatch(stoppedPreimage, preimage),
      'Live application changed between preflight and service stop',
    );
    scopedLiveChanges(stoppedPreimage, release.manifest.deploy_files, release.releaseType);
    await advance('STOPPED_AND_REVERIFIED', {
      stopped_preimage_sha256: sha256(Buffer.from(JSON.stringify(stoppedPreimage))),
    });

    await mkdir(layout.backupPath, { mode: 0o700 });
    databaseBackupPath = path.join(layout.backupPath, 'profiles.sqlite.backup');
    databaseBackupSha256 = await checkpointAndBackupDatabase(databasePath, databaseBackupPath);
    await advance('DATABASE_BACKED_UP', {
      database_backup_sha256: databaseBackupSha256,
    });
    runtimeSnapshotPath = path.join(layout.backupPath, 'runtime.snapshot');
    const runtimeSnapshot = await createRuntimeSnapshot({
      runtimePath: live.runtimePath,
      snapshotPath: runtimeSnapshotPath,
    });
    runtimeSnapshotDigest = runtimeSnapshot.digest_sha256;
    await advance('RUNTIME_BACKED_UP', {
      database_backup_sha256: databaseBackupSha256,
      runtime_snapshot: {
        file_count: runtimeSnapshot.file_count,
        size_bytes: runtimeSnapshot.size_bytes,
        digest_sha256: runtimeSnapshotDigest,
      },
    });

    const expectedPreviousVersionName = live.rootWasSymlink
      ? path.basename(live.realRoot)
      : `preimage-${transactionId}`;
    await advance('SWITCH_PREPARED', {
      previous_version_name: expectedPreviousVersionName,
      first_managed_migration_expected: !live.rootWasSymlink,
    });
    switched = await switchToCandidate({
      liveRoot: live.liveRoot,
      layout,
      transactionId,
      onPhase: async (phase) => {
        await advance(phase, {
          previous_version_name: expectedPreviousVersionName,
          first_managed_migration_expected: !live.rootWasSymlink,
        });
      },
    });
    await verifyManagedState({
      liveRoot: live.liveRoot,
      expectedVersionPath: layout.candidatePath,
      stateRuntimePath: layout.stateRuntimePath,
      stateNodeModulesPath: layout.stateNodeModulesPath,
    });
    invariant(
      sameFileIdentity(await stat(layout.stateRuntimePath), liveRuntimeInfo),
      'Shared runtime identity changed during version switch',
    );
    invariant(
      sameFileIdentity(await stat(layout.stateNodeModulesPath), liveNodeModulesInfo),
      'Shared node_modules identity changed during version switch',
    );
    await advance('SWITCHED', {
      previous_version_name: path.basename(switched.previousVersionPath),
      first_managed_migration: switched.firstMigration,
    });

    await bootstrapService(domain, services.web);
    stopped.delete('web');
    const localOrigin = new URL(options.local_health_url).origin;
    const webHealth = await postStartSmoke({ origin: localOrigin, release });
    await advance('WEB_HEALTHY', {
      web_health: {
        status: webHealth.status,
        service: webHealth.service,
      },
    });

    await bootstrapService(domain, services.monitor);
    stopped.delete('monitor');
    const monitorHealth = await waitForJson(
      options.monitor_health_url,
      (body) => body?.status === 'ok' && body?.app?.status === 'up',
    );
    await advance('MONITOR_HEALTHY', {
      monitor_health: {
        status: monitorHealth.status,
        app_status: monitorHealth.app.status,
      },
    });

    await bootstrapService(domain, services.tunnel);
    stopped.delete('tunnel');
    const externalHealth = await waitForJson(
      options.external_health_url,
      (body) => body?.status === 'ready'
        && body?.service === 'web'
        && body?.generation === 'available'
        && body?.semantic_qa === 'available',
      60_000,
    );
    await advance('EXTERNAL_HEALTHY', {
      external_health: {
        status: externalHealth.status,
        service: externalHealth.service,
      },
    });
    await advance('COMMITTED', {
      committed_at: new Date().toISOString(),
    });
    finalOutcome = 'COMMITTED';
    const receipt = {
      transaction_id: transactionId,
      outcome: finalOutcome,
      release: plan.release,
      database_backup_sha256: databaseBackupSha256,
      runtime_snapshot_digest_sha256: runtimeSnapshotDigest,
      smoke: {
        local_web: 'PASS',
        monitor: 'PASS',
        external: 'PASS',
      },
      completed_at: new Date().toISOString(),
    };
    await writeDurableReceipt(layout.receiptPath, receipt);
    await archiveTransactionLock(layout, transactionId, finalOutcome);
    lockAcquired = false;
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      outcome: finalOutcome,
      transaction_id: transactionId,
      content_digest_sha256: release.manifest.content_digest_sha256,
      cache_token: release.manifest.cache_token,
    })}\n`);
  } catch (error) {
    const failure = sanitizeFailure(error);
    let rollbackStatus = 'NOT_REQUIRED';
    try {
      if (serviceMutationStarted) {
        for (const service of [services.tunnel, services.monitor, services.web]) {
          await bootoutIfLoaded(domain, service);
          stopped.add(service.role);
        }
        await waitUntilUnavailable(options.local_health_url);
        if (switched) {
          await rollbackVersionPointer({
            liveRoot: live.liveRoot,
            previousVersionPath: switched.previousVersionPath,
            transactionId,
          });
          await verifyManagedState({
            liveRoot: live.liveRoot,
            expectedVersionPath: switched.previousVersionPath,
            stateRuntimePath: layout.stateRuntimePath,
            stateNodeModulesPath: layout.stateNodeModulesPath,
          });
          if (runtimeSnapshotPath) {
            const restoredRuntime = await restoreRuntimeSnapshot({
              stateRuntimePath: layout.stateRuntimePath,
              snapshotPath: runtimeSnapshotPath,
              quarantinePath: path.join(layout.backupPath, 'post-failure-runtime'),
              transactionId,
            });
            invariant(
              restoredRuntime.digest_sha256 === runtimeSnapshotDigest,
              'Restored runtime does not match the pre-deploy snapshot',
            );
            await sqliteQuickCheck(path.join(layout.stateRuntimePath, 'profiles.sqlite'));
          } else if (databaseBackupPath) {
            const managedDatabasePath = path.join(layout.stateRuntimePath, 'profiles.sqlite');
            await restoreDatabase(managedDatabasePath, databaseBackupPath, layout.backupPath);
          }
          rollbackStatus = 'RESTORED';
        }
        for (const service of [services.web, services.monitor, services.tunnel]) {
          if (stopped.has(service.role)) {
            await bootstrapService(domain, service);
            stopped.delete(service.role);
          }
        }
        await waitForJson(
          options.local_health_url,
          (body) => body?.status === 'ready'
            && body?.service === 'web'
            && body?.generation === 'available'
            && body?.semantic_qa === 'available',
        );
        await waitForJson(
          options.monitor_health_url,
          (body) => body?.status === 'ok' && body?.app?.status === 'up',
        );
        await waitForJson(
          options.external_health_url,
          (body) => body?.status === 'ready'
            && body?.service === 'web'
            && body?.generation === 'available'
            && body?.semantic_qa === 'available',
          60_000,
        );
      }
      if (lockAcquired) {
        await advance(serviceMutationStarted ? 'ROLLED_BACK' : 'ABORTED', {
          failure,
          rollback_status: rollbackStatus,
          rolled_back_at: new Date().toISOString(),
        });
        await archiveTransactionLock(
          layout,
          transactionId,
          serviceMutationStarted ? 'ROLLED_BACK' : 'ABORTED',
        );
        lockAcquired = false;
      }
    } catch (rollbackError) {
      rollbackStatus = `FAILED: ${sanitizeFailure(rollbackError)}`;
      if (lockAcquired) {
        await advance('ROLLBACK_FAILED', {
          failure,
          rollback_status: rollbackStatus,
          failed_at: new Date().toISOString(),
        }).catch(() => {});
      }
    }
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    throw new Error(`Deployment failed; rollback ${rollbackStatus}. ${failure}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${sanitizeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
