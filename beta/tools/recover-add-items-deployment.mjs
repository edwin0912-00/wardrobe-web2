#!/usr/bin/env node

import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  archiveTransactionLock,
  inspectPendingTransaction,
  recoverInterruptedSwitch,
  restoreRuntimeSnapshot,
  runtimeInventory,
  sanitizeFailure,
  writeJournal,
} from './lib/add-items-deployment.mjs';
import {
  bootstrapService,
  bootoutIfLoaded,
  sqliteQuickCheck,
  validateServicePlist,
  waitForJson,
  waitUntilUnavailable,
} from './deploy-add-items-release.mjs';
import { assertCanonicalExternalHealthUrl } from './lib/deployment-target.mjs';

const APPLY_REQUIRED = [
  'web_plist',
  'monitor_plist',
  'tunnel_plist',
  'external_health_url',
];
const RUNTIME_MAY_HAVE_MUTATED = new Set([
  'CANDIDATE_PUBLISHED',
  'SWITCHED',
  'WEB_HEALTHY',
  'MONITOR_HEALTHY',
  'EXTERNAL_HEALTHY',
  'COMMITTED',
  'ROLLBACK_FAILED',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
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

export function parseRecoveryArguments(argv) {
  const options = { apply: false };
  const valueFlags = new Set([
    '--live-root',
    '--transaction-id',
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
    invariant(valueFlags.has(token), `Unknown recovery argument: ${token}`);
    const value = argv[index + 1];
    invariant(value && !value.startsWith('--'), `Missing value for ${token}`);
    options[token.slice(2).replaceAll('-', '_')] = value;
    index += 1;
  }
  for (const required of ['live_root', 'transaction_id']) {
    invariant(options[required], `Missing --${required.replaceAll('_', '-')}`);
  }
  invariant(path.isAbsolute(options.live_root), '--live-root must be an absolute path');
  invariant(
    /^[0-9]{14}-[0-9a-f-]{36}$/.test(options.transaction_id),
    '--transaction-id is invalid',
  );
  if (options.external_health_url !== undefined) {
    options.external_health_url = assertCanonicalExternalHealthUrl(options.external_health_url);
  }
  if (options.apply) {
    for (const required of APPLY_REQUIRED) {
      invariant(options[required], `--apply requires --${required.replaceAll('_', '-')}`);
      if (required.endsWith('_plist')) {
        invariant(path.isAbsolute(options[required]), `--${required.replaceAll('_', '-')} must be absolute`);
      }
    }
  }
  options.local_health_url ??= 'http://127.0.0.1:4173/api/health';
  options.monitor_health_url ??= 'http://127.0.0.1:4174/api/health';
  return options;
}

async function main() {
  const options = parseRecoveryArguments(process.argv.slice(2));
  const pending = await inspectPendingTransaction(options.live_root);
  invariant(pending, 'No pending deployment transaction is present');
  invariant(
    pending.transactionId === options.transaction_id,
    'Pending transaction id does not match --transaction-id',
  );
  const plan = {
    ok: true,
    mode: options.apply ? 'RECOVER' : 'RECOVERY_DRY_RUN',
    transaction_id: pending.transactionId,
    interrupted_phase: pending.journal.phase,
    first_managed_migration_expected:
      pending.journal.first_managed_migration_expected ?? null,
    previous_version_name: pending.journal.previous_version_name ?? null,
    runtime_snapshot_present: await pathExists(
      path.join(pending.layout.backupPath, 'runtime.snapshot'),
    ),
  };
  if (!options.apply) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }

  const uid = process.getuid();
  const domain = `gui/${uid}`;
  const services = {
    web: {
      role: 'web',
      plist: options.web_plist,
      label: await validateServicePlist({
        role: 'web',
        plist: options.web_plist,
        liveRoot: options.live_root,
      }),
    },
    monitor: {
      role: 'monitor',
      plist: options.monitor_plist,
      label: await validateServicePlist({
        role: 'monitor',
        plist: options.monitor_plist,
        liveRoot: options.live_root,
      }),
    },
    tunnel: {
      role: 'tunnel',
      plist: options.tunnel_plist,
      label: await validateServicePlist({
        role: 'tunnel',
        plist: options.tunnel_plist,
        liveRoot: options.live_root,
      }),
    },
  };
  let journal = pending.journal;
  const advance = async (phase, details = {}) => {
    journal = {
      ...journal,
      phase,
      ...details,
      events: [
        ...(Array.isArray(journal.events) ? journal.events : []),
        { phase, at: new Date().toISOString() },
      ],
    };
    await writeJournal(pending.layout, journal);
  };

  for (const service of [services.tunnel, services.monitor, services.web]) {
    await bootoutIfLoaded(domain, service);
  }
  await waitUntilUnavailable(options.local_health_url);

  const interruptedPhase = pending.journal.phase;
  const recovered = await recoverInterruptedSwitch({
    liveRoot: options.live_root,
    transactionId: options.transaction_id,
    onPhase: advance,
  });

  const snapshotPath = path.join(pending.layout.backupPath, 'runtime.snapshot');
  let restoredRuntimeDigest = null;
  if (RUNTIME_MAY_HAVE_MUTATED.has(interruptedPhase)) {
    invariant(await pathExists(snapshotPath), 'Recovery requires the pre-deploy runtime snapshot');
    const snapshot = await runtimeInventory(snapshotPath);
    const restored = await restoreRuntimeSnapshot({
      stateRuntimePath: pending.layout.stateRuntimePath,
      snapshotPath,
      quarantinePath: path.join(pending.layout.backupPath, 'post-crash-runtime'),
      transactionId: options.transaction_id,
    });
    invariant(
      restored.digest_sha256 === snapshot.digest_sha256,
      'Recovered runtime does not match its pre-deploy snapshot',
    );
    restoredRuntimeDigest = restored.digest_sha256;
    await sqliteQuickCheck(path.join(pending.layout.stateRuntimePath, 'profiles.sqlite'));
    await advance('RECOVERY_RUNTIME_RESTORED', {
      runtime_snapshot_digest_sha256: restoredRuntimeDigest,
    });
  }

  for (const service of [services.web, services.monitor, services.tunnel]) {
    await bootstrapService(domain, service);
  }
  await waitForJson(
    options.local_health_url,
    (body) => (body?.status === 'ready' || body?.status === 'degraded')
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
    (body) => (body?.status === 'ready' || body?.status === 'degraded')
      && body?.service === 'web'
      && body?.generation === 'available'
      && body?.semantic_qa === 'available',
    60_000,
  );
  await advance('RECOVERED', {
    recovered_at: new Date().toISOString(),
    recovery_action: recovered.action,
    runtime_snapshot_digest_sha256: restoredRuntimeDigest,
  });
  await archiveTransactionLock(
    pending.layout,
    options.transaction_id,
    'RECOVERED',
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outcome: 'RECOVERED',
    transaction_id: options.transaction_id,
    recovery_action: recovered.action,
    runtime_snapshot_digest_sha256: restoredRuntimeDigest,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${sanitizeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
