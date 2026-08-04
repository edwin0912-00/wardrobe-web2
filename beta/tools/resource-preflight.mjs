#!/usr/bin/env node

import path from 'node:path';
import { assertResourceCapacity, RESOURCE_POLICIES } from './lib/resource-preflight.mjs';

function parseArguments(argv) {
  const options = {
    mode: 'test',
    root: process.cwd(),
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token !== '--mode' && token !== '--root') {
      throw new Error(`Unknown argument: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    options[token.slice(2)] = value;
    index += 1;
  }
  if (!RESOURCE_POLICIES[options.mode]) throw new Error(`Unknown mode: ${options.mode}`);
  options.root = path.resolve(options.root);
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  const result = await assertResourceCapacity({
    mode: options.mode,
    rootDirectory: options.root,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } else {
    process.stdout.write(
      `resource preflight ${options.mode}: PASS · memory ${result.memory_free_percent}% · `
      + `swap ${(result.swap_used_bytes / 1024 ** 3).toFixed(2)} GiB · `
      + `load5 ${result.five_minute_load.toFixed(2)} · `
      + `disk ${(result.disk_free_bytes / 1024 ** 3).toFixed(1)} GiB\n`,
    );
  }
} catch (error) {
  const payload = {
    ok: false,
    code: error.code ?? 'RESOURCE_PREFLIGHT_ERROR',
    error: error.message,
    snapshot: error.snapshot,
    failures: error.result?.failures,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
}
