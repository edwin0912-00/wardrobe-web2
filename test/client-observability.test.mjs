import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [server, observer, html, ui] = await Promise.all([
  readFile(new URL('../serve.py', import.meta.url), 'utf8'),
  readFile(new URL('../client-observer.js', import.meta.url), 'utf8'),
  readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../ui.js', import.meta.url), 'utf8'),
]);

test('browser observability is narrow, same-origin, and loaded before the UI bridge', () => {
  assert.match(html, /engine\.js"><\/script>\s*<script src="\.\.\/client-observer\.js"><\/script>\s*<script src="\.\.\/ui\.js(?:\?v=[^"]+)?">/);
  assert.match(observer, /var ENDPOINT = '\/__site-observability';/);
  assert.match(observer, /credentials: 'same-origin'/);
  assert.match(observer, /keepalive: true/);
  assert.match(observer, /bridge_failed: true/);
  assert.match(observer, /bridge_needs_input: true/);
  assert.match(observer, /global\.ui\.state\(\)/);
  assert.doesNotMatch(observer, /error\.message|\.stack|FormData|files|mediaUrl|resultUrl|location\.href/);
});

test('server accepts only bounded same-origin allowlisted health events', () => {
  assert.match(server, /OBSERVABILITY_PATH = "\/__site-observability"/);
  assert.match(server, /MAX_OBSERVABILITY_BODY = 4096/);
  assert.match(server, /Same-origin observability only/);
  assert.match(server, /Expected application\/json/);
  assert.match(server, /WARDROBE_OBSERVABILITY/);
  assert.match(server, /if self\._is_observability_request\(\):\n\s+return self\._handle_observability\(\)/);
});

test('the observer reads the UI public snapshot instead of modifying its transition logic', () => {
  assert.match(ui, /state: function \(\) \{/);
  assert.doesNotMatch(ui, /wardrobe:bridge-state/);
  assert.match(observer, /bridge\.phase !== 'failed' && bridge\.phase !== 'needs_input'/);
});
