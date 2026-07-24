import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateResourceSnapshot,
  parseBackgroundProcesses,
  parseMemoryPressure,
  parseSwapUsage,
  RESOURCE_POLICIES,
} from '../../tools/lib/resource-preflight.mjs';

test('parses macOS memory and swap telemetry', () => {
  assert.equal(
    parseMemoryPressure('System-wide memory free percentage: 62%\n'),
    62,
  );
  assert.equal(
    parseSwapUsage('total = 2048.00M  used = 472.69M  free = 1575.31M'),
    Math.round(472.69 * 1024 ** 2),
  );
});

test('counts only known heavy background stacks', () => {
  const processes = parseBackgroundProcesses(`
  844448 /opt/homebrew/bin/node /opt/homebrew/lib/node_modules/openclaw/dist/index.js gateway --port 18789
   74192 /Users/example/venv/bin/python -m hermes_cli.main gateway run --replace
  223488 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/example/.akella-hermes/browser/akella/user-data
  120000 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT
`);
  assert.deepEqual(
    processes.map((entry) => entry.process),
    ['openclaw_gateway', 'hermes_gateway', 'technical_browser'],
  );
  assert.equal(
    processes.reduce((total, entry) => total + entry.rss_bytes, 0),
    (844448 + 74192 + 223488) * 1024,
  );
});

test('accepts a healthy deploy snapshot', () => {
  const result = evaluateResourceSnapshot({
    logical_cpu_count: 8,
    five_minute_load: 3.5,
    memory_free_percent: 60,
    swap_used_bytes: 0.4 * 1024 ** 3,
    disk_free_bytes: 58 * 1024 ** 3,
    background_rss_bytes: 0,
  }, RESOURCE_POLICIES.deploy);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('refuses compound memory, swap, load, disk, and background pressure', () => {
  const result = evaluateResourceSnapshot({
    logical_cpu_count: 8,
    five_minute_load: 7,
    memory_free_percent: 12,
    swap_used_bytes: 1.8 * 1024 ** 3,
    disk_free_bytes: 4 * 1024 ** 3,
    background_rss_bytes: 900 * 1024 ** 2,
  }, RESOURCE_POLICIES.deploy);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 5);
  assert.match(result.failures.join('\n'), /free memory/);
  assert.match(result.failures.join('\n'), /swap/);
  assert.match(result.failures.join('\n'), /5-minute load/);
  assert.match(result.failures.join('\n'), /disk free/);
  assert.match(result.failures.join('\n'), /background agent RSS/);
});
