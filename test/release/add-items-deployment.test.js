import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  acquireTransactionLock,
  archiveTransactionLock,
  createRuntimeSnapshot,
  createTransactionId,
  deploymentLayout,
  findActiveRuns,
  inspectLiveRoot,
  inspectPendingTransaction,
  loadPinnedRelease,
  preimageInventory,
  recoverInterruptedSwitch,
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
} from '../../tools/lib/add-items-deployment.mjs';
import {
  checkpointAndBackupDatabase,
  parseArguments,
  postStartSmoke,
  restoreDatabase,
  scopedLiveChanges,
  sqliteQuickCheck,
  verifyWithTrustedVerifier,
} from '../../tools/deploy-add-items-release.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..', '..');

async function createRelease(root) {
  const releaseDirectory = path.join(root, 'release');
  await execute(process.execPath, [
    path.join(projectRoot, 'tools', 'build-add-items-release.mjs'),
    releaseDirectory,
  ]);
  const manifestPath = path.join(releaseDirectory, 'ops', 'add-items-release-manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  return {
    releaseDirectory,
    manifest,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  };
}

async function createProductRelease(root) {
  const releaseDirectory = path.join(root, 'product-release');
  await execute(process.execPath, [
    path.join(projectRoot, 'tools', 'build-product-release.mjs'),
    releaseDirectory,
  ]);
  const manifestPath = path.join(releaseDirectory, 'ops', 'product-release-manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  return {
    releaseDirectory,
    manifest,
    manifestPath,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  };
}

async function createFakeLiveRoot(parent, releaseDirectory) {
  const liveRoot = path.join(parent, 'app');
  await mkdir(path.join(liveRoot, 'runtime', 'runs'), { recursive: true });
  await mkdir(path.join(liveRoot, 'node_modules'), { recursive: true });
  await mkdir(path.join(liveRoot, 'web', 'public'), { recursive: true });
  await copyFile(path.join(releaseDirectory, 'package.json'), path.join(liveRoot, 'package.json'));
  await copyFile(path.join(releaseDirectory, 'package-lock.json'), path.join(liveRoot, 'package-lock.json'));
  await writeFile(path.join(liveRoot, 'runtime', 'state-sentinel.txt'), 'runtime survives\n');
  await writeFile(path.join(liveRoot, 'node_modules', 'dependency-sentinel.txt'), 'dependencies survive\n');
  await writeFile(path.join(liveRoot, 'web', 'public', 'old-app.js'), 'old version\n');
  return liveRoot;
}

function recoveryJournal({ transactionId, digest, phase, previousVersionName, firstMigration }) {
  return {
    schema_version: '1.0.0',
    transaction_id: transactionId,
    phase,
    started_at: '2026-07-23T17:00:00.000Z',
    release: { content_digest_sha256: digest },
    previous_version_name: previousVersionName,
    first_managed_migration_expected: firstMigration,
    events: [{ phase, at: '2026-07-23T17:00:00.000Z' }],
  };
}

test('stages a pinned overlay, migrates state once, switches atomically, and rolls back without losing state', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const liveParent = path.join(temporaryRoot, 'live');
  await mkdir(liveParent);
  const liveRoot = await createFakeLiveRoot(liveParent, built.releaseDirectory);

  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  const live = await inspectLiveRoot(liveRoot);
  assert.equal(live.packageLockSha256, await sha256File(path.join(built.releaseDirectory, 'package-lock.json')));
  assert.deepEqual(await findActiveRuns(live.runtimePath), []);

  const before = await preimageInventory(live.realRoot, release.manifest.deploy_files);
  assert.ok(before.some((entry) => entry.path === 'web/public/app.js' && entry.present === false));

  const transactionId = createTransactionId(new Date('2026-07-23T17:00:00.000Z'));
  const layout = deploymentLayout(liveRoot, transactionId, release.manifest.content_digest_sha256);
  await acquireTransactionLock(layout, transactionId);
  await stageCandidate({ release, layout });
  await verifyCandidate({
    candidatePath: layout.candidatePath,
    manifest: release.manifest,
    stateRuntimePath: layout.stateRuntimePath,
    stateNodeModulesPath: layout.stateNodeModulesPath,
  });

  const switched = await switchToCandidate({ liveRoot, layout, transactionId });
  assert.equal(switched.firstMigration, true);
  await verifyManagedState({
    liveRoot,
    expectedVersionPath: layout.candidatePath,
    stateRuntimePath: layout.stateRuntimePath,
    stateNodeModulesPath: layout.stateNodeModulesPath,
  });
  assert.equal(
    await readFile(path.join(liveRoot, 'runtime', 'state-sentinel.txt'), 'utf8'),
    'runtime survives\n',
  );
  assert.equal(
    await readFile(path.join(liveRoot, 'node_modules', 'dependency-sentinel.txt'), 'utf8'),
    'dependencies survive\n',
  );
  assert.equal(
    path.resolve(path.dirname(liveRoot), await readlink(liveRoot)),
    layout.candidatePath,
  );

  await rollbackVersionPointer({
    liveRoot,
    previousVersionPath: switched.previousVersionPath,
    transactionId,
  });
  await verifyManagedState({
    liveRoot,
    expectedVersionPath: switched.previousVersionPath,
    stateRuntimePath: layout.stateRuntimePath,
    stateNodeModulesPath: layout.stateNodeModulesPath,
  });
  assert.equal(
    await readFile(path.join(liveRoot, 'web', 'public', 'old-app.js'), 'utf8'),
    'old version\n',
  );
  assert.equal(
    await readFile(path.join(liveRoot, 'runtime', 'state-sentinel.txt'), 'utf8'),
    'runtime survives\n',
  );
  await archiveTransactionLock(layout, transactionId, 'ROLLED_BACK');
});

