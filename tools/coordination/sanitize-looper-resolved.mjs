#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

try {
  const args = parseArgs(process.argv.slice(2));
  const file = safeRelativePath(args.file);
  const source = safeRelativePath(args.source);
  const document = JSON.parse(await readFile(file, 'utf8'));
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw publicError('LOOPER_RESOLVED_INVALID');
  }
  document.source = source;
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, event: 'LOOPER_RESOLVED_SANITIZED' })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    event: 'LOOPER_RESOLVED_SANITIZE_FAILED',
    code: error?.code ?? 'LOOPER_RESOLVED_SANITIZE_FAILED',
  })}\n`);
  process.exitCode = 1;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    const value = values[index + 1];
    if (!['--file', '--source'].includes(key) || !value || value.startsWith('--') || result[key]) {
      throw publicError('LOOPER_SANITIZE_ARGUMENT_INVALID');
    }
    result[key] = value;
    index += 1;
  }
  if (!result['--file'] || !result['--source']) {
    throw publicError('LOOPER_SANITIZE_ARGUMENT_INVALID');
  }
  return { file: result['--file'], source: result['--source'] };
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    throw publicError('LOOPER_SANITIZE_PATH_INVALID');
  }
  return value;
}

function publicError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
