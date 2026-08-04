import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArguments } from '../../tools/deploy-add-items-release.mjs';
import { parseRecoveryArguments } from '../../tools/recover-add-items-deployment.mjs';

const canonicalExternalHealthUrl = 'https://beta.madeforthisjob.com/api/health';
const rejectedExternalHealthUrls = [
  'https://www.madeforthisjob.com/api/health',
  'https://unrelated.example/api/health',
  'https://user:secret@iwas.madeforthisjob.com/api/health',
];
const canonicalTargetError = /--external-health-url must equal https:\/\/beta\.madeforthisjob\.com\/api\/health/;

const deploymentBase = [
  '--release', '/tmp/release',
  '--live-root', '/tmp/live/app',
  '--expected-digest', 'a'.repeat(64),
  '--expected-manifest-sha256', 'b'.repeat(64),
  '--expected-base-commit', 'c'.repeat(40),
];
const recoveryBase = [
  '--live-root', '/tmp/live/app',
  '--transaction-id', '20260723170000-11111111-1111-4111-8111-111111111111',
];

function deploymentApply(url) {
  return [
    ...deploymentBase,
    '--apply',
    '--web-plist', '/tmp/web.plist',
    '--monitor-plist', '/tmp/monitor.plist',
    '--tunnel-plist', '/tmp/tunnel.plist',
    '--external-health-url', url,
  ];
}

function recoveryApply(url) {
  return [
    ...recoveryBase,
    '--apply',
    '--web-plist', '/tmp/web.plist',
    '--monitor-plist', '/tmp/monitor.plist',
    '--tunnel-plist', '/tmp/tunnel.plist',
    '--external-health-url', url,
  ];
}

test('deploy parser accepts only the canonical external health target in dry-run and apply modes', () => {
  assert.equal(
    parseArguments([...deploymentBase, '--external-health-url', canonicalExternalHealthUrl])
      .external_health_url,
    canonicalExternalHealthUrl,
  );
  assert.equal(
    parseArguments(deploymentApply(canonicalExternalHealthUrl)).external_health_url,
    canonicalExternalHealthUrl,
  );

  for (const rejectedUrl of rejectedExternalHealthUrls) {
    assert.throws(
      () => parseArguments([...deploymentBase, '--external-health-url', rejectedUrl]),
      canonicalTargetError,
    );
    assert.throws(
      () => parseArguments(deploymentApply(rejectedUrl)),
      canonicalTargetError,
    );
  }
});

test('recovery parser accepts only the canonical external health target in dry-run and apply modes', () => {
  assert.equal(
    parseRecoveryArguments([...recoveryBase, '--external-health-url', canonicalExternalHealthUrl])
      .external_health_url,
    canonicalExternalHealthUrl,
  );
  assert.equal(
    parseRecoveryArguments(recoveryApply(canonicalExternalHealthUrl)).external_health_url,
    canonicalExternalHealthUrl,
  );

  for (const rejectedUrl of rejectedExternalHealthUrls) {
    assert.throws(
      () => parseRecoveryArguments([...recoveryBase, '--external-health-url', rejectedUrl]),
      canonicalTargetError,
    );
    assert.throws(
      () => parseRecoveryArguments(recoveryApply(rejectedUrl)),
      canonicalTargetError,
    );
  }
});