test('live-root inspection rejects unmanaged pointers and shared-state attachment substitution', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-live-root-identity-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);

  const firstParent = path.join(temporaryRoot, 'initial');
  await mkdir(firstParent);
  const initialRoot = await createFakeLiveRoot(firstParent, built.releaseDirectory);
  const outsideRuntime = path.join(temporaryRoot, 'outside-runtime');
  await mkdir(outsideRuntime);
  await rm(path.join(initialRoot, 'runtime'), { recursive: true });
  await symlink(outsideRuntime, path.join(initialRoot, 'runtime'));
  await assert.rejects(
    inspectLiveRoot(initialRoot),
    /Initial runtime is not a real directory/,
  );

  const secondParent = path.join(temporaryRoot, 'managed');
  await mkdir(secondParent);
  const unmanagedTarget = await createFakeLiveRoot(
    path.join(temporaryRoot, 'unmanaged-target-parent'),
    built.releaseDirectory,
  );
  const managedRoot = path.join(secondParent, 'app');
  await symlink(unmanagedTarget, managedRoot);
  await assert.rejects(
    inspectLiveRoot(managedRoot),
    /does not target a direct version child/,
  );
});

test('staging rehashes source files and rejects a verify-to-copy mutation', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-tamper-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  const liveParent = path.join(temporaryRoot, 'live');
  await mkdir(liveParent);
  const liveRoot = await createFakeLiveRoot(liveParent, built.releaseDirectory);
  const transactionId = createTransactionId(new Date('2026-07-23T17:01:00.000Z'));
  const layout = deploymentLayout(liveRoot, transactionId, release.manifest.content_digest_sha256);
  await acquireTransactionLock(layout, transactionId);

  const appPath = path.join(built.releaseDirectory, 'web', 'public', 'app.js');
  await writeFile(appPath, `${await readFile(appPath, 'utf8')}\n// post-verify mutation\n`);
  await assert.rejects(
    stageCandidate({ release, layout }),
    /Release (?:size|hash) changed during staging/,
  );
});

test('candidate verification rejects every file or directory outside the exact manifest tree', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-candidate-set-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  const liveParent = path.join(temporaryRoot, 'live');
  await mkdir(liveParent);
  const liveRoot = await createFakeLiveRoot(liveParent, built.releaseDirectory);
  const transactionId = createTransactionId(new Date('2026-07-23T17:02:00.000Z'));
  const layout = deploymentLayout(liveRoot, transactionId, release.manifest.content_digest_sha256);
  await acquireTransactionLock(layout, transactionId);
  await stageCandidate({ release, layout });
  await mkdir(path.join(layout.candidatePath, 'unexpected-empty-directory'));
  await writeFile(path.join(layout.candidatePath, 'unexpected-file.txt'), 'not in manifest\n');

  await assert.rejects(
    verifyCandidate({
      candidatePath: layout.candidatePath,
      manifest: release.manifest,
      stateRuntimePath: layout.stateRuntimePath,
      stateNodeModulesPath: layout.stateNodeModulesPath,
    }),
    /Candidate (?:file|directory) set mismatch.*unexpected/,
  );
});

test('every initial migration interruption repairs the previous version before services can restart', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-migration-failure-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  const phases = [
    'PREIMAGE_RENAMED',
    'PREIMAGE_POINTER_PUBLISHED',
    'RUNTIME_MOVED',
    'RUNTIME_LINKED',
    'NODE_MODULES_MOVED',
    'NODE_MODULES_LINKED',
    'CANDIDATE_PUBLISHED',
  ];

  for (const [index, phase] of phases.entries()) {
    const liveParent = path.join(temporaryRoot, `live-${index}`);
    await mkdir(liveParent);
    const liveRoot = await createFakeLiveRoot(liveParent, built.releaseDirectory);
    const transactionId = createTransactionId(new Date(`2026-07-23T17:${String(10 + index).padStart(2, '0')}:00.000Z`));
    const layout = deploymentLayout(liveRoot, transactionId, release.manifest.content_digest_sha256);
    await acquireTransactionLock(layout, transactionId);
    await stageCandidate({ release, layout });

    await assert.rejects(
      switchToCandidate({
        liveRoot,
        layout,
        transactionId,
        onPhase: async (currentPhase) => {
          if (currentPhase === phase) throw new Error(`injected ${phase}`);
        },
      }),
      new RegExp(`injected ${phase}`),
    );
    const repaired = await inspectLiveRoot(liveRoot);
    assert.equal(repaired.rootWasSymlink, true);
    assert.match(path.basename(await realpath(liveRoot)), /^preimage-/);
    assert.equal(
      await readFile(path.join(liveRoot, 'runtime', 'state-sentinel.txt'), 'utf8'),
      'runtime survives\n',
    );
    assert.equal(
      await readFile(path.join(liveRoot, 'node_modules', 'dependency-sentinel.txt'), 'utf8'),
      'dependencies survive\n',
    );
  }
});

test('an interrupted subsequent managed switch restores the exact previous pointer', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-managed-failure-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  const liveParent = path.join(temporaryRoot, 'live');
  await mkdir(liveParent);
  const liveRoot = await createFakeLiveRoot(liveParent, built.releaseDirectory);

  const firstId = createTransactionId(new Date('2026-07-23T17:30:00.000Z'));
  const firstLayout = deploymentLayout(liveRoot, firstId, release.manifest.content_digest_sha256);
  await acquireTransactionLock(firstLayout, firstId);
  await stageCandidate({ release, layout: firstLayout });
  await switchToCandidate({ liveRoot, layout: firstLayout, transactionId: firstId });
  const previousManagedTarget = path.resolve(path.dirname(liveRoot), await readlink(liveRoot));
  await archiveTransactionLock(firstLayout, firstId, 'COMMITTED');

  const secondId = createTransactionId(new Date('2026-07-23T17:31:00.000Z'));
  const secondLayout = deploymentLayout(liveRoot, secondId, release.manifest.content_digest_sha256);
  await acquireTransactionLock(secondLayout, secondId);
  await stageCandidate({ release, layout: secondLayout });
  await assert.rejects(
    switchToCandidate({
      liveRoot,
      layout: secondLayout,
      transactionId: secondId,
      onPhase: async (phase) => {
        if (phase === 'CANDIDATE_PUBLISHED') throw new Error('injected managed switch failure');
      },
    }),
    /injected managed switch failure/,
  );
  assert.equal(
    path.resolve(path.dirname(liveRoot), await readlink(liveRoot)),
    previousManagedTarget,
  );
  assert.equal(
    await readFile(path.join(liveRoot, 'runtime', 'state-sentinel.txt'), 'utf8'),
    'runtime survives\n',
  );
});

