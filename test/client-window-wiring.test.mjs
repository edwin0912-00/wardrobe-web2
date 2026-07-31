import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, ui, css] = await Promise.all([
  readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8')
]);

test('client UI stays on its physical owners', () => {
  assert.match(html, /data-ui-ask/);
  assert.match(html, /data-ui-show/);
  assert.match(html, /data-tv-surface/);
  assert.match(html, /data-laptop-surface/);
  assert.doesNotMatch(html, /data-live-invite/, 'Live must not return as bottom chrome');
});

test('right mirror owns orb, result actions and the 40-second live expansion', () => {
  assert.match(ui, /function orbWindow/);
  assert.match(ui, /LIVE_MAX_MS\s*=\s*40000/);
  assert.match(html, /data-live-overlay/);
  assert.match(css, /\.live-overlay/);
  assert.match(css, /\.orbfield/);
  assert.doesNotMatch(ui, /рендер не підключений/i);
  assert.doesNotMatch(ui, /модел|провайдер|ціна|вартіст/i);
});

test('Real-time Look has one actionable incomplete-look explanation for API handoff', () => {
  assert.match(ui, /LIVE_LOOK_INCOMPLETE_COPY/);
  assert.match(ui, /Збережений аватар \+ одна нова річ/);
  assert.match(ui, /крупне фото обличчя \+ лише капелюх/);
  assert.match(ui, /setLiveError/);
  assert.match(ui, /data-live-return/);
  assert.match(css, /\.orbfield--error/);
});

test('TV and laptop use the measured surface module', () => {
  assert.match(html, /screen-surface-math\.js/);
  assert.match(html, /screen-surfaces\.js/);
  assert.match(html, /calibrationUrl:\s*'screen-calibration\.json'/);
  assert.match(ui, /opts\.onResult/);
});
