import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = await readFile(path.join(repoRoot, 'b', 'index.html'), 'utf8');

test('mobile mirror stop widens the attention approach without moving the calibrated pin', () => {
  assert.match(indexHtml, /dampFrom:\s*MOBILE_PORTRAIT \? 0\.46 : 0\.78/);
  assert.match(indexHtml, /stationAt:\s*1\.0/);
  assert.match(indexHtml, /stationEnter:\s*MOBILE_PORTRAIT \? 0\.88 : 0\.99/);
  assert.match(indexHtml, /stationExit:\s*MOBILE_PORTRAIT \? 0\.60 : 0\.81/);
});

test('mobile mirror stop does not leak its thresholds into desktop', () => {
  assert.doesNotMatch(indexHtml, /dampFrom:\s*0\.46/);
  assert.doesNotMatch(indexHtml, /stationEnter:\s*0\.88/);
  assert.match(indexHtml, /MOBILE_PORTRAIT \? 0\.46 : 0\.78/);
  assert.match(indexHtml, /MOBILE_PORTRAIT \? 0\.88 : 0\.99/);
});
