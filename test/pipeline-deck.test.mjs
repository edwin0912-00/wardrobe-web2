import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE_SHA256 = 'a6c5a0df0cec153465f15ae86ecd001da7aa4eb1661d357ef4196811217b996b';

const [sourceBytes, source, adapter, page, surfaces, css] = await Promise.all([
  readFile(new URL('../b/pipeline-deck-v2.html', import.meta.url)),
  readFile(new URL('../b/pipeline-deck-v2.html', import.meta.url), 'utf8'),
  readFile(new URL('../b/pipeline-deck.js', import.meta.url), 'utf8'),
  readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../screen-surfaces.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
]);

test('the laptop source is vendored byte-for-byte from the approved handoff', () => {
  assert.equal(sourceBytes.byteLength, 114569);
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), SOURCE_SHA256);
  assert.match(source, /<title>Wardrobe — Pipeline v2 · 2026-08-01<\/title>/);
  assert.equal((source.match(/<section\b[^>]*\bclass="[^"]*\bpanel\b/g) || []).length, 17);
  assert.match(source, /id="deck"/);
  assert.match(source, /id="drawer"/);
  assert.match(source, /id="drawer-close"/);
  assert.doesNotMatch(source, /<iframe\b/i);
  assert.doesNotMatch(source, /(?:src|href)=["']https?:/i);
});

test('the adapter is same-origin, SHA-bound, and fails closed without an iframe', () => {
  assert.match(adapter, new RegExp(SOURCE_SHA256));
  assert.match(adapter, /fetch\(sourceUrl\)/);
  assert.match(adapter, /crypto\.subtle\.digest\(['"]SHA-256/);
  assert.match(adapter, /attachShadow\(\{ mode: ['"]open['"] \}\)/);
  assert.match(adapter, /new Function\(['"]document['"], script\)/);
  assert.match(adapter, /pipeline-deck-error/);
  assert.match(adapter, /addEventListener\(['"]wheel['"].*capture: true/s);
  assert.match(adapter, /addEventListener\(['"]touchstart['"].*capture: true/s);
  assert.match(adapter, /addEventListener\(['"]keydown['"].*capture: true/s);
  assert.match(adapter, /requestScreenScroll/);
  assert.match(adapter, /SCREEN_SCROLL_STOP_SECONDS = 13\.25/);
  assert.doesNotMatch(adapter, /setLaptopFullscreen/);
  assert.doesNotMatch(adapter, /<iframe|createElement\(['"]iframe/i);
});

test('the cinematic handoff stops on the measured laptop and scrolls in that projected node', () => {
  assert.match(page, /<script src="pipeline-deck\.js"><\/script>/);
  assert.match(page, /pipelineDeck = WardrobePipelineDeck\.create/);
  assert.match(page, /pipelineDeck\.ready\.then/);
  assert.match(page, /mountLaptop\(pipelineDeck\.host\)/);
  assert.match(page, /pipelineDeck\.onCameraFrame\(frame\)/);
  assert.match(surfaces, /laptopWindow/);
  assert.match(page, /waitForHowTargetRoom/);
  assert.match(page, /outcome !== 'arrived'/);
  assert.match(page, /data-how-visible/);
  assert.doesNotMatch(surfaces, /data-how-visible/,
    'surface geometry cannot itself reveal the document before the camera arrives');
  assert.match(css, /laptop-surface\[data-how-reveal="1"\]/);
  assert.match(adapter, /data-screen-scroll/);
  assert.doesNotMatch(adapter, /laptop-surface--fullscreen/);
});

test('the current laptop calibration never invents a fullscreen handoff', () => {
  const cameraFrame = adapter.slice(adapter.indexOf('function onCameraFrame(frame)'), adapter.indexOf('function destroy()'));
  assert.match(cameraFrame, /SCREEN_SCROLL_STOP_SECONDS/);
  assert.match(cameraFrame, /enterScreenScroll\(\)/);
  assert.doesNotMatch(cameraFrame, /enterFullscreen|setLaptopFullscreen/);
});
