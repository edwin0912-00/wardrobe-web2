import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const repo = path.resolve(import.meta.dirname, '..');

test('the root evaluator entrypoint is executable and self-describing', async () => {
  await access(path.join(repo, 'verify'), constants.X_OK);
  const result = spawnSync(path.join(repo, 'verify'), ['--help'], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\.\/verify \[quick\|local\|full\|live\|all\|--run\]/);
});

test('README, npm and CI delegate to the root contract instead of rebuilding it', async () => {
  const [readme, workflow, packageJson] = await Promise.all([
    readFile(path.join(repo, 'README.md'), 'utf8'),
    readFile(path.join(repo, '.github/workflows/evaluator.yml'), 'utf8'),
    readFile(path.join(repo, 'package.json'), 'utf8').then(JSON.parse),
  ]);

  assert.match(readme, /\.\/verify --run/);
  assert.doesNotMatch(readme, /scripts\/install-(?:alpha|local)\.sh --run/);
  assert.match(workflow, /run: \.\/verify "\$MODE"/);
  assert.doesNotMatch(workflow, /scripts\/(?:test-system|install-alpha)\.(?:mjs|sh)/);
  for (const script of ['test', 'test:quick', 'test:full', 'test:live', 'test:all']) {
    assert.match(packageJson.scripts[script], /^\.\/verify(?: |$)/, script);
  }
});
