#!/usr/bin/env node
// Shared operational truth, in one command, for every chat and every agent.
//
//   node ops/runtime.mjs            print the recorded state
//   node ops/runtime.mjs --verify   re-measure it live and say what drifted
//   node ops/runtime.mjs --verify --write   also persist the measured values
//
// Why this exists: operational facts — where the host is, which provider is
// live, which release is running — were being rediscovered in every chat, and a
// stale LAN address cost a working session. Prose state lives in STATE.md and is
// the orchestrator's. This file is machine-checkable and anyone may update it.

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statePath = path.join(root, 'ops', 'RUNTIME.json');

const args = new Set(process.argv.slice(2));
const verify = args.has('--verify');
const write = args.has('--write');

const state = JSON.parse(await readFile(statePath, 'utf8'));

function line(label, value) {
  console.log(`${label.padEnd(22)} ${value}`);
}

async function tailscaleAddress(name) {
  for (const bin of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    try {
      const { stdout } = await run(bin, ['status'], { timeout: 15_000 });
      const row = stdout.split('\n').find((entry) => entry.includes(name));
      const address = row?.trim().split(/\s+/)[0];
      if (address) return address;
      return null;
    } catch {
      // try the next candidate binary
    }
  }
  return null;
}

async function liveHealth(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { status: `http_${response.status}` };
    return await response.json();
  } catch (error) {
    return { status: 'unreachable', error: error.message };
  }
}

async function declaredCatalogIds(ref) {
  const ids = new Set();
  for (const file of ['src/web/scene-resolvers.js', 'src/web/editorial-shoot-bible.js']) {
    try {
      const { stdout } = await run('git', ['show', `${ref}:${file}`], {
        cwd: root, maxBuffer: 64 * 1024 * 1024,
      });
      for (const match of stdout.matchAll(/'((?:shoot|editorial)\.[a-z0-9_.]+)'/g)) ids.add(match[1]);
    } catch {
      // a file that does not exist at that ref simply contributes nothing
    }
  }
  return ids;
}

async function liveCatalogIds(url) {
  try {
    const response = await fetch(`${url}/api/editorial-modes`, { signal: AbortSignal.timeout(15_000) });
    const payload = await response.json();
    const modes = payload.modes ?? payload.data ?? payload;
    if (!Array.isArray(modes)) return null;
    return new Set(modes.filter((mode) => mode.generation_available).map((mode) => mode.mode_id));
  } catch {
    return null;
  }
}

console.log(`RUNTIME.json — updated ${state.updated_at} by ${state.updated_by}\n`);
line('host', `${state.host.tailscale_name} (${state.host.reach}), ssh ${state.host.ssh_user}`);
line('beta release', state.beta.release);
line('beta health', state.beta.health);
line('generation', `${state.generation.active_provider} · vlm ${state.generation.vlm}`);
for (const [name, provider] of Object.entries(state.providers)) {
  line(`provider ${name}`, provider.api ?? provider.status);
}
console.log('\nblockers');
for (const blocker of state.blockers) {
  console.log(`  ${blocker.id.padEnd(28)} owner: ${blocker.owner}`);
}

if (!verify) {
  console.log('\nRun with --verify to re-measure. Add --write to persist what was measured.');
  process.exit(0);
}

console.log('\n— verifying —');
const measured = {};

const address = await tailscaleAddress(state.host.tailscale_name);
measured.host_address = address;
line('tailscale address', address ?? 'NOT FOUND — run `tailscale status`');

const health = await liveHealth(state.beta.url);
measured.health = health.status;
line('live health', `${health.status}${health.generation ? ` · generation ${health.generation}` : ''}`);
if (health.status !== state.beta.health) {
  console.log(`  DRIFT: recorded health "${state.beta.health}", measured "${health.status}"`);
}

const { stdout: shaOut } = await run('git', ['rev-parse', 'origin/beta'], { cwd: root });
const sha = shaOut.trim();
const declared = await declaredCatalogIds(sha);
const live = await liveCatalogIds(state.beta.url);
line('deploy candidate', sha.slice(0, 7));
if (!live) {
  console.log('  catalogue check skipped: the live endpoint did not answer with a list');
} else {
  const lost = [...live].filter((id) => !declared.has(id));
  const gained = [...declared].filter((id) => !live.has(id));
  line('live generation-ready', String(live.size));
  line('declared in candidate', String(declared.size));
  console.log(`  WOULD LOSE: ${lost.join(', ') || 'none'}`);
  console.log(`  would gain: ${gained.join(', ') || 'none'}`);
  if (lost.length) {
    console.log('  STOP: activating this SHA removes a style that is live right now.');
    process.exitCode = 1;
  }
}

if (write) {
  state.beta.health = health.status;
  state.host.reachable = Boolean(address);
  state.host.verified_at = new Date().toISOString();
  state.beta.verified_at = state.host.verified_at;
  state.updated_at = state.host.verified_at;
  state.updated_by = process.env.WARDROBE_AGENT_ID ?? state.updated_by;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log('\nRUNTIME.json updated with the measured values.');
}
