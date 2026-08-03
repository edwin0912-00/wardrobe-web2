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

test('look creation requires an uploaded garment while keeping named presets additive', () => {
  assert.match(ui, /function hasUploadedItems\(\)/);
  assert.match(ui, /step === 1 && \(!hasItems\(\) \|\| !hasUploadedItems\(\)/);
  assert.match(ui, /готові назви можна додати до фото/);
});

test('preset tray and mirror panels respect station and mobile accessibility state', () => {
  assert.match(ui, /if \(locked\(\)\) return;\s*if \(t\.closest\('\[data-presets\]'\)\)/);
  assert.match(ui, /el\.hasAttribute\('data-presets'\)[\s\S]*?el\.disabled = lock \|\| preparingFiles/);
  assert.match(ui, /function syncPanelAccessibility\(\)/);
  assert.match(ui, /syncMobileAttention\(\);\s*syncPanelAccessibility\(\);/);
});

test('persistent chrome exposes the actual system release identifier', () => {
  assert.match(ui, /data-build/);
  assert.match(ui, /BUILD ' \+ String\(sha\)\.slice\(0, 7\)\.toUpperCase\(\)/);
  assert.match(css, /\.mark__build\s*\{/);
});

test('Fashion Shoot renders each approved frame while the remaining slots are still running', () => {
  assert.match(ui, /progressiveShoot = kind === 'shoot'[\s\S]*?readyCount > 0/);
  assert.match(ui, /function shootProgressFrame\(result, caption, state\)/);
  assert.match(ui, /Готові кадри вже збережені/);
  assert.match(css, /\.shoot-progress__rail\s*\{[^}]*grid-template-columns:\s*repeat\(5,/);
});

test('Fashion Shoot exposes the immutable download for every approved progressive frame', () => {
  assert.match(ui, /shoot-progress__download/);
  assert.match(ui, /shoot-progress__lead-download/);
  assert.match(ui, /downloadUrl/);
  assert.match(css, /\.shoot-progress__download/);
});

test('libraries and progressive Fashion Shoot use server previews while downloads retain originals', () => {
  assert.match(ui, /function serverImagePreviewUrl/);
  assert.match(ui, /result\.previewUrls = serverPreviews/);
  assert.match(ui, /lead\.previewUrl \|\| lead\.imageUrl/);
  assert.match(ui, /frame\.previewUrl \|\| frame\.imageUrl/);
  assert.match(ui, /href="' \+ esc\(frame\.downloadUrl\) \+ '" download/);
  assert.match(ui, /result\.posterUrl/);
  assert.match(ui, /preload="metadata"/);
});

test('Fashion Video keeps the style contract server-owned without exposing its production inputs', () => {
  assert.match(ui, /Оберіть відеостиль/);
  assert.match(ui, /videoCapability/);
  assert.match(ui, /inputContract: option\.inputContract/);
  assert.doesNotMatch(ui, /visualpick__contract/);
  assert.doesNotMatch(ui, /description_uk/);
  assert.match(ui, /if \(bridge\) return \[\];/);
});
