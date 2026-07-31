import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [ui, css, renderer] = await Promise.all([
  readFile(new URL('../ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
  readFile(new URL('../thinking-orb.js', import.meta.url), 'utf8'),
]);

test('the right-mirror waiting field is large, transparent, and monochrome', () => {
  assert.match(ui, /class="orbfield orbfield--mirror"/);
  assert.match(ui, /width="384" height="384"/);
  assert.match(css, /\.orbfield--mirror \.orbfield__canvas\s*\{[\s\S]*?width: clamp\(256px, 64cqh, 384px\);/);
  assert.match(css, /\.orbfield--mirror \.orbfield__canvas\s*\{[\s\S]*?filter: grayscale\(1\) contrast\(1\.3\) brightness\(0\.72\);/);
  assert.match(renderer, /const tone = Math\.round\(34 \+ depth \* 154\);/);
  assert.match(renderer, /rgba\(\$\{tone\},\$\{tone\},\$\{tone\},\$\{alpha\}\)/);
  assert.doesNotMatch(renderer, /\bgreen\b/i);
});