test('pending transaction inspection safely reconstructs layout and initial recovery is idempotent', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-initial-recovery-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  const liveParent = path.join(temporaryRoot, 'live');
  await mkdir(liveParent);
  const liveRoot = await createFakeLiveRoot(liveParent, built.releaseDirectory);
  const transactionId = createTransactionId(new Date('2026-07-23T17:32:00.000Z'));
  const digest = release.manifest.content_digest_sha256;
  const layout = deploymentLayout(liveRoot, transactionId, digest);
  const previousVersionName = `preimage-${transactionId}`;
  const previousVersionPath = path.join(layout.versionsRoot, previousVersionName);
  await acquireTransactionLock(layout, transactionId);
  await stageCandidate({ release, layout });
  await writeJournal(layout, recoveryJournal({
    transactionId,
    digest,
    phase: 'SWITCH_PREPARED',
    previousVersionName,
    firstMigration: true,
  }));
  const beforeMutation = await recoverInterruptedSwitch({ liveRoot, transactionId });
  assert.equal(beforeMutation.action, 'NO_SWITCH_MUTATION');
  assert.equal((await lstat(liveRoot)).isDirectory(), true);

  await writeJournal(layout, recoveryJournal({
    transactionId,
    digest,
    phase: 'RUNTIME_MOVED',
    previousVersionName,
    firstMigration: true,
  }));

  // Exact crash state: preimage and pointer exist, runtime was moved, but its
  // replacement link and node_modules migration were not completed.
  await rename(liveRoot, previousVersionPath);
  await symlink(path.relative(layout.parent, previousVersionPath), liveRoot);
  await rename(path.join(previousVersionPath, 'runtime'), layout.stateRuntimePath);

  const pending = await inspectPendingTransaction(liveRoot);
  assert.equal(pending.transactionId, transactionId);
  assert.equal(pending.journal.phase, 'RUNTIME_MOVED');
  assert.equal(pending.layout.candidatePath, layout.candidatePath);

  const phases = [];
  const first = await recoverInterruptedSwitch({
    liveRoot,
    transactionId,
    onPhase: async (phase, details) => phases.push({ phase, details }),
  });
  const second = await recoverInterruptedSwitch({ liveRoot, transactionId });
  assert.equal(first.action, 'INITIAL_PREIMAGE_RESTORED');
  assert.equal(second.action, 'INITIAL_PREIMAGE_RESTORED');
  assert.equal(phases[0].phase, 'SWITCH_RECOVERED');
  await verifyManagedState({
    liveRoot,
    expectedVersionPath: previousVersionPath,
    stateRuntimePath: layout.stateRuntimePath,
    stateNodeModulesPath: layout.stateNodeModulesPath,
  });
  assert.equal(await readFile(path.join(liveRoot, 'runtime', 'state-sentinel.txt'), 'utf8'), 'runtime survives\n');
  assert.equal(await readFile(path.join(liveRoot, 'node_modules', 'dependency-sentinel.txt'), 'utf8'), 'dependencies survive\n');
});

test('managed recovery trusts only the journaled child name and idempotently restores the previous pointer', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-managed-recovery-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  const liveParent = path.join(temporaryRoot, 'live');
  await mkdir(liveParent);
  const liveRoot = await createFakeLiveRoot(liveParent, built.releaseDirectory);
  const digest = release.manifest.content_digest_sha256;

  const initialId = createTransactionId(new Date('2026-07-23T17:33:00.000Z'));
  const initialLayout = deploymentLayout(liveRoot, initialId, digest);
  await acquireTransactionLock(initialLayout, initialId);
  await stageCandidate({ release, layout: initialLayout });
  await switchToCandidate({ liveRoot, layout: initialLayout, transactionId: initialId });
  const previousManagedPath = path.resolve(path.dirname(liveRoot), await readlink(liveRoot));
  await archiveTransactionLock(initialLayout, initialId, 'COMMITTED');

  const transactionId = createTransactionId(new Date('2026-07-23T17:34:00.000Z'));
  const layout = deploymentLayout(liveRoot, transactionId, digest);
  await acquireTransactionLock(layout, transactionId);
  await stageCandidate({ release, layout });
  await writeJournal(layout, recoveryJournal({
    transactionId,
    digest,
    phase: 'CANDIDATE_PUBLISHED',
    previousVersionName: path.basename(previousManagedPath),
    firstMigration: false,
  }));
  await switchToCandidate({ liveRoot, layout, transactionId });
  assert.equal(path.resolve(path.dirname(liveRoot), await readlink(liveRoot)), layout.candidatePath);
  await writeJournal(layout, recoveryJournal({
    transactionId,
    digest,
    phase: 'COMMITTED',
    previousVersionName: path.basename(previousManagedPath),
    firstMigration: false,
  }));

  const first = await recoverInterruptedSwitch({ liveRoot, transactionId });
  const second = await recoverInterruptedSwitch({ liveRoot, transactionId });
  assert.equal(first.action, 'MANAGED_POINTER_RESTORED');
  assert.equal(second.action, 'ALREADY_RESTORED');
  assert.equal(path.resolve(path.dirname(liveRoot), await readlink(liveRoot)), previousManagedPath);

  const malicious = recoveryJournal({
    transactionId,
    digest,
    phase: 'CANDIDATE_PUBLISHED',
    previousVersionName: '../../outside',
    firstMigration: false,
  });
  await writeJournal(layout, malicious);
  await assert.rejects(inspectPendingTransaction(liveRoot), /previous version name.*unsafe/i);
  assert.equal(path.resolve(path.dirname(liveRoot), await readlink(liveRoot)), previousManagedPath);
});

