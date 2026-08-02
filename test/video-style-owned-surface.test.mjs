import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('Fashion Video bypasses the viewer format picker and submits the style-owned surface', async () => {
  const ui = await readFile(new URL('ui.js', root), 'utf8');
  assert.match(ui, /choiceKind === 'fash'[\s\S]{0,500}startGeneratedAction\('fash'/);
  assert.match(ui, /presentationSurface: chosen && chosen\.presentationSurface/);
  assert.doesNotMatch(ui, /awaitingAspect = choiceKind;[\s\S]{0,80}choiceKind === 'fash'/);
});

test('the cinematic bridge uses only the verified style surface for Fashion Video', async () => {
  const bridge = await readFile(new URL('adapters/cinematic-ui-bridge.mjs', root), 'utf8');
  assert.match(bridge, /presentationSurface = 'mirror'/);
  assert.doesNotMatch(bridge, /async createVideo\([^)]*aspect/);
  assert.match(bridge, /surface: presentationSurface/);
});
