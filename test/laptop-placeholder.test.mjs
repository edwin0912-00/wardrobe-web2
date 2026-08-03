import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the calibrated laptop plane stays hidden until the verified deck is mounted', async () => {
  const [page, adapter, deck] = await Promise.all([
    readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../b/pipeline-deck.js', import.meta.url), 'utf8'),
    readFile(new URL('../b/pipeline-deck-v2.html', import.meta.url), 'utf8'),
  ]);
  assert.match(
    page,
    /<section class="laptop-surface" data-laptop-surface[^>]*aria-hidden="true" hidden>/,
    'the measured plane must fail closed before the supplied document is verified'
  );
  assert.match(page, /<div class="laptop-surface__page" data-laptop-page><\/div>/);
  assert.doesNotMatch(page, /data-screen-layer/, 'the false rectangular placeholder must not return');
  assert.match(page, /<script src="pipeline-deck\.js"><\/script>/);
  assert.match(page, /pipeline-deck-v2\.html/);
  assert.match(adapter, /SCREEN_SCROLL_STOP_SECONDS = 13\.25/);
  assert.match(adapter, /enterScreenScroll/);
  assert.doesNotMatch(adapter, /setLaptopFullscreen/);
  assert.match(adapter, /new Function\('document'/);
  assert.doesNotMatch(adapter, /<iframe|createElement\(['"]iframe/i);
  assert.match(deck, /<main class="deck" id="deck">/);
  assert.equal((deck.match(/<section\b[^>]*\bclass="[^"]*\bpanel\b/g) || []).length, 17);
});
