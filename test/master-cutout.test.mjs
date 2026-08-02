import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('main result cutout starts from exact master bytes and caches the native alpha asset', async () => {
  const [cutout, ui, html] = await Promise.all([
    readFile(new URL('../master-cutout.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /<script src="\.\.\/master-cutout\.js"><\/script>/);
  assert.match(cutout, /sourceResponse\.arrayBuffer\(\)/);
  assert.match(cutout, /removeEdgeBackground\(pixels/);
  assert.match(cutout, /CACHE_NAME = 'wardrobe-cutout-native-v2'/);
  assert.match(cutout, /x-wardrobe-source-sha256/);
  assert.match(cutout, /x-wardrobe-native-sha256/);
  assert.match(cutout, /Preview derivative is not an approved master/);
  assert.match(ui, /cutout\.create\(masterUrl, look\.masterSha256\)/);
  assert.match(ui, /cutoutPreviewSourceNativeSha256/);
  assert.match(ui, /function publishNativeLookPresentation/);
  assert.match(ui, /previewUrls: \[display\]/,
    'the physical result surface receives the alpha asset derived from the full master');
  assert.match(ui, /publishNativeLookPresentation\(target\)/,
    'a completed native cutout updates the television shelf, not just the answer mirror');
  assert.doesNotMatch(ui, /mediaPreview\.fromUrl\([^;]+removeBackground:\s*true/);
});

test('a missing native cutout never authorizes a preview-derived foreground', async () => {
  const ui = await readFile(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /nativeBound = !!\(nativeUrl && nativeSha256 && masterSha256/);
  assert.match(ui, /displayUrl: previewBound \? previewUrl : nativeBound \? nativeUrl : masterUrl/);
  assert.match(ui, /Keep the master; do not manufacture a foreground from a failed preview/);
});

test('a compact URL may display while only an unambiguous master may be segmented', async () => {
  const ui = await readFile(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /function isPreviewOnlyImageUrl/);
  assert.match(ui, /displayFallback = first\(masterNames\) \|\| fallbackMaster/);
  assert.match(ui, /!isPreviewOnlyImageUrl\(value\)/);
  assert.match(ui, /masterSourceUrl = savedAssets\.masterUrl \|\| ''/);
  assert.match(ui, /masterSourceUrl \|\| \(!isPreviewOnlyImageUrl\(look\.resultUrl\)/);
});
