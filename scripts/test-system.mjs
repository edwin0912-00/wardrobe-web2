#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validModes = new Set(['quick', 'local', 'full', 'live', 'all']);
const playwrightInstall = process.env.CI
  ? ['./node_modules/.bin/playwright', 'install', '--with-deps', 'chromium']
  : ['./node_modules/.bin/playwright', 'install', 'chromium'];

const steps = Object.freeze({
  ROOT_DEPENDENCIES: Object.freeze({
    id: 'ROOT_DEPENDENCIES',
    layer: 'bootstrap',
    command: ['npm', 'ci', '--no-audit', '--no-fund'],
    proves: 'the evaluator dependencies install from the committed lockfile',
  }),
  ENGINE_DEPENDENCIES: Object.freeze({
    id: 'ENGINE_DEPENDENCIES',
    layer: 'bootstrap',
    command: ['npm', 'ci', '--no-audit', '--no-fund', '--prefix', 'beta'],
    proves: 'the engine dependencies install from the committed lockfile',
  }),
  MEDIA_BUNDLE: Object.freeze({
    id: 'MEDIA_BUNDLE',
    layer: 'bootstrap',
    command: [process.execPath, 'scripts/fetch-media-bundle.mjs'],
    proves: 'the immutable evaluator media bundle is present and SHA-verified',
  }),
  BROWSER_RUNTIME: Object.freeze({
    id: 'BROWSER_RUNTIME',
    layer: 'bootstrap',
    command: playwrightInstall,
    proves: 'the pinned Playwright browser can be installed on the evaluator host',
  }),
  SOURCE_LOCK: Object.freeze({
    id: 'SOURCE_LOCK',
    layer: 'source',
    command: [process.execPath, 'scripts/verify-alpha.mjs', '--source-only'],
    proves: 'release ancestry, locked source trees and required product files',
  }),
  MAIN_PREFLIGHT: Object.freeze({
    id: 'MAIN_PREFLIGHT',
    layer: 'main',
    command: ['./scripts/site-preflight.sh'],
    proves: 'main JavaScript parses and the complete main behavior suite passes',
  }),
  PRODUCT_CONTRACTS: Object.freeze({
    id: 'PRODUCT_CONTRACTS',
    layer: 'engine',
    command: [process.execPath, 'scripts/verify-alpha.mjs', '--install'],
    proves: 'main behavior, backend contracts, canon, providers and focused video paths',
  }),
  BROWSER_CORE: Object.freeze({
    id: 'BROWSER_CORE',
    layer: 'browser',
    command: [process.execPath, 'scripts/browser-core-e2e.mjs'],
    proves: 'a real Chromium page loads the bridge, completes two looks, saves them and recovers after reload',
  }),
  TWO_PROCESS_RUNTIME: Object.freeze({
    id: 'TWO_PROCESS_RUNTIME',
    layer: 'runtime',
    command: ['./scripts/run-alpha.sh', '--check'],
    proves: 'main and beta start as separate processes, same-origin API works and MP4 Range returns 206',
  }),
  FULL_ENGINE: Object.freeze({
    id: 'FULL_ENGINE',
    layer: 'engine-full',
    command: ['npm', '--prefix', 'beta', 'test'],
    proves: 'the complete backend test suite passes without bypassing its resource preflight',
  }),
  LIVE_PRODUCT: Object.freeze({
    id: 'LIVE_PRODUCT',
    layer: 'deployment',
    command: [process.execPath, 'scripts/live-product-e2e.mjs'],
    proves: 'both public mirrors match alpha, the deployed bridge loads in Chromium and beta API is ready',
  }),
  PATCH_INTEGRITY: Object.freeze({
    id: 'PATCH_INTEGRITY',
    layer: 'git',
    command: ['git', 'diff', '--check'],
    proves: 'the working patch contains no whitespace-corrupt content',
  }),
});

export function parseArguments(argv) {
  let mode = 'local';
  let keepGoing = false;
  let reportPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--keep-going') {
      keepGoing = true;
      continue;
    }
    if (value === '--report') {
      reportPath = argv[index + 1] ?? null;
      if (!reportPath) throw new Error('--report requires a file path');
      index += 1;
      continue;
    }
    if (value.startsWith('--report=')) {
      reportPath = value.slice('--report='.length);
      if (!reportPath) throw new Error('--report requires a file path');
      continue;
    }
    if (value.startsWith('-')) throw new Error(`unknown option: ${value}`);
    if (!validModes.has(value)) throw new Error(`unknown mode: ${value}`);
    mode = value;
  }

  return { mode, keepGoing, reportPath };
}

