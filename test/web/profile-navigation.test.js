import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [appSource, indexHtml, resultCss] = await Promise.all([
  readFile(new URL('../../web/public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../web/public/result.css', import.meta.url), 'utf8'),
]);

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = nextName ? appSource.indexOf(`function ${nextName}(`, start + 1) : -1;
  assert.notEqual(end, -1, `missing boundary function ${nextName}`);
  return appSource.slice(start, end);
}

test('profile exposes an explicit Back control and clear next actions', () => {
  assert.match(
    indexHtml,
    /<button id="profile-back"[^>]*aria-label="Повернутися назад"[^>]*>[\s\S]*?Назад[\s\S]*?<\/button>/,
  );
  assert.match(
    indexHtml,
    /<button id="profile-look-add"[^>]*>Новий окремий образ<\/button>/,
  );
  // 914ebf6 replaced the single «Створити сцену» button with the action set;
  // 1e8ccef made those actions label-free, so intent lives in aria-label.
  assert.match(
    indexHtml,
    /<button id="profile-look-background-primary"[^>]*aria-label="Додати стандартний фон"/,
  );
  assert.match(
    indexHtml,
    /<button id="profile-look-photoshoot"[^>]*aria-label="Відкрити Fashion Shoot"/,
  );
  assert.match(
    indexHtml,
    /<button id="profile-look-delete"[^>]*aria-label="Видалити збережений образ"[^>]*>×<\/button>/,
  );
  assert.match(
    indexHtml,
    /<button id="add-look"[^>]*>Новий образ з цим аватаром<\/button>/,
  );
  assert.doesNotMatch(indexHtml, />Додати речі<\/button>/);
  assert.match(indexHtml, /id="profile-look-add-explainer"[\s\S]*?окремий образ[\s\S]*?не зміниться/);
});

