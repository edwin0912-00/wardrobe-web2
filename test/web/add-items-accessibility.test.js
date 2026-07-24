import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [experienceCss, conflictCss, indexHtml] = await Promise.all([
  readFile(new URL('../../web/public/experience.css', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/conflict.css', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/index.html', import.meta.url), 'utf8'),
]);

function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...experienceCss.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))];
  const match = matches.at(-1);
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

test('dedicated add-items form is the bounded fallback scroll container', () => {
  const rule = declarations('body.add-items-active .studio-grid > .form-panel[data-mode="add-items"]');
  assert.match(rule, /height:\s*auto/);
  assert.match(rule, /max-height:\s*100%/);
  assert.match(rule, /overflow-y:\s*auto/);
  assert.match(rule, /overscroll-behavior-y:\s*contain/);
});

test('hidden garment input exposes a visible focus-within treatment', () => {
  const rule = declarations('.form-panel[data-mode="add-items"] .upload-card:focus-within');
  assert.match(rule, /outline:\s*3px solid/);
  assert.match(rule, /outline-offset:\s*2px/);
  assert.match(
    indexHtml,
    /<label class="upload-card wardrobe-card">\s*<input id="garment-images"/,
  );
});

test('add-items remove and consent controls retain usable mobile targets', () => {
  const removeRule = declarations('.form-panel[data-mode="add-items"] .garment-preview .remove-file');
  assert.match(removeRule, /min-width:\s*26px/);
  assert.match(removeRule, /min-height:\s*26px/);

  const consentRule = declarations('.form-panel[data-mode="add-items"] > .consent');
  assert.match(consentRule, /min-height:\s*36px/);
  assert.match(consentRule, /cursor:\s*pointer/);
  assert.match(
    indexHtml,
    /<label class="consent"><input type="checkbox" name="consent" required>/,
  );
});

test('duplicate-item resolution keeps every mobile action at touch size', () => {
  assert.match(
    conflictCss,
    /@media \(max-width: 700px\) and \(orientation: portrait\)[\s\S]*?\.conflict-continue\s*\{[\s\S]*?min-height:\s*44px;/,
  );
  assert.match(
    experienceCss,
    /@media \(max-width: 700px\) and \(orientation: portrait\)[\s\S]*?\.failure-actions \.secondary-button\s*\{[\s\S]*?min-height:\s*44px;/,
  );
});
