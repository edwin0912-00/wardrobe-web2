import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [appSource, indexSource, uploadCss] = await Promise.all([
  readFile(new URL('../../web/public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/upload.css', import.meta.url), 'utf8'),
]);

test('public UI exposes the authoritative release identity for screenshot verification', () => {
  assert.match(indexSource, /id="build-identity"[^>]*aria-label="Версія збірки"/);
  assert.match(appSource, /fetch\('\/api\/health'/);
  assert.match(appSource, /health\.release_sha/);
  assert.match(appSource, /marker\.textContent = `REL \$\{releaseSha\.slice\(0, 8\)\}`/);
  assert.match(appSource, /marker\.title = `Release \$\{releaseSha\}/);
  assert.match(uploadCss, /\.build-identity\s*\{/);
});
