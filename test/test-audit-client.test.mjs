import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [client, html] = await Promise.all([
  readFile(new URL('../test-audit-client.js', import.meta.url), 'utf8'),
  readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
]);

test('main sends only a bounded same-origin test journey signal before UI state is wired', () => {
  assert.match(html, /<script src="\.\.\/test-audit-client\.js"><\/script>\s*<script src="\.\.\/ui\.js/);
  assert.match(client, /var ENDPOINT = '\/api\/test-audit\/events';/);
  assert.match(client, /credentials: 'same-origin'/);
  assert.match(client, /keepalive: true/);
  assert.match(client, /main\.open/);
  assert.match(client, /main\.stage/);
  assert.match(client, /main\.bridge/);
  assert.match(client, /main\.exit/);
  assert.match(client, /pageshow/);
});

test('main test journal excludes media, text, browser-fingerprint and error-detail collection', () => {
  assert.doesNotMatch(client, /FormData|files|mediaUrl|resultUrl|prompt|document\.cookie|navigator\.userAgent|canvas|getClientRects|screen\.|error\.message|\.stack/);
  assert.match(client, /data-leg/);
  assert.match(client, /data-station-id/);
  assert.match(client, /data-gate/);
});
