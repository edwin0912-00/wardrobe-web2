import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { activeBetaRunIds, parseBetaReleaseArguments, replaceRunnerAppRoot } from '../../tools/deploy-beta-release.mjs';

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

test('beta deploy discovers active runs before it can kickstart the service', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-beta-deploy-'));
  await mkdir(path.join(runtimeRoot, 'runs', 'still-running'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'runs', 'finished'), { recursive: true });
  await writeFile(path.join(runtimeRoot, 'runs', 'still-running', 'run.json'), JSON.stringify({ run_id: 'still-running', status: 'RUNNING' }));
  await writeFile(path.join(runtimeRoot, 'runs', 'finished', 'run.json'), JSON.stringify({ run_id: 'finished', status: 'COMPLETED' }));
  const runner = `#!/bin/zsh\nruntime_root="${runtimeRoot}"\n`;
  assert.deepEqual(await activeBetaRunIds(runner), ['still-running']);
});
