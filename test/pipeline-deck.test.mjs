import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE_SHA256 = '43262d5359b53f02ab3fb22792ab984da25dfa6484530dd1b672286d868f813e';

const [sourceBytes, source, adapter, page, surfaces, css] = await Promise.all([
  readFile(new URL('../b/pipeline-deck-v2.html', import.meta.url)),
  readFile(new URL('../b/pipeline-deck-v2.html', import.meta.url), 'utf8'),
  readFile(new URL('../b/pipeline-deck.js', import.meta.url), 'utf8'),
  readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../screen-surfaces.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
]);

test('the laptop source is vendored byte-for-byte from the approved handoff', () => {
  assert.equal(sourceBytes.byteLength, 114332);
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
  assert.match(adapter, /setLaptopFullscreen/);
  assert.doesNotMatch(adapter, /<iframe|createElement\(['"]iframe/i);
});

test('the cinematic handoff is wired to one projected node and is reversible', () => {
  assert.match(page, /<script src="pipeline-deck\.js"><\/script>/);
  assert.match(page, /pipelineDeck = WardrobePipelineDeck\.create/);
  assert.match(page, /pipelineDeck\.ready\.then/);
  assert.match(page, /mountLaptop\(pipelineDeck\.host\)/);
  assert.match(page, /pipelineDeck\.onCameraFrame\(frame\)/);
  assert.match(surfaces, /laptopHomeNext/);
  assert.match(surfaces, /appendChild\(laptop\)/);
  assert.match(surfaces, /laptopFullscreen/);
  assert.match(surfaces, /laptopWindow/);
  assert.match(css, /\.laptop-surface--fullscreen[\s\S]*position: fixed/);
  assert.match(css, /\.laptop-surface--fullscreen[\s\S]*transform: none/);
});

test('the current laptop calibration never invents a fullscreen handoff before a close camera frame exists', () => {
  const cameraFrame = adapter.slice(adapter.indexOf('function onCameraFrame(frame)'), adapter.indexOf('function destroy()'));
  assert.match(cameraFrame, /There is no measured contact frame/);
  assert.doesNotMatch(cameraFrame, /^\s*enterFullscreen\(\);/m);
});
