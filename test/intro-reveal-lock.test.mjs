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

test('the scarf hands off to the sofa-only opening before rails appear', () => {
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
  const fadeStartProgress = introFraction * fadeFrom;
  const introEndProgress = introFraction;
  const fadeStartLocal = ((fadeStartProgress - legsStart) / (1 - legsStart)) * legCount;
  const introEndLocal = ((introEndProgress - legsStart) / (1 - legsStart)) * legCount;
  const fadeStartTime = tableLookup(motion.legs[0].table, fadeStartLocal);
  const introEndTime = tableLookup(motion.legs[0].table, introEndLocal);

  assert.ok(fadeStartTime >= 0.1, `the scarf handoff is too abrupt (${fadeStartTime.toFixed(2)}s)`);
  assert.ok(introEndTime <= 1.3, `rails leaked into the scarf handoff (${introEndTime.toFixed(2)}s)`);
  assert.equal(handoverAt, 0.94, 'room one must not advance early behind the scarf');
  assert.equal(fadeFrom, 0.98, 'the sofa reveal gap must remain calibrated');
  assert.match(css, /\.film video\[data-intro\]\s*\{\s*z-index:\s*4;\s*\}/);
  assert.match(css, /\.film video\[data-leg\]\s*\{\s*z-index:\s*1;\s*\}/);
});

test('no room paints before the textile has a frame', () => {
  /* Pre-change proof: only video[data-intro] was held back while data-intro-pending was
   * set, so a first load painted the couch at z-index 1 and the scarf landed on top of it
   * afterwards. The film background is the scarf poster, so holding the rooms shows the
   * right first image rather than a black plane. */
  assert.match(
    css,
    /\.film\[data-intro-pending="1"\]\s*video\[data-leg\]:not\(\[data-ios-prewarm="1"\]\)\s*\{[^}]*visibility:\s*hidden/,
    'every leg plane must be held back while the intro has not painted'
  );
  /* The exemption is load-bearing: WebKit certifies a real native frame through that plane,
   * and it is already imperceptible at 0.001 opacity. */
  assert.match(css, /\.film video\[hidden\]\[data-ios-prewarm="1"\]/);
  /* The guard may only be lifted by the confirmed-frame path, never by a timer. */
  assert.match(html, /removeAttribute\('data-intro-pending'\)/);
  assert.match(html, /requestVideoFrameCallback\(revealIntroFrame\)/);
});
