#!/usr/bin/env node

/**
 * Publish a local Zeely/web preview through a verified public HTTPS URL.
 *
 * The command deliberately launches providers with argv arrays (never a shell
 * string), validates the resulting URL before printing it, and tries the next
 * provider when a binary is missing, the provider exits, or the public health
 * check fails.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_PORT = 4173;
const DEFAULT_HEALTH_PATH = '/api/health';
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_STATE_PATH = join(process.env.TMPDIR || '/tmp', 'zeely-public-preview.json');
const PROJECT_ROOT = process.env.ZEELY_PROJECT_ROOT || process.cwd();

const HELP = `
Usage:
  npm run share -- [options]
  node tools/public-preview.mjs [options]

Options:
  --port <n>             Local port (default: ${DEFAULT_PORT})
  --host <host>         Local host (default: 127.0.0.1)
  --health-path <path>   Verification path (default: ${DEFAULT_HEALTH_PATH})
  --public-url <url>     Verify and print an existing public URL first
  --no-existing-url      Do not reuse ZEELY_PUBLIC_URL/ZEELY_PREVIEW_URL
  --no-health-check      Skip the public HTTP verification (not recommended)
  --background           Leave the verified tunnel running after printing URL
  --stop                 Stop the preview process recorded by this command
  --json                 Print one JSON receipt instead of human text
  --help                 Show this help
`;

const PROVIDER_ENV = {
  cloudflared: ['cloudflared', '/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'],
  ngrok: ['ngrok', '/opt/homebrew/bin/ngrok', '/usr/local/bin/ngrok'],
  npx: ['npx', '/opt/homebrew/bin/npx', '/usr/local/bin/npx'],
  ssh: ['ssh', '/usr/bin/ssh'],
  zrok: ['zrok', '/opt/homebrew/bin/zrok', '/usr/local/bin/zrok'],
};

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    host: '127.0.0.1',
    healthPath: DEFAULT_HEALTH_PATH,
    checkHealth: true,
    useExistingUrl: true,
    background: false,
    json: false,
    stop: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--port') options.port = parsePort(argv[++i]);
    else if (arg === '--host') options.host = requiredValue(arg, argv[++i]);
    else if (arg === '--health-path') options.healthPath = requiredValue(arg, argv[++i]);
    else if (arg === '--public-url') options.publicUrl = requiredValue(arg, argv[++i]);
    else if (arg === '--no-existing-url') options.useExistingUrl = false;
    else if (arg === '--no-health-check') options.checkHealth = false;
    else if (arg === '--background') options.background = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--stop') options.stop = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function requiredValue(flag, value) {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const pathEntries = (process.env.PATH || '').split(':').filter(Boolean);
    for (const entry of pathEntries) {
      const fullPath = join(entry, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }
  return null;
}

function originUrl(options) {
  return `http://${options.host}:${options.port}`;
}

function normalizePublicUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

const URL_PATTERNS = {
  cloudflared: /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?:\/[^\s"']*)?/i,
  ngrok: /https:\/\/[a-z0-9-]+\.(?:ngrok-free\.app|ngrok\.io)(?:\/[^\s"']*)?/i,
  localtunnel: /https:\/\/[a-z0-9-]+\.loca\.lt(?:\/[^\s"']*)?/i,
  localhostRun: /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.localhost\.run(?:\/[^\s"']*)?/i,
  zrok: /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.zrok\.io(?:\/[^\s"']*)?/i,
};

export function extractProviderUrl(providerId, text) {
  const pattern = URL_PATTERNS[providerId];
  if (!pattern) return null;
  const match = String(text || '').match(pattern);
  return normalizePublicUrl(match?.[0]);
}

function providerDefinitions(options) {
  const origin = originUrl(options);
  return [
    {
      id: 'cloudflared',
      label: 'Cloudflare Quick Tunnel',
      executable: PROVIDER_ENV.cloudflared,
      args: ['tunnel', '--url', origin, '--no-autoupdate'],
      urlPattern: URL_PATTERNS.cloudflared,
    },
    {
      id: 'ngrok',
      label: 'ngrok',
      executable: PROVIDER_ENV.ngrok,
      args: ['http', String(options.port), '--log=stdout', '--log-format=json'],
      urlPattern: URL_PATTERNS.ngrok,
    },
    {
      id: 'localtunnel',
      label: 'LocalTunnel',
      executable: PROVIDER_ENV.npx,
      args: ['--yes', 'localtunnel', '--port', String(options.port), '--local-host', options.host],
      urlPattern: URL_PATTERNS.localtunnel,
    },
    {
      id: 'localhostRun',
      label: 'localhost.run SSH tunnel',
      executable: PROVIDER_ENV.ssh,
      args: [
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ExitOnForwardFailure=yes',
        '-R', `80:${options.host}:${options.port}`,
        'nokey@localhost.run',
      ],
      urlPattern: URL_PATTERNS.localhostRun,
    },
    {
      id: 'zrok',
      label: 'zrok public share',
      executable: PROVIDER_ENV.zrok,
      args: ['share', 'public', origin],
      urlPattern: URL_PATTERNS.zrok,
    },
  ];
}

export function healthUrl(publicUrl, healthPath) {
  return new URL(healthPath, `${publicUrl.replace(/\/$/, '')}/`).toString();
}

async function fetchWithTimeout(url, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    return { ok: response.ok, status: response.status, url: response.url };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyPublicUrl(publicUrl, options) {
  if (!options.checkHealth) return { ok: true, checked: false };
  const target = healthUrl(publicUrl, options.healthPath);
  const health = await fetchWithTimeout(target);
  if (health.ok) return { ok: true, checked: true, path: options.healthPath, status: health.status };

  // A generic preview server may not expose /api/health. Only accept its root
  // as a declared fallback, and record that weaker verification in the receipt.
  if (options.healthPath !== '/') {
    const root = await fetchWithTimeout(`${publicUrl}/`);
    if (root.ok) return { ok: true, checked: true, path: '/', status: root.status, fallback: true };
  }
  return { ok: false, checked: true, path: options.healthPath, status: health.status, error: health.error };
}

function readConfiguredUrl(options) {
  const explicit = options.publicUrl;
  if (explicit) return explicit;
  const envKeys = ['ZEELY_PUBLIC_URL', 'ZEELY_PREVIEW_URL', 'ZEELY_EXTERNAL_URL'];
  return envKeys.map((key) => process.env[key]).find(Boolean) || null;
}

function statePath() {
  return process.env.ZEELY_PUBLIC_PREVIEW_STATE || DEFAULT_STATE_PATH;
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return null;
  }
}

function stopPid(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function stopExisting() {
  const state = readState();
  if (!state?.pid) {
    try { unlinkSync(statePath()); } catch {}
    return { stopped: false, state: null };
  }
  const stopped = stopPid(state.pid);
  try { unlinkSync(statePath()); } catch {}
  return { stopped, state };
}

function writeState(receipt, pid) {
  writeFileSync(statePath(), `${JSON.stringify({ ...receipt, pid }, null, 2)}\n`, { mode: 0o600 });
}

function killChild(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, 1_500).unref();
}

async function waitForProvider(child, definition, timeoutMs) {
  let output = '';
  let detectedUrl = null;
  let exited = false;
  let spawnError = null;
  let exitCode = null;
  let exitSignal = null;
  const append = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-100_000);
    detectedUrl ||= extractProviderUrl(definition.id, output);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const exitPromise = new Promise((resolve) => {
    child.once('error', (error) => {
      spawnError = error.code || error.message;
      exited = true;
      resolve();
    });
    child.once('exit', (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      resolve();
    });
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !detectedUrl && !exited) {
    await Promise.race([delay(150), exitPromise]);
  }
  return { url: detectedUrl, output, exited, spawnError, exitCode, exitSignal };
}

async function startProvider(definition, options) {
  const executable = findExecutable(definition.executable);
  if (!executable) return { ok: false, reason: 'missing_executable' };

  let child;
  try {
    child = spawn(executable, definition.args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: options.background,
    });
  } catch (error) {
    return { ok: false, reason: `spawn_${error.code || 'error'}` };
  }
  const result = await waitForProvider(child, definition, DEFAULT_TIMEOUT_MS);
  if (!result.url) {
    killChild(child);
    if (result.spawnError) return { ok: false, reason: `spawn_${result.spawnError}` };
    return { ok: false, reason: result.exited ? `process_exit_${result.exitCode ?? result.exitSignal ?? 'unknown'}` : 'url_timeout' };
  }

  const verification = await verifyPublicUrl(result.url, options);
  if (!verification.ok) {
    killChild(child);
    return { ok: false, reason: 'health_check_failed', url: result.url, verification };
  }

  const receipt = {
    method: definition.id,
    label: definition.label,
    url: result.url,
    origin: originUrl(options),
    verification,
    startedAt: new Date().toISOString(),
  };
  if (options.background) {
    // The startup pipes are no longer needed after URL/health verification.
    // Close them before unref so the parent CLI exits immediately and the
    // detached provider does not keep the npm process alive through a pipe.
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
    writeState(receipt, child.pid);
    return { ok: true, receipt, detached: true };
  }
  writeState(receipt, child.pid);
  return { ok: true, receipt, child, detached: false };
}

async function verifyExisting(options) {
  const configured = readConfiguredUrl(options);
  const normalized = normalizePublicUrl(configured);
  if (!normalized) return null;
  const verification = await verifyPublicUrl(normalized, options);
  if (!verification.ok) return { ok: false, url: normalized, verification };
  return {
    ok: true,
    receipt: {
      method: 'existing_public_url',
      label: 'Existing configured public URL',
      url: normalized,
      origin: originUrl(options),
      verification,
      startedAt: new Date().toISOString(),
    },
  };
}

function printReceipt(receipt, options, failures = []) {
  const payload = { ...receipt, failures };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`\nPublic preview ready: ${receipt.url}\n`);
  process.stdout.write(`Method: ${receipt.label}\n`);
  process.stdout.write(`Verified: ${receipt.verification.checked ? `${receipt.verification.path} → HTTP ${receipt.verification.status}` : 'skipped'}\n`);
  if (receipt.verification.fallback) process.stdout.write('Note: /api/health was unavailable; root URL returned successfully.\n');
  if (failures.length) process.stdout.write(`Fallbacks skipped: ${failures.map((item) => `${item.method} (${item.reason})`).join(', ')}\n`);
  process.stdout.write('Keep this command running while using the link; press Ctrl-C to stop the tunnel.\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.stop) {
    const result = stopExisting();
    process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : `${result.stopped ? 'Stopped public preview.' : 'No active public preview found.'}\n`);
    return;
  }

  const failures = [];
  if (options.useExistingUrl) {
    const existing = await verifyExisting(options);
    if (existing?.ok) {
      printReceipt(existing.receipt, options, failures);
      return;
    }
    if (existing) failures.push({ method: 'existing_public_url', reason: `health_check_failed${existing.verification?.status ? `_${existing.verification.status}` : ''}` });
  }

  const previous = readState();
  if (previous?.pid) stopExisting();
  for (const definition of providerDefinitions(options)) {
    const result = await startProvider(definition, options);
    if (result.ok) {
      printReceipt(result.receipt, options, failures);
      if (result.detached) {
        // A provider may still have an internal handle after its startup
        // streams are closed. Exit explicitly so `npm run share --
        // --background` never hangs waiting on the detached child.
        await new Promise((resolve) => process.stdout.write('', resolve));
        process.exit(0);
      }
      if (!result.detached) {
        const cleanup = () => {
          killChild(result.child);
          try { unlinkSync(statePath()); } catch {}
          process.exit(0);
        };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
        await new Promise(() => {});
      }
      return;
    }
    failures.push({ method: definition.id, reason: result.reason });
  }

  const summary = { error: 'No public preview provider succeeded', failures };
  if (options.json) process.stdout.write(`${JSON.stringify(summary)}\n`);
  else {
    process.stderr.write('\nCould not create a verified public preview.\n');
    for (const failure of failures) process.stderr.write(`- ${failure.method}: ${failure.reason}\n`);
    process.stderr.write('Install or authenticate one provider, then rerun: cloudflared, ngrok, npx/localtunnel, ssh, or zrok.\n');
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`public-preview: ${error.message}\n`);
    process.exitCode = 1;
  });
}
