import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBetaReleaseArguments, replaceRunnerAppRoot } from '../../tools/deploy-beta-release.mjs';

test('beta deploy parser requires explicit safe paths and canonical beta health', () => {
  const options = parseBetaReleaseArguments([
    '--release', '/tmp/release', '--runner', '/tmp/runner', '--beta-plist', '/tmp/beta.plist',
  ]);
  assert.equal(options.apply, false);
  assert.equal(options.external_health_url, 'https://beta.madeforthisjob.com/api/health');
  assert.throws(() => parseBetaReleaseArguments(['--release', 'relative', '--runner', '/x', '--beta-plist', '/y']), /must be absolute/);
});

test('beta deploy changes only the exact runner release pointer', () => {
  const source = '#!/bin/zsh\napp_root="/old"\nexport PORT=4176\n';
  assert.equal(replaceRunnerAppRoot(source, '/new'), '#!/bin/zsh\napp_root="/new"\nexport PORT=4176\n');
  assert.throws(() => replaceRunnerAppRoot('export PORT=4176\n', '/new'), /app_root/);
});
