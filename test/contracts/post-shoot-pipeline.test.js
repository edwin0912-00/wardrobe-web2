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
  assert.equal(live.max_session_seconds, 15);
  assert.equal(JSON.stringify(pipeline).includes('b4a37'), false);
  assert.equal(JSON.stringify(pipeline).toLowerCase().includes('fal_key'), false);
});

test('browser draft requires a local reference photo and states the fifteen-second cost ceiling', async () => {
  const html = await readFile(new URL('../../web/public/post-shoot-mvp.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../../web/public/post-shoot-mvp.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../web/public/post-shoot-mvp.css', import.meta.url), 'utf8');

  assert.match(html, /id="reference-upload"/);
  assert.match(html, /id="fit-guide"/);
  assert.match(html, /id="privacy-gate-consent"/);
  assert.match(html, /id="privacy-consent"/);
  assert.match(html, /id="cost-consent"/);
  assert.match(html, /id="camera-permission-status"/);
  assert.match(html, /id="camera-start"[^>]*disabled/);
  assert.match(html, /id="live-ai-thinking"[\s\S]*?id="live-thinking-orb"/);
  assert.match(client, /createThinkingOrb\(\$\('#live-thinking-orb'\), 'searching'\)/);
  assert.match(client, /setAiThinking\(true, 'working', 'AI підключає Live'/);
  assert.match(client, /setAiThinking\(true, 'solving', 'AI налаштовує потік'/);
  assert.match(client, /setAiThinking\(true, 'composing', 'AI формує Live-потік'/);
  assert.match(client, /state\.peer\.ontrack = \(event\) => \{[\s\S]*?setAiThinking\(false\)/);
  assert.match(client, /max_session_seconds:\s*SESSION_SECONDS/);
  assert.match(client, /privacy_consent:\s*true/);
  assert.match(client, /look_id:\s*selectedLookId/);
  assert.match(client, /!state\.running \|\| !\$\('#privacy-consent'\)\.checked \|\| !\$\('#cost-consent'\)\.checked/);
  assert.match(client, /\/api\/profile\/looks\/\$\{encodeURIComponent\(lookId\)\}\/live-reference\.png/);
  assert.doesNotMatch(client, /window\.confirm/);
  assert.doesNotMatch(client, /MediaRecorder|getDisplayMedia/);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(css, /overflow-y:\s*auto/);
  assert.match(css, /body\.is-full-surface\{overflow:hidden\}/);
  assert.match(client, /naturalWidth < 512/);
  assert.match(client, /naturalHeight < 512/);
  assert.match(client, /falModule\.default\?\.fal/);
  assert.match(client, /fal\?\.realtime\?\.connect/);
});

test('web app registers profile ownership before protected Real-time Look routes', async () => {
  const appSource = await readFile(new URL('../../src/web/app.js', import.meta.url), 'utf8');
  assert.ok(
    appSource.indexOf('registerProfileRoutes(app') < appSource.indexOf('registerPostShootRoutes(app'),
    'profile routes must produce profileApi before Real-time Look routes are registered',
  );
  assert.match(appSource, /registerPostShootRoutes\(app,\s*\{[\s\S]*?profileApi,[\s\S]*?profiles,/);
});

test('graph rejects a missing transition target', async () => {
  const pipeline = await loadPostShootPipeline();
  pipeline.nodes[0].next = ['MISSING.99'];
  assert.throws(() => assertGraph(pipeline), /targets missing node/);
});