test('active or malformed runs, scenes, and editorial shoots block deployment preflight', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-active-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const runsRoot = path.join(temporaryRoot, 'runs');
  await mkdir(path.join(runsRoot, 'active-run'), { recursive: true });
  await mkdir(path.join(runsRoot, 'paused-run'), { recursive: true });
  await mkdir(path.join(runsRoot, 'malformed-run'), { recursive: true });
  await mkdir(path.join(runsRoot, 'missing-run'), { recursive: true });
  await writeFile(path.join(runsRoot, 'active-run', 'run.json'), '{"status":"GENERATING"}\n');
  await writeFile(path.join(runsRoot, 'paused-run', 'run.json'), '{"status":"NEEDS_INPUT"}\n');
  await writeFile(path.join(runsRoot, 'malformed-run', 'run.json'), '{broken');
  await writeFile(path.join(runsRoot, 'stray.json'), '{}\n');

  const scenesRoot = path.join(temporaryRoot, 'scenes');
  for (const sceneId of [
    '.locks',
    'active-scene',
    'completed-scene',
    'malformed-scene',
    'missing-scene',
    'running-scene',
  ]) {
    await mkdir(path.join(scenesRoot, sceneId), { recursive: true });
  }
  await writeFile(path.join(scenesRoot, 'active-scene', 'scene.json'), JSON.stringify({
    scene_id: 'active-scene',
    status: 'QUEUED',
  }));
  await writeFile(path.join(scenesRoot, 'running-scene', 'scene.json'), JSON.stringify({
    scene_id: 'running-scene',
    status: 'RUNNING',
  }));
  await writeFile(path.join(scenesRoot, 'completed-scene', 'scene.json'), JSON.stringify({
    scene_id: 'completed-scene',
    status: 'COMPLETED',
  }));
  await writeFile(path.join(scenesRoot, 'malformed-scene', 'scene.json'), '{broken');
  await writeFile(path.join(scenesRoot, 'stray.json'), '{}\n');

  const editorialRoot = path.join(temporaryRoot, 'editorial-shoots');
  for (const shootId of [
    '.locks',
    'hero-shoot',
    'inconsistent-shoot',
    'malformed-shoot',
    'missing-shoot',
    'pending-shoot',
    'series-shoot',
  ]) {
    await mkdir(path.join(editorialRoot, shootId), { recursive: true });
  }
  await writeFile(path.join(editorialRoot, 'hero-shoot', 'shoot.json'), JSON.stringify({
    shoot_id: 'hero-shoot',
    status: 'HERO_RUNNING',
    shots: [{ status: 'RUNNING' }],
  }));
  await writeFile(path.join(editorialRoot, 'series-shoot', 'shoot.json'), JSON.stringify({
    shoot_id: 'series-shoot',
    status: 'SERIES_RUNNING',
    shots: [{ status: 'QUEUED' }],
  }));
  await writeFile(path.join(editorialRoot, 'pending-shoot', 'shoot.json'), JSON.stringify({
    shoot_id: 'pending-shoot',
    status: 'HERO_PENDING_APPROVAL',
    shots: [{ status: 'QA_PASSED' }],
  }));
  await writeFile(path.join(editorialRoot, 'inconsistent-shoot', 'shoot.json'), JSON.stringify({
    shoot_id: 'inconsistent-shoot',
    status: 'NEEDS_RETRY',
    shots: [{ status: 'QUEUED' }],
  }));
  await writeFile(path.join(editorialRoot, 'malformed-shoot', 'shoot.json'), '{broken');
  await writeFile(path.join(editorialRoot, 'stray.json'), '{}\n');

  assert.deepEqual(await findActiveRuns(temporaryRoot), [
    { run_id: 'active-run', status: 'GENERATING' },
    { run_id: 'malformed-run', status: 'MALFORMED' },
    { run_id: 'missing-run', status: 'MISSING_RUN_STATE' },
    { run_id: 'stray.json', status: 'UNSAFE_RUN_ENTRY' },
    { scene_id: 'active-scene', status: 'QUEUED' },
    { scene_id: 'malformed-scene', status: 'MALFORMED_SCENE_STATE' },
    { scene_id: 'missing-scene', status: 'MISSING_SCENE_STATE' },
    { scene_id: 'running-scene', status: 'RUNNING' },
    { scene_id: 'stray.json', status: 'UNSAFE_SCENE_ENTRY' },
    { shoot_id: 'hero-shoot', status: 'HERO_RUNNING' },
    { shoot_id: 'inconsistent-shoot', status: 'INCONSISTENT_EDITORIAL_STATE' },
    { shoot_id: 'malformed-shoot', status: 'MALFORMED_EDITORIAL_STATE' },
    { shoot_id: 'missing-shoot', status: 'MISSING_EDITORIAL_STATE' },
    { shoot_id: 'series-shoot', status: 'SERIES_RUNNING' },
    { shoot_id: 'stray.json', status: 'UNSAFE_EDITORIAL_ENTRY' },
  ]);
});

test('release pinning rejects mode drift even when bytes are unchanged', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-mode-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const target = path.join(built.releaseDirectory, 'web', 'public', 'app.js');
  await chmod(target, 0o666);

  await assert.rejects(
    loadPinnedRelease({
      releaseDirectory: built.releaseDirectory,
      expectedContentDigest: built.manifest.content_digest_sha256,
      expectedManifestSha256: built.manifestSha256,
      expectedBaseCommit: built.manifest.base_commit,
    }),
    /Release mode changed/,
  );
});

