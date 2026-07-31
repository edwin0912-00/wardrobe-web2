import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, ui, css, bridge] = await Promise.all([
  readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
  readFile(new URL('../adapters/cinematic-ui-bridge.mjs', import.meta.url), 'utf8')
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

test('nothing may be done with a look until its own image exists', () => {
  /* Pre-change proof: the result frame rendered person.main.url — the uploaded portrait —
   * and both the action gate and the forward gate keyed off an elapsed stand-in interval,
   * so four actions were offered under a look that had never been generated. */
  assert.match(ui, /function hasResult\s*\(/, 'a look must be able to say whether it has an image');
  assert.match(ui, /l\.result/, 'the result frame must render the look’s own image');
  assert.doesNotMatch(
    ui,
    /function lookResultFrame\([^)]*\)\s*\{\s*var src = person\.main/,
    'the uploaded photograph must not stand in for a generated look'
  );
  assert.match(ui, /lookVisible\(\)\s*\{[^}]*hasResult\(\)/, 'the action gate must require a result');
  assert.match(ui, /if \(!hasResult\(\)\) return false;/, 'forward travel must require a result');
  assert.match(ui, /setLookResult/, 'only an explicit result may complete a look');
});

test('TV and laptop use the measured surface module', () => {
  assert.match(html, /screen-surface-math\.js/);
  assert.match(html, /screen-surfaces\.js/);
  assert.match(html, /calibrationUrl:\s*'screen-calibration\.json'/);
  assert.match(ui, /opts\.onResult/);
});

test('all missing mirror choice screens exist as one visual component family', () => {
  assert.match(ui, /BACKGROUND_OPTIONS/);
  assert.match(ui, /SHOOT_STYLES/);
  assert.match(ui, /VIDEO_STYLES/);
  assert.match(ui, /data-choice-kind/);
  assert.match(ui, /data-picker-back/);
  assert.match(ui, /data-format-back/);
  assert.match(ui, /data-retry-action/);
  assert.match(ui, /showFailure/);
  assert.match(bridge, /kind:\s*'look'/);
  assert.match(ui, /kind === 'background' \? 'bg'/);
  assert.match(css, /\.visualpicks/);
  assert.match(css, /\.visualpick/);
  assert.match(css, /\.formatpicks/);
  assert.match(css, /\.formatpick/);
});

test('the cinematic UI consumes one neutral bridge without learning API routes or hosts', () => {
  assert.match(ui, /opts\.bridge \|\| global\.WardrobeCinematicBridge/);
  assert.match(ui, /setBridge:\s*bindBridge/);
  assert.match(ui, /import\('\.\/adapters\/cinematic-ui-bridge\.mjs'\)/);
  assert.match(ui, /bridge\.createLook/);
  assert.match(ui, /bridge\.createBackground/);
  assert.match(ui, /bridge\.createShoot/);
  assert.match(ui, /bridge\.createVideo/);
  assert.match(ui, /simulated:\s*false/);
  assert.doesNotMatch(ui, /SIM_MS/);
  assert.doesNotMatch(ui, /beta\.madeforthisjob\.com|site\.madeforthisjob\.com|fetch\(['"`]\/api/);
});
