import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TAP_ENTER_WINDOW_MS, createVoiceMachine } from '../../web/public/voice-input.js';

function clockAt(start) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('tap starts listening, second tap stops', () => {
  const m = createVoiceMachine({ now: () => 0 });
  assert.equal(m.tap(), 'start');
  assert.equal(m.state(), 'LISTENING');
  assert.equal(m.tap(), 'stop');
});

test('no automatic Enter: ending with text only arms the window', () => {
  const m = createVoiceMachine({ now: () => 0 });
  m.tap();
  assert.equal(m.ended(true), 'armed');
  assert.equal(m.state(), 'ARMED'); // armed, nothing submitted by itself
});

test('a short tap inside five seconds is Enter — and only then', () => {
  const clock = clockAt(1000);
  const m = createVoiceMachine({ now: clock.now });
  m.tap(); m.ended(true);
  clock.advance(4999);
  assert.equal(m.tap(), 'submit');
  assert.equal(m.state(), 'IDLE');
});

test('a tap after the window starts a new dictation instead of submitting', () => {
  const clock = clockAt(0);
  const m = createVoiceMachine({ now: clock.now });
  m.tap(); m.ended(true);
  clock.advance(TAP_ENTER_WINDOW_MS + 1);
  assert.equal(m.tap(), 'start');
});

test('an empty session never arms the window', () => {
  const m = createVoiceMachine({ now: () => 0 });
  m.tap();
  assert.equal(m.ended(false), 'none');
  assert.equal(m.tap(), 'start'); // next tap records again, no surprise submit
});

test('hand-editing the field cancels the window', () => {
  const clock = clockAt(0);
  const m = createVoiceMachine({ now: clock.now });
  m.tap(); m.ended(true);
  m.userEdited();
  assert.equal(m.tap(), 'start');
});

test('markup and wiring are present', async () => {
  const html = await readFile(new URL('../../web/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="voice-input-button"[^>]*type="button"/);
  assert.match(html, /voice-input\.js/);
  const js = await readFile(new URL('../../web/public/voice-input.js', import.meta.url), 'utf8');
  assert.match(js, /requestSubmit\(\)/);
  assert.match(js, /interimResults = true/); // live text while speaking
});
