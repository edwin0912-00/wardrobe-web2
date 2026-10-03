import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileEditorialShoot, createProfileScene } from '../../web/public/profile-client.js';

test('background and photoshoot clients serialize the selected mode without changing idempotency headers', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const mode of ['slow', 'fast']) {
    await createProfileScene('look-1', {
      presetId: 'std.room', presetVersion: '1.0.0',
      imageGenerationMode: mode, idempotencyKey: `scene-${mode}`,
    });
    await createProfileEditorialShoot('look-1', {
      modeId: 'editorial.one', modeVersion: '1.0.0',
      imageGenerationMode: mode, idempotencyKey: `shoot-${mode}`,
    });
  }

  for (const [index, mode] of ['slow', 'fast'].entries()) {
    const scene = requests[index * 2];
    const shoot = requests[index * 2 + 1];
    assert.equal(JSON.parse(scene.options.body).image_generation_mode, mode);
    assert.equal(JSON.parse(shoot.options.body).image_generation_mode, mode);
    assert.equal(scene.options.headers['Idempotency-Key'], `scene-${mode}`);
    assert.equal(shoot.options.headers['Idempotency-Key'], `shoot-${mode}`);
  }
});

test('an omitted scene or shoot mode retains the legacy Slow default', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options);
    return new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await createProfileScene('look-1', { presetId: 'std.room', presetVersion: '1.0.0', idempotencyKey: 'scene-default' });
  await createProfileEditorialShoot('look-1', { modeId: 'editorial.one', modeVersion: '1.0.0', idempotencyKey: 'shoot-default' });
  assert.deepEqual(requests.map((options) => JSON.parse(options.body).image_generation_mode), ['slow', 'slow']);
});
