#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assertCanonicalExternalHealthUrl } from './lib/deployment-target.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BETA_LABEL = 'com.madeforthisjob.beta';

function invariant(value, message) {
  if (!value) throw new Error(message);
}

export function parseBetaReleaseArguments(argv) {
  const options = { apply: false };
  const valueFlags = new Set(['--release', '--runner', '--beta-plist', '--local-health-url', '--external-health-url']);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') { options.apply = true; continue; }
    invariant(valueFlags.has(argv[i]), `Unknown beta deployment argument: ${argv[i]}`);
    invariant(argv[i + 1] && !argv[i + 1].startsWith('--'), `Missing value for ${argv[i]}`);
    options[argv[i].slice(2).replaceAll('-', '_')] = argv[++i];
  }
  for (const field of ['release', 'runner', 'beta_plist']) {
    invariant(options[field], `Missing --${field.replaceAll('_', '-')}`);
    invariant(path.isAbsolute(options[field]), `--${field.replaceAll('_', '-')} must be absolute`);
  }
  options.local_health_url ??= 'http://127.0.0.1:4176/api/health';
  options.external_health_url ??= 'https://beta.madeforthisjob.com/api/health';
  options.external_health_url = assertCanonicalExternalHealthUrl(options.external_health_url);
  return options;
}

export function replaceRunnerAppRoot(source, nextRoot) {
  const matches = source.match(/^app_root="[^"]+"$/m);
  invariant(matches?.length === 1, 'Beta runner must contain exactly one app_root declaration');
  return source.replace(/^app_root="[^"]+"$/m, `app_root="${nextRoot}"`);
}

async function exists(target) {
  try { await lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function waitForHealth(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < until) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const body = await response.json();
      if (response.ok && body?.status === 'ready') return body;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Beta health did not become ready: ${last ?? 'unknown failure'}`);
}

async function betaPlistIsValid(plist, runner) {
  const result = await execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]);
  const payload = JSON.parse(result.stdout);
  invariant(payload.Label === BETA_LABEL, 'Beta plist label is invalid');
  invariant(Array.isArray(payload.ProgramArguments) && payload.ProgramArguments.includes(runner), 'Beta plist does not launch the supplied runner');
  invariant(payload.KeepAlive === true && payload.RunAtLoad === true, 'Beta plist is not persistent');
}

async function verifyRelease(release) {
  const result = await execute(process.execPath, [path.join(projectRoot, 'tools/verify-product-release.mjs'), release]);
  const verified = JSON.parse(result.stdout);
  invariant(verified.ok === true, 'Strict beta release verification did not pass');
  return verified;
}

async function main() {
  const options = parseBetaReleaseArguments(process.argv.slice(2));
  const verified = await verifyRelease(options.release);
  await betaPlistIsValid(options.beta_plist, options.runner);
  const runnerBefore = await readFile(options.runner, 'utf8');
  const currentRoot = runnerBefore.match(/^app_root="([^"]+)"$/m)?.[1];
  invariant(currentRoot, 'Beta runner app_root is missing');
  invariant(await exists(currentRoot), 'Current beta app_root is missing');
  const betaVersions = path.join(path.dirname(options.runner), '.zeely-deploy', 'beta-versions');
  const nextRoot = path.join(betaVersions, `release-${verified.base_commit.slice(0, 7)}-${Date.now()}`);
  const plan = { ok: true, mode: options.apply ? 'APPLY' : 'DRY_RUN', current_release: currentRoot, next_release: nextRoot, base_commit: verified.base_commit, cache_token: verified.cache_token };
  if (!options.apply) { process.stdout.write(`${JSON.stringify(plan)}\n`); return; }

  await mkdir(betaVersions, { recursive: true, mode: 0o700 });
  invariant(!await exists(nextRoot), 'Target beta release already exists');
  const stage = `${nextRoot}.staging`;
  await cp(options.release, stage, { recursive: true, dereference: false, errorOnExist: true });
  await symlink(path.join(projectRoot, 'node_modules'), path.join(stage, 'node_modules'));
  await mkdir(path.join(stage, 'runtime'), { mode: 0o700 });
  await rename(stage, nextRoot);
  const runnerBackup = `${options.runner}.backup-${verified.base_commit.slice(0, 7)}-${Date.now()}`;
  await writeFile(runnerBackup, runnerBefore, { mode: 0o700, flag: 'wx' });
  const replacement = replaceRunnerAppRoot(runnerBefore, nextRoot);
  const temporaryRunner = `${options.runner}.next-${process.pid}`;
  await writeFile(temporaryRunner, replacement, { mode: 0o700, flag: 'wx' });
  await rename(temporaryRunner, options.runner);
  const domain = `gui/${process.getuid()}/${BETA_LABEL}`;
  try {
    await execute('/bin/launchctl', ['kickstart', '-k', domain]);
    const local = await waitForHealth(options.local_health_url);
    const external = await waitForHealth(options.external_health_url);
    const receipt = { ...plan, activated_at: new Date().toISOString(), local_status: local.status, external_status: external.status, runner_backup_sha256: createHash('sha256').update(runnerBefore).digest('hex') };
    await writeFile(path.join(nextRoot, 'ops/beta-activation-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    await writeFile(temporaryRunner, runnerBefore, { mode: 0o700, flag: 'w' });
    await rename(temporaryRunner, options.runner);
    await execute('/bin/launchctl', ['kickstart', '-k', domain]).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
