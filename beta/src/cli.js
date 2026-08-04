#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MockProvider, ReplayProvider } from './providers/index.js';
import { PipelineRunner } from './runner/index.js';

function usage() {
  return `Usage:
  node src/cli.js --job <job.json> --provider-module <adapter.js> [--runtime-root <dir>]
  node src/cli.js --job <job.json> --replay <fixture.json> [--runtime-root <dir>]
  node src/cli.js --job <job.json> --mock [--runtime-root <dir>]

The mock flag is explicit and intended only for local pipeline tests. A provider module
must export createProvider(), provider, or a default provider implementing condition(),
generate(), and qa().`;
}

function parseArgs(argv) {
  const options = { jobs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--job') options.jobs.push(argv[++index]);
    else if (item === '--runtime-root') options.runtimeRoot = argv[++index];
    else if (item === '--provider-module') options.providerModule = argv[++index];
    else if (item === '--replay') options.replay = argv[++index];
    else if (item === '--mock') options.mock = true;
    else if (item === '--help' || item === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  if (options.jobs.some((item) => !item)) throw new Error('--job requires a filename');
  return options;
}

async function loadProvider(options) {
  const selected = [options.providerModule, options.replay, options.mock].filter(Boolean);
  if (selected.length !== 1) {
    throw new Error('Select exactly one provider: --provider-module, --replay, or --mock');
  }
  if (options.mock) return new MockProvider();
  if (options.replay) return ReplayProvider.fromFile(path.resolve(options.replay));
  const imported = await import(pathToFileURL(path.resolve(options.providerModule)).href);
  if (typeof imported.createProvider === 'function') return imported.createProvider();
  return imported.provider ?? imported.default;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.jobs.length === 0) throw new Error('At least one --job is required');
  const provider = await loadProvider(options);
  const runner = new PipelineRunner({ provider, runtimeRoot: options.runtimeRoot });
  const results = [];
  for (const job of options.jobs) results.push(await runner.runJobFile(job));
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  if (results.some((result) => result.status !== 'COMPLETED')) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n\n${usage()}\n`);
  process.exitCode = 2;
});
