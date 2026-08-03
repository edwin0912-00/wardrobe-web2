import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, ui, css, mobileCss, bridge] = await Promise.all([
  readFile(new URL('../b/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
  readFile(new URL('../mobile.css', import.meta.url), 'utf8'),
  readFile(new URL('../adapters/cinematic-ui-bridge.mjs', import.meta.url), 'utf8')
]);

test('client UI stays on its physical owners', () => {
  assert.match(html, /data-ui-ask/);
  assert.match(html, /data-ui-show/);
  assert.match(html, /data-tv-surface/);
  assert.match(html, /data-laptop-surface/);
  assert.doesNotMatch(html, /data-live-invite/, 'Live must not return as bottom chrome');
});

test('persistent chrome can return to the active saved-look library without creating a job', () => {
  assert.match(html, /class="chrome-actions"/);
  assert.match(html, /data-looks/);
  assert.match(html, /window\.journey\.advanceTo\(0\)/);
  assert.match(html, /window\.ui\.openLookLibrary\(\)/);
  assert.match(ui, /openLookLibrary: function \(\)/);
  assert.match(ui, /returning to\n\s*\* the library changes the viewing context, never the server job/i);
  assert.match(css, /\.chrome-actions/);
  assert.match(css, /\.looks:focus-visible/);
});

test('HOW uses the measured laptop journey rather than opening a second window', () => {
  assert.match(html, /data-how/);
  assert.match(html, /window\.journey\.advanceTo\(3\)/);
  assert.match(html, /data-how-reveal/);
  assert.match(css, /\.how:focus-visible/);
  assert.match(css, /laptop-surface\[data-how-reveal="1"\]/);
});

test('portrait mobile promotes one active mirror into a usable attention plane', () => {
  assert.match(html, /href="\.\.\/mobile\.css"/);
  assert.match(html, /data-mobile-attention/);
  assert.match(ui, /matchMedia\('\(max-width: 767px\) and \(orientation: portrait\)'\)/);
  assert.match(ui, /function syncMobileAttention/);
  assert.match(ui, /data-ui-focus/);
  assert.match(ui, /Додати своє фото/);
  assert.match(ui, /role="button" tabindex="0"/);
  assert.match(mobileCss, /@media \(max-width: 767px\) and \(orientation: portrait\)/);
  assert.match(mobileCss, /\.mobile-attention > \.glass/);
  assert.match(mobileCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileCss, /min-height: 48px/);
});

test('portrait mobile promotes a pending first look into the answer mirror', () => {
  const mobileFocus = ui.slice(ui.indexOf('function mobileFocus()'), ui.indexOf('function restorePanel()'));
  const pending = mobileFocus.indexOf('if (pending || pendingAction || actionError) return \'show\';');
  const firstStep = mobileFocus.indexOf("if (step < 2) return 'ask';");

  assert.ok(pending >= 0, 'a submitted first look must have an explicit answer-mirror state');
  assert.ok(firstStep >= 0, 'ordinary first and second steps still use the input mirror');
  assert.ok(
    pending < firstStep,
    'pending must win before the first-look step guard, otherwise the orb is rendered outside the mobile attention plane',
  );
});

test('portrait mobile can return from result actions to the selected look library', () => {
  const mobileFocus = ui.slice(ui.indexOf('function mobileFocus()'), ui.indexOf('function restorePanel()'));
  assert.match(ui, /var mobileLookChooser = false/);
  assert.match(mobileFocus, /if \(mobileLookChooser \|\| pickerKind \|\| awaitingAspect\) return 'ask';/);
  assert.match(ui, /data-open-look-picker/);
  assert.match(ui, /data-close-look-picker/);
  assert.match(mobileCss, /\.mobile-attention \.mobile-look-switch/);
});

test('right mirror owns orb, result actions and the 40-second live expansion', () => {
  assert.match(ui, /function orbWindow/);
  assert.match(ui, /LIVE_MAX_MS\s*=\s*40000/);
  assert.match(html, /data-live-overlay/);
  assert.match(html, /data-live-start/);
  assert.match(css, /\.live-overlay/);
  assert.match(css, /\.orbfield/);
  assert.doesNotMatch(ui, /рендер не підключений/i);
  assert.doesNotMatch(ui, /модел|провайдер|ціна|вартіст/i);
});

test('Real-time Look has one actionable incomplete-look explanation for API handoff', () => {
  assert.match(ui, /LIVE_LOOK_INCOMPLETE_COPY/);
  assert.match(ui, /Збережений аватар \+ одна нова річ/);
  assert.match(ui, /крупне фото обличчя \+ лише капелюх/);
  assert.match(ui, /setLiveError/);
  assert.match(ui, /data-live-return/);
  assert.match(css, /\.orbfield--error/);
});

test('explicit mirror Live may use beta transport while its local camera remains a fallback', () => {
  assert.match(ui, /function startServerLive/);
  assert.match(ui, /import\('\.\/adapters\/live-realtime\.mjs'\)/);
  assert.match(ui, /data-live-start/);
  assert.match(ui, /function canStartServerLive/);
  assert.match(bridge, /function enrichLiveCapability/);
  assert.match(bridge, /loadLiveReference/);
});

test('nothing may be done with a look until its own image exists', () => {
  /* Pre-change proof: the result frame rendered person.main.url — the uploaded portrait —
   * and both the action gate and the forward gate keyed off an elapsed stand-in interval,
   * so four actions were offered under a look that had never been generated. */
  assert.match(ui, /function hasResult\s*\(/, 'a look must be able to say whether it has an image');
  assert.match(ui, /l\.result/, 'the result frame must render the look’s own image');
  assert.doesNotMatch(
    ui,
    /function lookResultFrame\([^)]*\)\s*\{\s*var src = person\.main/,
    'the uploaded photograph must not stand in for a generated look'
  );
  assert.match(ui, /lookVisible\(\)\s*\{[^}]*hasResult\(\)/, 'the action gate must require a result');
  assert.match(ui, /if \(!hasResult\(\)\) return false;/, 'forward travel must require a result');
  assert.match(ui, /setLookResult/, 'only an explicit result may complete a look');
});

test('result presentation keeps a native cutout through profile polling and reserves the compact derivative for thumbnails', () => {
  assert.match(ui, /function mergeHydratedLook/);
  assert.match(ui, /sameApprovedMaster\(previous, fresh\)/);
  assert.match(ui, /localCutoutMatchesMaster\(previous, fresh\)/);
  assert.match(ui, /function currentLookForCutout/);
  assert.match(ui, /var target = currentLookForCutout\(look\)/);
  assert.match(ui, /lookDisplayUrl\(l, 'thumbnail'\)/,
    'the library strip may use a lightweight cutout derivative');
  const display = ui.slice(ui.indexOf('function lookDisplayUrl'), ui.indexOf('function sameApprovedMaster'));
  assert.match(display, /return look\.cutoutNativeUrl \|\| look\.resultUrl/,
    'the large result mirror must prefer the native-resolution transparent master');
  assert.match(display, /surface === 'thumbnail'/,
    'only thumbnail presentation may prefer the compact derivative');
  assert.match(ui, /function isPreviewOnlyImageUrl/,
    'the answer mirror must identify compact URLs before requesting local segmentation');
});

test('a first failed look exposes recovery before the empty-look waiting orb', () => {
  const renderShow = ui.slice(ui.indexOf('function renderShow()'), ui.indexOf('function applyEnabled()'));
  const failure = renderShow.indexOf("if (actionError)");
  const emptyLookWaiting = renderShow.indexOf('if (!pending && !looks.length)');
  const noResultWaiting = renderShow.indexOf('if (!hasResult())');

  assert.ok(failure >= 0, 'the answer mirror needs an explicit failure path');
  assert.ok(emptyLookWaiting >= 0 && noResultWaiting >= 0, 'both normal waiting paths remain');
  assert.ok(
    failure < emptyLookWaiting && failure < noResultWaiting,
    'a terminal failure must render its retry controls before an empty first look can redraw the waiting orb',
  );
  assert.match(renderShow, /failureWindow\(actionError\)/);
  assert.match(ui, /data-retry-action/);
  assert.match(ui, /Спробувати ще/);
  assert.match(ui, /bridgeState\.error && bridgeState\.error\.message/,
    'terminal bridge failure copy must reach the recovery mirror');
  assert.match(ui, /UNSUPPORTED_GARMENT_MEDIA/,
    'a rejected source file must return to the garment picker, not fake a generator retry');
  assert.match(ui, /IMAGE_TOO_SMALL/,
    'a thumbnail rejected by the input contract must return to the picker, not retry generation');
  assert.match(ui, /ПОТРІБНЕ УТОЧНЕННЯ/,
    'input contract failures need a correction state rather than the generic orb');
  assert.match(ui, /Замінити фото/);
  assert.match(ui, /function hydrateUploadedItemPreviews/,
    'accepted run garment previews must replace volatile object-URL thumbnails');
  assert.match(ui, /serverPreview: Boolean/,
    'the UI must identify server previews rather than inventing a recovered source file');
});

test('TV and laptop use the measured surface module', () => {
  assert.match(html, /screen-surface-math\.js/);
  assert.match(html, /screen-surfaces\.js/);
  assert.match(html, /<script src="pipeline-deck\.js"><\/script>/);
  assert.match(html, /pipeline-deck-v2\.html/);
  assert.match(html, /calibrationUrl:\s*'screen-calibration\.json'/);
  assert.match(html, /WardrobePipelineDeck\.create/);
  assert.match(html, /screenSurfaces\.mountLaptop\(pipelineDeck\.host\)/);
  assert.match(html, /pipelineDeck\.onCameraFrame\(frame\)/);
  assert.match(ui, /opts\.onResult/);
  assert.match(css, /\.laptop-surface--fullscreen/);
});

test('television keeps the approved look while an action is in flight and wakes only on delivered media', () => {
  assert.match(ui, /function publishLookPresentation/);
  assert.match(ui, /var display = look\.cutoutPreviewUrl \|\| look\.cutoutNativeUrl \|\| source/,
    'the approved master is the honest TV fallback before a local cutout exists');
  assert.match(ui, /publishLookPresentation\(hydrated\)/,
    'saved looks are sent to the TV shelf during hydration');
  assert.match(ui, /function isDeliveredBridgeResult/);
  assert.match(ui, /bridgeState\.phase === 'completed' && isDeliveredBridgeResult\(bridgeState\.result\)/,
    'no pending 16:9 selection may wake the television');
  assert.match(bridge, /requestedAspect: aspect,\n\s*result: null/,
    'a background selection stays intent metadata rather than a fake result');
});

test('shipped mirror thresholds have an explicit mobile and desktop hysteresis contract', () => {
  assert.match(html, /stationAt:\s*1\.0/);
  assert.match(html, /stationEnter:\s*MOBILE_PORTRAIT \? 0\.88 : 0\.99/);
  assert.match(html, /stationExit:\s*MOBILE_PORTRAIT \? 0\.60 : 0\.81/);
  assert.match(html, /dampFrom:\s*MOBILE_PORTRAIT \? 0\.46 : 0\.78/);
});

test('all missing mirror choice screens exist as one visual component family', () => {
  assert.match(ui, /BACKGROUND_OPTIONS/);
  assert.match(ui, /SHOOT_STYLES/);
  assert.match(ui, /VIDEO_STYLES/);
  assert.match(ui, /data-choice-kind/);
  assert.match(ui, /data-picker-back/);
  assert.match(ui, /data-format-back/);
  assert.match(ui, /data-retry-action/);
  assert.match(ui, /showFailure/);
  assert.match(bridge, /kind:\s*'look'/);
  assert.match(ui, /kind === 'background' \? 'bg'/);
  assert.match(css, /\.visualpicks/);
  assert.match(css, /\.visualpick/);
  assert.match(ui, /visualpick__video/);
  assert.match(css, /data-picker="fash"[\s\S]*aspect-ratio: 3 \/ 4/);
  assert.match(css, /data-picker="bg"[\s\S]*aspect-ratio: 3 \/ 4/);
  assert.match(css, /\.formatpicks/);
  assert.match(css, /\.formatpick/);
});

test('the cinematic UI consumes one neutral bridge without learning API routes or hosts', () => {
  assert.match(ui, /opts\.bridge \|\| global\.WardrobeCinematicBridge/);
  assert.match(ui, /setBridge:\s*bindBridge/);
  assert.match(ui, /import\('\.\/adapters\/cinematic-ui-bridge\.mjs'\)/);
  assert.match(ui, /bridge\.createLook/);
  assert.match(ui, /bridge\.createBackground/);
  assert.match(ui, /bridge\.createShoot/);
  assert.match(ui, /bridge\.createVideo/);
  assert.match(ui, /simulated:\s*false/);
  assert.doesNotMatch(ui, /SIM_MS/);
  assert.doesNotMatch(ui, /beta\.madeforthisjob\.com|site\.madeforthisjob\.com|fetch\(['"`]\/api/);
});
