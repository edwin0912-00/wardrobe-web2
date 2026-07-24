import { execFile } from 'node:child_process';
import os from 'node:os';
import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

export const RESOURCE_POLICIES = Object.freeze({
  test: Object.freeze({
    min_memory_free_percent: 20,
    max_swap_used_bytes: 1.5 * GIB,
    max_five_minute_load_per_cpu: 1,
    min_disk_free_bytes: 8 * GIB,
    max_background_rss_bytes: 768 * MIB,
  }),
  build: Object.freeze({
    min_memory_free_percent: 25,
    max_swap_used_bytes: 1.25 * GIB,
    max_five_minute_load_per_cpu: 1,
    min_disk_free_bytes: 10 * GIB,
    max_background_rss_bytes: 640 * MIB,
  }),
  deploy: Object.freeze({
    min_memory_free_percent: 30,
    max_swap_used_bytes: 1 * GIB,
    max_five_minute_load_per_cpu: 0.75,
    min_disk_free_bytes: 12 * GIB,
    max_background_rss_bytes: 512 * MIB,
  }),
});

const BACKGROUND_PROCESS_PATTERNS = Object.freeze([
  /\/openclaw\/dist\/index\.js gateway\b/,
  /\bhermes_cli\.main gateway\b/,
  /\.akella-hermes\/browser\/akella\/user-data\b/,
]);

function bytesFromUnit(value, unit) {
  const multiplier = {
    B: 1,
    K: 1024,
    M: MIB,
    G: GIB,
    T: 1024 ** 4,
  }[unit.toUpperCase()];
  if (!multiplier) throw new Error(`Unsupported byte unit: ${unit}`);
  return Number(value) * multiplier;
}

export function parseMemoryPressure(output) {
  const match = String(output).match(/System-wide memory free percentage:\s*(\d+)%/i);
  if (!match) throw new Error('memory_pressure did not report the free-memory percentage');
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error('memory_pressure reported an invalid free-memory percentage');
  }
  return percent;
}

export function parseSwapUsage(output) {
  const match = String(output).match(/\bused\s*=\s*([0-9]+(?:\.[0-9]+)?)([BKMGT])\b/i);
  if (!match) throw new Error('vm.swapusage did not report used swap');
  return Math.round(bytesFromUnit(match[1], match[2]));
}

export function parseBackgroundProcesses(output) {
  const processes = [];
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const rssBytes = Number(match[1]) * 1024;
    const command = match[2];
    if (!BACKGROUND_PROCESS_PATTERNS.some((pattern) => pattern.test(command))) continue;
    processes.push({
      rss_bytes: rssBytes,
      process: command.includes('.akella-hermes/browser/akella/user-data')
        ? 'technical_browser'
        : command.includes('hermes_cli.main')
          ? 'hermes_gateway'
          : 'openclaw_gateway',
    });
  }
  return processes;
}

function gib(bytes) {
  return (bytes / GIB).toFixed(2);
}

export function evaluateResourceSnapshot(snapshot, policy) {
  const failures = [];
  const loadLimit = snapshot.logical_cpu_count * policy.max_five_minute_load_per_cpu;
  if (snapshot.memory_free_percent < policy.min_memory_free_percent) {
    failures.push(
      `free memory ${snapshot.memory_free_percent}% is below ${policy.min_memory_free_percent}%`,
    );
  }
  if (snapshot.swap_used_bytes > policy.max_swap_used_bytes) {
    failures.push(
      `swap ${gib(snapshot.swap_used_bytes)} GiB exceeds ${gib(policy.max_swap_used_bytes)} GiB`,
    );
  }
  if (snapshot.five_minute_load > loadLimit) {
    failures.push(
      `5-minute load ${snapshot.five_minute_load.toFixed(2)} exceeds ${loadLimit.toFixed(2)}`,
    );
  }
  if (snapshot.disk_free_bytes < policy.min_disk_free_bytes) {
    failures.push(
      `disk free ${gib(snapshot.disk_free_bytes)} GiB is below ${gib(policy.min_disk_free_bytes)} GiB`,
    );
  }
  if (snapshot.background_rss_bytes > policy.max_background_rss_bytes) {
    failures.push(
      `background agent RSS ${gib(snapshot.background_rss_bytes)} GiB exceeds ${
        gib(policy.max_background_rss_bytes)
      } GiB`,
    );
  }
  return {
    ok: failures.length === 0,
    failures,
    limits: {
      ...policy,
      max_five_minute_load: loadLimit,
    },
  };
}

async function command(commandRunner, binary, args) {
  const result = await commandRunner(binary, args, {
    timeout: 10_000,
    maxBuffer: 4 * MIB,
    env: {
      PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'C',
      LC_ALL: 'C',
    },
  });
  return result.stdout;
}

export async function collectResourceSnapshot({
  rootDirectory = process.cwd(),
  commandRunner = execute,
  platform = process.platform,
  osModule = os,
  statfsRunner = statfs,
} = {}) {
  const resolvedRoot = path.resolve(rootDirectory);
  const filesystem = await statfsRunner(resolvedRoot);
  const logicalCpuCount = Math.max(1, osModule.cpus()?.length ?? 1);
  const fiveMinuteLoad = Number(osModule.loadavg()?.[1] ?? 0);
  let memoryFreePercent = Math.round((osModule.freemem() / osModule.totalmem()) * 100);
  let swapUsedBytes = 0;

  if (platform === 'darwin') {
    const [memoryOutput, swapOutput] = await Promise.all([
      command(commandRunner, '/usr/bin/memory_pressure', []),
      command(commandRunner, '/usr/sbin/sysctl', ['-n', 'vm.swapusage']),
    ]);
    memoryFreePercent = parseMemoryPressure(memoryOutput);
    swapUsedBytes = parseSwapUsage(swapOutput);
  }

  const processOutput = await command(commandRunner, '/bin/ps', ['-axo', 'rss=,command=']);
  const backgroundProcesses = parseBackgroundProcesses(processOutput);
  return {
    checked_at: new Date().toISOString(),
    logical_cpu_count: logicalCpuCount,
    five_minute_load: fiveMinuteLoad,
    memory_free_percent: memoryFreePercent,
    swap_used_bytes: swapUsedBytes,
    disk_free_bytes: Number(filesystem.bavail) * Number(filesystem.bsize),
    background_rss_bytes: backgroundProcesses.reduce(
      (total, processEntry) => total + processEntry.rss_bytes,
      0,
    ),
    background_processes: backgroundProcesses,
  };
}

export class ResourcePreflightError extends Error {
  constructor(mode, result, snapshot) {
    super(`Resource preflight (${mode}) refused to start: ${result.failures.join('; ')}`);
    this.name = 'ResourcePreflightError';
    this.code = 'RESOURCE_PREFLIGHT_FAILED';
    this.mode = mode;
    this.result = result;
    this.snapshot = snapshot;
  }
}

export async function assertResourceCapacity({
  mode = 'test',
  rootDirectory = process.cwd(),
  policy = RESOURCE_POLICIES[mode],
  ...snapshotOptions
} = {}) {
  if (!policy) throw new Error(`Unknown resource preflight mode: ${mode}`);
  const snapshot = await collectResourceSnapshot({
    rootDirectory,
    ...snapshotOptions,
  });
  const result = evaluateResourceSnapshot(snapshot, policy);
  if (!result.ok) throw new ResourcePreflightError(mode, result, snapshot);
  return {
    mode,
    ...snapshot,
    limits: result.limits,
  };
}
