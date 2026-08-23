import test from 'node:test';
import assert from 'node:assert/strict';

import { extractProviderUrl, healthUrl } from '../../tools/public-preview.mjs';

test('extractProviderUrl accepts only the expected provider host', () => {
  assert.equal(
    extractProviderUrl('cloudflared', 'INF https://abc123.trycloudflare.com'),
    'https://abc123.trycloudflare.com',
  );
  assert.equal(
    extractProviderUrl('ngrok', '{"url":"https://demo.ngrok-free.app"}'),
    'https://demo.ngrok-free.app',
  );
  assert.equal(
    extractProviderUrl('localtunnel', 'your url is: https://zeely-preview.loca.lt'),
    'https://zeely-preview.loca.lt',
  );
  assert.equal(extractProviderUrl('cloudflared', 'https://evil.example.com'), null);
});

test('healthUrl resolves the requested path without duplicating slashes', () => {
  assert.equal(healthUrl('https://preview.example', '/api/health'), 'https://preview.example/api/health');
  assert.equal(healthUrl('https://preview.example/', '/'), 'https://preview.example/');
});
