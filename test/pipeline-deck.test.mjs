import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE_SHA256 = 'd24637d53d4c407f98f1db37690056e854b93579e498ba380918605a18e0a2cf';

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
  assert.equal(sourceBytes.byteLength, 807062);
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), SOURCE_SHA256);
  assert.match(source, /<title>wardrobe — Pipeline<\/title>/);
  assert.equal((source.match(/<section\b[^>]*\bclass="[^"]*\bpanel\b/g) || []).length, 10);
  assert.match(source, /id="deck"/);
  assert.match(source, /type="application\/json" id="node-specs"/);
  assert.match(source, /id="drawer"/);
  assert.match(source, /id="drawer-close"/);
  assert.match(source, /document\.body\.classList\.toggle\('pres'\)/);
  assert.match(source, /body\.pres/);
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
  assert.match(adapter, /body: root\.host/);
  assert.match(adapter, /:host\(\.\$2\)/);
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
  assert.match(cameraFrame, /beginTerminalSettle\(lastFrame\)/);
  assert.match(adapter, /function enterScreenScroll\(frame\)/);
  assert.match(adapter, /function isTerminalFrame\(frame\)/);
  assert.doesNotMatch(cameraFrame, /enterFullscreen|setLaptopFullscreen/);
});

test('the document locks only after the camera has settled on the measured 14.145s terminal frame', () => {
  assert.match(page, /HOW_TARGET_SECONDS = 14\.145/);
  assert.match(adapter, /lastFrame\.videoTime >= SCREEN_SCROLL_STOP_SECONDS - SCREEN_SCROLL_EPSILON_SECONDS/);
  assert.match(adapter, /Math\.abs\(Number\(frame\.videoTime\) - SCREEN_SCROLL_STOP_SECONDS\) <= SCREEN_SCROLL_EPSILON_SECONDS/);
  assert.match(adapter, /mode = 'settling'/);
  assert.match(adapter, /onTerminalSettle/);
  assert.match(adapter, /if \(!ready \|\| mode === 'screen' \|\| !isTerminalFrame/);
  assert.match(surfaces, /var laptopTerminalLock = false/);
  assert.match(surfaces, /var geometryTime = laptopTerminalLock \? last : frame\.videoTime/);
});

test('natural terminal arrival and HOW share one reversible, thresholded document handoff', () => {
  assert.match(adapter, /var terminalReleased = false/);
  assert.match(adapter, /screenScrollRequested = false;\s*terminalReleased = true;/);
  assert.match(adapter, /REVERSE_RELEASE_THRESHOLD_PX = 72/);
  assert.match(adapter, /reverseReleaseDistance \+= Math\.abs\(next\)/);
  assert.match(adapter, /REVERSE_RELEASE_MAX_DELTA_PX/);
  assert.match(adapter, /lastFrame\.videoTime < SCREEN_SCROLL_STOP_SECONDS - 0\.35/);
  assert.match(adapter, /!terminalReleased && mode === 'camera'/);
  assert.match(adapter, /beginTerminalSettle\(lastFrame\)/);
  assert.match(adapter, /onTerminalSettle/);
  assert.match(page, /onTerminalSettle: function \(frame\)/);
  assert.match(page, /advanceToVideoTime\(3, terminalSeconds/);
});

test('the settling state blocks residual inertial input before the document owns the gesture', () => {
  assert.match(adapter, /function beginTerminalSettle\(frame\)/);
  assert.match(adapter, /host\.setAttribute\('data-screen-settling', '1'\)/);
  assert.match(adapter, /window\.requestAnimationFrame\.bind\(window\)/,
    'the camera correction is deferred out of engine.js\'s active frame callback');
  assert.match(adapter, /if \(mode === 'settling'\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/s);
  assert.match(adapter, /function finishTerminalSettle\(\)[\s\S]*?enterScreenScroll\(lastFrame\)/);
  assert.match(adapter, /host\.removeAttribute\('data-screen-settling'\);\s*host\.setAttribute\('data-screen-scroll', '1'\)/s);
});

test('portrait phones keep the verified document in the measured laptop plane', () => {
  const projection = surfaces.slice(
    surfaces.indexOf('function positionLaptop(frame)'),
    surfaces.indexOf('function update(frame)')
  );
  assert.match(surfaces, /This document always belongs to the calibrated laptop aperture/);
  assert.match(surfaces, /var geometryTime = laptopTerminalLock \? last : frame\.videoTime/);
  assert.doesNotMatch(surfaces, /setLaptopMobileTerminal|data-mobile-terminal|isPortraitMobileViewport/);
  assert.doesNotMatch(mobileCss, /data-mobile-terminal/);
  assert.doesNotMatch(projection, /appendChild\(laptop\)|laptop-surface--fullscreen/);
});

test('portrait terminal keeps the document in the laptop but makes its own pages readable and swipe-owned', () => {
  assert.match(adapter, /:host\(\[data-screen-scroll="1"\]\)\{touch-action:none;\}/);
  assert.match(adapter, /:host\(\[data-screen-scroll="1"\]\) \.deck\{touch-action:none;overscroll-behavior:none/);
  assert.match(adapter, /:host\(\[data-screen-scroll="1"\]\) h1\{font-size:72px/);
  assert.match(adapter, /:host\(\[data-screen-scroll="1"\]\) h2\{font-size:58px/);
  assert.doesNotMatch(adapter, /data-mobile-terminal|setLaptopMobileTerminal/);
});
