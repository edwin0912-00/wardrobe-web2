import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertGraph, loadPostShootPipeline } from '../../src/web/post-shoot-pipeline.js';

test('post-shoot JSON graph is schema-valid, closed, and source-bound', async () => {
  const pipeline = await loadPostShootPipeline();
  assert.equal(pipeline.source_contract.required_step, 'ART_SHOOT.05');
  assert.deepEqual(pipeline.modes.map((mode) => mode.id), ['video', 'live_webcam']);
  assert.equal(assertGraph(pipeline), true);
});

test('Lucy node exposes provider, cost, hard timeout, and no credential', async () => {
  const pipeline = await loadPostShootPipeline();
  const live = pipeline.modes.find((mode) => mode.id === 'live_webcam');
  assert.equal(live.provider.model_id, 'decart/lucy-2-5/realtime');
  assert.equal(live.provider.transport, 'WEBRTC');
  assert.equal(live.price_usd_per_second, 0.04);
  assert.equal(live.max_session_seconds, 5);
  assert.equal(JSON.stringify(pipeline).includes('b4a37'), false);
  assert.equal(JSON.stringify(pipeline).toLowerCase().includes('fal_key'), false);
});

test('browser draft requires a local reference photo and states the five-second cost ceiling', async () => {
  const html = await readFile(new URL('../../web/public/post-shoot-mvp.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../../web/public/post-shoot-mvp.js', import.meta.url), 'utf8');

  assert.match(html, /id="reference-upload"/);
  assert.match(html, /мінімум 512×512/);
  assert.match(html, /5 секунд = максимум \$0\.20/);
  assert.match(client, /max_session_seconds:\s*5/);
  assert.match(client, /naturalWidth < 512/);
  assert.match(client, /naturalHeight < 512/);
});

test('graph rejects a missing transition target', async () => {
  const pipeline = await loadPostShootPipeline();
  pipeline.nodes[0].next = ['MISSING.99'];
  assert.throws(() => assertGraph(pipeline), /targets missing node/);
});
