#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const definition = JSON.parse(readFileSync(path.join(root, 'self-check', 'checks.json'), 'utf8'));
const repair = process.argv.includes('--repair');
const reportPath = path.join(root, 'artifacts', 'self-check', 'report.json');

function execute(argv) {
  const [command, ...args] = argv;
  const startedAt = Date.now();
  process.stdout.write(`\n> ${argv.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    command: argv,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exit_code: result.status,
    duration_ms: Date.now() - startedAt,
    ...(result.error ? { error: result.error.message } : {}),
  };
}

const report = {
  schema_version: 1,
  evaluator: definition.name,
  started_at: new Date().toISOString(),
  mode: repair ? 'SAFE_REPAIR_THEN_CHECK' : 'CHECK_ONLY',
  repairs: [],
  checks: [],
  weakened_checks: [],
};

if (repair) {
  for (const command of definition.safe_repairs) {
    const outcome = execute(command);
    report.repairs.push(outcome);
    if (outcome.status !== 'PASS') {
      report.status = 'FAIL';
      report.next_action = `Repair command failed: ${command.join(' ')}`;
      break;
    }
  }
}

if (report.status !== 'FAIL') {
  for (const rule of definition.rules) {
    const outcome = execute(rule.command);
    report.checks.push({
      id: rule.id,
      blocking: rule.blocking,
      proves: rule.proves,
      ...outcome,
    });
    if (rule.blocking && outcome.status !== 'PASS') {
      report.status = 'FAIL';
      report.next_action = `Fix the first failing behavior: ${rule.id}. Do not weaken or skip it.`;
      break;
    }
  }
}

if (!report.status) report.status = 'PASS';
report.finished_at = new Date().toISOString();
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`\nSELF-CHECK ${report.status} · ${path.relative(root, reportPath)}\n`);
if (report.next_action) process.stderr.write(`NEXT ACTION: ${report.next_action}\n`);
process.exitCode = report.status === 'PASS' ? 0 : 1;
