import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the calibrated laptop plane stays empty and hidden until real HTML is supplied', async () => {
  const page = await readFile(new URL('../b/index.html', import.meta.url), 'utf8');
  assert.match(
    page,
    /<section class="laptop-surface" data-laptop-surface[^>]*aria-hidden="true" hidden>/,
    'the measured plane must fail closed without the supplied document'
  );
  assert.match(page, /<div class="laptop-surface__page" data-laptop-page><\/div>/);
  assert.doesNotMatch(page, /data-screen-layer/, 'the false rectangular placeholder must not return');
});
