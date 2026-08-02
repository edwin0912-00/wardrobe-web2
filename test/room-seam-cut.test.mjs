import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('room-to-room seams use a hard cut when endpoint masters are not registered', async () => {
  const [html, engine] = await Promise.all([
    readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../engine.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /seamWindow:\s*0[,\n]/);
  assert.match(html, /ROOM SEAMS ARE HARD CUTS, NOT DISSOLVES/);
  assert.match(engine, /var W = config\.seamWindow == null \? 0\.10 : config\.seamWindow/);
  assert.match(engine, /partnerLocal = 0/);
  assert.match(engine, /partnerLocal = 1/);
});
