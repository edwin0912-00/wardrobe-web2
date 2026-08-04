#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repositoryRoot, 'release', 'RELEASE.lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const full = process.argv.includes('--full');
const install = process.argv.includes('--install') || full;

function fail(message) {
  process.stderr.write(`alpha verification failed: ${message}\n`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function run(command, args, cwd = repositoryRoot) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
}

function requireFile(relativePath, minimumBytes = 1) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  let size;
  try {
    size = statSync(absolutePath).size;
  } catch {
    fail(`missing tracked file: ${relativePath}`);
  }
  if (size < minimumBytes) fail(`tracked file is unexpectedly small: ${relativePath}`);
}

const mainCommit = lock.sources.main_site.commit;
const betaCommit = lock.sources.beta_engine.commit;
const importCommit = lock.provenance.import_commit;

for (const commit of [mainCommit, betaCommit, importCommit]) {
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    fail(`required source commit is absent: ${commit}; clone alpha without --depth`);
  }
}

for (const commit of [mainCommit, betaCommit, importCommit]) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
  } catch {
    fail(`HEAD does not contain locked source commit: ${commit}`);
  }
}

const importParents = git(['rev-list', '--parents', '-n', '1', importCommit]).split(/\s+/).slice(1);
if (JSON.stringify(importParents) !== JSON.stringify(lock.provenance.import_commit_parents)) {
  fail(`import parent mismatch: ${importParents.join(', ')}`);
}

const betaTree = git(['rev-parse', 'HEAD:beta']);
if (betaTree !== lock.sources.beta_engine.tree) {
  fail(`beta tree drift: expected ${lock.sources.beta_engine.tree}, got ${betaTree}`);
}

const allowedAlphaOverlay = [
  ':(exclude)beta/**',
  ':(exclude)release/**',
  ':(exclude)README-ALPHA.md',
  ':(exclude)README.md',
  ':(exclude)FUNCTION-MAP.md',
  ':(exclude)AGENTS.md',
  ':(exclude).gitignore',
  ':(exclude)scripts/install-local.sh',
  ':(exclude)scripts/install-alpha.sh',
  ':(exclude)scripts/run-local.sh',
  ':(exclude)scripts/run-alpha.sh',
  ':(exclude)scripts/verify-alpha.mjs',
  ':(exclude)test/reviewer-criteria.test.mjs',
];
const mainDrift = spawnSync('git', ['diff', '--quiet', mainCommit, '--', '.', ...allowedAlphaOverlay], {
  cwd: repositoryRoot,
});
if (mainDrift.status !== 0) {
  fail('the cinematic main-site source differs from its locked live commit');
}

for (const [relativePath, minimumBytes] of [
  ['serve.py', 1_000],
  ['b/index.html', 10_000],
  ['b/assets/intro.mp4', 100_000],
  ['b/assets/seg1.mp4', 100_000],
  ['b/zeely-pipeline-clients.html', 10_000],
  ['adapters/cinematic-ui-bridge.mjs', 1_000],
  ['beta/package.json', 100],
  ['beta/package-lock.json', 1_000],
  ['beta/src/web/start.js', 1_000],
  ['beta/web/public/index.html', 1_000],
  ['beta/config/video-reference-packs/fashion-cool-style-v1.json', 100],
]) requireFile(relativePath, minimumBytes);

run(process.execPath, ['--check', 'engine.js']);
run(process.execPath, ['--check', 'screen-surfaces.js']);
run(process.execPath, ['--check', 'beta/src/web/start.js']);

if (install) {
  run('./scripts/site-preflight.sh', []);
  run('npm', ['run', 'verify:readme'], path.join(repositoryRoot, 'beta'));
  run('npm', ['run', 'verify:contracts'], path.join(repositoryRoot, 'beta'));
  run('npm', ['run', 'verify:canon'], path.join(repositoryRoot, 'beta'));
  const videoTests = readdirSync(path.join(repositoryRoot, 'beta', 'test', 'video'))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => `test/video/${name}`);
  run(process.execPath, [
    '--test',
    'test/providers/higgsfield-cli-provider.test.js',
    ...videoTests,
    'test/web/scene-adapters.test.js',
    'test/web/profile-service.test.js',
    'test/web/presentation-preview.test.js',
  ], path.join(repositoryRoot, 'beta'));
}

if (full) {
  run('npm', ['test'], path.join(repositoryRoot, 'beta'));
}

process.stdout.write(`\nalpha verification passed: ${lock.release}\n`);
process.stdout.write(`main ${mainCommit}\n`);
process.stdout.write(`beta ${betaCommit}\n`);