test('deployment CLI is dry-run by default and apply requires all exact service plists', () => {
  const base = [
    '--release', '/tmp/release',
    '--live-root', '/tmp/live/app',
    '--expected-digest', 'a'.repeat(64),
    '--expected-manifest-sha256', 'b'.repeat(64),
    '--expected-base-commit', 'c'.repeat(40),
  ];
  assert.equal(parseArguments(base).apply, false);
  assert.throws(
    () => parseArguments([...base, '--apply']),
    /--apply requires --web-plist/,
  );
  const apply = parseArguments([
    ...base,
    '--apply',
    '--web-plist', '/tmp/web.plist',
    '--monitor-plist', '/tmp/monitor.plist',
    '--tunnel-plist', '/tmp/tunnel.plist',
    '--external-health-url', 'https://www.madeforthisjob.com/api/health',
  ]);
  assert.equal(apply.apply, true);
});

test('transaction lock is exclusive and failure text cannot expose local paths or common secrets', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-lock-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const liveRoot = path.join(temporaryRoot, 'app');
  await mkdir(liveRoot);
  const transactionId = createTransactionId(new Date('2026-07-23T17:40:00.000Z'));
  const layout = deploymentLayout(liveRoot, transactionId, 'd'.repeat(64));
  await assert.rejects(
    acquireTransactionLock(layout, transactionId, {
      writeOwner: async (ownerPath, payload, options) => {
        await writeFile(ownerPath, payload, options);
        throw new Error('injected owner persistence failure');
      },
    }),
    /injected owner persistence failure/,
  );
  await assert.rejects(lstat(layout.lockPath), /ENOENT/);
  await acquireTransactionLock(layout, transactionId);
  await assert.rejects(
    acquireTransactionLock(layout, `${transactionId}-second`),
    /Another deployment transaction/,
  );

  const sanitized = sanitizeFailure(new Error(
    'failed at /Users/example/private/app, C:\\Users\\name\\private\\app and /private/var/folders/job '
      + 'with token=abc123456789, sk-secretsecretsecretsecret, ek_live_secretsecret, '
      + 'Bearer bearer.secret-value, Basic dXNlcjpzZWNyZXQ=, eyJheader12345.payload12345.signature12345, '
      + 'https://alice:s3cr3t@example.test/private and postgres://db-user:p%40ss@db.example.test/app',
  ));
  assert.doesNotMatch(
    sanitized,
    /Users|private\/var|abc123456789|sk-secret|ek_live_|Bearer|Basic|dXNlcj|eyJheader|alice|s3cr3t|db-user|p%40ss/,
  );
  assert.match(sanitized, /\[private-path\]/);
  assert.match(sanitized, /\[local-path\]/);
  assert.match(sanitized, /\[redacted-secret\]/);
  assert.match(sanitized, /https:\/\/\[redacted-credentials\]@example\.test/);

  const validJournal = recoveryJournal({
    transactionId,
    digest: 'd'.repeat(64),
    phase: 'SWITCH_PREPARED',
    previousVersionName: `preimage-${transactionId}`,
    firstMigration: true,
  });
  await writeJournal(layout, validJournal);
  const externalOwner = path.join(temporaryRoot, 'external-owner.json');
  await writeFile(externalOwner, JSON.stringify({ transaction_id: transactionId, created_at: new Date().toISOString() }));
  await rm(path.join(layout.lockPath, 'owner.json'));
  await symlink(externalOwner, path.join(layout.lockPath, 'owner.json'));
  await assert.rejects(inspectPendingTransaction(liveRoot), /lock owner is missing or unsafe/i);
});

test('deploy preflight rejects overwriting an unrelated live file', () => {
  const allowed = scopedLiveChanges([
    {
      path: 'web/public/app.js',
      present: true,
      sha256: 'a'.repeat(64),
      mode: '0644',
    },
  ], [{
    path: 'web/public/app.js',
    sha256: 'b'.repeat(64),
    mode: '0644',
  }]);
  assert.equal(allowed.length, 1);

  assert.throws(
    () => scopedLiveChanges([
      {
        path: 'src/runner/pipeline-runner.js',
        present: true,
        sha256: 'a'.repeat(64),
        mode: '0644',
      },
    ], [{
      path: 'src/runner/pipeline-runner.js',
      sha256: 'b'.repeat(64),
      mode: '0644',
    }]),
    /overwrite 1 non-add-items live file/,
  );
});

test('SQLite backup is integrity-checked and rollback restores the exact pre-deploy database', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-db-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const databasePath = path.join(temporaryRoot, 'profiles.sqlite');
  const backupRoot = path.join(temporaryRoot, 'backup');
  await mkdir(backupRoot);
  const backupPath = path.join(backupRoot, 'profiles.sqlite.backup');
  await execute('/usr/bin/sqlite3', [
    databasePath,
    "PRAGMA journal_mode=WAL; CREATE TABLE profile(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO profile(name) VALUES('before');",
  ]);
  await chmod(databasePath, 0o600);
  const backupSha = await checkpointAndBackupDatabase(databasePath, backupPath);
  assert.equal(backupSha, await sha256File(backupPath));
  assert.equal((await lstat(backupPath)).mode & 0o777, 0o600);

  await execute('/usr/bin/sqlite3', [
    databasePath,
    "INSERT INTO profile(name) VALUES('after');",
  ]);
  await restoreDatabase(databasePath, backupPath, backupRoot);
  assert.equal(await sha256File(databasePath), backupSha);
  assert.equal((await lstat(databasePath)).mode & 0o777, 0o600);
  const restored = await execute('/usr/bin/sqlite3', [
    databasePath,
    'SELECT group_concat(name, ",") FROM profile ORDER BY id;',
  ]);
  assert.equal(restored.stdout.trim(), 'before');
});