test('Back restores the previous in-app view without resetting draft files', () => {
  const source = functionSource('restoreProfileReturnView', 'selectProfileAvatar');
  assert.match(source, /restoreProfileReturnState\(profileReturnState, \{/);
  assert.match(source, /restorePanel: \(target\) => \{/);
  assert.doesNotMatch(source, /beginDraft|clearDraft|clearServerDraft|uploads\.reset|form\.reset/);
});

test('avatar and look cards are native, stateful selection controls', () => {
  assert.match(appSource, /selector\.type = 'button'/);
  assert.match(appSource, /selector\.className = 'profile-avatar-select'/);
  assert.match(appSource, /selector\.setAttribute\('aria-pressed', String\(active\)\)/);
  assert.match(appSource, /selector\.setAttribute\('aria-controls', 'profile-look-grid'\)/);
  assert.match(appSource, /open\.type = 'button'/);
  assert.match(appSource, /open\.className = 'profile-look-open'/);
  assert.match(appSource, /open\.setAttribute\('aria-expanded', String\(active\)\)/);
  assert.match(appSource, /open\.setAttribute\('aria-controls', 'profile-look-detail'\)/);
});

test('avatar selection opens its newest own look without starting or clearing work', () => {
  const source = functionSource('selectProfileAvatar', 'openProfileLook');
  assert.match(source, /const transition = resolveSavedAvatarTransition\(profile, avatar\);/);
  assert.match(source, /await executeSavedAvatarTransition\(transition, \{/);
  assert.match(source, /openLook: \(look\) => openProfileLook\(profile, look\)/);
  assert.match(source, /filterAvatar: async \(avatarId\) => \{/);
  assert.match(source, /renderProfile\(profile\)/);
  assert.doesNotMatch(source, /beginDraft|clearDraft|clearServerDraft|uploads\.reset|form\.reset/);
});

test('look continuation is bound to the exact resolved owner and child actions do not bubble', () => {
  assert.match(appSource, /const selection = resolveProfileLookSelection\(profile, look\)/);
  assert.match(
    appSource,
    /continueAddItemsFromSelection\(selectedProfileLookSelection, beginDraft\)/,
  );
  assert.ok(
    (appSource.match(/event\.stopPropagation\(\)/g) ?? []).length >= 7,
    'all nested profile actions must stop click propagation',
  );
});

test('selected look exposes its persisted scene library through native controls', () => {
  assert.match(indexHtml, /<section id="profile-look-scenes"[^>]*aria-labelledby="profile-look-scenes-title"/);
  assert.match(indexHtml, /<ul id="profile-look-scene-list" class="profile-look-scene-list"><\/ul>/);
  assert.match(indexHtml, /id="profile-look-scenes-count" aria-live="polite"/);
  const source = functionSource('renderProfileSceneLibrary', 'renderProfile');
  assert.match(source, /const scenes = scenesForLook\(look\)/);
  assert.match(source, /open\.type = 'button'/);
  assert.match(source, /open\.setAttribute\('aria-label', `Відкрити \$\{title\.textContent\}\. Статус:/);
  assert.match(source, /sceneUi\.openExisting\(scene, look\)/);
  // The #profile-look-scene button is gone (914ebf6); the renderer must not
  // dereference it — that null crashed the saved-look panel in production.
  assert.doesNotMatch(source, /#profile-look-scene'/);
  assert.doesNotMatch(source, /createButton/);
});

test('an open mobile look becomes the active full-height screen instead of clipping its scenes', () => {
  assert.match(
    appSource,
    /profileLibrary\?\.classList\.toggle\('has-open-look', Boolean\(selectedProfileLookSelection\)\)/,
  );
  assert.match(
    resultCss,
    /\.profile-library\.has-open-look \{[\s\S]*?grid-template-rows:\s*54px minmax\(0, 1fr\);/,
  );
  assert.match(
    resultCss,
    /\.profile-library\.has-open-look > :is\(\.profile-avatar-list, \.profile-section-head, \.profile-danger-zone\) \{[\s\S]*?display:\s*none;/,
  );
  assert.match(
    resultCss,
    /\.profile-library\.has-open-look \.profile-look-detail-copy \{[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    resultCss,
    /\.profile-library\.has-open-look \.profile-look-detail-actions[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 44px;/,
  );
});

test('saved look is one compact action hub without nested guides or forced scrolling', () => {
  const openLookSource = functionSource('openProfileLook', 'renderProfileSceneLibrary');
  assert.doesNotMatch(openLookSource, /scrollIntoView/);
  assert.doesNotMatch(indexHtml, /class="profile-action-guide"/);
  assert.doesNotMatch(indexHtml, /class="profile-branch-brief/);
  assert.match(
    resultCss,
    /\.profile-action-copy strong \{[\s\S]*?overflow:\s*visible;[\s\S]*?text-overflow:\s*clip;[\s\S]*?white-space:\s*normal;/,
  );
});

test('Video and Real-time Look use full-viewport single surfaces without nested scrolling', () => {
  assert.doesNotMatch(resultCss, /\.profile-live-overlay iframe/);
  assert.match(resultCss, /\.profile-live-overlay \{[\s\S]*?inset:\s*0;[\s\S]*?place-items:\s*stretch;[\s\S]*?padding:\s*0;/);
  const videoSurface = resultCss.slice(
    resultCss.indexOf('.video-overlay-content {'),
    resultCss.indexOf('.video-overlay-header {'),
  );
  assert.match(videoSurface, /width:\s*100%/);
  assert.match(videoSurface, /height:\s*100dvh/);
  assert.match(videoSurface, /overflow:\s*hidden/);
  assert.match(videoSurface, /border-radius:\s*0/);
  assert.match(videoSurface, /box-shadow:\s*none/);
  assert.doesNotMatch(videoSurface, /max-height|overflow-y/);
});

test('a short desktop look reserves its remaining height for the compact action grid', () => {
  const shortDesktop = resultCss.slice(resultCss.indexOf('@media (min-width: 701px) and (max-height: 950px)'));
  assert.match(
    shortDesktop,
    /\.profile-library\.has-open-look \.profile-look-next \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/,
  );
  assert.match(
    shortDesktop,
    /\.profile-library\.has-open-look \.profile-look-next-actions \{[\s\S]*?grid-template-rows:\s*repeat\(3, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    shortDesktop,
    /\.profile-library\.has-open-look \.profile-look-detail-actions \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 44px;/,
  );
});

test('profile mobile copy and controls retain readable type and touch targets', () => {
  assert.match(resultCss, /\.profile-back,[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
  assert.match(
    resultCss,
    /\.profile-item-actions \.primary-result-action,[\s\S]*?min-height:\s*44px;[\s\S]*?font-size:\s*12px;/,
  );
  assert.match(
    resultCss,
    /\.profile-look-detail-actions :is\([^)]*\)[\s\S]*?min-height:\s*44px;[\s\S]*?font-size:\s*12px;/,
  );
  assert.match(
    resultCss,
    /\.profile-page-button \{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?font-size:\s*14px;/,
  );
  assert.match(
    resultCss,
    /\.profile-item-actions \.profile-delete-action,[\s\S]*?flex:\s*0 0 70px;[\s\S]*?min-width:\s*70px;/,
  );
  assert.match(
    resultCss,
    /\.profile-look-scene-open \{[\s\S]*?min-height:\s*68px;[\s\S]*?cursor:\s*pointer;/,
  );
});
