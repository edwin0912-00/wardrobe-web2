import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../b/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const motion = JSON.parse(await readFile(new URL('../b/motion.json', import.meta.url), 'utf8'));

function tableLookup(table, local) {
  const x = Math.max(0, Math.min(1, local)) * (table.length - 1);
  const index = Math.floor(x);
  if (index >= table.length - 1) return table.at(-1);
  const ratio = x - index;
  return table[index] + (table[index + 1] - table[index]) * ratio;
}

test('the textile remains above D until the measured rail-assembly moment', () => {
  const screensPerLeg = Number(html.match(/screensPerLeg:\s*([0-9.]+)/)?.[1]);
  const intro = html.match(
    /intro:\s*\{\s*screens:\s*([0-9.]+),\s*handoverAt:\s*([0-9.]+),\s*fadeFrom:\s*([0-9.]+)\s*\}/
  );
  assert.ok(intro, 'the intro timing contract must remain explicit');

  const introScreens = Number(intro[1]);
  const handoverAt = Number(intro[2]);
  const fadeFrom = Number(intro[3]);
  const legCount = 4;
  const totalScreens = introScreens + screensPerLeg * legCount;
  const introFraction = introScreens / totalScreens;
  const legsStart = introFraction * handoverAt;
  const revealProgress = introFraction * fadeFrom;
  const firstLegLocal = ((revealProgress - legsStart) / (1 - legsStart)) * legCount;
  const revealTime = tableLookup(motion.legs[0].table, firstLegLocal);

  assert.ok(revealTime >= 4.2, `D leaked before the rails assembled (${revealTime.toFixed(2)}s)`);
  assert.ok(revealTime <= 4.7, `the textile hid the approved assembly too long (${revealTime.toFixed(2)}s)`);
  assert.match(css, /\.film video\[data-intro\]\s*\{\s*z-index:\s*4;\s*\}/);
  assert.match(css, /\.film video\[data-leg\]\s*\{\s*z-index:\s*1;\s*\}/);
});
