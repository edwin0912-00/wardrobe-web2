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