test('read-only SQLite preflight refuses a missing database without creating it', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-missing-db-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const missingDatabase = path.join(temporaryRoot, 'missing.sqlite');
  await assert.rejects(
    sqliteQuickCheck(missingDatabase),
    /ENOENT/,
  );
  await assert.rejects(
    lstat(missingDatabase),
    /ENOENT/,
  );
});

test('full runtime snapshot and rollback preserve drafts, run artifacts, monitor state, bytes, and modes', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-runtime-snapshot-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const stateRuntimePath = path.join(temporaryRoot, 'runtime');
  const snapshotPath = path.join(temporaryRoot, 'runtime.snapshot');
  const quarantinePath = path.join(temporaryRoot, 'runtime.post-failure');
  await mkdir(path.join(stateRuntimePath, 'drafts', 'browser-a'), { recursive: true });
  await mkdir(path.join(stateRuntimePath, 'runs', 'run-a', 'outputs'), { recursive: true });
  await mkdir(path.join(stateRuntimePath, 'monitor'), { recursive: true });
  await writeFile(path.join(stateRuntimePath, 'drafts', 'browser-a', 'manifest.json'), '{"draft":1}\n');
  await writeFile(path.join(stateRuntimePath, 'runs', 'run-a', 'outputs', 'avatar.bin'), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(stateRuntimePath, 'monitor', 'state.json'), '{"monitor":"before"}\n');
  await chmod(path.join(stateRuntimePath, 'drafts', 'browser-a', 'manifest.json'), 0o600);

  const before = await runtimeInventory(stateRuntimePath);
  const snapshot = await createRuntimeSnapshot({ runtimePath: stateRuntimePath, snapshotPath });
  assert.equal(snapshot.digest_sha256, before.digest_sha256);

  await writeFile(path.join(stateRuntimePath, 'drafts', 'browser-a', 'manifest.json'), '{"draft":2}\n');
  await writeFile(path.join(stateRuntimePath, 'monitor', 'new-state.json'), '{"created":"after"}\n');
  const restored = await restoreRuntimeSnapshot({
    stateRuntimePath,
    snapshotPath,
    quarantinePath,
    transactionId: 'runtime-fixture',
  });
  assert.equal(restored.digest_sha256, before.digest_sha256);
  const resumed = await restoreRuntimeSnapshot({
    stateRuntimePath,
    snapshotPath,
    quarantinePath,
    transactionId: 'runtime-fixture',
  });
  assert.equal(resumed.digest_sha256, before.digest_sha256);
  assert.equal((await runtimeInventory(stateRuntimePath)).digest_sha256, before.digest_sha256);
  assert.equal(
    await readFile(path.join(stateRuntimePath, 'drafts', 'browser-a', 'manifest.json'), 'utf8'),
    '{"draft":1}\n',
  );
  assert.equal(
    (await lstat(path.join(stateRuntimePath, 'drafts', 'browser-a', 'manifest.json'))).mode & 0o777,
    0o600,
  );
  await assert.rejects(
    readFile(path.join(stateRuntimePath, 'monitor', 'new-state.json')),
    /ENOENT/,
  );
  assert.equal(
    await readFile(path.join(quarantinePath, 'monitor', 'new-state.json'), 'utf8'),
    '{"created":"after"}\n',
  );
});

test('runtime restore resumes missing-state and partial/full staging crash boundaries without discarding bytes', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-runtime-resume-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const snapshotPath = path.join(temporaryRoot, 'runtime.snapshot');
  const snapshotSource = path.join(temporaryRoot, 'snapshot-source');
  await mkdir(path.join(snapshotSource, 'runs'), { recursive: true });
  await writeFile(path.join(snapshotSource, 'runs', 'before.json'), '{"before":true}\n');
  const expected = await createRuntimeSnapshot({ runtimePath: snapshotSource, snapshotPath });

  // Crash boundary A/B: state was already quarantined and staging contains
  // unknown partial bytes. Recovery preserves those bytes and builds afresh.
  const stateRuntimePath = path.join(temporaryRoot, 'state-a', 'runtime');
  const quarantinePath = path.join(temporaryRoot, 'state-a', 'runtime.after');
  const transactionId = 'resume-partial';
  const restoreStaging = path.join(path.dirname(stateRuntimePath), `.runtime.${transactionId}.restore`);
  await mkdir(stateRuntimePath, { recursive: true });
  await writeFile(path.join(stateRuntimePath, 'unknown-live.txt'), 'must survive in quarantine\n');
  await rename(stateRuntimePath, quarantinePath);
  await mkdir(restoreStaging, { recursive: true });
  await writeFile(path.join(restoreStaging, 'partial.txt'), 'partial restore bytes\n');

  const partialRecovered = await restoreRuntimeSnapshot({
    stateRuntimePath,
    snapshotPath,
    quarantinePath,
    transactionId,
  });
  assert.equal(partialRecovered.digest_sha256, expected.digest_sha256);
  assert.equal(await readFile(path.join(quarantinePath, 'unknown-live.txt'), 'utf8'), 'must survive in quarantine\n');
  assert.equal(
    await readFile(`${quarantinePath}.failed-restore/partial.txt`, 'utf8'),
    'partial restore bytes\n',
  );

  // Crash boundary B with a complete staging tree: publish it directly. A
  // second call models boundary C (published state + retained quarantine).
  const fullStatePath = path.join(temporaryRoot, 'state-b', 'runtime');
  const fullQuarantinePath = path.join(temporaryRoot, 'state-b', 'runtime.after');
  const fullTransactionId = 'resume-full';
  const fullStaging = path.join(path.dirname(fullStatePath), `.runtime.${fullTransactionId}.restore`);
  await mkdir(fullStatePath, { recursive: true });
  await writeFile(path.join(fullStatePath, 'original.txt'), 'original bytes\n');
  await rename(fullStatePath, fullQuarantinePath);
  await createRuntimeSnapshot({ runtimePath: snapshotPath, snapshotPath: fullStaging });

  const fullRecovered = await restoreRuntimeSnapshot({
    stateRuntimePath: fullStatePath,
    snapshotPath,
    quarantinePath: fullQuarantinePath,
    transactionId: fullTransactionId,
  });
  const fullResumed = await restoreRuntimeSnapshot({
    stateRuntimePath: fullStatePath,
    snapshotPath,
    quarantinePath: fullQuarantinePath,
    transactionId: fullTransactionId,
  });
  assert.equal(fullRecovered.digest_sha256, expected.digest_sha256);
  assert.equal(fullResumed.digest_sha256, expected.digest_sha256);
  assert.equal(await readFile(path.join(fullQuarantinePath, 'original.txt'), 'utf8'), 'original bytes\n');
});

