import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRunWithRetry, RunNotFoundError } from '../../web/public/run-resume.js';

test('resume survives transient network failures and returns the same active run', async () => {
  let calls = 0;
  const retries = [];
  const run = await fetchRunWithRetry('run-1', {
    delays: [0, 1, 1], waitImpl: async () => {}, onRetry: (value) => retries.push(value.attempt),
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('Load failed');
      return { ok: true, status: 200, json: async () => ({ run_id: 'run-1', status: 'RUNNING' }) };
    },
  });
  assert.equal(run.run_id, 'run-1');
  assert.equal(calls, 3);
  assert.deepEqual(retries, [1, 2]);
});

test('confirmed 404 is terminal and is never retried', async () => {
  let calls = 0;
  await assert.rejects(() => fetchRunWithRetry('missing', {
    delays: [0, 1, 1], waitImpl: async () => {},
    fetchImpl: async () => { calls += 1; return { ok: false, status: 404 }; },
  }), RunNotFoundError);
  assert.equal(calls, 1);
});

test('pending finalization retries an early 404 until the deterministic run appears', async () => {
  let calls = 0;
  const run = await fetchRunWithRetry('pending-run', {
    retryNotFound: true,
    delays: [0, 1, 1],
    waitImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => ({ run_id: 'pending-run', status: 'QUEUED' }) };
    },
  });
  assert.equal(run.run_id, 'pending-run');
  assert.equal(calls, 3);
});

test('a hung status request is aborted and the next attempt can recover', async () => {
  let calls = 0;
  const run = await fetchRunWithRetry('slow-run', {
    delays: [0, 0], timeoutMs: 2, waitImpl: async () => {},
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      if (calls === 2) return { ok: true, status: 200, json: async () => ({ run_id: 'slow-run', status: 'RUNNING' }) };
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  });
  assert.equal(run.run_id, 'slow-run');
  assert.equal(calls, 2);
});
