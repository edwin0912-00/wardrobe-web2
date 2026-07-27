import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecoveryArguments } from '../../tools/recover-add-items-deployment.mjs';

const transactionId = '20260723170000-11111111-1111-4111-8111-111111111111';
const canonicalExternalHealthUrl = 'https://iwas.madeforthisjob.com/api/health';
const base = [
  '--live-root', '/tmp/zeely-live/app',
  '--transaction-id', transactionId,
];

test('recovery CLI is inspect-only by default and mutation requires every health/service gate', () => {
  const dryRun = parseRecoveryArguments(base);
  assert.equal(dryRun.apply, false);
  assert.equal(dryRun.transaction_id, transactionId);
  const rejectedTargets = [
    'https://www.madeforthisjob.com/api/health',
    'https://unrelated.example/api/health',
    'https://user:secret@iwas.madeforthisjob.com/api/health',
  ];
  for (const rejectedTarget of rejectedTargets) {
    assert.throws(
      () => parseRecoveryArguments([
        ...base,
        '--external-health-url', rejectedTarget,
      ]),
      /--external-health-url must equal https:\/\/iwas\.madeforthisjob\.com\/api\/health/,
    );
  }
  assert.throws(
    () => parseRecoveryArguments([...base, '--apply']),
    /--apply requires --web-plist/,
  );

  const apply = parseRecoveryArguments([
    ...base,
    '--apply',
    '--web-plist', '/tmp/web.plist',
    '--monitor-plist', '/tmp/monitor.plist',
    '--tunnel-plist', '/tmp/tunnel.plist',
    '--external-health-url', canonicalExternalHealthUrl,
  ]);
  assert.equal(apply.apply, true);
  assert.equal(
    apply.external_health_url,
    canonicalExternalHealthUrl,
  );
});

test('recovery CLI rejects unpinned targets, old hosts, and credential-bearing external URLs', () => {
  assert.throws(
    () => parseRecoveryArguments([
      '--live-root', 'relative/app',
      '--transaction-id', transactionId,
    ]),
    /absolute path/,
  );
  for (const rejectedTarget of [
    'https://www.madeforthisjob.com/api/health',
    'https://unrelated.example/api/health',
    'https://user:secret@iwas.madeforthisjob.com/api/health',
  ]) {
    assert.throws(
      () => parseRecoveryArguments([
        ...base,
        '--apply',
        '--web-plist', '/tmp/web.plist',
        '--monitor-plist', '/tmp/monitor.plist',
        '--tunnel-plist', '/tmp/tunnel.plist',
        '--external-health-url', rejectedTarget,
      ]),
      /--external-health-url must equal https:\/\/iwas\.madeforthisjob\.com\/api\/health/,
    );
  }
});
