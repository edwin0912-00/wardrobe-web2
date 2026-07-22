import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDefinitivelyRejectedRunState, createRunFromServerDraft, DraftApiError, isDefinitiveDraftRunRejection } from '../../web/public/server-draft.js';

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

test('a definitive 4xx finalization response is not eligible for run polling', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'garment_images[0] is too small for bounded preparation',
  }), {
    status: 422,
    headers: { 'content-type': 'application/json' },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  let rejectedError;
  await assert.rejects(
    () => createRunFromServerDraft('20cf6522-43fd-40ad-a8db-615bcdf80e07'),
    (error) => {
      rejectedError = error;
      assert.ok(error instanceof DraftApiError);
      assert.equal(error.status, 422);
      assert.equal(isDefinitiveDraftRunRejection(error), true);
      return true;
    },
  );
  const values = new Map([
    ['zeely_pending_finalization_id', '20cf6522-43fd-40ad-a8db-615bcdf80e07'],
    ['zeely_active_run_id', '20cf6522-43fd-40ad-a8db-615bcdf80e07'],
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
  assert.equal(clearDefinitivelyRejectedRunState(
    rejectedError,
    '20cf6522-43fd-40ad-a8db-615bcdf80e07',
    storage,
  ), true);
  assert.equal(values.has('zeely_pending_finalization_id'), false);
  assert.equal(values.has('zeely_active_run_id'), false);
  assert.equal(isDefinitiveDraftRunRejection(new Error('network timeout')), false);
  assert.equal(isDefinitiveDraftRunRejection(new DraftApiError('server error', { status: 503 })), false);
});
