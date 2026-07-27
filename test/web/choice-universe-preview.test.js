import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../web/public/choice-universe-preview.html', import.meta.url), 'utf8');

test('choice universe preview exposes all five non-functional post-look directions', () => {
  for (const label of [
    'Покращити<br>образ',
    'Додати<br>фон',
    'Створити<br>фотозйомку',
    'Fashion<br>Video',
    'Real-time Look',
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /Visual prototype/);
  assert.match(source, /кнопки поки нічого не запускають/);
  assert.doesNotMatch(source, /getUserMedia|fetch\(|XMLHttpRequest|<script/);
});

test('choice universe preview has five distinct light languages and accessible motion fallback', () => {
  for (const selector of ['refine', 'background', 'photoshoot', 'video', 'realtime']) {
    assert.match(source, new RegExp(`\\.${selector}\\s*\\{\\s*--light:`));
  }
  assert.match(source, /@keyframes orbit/);
  assert.match(source, /@keyframes glow/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /Camera \+ consent/);
});
