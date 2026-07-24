import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecoveryArguments } from '../../tools/recover-add-items-deployment.mjs';

const transactionId = '20260723170000-11111111-1111-4111-8111-111111111111';
const base = [
  '--live-root', '/tmp/zeely-live/app',
  '--transaction-id', transactionId,
];

test('recovery CLI is inspect-only by default and mutation requires every health/service gate', () => {
  const dryRun = parseRecoveryArguments(base);
  assert.equal(dryRun.apply, false);
  assert.equal(dryRun.transaction_id, transactionId);
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
    '--external-health-url', 'https://www.madeforthisjob.com/api/health',
  ]);
  assert.equal(apply.apply, true);
  assert.equal(
    apply.external_health_url,
    'https://www.madeforthisjob.com/api/health',
  );
});

test('recovery CLI rejects unpinned targets and credential-bearing external URLs', () => {
  assert.throws(
    () => parseRecoveryArguments([
      '--live-root', 'relative/app',
      '--transaction-id', transactionId,
    ]),
    /absolute path/,
  );
  assert.throws(
    () => parseRecoveryArguments([
      ...base,
      '--apply',
      '--web-plist', '/tmp/web.plist',
      '--monitor-plist', '/tmp/monitor.plist',
      '--tunnel-plist', '/tmp/tunnel.plist',
      '--external-health-url', 'https://user:secret@example.com/api/health',
    ]),
    /cannot contain credentials/,
  );
});
