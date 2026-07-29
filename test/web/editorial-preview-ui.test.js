import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  clientSource,
  sceneUiSource,
  editorialUiSource,
  editorialStateSource,
  appSource,
  indexHtml,
  sceneCss,
] = await Promise.all([
  readFile(new URL('../../web/public/profile-client.js', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/scene-ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/editorial-shoot-ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/editorial-state.js', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/scene.css', import.meta.url), 'utf8'),
]);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('client exposes every profile-owned production editorial route', () => {
  assert.match(clientSource, /\/api\/editorial-modes/);
  assert.match(clientSource, /\/api\/profile\/looks\/\$\{encodeURIComponent\(lookId\)\}\/editorial-shoots/);
  assert.match(clientSource, /mode_id:\s*modeId/);
  assert.match(clientSource, /mode_version:\s*modeVersion/);
  assert.match(clientSource, /'Idempotency-Key':\s*idempotencyKey/);
  for (const route of [
    '/bible',
    '/approve-bible',
    '/approve-hero',
    '/shots/${encodeURIComponent(slot)}/retry',
    '/cancel',
  ]) {
    assert.ok(clientSource.includes(route), `missing editorial route ${route}`);
  }
  assert.match(clientSource, /export function deleteProfileEditorialShoot/);
  assert.match(clientSource, /export function listProfileLookEditorialShoots/);
});