export function buildPlan(mode) {
  if (!validModes.has(mode)) throw new Error(`unknown mode: ${mode}`);
  if (mode === 'quick') {
    return [steps.MEDIA_BUNDLE, steps.SOURCE_LOCK, steps.MAIN_PREFLIGHT, steps.PATCH_INTEGRITY];
  }
  const localBootstrap = [
    steps.ROOT_DEPENDENCIES,
    steps.ENGINE_DEPENDENCIES,
    steps.MEDIA_BUNDLE,
    steps.BROWSER_RUNTIME,
  ];
  if (mode === 'local') {
    return [
      ...localBootstrap,
      steps.PRODUCT_CONTRACTS,
      steps.BROWSER_CORE,
      steps.TWO_PROCESS_RUNTIME,
      steps.PATCH_INTEGRITY,
    ];
  }
  if (mode === 'full') {
    return [
      ...localBootstrap,
      steps.PRODUCT_CONTRACTS,
      steps.BROWSER_CORE,
      steps.TWO_PROCESS_RUNTIME,
      steps.FULL_ENGINE,
      steps.PATCH_INTEGRITY,
    ];
  }
  if (mode === 'live') {
    return [
      steps.ROOT_DEPENDENCIES,
      steps.BROWSER_RUNTIME,
      steps.SOURCE_LOCK,
      steps.LIVE_PRODUCT,
      steps.PATCH_INTEGRITY,
    ];
  }
  return [
    ...localBootstrap,
    steps.PRODUCT_CONTRACTS,
    steps.BROWSER_CORE,
    steps.TWO_PROCESS_RUNTIME,
    steps.FULL_ENGINE,
    steps.LIVE_PRODUCT,
    steps.PATCH_INTEGRITY,
  ];
}

export function statusFor(results) {
  return results.length > 0 && results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL';
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function persistReport(report, requestedPath) {
  const reportRoot = path.join(repositoryRoot, 'artifacts', 'test-system');
  await mkdir(reportRoot, { recursive: true });
  const destination = requestedPath
    ? path.resolve(repositoryRoot, requestedPath)
    : path.join(reportRoot, `${report.run_id}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, destination);
  const latest = path.join(reportRoot, 'latest.json');
  const latestTemporary = `${latest}.tmp-${process.pid}`;
  await writeFile(latestTemporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(latestTemporary, latest);
  return { destination, latest };
}

async function executeStep(step, logRoot) {
  const [command, ...args] = step.command;
  const logPath = path.join(logRoot, `${step.id.toLowerCase()}.log`);
  const log = createWriteStream(logPath, { flags: 'w', mode: 0o600 });
  const startedAt = new Date();
  process.stdout.write(`\n[${step.layer}] ${step.id}\n> ${step.command.join(' ')}\n`);

  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const relay = (target) => (chunk) => {
    target.write(chunk);
    log.write(chunk);
  };
  child.stdout.on('data', relay(process.stdout));
  child.stderr.on('data', relay(process.stderr));

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  const onInterrupt = () => forwardSignal('SIGINT');
  const onTerminate = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  const outcome = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ exitCode: null, signal: null, error }));
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal, error: null }));
  });
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);
  await new Promise((resolve) => log.end(resolve));

  const finishedAt = new Date();
  const passed = outcome.exitCode === 0 && !outcome.error;
  const result = {
    id: step.id,
    layer: step.layer,
    proves: step.proves,
    command: step.command,
    status: passed ? 'PASS' : 'FAIL',
    exit_code: outcome.exitCode,
    signal: outcome.signal,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    log: path.relative(repositoryRoot, logPath),
  };
  if (outcome.error) result.error = outcome.error.message;
  process.stdout.write(`${result.status} ${step.id} · ${(result.duration_ms / 1000).toFixed(1)}s\n`);
  return result;
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const plan = buildPlan(options.mode);
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, '-')}-${options.mode}`;
  const logRoot = path.join(repositoryRoot, 'artifacts', 'test-system', 'logs', runId);
  await mkdir(logRoot, { recursive: true });

  const report = {
    schema_version: 1,
    run_id: runId,
    mode: options.mode,
    source: {
      branch: git(['branch', '--show-current']),
      commit: git(['rev-parse', 'HEAD']),
    },
    environment: {
      ci: Boolean(process.env.CI),
      platform: process.platform,
      node: process.version,
    },
    started_at: startedAt.toISOString(),
    status: 'RUNNING',
    checks: [],
    weakened_checks: [],
  };

  for (const step of plan) {
    const result = await executeStep(step, logRoot);
    report.checks.push(result);
    if (result.status === 'FAIL' && !options.keepGoing) break;
  }

  report.status = statusFor(report.checks);
  report.finished_at = new Date().toISOString();
  report.duration_ms = new Date(report.finished_at).getTime() - startedAt.getTime();
  report.first_failure = report.checks.find((check) => check.status === 'FAIL')?.id ?? null;
  report.next_action = report.first_failure
    ? `Open ${report.checks.find((check) => check.id === report.first_failure).log} and repair that behavior without weakening its check.`
    : null;

  const paths = await persistReport(report, options.reportPath);
  process.stdout.write(`\nTEST SYSTEM ${report.status} · ${(report.duration_ms / 1000).toFixed(1)}s\n`);
  process.stdout.write(`report: ${path.relative(repositoryRoot, paths.destination)}\n`);
  process.stdout.write(`latest: ${path.relative(repositoryRoot, paths.latest)}\n`);
  if (report.next_action) process.stderr.write(`next: ${report.next_action}\n`);
  return report.status === 'PASS' ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runCli().then(
    (exitCode) => { process.exitCode = exitCode; },
    async (error) => {
      process.stderr.write(`test system failed to start: ${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    },
  );
}
