#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderSummary(report) {
  const icon = report.status === 'PASS' ? '✅' : '❌';
  const seconds = Number.isFinite(report.duration_ms) ? (report.duration_ms / 1000).toFixed(1) : '?';
  const lines = [
    `## ${icon} Wardrobe verification: ${cell(report.status)}`,
    '',
    `Mode: \`${cell(report.mode)}\` · Commit: \`${cell(report.source?.commit)}\` · Duration: ${seconds}s`,
    '',
    '| Layer | Check | Status | Time |',
    '|---|---|---:|---:|',
  ];
  for (const check of report.checks ?? []) {
    lines.push(
      `| ${cell(check.layer)} | ${cell(check.id)} | ${check.status === 'PASS' ? '✅ PASS' : '❌ FAIL'} | ${(Number(check.duration_ms ?? 0) / 1000).toFixed(1)}s |`,
    );
  }
  if (report.first_failure) {
    const failed = (report.checks ?? []).find((check) => check.id === report.first_failure);
    lines.push('', `First failure: **${cell(report.first_failure)}**`);
    if (failed?.log) lines.push(`Evidence: \`${cell(failed.log)}\``);
    if (report.next_action) lines.push(`Next action: ${cell(report.next_action)}`);
  }
  const weakened = report.weakened_checks ?? [];
  lines.push('', `Weakened checks: ${weakened.length === 0 ? '**none**' : weakened.map(cell).join(', ')}`, '');
  return lines.join('\n');
}

async function main(argv) {
  const requested = argv[0] ?? 'artifacts/test-system/latest.json';
  const reportPath = path.resolve(repositoryRoot, requested);
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    process.stdout.write(`${renderSummary(report)}\n`);
  } catch (error) {
    process.stdout.write('## ❌ Wardrobe verification produced no readable receipt\n\n');
    process.stdout.write(`Expected: \`${path.relative(repositoryRoot, reportPath)}\`\n\n`);
    process.stdout.write(`Reason: ${cell(error.code ?? error.message)}\n`);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
