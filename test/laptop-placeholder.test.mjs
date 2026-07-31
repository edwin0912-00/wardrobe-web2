import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the uncalibrated laptop placeholder cannot paint over the D footage', async () => {
  const page = await readFile(new URL('../b/index.html', import.meta.url), 'utf8');
  assert.match(
    page,
    /<div class="screen" data-screen-layer aria-hidden="true" hidden>/,
    'show a laptop document only after a four-corner calibration and real supplied content'
  );
});
