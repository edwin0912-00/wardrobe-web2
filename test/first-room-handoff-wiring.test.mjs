import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexUrl = new URL('../b/index.html', import.meta.url);
const styleUrl = new URL('../style.css', import.meta.url);

test('the fabric → D page uses the one-owner media strategy instead of the old eager iOS fan-out', async () => {
  const [index, style] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(styleUrl, 'utf8')
  ]);

  assert.match(index, /<script src="\.\.\/media-strategy\.js"><\/script>/);
  assert.match(index, /var REQUIRED = MEDIA_PLAN\.critical;/);
  assert.match(index, /var REST = MEDIA_PLAN\.background;/);
  assert.match(index, /room\.dataset\.iosPrewarm = '1';/);
  assert.match(index, /delete room\.dataset\.iosPrewarm;/);
  assert.match(index, /room\.addEventListener\('canplaythrough'/);
  assert.match(index, /room\.requestVideoFrameCallback/);
  assert.match(index, /iosRoomReady\[index\] = true;/);
  assert.match(index, /isFilmReady: function \(_video, index\) \{\s*return !IOS_MEDIA \|\| iosRoomReady\[index\] === true;/);
  assert.doesNotMatch(index, /var REST = IOS_MEDIA \? VIDEOS\.slice\(1\) : VIDEOS;/);
  assert.doesNotMatch(index, /var source = IOS_MEDIA \? key : blobs\[key\];/);
  assert.match(style, /video\[hidden\]\[data-ios-prewarm="1"\]/);
});
