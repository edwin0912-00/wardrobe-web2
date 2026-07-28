import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../web/public/atelier-choice-prototype.html', import.meta.url), 'utf8');

test('atelier prototype is assembled from independently addressable visual layers', () => {
  for (const layer of ['swatch left', 'swatch right', 'lamp', 'look-paper', 'data-look-slot', 'control-panel']) {
    assert.match(source, new RegExp(layer));
  }
  assert.match(source, /Approved look slot/);
  assert.doesNotMatch(source, /<img\s+src=/);
});

test('five action controls are interactive but never claim a provider, camera, or persistence call', () => {
  for (const label of ['Покращити образ', 'Додати фон', 'Фотозйомка', 'Fashion Video', 'Real-time Look']) {
    assert.match(source, new RegExp(`data-action="${label}"`));
  }
  assert.match(source, /querySelectorAll\('\.action'\)/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /getUserMedia|fetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});

test('atelier prototype protects reduced-motion users', () => {
  assert.match(source, /@keyframes orbit/);
  assert.match(source, /prefers-reduced-motion/);
});
