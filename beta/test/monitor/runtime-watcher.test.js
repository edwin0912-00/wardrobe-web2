import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('terminal watcher maps every product event family without dumping raw payloads', async () => {
  const source = await readFile(
    new URL('../../tools/watch-beta-runtime.mjs', import.meta.url),
    'utf8',
  );
  for (const label of [
    'B1 CORE LOOK',
    'B2 PROFILE',
    'B3 BACKGROUND',
    'B4/5 SHOOT',
    'B6 VIDEO',
    'B7 LIVE',
  ]) assert.match(source, new RegExp(label.replace('/', '\\/')));
  assert.doesNotMatch(source, /JSON\.stringify\(event\)/);
  assert.match(source, /event\.data\?\.stage/);
});
