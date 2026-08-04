import assert from 'node:assert/strict';
import test from 'node:test';
import { runLocalPreflight } from '../../src/web/preflight.js';

function commandRunner({ fail = new Set(), account = { credits: 42, subscription_plan_type: 'test' } } = {}) {
  return async (binary, args) => {
    const key = `${binary} ${args.join(' ')}`;
    if (fail.has(key)) throw new Error(`${key} unavailable`);
    if (args[0] === '--version') return { stdout: `${binary} 1.0.0\n` };
    return { stdout: `${JSON.stringify(account)}\n` };
  };
}

test('preflight reports ready only when binaries and provider account are ready', async () => {
  const result = await runLocalPreflight({ commandRunner: commandRunner() });
  assert.equal(result.status, 'ready');
  assert.equal(result.higgsfield_credits, 42);
});

test('provider account failure degrades health without crashing web startup', async () => {
  const result = await runLocalPreflight({
    commandRunner: commandRunner({
      fail: new Set(['higgsfield account status --json']),
    }),
  });
  assert.equal(result.status, 'degraded');
  assert.equal(result.higgsfield_account, 'temporarily_unavailable');
});

test('missing runtime binary degrades health without throwing', async () => {
  const result = await runLocalPreflight({
    commandRunner: commandRunner({
      fail: new Set(['higgsfield --version']),
    }),
  });
  assert.equal(result.status, 'degraded');
  assert.equal(result.higgsfield, 'unavailable');
  assert.equal(result.higgsfield_account, 'not_checked');
});
