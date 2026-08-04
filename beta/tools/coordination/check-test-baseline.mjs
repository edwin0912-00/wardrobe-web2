#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const known = [
  {
    file: 'test/contracts/scene-production-packs.test.js',
    test_name: 'every selected reference byte, source snapshot and rights receipt is hash-bound',
    markers: ['b2fd5090', 'f9091e2e'],
  },
  {
    file: 'test/qa/scene-release-validator.test.mjs',
    test_name: 'current mood-card package fails release readiness with named production blockers',
    markers: ['SOURCE_LEDGER_MISSING'],
  },
];
const knownFiles = new Set(known.map((entry) => entry.file));
const observedKnownFailures = [];
const candidateFiles = collectTests(path.join(root, 'test')).map((file) => path.relative(root, file));
if (args.base) {
  const baseFiles = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', args.base, '--', 'test'],
    { cwd: root, encoding: 'utf8' },
  ).split('\n').filter((file) => /\.test\.(?:js|mjs)$/u.test(file));
  const missing = baseFiles.filter((file) => !candidateFiles.includes(file));
  if (missing.length > 0) fail('TEST_INVENTORY_SHRANK', { missing });
}
const otherFiles = candidateFiles
  .filter((file) => !knownFiles.has(file));

const regression = run(otherFiles);
if (regression.status !== 0) {
  fail('UNEXPECTED_REGRESSION', { tested_files: otherFiles.length });
}

for (const expected of known) {
  const result = run([expected.file]);
  if (result.status === 0) continue;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const failingNames = [...new Set(
    output.split('\n')
      .filter((line) => line.startsWith('✖ '))
      .map((line) => line.slice(2).replace(/ \([0-9.]+ms\)$/u, '')),
  )];
  if (result.status !== 1
    || failingNames.length !== 1
    || failingNames[0] !== expected.test_name
    || !expected.markers.every((marker) => output.includes(marker))) {
    fail('KNOWN_FAILURE_CHANGED', { file: expected.file });
  }
  observedKnownFailures.push(expected.file);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  passing_test_files: otherFiles.length,
  exact_known_failures: observedKnownFailures,
})}\n`);

function run(files) {
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=spec', '--test-concurrency=2', ...files],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
    },
  );
}

function collectTests(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTests(target));
    if (entry.isFile() && /\.test\.(?:js|mjs)$/u.test(entry.name)) files.push(target);
  }
  return files.sort();
}

function fail(code, details) {
  process.stderr.write(`${JSON.stringify({ ok: false, code, details })}\n`);
  process.exit(1);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith('--') || values[index + 1] == null) {
      throw new Error(`Invalid argument: ${key}`);
    }
    parsed[key.slice(2)] = values[index + 1];
  }
  return parsed;
}
