import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileVideoClip, retryProfileVideoClip } from '../../web/public/profile-client.js';

test('Studio creates the next clip with its selected Seedance model and retries only the saved clip', async (t) => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      status: 202,
      ok: true,
      json: async () => calls.length === 1
        ? { clip_id: 'clip-2-5', status: 'CREATED', video_model: 'seedance-2.5' }
        : { clip_id: 'clip-retry', status: 'CREATED', video_model: 'seedance-2.5' },
    };
  };

  const created = await createProfileVideoClip({
    lookId: 'look-1',
    styleId: 'walk-camera-energy15.16s',
    motionMode: 'walk-forward',
    videoModel: 'seedance-2.5',
  });
  assert.equal(created.video_model, 'seedance-2.5');
  assert.equal(calls[0].url, '/api/profile/video-clips');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    look_id: 'look-1',
    style_id: 'walk-camera-energy15.16s',
    motion_mode: 'walk-forward',
    video_model: 'seedance-2.5',
  });

  await retryProfileVideoClip('clip-2-5', 'retry-key');
  assert.equal(calls[1].url, '/api/profile/video-clips/clip-2-5/retry');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'retry-key');
  assert.equal(calls[1].options.body, undefined, 'retry takes its model from the persisted parent clip');
  assert.equal(JSON.stringify(calls[1].options).includes('video_model'), false);
});
