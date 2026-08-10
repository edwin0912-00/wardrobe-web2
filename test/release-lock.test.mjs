import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertCommittedBetaTree } from '../scripts/release-lock.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

test('release verification rejects modified, staged and untracked beta source', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-release-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'beta'));
  await writeFile(path.join(root, 'beta', 'source.js'), 'export const value = 1;\n');
  git(root, ['init', '-q']);
  git(root, ['add', 'beta/source.js']);
  git(root, ['-c', 'user.name=Release Test', '-c', 'user.email=release@test.invalid', 'commit', '-qm', 'baseline']);

  assert.doesNotThrow(() => assertCommittedBetaTree(root));

  await writeFile(path.join(root, 'beta', 'source.js'), 'export const value = 2;\n');
  assert.throws(() => assertCommittedBetaTree(root), /beta working tree is dirty/);

  git(root, ['add', 'beta/source.js']);
  assert.throws(() => assertCommittedBetaTree(root), /beta working tree is dirty/);

  git(root, ['-c', 'user.name=Release Test', '-c', 'user.email=release@test.invalid', 'commit', '-qm', 'candidate']);
  assert.doesNotThrow(() => assertCommittedBetaTree(root));

  await writeFile(path.join(root, 'beta', 'untracked.js'), 'export {};\n');
  assert.throws(() => assertCommittedBetaTree(root), /beta working tree is dirty/);
});
