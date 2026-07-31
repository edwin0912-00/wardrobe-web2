import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  editorialGalleryProgress,
  editorialShotProgress,
} from '../../web/public/editorial-shoot-ui.js';

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
    'function createEditorialModeCard(mode, onSelect, { eager = false } = {})',
    'function lookDescriptor(profile, lookId)',
  );
  assert.match(cardSource, /document\.createElement\('button'\)/);
  assert.match(cardSource, /card\.disabled = !ready/);
  assert.match(cardSource, /mode\.source_set_status === 'READY'/);
  assert.match(cardSource, /mode\.generation_available === true/);
  assert.match(cardSource, /image\.loading = eager \? 'eager' : 'lazy'/);
  assert.match(cardSource, /if \(eager\) image\.fetchPriority = 'high'/);
  assert.match(cardSource, /addEventListener\('click'/);
  assert.match(sceneUiSource, /createEditorialModeCard\(mode, onSelect, \{ eager: index < 4 \}\)/);
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
  assert.doesNotMatch(preboot, /zeely_active_editorial_shoot_v1/);
  assert.match(appSource, /queryShootId/);
});

test('generation uses SSE with polling fallback and keeps repair automatic and per-shot', () => {
  assert.match(
    editorialUiSource,
    /\/api\/profile\/editorial-shoots\/\$\{encodeURIComponent\(shootId\)\}\/events/,
  );
  assert.match(editorialUiSource, /source\.addEventListener\('shoot'/);
  assert.match(editorialUiSource, /source\.addEventListener\('editorial-shoot'/);
  assert.match(editorialUiSource, /#beginPolling\(shootId\)/);
  assert.match(editorialUiSource, /NEEDS_RETRY:\s*'ПОТРІБЕН ПОВТОР'/);
  assert.doesNotMatch(editorialUiSource, /retry\.textContent = 'Повторити кадр'/);
  assert.match(editorialUiSource, /this\.retryShot\(failed\.slot\)/);
  assert.doesNotMatch(editorialStateSource, /status === 'NEEDS_RETRY'\) return 'failed'/);
});

test('Fashion Shoot makes the internal hero gate and every customer-frame state visible', () => {
  const preflight = editorialGalleryProgress({
    status: 'HERO_RUNNING',
    phase: 'HERO_GENERATION',
    shots: [
      { slot: 'clean_identity_hero', status: 'RUNNING', retry_count: 1 },
      { slot: 'environmental_hero', status: 'BLOCKED', retry_count: 0 },
      { slot: 'sculptural_three_quarter', status: 'BLOCKED', retry_count: 0 },
      { slot: 'interference_frame', status: 'BLOCKED', retry_count: 0 },
      { slot: 'material_or_accessory_detail', status: 'BLOCKED', retry_count: 0 },
      { slot: 'wide_campaign_coda', status: 'BLOCKED', retry_count: 0 },
    ],
  });
  assert.equal(preflight.preflight, true);
  assert.equal(preflight.completed, 0);
  assert.equal(preflight.running, 0);
  assert.equal(preflight.queued, 5);
  assert.match(preflight.headline, /Внутрішня перевірка образу/);
  assert.match(preflight.stage, /контрольний hero/);
  assert.match(preflight.detail, /автоповтор №1/);

  const series = editorialGalleryProgress({
    status: 'SERIES_RUNNING',
    phase: 'SERIES_GENERATION',
    shots: [
      { slot: 'clean_identity_hero', status: 'APPROVED', retry_count: 0 },
      { slot: 'environmental_hero', status: 'APPROVED', retry_count: 0 },
      { slot: 'sculptural_three_quarter', status: 'RUNNING', retry_count: 0 },
      { slot: 'interference_frame', status: 'RUNNING', retry_count: 1 },
      { slot: 'material_or_accessory_detail', status: 'QUEUED', retry_count: 0 },
      { slot: 'wide_campaign_coda', status: 'QUEUED', retry_count: 1 },
    ],
  });
  assert.equal(series.preflight, false);
  assert.equal(series.completed, 1);
  assert.equal(series.running, 2);
  assert.equal(series.queued, 2);
  assert.match(series.headline, /Готово: 1 з 5/);
  assert.match(series.detail, /2 створюються/);
  assert.match(series.detail, /2 у черзі/);
  assert.equal(
    editorialShotProgress({ status: 'QUEUED', retry_count: 1 }, { preflight: false }),
    'Автоматично допрацьовуємо окремо · повтор №1',
  );
  assert.equal(
    editorialShotProgress({ status: 'BLOCKED', retry_count: 0 }, { preflight: true }),
    'Очікує внутрішню перевірку образу',
  );

  assert.match(indexHtml, /id="editorial-progress-announce"[^>]*role="status"/);
  assert.match(editorialUiSource, /className = 'editorial-shot-meta'/);
  assert.match(editorialUiSource, /gallery\.setAttribute\('aria-busy'/);
  assert.match(sceneCss, /\.editorial-shot-meta\s*\{/);
  const connectingSource = sourceBetween(
    editorialUiSource,
    '  #showConnecting(phase, message) {',
    '  #showConnectionFailure(error, stage) {',
  );
  assert.match(connectingSource, /#renderGalleryCards\(/);
  assert.doesNotMatch(connectingSource, /editorial-gallery'\)\.replaceChildren\(\)/);
  const renderSource = sourceBetween(
    editorialUiSource,
    '  #renderShoot() {',
    '  #renderBible() {',
  );
  assert.doesNotMatch(renderSource, /#editorial-phase'\)\.hidden = true/);
  assert.doesNotMatch(renderSource, /#editorial-connection'\)\.hidden = true/);
});

test('Fashion Shoot progress never reports a stopped or legacy failed job as live work', () => {
  const cancelled = editorialGalleryProgress({
    status: 'CANCELLED',
    phase: 'CANCELLED',
    shots: [
      { slot: 'clean_identity_hero', status: 'APPROVED', retry_count: 0 },
      { slot: 'environmental_hero', status: 'APPROVED', retry_count: 0 },
      { slot: 'sculptural_three_quarter', status: 'CANCELLED', retry_count: 0 },
      { slot: 'interference_frame', status: 'CANCELLED', retry_count: 0 },
      { slot: 'material_or_accessory_detail', status: 'CANCELLED', retry_count: 0 },
      { slot: 'wide_campaign_coda', status: 'CANCELLED', retry_count: 0 },
    ],
  });
  assert.equal(cancelled.active, false);
  assert.equal(cancelled.indeterminate, false);
  assert.match(cancelled.headline, /Фотосесію зупинено/);
  assert.match(cancelled.stage, /Збережено 1 з 5/);
  assert.doesNotMatch(cancelled.detail, /наступн/);

  const exhausted = editorialGalleryProgress({
    status: 'NEEDS_RETRY',
    phase: 'SHOT_RETRY',
    shots: [
      { slot: 'clean_identity_hero', status: 'APPROVED', retry_count: 0 },
      { slot: 'environmental_hero', status: 'APPROVED', retry_count: 0 },
      { slot: 'sculptural_three_quarter', status: 'FAILED', retry_count: 5, auto_repair_exhausted: true },
      { slot: 'interference_frame', status: 'FAILED', retry_count: 5, auto_repair_exhausted: true },
      { slot: 'material_or_accessory_detail', status: 'FAILED', retry_count: 5, auto_repair_exhausted: true },
      { slot: 'wide_campaign_coda', status: 'FAILED', retry_count: 5, auto_repair_exhausted: true },
    ],
  });
  assert.equal(exhausted.active, false);
  assert.equal(exhausted.indeterminate, false);
  assert.match(exhausted.stage, /Потрібна серверна діагностика/);
  assert.doesNotMatch(exhausted.detail, /запускаються окремо автоматично/);
  assert.equal(
    editorialShotProgress({
      status: 'FAILED',
      retry_count: 5,
      auto_repair_exhausted: true,
    }, { preflight: false }),
    'Потрібна серверна діагностика',
  );

  const exhaustedHero = editorialGalleryProgress({
    status: 'NEEDS_RETRY',
    phase: 'HERO_NEEDS_RETRY',
    shots: [
      { slot: 'clean_identity_hero', status: 'FAILED', retry_count: 5, auto_repair_exhausted: true },
      { slot: 'environmental_hero', status: 'BLOCKED', retry_count: 0 },
      { slot: 'sculptural_three_quarter', status: 'BLOCKED', retry_count: 0 },
      { slot: 'interference_frame', status: 'BLOCKED', retry_count: 0 },
      { slot: 'material_or_accessory_detail', status: 'BLOCKED', retry_count: 0 },
      { slot: 'wide_campaign_coda', status: 'BLOCKED', retry_count: 0 },
    ],
  });
  assert.equal(exhaustedHero.active, false);
  assert.match(exhaustedHero.stage, /Потрібна серверна діагностика контрольного hero/);
  assert.doesNotMatch(exhaustedHero.detail, /почнуться одразу/);

  const failureSource = sourceBetween(
    editorialUiSource,
    '  #showConnectionFailure(error, stage) {',
    '  hasResumeForLook(lookId) {',
  );
  assert.match(failureSource, /progressWrap\.classList\.remove\('is-active', 'is-indeterminate'\)/);
  assert.match(failureSource, /gallery\.setAttribute\('aria-busy', 'false'\)/);
  assert.match(editorialUiSource, /\['QUEUED', 'RUNNING'\]\.includes\(shot\.status\)/);
  assert.doesNotMatch(editorialUiSource, /\['BLOCKED', 'QUEUED', 'RUNNING'\]\.includes\(shot\.status\)/);
  const autoHeroSource = sourceBetween(
    editorialUiSource,
    '  async #autoApproveHero() {',
    '  async retryShot(slot) {',
  );
  assert.match(autoHeroSource, /const approved = await this\.approveHero\(\)/);
  assert.match(autoHeroSource, /if \(!approved\) this\.autoHeroApproved = false/);
});

test('Fashion Shoot progress assets advance one cache-busted module chain', () => {
  assert.match(indexHtml, /scene\.css\?v=20260731-3/);
  assert.match(indexHtml, /app\.js\?v=20260731-3/);
  assert.match(appSource, /scene-ui\.js\?v=20260731-3/);
  assert.match(sceneUiSource, /editorial-shoot-ui\.js\?v=20260731-3/);
});

test('gallery exposes five Fashion Shoot frames, not its internal style check', () => {
  assert.match(indexHtml, /id="editorial-gallery"[^>]*aria-label="Кадри Fashion Shoot"/);
  const portraitStart = sceneCss.lastIndexOf('@media (max-width: 700px) and (orientation: portrait)');
  const portraitCss = sceneCss.slice(portraitStart);
  assert.match(
    portraitCss,
    /\.editorial-gallery\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,[\s\S]*?grid-template-rows:\s*none;/,
  );
  assert.match(portraitCss, /\.editorial-active-state canvas\s*\{[\s\S]*?width:\s*54px;[\s\S]*?height:\s*54px;/);
  assert.match(
    sceneCss,
    /\.editorial-gallery-stage > \.editorial-controls\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;/,
  );
  assert.match(portraitCss, /\.editorial-controls \.scene-control\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(sceneCss, /\.editorial-shot-download\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  assert.match(sceneCss, /\.editorial-shot-visual img\s*\{[\s\S]*?object-fit:\s*contain;/);
  assert.match(indexHtml, /id="editorial-shot-inspector"/);
  assert.match(editorialUiSource, /className = 'editorial-shot-inspect'/);
  assert.match(editorialUiSource, /dialog\.showModal\(\)/);
  assert.match(editorialUiSource, /function fashionFrames\(shoot\)/);
  assert.match(editorialUiSource, /\.filter\(\(shot\) => shot\?\.slot !== INTERNAL_STYLE_CHECK_SLOT\)/);
  assert.match(editorialUiSource, /\$\{completed\} з 5 готово · створюємо далі/);
  assert.match(editorialUiSource, /editorial-progress-meter/);
  assert.match(editorialUiSource, /editorialShotLabel\(shot\.slot\)/);
  assert.match(editorialUiSource, /editorialShotProgress\(shot, progress\)/);
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

test('plain homepage never auto-opens a stored scene or Fashion Shoot', () => {
  assert.match(
    appSource,
    /if \(\(queryShootId \|\| querySceneId\) && await sceneUi\.resume\(\{ allowStored: false \}\)\)/,
  );
  assert.doesNotMatch(appSource, /queryShootId \|\| querySceneId \|\| !queryRunId/);
  assert.match(sceneUiSource, /async resume\(\{ allowStored = true \} = \{\}\)/);
  assert.match(sceneUiSource, /queryShootId && await this\.editorialUi\.resume\(\{ allowStored: false \}\)/);
  assert.doesNotMatch(
    indexHtml,
    /localStorage\.getItem\('zeely_active_editorial_shoot_v1'\)/,
  );
  assert.doesNotMatch(
    indexHtml,
    /localStorage\.getItem\('zeely_active_scene_v1'\)/,
  );
});

test('normal editorial states render controlled Ukrainian copy instead of raw service messages', () => {
  const renderSource = sourceBetween(
    editorialUiSource,
    '  #renderShoot() {',
    '  #renderBible() {',
  );
  assert.match(editorialUiSource, /function displayShootMessage\(shoot\)/);
  assert.match(editorialUiSource, /Створюємо всі п’ять унікальних fashion-кадрів паралельно/);
  assert.match(editorialUiSource, /editorialGalleryProgress\(this\.shoot\)/);
  assert.doesNotMatch(editorialUiSource, /паралельно по два/);
  assert.match(indexHtml, /id="editorial-progress-detail"/);
  assert.doesNotMatch(renderSource, /shoot\.message/);
});

test('Fashion Shoot loading keeps the branded orb and portrait photo geometry', () => {
  assert.match(indexHtml, /id="editorial-thinking-orb"/);
  assert.match(indexHtml, /id="editorial-series-progress" aria-live="polite"/);
  assert.match(editorialUiSource, /function displaySeriesProgress\(\{ completed, visibleFrames \}\)/);
  assert.match(editorialUiSource, /#renderGalleryCards\(shots, progress\)/);
  assert.match(editorialUiSource, /classList\.remove\('is-awaiting-first-frame'\)/);
  assert.match(editorialUiSource, /className = 'editorial-shot-pending'/);
  assert.match(sceneCss, /\.editorial-active-state canvas\s*\{[\s\S]*?width:\s*72px;[\s\S]*?height:\s*72px;/);
  assert.match(
    sceneCss,
    /\.editorial-gallery-stage\.is-awaiting-first-frame \.editorial-active-state canvas\s*\{[\s\S]*?width:\s*184px;[\s\S]*?height:\s*184px;/,
  );
  assert.match(
    sceneCss,
    /\.editorial-gallery-stage\.is-awaiting-first-frame \.editorial-gallery\s*\{[\s\S]*?display:\s*none;/,
  );
  assert.match(sceneCss, /\.editorial-gallery\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,/);
  assert.match(sceneCss, /\.editorial-shot-card\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*5;/);
  assert.match(sceneCss, /\.editorial-master-strip img\s*\{[\s\S]*?width:\s*76px;[\s\S]*?height:\s*90px;/);
});

test('a stopped Fashion Shoot exposes a real retry instead of pretending to keep working', () => {
  assert.match(indexHtml, /id="editorial-retry-failed"/);
  assert.match(editorialUiSource, /NEEDS_RETRY: 'ПОТРІБЕН ПОВТОР'/);
  assert.match(editorialUiSource, /'Повторити перший кадр'/);
  assert.match(editorialUiSource, /this\.retryShot\(failed\.slot\)/);
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
