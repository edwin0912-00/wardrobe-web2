import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, client] = await Promise.all([
  readFile(new URL('../../web/public/god-view.html', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/god-view.js', import.meta.url), 'utf8'),
]);

test('God View renders a private audit panel with explicit manual test labels', () => {
  assert.match(html, /id="god-audit"/);
  assert.match(html, /data-audit-filter="MY_TESTS"/);
  assert.match(html, /data-audit-filter="EXTERNAL_TESTS"/);
  assert.match(client, /test-audit\/profiles/);
  assert.match(client, /'Мій тест'/);
  assert.match(client, /countryName/);
  assert.match(client, /network_id/);
});

test('God View never asks the audit service for raw IP, raw user-agent, upload or prompt data', () => {
  assert.doesNotMatch(client, /raw_ip|ip_address|user_agent|upload|prompt/);
});