test('post-start smoke proves the exact cache token and asset hashes and rejects stale bytes', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-deploy-smoke-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  let tamperApp = false;
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/api/health') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ready',
        service: 'web',
        generation: 'available',
        semantic_qa: 'available',
        editorial_generation: 'available',
      }));
      return;
    }
    const relativePath = requestUrl.pathname === '/'
      ? 'web/public/index.html'
      : `web/public/${requestUrl.pathname.slice(1)}`;
    try {
      let bytes = await readFile(path.join(built.releaseDirectory, relativePath));
      if (tamperApp && relativePath === 'web/public/app.js') {
        bytes = Buffer.concat([bytes, Buffer.from('\n// stale-or-tampered\n')]);
      }
      response.statusCode = 200;
      response.end(bytes);
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await postStartSmoke({ origin, release });
  assert.equal(health.status, 'ready');
  tamperApp = true;
  await assert.rejects(
    postStartSmoke({ origin, release }),
    /Live asset (?:size|hash) mismatch: app\.js/,
  );
});

test('product release preflight selects the product verifier, accepts its exact scope, and stages without mutating live state', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-product-deploy-preflight-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createProductRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  assert.equal(release.releaseType, 'PRODUCT_SCENES_V1');
  assert.equal(release.manifestRelativePath, 'ops/product-release-manifest.json');

  const verification = await verifyWithTrustedVerifier(
    release,
    built.manifest.content_digest_sha256,
  );
  assert.equal(verification.ok, true);
  assert.equal(verification.release, 'PRODUCT_SCENES_V1');
  assert.equal(verification.scene_ui, 'ENABLED');
  assert.equal(verification.editorial_preview, 'ACTIVE');
  assert.equal(verification.editorial_generation, 'ENABLED');

  const liveParent = path.join(temporaryRoot, 'live');
  await mkdir(liveParent);
  const liveRoot = await createFakeLiveRoot(liveParent, built.releaseDirectory);
  const live = await inspectLiveRoot(liveRoot);
  const beforeRuntime = await runtimeInventory(live.runtimePath);
  const preimage = await preimageInventory(live.realRoot, release.manifest.deploy_files);
  const changed = scopedLiveChanges(
    preimage,
    release.manifest.deploy_files,
    release.releaseType,
  );
  assert.ok(changed.length > 200);

  const transactionId = createTransactionId(new Date('2026-07-24T01:00:00.000Z'));
  const layout = deploymentLayout(liveRoot, transactionId, release.manifest.content_digest_sha256);
  await acquireTransactionLock(layout, transactionId);
  await stageCandidate({ release, layout });
  await verifyCandidate({
    candidatePath: layout.candidatePath,
    manifest: release.manifest,
    stateRuntimePath: layout.stateRuntimePath,
    stateNodeModulesPath: layout.stateNodeModulesPath,
  });
  assert.deepEqual(await runtimeInventory(live.runtimePath), beforeRuntime);
  assert.equal(
    await readFile(path.join(live.runtimePath, 'state-sentinel.txt'), 'utf8'),
    'runtime survives\n',
  );

  assert.throws(
    () => scopedLiveChanges([{
      path: 'inputs/private-reference.webp',
      present: true,
      sha256: 'a'.repeat(64),
      mode: '0644',
    }], [{
      path: 'inputs/private-reference.webp',
      sha256: 'b'.repeat(64),
      mode: '0644',
    }], release.releaseType),
    /overwrite 1 non-product live file/,
  );
});

test('product release pinning rejects ambiguous manifests, disabled or overbroad generation, and changed bytes', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-product-deploy-reject-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const product = await createProductRelease(temporaryRoot);
  const legacy = await createRelease(path.join(temporaryRoot, 'legacy'));

  await copyFile(
    path.join(legacy.releaseDirectory, 'ops', 'add-items-release-manifest.json'),
    path.join(product.releaseDirectory, 'ops', 'add-items-release-manifest.json'),
  );
  await assert.rejects(
    loadPinnedRelease({
      releaseDirectory: product.releaseDirectory,
      expectedContentDigest: product.manifest.content_digest_sha256,
      expectedManifestSha256: product.manifestSha256,
      expectedBaseCommit: product.manifest.base_commit,
    }),
    /multiple supported manifests/,
  );
  await rm(path.join(product.releaseDirectory, 'ops', 'add-items-release-manifest.json'));

  const falselyDisabled = {
    ...product.manifest,
    features: {
      ...product.manifest.features,
      editorial_generation: 'DISABLED',
    },
    disabled: ['editorial_generation'],
  };
  const falselyDisabledBytes = Buffer.from(`${JSON.stringify(falselyDisabled, null, 2)}\n`);
  await writeFile(product.manifestPath, falselyDisabledBytes);
  await assert.rejects(
    loadPinnedRelease({
      releaseDirectory: product.releaseDirectory,
      expectedContentDigest: product.manifest.content_digest_sha256,
      expectedManifestSha256: createHash('sha256').update(falselyDisabledBytes).digest('hex'),
      expectedBaseCommit: product.manifest.base_commit,
    }),
    /editorial generation authority is not enabled/,
  );

  const overbroadGeneration = structuredClone(product.manifest);
  overbroadGeneration.editorial_preview.generation_mode_ids.push(
    'editorial.edwin_novak.institutional_modernism',
  );
  const overbroadGenerationBytes = Buffer.from(
    `${JSON.stringify(overbroadGeneration, null, 2)}\n`,
  );
  await writeFile(product.manifestPath, overbroadGenerationBytes);
  await assert.rejects(
    loadPinnedRelease({
      releaseDirectory: product.releaseDirectory,
      expectedContentDigest: product.manifest.content_digest_sha256,
      expectedManifestSha256: createHash('sha256').update(overbroadGenerationBytes).digest('hex'),
      expectedBaseCommit: product.manifest.base_commit,
    }),
    /editorial generation authority is not enabled/,
  );

  await writeFile(product.manifestPath, `${JSON.stringify(product.manifest, null, 2)}\n`);
  const sceneUiPath = path.join(product.releaseDirectory, 'web', 'public', 'scene-ui.js');
  await writeFile(sceneUiPath, `${await readFile(sceneUiPath, 'utf8')}\n// changed after build\n`);
  await assert.rejects(
    loadPinnedRelease({
      releaseDirectory: product.releaseDirectory,
      expectedContentDigest: product.manifest.content_digest_sha256,
      expectedManifestSha256: product.manifestSha256,
      expectedBaseCommit: product.manifest.base_commit,
    }),
    /Release (?:size|content) changed: web\/public\/scene-ui\.js/,
  );
});

