import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [ui, css] = await Promise.all([
  readFile(new URL('../ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
]);

test('ready look is visibly active and does not inherit placeholder treatment', () => {
  assert.match(ui, /class="look-status"[^>]*role="status"/);
  assert.match(ui, /class="lookthumb__active"/);
  assert.match(css, /\.lookframe\[data-state="ready"\] \.lookframe__img\s*\{[^}]*object-fit:\s*contain/);
  assert.match(css, /\.lookframe\[data-state="ready"\] \.lookframe__img\s*\{[^}]*filter:\s*none/);
  assert.match(css, /\.lookframe\[data-state="ready"\]::after\s*\{\s*content:\s*none/);
  assert.match(css, /\.lookthumb\[aria-pressed="true"\]\s*\{[^}]*box-shadow:/);
});

test('result screen never performs browser segmentation of a master or compact preview', async () => {
  const [source, surfaces] = await Promise.all([
    readFile(new URL('../ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../screen-surfaces.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(source, /ensureTransparentPreview/);
  assert.match(source, /cutoutNativeSourceMasterSha256/);
  assert.match(source, /cutoutPreviewSourceNativeSha256/);
  assert.match(surfaces, /results\[index\]\.kind === 'look'/);
});

test('persistent chrome exposes the actual system release identifier', () => {
  assert.match(ui, /data-build/);
  assert.match(ui, /BUILD ' \+ String\(sha\)\.slice\(0, 7\)\.toUpperCase\(\)/);
  assert.match(css, /\.mark__build\s*\{/);
});
