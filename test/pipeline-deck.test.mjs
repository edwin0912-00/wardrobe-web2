import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE_SHA256 = '0aea43bd7f1cf6ac77b5db68521b3712dbae2de964ab57fd14f206818171389b';

const [sourceBytes, source, adapter, page, surfaces, css, mobileCss] = await Promise.all([
  readFile(new URL('../b/zeely-pipeline-clients.html', import.meta.url)),
  readFile(new URL('../b/zeely-pipeline-clients.html', import.meta.url), 'utf8'),
  readFile(new URL('../b/pipeline-deck.js', import.meta.url), 'utf8'),
  readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../screen-surfaces.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
  readFile(new URL('../mobile.css', import.meta.url), 'utf8'),
]);

test('the laptop source is vendored byte-for-byte from the approved handoff', () => {
  assert.equal(sourceBytes.byteLength, 803177);
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), SOURCE_SHA256);
  assert.match(source, /<title>wardrobe — Pipeline<\/title>/);
  assert.equal((source.match(/<section\b[^>]*\bclass="[^"]*\bpanel\b/g) || []).length, 10);
  assert.match(source, /id="deck"/);
  assert.match(source, /type="application\/json" id="node-specs"/);
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
  assert.match(adapter, /isDataScript/);
  assert.match(adapter, /isExecutableScript/);
  assert.match(adapter, /scripts\.forEach/);
  assert.match(adapter, /pipeline-deck-error/);
  assert.match(adapter, /addEventListener\(['"]wheel['"].*capture: true/s);
  assert.match(adapter, /addEventListener\(['"]touchstart['"].*capture: true/s);
  assert.match(adapter, /addEventListener\(['"]keydown['"].*capture: true/s);
  assert.match(adapter, /requestScreenScroll/);
  assert.match(adapter, /SCREEN_SCROLL_STOP_SECONDS = 14\.145/);
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
  assert.match(adapter, /setLaptopTerminalLock\(true\)/);
  assert.match(adapter, /setLaptopTerminalLock\(false\)/);
  assert.doesNotMatch(adapter, /laptop-surface--fullscreen/);
});

test('the current laptop calibration never invents a fullscreen handoff', () => {
  const cameraFrame = adapter.slice(adapter.indexOf('function onCameraFrame(frame)'), adapter.indexOf('function destroy()'));
  assert.match(cameraFrame, /SCREEN_SCROLL_STOP_SECONDS/);
  assert.match(cameraFrame, /enterScreenScroll\(\)/);
  assert.doesNotMatch(cameraFrame, /enterFullscreen|setLaptopFullscreen/);
});

test('the document handoff begins only at the measured 14.145s terminal laptop frame', () => {
  assert.match(page, /HOW_TARGET_SECONDS = 14\.145/);
  assert.match(adapter, /lastFrame\.videoTime >= SCREEN_SCROLL_STOP_SECONDS - SCREEN_SCROLL_EPSILON_SECONDS/);
  assert.match(adapter, /if \(amount < 0 && next < 0\)[\s\S]*?handBack\(next\)/);
  assert.match(surfaces, /var laptopTerminalLock = false/);
  assert.match(surfaces, /var geometryTime = laptopTerminalLock \? last : frame\.videoTime/);
});

test('portrait phones enlarge the same terminal document without invoking fullscreen', () => {
  assert.match(surfaces, /function isPortraitMobileViewport\(\)/);
  assert.match(surfaces, /laptopTerminalLock && isPortraitMobileViewport\(\)/);
  assert.match(surfaces, /function setLaptopMobileTerminal\(active\)/);
  assert.match(surfaces, /stage\.appendChild\(laptop\)/);
  assert.match(surfaces, /returnLaptopToFilm\(\)/);
  assert.match(surfaces, /laptop\.setAttribute\('data-mobile-terminal', '1'\)/);
  assert.match(mobileCss, /\.laptop-surface\[data-mobile-terminal="1"\]/);
  assert.match(mobileCss, /height: min\(68vh, calc\(100% - 152px\)\) !important;/);
  assert.doesNotMatch(mobileCss, /data-mobile-terminal="1"\][\s\S]{0,600}laptop-surface--fullscreen/);
});
