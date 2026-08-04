import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VideoProviderRouter,
  VideoProviderRouterError,
} from '../../src/providers/video-provider-router.js';

function retryableFailure(code) {
  return Object.assign(new Error(code), { code, retryable: true });
}

function provider({ creates = [], waitResult = null } = {}) {
  const calls = [];
  return {
    calls,
    async createJob(request) {
      calls.push({ operation: 'create', request });
      const outcome = creates.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    async waitForJob(request) {
      calls.push({ operation: 'wait', request });
      return waitResult;
    },
  };
}

test('Higgsfield success locks the clip to Higgsfield without touching fallback', async () => {
  const primary = provider({
    creates: [{ jobId: 'higgs-job-1' }],
    waitResult: { jobId: 'higgs-job-1', url: 'https://cdn.example/higgs.mp4' },
  });
  const fallback = provider({ creates: [{ jobId: 'openrouter-job-1' }] });
  const router = new VideoProviderRouter({ primary, fallback });

  const created = await router.createJob({ prompt: 'locked fashion motion' });
  assert.equal(created.providerKey, 'higgsfield');
  assert.equal(created.createAttempt, 1);
  assert.equal(created.fallbackUsed, false);
  assert.equal(fallback.calls.length, 0);

  const finished = await router.waitForJob({
    providerKey: created.providerKey,
    jobId: created.jobId,
  });
  assert.equal(finished.url, 'https://cdn.example/higgs.mp4');
  assert.deepEqual(primary.calls.map((call) => call.operation), ['create', 'wait']);
  assert.equal(fallback.calls.length, 0);
});

test('OpenRouter is used only after exactly three retryable Higgsfield create failures', async () => {
  const primary = provider({
    creates: [
      retryableFailure('HIGGS_TEMP_1'),
      retryableFailure('HIGGS_TEMP_2'),
      retryableFailure('HIGGS_TEMP_3'),
    ],
  });
  const fallback = provider({
    creates: [{ jobId: 'openrouter-job-1' }],
    waitResult: { jobId: 'openrouter-job-1', url: 'https://cdn.example/openrouter.mp4' },
  });
  const router = new VideoProviderRouter({ primary, fallback });

  const created = await router.createJob({ prompt: 'locked fashion motion' });
  assert.equal(primary.calls.length, 3);
  assert.equal(fallback.calls.length, 1);
  assert.equal(created.providerKey, 'openrouter');
  assert.equal(created.fallbackUsed, true);
  assert.deepEqual(created.primaryFailures, ['HIGGS_TEMP_1', 'HIGGS_TEMP_2', 'HIGGS_TEMP_3']);

  await router.waitForJob({ providerKey: created.providerKey, jobId: created.jobId });
  assert.equal(primary.calls.filter((call) => call.operation === 'wait').length, 0);
  assert.equal(fallback.calls.filter((call) => call.operation === 'wait').length, 1);
});

test('a non-retryable Higgsfield refusal never spends through fallback', async () => {
  const refusal = Object.assign(new Error('bad request'), {
    code: 'INVALID_VIDEO_OPTION',
    retryable: false,
  });
  const primary = provider({ creates: [refusal] });
  const fallback = provider({ creates: [{ jobId: 'must-not-run' }] });
  const router = new VideoProviderRouter({ primary, fallback });

  await assert.rejects(() => router.createJob({}), (error) => error === refusal);
  assert.equal(primary.calls.length, 1);
  assert.equal(fallback.calls.length, 0);
});

test('a video-reference request never falls back to a provider that would drop Video 1', async () => {
  const primary = provider({
    creates: [
      retryableFailure('HIGGS_TEMP_1'),
      retryableFailure('HIGGS_TEMP_2'),
      retryableFailure('HIGGS_TEMP_3'),
    ],
  });
  const fallback = provider({ creates: [{ jobId: 'must-not-run' }] });
  const router = new VideoProviderRouter({ primary, fallback });

  await assert.rejects(
    () => router.createJob({
      prompt: 'reference-bound fashion transfer',
      mediaPaths: ['/runtime/approved-look.png'],
      videoPaths: ['/runtime/reference.mp4'],
    }),
    (error) => error instanceof VideoProviderRouterError
      && error.code === 'VIDEO_REFERENCE_FALLBACK_UNAVAILABLE',
  );
  assert.equal(primary.calls.length, 3);
  assert.equal(fallback.calls.length, 0);
});

test('polling requires the provider persisted with the paid job', async () => {
  const router = new VideoProviderRouter({
    primary: provider(),
    fallback: provider(),
  });
  await assert.rejects(
    () => router.waitForJob({ providerKey: 'other', jobId: 'job-1' }),
    (error) => error instanceof VideoProviderRouterError
      && error.code === 'UNKNOWN_PERSISTED_VIDEO_PROVIDER',
  );
});

test('the retry count cannot drift from the operator-approved three attempts', () => {
  assert.throws(
    () => new VideoProviderRouter({
      primary: provider(),
      fallback: provider(),
      primaryCreateAttempts: 2,
    }),
    (error) => error.code === 'INVALID_VIDEO_RETRY_POLICY',
  );
});
