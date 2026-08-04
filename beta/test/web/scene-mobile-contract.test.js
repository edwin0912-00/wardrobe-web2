import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const sceneCss = await readFile(path.join(root, 'web/public/scene.css'), 'utf8');
const portraitStart = sceneCss.indexOf('@media (max-width: 700px) and (orientation: portrait)');
const narrowStart = sceneCss.indexOf('@media (max-width: 340px) and (orientation: portrait)', portraitStart);
const portraitCss = sceneCss.slice(portraitStart, narrowStart);

test('portrait scene workflow keeps primary controls at mobile touch size', () => {
  assert.ok(portraitStart >= 0 && narrowStart > portraitStart);
  assert.match(
    portraitCss,
    /\.scene-back\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  );
  assert.match(
    portraitCss,
    /\.scene-text-button,[\s\S]*?\.scene-control\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?font-size:\s*10px;/,
  );
  assert.match(
    portraitCss,
    /\.scene-output a\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?font-size:\s*10px;/,
  );
});

test('five-card scene picker is readable without document scrolling', () => {
  assert.match(
    portraitCss,
    /\.scene-picker\s*\{[\s\S]*?grid-template-rows:\s*68px 50px minmax\(0, auto\) minmax\(0, 1fr\);[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    portraitCss,
    /\.scene-preset-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,[\s\S]*?grid-template-rows:\s*repeat\(3,/,
  );
  assert.match(portraitCss, /\.scene-preset-copy small\s*\{\s*font-size:\s*9px;/);
  assert.match(portraitCss, /\.scene-preset-copy strong\s*\{[\s\S]*?font-size:\s*11px;/);
  assert.match(portraitCss, /\.scene-preset-copy em\s*\{[\s\S]*?font-size:\s*9px;/);
  assert.doesNotMatch(portraitCss, /font-size:\s*[4-7](?:\.\d+)?px/);
});
