import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunFromServerDraft } from '../../web/public/server-draft.js';

test('browser draft finalization includes a supplied idempotency UUID', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ run_id: 'accepted' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const finalizationKey = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  const sourceAvatarId = '7df0e252-7045-4721-9b95-7bb4935fe79d';
  await createRunFromServerDraft(finalizationKey, { sourceAvatarId });
  await createRunFromServerDraft();

  assert.equal(requests[0].url, '/api/draft/run');
  assert.deepEqual(JSON.parse(requests[0].options.body), { consent: true, finalization_key: finalizationKey, source_avatar_id: sourceAvatarId });
  assert.deepEqual(JSON.parse(requests[1].options.body), { consent: true });
});

test('browser draft finalization aborts a hung request so reload recovery can take over', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(
    () => createRunFromServerDraft('20cf6522-43fd-40ad-a8db-615bcdf80e07', { timeoutMs: 2 }),
    /timed out/,
  );
});