test('product post-start smoke proves active scene and editorial APIs without paid generation and rejects tampering', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-product-deploy-smoke-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const built = await createProductRelease(temporaryRoot);
  const release = await loadPinnedRelease({
    releaseDirectory: built.releaseDirectory,
    expectedContentDigest: built.manifest.content_digest_sha256,
    expectedManifestSha256: built.manifestSha256,
    expectedBaseCommit: built.manifest.base_commit,
  });
  const presetIds = [
    'std.city.golden_hour_gloss',
    'std.interior.gallery_morning_gloss',
    'std.nature_architecture.concrete_grass_golden_hour',
    'std.studio.taupe_rembrandt_gloss',
    'std.studio.white_window_honeycomb',
  ];
  let tamperSceneUi = false;
  let editorialGenerationAvailable = true;
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/api/health') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ready',
        service: 'web',
        generation: 'available',
        semantic_qa: 'available',
        editorial_generation: 'available',
      }));
      return;
    }
    if (requestUrl.pathname === '/api/scene-presets') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        presets: presetIds.map((presetId) => ({
          preset_id: presetId,
          preset_version: '1.0.0',
          preview_url: `/api/scene-presets/${encodeURIComponent(presetId)}/1.0.0/preview`,
        })),
      }));
      return;
    }
    if (requestUrl.pathname === '/api/editorial-modes') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: editorialGenerationAvailable ? 'ACTIVE' : 'PREVIEW_ONLY',
        generation_available: editorialGenerationAvailable,
        generation_mode_ids: built.manifest.editorial_preview.generation_mode_ids,
        shot_sequence: ['clean_identity_hero'],
        modes: built.manifest.editorial_preview.mode_ids.map((modeId) => ({
          mode_id: modeId,
          version: '1.0.0',
          generation_available: editorialGenerationAvailable
            && built.manifest.editorial_preview.generation_mode_ids.includes(modeId),
          preview_url: `/api/editorial-modes/${encodeURIComponent(modeId)}/1.0.0/preview`,
        })),
      }));
      return;
    }
    const scenePreview = /^\/api\/scene-presets\/([^/]+)\/([^/]+)\/preview$/.exec(requestUrl.pathname);
    const editorialPreview = /^\/api\/editorial-modes\/([^/]+)\/([^/]+)\/preview$/.exec(requestUrl.pathname);
    if (scenePreview || editorialPreview) {
      const id = decodeURIComponent((scenePreview ?? editorialPreview)[1]);
      const record = scenePreview
        ? built.manifest.deploy_files.find((entry) => (
          entry.path.startsWith(`assets/scene-presets/${id}/`)
          && entry.path.endsWith('/environment-plate.webp')
        ))
        : built.manifest.deploy_files.find((entry) => (
          entry.path === built.manifest.editorial_preview.assets
            .find((asset) => asset.mode_id === id)?.image_path
        ));
      if (!record) {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      const bytes = await readFile(path.join(built.releaseDirectory, record.path));
      response.setHeader('content-type', 'image/webp');
      response.setHeader('cache-control', 'public, max-age=31536000, immutable');
      response.setHeader('etag', `"${record.sha256}"`);
      response.end(bytes);
      return;
    }
    const relativePath = requestUrl.pathname === '/'
      ? 'web/public/index.html'
      : `web/public/${requestUrl.pathname.slice(1)}`;
    try {
      let bytes = await readFile(path.join(built.releaseDirectory, relativePath));
      if (tamperSceneUi && relativePath === 'web/public/scene-ui.js') {
        bytes = Buffer.concat([bytes, Buffer.from('\n// stale scene UI\n')]);
      }
      response.statusCode = 200;
      response.end(bytes);
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const smoke = await postStartSmoke({ origin, release });
  assert.equal(smoke.scene_presets, 5);
  assert.equal(smoke.editorial_modes, 4);
  assert.equal(smoke.editorial_generation_modes, 2);
  assert.equal(smoke.editorial_generation, 'ENABLED');

  tamperSceneUi = true;
  await assert.rejects(
    postStartSmoke({ origin, release }),
    /Live asset (?:size|hash) mismatch: scene-ui\.js/,
  );
  tamperSceneUi = false;
  editorialGenerationAvailable = false;
  await assert.rejects(
    postStartSmoke({ origin, release }),
    /Editorial mode API is not active/,
  );
});
