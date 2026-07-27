#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { validateSafeReportText } from './safe-report-text.mjs';

const requiredHeadings = Object.freeze([
  '# Coordination report',
  '## Observed reports',
  '## Required follow-up',
  '## Safety boundary',
]);
try {
  const reportPath = requiredRelativePath(process.argv[2]);
  const report = readFileSync(reportPath, 'utf8');
  const missing = requiredHeadings.filter((heading) => !report.includes(heading));
  if (missing.length > 0) throw publicError('COORDINATION_REPORT_HEADINGS_MISSING');
  if (validateSafeReportText(report).length > 0) {
    throw publicError('COORDINATION_REPORT_PRIVATE_CONTENT');
  }
  process.stdout.write(`${JSON.stringify({ ok: true, event: 'COORDINATION_REPORT_VALID' })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    event: 'COORDINATION_REPORT_INVALID',
    code: error?.code ?? 'COORDINATION_REPORT_CHECK_FAILED',
  })}\n`);
  process.exitCode = 1;
}

function requiredRelativePath(value) {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    throw publicError('COORDINATION_REPORT_PATH_INVALID');
  }
  return value;
}

function publicError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