test('catalog is production ACTIVE and only READY modes become controls', () => {
  assert.match(sceneUiSource, /#editorial-mode-grid-new'\)\.replaceChildren\(editorialLoading\)/);
  assert.doesNotMatch(sceneUiSource, /#editorial-mode-grid'\)\.replaceChildren\(editorialLoading\)/);
  const ensureSource = sourceBetween(
    sceneUiSource,
    'async #ensureEditorialModes()',
    '#setPickerTab(tab)',
  );
  assert.match(ensureSource, /response\?\.status !== 'ACTIVE'/);
  assert.match(ensureSource, /response\?\.generation_available !== true/);
  assert.match(ensureSource, /response\.shot_sequence\.length !== 6/);
  assert.match(ensureSource, /mode\?\.generation_available === true[\s\S]*?mode\?\.source_set_status !== 'READY'/);
  const cardSource = sourceBetween(
    sceneUiSource,
    'function createEditorialModeCard(mode, onSelect)',
    'function lookDescriptor(profile, lookId)',
  );
  assert.match(cardSource, /document\.createElement\('button'\)/);
  assert.match(cardSource, /card\.disabled = !ready/);
  assert.match(cardSource, /mode\.source_set_status === 'READY'/);
  assert.match(cardSource, /mode\.generation_available === true/);
  assert.match(cardSource, /addEventListener\('click'/);
  assert.match(sceneUiSource, /mode_id\.startsWith\('shoot\.'\)/);
  assert.doesNotMatch(indexHtml, /Legacy Editorial/);
  assert.doesNotMatch(indexHtml, /editorial-mode-grid-legacy/);
  assert.doesNotMatch(sceneUiSource, /editorial-mode-grid-legacy/);
  assert.match(
    sceneCss,
    /\.editorial-mode-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, minmax\(300px, 1fr\)\);[\s\S]*?grid-auto-rows:\s*168px;/,
  );
  assert.match(sceneCss, /\.editorial-mode-copy > \.editorial-mode-action\s*\{[\s\S]*?display:\s*inline-flex;/);
});

test('Fashion Shoot binds its style pack and keeps the initial identity check internal', () => {
  assert.match(indexHtml, /id="editorial-bible-stage"/);
  assert.match(indexHtml, /id="editorial-style-preview-image"/);
  assert.match(indexHtml, /id="editorial-progress-meter"/);
  assert.match(indexHtml, /id="editorial-approve-bible"[^>]*hidden/);
  assert.match(indexHtml, /id="editorial-approve-bible"[^>]*>Розпочати фотозйомку</);
  assert.match(editorialUiSource, /function modePreviewUrl\(mode\)/);
  assert.match(editorialUiSource, /internal six-slot Bible remains a server artifact/);
  assert.match(editorialUiSource, /shoot\?\.status !== 'BIBLE_PENDING_APPROVAL'/);
  assert.doesNotMatch(editorialUiSource, /#autoApproveBible\(/);
  assert.match(editorialUiSource, /approveBible\.hidden = shoot\?\.status !== 'BIBLE_PENDING_APPROVAL'/);
  assert.match(editorialUiSource, /Розпочати фотозйомку/);
  assert.match(editorialUiSource, /shoot\?\.status !== 'HERO_PENDING_APPROVAL'/);
  assert.match(editorialUiSource, /expected_bible_sha256|expectedBibleSha256/);
  assert.match(editorialUiSource, /expected_output_sha256|expectedOutputSha256/);
  assert.match(editorialUiSource, /async #autoApproveHero\(\)/);
  assert.match(editorialUiSource, /INTERNAL_STYLE_CHECK_SLOT = 'clean_identity_hero'/);
  assert.match(sceneCss, /\.editorial-style-preview\s*\{[\s\S]*?aspect-ratio:\s*4 \/ 5;/);
  assert.match(sceneCss, /\.editorial-bible-stage\[hidden\],\s*\.editorial-gallery-stage\[hidden\]\s*\{\s*display:\s*none !important;/);
  assert.match(sceneCss, /\.editorial-start-shoot\s*\{[\s\S]*?animation:\s*editorial-start-pulse/);
});

test('shoot survives reload and replays only persisted idempotent actions', () => {
  assert.match(editorialStateSource, /zeely_active_editorial_shoot_v1/);
  assert.match(editorialStateSource, /approve_bible/);
  assert.match(editorialStateSource, /approve_hero/);
  assert.match(editorialStateSource, /retry_shot/);
  assert.match(editorialUiSource, /new URLSearchParams\(location\.search\)\.get\('shoot'\)/);
  assert.match(editorialUiSource, /#replayPendingAction\(\)/);
  assert.match(editorialUiSource, /pending_action:\s*action/);
  const preboot = indexHtml.match(/<script>try\{[\s\S]*?<\/script>/)?.[0] ?? '';
  assert.match(preboot, /q\.has\('shoot'\)/);
  assert.match(preboot, /zeely_active_editorial_shoot_v1/);
  assert.match(appSource, /queryShootId/);
});

test('generation uses SSE with polling fallback and keeps per-shot retry isolated', () => {
  assert.match(
    editorialUiSource,
    /\/api\/profile\/editorial-shoots\/\$\{encodeURIComponent\(shootId\)\}\/events/,
  );
  assert.match(editorialUiSource, /source\.addEventListener\('shoot'/);
  assert.match(editorialUiSource, /source\.addEventListener\('editorial-shoot'/);
  assert.match(editorialUiSource, /#beginPolling\(shootId\)/);
  assert.match(editorialUiSource, /shot\.status === 'FAILED'/);
  assert.match(editorialUiSource, /retryProfileEditorialShot\(this\.shoot\.shoot_id, slot/);
});

test('gallery exposes five Fashion Shoot frames, not its internal style check', () => {
  assert.match(indexHtml, /id="editorial-gallery"[^>]*aria-label="Кадри Fashion Shoot"/);
  const portraitStart = sceneCss.lastIndexOf('@media (max-width: 700px) and (orientation: portrait)');
  const portraitCss = sceneCss.slice(portraitStart);
  assert.match(
    portraitCss,
    /\.editorial-gallery\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,[\s\S]*?grid-template-rows:\s*repeat\(3,/,
  );
  assert.match(portraitCss, /\.editorial-controls \.scene-control\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(sceneCss, /\.editorial-shot-retry\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(sceneCss, /\.editorial-shot-download\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  assert.match(sceneCss, /\.editorial-shot-visual img\s*\{[\s\S]*?object-fit:\s*contain;/);
  assert.match(indexHtml, /id="editorial-shot-inspector"/);
  assert.match(editorialUiSource, /className = 'editorial-shot-inspect'/);
  assert.match(editorialUiSource, /dialog\.showModal\(\)/);
  assert.match(editorialUiSource, /function fashionFrames\(shoot\)/);
  assert.match(editorialUiSource, /\.filter\(\(shot\) => shot\?\.slot !== INTERNAL_STYLE_CHECK_SLOT\)/);
  assert.match(editorialUiSource, /Готово: \$\{completed\} з 5/);
  assert.match(editorialUiSource, /editorial-progress-meter/);
  assert.doesNotMatch(editorialUiSource, /Кадр \$\{String\(index \+ 1\)/);
  assert.doesNotMatch(editorialUiSource, /Кадр у черзі/);
  assert.match(
    portraitCss,
    /body\.workflow-active\.scene-active\s*\{[\s\S]*?height:\s*100svh;[\s\S]*?overflow:\s*hidden;/,
  );
});

test('saved-look library can reopen server-backed editorial shoots', () => {
  assert.match(indexHtml, /Fashion-фотосесії цього образу/);
  assert.match(indexHtml, /id="profile-look-editorial-list"/);
  assert.match(appSource, /function editorialShootsForLook\(profile, look, supplied = null\)/);
  assert.match(appSource, /listProfileLookEditorialShoots\(requestedLookId\)/);
  assert.match(appSource, /profileEditorialRequestVersion !== editorialRequestVersion/);
  assert.doesNotMatch(appSource, /if \(!hasEmbeddedEditorial\)/);
  assert.match(
    appSource,
    /\[\.\.\.topLevel,\s*\.\.\.\(Array\.isArray\(nested\) \? nested : \[\]\)\]/,
  );
  assert.match(appSource, /sceneUi\.openExistingEditorial\(shoot, look\)/);
  assert.match(sceneUiSource, /openExistingEditorial\(projection, look\)/);
});

test('normal editorial states render controlled Ukrainian copy instead of raw service messages', () => {
  const renderSource = sourceBetween(
    editorialUiSource,
    '  #renderShoot() {',
    '  #renderBible() {',
  );
  assert.match(editorialUiSource, /function displayShootMessage\(shoot\)/);
  assert.match(editorialUiSource, /Створюємо п’ять унікальних fashion-кадрів паралельно по два/);
  assert.match(editorialUiSource, /displayShootMessage\(this\.shoot\)/);
  assert.doesNotMatch(renderSource, /shoot\.message/);
});

test('standard scene workflow remains present beside Fashion Shoot', () => {
  // The counts must not be baked into the markup: the catalog grew from five to
  // sixteen standard presets and the tab kept saying five. The labels are neutral
  // in HTML and filled from the same data the grids render from.
  assert.match(indexHtml, />Стандартні сцени<\/button>/);
  assert.match(indexHtml, />Fashion Shoot<\/button>/);
  assert.doesNotMatch(indexHtml, /\d+ стандартних сцен<\/button>/);
  assert.match(sceneUiSource, /standardTab\.textContent = this\.presets\.length/);
  assert.match(sceneUiSource, /const fashionModes = this\.editorialModes\.filter\(\(mode\) => mode\.mode_id\.startsWith\('shoot\.'\)\)/);
  assert.match(sceneUiSource, /editorialTab\.textContent = fashionModes\.length/);
  assert.match(sceneUiSource, /function ukPlural\(/);
  assert.match(sceneUiSource, /createProfileScene/);
  assert.match(sceneUiSource, /loadProfileScene/);
  assert.match(sceneUiSource, /retryProfileScene/);
  assert.match(sceneUiSource, /cancelProfileScene/);
  assert.match(sceneUiSource, /deleteProfileScene/);
});
