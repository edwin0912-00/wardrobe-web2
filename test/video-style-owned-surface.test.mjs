import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('Fashion Video bypasses the viewer format picker and submits the style-owned surface', async () => {
  const ui = await readFile(new URL('ui.js', root), 'utf8');
  assert.match(ui, /choiceKind === 'fash'[\s\S]{0,500}startGeneratedAction\('fash'/);
  assert.match(ui, /startGeneratedAction\('fash', videoStyle, null\)/);
  assert.match(ui, /presentationSurface: chosen && chosen\.presentationSurface/);
  assert.doesNotMatch(ui, /awaitingAspect = choiceKind;[\s\S]{0,80}choiceKind === 'fash'/);
  assert.match(ui, /if \(kind === 'fash'\) return visualPicker\('fash'\)/);
});

test('Fashion Video generation does not close the route to the TV gallery', async () => {
  const ui = await readFile(new URL('ui.js', root), 'utf8');
  assert.match(ui, /var videoMayContinue = \(pendingAction && pendingAction\.kind === 'fash'\)/);
  assert.match(ui, /if \(!videoMayContinue && bridge && bridge\.canLeaveAttentionStation/);
});

test('the cinematic bridge uses only the verified style surface for Fashion Video', async () => {
  const bridge = await readFile(new URL('adapters/cinematic-ui-bridge.mjs', root), 'utf8');
  assert.match(bridge, /presentationSurface = 'mirror'/);
  assert.doesNotMatch(bridge, /async createVideo\([^)]*aspect/);
  assert.match(bridge, /surface: presentationSurface/);
});

test('four verified Fashion Video styles remain a 4-up desktop row and 2-by-2 on mobile', async () => {
  const [css, mobile] = await Promise.all([
    readFile(new URL('style.css', root), 'utf8'),
    readFile(new URL('mobile.css', root), 'utf8'),
  ]);
  assert.match(css, /\.visualpicks\[data-picker="fash"\]\s*\{\s*grid-template-columns:\s*repeat\(4,/);
  assert.match(mobile, /\.mobile-attention \.visualpicks\[data-picker="fash"\]\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
});
