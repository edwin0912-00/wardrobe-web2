/* WARDROBE — the interface in the apartment.
 *
 * Canon: LEVEL-DESIGN.md, fixed by the owner 2026-07-28. Read that first; this file
 * implements it and nothing more.
 *
 * WHERE THINGS HAPPEN. One continuous drive, and each station is a PLACE, not a screen:
 *
 *   assembly         the room builds itself. No controls — this is the titles.
 *   empty rails      choose the PERSON: yourself. Up to two photographs.
 *   rail of clothes  choose the THINGS, where the things physically hang.
 *   two mirrors      the look, and everything that can be done with it.
 *   television       the GALLERY of finished work. Not a step in the flow.
 *   laptop           the pipeline as a live page.
 *
 * NOTHING IS SOLD HERE. No prices, no basket, no "order". The verbs are згенерувати,
 * приміряти, подивитись. The previous build had a filled button reading "Замовити
 * фотосесію", which invented a transaction this product does not have.
 *
 * THERE CAN BE SEVERAL LOOKS, and the selected one is the context for everything else —
 * change its background, shoot it, wear it live. Actions appear ONLY once a look with
 * things in it is visible: before that the viewer may still want to change the things and
 * look again, so offering to shoot it would be offering to shoot nothing.
 *
 * TWO MIRRORS, TWO JOBS. Left asks, right shows — the look, or the shoot, or the live view.
 * The concrete pier between them is the divider, so the split is real architecture rather
 * than a layout decision.
 *
 * REAL RESULTS ONLY. The neutral bridge loads from the active origin and supplies every
 * generated result. If that bridge or its engine is unavailable, the mirror stays closed
 * and offers recovery; it never turns an input photo or a timer into a fake output.
 *
 * One behavioural rule from the handoff: "Product decisions мають відбуватися на стабільних
 * зупинках, а не під час руху камери" — controls are inert unless the engine reports a
 * station. Nothing here reads scroll; it watches the flag the engine writes, so there is
 * still one clock.
 */
(function (global) {
  'use strict';

  var MAX_ITEMS = 5;
  var MIN_ITEMS = 1;

  /* The client-side camera prototype never remains open beyond the approved experience
   * window. The production adapter will replace this with the server capability value;
   * no provider/model/price wording is rendered anywhere in the client UI. */
  var LIVE_MAX_MS = 40000;

  /* One authored explanation for the only structural Live refusal. The cinematic page
   * is still a simulated client, but the incoming API adapter can hand this error to
   * `setLiveError()` and the viewer will see the same answer as in beta. */
  var LIVE_LOOK_INCOMPLETE_COPY = Object.freeze({
    title: 'Потрібен повний зафіксований образ',
    body: 'Для нової людини потрібні верх або цільний одяг, низ або цільний одяг і взуття.',
    detail: 'Збережений аватар + одна нова річ — можна: решта locked речей береться з цього образу. Нове крупне фото обличчя + лише капелюх — недостатньо.',
    action: 'Обери повний збережений образ або додай відсутні частини.'
  });

  function liveLookErrorCopy(error) {
    var code = String(error && error.code || '');
    var message = String(error && error.message || error || '');
    if (code === 'LIVE_REFERENCE_INCOMPLETE_LOOK' || /complete locked look|LIVE_REFERENCE_INCOMPLETE_LOOK/i.test(message)) {
      return LIVE_LOOK_INCOMPLETE_COPY;
    }
    return {
      title: 'Real-time Look недоступний',
      body: message || 'Не вдалося відкрити зафіксований образ.',
      detail: '',
      action: 'Повернутися до образу і спробувати ще раз.'
    };
  }

  /* The three places where the viewer is asked something, in travel order. Named for the
   * place, because that is what the canon fixes — the surface follows the room. */
  var STEPS = [
    { id: 'person', label: 'ВИ',     title: 'Ваше відображення', cta: 'До речей' },
    { id: 'items',  label: 'РЕЧІ',   title: 'Ваші пʼять речей', cta: 'Створити образ' },
    { id: 'looks',  label: 'ОБРАЗИ', title: 'Ваш образ',        cta: 'Ще один образ' }
  ];

  /* Secondary path only — for someone with nothing to photograph. */
  var PRESET_ITEMS = [
    'вовняний джемпер', 'бавовняна сорочка', 'лляні штани', 'вовняні брюки',
    'широкі джинси', 'довге пальто', 'вʼязаний кардиган', 'шкіряні лофери', 'білі кеди'
  ];
  /* Draft presentation data. The beta adapter will replace these arrays with the
   * server-owned preset catalogues without changing the mirror components. No provider,
   * model or price language belongs in this layer. */
  var BACKGROUND_OPTIONS = [
    { id: 'apartment', name: 'Ця квартира', note: 'тепле дерево · спокійне світло', visual: 'apartment' },
    { id: 'concrete', name: 'Бетонна галерея', note: 'графічний простір · мʼяка тінь', visual: 'concrete' },
    { id: 'morning-city', name: 'Ранкове місто', note: 'повітря · холодне скло', visual: 'city' },
    { id: 'neutral-studio', name: 'Нейтральна студія', note: 'чистий фон · точний колір', visual: 'studio' }
  ];
  var SHOOT_STYLES = [
    { id: 'soft-light', name: 'Мʼяке світло', note: 'тихий портрет · природна шкіра', visual: 'soft' },
    { id: 'architecture', name: 'Архітектура', note: 'лінії · масштаб · чітка форма', visual: 'architecture' },
    { id: 'signature', name: 'Авторський', note: 'референси з вашої фотосесії', visual: 'signature' }
  ];
  var VIDEO_STYLES = [
    { id: 'air', name: 'Повітря', note: 'тканина · повільний рух', visual: 'air' },
    { id: 'walk', name: 'Крок', note: 'рух уперед · жива камера', visual: 'walk' },
    { id: 'light', name: 'Світло', note: 'відблиск · тінь · зміна часу', visual: 'light' }
  ];
  var BACKGROUNDS = BACKGROUND_OPTIONS.map(function (option) { return option.name; });

  /* THE APPROVED ACTION ROW — layout 3, variant 2, copied verbatim from
   * ui-concepts/index.html. Not paraphrased and not re-worded: the owner approved these four
   * words and these four sentences on a picture, so they are data, not copy to improve.
   *
   * The shape matters as much as the words. FOUR SHORT WORDS in one row across the mirror,
   * each over a dim underline, and exactly ONE full sentence underneath belonging to whichever
   * action is active. The build this replaces had two rows of two tiles, each carrying its own
   * little sub-verb — four sentences competing at once, which is what the row was designed to
   * stop.
   *
   * Note what `bg` promises: change the background AND shoot video on it. The separate OMNI
   * button is gone because this sentence already covers it — the approved layout has four
   * actions, not five. */
  var ACTS = {
    shoot: ['Фотосесія',  'зняти фотосесію у вибраному стилі'],
    fash:  ['Фешн-відео', 'зняти відео у фешн-стилі'],
    bg:    ['Новий фон',  'змінити фон і зняти відео на ньому'],
    live:  ['Примірка',   'приміряти зараз живою камерою']
  };
  var ACT_ORDER = ['shoot', 'fash', 'bg', 'live'];

  function create(opts) {
    opts = opts || {};
    var askRoot = document.querySelector('[data-ui-ask]') || document.querySelector('[data-ui-state]');
    var showRoot = document.querySelector('[data-ui-show]') || document.querySelector('[data-ui-step]');
    var stage = document.querySelector('[data-stage]');
    var mobileRoot = document.querySelector('[data-mobile-attention]');
    var liveOverlay = document.querySelector('[data-live-overlay]');
    var liveFullscreen = liveOverlay && liveOverlay.querySelector('[data-live-fullscreen]');
    var liveClose = liveOverlay && liveOverlay.querySelector('[data-live-close]');
    var liveStart = liveOverlay && liveOverlay.querySelector('[data-live-start]');
    var liveStatus = liveOverlay && liveOverlay.querySelector('[data-live-status]');
    var liveTime = liveOverlay && liveOverlay.querySelector('.live-overlay__time');
    if (!askRoot || !showRoot) return null;

    /* The measured mirror rectangles are the right spatial owners on a wide screen, but
     * only ~165px wide on an iPhone. Keep one DOM tree and move the active panel into a
     * safe-area-aware portrait plane; comment anchors restore both panels to their exact
     * film positions whenever the viewport stops being portrait-mobile. */
    var askAnchor = document.createComment('ui-ask-home');
    var showAnchor = document.createComment('ui-show-home');
    askRoot.parentNode.insertBefore(askAnchor, askRoot);
    showRoot.parentNode.insertBefore(showAnchor, showRoot);
    var mobileQuery = global.matchMedia
      ? global.matchMedia('(max-width: 767px) and (orientation: portrait)')
      : { matches: false, addEventListener: function () {} };

    var step = 0;

    /* TWO PHOTOGRAPHS OF THE VIEWER, doing different jobs. The main image has no imposed
     * pose/crop requirement — the owner explicitly removed the old full-length mandate.
     * The face close-up is optional and carries extra identity detail when useful. */
    var person = { main: null, face: null };

    /* The things currently being gathered for the NEXT look. */
    var items = [];
    var presetsOpen = false;

    /* Several looks are allowed, and one is selected. Each carries what was done to it, so
     * the actions are per-look rather than global. */
    var looks = [];
    var selected = -1;
    var pending = false;
    /* A hydrated/saved look may be sent to the physical television before its
     * local transparent display derivative exists.  Keep a small idempotency
     * ledger so ordinary bridge polls do not repaint the same shelf entry. */
    var publishedLookPresentationKeys = {};

    /* Which face of the selected look the right mirror is showing. */
    var view = 'look';          // 'look' | 'shoot' | 'video' | 'bg' | 'live'
    /* Every product decision opens on the left mirror. The right mirror remains the
     * answer surface: current look while choosing, orb while working, result on arrival. */
    var pickerKind = null;      // null | 'shoot' | 'fash' | 'bg'
    /* Portrait has one physical attention plane. The saved-look library belongs to the
     * left mirror on desktop, but a phone needs an explicit route back to it before the
     * viewer chooses the next action. */
    var mobileLookChooser = false;
    var bgOpen = false;         // compatibility state; pickerKind owns the actual picker
    var liveRequirementError = opts.liveError ? liveLookErrorCopy(opts.liveError) : null;

    /* Only background and shoot retain a presentation-format step. Fashion Video
     * takes its surface from the immutable style reference, so it starts directly
     * after the style has been selected. */
    var awaitingAspect = null;   // null | 'shoot' | 'bg'
    var pendingAction = null;    // null | { kind, aspect }
    var actionError = null;      // adapter-owned failure: { kind, message }
    var lookReview = null;       // core image exists, but a retryable follow-up is pending
    /* Upload preparation is intentionally presentation-neutral. The beta accepts the
     * same normalized JPEG/PNG/WebP payload after HEIC/HEIF conversion; while that work
     * is happening the station stays put and every upload affordance is disabled. */
    var preparingFiles = false;
    var uploadError = '';
    var uploadTaskId = 0;
    var uploadToolsPromise = Promise.all([
      import('./image-upload.js'),
      import('./drop-upload.js')
    ]).then(function (modules) {
      return { prepareImageFile: modules[0].prepareImageFile, acceptedDroppedImages: modules[1].acceptedDroppedImages };
    }).catch(function () { return null; });
    var mediaPreview = global.WardrobeMediaPreview || null;

    /* Result-screen asset policy. The beta owns the immutable approved master and
     * may also return one hash-bound native RGBA cutout plus its compact derivative.
     * If beta has not attached that native asset yet, ensureMasterCutout() below may
     * derive it from the exact master bytes only; a preview is never a mask source. */
    function isPreviewOnlyImageUrl(value) {
      return /[?&](?:preview|thumbnail|derivative|max_edge|width|quality)=/i.test(String(value || ''));
    }

    /* The bridge normally supplies these already.  This small fallback protects a
     * partially upgraded server payload from making the browser fetch a 5 MB original
     * before it can paint a result tile.  It is display-only: download URLs never pass
     * through this helper. */
    function serverImagePreviewUrl(value) {
      if (typeof value !== 'string' || !/^\/api\//.test(value)) return '';
      var split = value.split('#');
      var path = split[0];
      if (/[?&]preview=1(?:&|$)/.test(path)) return value;
      return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'preview=1' + (split[1] ? '#' + split[1] : '');
    }

    function lookAssets(source, fallbackMaster) {
      source = source || {};
      /* Beta revisions have used both a flat result object and a nested `outputs` /
       * `assets` envelope. Read only explicit master/native/preview names at this
       * boundary; an arbitrary `cutout` field is deliberately not accepted because
       * beta also uses that name for garment evidence. */
      var envelopes = [source, source.outputs, source.output, source.assets, source.result,
        source.approved_look].filter(function (value) {
          return value && typeof value === 'object' && !Array.isArray(value);
        });
      function first(names, accept) {
        for (var i = 0; i < envelopes.length; i++) {
          for (var j = 0; j < names.length; j++) {
            var value = envelopes[i][names[j]];
            if (value !== undefined && value !== null && value !== '' && (!accept || accept(value))) return value;
          }
        }
        return null;
      }
      var masterNames = ['masterUrl', 'master_image_url', 'avatar_outfit_master',
        'avatar_outfit_url', 'image_url', 'resultUrl', 'mediaUrl'];
      /* Keep a preview usable as a display fallback, but never let it become the
       * source of local background removal.  The cutout is allowed only to read
       * a full approved master returned by beta. */
      var displayFallback = first(masterNames) || fallbackMaster || '';
      var masterUrl = first(masterNames, function (value) {
        return typeof value === 'string' && !isPreviewOnlyImageUrl(value);
      }) || (!isPreviewOnlyImageUrl(fallbackMaster) ? fallbackMaster : '');
      var masterSha256 = first(['masterSha256', 'master_sha256', 'avatar_outfit_master_sha256',
        'avatar_outfit_sha256', 'image_sha256']) || null;
      var nativeEnvelope = first(['cutout_native', 'cutoutNative', 'native_cutout']);
      if (!nativeEnvelope || typeof nativeEnvelope !== 'object') nativeEnvelope = {};
      var nativeUrl = nativeEnvelope.url || nativeEnvelope.image_url ||
        first(['cutoutNativeUrl', 'cutout_native_url', 'avatar_outfit_cutout_native_url']) || '';
      var nativeSha256 = nativeEnvelope.sha256 ||
        first(['cutoutNativeSha256', 'cutout_native_sha256', 'avatar_outfit_cutout_native_sha256']) || null;
      var sourceMasterSha256 = nativeEnvelope.source_master_sha256 || nativeEnvelope.bound_master_sha256 ||
        first(['cutoutNativeSourceMasterSha256', 'cutout_native_source_master_sha256',
          'cutout_source_master_sha256']) || null;
      var nativeHasAlpha = nativeEnvelope.has_alpha === true || nativeEnvelope.alpha === true ||
        first(['cutoutNativeHasAlpha', 'cutout_native_has_alpha']) === true;
      var nativeBound = !!(nativeUrl && nativeSha256 && masterSha256 && sourceMasterSha256 === masterSha256 && nativeHasAlpha);
      var previewUrl = first(['cutoutPreviewUrl', 'cutout_preview_url', 'avatar_outfit_cutout_preview_url']) || '';
      var previewSha256 = first(['cutoutPreviewSha256', 'cutout_preview_sha256',
        'avatar_outfit_cutout_preview_sha256']) || null;
      var previewSourceNativeSha256 = first(['cutoutPreviewSourceNativeSha256',
        'cutout_preview_source_native_sha256', 'cutout_preview_source_sha256']) || null;
      var previewBound = nativeBound && !!(previewUrl && previewSha256 && previewSourceNativeSha256 === nativeSha256);
      return {
        masterUrl: masterUrl,
        masterSha256: masterSha256,
        cutoutNativeUrl: nativeBound ? nativeUrl : '',
        cutoutNativeSha256: nativeBound ? nativeSha256 : null,
        cutoutPreviewUrl: previewBound ? previewUrl : '',
        cutoutPreviewSha256: previewBound ? previewSha256 : null,
        displayFallback: displayFallback,
        displayUrl: previewBound ? previewUrl : nativeBound ? nativeUrl : masterUrl || displayFallback,
        nativeBound: nativeBound,
        previewBound: previewBound,
      };
    }

    /* The large answer mirror and the small library strip have different jobs.
     * A 640px derivative belongs in a thumbnail; using it for the answer mirror
     * made a real, native-resolution cutout look like a low-quality preview. */
    function lookDisplayUrl(look, surface) {
      if (!look) return '';
      if (surface === 'thumbnail') {
        return look.cutoutPreviewUrl || look.cutoutNativeUrl || look.resultUrl || look.result || '';
      }
      return look.cutoutNativeUrl || look.resultUrl || look.result || look.cutoutPreviewUrl || '';
    }

    function sameApprovedMaster(one, two) {
      if (!one || !two) return false;
      var oneUrl = String(one.masterSourceUrl || one.resultUrl || one.result || '');
      var twoUrl = String(two.masterSourceUrl || two.resultUrl || two.result || '');
      if (!oneUrl || oneUrl !== twoUrl) return false;
      var oneSha = String(one.masterSha256 || '').toLowerCase();
      var twoSha = String(two.masterSha256 || '').toLowerCase();
      return !oneSha || !twoSha || oneSha === twoSha;
    }

    function localCutoutMatchesMaster(previous, fresh) {
      if (!previous || !fresh || !previous.cutoutNativeUrl) return false;
      var expected = String(fresh.masterSha256 || '').toLowerCase();
      var bound = String(previous.cutoutNativeSourceMasterSha256 || '').toLowerCase();
      return !expected || (bound && bound === expected);
    }

    /* Profile polling rebuilds server records frequently. A locally-derived native
     * cutout is tied to the same immutable master but is not part of that profile
     * response, so copying the fresh record wholesale used to erase it while its
     * native-resolution conversion was still in flight. Keep only a verified local
     * derivative for exactly the same master; a new master always starts clean. */
    function mergeHydratedLook(previous, fresh) {
      if (!previous || !sameApprovedMaster(previous, fresh)) return fresh;
      var merged = Object.assign({}, previous, fresh);
      /* Profile polls describe the master look, not its durable product
       * library.  Preserve already-restored sessions for this same immutable
       * look instead of overwriting them with the profile's empty local shell. */
      if (previous.savedDeliveries) merged.savedDeliveries = previous.savedDeliveries;
      if (previous.actionResults && Object.keys(previous.actionResults).length) {
        merged.actionResults = previous.actionResults;
      }
      if (!fresh.cutoutNativeUrl && localCutoutMatchesMaster(previous, fresh)) {
        merged.cutoutNativeUrl = previous.cutoutNativeUrl;
        merged.cutoutNativeSha256 = previous.cutoutNativeSha256;
        merged.cutoutNativeSourceMasterSha256 = previous.cutoutNativeSourceMasterSha256;
        merged.cutoutNativeHasAlpha = true;
        merged.cutoutPreviewUrl = previous.cutoutPreviewUrl || '';
        merged.cutoutPreviewSha256 = previous.cutoutPreviewSha256 || null;
        merged.cutoutPreviewSourceNativeSha256 = previous.cutoutPreviewSourceNativeSha256 || null;
      }
      if (!fresh.cutoutNativeUrl && previous.cutoutPending) {
        merged.cutoutPending = true;
        merged.cutoutAttempted = Boolean(previous.cutoutAttempted);
      }
      return merged;
    }

    function currentLookForCutout(origin) {
      var lookId = String(origin && (origin.lookId || origin.id || origin.runId) || '');
      var currentLook = looks.find(function (candidate) {
        return lookId && String(candidate && (candidate.lookId || candidate.id || candidate.runId) || '') === lookId;
      });
      if (currentLook) return currentLook;
      return looks.find(function (candidate) { return sameApprovedMaster(candidate, origin); }) || origin;
    }

    /* The physical television receives the same alpha asset as the answer mirror.
     * It may compact that already-transparent asset for display, but it must never
     * start a second remove-white pass from the master or a compact preview.  Re-adding
     * the same source URL updates the existing look shelf entry positionally. */
    function publishLookPresentation(look) {
      if (!look || typeof opts.onResult !== 'function') return;
      var source = look.masterSourceUrl ||
        (!isPreviewOnlyImageUrl(look.resultUrl) ? look.resultUrl : '');
      /* The approved master is a valid interim TV image.  A native alpha
       * cutout replaces it when available, but an in-flight action must never
       * leave the television blank while it waits for that local display work. */
      var display = look.cutoutPreviewUrl || look.cutoutNativeUrl || source;
      if (!source || !display) return;
      var key = source + '\n' + display;
      if (publishedLookPresentationKeys[key]) return;
      publishedLookPresentationKeys[key] = true;
      opts.onResult({
        kind: 'look',
        aspect: '9:16',
        urls: [source],
        previewUrls: [display],
        previewAttempted: true,
        mediaUrl: source
      });
    }

    /* Keep the explicit native-cutout handoff name as a compatibility boundary:
     * older integration checks and handoffs use it to verify that alpha delivery
     * updates the same TV shelf entry.  The generic helper above also covers the
     * master-only interim state. */
    function publishNativeLookPresentation(look) {
      publishLookPresentation(look);
    }

    /* If beta has not yet attached CUTOUT_NATIVE to the profile response, derive it
     * from the exact approved master once. `master-cutout.js` persists the native PNG
     * in the same-origin Cache API, so a reload reuses that SHA-bound foreground and
     * never re-runs segmentation or reads a preview as its source. A failure is silent
     * and safe: the approved master remains the visible result. */
    function ensureMasterCutout(look) {
      var sourceUrl = look && (look.masterSourceUrl || (!isPreviewOnlyImageUrl(look.resultUrl) ? look.resultUrl : ''));
      if (!look || !sourceUrl || look.cutoutNativeUrl || look.cutoutPending || look.cutoutAttempted) return;
      var cutout = global.WardrobeMasterCutout;
      if (!cutout || typeof cutout.create !== 'function') return;
      var masterUrl = sourceUrl;
      var masterSha256 = look.masterSha256 || null;
      look.cutoutPending = true;
      /* Arguments are evaluated now, before any later profile poll can replace the
       * look object; the captured values below are used only to reject a stale reply. */
      cutout.create(masterUrl, look.masterSha256).then(function (asset) {
        var target = currentLookForCutout(look);
        if (!target || !sameApprovedMaster(target, {
          resultUrl: masterUrl,
          masterSha256: masterSha256
        })) return;
        if (asset && asset.nativeUrl && asset.nativeSha256 && asset.sourceMasterSha256) {
          target.cutoutNativeUrl = asset.nativeUrl;
          target.cutoutNativeSha256 = asset.nativeSha256;
          target.cutoutNativeSourceMasterSha256 = asset.sourceMasterSha256;
          target.cutoutNativeHasAlpha = true;
          /* The compact preview is generated from CUTOUT_NATIVE, never from MASTER.
           * If encoding is unavailable, the full native PNG is still valid display. */
          target.cutoutPreviewUrl = asset.previewUrl || '';
          target.cutoutPreviewSha256 = asset.previewSha256 || null;
          target.cutoutPreviewSourceNativeSha256 = asset.previewSha256 ? asset.nativeSha256 : null;
          publishNativeLookPresentation(target);
        }
      }).catch(function () {
        /* Keep the master; do not manufacture a foreground from a failed preview. */
      }).then(function () {
        var target = currentLookForCutout(look);
        if (!target || !sameApprovedMaster(target, {
          resultUrl: masterUrl,
          masterSha256: masterSha256
        })) return;
        target.cutoutPending = false;
        target.cutoutAttempted = true;
        render();
      });
    }

    function ensureFilePreview(file, done, removeBackground) {
      if (!mediaPreview || !file || typeof done !== 'function') return;
      mediaPreview.fromBlob(file, { removeBackground: removeBackground !== false, maxEdge: 480 })
        .then(function (entry) { if (entry && entry.url) done(entry.url); })
        .catch(function () {});
    }

    function ensureActionPreviews(result) {
      if (!mediaPreview || !result || result.kind === 'video') return;
      var sources = Array.isArray(result.urls) && result.urls.length
        ? result.urls.slice(0, 5)
        : result.mediaUrl ? [result.mediaUrl] : [];
      if (!sources.length) return;
      if (Array.isArray(result.previewUrls) && result.previewUrls.length >= sources.length) return;
      var serverPreviews = sources.map(serverImagePreviewUrl);
      if (serverPreviews.length && serverPreviews.every(Boolean)) {
        result.previewUrls = serverPreviews;
        result.previewUrl = serverPreviews[0];
        render();
        return;
      }
      Promise.all(sources.map(function (source) {
        return mediaPreview.fromUrl(source, { removeBackground: false, maxEdge: 640 });
      })).then(function (entries) {
        var previews = entries.map(function (entry) { return entry && entry.url; }).filter(Boolean);
        if (!previews.length) return;
        result.previewUrls = previews;
        result.previewUrl = previews[0];
        render();
      }).catch(function () {});
    }

    /* Product state arrives through one presentation-neutral bridge. The UI keeps
     * ownership of words, surfaces and motion; it never knows API routes or a host. */
    var bridge = opts.bridge || global.WardrobeCinematicBridge || null;
    /* b/index starts the real bridge at the beginning of the film.  Keeping
     * its promise means a warm profile is handed to this UI when the mirror
     * station appears, rather than accidentally constructing a second bridge
     * and issuing a second profile request at 100% loader progress. */
    var bridgePromise = opts.bridgePromise || null;
    var bridgeUnsubscribe = null;
    var bridgeState = bridge && typeof bridge.state === 'function' ? bridge.state() : null;
    var adapterLoading = !bridge;
    var adapterUnavailable = false;
    var hydratedProfileKey = '';
    var garmentSelections = {};
    var garmentChoiceRunId = null;
    /* Object URLs belong only to the current tab.  Once beta accepts a run, its
     * server-generated garment previews become the durable visual source for
     * this mirror.  We retain File objects while they exist, but never pretend
     * a lost local source can be recreated after a reload. */
    var pendingLookItems = null;
    var pendingRunId = null;

    function bridgeReady() { return !!bridge && bridgeState && bridgeState.availability === 'ready'; }
    function bridgeWorking() {
      return !!bridgeState && ['uploading', 'running', 'needs_input', 'waiting_for_approval', 'recovering']
        .indexOf(bridgeState.phase) >= 0;
    }
    function bridgeCopy() {
      if (!bridgeState) return '';
      if (bridgeState.availability === 'auth_required') return 'Ця частина простору ще закрита';
      if (bridgeState.availability !== 'ready') return 'Ця частина простору ще готується';
      return bridgeState.phase === 'needs_input' ? 'Оберіть речі'
           : bridgeState.phase === 'waiting_for_approval' ? 'Останній погляд перед продовженням'
           : bridgeState.phase === 'recovering' ? 'Повертаємося до результату'
           : bridgeState.phase === 'uploading' ? 'Приймаємо матеріали'
           : 'Створюємо результат';
    }

    function notifyGateChange() { if (typeof opts.onGateChange === 'function') opts.onGateChange(); }

    function updateBuildNumber() {
      var element = document.querySelector('[data-build]');
      if (!element) return;
      var sha = bridgeState && bridgeState.releaseSha;
      element.textContent = sha ? 'BUILD ' + String(sha).slice(0, 7).toUpperCase() : 'BUILD —';
      element.dataset.value = sha || '';
    }

    function station() { return stage.getAttribute('data-station') === '1'; }
    function locked() { return !station(); }
    function hasMain() { return !!person.main; }
    function hasItems() { return items.length >= MIN_ITEMS; }
    function hasUploadedItems() {
      return items.some(function (item) { return !!(item && item.file); });
    }
    function current() { return selected >= 0 ? looks[selected] : null; }
    /* A look owns the image a generation returned for it, or nothing. There is no route
     * that can fill this yet, and that is the point: the frame stays empty rather than
     * borrowing the uploaded photograph and calling it a result. */
    function hasResult() { var l = current(); return !!(l && (l.resultUrl || l.result)); }

    /* Beta's profile is the durable source for “Мої образи”. The cinematic page
     * keeps only transient File/object-URL state locally; after a reload these
     * records are rebuilt from the same-origin profile cookie. */
    function hydrateSavedLooks(profile) {
      var records = Array.isArray(profile && profile.looks) ? profile.looks.slice() : [];
      if (!records.length && profile && Array.isArray(profile.avatars)) {
        records = profile.avatars.reduce(function (all, avatar) {
          return all.concat((avatar.looks || []).map(function (look) {
            return Object.assign({}, look, { avatar_id: look.avatar_id || avatar.avatar_id || avatar.id });
          }));
        }, []);
      }
      var ids = records.map(function (look) { return String(look.look_id || look.id || ''); }).filter(Boolean);
      var key = ids.join('|');
      if (!records.length && hydratedProfileKey === '') return false;
      var changed = key !== hydratedProfileKey;
      hydratedProfileKey = key;
      records.forEach(function (record) {
        var lookId = record.look_id || record.id;
        if (!lookId) return;
        var resultUrl = record.image_url || (bridge && bridge.client && bridge.client.lookImageUrl
          ? bridge.client.lookImageUrl(lookId) : '');
        var at = looks.findIndex(function (look) {
          return look.lookId === lookId || look.id === lookId;
        });
        var saved = {
          id: lookId,
          lookId: lookId,
          runId: record.source_run_id || null,
          resultUrl: resultUrl,
          resultPreviewUrl: null,
          result: resultUrl,
          items: Array.isArray(record.items) ? record.items.slice() : [],
          bg: null, shootStyle: null, videoStyle: null,
          shot: false, video: false, actionResults: {},
          savedDeliveries: { shoots: [], videos: [] },
          saved: true,
          name: record.name || '',
          createdAt: record.created_at || null,
          avatarId: record.avatar_id || null
        };
        var savedAssets = lookAssets(record, resultUrl);
        saved.resultUrl = savedAssets.masterUrl || savedAssets.displayFallback || resultUrl;
        saved.result = saved.resultUrl;
        saved.masterSourceUrl = savedAssets.masterUrl || '';
        saved.resultPreviewUrl = savedAssets.displayUrl !== saved.resultUrl ? savedAssets.displayUrl : null;
        saved.masterSha256 = savedAssets.masterSha256;
        saved.cutoutNativeUrl = savedAssets.cutoutNativeUrl;
        saved.cutoutNativeSha256 = savedAssets.cutoutNativeSha256;
        saved.cutoutPreviewUrl = savedAssets.cutoutPreviewUrl;
        saved.cutoutPreviewSha256 = savedAssets.cutoutPreviewSha256;
        saved.cutoutNativeSourceMasterSha256 = savedAssets.nativeBound
          ? (record.cutoutNativeSourceMasterSha256 || record.cutout_native_source_master_sha256 || null) : null;
        if (at < 0) looks.push(saved);
        else {
          var previous = looks[at];
          looks[at] = mergeHydratedLook(previous, saved);
          looks[at].items = previous.items && previous.items.length ? previous.items : saved.items;
        }
        var hydrated = at < 0 ? saved : looks[at];
        /* Send the immutable master to the TV immediately.  If/when local
         * cutout creation succeeds, the same master entry is updated in place. */
        publishLookPresentation(hydrated);
        ensureMasterCutout(hydrated);
      });
      if (looks.length && selected < 0 && !pending && !pendingAction) {
        selected = 0;
        step = 2;
        view = 'look';
      }
      return changed;
    }

    function hydrateSavedDeliveries(deliveries) {
      if (!deliveries || !deliveries.lookId) return false;
      var look = looks.find(function (candidate) {
        return String(candidate.lookId || candidate.id || '') === String(deliveries.lookId);
      });
      if (!look) return false;
      look.savedDeliveries = {
        shoots: Array.isArray(deliveries.shoots) ? deliveries.shoots.slice() : [],
        videos: Array.isArray(deliveries.videos) ? deliveries.videos.slice() : []
      };
      return true;
    }

    /* THE gate for every action: a look with things in it must be VISIBLE first — and
     * visible means its own generated image is on the glass, not that a stand-in timer
     * elapsed. Until then the right mirror is still waiting, so there is nothing to act on. */
    function lookVisible() { return !!current() && !pending && !lookReview && hasResult(); }

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function plural(n, one, few, many) { return n === 1 ? one : n < 5 ? few : many; }
    function scene(key, content) {
      return '<div class="mirror-scene" data-scene="' + esc(key) + '">' + content + '</div>';
    }

    function makeLook() {
      if (!hasMain() || !hasItems() || pending || preparingFiles) return;
      if (adapterLoading || adapterUnavailable) {
        actionError = { kind: 'look', message: 'Ця частина простору ще готується' };
        render(); notifyGateChange();
        return;
      }

      if (bridge) {
        if (!bridgeReady() || !bridge.canStartLook || !bridge.canStartLook()) {
          actionError = { kind: 'look', message: bridgeCopy() || 'Ця частина простору ще готується' };
          render(); notifyGateChange();
          return;
        }
        var garmentFiles = items.filter(function (item) { return !!item.file; })
          .map(function (item) { return item.file; });
        if (!garmentFiles.length) {
          actionError = { kind: 'look', message: 'Додайте фото хоча б однієї речі; готові назви можна додати до фото' };
          render(); notifyGateChange();
          return;
        }
        pendingLookItems = items.slice();
        pendingRunId = null;
        pending = true; view = 'look'; actionError = null;
        render(); notifyGateChange();
        bridge.createLook({
          person: person.main.file,
          identityDetail: person.face ? person.face.file : null,
          garments: garmentFiles,
          outfitText: items.filter(function (item) { return !item.file; })
            .map(function (item) { return item.name; }).join(', ')
        }).then(function (run) {
          pendingRunId = run && run.run_id || pendingRunId;
        }).catch(function () { /* bridge event owns the visible recovery state */ });
        return;
      }

      actionError = { kind: 'look', message: 'Ця частина простору ще готується' };
      render(); notifyGateChange();
    }

    var lastBridgeResultKey = '';

    function isDeliveredBridgeResult(result) {
      if (!result || result.pendingRealMedia === true) return false;
      if (typeof result.mediaUrl === 'string' && result.mediaUrl) return true;
      return Array.isArray(result.urls) && result.urls.some(function (url) {
        return typeof url === 'string' && url;
      });
    }

    function hydrateUploadedItemPreviews(run) {
      if (!run || !Array.isArray(run.garments) || !run.garments.length ||
          (!pendingLookItems && !pendingRunId)) return;
      if (pendingRunId && run.run_id !== pendingRunId) return;
      pendingRunId = run.run_id;
      var source = pendingLookItems || items;
      var hydrated = run.garments.map(function (garment, index) {
        var sourceIndex = Number.isInteger(garment.source_index) ? garment.source_index : index;
        var local = source[sourceIndex] || {};
        var preview = typeof garment.preview_url === 'string' && garment.preview_url.charAt(0) === '/'
          ? garment.preview_url : local.url || null;
        return {
          name: local.name || garment.observed && garment.observed.garment_type || 'Річ',
          url: preview,
          previewUrl: preview,
          file: local.file || null,
          serverPreview: Boolean(preview && preview === garment.preview_url)
        };
      });
      /* Text-only choices were not uploaded and do not receive a preview URL;
       * preserve them as honest placeholders rather than inventing images. */
      source.forEach(function (item) {
        if (!item.file) hydrated.push(item);
      });
      items = hydrated.slice(0, MAX_ITEMS);
      pendingLookItems = items.slice();
    }

    function receiveBridge(event) {
      bridgeState = event || (bridge && bridge.state ? bridge.state() : bridgeState);
      if (!bridgeState) return;
      updateBuildNumber();

      hydrateSavedLooks(bridgeState.profile);
      hydrateSavedDeliveries(bridgeState.deliveries);

      var working = bridgeWorking();
      var kind = bridgeState.activeKind || 'look';
      if (kind === 'look') {
        hydrateUploadedItemPreviews(bridgeState.run);
        pending = working && bridgeState.phase !== 'needs_input';
        if (bridgeState.phase === 'needs_input') {
          step = 1;
          var choiceRunId = bridgeState.run && bridgeState.run.run_id;
          if (choiceRunId !== garmentChoiceRunId) {
            garmentChoiceRunId = choiceRunId;
            garmentSelections = {};
          }
        }
        var resultReady = bridgeState.result && bridgeState.run &&
          (bridgeState.phase === 'completed' || bridgeState.result.reviewRequired === true);
        if (resultReady) {
          var runId = bridgeState.run.run_id;
          var at = looks.findIndex(function (look) { return look.runId === runId; });
          if (at < 0) {
            looks.push({
              id: bridgeState.savedLook && bridgeState.savedLook.look_id || runId,
              runId: runId,
              lookId: bridgeState.savedLook && bridgeState.savedLook.look_id || null,
              resultUrl: bridgeState.result.masterUrl || bridgeState.result.mediaUrl || bridgeState.result.urls[0] || '',
              masterSourceUrl: bridgeState.result.masterUrl || '',
              resultPreviewUrl: null,
              items: items.slice(), bg: null, shootStyle: null, videoStyle: null,
              shot: false, video: false, actionResults: {}
            });
            at = looks.length - 1;
            items = [];
          } else {
            var nextResultUrl = bridgeState.result.masterUrl || bridgeState.result.mediaUrl || bridgeState.result.urls[0] || looks[at].resultUrl;
            if (looks[at].resultUrl !== nextResultUrl) looks[at].resultPreviewUrl = null;
            looks[at].resultUrl = nextResultUrl;
            if (bridgeState.savedLook) looks[at].lookId = bridgeState.savedLook.look_id;
          }
          var resultAssets = lookAssets(bridgeState.result, looks[at].resultUrl);
          looks[at].resultUrl = resultAssets.masterUrl || resultAssets.displayFallback || looks[at].resultUrl;
          looks[at].result = looks[at].resultUrl;
          looks[at].masterSourceUrl = resultAssets.masterUrl || '';
          looks[at].resultPreviewUrl = resultAssets.displayUrl !== looks[at].resultUrl
            ? resultAssets.displayUrl : null;
          looks[at].masterSha256 = resultAssets.masterSha256;
          looks[at].cutoutNativeUrl = resultAssets.cutoutNativeUrl;
          looks[at].cutoutNativeSha256 = resultAssets.cutoutNativeSha256;
          looks[at].cutoutPreviewUrl = resultAssets.cutoutPreviewUrl;
          looks[at].cutoutPreviewSha256 = resultAssets.cutoutPreviewSha256;
          looks[at].cutoutNativeSourceMasterSha256 = resultAssets.nativeBound
            ? resultAssets.masterSha256 : null;
          looks[at].cutoutNativeHasAlpha = resultAssets.nativeBound;
          publishLookPresentation(looks[at]);
          ensureMasterCutout(looks[at]);
          selected = at;
          pending = false;
          step = 2;
          actionError = null;
          lookReview = bridgeState.result.reviewRequired ? (bridgeState.review || {
            code: 'FIRST_APPEARANCE_NEEDS_INPUT',
            message: 'Образ уже зібраний. Спробуємо ще раз, щоб завершити його повністю?',
            retryable: true,
          }) : null;
          if (typeof opts.onLookReady === 'function') opts.onLookReady();
        }
      } else {
        var uiKind = kind === 'background' ? 'bg' : kind === 'video' ? 'fash' : kind;
        var progressiveShoot = kind === 'shoot' && bridgeState.result && bridgeState.result.readyCount > 0;
        pendingAction = working ? {
          kind: uiKind,
          aspect: bridgeState.requestedAspect || bridgeState.result && bridgeState.result.aspect || null,
          progressive: progressiveShoot
        } : null;
        /* A Fashion Shoot arrives one independently approved frame at a time.
         * Preserve and render each one as soon as it arrives; waiting for all
         * five made the right mirror claim it had nothing while Beta already
         * held real finished pixels. */
        if (bridgeState.result && (bridgeState.phase === 'completed' || progressiveShoot)) {
          var activeLook = current();
          view = kind === 'background' ? 'bg' : kind;
          if (activeLook) {
            activeLook.actionResults = activeLook.actionResults || {};
            activeLook.actionResults[kind] = bridgeState.result;
            ensureActionPreviews(activeLook.actionResults[kind]);
            if (kind === 'shoot') activeLook.shot = true;
            if (kind === 'video') activeLook.video = true;
          }
          actionError = null;
        }
      }

      if (bridgeState.phase === 'failed'
        && !bridgeState.result?.reviewRequired
        && !(kind === 'shoot' && bridgeState.result?.readyCount > 0)) {
        pending = false;
        pendingAction = null;
        lookReview = null;
        actionError = {
          kind: kind === 'background' ? 'bg' : kind === 'video' ? 'fash' : kind,
          code: bridgeState.error && bridgeState.error.code || null,
          message: bridgeState.error && bridgeState.error.message || 'Спробуємо ще раз'
        };
      }

      /* The transition to the TV is a delivery event, not an intent event.
       * `scene:submitting` and an in-flight video therefore remain on the
       * mirrors even when their chosen style is 16:9. */
      if (bridgeState.phase === 'completed' && isDeliveredBridgeResult(bridgeState.result)) {
        var resultKey = [bridgeState.result.kind, bridgeState.result.mediaUrl,
          (bridgeState.result.urls || []).join('|')].join(':');
        if (resultKey !== lastBridgeResultKey) {
          lastBridgeResultKey = resultKey;
          if (typeof opts.onResult === 'function') opts.onResult(bridgeState.result);
          if (bridgeState.result.aspect === '16:9' && typeof opts.onWideResult === 'function') {
            opts.onWideResult();
          }
        }
      }

      render();
      notifyGateChange();
    }

    function bindBridge(next) {
      if (bridgeUnsubscribe) bridgeUnsubscribe();
      bridge = next || null;
      bridgeState = bridge && typeof bridge.state === 'function' ? bridge.state() : null;
      updateBuildNumber();
      bridgeUnsubscribe = bridge && typeof bridge.subscribe === 'function'
        ? bridge.subscribe(receiveBridge) : null;
      render();
      notifyGateChange();
    }

    /* ============================================================== ASK — left mirror */

    /* The plus is the affordance: an empty dashed box with two lines of text did not read
     * as an upload target on its own, so an empty slot now says so with a glyph before it
     * says anything else. Gone the moment a photograph fills the slot — the photograph
     * itself is the evidence then, and "замінити" takes over as the one word that matters. */
    function photoSlot(kind, label, note, index) {
      var p = person[kind];
      var action = p ? 'Замінити ' + label.toLowerCase()
                     : kind === 'main' ? 'Додати своє фото' : 'Додати портрет';
      return '<label class="pslot pslot--' + kind + (p ? ' pslot--has' : '') +
        '" for="io-' + kind + '" role="button" tabindex="0" aria-label="' + action + '">' +
        '<span class="pslot__index" aria-hidden="true">0' + index + '</span>' +
        (p ? '<img class="pslot__img" src="' + (p.previewUrl || p.url) + '" alt="">'
           : '<span class="pslot__plus" aria-hidden="true">+</span>') +
        '<span class="pslot__copy"><span class="pslot__t">' + label + '</span>' +
          '<span class="pslot__n">' + (p ? 'замінити' : note) + '</span></span>' +
        '<input id="io-' + kind + '" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif,.heic,.heif" hidden>' +
      '</label>';
    }

    function uploadNotice() {
      if (preparingFiles) return '<p class="upload-helper upload-helper--busy" role="status">Готуємо фото…</p>';
      if (uploadError) return '<p class="upload-helper upload-helper--error" role="alert">' + esc(uploadError) + '</p>';
      return '<p class="upload-helper">PNG · JPEG · WebP · HEIC · можна перетягнути</p>';
    }

    function askPerson() {
      /* No pose dictated. The full-body mandate was the earlier assumption — the owner
       * rejected it outright — so this slot now asks for a photo, not a stance. `full` stays
       * the internal name only because hasMain()/gates elsewhere key on it; nothing here
       * tells the viewer how to stand or frame themselves. */
      return '<p class="glass__lede person-intro">Одного фото достатньо. Портрет допоможе точніше зберегти риси.</p>' +
        '<div class="pslots">' +
          photoSlot('main', 'Додати своє фото', 'потрібне', 1) +
          photoSlot('face', 'Портрет', 'за бажанням', 2) +
        '</div>' + uploadNotice();
    }

    function askItems() {
      var full = items.length >= MAX_ITEMS;
      /* Five slots and one button. An empty slot IS the drop target, so the slots are the
       * whole interface — there used to be a drop zone, a thumbnail strip, a counter and a
       * row naming the output: five things describing one action. */
      var cells = '';
      for (var i = 0; i < MAX_ITEMS; i++) {
        var it = items[i];
        cells += it
          ? '<div class="slot" data-filled="1">' +
              (it.url ? '<img class="slot__img" src="' + (it.previewUrl || it.url) + '" alt="">'
                      : '<span class="slot__ph"><span class="ph__g ph__g--garment"></span></span>') +
              '<button class="slot__x" type="button" data-remove="' + i + '" aria-label="прибрати">×</button>' +
            '</div>'
          : '<label class="slot slot--drop" data-filled="0" for="io-items">' +
              '<span class="slot__empty">' + (i + 1) + '</span></label>';
      }
      return '<div class="slots slots--big">' + cells + '</div>' +
        '<input id="io-items" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif,.heic,.heif" multiple hidden' + (full ? ' disabled' : '') + '>' +
        uploadNotice() +
        '<button class="secondary" type="button" data-presets aria-expanded="' + (presetsOpen ? 'true' : 'false') + '">' +
          'нічого під рукою — обрати з готових</button>' +
        (presetsOpen
          ? '<div class="tray">' + PRESET_ITEMS.map(function (o, i) {
              var on = items.some(function (x) { return !x.url && x.name === o; });
              return '<button class="tray__chip" type="button" data-preset="' + i + '"' +
                ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
                ' data-blocked="' + (full && !on ? '1' : '0') + '">' +
                '<span>' + esc(o) + '</span></button>';
            }).join('') + '</div>'
          : '');
    }

    /* Small counts read as words in running Ukrainian text ("три речі"), not digits —
     * matches the approved picture, which never puts a numeral in a sentence. */
    var NUM_WORDS = ['', 'одна', 'дві', 'три', 'чотири', 'пʼять', 'шість'];
    function numWord(n) { return NUM_WORDS[n] || String(n); }

    function lookLede(l) {
      if (l && l.saved && (!l.items || !l.items.length)) return 'Збережений образ із вашого профілю.';
      var parts = [numWord(l.items.length) + ' ' + plural(l.items.length, 'річ', 'речі', 'речей')];
      if (person.face) parts.push('ваше обличчя');
      var s = parts.join(', ') + '.';
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /* THE APPROVED LOOKS SCREEN — a picture the owner pointed at directly, so this is
     * data copied from it, not a paraphrase: heading "Образ N", one lede sentence, a
     * labelled row of square thumbnails matching the item slots' own shape language, and
     * one plain underlined line back to the things. No eyebrow, no CTA button, no trail —
     * the picture has none of those once a look already exists. */
    function askLookThumbs() {
      var cells = looks.map(function (l, i) {
        var thumb = lookDisplayUrl(l, 'thumbnail') || (l.items[0] && (l.items[0].previewUrl || l.items[0].url));
        return '<button class="lookthumb" type="button" data-select="' + i + '"' +
          ' aria-pressed="' + (i === selected ? 'true' : 'false') + '">' +
          (thumb ? '<img class="lookthumb__img" src="' + thumb + '" alt="">' : '') +
          (i === selected ? '<span class="lookthumb__active" aria-hidden="true">●</span>' : '') +
          '</button>';
      }).join('');
      /* Padded to at least four so the row reads as an ongoing strip rather than a tally
       * that stops. The empty cells are inert — a fifth action hiding as a thumbnail
       * would be exactly the kind of thing the approved row was designed to avoid. */
      for (var i = looks.length; i < 4; i++) cells += '<span class="lookthumb" aria-hidden="true"></span>';
      return cells;
    }

    function copyPrivateDeliveryUrl(value, control) {
      if (!value) return;
      var absolute = new URL(value, global.location.href).href;
      var original = control && control.textContent || 'Копіювати посилання';
      var copied = function () {
        if (!control) return;
        control.textContent = 'Скопійовано';
        global.setTimeout(function () { control.textContent = original; }, 1800);
      };
      var failed = function () {
        if (control) control.textContent = 'Не вдалося скопіювати';
      };
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(absolute).then(copied).catch(failed);
        return;
      }
      try {
        var fallback = document.createElement('textarea');
        fallback.value = absolute;
        fallback.setAttribute('readonly', '');
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.appendChild(fallback);
        fallback.select();
        var didCopy = document.execCommand('copy');
        fallback.remove();
        if (didCopy) copied(); else failed();
      } catch (error) {
        failed();
      }
    }

    function savedMaterialsLibrary(look) {
      var deliveries = look && look.savedDeliveries || { shoots: [], videos: [] };
      var shoots = Array.isArray(deliveries.shoots) ? deliveries.shoots : [];
      var videos = Array.isArray(deliveries.videos) ? deliveries.videos : [];
      if (!shoots.length && !videos.length) return '';
      var shootCards = shoots.map(function (delivery, index) {
        var result = delivery && delivery.result || {};
        var frames = Array.isArray(result.frames) ? result.frames : [];
        var lead = frames.find(function (frame) { return frame && frame.imageUrl; }) || null;
        var label = 'Фотосесія · ' + (result.readyCount || frames.filter(function (frame) {
          return frame && frame.imageUrl;
        }).length) + ' з ' + (result.expectedCount || 5) + ' кадрів';
        return '<article class="saved-material saved-material--shoot">' +
          '<button type="button" class="saved-material__open" data-open-saved-shoot="' + index + '">' +
            (lead ? '<img src="' + esc(lead.previewUrl || lead.imageUrl) + '" alt="" loading="lazy" decoding="async">' : '<span class="saved-material__placeholder">Ф</span>') +
            '<span>' + esc(label) + '</span>' +
          '</button>' +
        '</article>';
      }).join('');
      var videoCards = videos.map(function (delivery, index) {
        var result = delivery && delivery.result || {};
        var download = result.downloadUrl || result.mediaUrl || '';
        return '<article class="saved-material saved-material--video">' +
          '<button type="button" class="saved-material__open" data-open-saved-video="' + index + '">' +
            (result.posterUrl
              ? '<img src="' + esc(result.posterUrl) + '" alt="" loading="lazy" decoding="async">'
              : '<span class="saved-material__placeholder">▶</span>') +
            '<span>Fashion-відео</span>' +
          '</button>' +
          '<div class="saved-material__actions">' +
            '<a href="' + esc(download) + '" download>Завантажити</a>' +
            '<button type="button" data-copy-delivery-url="' + esc(result.mediaUrl || '') + '">Копіювати посилання</button>' +
          '</div>' +
        '</article>';
      }).join('');
      return '<section class="saved-materials" aria-label="Збережені матеріали образу">' +
        '<div class="saved-materials__head">Збережені матеріали</div>' +
        '<div class="saved-materials__grid">' + shootCards + videoCards + '</div>' +
        '<p class="saved-materials__note">Посилання на відео приватне: працює лише в цьому профілі.</p>' +
      '</section>';
    }

    function optionsFor(kind) {
      var catalogs = bridgeState && bridgeState.catalogs;
      var live = kind === 'shoot' ? catalogs && catalogs.shoots
               : kind === 'fash' ? catalogs && catalogs.videos
               : catalogs && catalogs.backgrounds;
      if (live && live.length) {
        return live.map(function (option) {
          return {
            id: option.id,
            name: option.name,
            note: option.note || '',
            /* Keep the beta catalogue's visual hint when it provides one. The
             * fallback is only for the local offline catalogue; it must not
             * overwrite a live preview's identity. */
            visual: option.visual || (kind === 'shoot' ? 'architecture' : kind === 'fash' ? 'air' : 'studio'),
            previewUrl: option.previewUrl || '',
            playbackUrl: option.playbackUrl || '',
            version: option.version || null,
            motionMode: option.motionMode || null,
            presentationSurface: option.presentationSurface || 'mirror',
            aspect: option.aspect || (option.presentationSurface === 'tv' ? '16:9' : '9:16'),
            referencePackSha256: option.referencePackSha256 || null,
            inputContract: option.inputContract || null
          };
        });
      }
      // When the real bridge is online, an empty server catalogue is a real
      // availability condition — never replace it with local placeholder styles.
      // The draft cards below are retained only for an offline design preview.
      if (bridge) return [];
      return kind === 'shoot' ? SHOOT_STYLES
           : kind === 'fash' ? VIDEO_STYLES
           : BACKGROUND_OPTIONS;
    }

    function selectedOption(kind, look) {
      if (!look) return null;
      var index = kind === 'shoot' ? look.shootStyle
                : kind === 'fash' ? look.videoStyle : look.bg;
      return index == null ? null : optionsFor(kind)[index];
    }

    function pickerCopy(kind) {
      return kind === 'shoot'
        ? { eyebrow: 'ФОТОСЕСІЯ', title: 'Оберіть стиль', note: 'Пʼять кадрів з одного світла й настрою.' }
        : kind === 'fash'
        ? { eyebrow: 'ФЕШН-ВІДЕО', title: 'Оберіть відеостиль', note: 'Стиль задає монтаж, рух, камеру, простір і світло.' }
        : { eyebrow: 'НОВИЙ ФОН', title: 'Оберіть простір', note: 'Образ залишиться тим самим — зміниться світло навколо.' };
    }

    /* One family for all visual choices: the whole tile is the hit area, the selected
     * state is a restrained light shift, and every tile carries image-space first and
     * copy second. Real preview URLs later replace only `.visualpick__media`. */
    function visualPicker(kind) {
      var copy = pickerCopy(kind);
      var look = current();
      var options = optionsFor(kind);
      if (!options.length) {
        var videoReason = bridgeState && bridgeState.videoCapability && bridgeState.videoCapability.reason_code;
        var unavailable = kind === 'fash'
          ? (videoReason === 'FASHION_VIDEO_REFERENCE_PACK_REQUIRED'
            ? 'Для цього образу ще немає повного перевіреного video reference pack.'
            : 'Для цього образу зараз немає доступного перевіреного відеостилю.')
          : 'Для цього образу зараз немає готового стилю фотосесії.';
        return scene('picker-' + kind,
          '<div class="glass__eyebrow">' + copy.eyebrow + '</div>' +
          '<div class="glass__h">' + copy.title + '</div>' +
          '<p class="glass__lede pickerlede">' + esc(unavailable) + '</p>' +
          '<button class="secondary pickerback" type="button" data-picker-back>Назад до образу</button>');
      }
      var choices = options.map(function (option, index) {
        var selectedIndex = kind === 'shoot' ? look.shootStyle
                          : kind === 'fash' ? look.videoStyle : look.bg;
        var preview = option.previewUrl
          ? '<img class="visualpick__img" src="' + esc(option.previewUrl) +
              '" alt="" loading="lazy" decoding="async">'
          : '<i></i>';
        /* Fashion styles have a real beta playback route. Keep the poster
         * underneath so a protected/slow video never produces a blank card. */
        if (kind === 'fash' && option.playbackUrl) {
          preview += '<video class="visualpick__video" src="' + esc(option.playbackUrl) +
            '"' + (option.previewUrl ? ' poster="' + esc(option.previewUrl) + '"' : '') +
            ' muted playsinline autoplay loop preload="metadata" aria-hidden="true"></video>';
        }
        /* `inputContract` remains attached to the server-owned style record for the
         * generator and QA. Its reference roles are internal production instructions,
         * not client-facing copy on a style card. */
        return '<button class="visualpick" type="button" data-choice-kind="' + kind + '"' +
          ' data-choice-index="' + index + '" aria-pressed="' + (selectedIndex === index ? 'true' : 'false') + '">' +
          '<span class="visualpick__media" data-visual="' + esc(option.visual) + '" aria-hidden="true">' +
            preview + '</span>' +
          '<span class="visualpick__copy"><b>' + esc(option.name) + '</b><small>' + esc(option.note || (kind === 'fash'
            ? (option.presentationSurface === 'tv' ? 'відтвориться на телевізорі' : 'відтвориться у дзеркалі') : '')) + '</small></span>' +
        '</button>';
      }).join('');
      return scene('picker-' + kind,
        '<div class="glass__eyebrow">' + copy.eyebrow + '</div>' +
        '<div class="glass__h">' + copy.title + '</div>' +
        '<p class="glass__lede pickerlede">' + copy.note + '</p>' +
        '<div class="visualpicks" data-picker="' + kind + '">' + choices + '</div>' +
        '<button class="secondary pickerback" type="button" data-picker-back>Назад до образу</button>');
    }

    function formatPicker(kind) {
      /* Fashion Video owns its surface in the verified style manifest. It must never
       * enter this generic 16:9/9:16 branch, even if an old state or a future caller
       * accidentally leaves `awaitingAspect = 'fash'`. */
      if (kind === 'fash') return visualPicker('fash');
      var option = selectedOption(kind, current());
      return scene('format-' + kind,
        '<div class="glass__eyebrow">' + pickerCopy(kind).eyebrow + ' · ФОРМАТ</div>' +
        '<div class="glass__h">Де дивимось?</div>' +
        '<p class="glass__lede pickerlede">' + (option ? esc(option.name) + '. ' : '') +
          'Формат визначає поверхню готового результату.</p>' +
        '<div class="formatpicks">' +
          '<button class="formatpick" type="button" data-aspect="16:9">' +
            '<span class="formatpick__shape" data-format="wide" aria-hidden="true"></span>' +
            '<span><b>16:9</b><small>на телевізорі</small></span></button>' +
          '<button class="formatpick" type="button" data-aspect="9:16">' +
            '<span class="formatpick__shape" data-format="portrait" aria-hidden="true"></span>' +
            '<span><b>9:16</b><small>у дзеркалі</small></span></button>' +
        '</div>' +
          '<button class="secondary pickerback" type="button" data-format-back>Назад до стилів</button>');
    }

    var CATEGORY_NAMES = {
      outerwear: 'верхній одяг', top: 'верх', bottom: 'низ', one_piece: 'цільний образ',
      footwear: 'взуття', headwear: 'головний убір', bag: 'сумка', accessory: 'аксесуар'
    };

    function garmentChoicePanel() {
      var choices = bridgeState && bridgeState.choices || [];
      var complete = choices.length > 0 && choices.every(function (choice) {
        return !!garmentSelections[choice.category];
      });
      var groups = choices.map(function (choice) {
        var options = choice.options.map(function (option) {
          var on = garmentSelections[choice.category] === option.id;
          return '<button class="visualpick" type="button" data-garment-category="' + esc(choice.category) +
            '" data-garment-id="' + esc(option.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
            '<span class="visualpick__media" aria-hidden="true">' +
              (option.previewUrl ? '<img src="' + esc(option.previewUrl) +
                '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">' : '<i></i>') +
            '</span><span class="visualpick__copy"><b>' + esc(option.label) + '</b></span></button>';
        }).join('');
        var noun = CATEGORY_NAMES[choice.category] || choice.category;
        return '<div class="glass__eyebrow">ОБЕРІТЬ · ' + esc(noun) + '</div>' +
          '<div class="visualpicks">' + options + '</div>';
      }).join('');
      return scene('garment-choice',
        '<div class="glass__h">Яку річ залишаємо?</div>' +
        '<p class="glass__lede pickerlede">Знайшли кілька речей одного типу. Оберіть одну — образ продовжиться з цього місця.</p>' +
        groups +
        '<button class="glass__cta" type="button" data-garment-continue data-blocked="' + (complete ? '0' : '1') +
          '">Продовжити</button>');
    }

    function inputRecoveryPanel() {
      var message = bridgeState && bridgeState.run && bridgeState.run.message ||
        'Для цього образу потрібне інше фото.';
      return scene('look-needs-input',
        '<div class="glass__eyebrow">ПОТРІБНЕ УТОЧНЕННЯ</div>' +
        '<div class="glass__h">Спробуємо інше фото</div>' +
        '<p class="glass__lede">' + esc(message) + '</p>' +
        '<button class="glass__cta" type="button" data-look-reset>Повернутися до фото</button>');
    }

    function shootApprovalPanel() {
      var shoot = bridgeState && bridgeState.shoot;
      var hero = shoot && shoot.status === 'HERO_PENDING_APPROVAL';
      return scene('shoot-approval',
        '<div class="glass__eyebrow">ФОТОСЕСІЯ</div>' +
        '<div class="glass__h">' + (hero ? 'Перший кадр готовий' : 'Стиль готовий') + '</div>' +
        '<p class="glass__lede">' + (hero
          ? 'Подивіться на напрям і продовжте серію.'
          : 'Світло, ритм і композиція зібрані. Запускаємо зйомку.') + '</p>' +
        '<button class="glass__cta" type="button" data-shoot-approve>' +
          (hero ? 'Продовжити' : 'Розпочати фотозйомку') + '</button>');
    }

    function renderAskLook() {
      if (bridgeState && bridgeState.activeKind === 'shoot' && bridgeState.phase === 'waiting_for_approval') {
        askRoot.innerHTML = shootApprovalPanel();
        applyEnabled();
        return;
      }
      var l = current();
      if (pickerKind) {
        askRoot.innerHTML = visualPicker(pickerKind);
        applyEnabled();
        return;
      }
      if (awaitingAspect) {
        askRoot.innerHTML = formatPicker(awaitingAspect);
        applyEnabled();
        return;
      }
      askRoot.innerHTML = scene('looks',
        '<div class="glass__h">Образ ' + (selected + 1) + '</div>' +
        '<div class="look-status" role="status"><span class="look-status__dot" aria-hidden="true"></span>АКТИВНИЙ ОБРАЗ</div>' +
        '<p class="glass__lede">' + esc(lookLede(l)) + '</p>' +
        '<div class="looklabel">ваші образи</div>' +
        '<div class="lookthumbs">' + askLookThumbs() + '</div>' +
        savedMaterialsLibrary(l) +
        '<button class="secondary" type="button" data-edit-items>Змінити речі</button>' +
        (mobileLookChooser
          ? '<button class="secondary mobile-look-return" type="button" data-close-look-picker>До образу</button>'
          : ''));
      applyEnabled();
    }

    function renderAsk() {
      if (bridgeState && bridgeState.activeKind === 'look' && bridgeState.phase === 'needs_input') {
        askRoot.innerHTML = bridgeState.choices && bridgeState.choices.length
          ? garmentChoicePanel() : inputRecoveryPanel();
        applyEnabled();
        return;
      }
      /* THE APPROVED LOOKS SCREEN has its own shape entirely — no eyebrow, no generic
       * CTA, no trail — so it bypasses the shared template below rather than bending it
       * to fit. */
      if (step === 2) { renderAskLook(); return; }

      var s = STEPS[step];
      var blocked = (step === 0 && !hasMain()) ||
        (step === 1 && (!hasItems() || !hasUploadedItems() || pending || adapterLoading || adapterUnavailable ||
          (bridge && !bridgeReady()) || preparingFiles));

      /* UNREACHED STEPS ARE NOT RENDERED AT ALL. A greyed-out label still advertises an
       * offer, and there is no offer before the thing it applies to exists. */
      var reachable = [true, hasMain(), looks.length > 0];
      var doneFlag  = [hasMain(), looks.length > 0, looks.length > 0];
      var trail = STEPS.map(function (x, i) {
        if (!reachable[i]) return '';
        return '<button class="trail__i" type="button" data-step="' + i + '"' +
          ' aria-current="' + (step === i ? 'step' : 'false') + '" data-done="' + (doneFlag[i] ? '1' : '0') + '">' +
          x.label + '</button>';
      }).join('');

      var body = step === 0 ? askPerson() : askItems();

      askRoot.innerHTML = scene(STEPS[step].id,
        /* Digits and a slash, never "КРОК 1 З 3": at this tracking the Cyrillic З between
         * two digits reads as a third digit — on screen it said "КРОК 1 3 3". */
        '<div class="glass__eyebrow">0' + (step + 1) + ' / 0' + STEPS.length + ' · ' + s.label + '</div>' +
        '<div class="glass__h">' + s.title + '</div>' +
        '<div class="askbody">' + body + '</div>' +
        '<div class="step-actions">' +
          (step > 0 ? '<button class="glass__cta glass__cta--ghost" type="button" data-back>Назад</button>' : '') +
          '<button class="glass__cta" type="button" data-next data-blocked="' + (blocked ? '1' : '0') + '">' +
            (pending ? 'Створюємо…' : s.cta) +
          '</button>' +
        '</div>' +
        '<p class="glass__hint" data-hint></p>' +
        '<div class="trail">' + trail + '</div>');
      applyEnabled();
    }

    /* ============================================================ SHOW — right mirror */

    /* THE CAMERA. Held here so it can be switched off again: a live view that leaves the
     * device streaming after the viewer has moved on is a privacy fault, not a feature.
     * Nothing is requested until the viewer presses for it — arriving at the mirror must not
     * by itself turn a camera on. */
    var stream = null;
    var camError = '';
    var liveTimer = 0;
    var liveTrigger = null;
    var liveTransport = null;
    /* A live provider session owns an immutable reference image.  Changing a saved
     * look must therefore replace that server session, never pretend that a remote
     * renderer can mutate its reference mid-stream.  The local camera stays open. */
    var liveSwitchInFlight = false;

    function canStartServerLive() {
      return !!(bridgeReady() && bridgeState && bridgeState.savedLook &&
        bridgeState.liveCapability && bridgeState.liveCapability.paid_live_ready === true &&
        bridgeState.liveCapability.app && typeof bridge.startLive === 'function' &&
        typeof bridge.loadLiveReference === 'function');
    }

    function setLiveStatus(message) {
      if (liveStatus) liveStatus.textContent = message || '';
    }

    function setLiveVideo(nextStream) {
      if (liveFullscreen) {
        liveFullscreen.srcObject = nextStream || null;
        if (nextStream) liveFullscreen.play().catch(function () {});
      }
      var mirrorVideo = showRoot.querySelector('[data-cam]');
      if (mirrorVideo) {
        mirrorVideo.srcObject = nextStream || null;
        if (nextStream) mirrorVideo.play().catch(function () {});
      }
    }

    function setLiveTimer(milliseconds) {
      clearTimeout(liveTimer);
      liveTimer = 0;
      if (liveTime) {
        liveTime.style.setProperty('--live-duration', Math.max(1, milliseconds) + 'ms');
        liveTime.style.animation = 'none';
        void liveTime.offsetWidth;
        liveTime.style.animation = '';
      }
      liveTimer = setTimeout(function () { stopCamera(); render(); }, milliseconds);
    }

    function stopLiveTransport() {
      if (!liveTransport) return;
      try { liveTransport.stop(); } catch (ignore) {}
      liveTransport = null;
    }

    function reducedMotion() {
      return typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function closeLiveOverlay() {
      clearTimeout(liveTimer);
      liveTimer = 0;
      if (!liveOverlay) return;
      if (liveOverlay.hidden) {
        if (liveFullscreen) liveFullscreen.srcObject = null;
        if (liveStart) liveStart.hidden = true;
        return;
      }
      liveOverlay.dataset.open = '0';
      liveOverlay.setAttribute('aria-hidden', 'true');
      if (liveFullscreen) {
        try { liveFullscreen.pause(); } catch (pauseError) {}
        liveFullscreen.srcObject = null;
      }
      if (liveStart) liveStart.hidden = true;
      var finish = function () {
        liveOverlay.hidden = true;
        var fallback = showRoot.querySelector('[data-cam-start]') ||
          showRoot.querySelector('[data-act="live"]');
        if (liveTrigger && liveTrigger.isConnected) liveTrigger.focus();
        else if (fallback) fallback.focus();
        liveTrigger = null;
      };
      if (liveOverlay.animate && !reducedMotion()) {
        var rect = showRoot.getBoundingClientRect();
        var sx = Math.max(0.01, rect.width / Math.max(1, window.innerWidth));
        var sy = Math.max(0.01, rect.height / Math.max(1, window.innerHeight));
        liveOverlay.animate([
          { transform: 'none', opacity: 1, borderRadius: '0px' },
          { transform: 'translate(' + rect.left + 'px,' + rect.top + 'px) scale(' + sx + ',' + sy + ')',
            opacity: 0.35, borderRadius: '2px' }
        ], { duration: 360, easing: 'cubic-bezier(0.4,0,1,1)', fill: 'forwards' })
          .finished.then(finish).catch(finish);
      } else {
        finish();
      }
    }

    function openLiveOverlay() {
      if (!liveOverlay || !stream) return;
      if (!liveTrigger || !liveTrigger.isConnected) liveTrigger = document.activeElement;
      var rect = showRoot.getBoundingClientRect();
      var sx = Math.max(0.01, rect.width / Math.max(1, window.innerWidth));
      var sy = Math.max(0.01, rect.height / Math.max(1, window.innerHeight));
      liveOverlay.hidden = false;
      liveOverlay.dataset.open = '1';
      liveOverlay.setAttribute('aria-hidden', 'false');
      if (liveFullscreen) {
        setLiveVideo(stream);
      }
      if (liveOverlay.animate && !reducedMotion()) {
        liveOverlay.animate([
          { transform: 'translate(' + rect.left + 'px,' + rect.top + 'px) scale(' + sx + ',' + sy + ')',
            opacity: 0.35, borderRadius: '2px' },
          { transform: 'none', opacity: 1, borderRadius: '0px' }
        ], { duration: 440, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'both' });
      }
      setLiveStatus('Дзеркало відкрите');
      if (liveStart) liveStart.hidden = !canStartServerLive();
      if (liveClose) liveClose.focus();
      setLiveTimer(LIVE_MAX_MS);
    }

    function stopCamera() {
      stopLiveTransport();
      closeLiveOverlay();
      if (!stream) return;
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      notifyGateChange();
    }

    function startServerLive() {
      if (!stream || liveTransport || liveSwitchInFlight || !canStartServerLive()) return;
      if (liveStart) { liveStart.disabled = true; liveStart.hidden = false; }
      setLiveStatus('Налаштовуємо відображення');
      import('./adapters/live-realtime.mjs').then(function (mod) {
        if (!stream || liveTransport) return null;
        return mod.startRealtimeLook({
          bridge: bridge,
          stream: stream,
          onRemoteStream: function (remoteStream) {
            if (!stream || !liveOverlay || liveOverlay.hidden) return;
            setLiveVideo(remoteStream);
          },
          onState: function (event) {
            if (!stream) return;
            if (event && event.phase === 'active') {
              setLiveStatus('Відображення готове');
              setLiveTimer(Number(event.seconds) * 1000);
            }
          },
          onError: function () {
            liveTransport = null;
            if (!stream) return;
            setLiveVideo(stream);
            setLiveStatus('Лишаємось у дзеркалі');
            if (liveStart) { liveStart.disabled = false; liveStart.hidden = !canStartServerLive(); }
            setLiveTimer(LIVE_MAX_MS);
          }
        });
      }).then(function (transport) {
        if (!transport) return;
        if (!stream) { transport.stop(); return; }
        liveTransport = transport;
      }).catch(function () {
        if (!stream) return;
        setLiveVideo(stream);
        setLiveStatus('Лишаємось у дзеркалі');
        if (liveStart) { liveStart.disabled = false; liveStart.hidden = !canStartServerLive(); }
        setLiveTimer(LIVE_MAX_MS);
      });
    }

    function switchLiveLook(nextIndex) {
      if (!stream || liveSwitchInFlight) return false;
      var next = looks[Number(nextIndex)];
      if (!next || !next.saved || !next.lookId || !bridge || !bridgeReady() ||
          typeof bridge.useSavedLook !== 'function') {
        setLiveStatus('Для дзеркала потрібен збережений образ');
        render();
        return false;
      }

      /* Keep the hardware stream and the visible local camera.  Only the provider
       * transport is stopped, because its old reference must never survive under the
       * newly selected look. */
      selected = Number(nextIndex);
      mobileLookChooser = false;
      pickerKind = null;
      awaitingAspect = null;
      view = 'live';
      step = 2;
      liveSwitchInFlight = true;
      stopLiveTransport();
      setLiveStatus('Змінюємо образ…');
      render();
      setLiveVideo(stream);
      notifyGateChange();

      Promise.resolve().then(function () {
        return bridge.useSavedLook(next.lookId);
      }).then(function () {
        liveSwitchInFlight = false;
        if (!stream) return;
        setLiveStatus('Новий образ підключено');
        render();
        setLiveVideo(stream);
        /* The bridge now owns the new immutable white-master reference.  A fresh
         * provider session uses the same local camera tracks; no old remote frame is
         * kept visible while that hand-off happens. */
        startServerLive();
        notifyGateChange();
      }).catch(function () {
        liveSwitchInFlight = false;
        if (!stream) return;
        /* Do not resurrect an old transport after an ambiguous bridge failure: that
         * could display the wrong AI outfit under the newly selected name.  The user
         * remains in the honest local mirror and can select again. */
        setLiveStatus('Не вдалося змінити образ — камера лишається відкритою');
        render();
        setLiveVideo(stream);
        notifyGateChange();
      });
      return true;
    }

    function startCamera() {
      if (stream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (!navigator.mediaDevices) { camError = 'браузер не дає доступу до камери'; render(); }
        return;
      }
      liveTrigger = document.activeElement;
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        .then(function (st) {
          stream = st; camError = '';
          render();
          notifyGateChange();
          var v = showRoot.querySelector('[data-cam]');
          if (v) { v.srcObject = st; v.play().catch(function () {}); }
          openLiveOverlay();
        })
        .catch(function (err) {
          /* Say WHICH refusal it was. "Не вдалося" for a denied permission and for an absent
           * camera sends the viewer looking in two different wrong places. */
          camError = err && err.name === 'NotAllowedError' ? 'доступ до камери відхилено'
                   : err && err.name === 'NotFoundError'   ? 'камери не знайдено'
                   : 'камера недоступна';
          render();
        });
    }

    function liveWindow() {
      if (liveRequirementError) {
        return '<div class="orbfield orbfield--error" data-orb-state="live-error" role="alert">' +
            '<span class="orbfield__label orbfield__label--error">' + esc(liveRequirementError.title) + '</span>' +
            '<span class="orbfield__detail">' + esc(liveRequirementError.body) + '</span>' +
            '<span class="orbfield__detail">' + esc(liveRequirementError.detail) + '</span>' +
          '</div>' +
          '<button class="camctl" type="button" data-live-return>' + esc(liveRequirementError.action) + '</button>';
      }
      if (stream) {
        return '<div class="lookframe" data-state="live">' +
            '<video class="lookframe__cam" data-cam autoplay playsinline muted></video>' +
            '<span class="lookframe__cap">' + esc(liveSwitchInFlight
              ? 'Змінюємо образ…'
              : BACKGROUNDS[current().bg != null ? current().bg : 0]) + '</span>' +
          '</div>' +
          '<button class="camctl" type="button" data-open-look-picker' +
            (liveSwitchInFlight ? ' disabled' : '') + '>Змінити образ</button>' +
          '<button class="camctl" type="button" data-cam-stop>Закрити</button>';
      }
      return orbWindow('live', camError || 'Відкрийте дзеркало') +
        '<button class="camctl" type="button" data-cam-start>' +
          (camError ? 'Спробувати ще' : 'Відкрити дзеркало') + '</button>';
    }

    /* PRODUCT STATE IN, CANONICAL ORB STATE OUT.
     *
     * The visual canon names six states and the product names its own; keeping both was
     * the whole problem, because two vocabularies for one idea drift. Owner decision: the
     * sentence a viewer reads stays the product's, and the motion underneath is the
     * canon's. This table is the single place the two meet. */
    var ORB_CANON = {
      materials: 'listening',   // приймаємо матеріали
      garments:  'listening',   // чекаємо на речі / оберіть речі
      look:      'composing',   // створюємо образ
      shoot:     'working',     // створюємо кадр
      bg:        'working',     // шукаємо світло
      fash:      'working',     // знімаємо рух
      video:     'working',
      live:      'searching',   // відкриваємо дзеркало
      failed:    'solving'      // QA / повтор
    };

    function orbWindow(state, label) {
      var canon = ORB_CANON[state] || 'listening';
      /* A canvas, not a stack of rings. In the answer mirror it occupies a deliberate
       * central field: large enough to read as the room thinking, still transparent enough
       * for the architecture to remain the image. */
      return '<div class="orbfield orbfield--mirror" data-orb-state="' + esc(state) + '" role="status" aria-live="polite">' +
          '<canvas class="orbfield__canvas" data-orb-canvas data-orb-canon="' + esc(canon) + '"' +
            ' width="384" height="384"></canvas>' +
          '<span class="orbfield__label">' + esc(label) + '</span>' +
        '</div>';
    }

    /* Renders replace innerHTML, so a canvas that was drawing a moment ago is gone and a
     * fresh one needs its renderer. Idempotent and cheap: a canvas that already owns an
     * instance is skipped, and one that changed state is retargeted rather than rebuilt. */
    function mountOrbs() {
      var factory = global.WardrobeThinkingOrb;
      if (!factory || typeof factory.create !== 'function') return;
      document.querySelectorAll('[data-orb-canvas]').forEach(function (canvas) {
        var want = canvas.getAttribute('data-orb-canon') || 'listening';
        if (canvas.__orb) {
          if (canvas.__orbState !== want) { canvas.__orb.setState(want); canvas.__orbState = want; }
          return;
        }
        canvas.__orb = factory.create(canvas, want);
        /* Constructing it is not enough. The renderer applies a state — its aria-label, its
         * data-state and its first painted frame — only inside setState, and its own
         * intersection observer never reported this canvas as visible, because it sits
         * inside the transformed film box. Measured before this call: nothing drawn, no
         * label, backing store left at the markup's 56 instead of 112 at DPR 2. Asking for
         * the state we already want is the renderer's own way of starting. */
        canvas.__orb.setState(want);
        canvas.__orbState = want;
      });
    }

    function waitingWindow() {
      if (step === 0) return orbWindow('materials', 'Чекаємо на ваше фото');
      if (step === 1) return orbWindow('garments', hasItems() ? 'Речі готові' : 'Чекаємо на речі');
      return orbWindow('look', 'Створення займає 5–10 хвилин');
    }

    function actionWaitingCopy(kind) {
      return kind === 'shoot' ? 'Створюємо кадр'
           : kind === 'fash'  ? 'Знімаємо рух'
           : kind === 'bg'    ? 'Шукаємо світло'
           : 'Готуємо результат';
    }

    function inputReplacementError(error) {
      return !!(error && (error.code === 'UNSUPPORTED_GARMENT_MEDIA' ||
        error.code === 'IMAGE_TOO_SMALL' || error.code === 'INPUT_REPLACEMENT_REQUIRED'));
    }

    /* The bridge/API already translate known recovery states into Ukrainian.
     * A direct action rejection still reaches this catch path first, so retain
     * that authored fact instead of overwriting it with a misleading generic
     * retry. Unknown transport text remains private and falls back safely. */
    function actionFailureCopy(error) {
      var code = String(error && error.code || '');
      var known = {
        VIDEO_PROVIDER_JOB_FAILED: 'Higgsfield не зміг завершити цей ролик. Можна запустити нову спробу.',
        VIDEO_INPUT_MEDIA_IP_CHECK_PENDING: 'Higgsfield ще перевіряє завантажені медіа. Job не створився; спробуйте ще раз через кілька секунд.',
        VIDEO_AUTOMATIC_RETRY_IN_PROGRESS: 'Сервер уже завершує автоматичну спробу цього відео. Нова генерація не запускалася.',
        VIDEO_PROVIDER_JOB_NOT_FOUND: 'Higgsfield більше не має цей job. Можна створити нову спробу.',
        VIDEO_REFERENCE_QA_FAILED: 'Відео не пройшло перевірку заміни героя. Можна запустити нову спробу.'
      };
      return known[code] || 'Не вдалося завершити цю дію. Спробуйте ще раз.';
    }

    function inputFailureWindow(error) {
      return '<div class="failure-state failure-state--input" role="alert">' +
        '<div class="glass__eyebrow">ПОТРІБНЕ УТОЧНЕННЯ</div>' +
        '<div class="glass__h">Оберіть інше фото</div>' +
        '<p class="glass__lede">' + esc(error && error.message || 'Це фото не можна використати для образу.') + '</p>' +
        '<div class="recovery-actions">' +
          '<button class="glass__cta" type="button" data-retry-action>Замінити фото</button>' +
          '<button class="secondary" type="button" data-cancel-action>До фото</button>' +
        '</div></div>';
    }

    function failureWindow(error) {
      return '<div class="failure-state" role="alert"><div class="glass__eyebrow">Не вдалося завершити</div>' +
        orbWindow('failed', error.message || 'Спробуємо ще раз') +
        '<div class="recovery-actions">' +
          '<button class="glass__cta" type="button" data-retry-action>' +
            'Спробувати ще' + '</button>' +
          '<button class="secondary" type="button" data-cancel-action>До образу</button>' +
        '</div></div>';
    }

    /* Every result frame carries the same admission: no render is attached. The viewer's own
     * photograph is all we have, so it is shown desaturated under the placeholder hatching.
     * An undressed input photo presented as a finished look would be input passed off as
     * output. */
    function shootProgressFrame(result, caption, state) {
      var frames = Array.isArray(result && result.frames) ? result.frames : [];
      var ready = frames.filter(function (frame) { return !!frame.imageUrl; });
      /* Do not depend on Array.prototype.at here: the main site still supports
       * older mobile Safari builds used by the mirror test devices. */
      var lead = ready[ready.length - 1] || ready[0] || null;
      var rail = frames.map(function (frame) {
        var status = frame.imageUrl ? 'ready' : String(frame.status || 'QUEUED').toLowerCase();
        var label = frame.imageUrl ? 'Готово'
          : status === 'failed' ? 'Повторюємо'
          : status === 'running' ? 'Створюємо'
          : status === 'queued' ? 'У черзі'
          : 'Перевіряємо';
        return '<div class="shoot-progress__slot" data-state="' + esc(status) + '" aria-label="Кадр ' + frame.index + ': ' + esc(label) + '">' +
          (frame.imageUrl
            ? '<img src="' + esc(frame.previewUrl || frame.imageUrl) + '" alt="Готовий кадр ' + frame.index + '" decoding="async">' +
              (frame.downloadUrl ? '<a class="shoot-progress__download" href="' + esc(frame.downloadUrl) + '" download>Завантажити</a>' : '')
            : '<span class="shoot-progress__slot-label">' + esc(frame.index + ' · ' + label) + '</span>') +
        '</div>';
      }).join('');
      return '<section class="shoot-progress" data-state="' + esc(state) + '" aria-live="polite">' +
        '<div class="shoot-progress__lead">' +
          (lead ? '<img src="' + esc(lead.previewUrl || lead.imageUrl) + '" alt="Готовий кадр ' + lead.index + '" decoding="async">' : '') +
          '<span class="shoot-progress__count">' + esc((result.readyCount || ready.length) + ' з ' + (result.expectedCount || 5) + ' кадрів готово') + '</span>' +
          (lead && lead.downloadUrl ? '<a class="shoot-progress__lead-download" href="' + esc(lead.downloadUrl) + '" download>Завантажити кадр</a>' : '') +
        '</div>' +
        '<div class="shoot-progress__rail">' + rail + '</div>' +
        '<span class="shoot-progress__caption">' + esc(caption) + '</span>' +
      '</section>';
    }

    function resultFrame(caption, state) {
      var l = current();
      var activeResult = l && l.actionResults && l.actionResults[view === 'bg' ? 'background' : view];
      if (view === 'shoot' && activeResult && Array.isArray(activeResult.frames)) {
        return shootProgressFrame(activeResult, caption, state);
      }
      if (view === 'video' && activeResult && activeResult.kind === 'video' && activeResult.mediaUrl) {
        var downloadUrl = activeResult.downloadUrl || activeResult.mediaUrl;
        return '<div class="lookframe lookframe--video" data-state="ready">' +
          '<video class="lookframe__video" src="' + esc(activeResult.mediaUrl) + '"' +
            (activeResult.posterUrl ? ' poster="' + esc(activeResult.posterUrl) + '"' : '') +
            ' controls playsinline preload="metadata"></video>' +
          '<div class="lookframe__delivery-actions">' +
            '<a href="' + esc(downloadUrl) + '" download>Завантажити MP4</a>' +
            '<button type="button" data-copy-delivery-url="' + esc(activeResult.mediaUrl) + '">Копіювати посилання</button>' +
          '</div>' +
        '</div>';
      }
      var src = activeResult && (activeResult.previewUrl || activeResult.mediaUrl || activeResult.urls && activeResult.urls[0]) ||
        lookDisplayUrl(l) || (!bridge && person.main ? (person.main.previewUrl || person.main.url) : '');
      return '<div class="lookframe" data-state="' + state + '">' +
        (src ? '<img class="lookframe__img" src="' + esc(src) + '" alt="">' : '') +
        '<span class="lookframe__cap">' + esc(caption) + '</span>' +
      '</div>';
    }

    /* THE APPROVED LOOK FRAME — a watermark, not a caption bar. Copied from the same
     * picture as the thumbnail strip: the freshly-made look carries one faint centred
     * word, the way a proof print is stamped, instead of the bottom label the other
     * result states use. */
    /* The look's OWN image, never the uploaded photograph. It used to render
     * `person.main.url`: the source portrait, watermarked with the word for the thing it
     * was standing in for. A viewer reading that frame as their assembled look, with four
     * actions under it, was being shown their own input as a result. */
    function lookResultFrame() {
      var l = current();
      var src = lookDisplayUrl(l);
      return '<div class="lookframe" data-state="ready">' +
        (src ? '<img class="lookframe__img" src="' + esc(src) + '" alt="">' : '') +
        '<span class="lookframe__word">образ</span>' +
      '</div>';
    }

    /* view uses 'video'; the approved table calls the same thing 'fash'. One mapping, here. */
    function activeAct() {
      if (pickerKind) return pickerKind;
      if (awaitingAspect) return awaitingAspect;
      return view === 'video' ? 'fash'
           : view === 'shoot' || view === 'live' || view === 'bg' ? view
           : null;
    }

    function actionBlocks() {
      /* The approved mock always has exactly ONE action lit, and the sentence beneath belongs
       * to it — `focus = focus || 'shoot'` in the concept. So the fallback applies to the
       * underline as well as to the sentence: a sentence about a photoshoot with nothing lit
       * leaves the reader hunting for which word it describes.
       * Lit means "this is what the sentence is about", not "this has been chosen" — nothing
       * is marked done by being read. */
      var on = activeAct() || 'shoot';
      var say = ACTS[on][1];
      var row = ACT_ORDER.map(function (k) {
        return '<button class="act" type="button" data-act="' + k + '"' +
          ' data-on="' + (k === on ? '1' : '0') + '"><b>' + ACTS[k][0] + '</b></button>';
      }).join('');
      return '<div class="actwrap">' +
          '<div class="acts">' + row + '</div>' +
          '<div class="actsay" data-actsay>' + say + '</div>' +
          '<button class="secondary mobile-look-switch" type="button" data-open-look-picker>Образи</button>' +
        '</div>';
    }

    function resultCaption(look) {
      var option = view === 'shoot' ? selectedOption('shoot', look)
                 : view === 'video' ? selectedOption('fash', look)
                 : view === 'bg' ? selectedOption('bg', look) : null;
      return option ? option.name : 'Готовий результат';
    }

    function renderShow() {
      /* The right mirror opens when a look is asked for, so the pending state is itself the
       * reveal. Before that there is no second mirror at all — not a stub, not a plate. */
      /* The right mirror is always the answer surface once the camera has settled.
       * Before a result exists it holds the calm orb; the result replaces that exact
       * aperture, so waiting and arrival are one continuous spatial event. */
      showRoot.setAttribute('data-live', '1');
      showRoot.setAttribute('aria-hidden', station() ? 'false' : 'true');

      /* A first look can fail before there is anything in `looks`. Error recovery must
       * therefore win over both empty-look waiting paths below: otherwise the terminal
       * SSE failure is received but immediately painted back into the indefinite
       * time estimate orb with no retry control. */
      if (actionError) {
        var inputFailure = actionError.kind === 'look' && inputReplacementError(actionError);
        showRoot.innerHTML = scene(inputFailure ? 'look-needs-input' : 'failed-' + actionError.kind,
          inputFailure ? inputFailureWindow(actionError) : failureWindow(actionError));
        applyEnabled();
        return;
      }

      if (!pending && !looks.length) {
        showRoot.innerHTML = scene('waiting-' + step, waitingWindow());
        applyEnabled();
        return;
      }

      if (pending) {
        showRoot.innerHTML = scene('pending-look', orbWindow('look', 'Створення займає 5–10 хвилин'));
        applyEnabled();
        return;
      }

      /* A look exists but its image does not. The orb stays — it IS the generation, and it
       * is the only thing this mirror can honestly hold right now. No frame, and above all
       * no action row: what a viewer may do with a look is a question about a finished
       * look. This is where the journey rests until a real result arrives. */
      if (!hasResult()) {
        showRoot.innerHTML = scene('pending-look', orbWindow('look', 'Створення займає 5–10 хвилин'));
        applyEnabled();
        return;
      }

      /* A core image can be real and useful even when the optional
       * first-appearance evidence needs another pass. Show the image and a
       * retry affordance instead of replacing it with an endless orb. */
      if (lookReview) {
        showRoot.innerHTML = scene('look-review',
          lookResultFrame() +
          '<div class="review-actions" role="status">' +
            '<span class="glass__lede">Образ уже зібраний</span>' +
            '<button class="glass__cta" type="button" data-retry-action>Спробувати ще раз</button>' +
          '</div>');
        applyEnabled();
        return;
      }

      var l = current();
      var progressiveShoot = pendingAction && pendingAction.kind === 'shoot'
        && l && l.actionResults && l.actionResults.shoot
        && l.actionResults.shoot.readyCount > 0;
      if (progressiveShoot) {
        showRoot.innerHTML = scene('shoot-progress',
          '<div class="glass__eyebrow">ФОТОСЕСІЯ · У ПРОЦЕСІ</div>' +
          resultFrame(resultCaption(l), 'ready') +
          '<p class="glass__lede">Готові кадри вже збережені. Інші проходять окремі перевірки та повторюються самостійно.</p>');
        applyEnabled();
        return;
      }

      /* An action (shoot/fash/bg) is working and no Fashion Shoot frame is ready
       * yet. The orb is truthful only for this short initial gap. */
      if (pendingAction) {
        showRoot.innerHTML = scene('pending-' + pendingAction.kind,
          orbWindow(pendingAction.kind, actionWaitingCopy(pendingAction.kind)));
        applyEnabled();
        return;
      }

      /* view 'look' is the approved picture exactly: no eyebrow, no details rows —
       * just the watermarked frame and the action row beneath it. The other views
       * (shoot/video/bg/live) are not what was approved here, so they keep what they had. */
      var head = view === 'shoot' ? 'Фотозйомка'
               : view === 'video' ? 'Фешн-відео'
               : view === 'bg'    ? 'Новий фон'
               : view === 'live'  ? 'Лайв-примірка' : null;
      var cap = view === 'live' ? 'Відкрийте дзеркало' : resultCaption(l);

      showRoot.innerHTML = scene(view,
        (head ? '<div class="glass__eyebrow">' + head + '</div>' : '') +
        (view === 'live' ? liveWindow() : view === 'look' ? lookResultFrame() : resultFrame(cap, 'ready')) +
        (view === 'look' ? '' :
          '<div class="glass__rows glass__rows--show">' +
            '<div class="glass__row"><span>З речей</span> ' + l.items.length + ' ' +
              plural(l.items.length, 'річ', 'речі', 'речей') + '</div>' +
            (l.bg != null ? '<div class="glass__row"><span>Фон</span> ' + esc(BACKGROUNDS[l.bg]) + '</div>' : '') +
          '</div>') +
        actionBlocks());
      applyEnabled();
    }

    /* A station change is a change of PERMISSION, not of content. Re-rendering innerHTML on
     * every flip tore the panels down and rebuilt them — that was the flicker, and it also
     * dropped focus and restarted every image decode mid-swipe. */
    function applyEnabled() {
      /* Every render path already ends here, so this is the one place a freshly written
       * orb canvas can be given its renderer without adding a hook to each call site. */
      mountOrbs();
      var lock = locked();
      document.querySelectorAll('[data-ui-ask] button, [data-ui-show] button, [data-ui-ask] input')
        .forEach(function (el) {
          if (el.hasAttribute('data-presets')) {
            /* Presets are a tray control, not a generation action. They remain available
             * when the five visible slots are full so a text-only preset can be removed;
             * they are unavailable while the camera is moving or files are being prepared. */
            el.disabled = lock || preparingFiles;
            el.setAttribute('aria-disabled', el.disabled ? 'true' : 'false');
            return;
          }
          var blocked = el.getAttribute('data-blocked') === '1';
          var full = el.id === 'io-items' && items.length >= MAX_ITEMS;
          el.disabled = lock || blocked || full || preparingFiles;
          el.setAttribute('aria-disabled', el.disabled ? 'true' : 'false');
        });
      var hint = askRoot.querySelector('[data-hint]');
      if (hint) {
        hint.textContent = (step === 0 && !hasMain()) ? 'потрібне одне фото'
                         : (step === 1 && !hasItems()) ? 'додайте хоча б одну річ'
                         : (step === 1 && !hasUploadedItems()) ? 'додайте фото хоча б однієї речі; готові назви можна додати до фото'
                         : (step === 1 && (adapterLoading || adapterUnavailable || (bridge && !bridgeReady())))
                           ? (bridgeCopy() || 'Ця частина простору ще готується')
                         : preparingFiles ? 'готуємо фото…'
                         : lock ? 'камера рухається — рішення на зупинці' : '';
      }
      syncPanelAccessibility();
    }

    function syncPanelAccessibility() {
      var atStation = station();
      function accessible(root) {
        if (!root || !atStation) return false;
        /* On portrait mobile the active panel is moved into the attention plane. The
         * filmed panel left behind may still contain controls, so hide it from the
         * accessibility tree rather than exposing two competing journeys. A passive
         * waiting/status surface can remain announced when it has no controls. */
        if (!mobileQuery.matches || root.parentNode === mobileRoot) return true;
        return !root.querySelector('button, input, select, textarea, a[href]');
      }
      askRoot.setAttribute('aria-hidden', accessible(askRoot) ? 'false' : 'true');
      showRoot.setAttribute('aria-hidden', accessible(showRoot) ? 'false' : 'true');
    }

    function mobileFocus() {
      /* On a phone there is one attention plane. As soon as a valid look request
       * leaves the garment form, that plane must become the answer mirror: the chosen
       * cards are no longer an action surface while the server is working. Previously
       * `step < 2` won here, so a real pending first look rendered its orb off-plane and
       * the visitor was immediately shown the same “Створити образ” form again. */
      if (mobileLookChooser || pickerKind || awaitingAspect) return 'ask';
      if (bridgeState && (bridgeState.phase === 'needs_input' ||
          bridgeState.phase === 'waiting_for_approval')) return 'ask';
      if (pending || pendingAction || actionError) return 'show';
      if (step < 2) return 'ask';
      return 'show';
    }

    function restorePanel(root, anchor) {
      if (anchor.parentNode && root.parentNode !== anchor.parentNode) {
        anchor.parentNode.insertBefore(root, anchor.nextSibling);
      }
    }

    function syncMobileAttention() {
      var focus = mobileFocus();
      stage.setAttribute('data-ui-step', String(step));
      stage.setAttribute('data-ui-has-look', hasResult() ? '1' : '0');
      stage.setAttribute('data-ui-focus', focus);
      stage.setAttribute('data-ui-picker', pickerKind || awaitingAspect || 'none');

      if (!mobileRoot || !mobileQuery.matches) {
        restorePanel(askRoot, askAnchor);
        restorePanel(showRoot, showAnchor);
        if (mobileRoot) mobileRoot.hidden = true;
        return;
      }

      mobileRoot.hidden = false;
      if (focus === 'ask') {
        restorePanel(showRoot, showAnchor);
        if (askRoot.parentNode !== mobileRoot) mobileRoot.appendChild(askRoot);
      } else {
        restorePanel(askRoot, askAnchor);
        if (showRoot.parentNode !== mobileRoot) mobileRoot.appendChild(showRoot);
      }
    }

    function render() {
      renderAsk();
      renderShow();
      syncMobileAttention();
      syncPanelAccessibility();
    }

    function syncViewportAttention() {
      syncMobileAttention();
      syncPanelAccessibility();
    }
    if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', syncViewportAttention);
    else if (mobileQuery.addListener) mobileQuery.addListener(syncViewportAttention);

    function commitPreparedFiles(kind, prepared) {
      if (kind === 'items') {
        var room = MAX_ITEMS - items.length;
        prepared.slice(0, Math.max(0, room)).forEach(function (entry) {
          var file = entry.file;
          var item = { name: file.name, url: URL.createObjectURL(file), previewUrl: null, file: file };
          items.push(item);
          ensureFilePreview(file, function (previewUrl) {
            if (items.indexOf(item) < 0) return;
            item.previewUrl = previewUrl;
            render();
          }, true);
        });
        return;
      }
      var file = prepared[0] && prepared[0].file;
      if (!file) return;
      if (person[kind] && person[kind].url) URL.revokeObjectURL(person[kind].url);
      if (person[kind] && person[kind].previewUrl && global.URL && global.URL.revokeObjectURL) {
        global.URL.revokeObjectURL(person[kind].previewUrl);
      }
      var personItem = { name: file.name, url: URL.createObjectURL(file), previewUrl: null, file: file };
      person[kind] = personItem;
      ensureFilePreview(file, function (previewUrl) {
        if (person[kind] !== personItem) return;
        personItem.previewUrl = previewUrl;
        render();
      }, true);
    }

    async function prepareSelected(kind, fileList) {
      if (locked() || preparingFiles) return;
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;
      var task = ++uploadTaskId;
      preparingFiles = true;
      uploadError = '';
      render();
      notifyGateChange();
      try {
        var tools = await uploadToolsPromise;
        if (!tools) throw new Error('Не вдалося підготувати це фото');
        var accepted = tools.acceptedDroppedImages(files, { multiple: kind === 'items' });
        if (kind === 'items') accepted = accepted.slice(0, Math.max(0, MAX_ITEMS - items.length));
        var prepared = await Promise.all(accepted.map(function (file) { return tools.prepareImageFile(file); }));
        if (task !== uploadTaskId) return;
        commitPreparedFiles(kind, prepared);
      } catch (error) {
        if (task === uploadTaskId) {
          uploadError = error && error.message
            ? error.message
            : 'Не вдалося підготувати це фото. Оберіть PNG, JPEG, WebP або HEIC.';
        }
      } finally {
        if (task === uploadTaskId) {
          preparingFiles = false;
          render();
          notifyGateChange();
        }
      }
    }

    function removeAt(i) {
      if (items[i] && items[i].url) URL.revokeObjectURL(items[i].url);
      if (items[i] && items[i].previewUrl && global.URL && global.URL.revokeObjectURL) {
        global.URL.revokeObjectURL(items[i].previewUrl);
      }
      items.splice(i, 1);
      render();
    }

    function togglePreset(name) {
      var at = -1;
      for (var i = 0; i < items.length; i++) {
        if (!items[i].url && items[i].name === name) { at = i; break; }
      }
      if (at >= 0) items.splice(at, 1);
      else if (items.length < MAX_ITEMS) items.push({ name: name, url: null });
      render();
    }

    function startGeneratedAction(kind, chosen, aspect) {
      awaitingAspect = null;
      pendingAction = {
        kind: kind, aspect: aspect,
        optionId: chosen ? chosen.id : null,
        optionLabel: chosen ? chosen.name : null
      };
      actionError = null;
      render(); notifyGateChange();

      if (bridge) {
        if (!bridgeReady()) {
          pendingAction = null;
          actionError = { kind: kind, message: bridgeCopy() || 'Ця частина простору ще готується' };
          render(); notifyGateChange();
          return;
        }
        var command;
        if (kind === 'bg') {
          command = bridge.createBackground({
            presetId: chosen && chosen.id,
            presetVersion: chosen && chosen.version,
            aspect: aspect,
            expectedReferencePackSha256: chosen && chosen.referencePackSha256
          });
        } else if (kind === 'shoot') {
          command = bridge.createShoot({
            modeId: chosen && chosen.id,
            modeVersion: chosen && chosen.version
          });
        } else {
          command = bridge.createVideo({
            styleId: chosen && chosen.id,
            motionMode: chosen && chosen.motionMode,
            presentationSurface: chosen && chosen.presentationSurface
          });
        }
        Promise.resolve(command).catch(function (error) {
          pendingAction = null;
          actionError = { kind: kind, code: error && error.code || null, message: actionFailureCopy(error) };
          render(); notifyGateChange();
        });
        return;
      }

      pendingAction = null;
      actionError = { kind: kind, message: 'Ця частина простору ще готується' };
      render(); notifyGateChange();
    }

    document.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if (locked()) return;
      if (t.closest('[data-presets]')) { presetsOpen = !presetsOpen; renderAsk(); return; }

      if ((b = t.closest('[data-garment-category]'))) {
        garmentSelections[b.getAttribute('data-garment-category')] = b.getAttribute('data-garment-id');
        render(); return;
      }
      if (t.closest('[data-garment-continue]')) {
        if (!bridge || !bridgeReady()) return;
        pending = true;
        render(); notifyGateChange();
        bridge.selectGarments(Object.assign({}, garmentSelections)).catch(function () {
          pending = false;
          actionError = { kind: 'look', message: 'Не вдалося зберегти вибір' };
          render(); notifyGateChange();
        });
        return;
      }
      if (t.closest('[data-look-reset]')) {
        if (bridge && bridge.resetLook) bridge.resetLook();
        garmentSelections = {}; garmentChoiceRunId = null;
        pending = false; actionError = null; lookReview = null; step = 0; view = 'look';
        render(); notifyGateChange(); return;
      }
      if (t.closest('[data-shoot-approve]')) {
        if (!bridge || !bridgeReady() || !bridge.approveShoot) return;
        bridge.approveShoot().catch(function () {
          pendingAction = null;
          actionError = { kind: 'shoot', message: 'Не вдалося продовжити фотозйомку' };
          render(); notifyGateChange();
        });
        return;
      }
      if ((b = t.closest('[data-open-saved-shoot]'))) {
        var restoredShoot = current() && current().savedDeliveries && current().savedDeliveries.shoots[Number(b.getAttribute('data-open-saved-shoot'))];
        if (!restoredShoot || !restoredShoot.result) return;
        current().actionResults = current().actionResults || {};
        current().actionResults.shoot = restoredShoot.result;
        current().shot = true;
        pendingAction = null; actionError = null; pickerKind = null; awaitingAspect = null; view = 'shoot';
        render(); notifyGateChange(); return;
      }
      if ((b = t.closest('[data-open-saved-video]'))) {
        var restoredVideo = current() && current().savedDeliveries && current().savedDeliveries.videos[Number(b.getAttribute('data-open-saved-video'))];
        if (!restoredVideo || !restoredVideo.result) return;
        current().actionResults = current().actionResults || {};
        current().actionResults.video = restoredVideo.result;
        current().video = true;
        pendingAction = null; actionError = null; pickerKind = null; awaitingAspect = null; view = 'video';
        render(); notifyGateChange(); return;
      }
      if ((b = t.closest('[data-copy-delivery-url]'))) {
        copyPrivateDeliveryUrl(b.getAttribute('data-copy-delivery-url'), b);
        return;
      }
      if ((b = t.closest('[data-remove]'))) { removeAt(Number(b.getAttribute('data-remove'))); return; }
      if ((b = t.closest('[data-preset]'))) { togglePreset(PRESET_ITEMS[Number(b.getAttribute('data-preset'))]); return; }
      if ((b = t.closest('[data-select]'))) {
        if (stream && mobileLookChooser && view === 'live') {
          switchLiveLook(Number(b.getAttribute('data-select')));
          return;
        }
        stopCamera(); selected = Number(b.getAttribute('data-select'));
        mobileLookChooser = false; pickerKind = null; awaitingAspect = null; view = 'look';
        var selectedLook = current();
        if (selectedLook && selectedLook.saved && bridge && bridge.useSavedLook && selectedLook.lookId) {
          bridge.useSavedLook(selectedLook.lookId).catch(function () {
            actionError = { kind: 'look', message: 'Збережений образ більше недоступний' };
            render(); notifyGateChange();
          });
        }
        render(); notifyGateChange(); return;
      }
      if ((b = t.closest('[data-choice-kind]'))) {
        var choiceKind = b.getAttribute('data-choice-kind');
        var choiceIndex = Number(b.getAttribute('data-choice-index'));
        var choiceLook = current();
        if (!choiceLook || !optionsFor(choiceKind)[choiceIndex]) return;
        if (choiceKind === 'shoot') choiceLook.shootStyle = choiceIndex;
        else if (choiceKind === 'fash') choiceLook.videoStyle = choiceIndex;
        else if (choiceKind === 'bg') choiceLook.bg = choiceIndex;
        else return;
        pickerKind = null;
        if (choiceKind === 'fash') {
          var videoStyle = selectedOption('fash', choiceLook);
          /* The style is the sole owner of its presentation surface. There is no
           * viewer-selectable vertical/horizontal step for Fashion Video. */
          startGeneratedAction('fash', videoStyle, null);
          return;
        }
        awaitingAspect = choiceKind;
        render(); notifyGateChange(); return;
      }
      if (t.closest('[data-picker-back]')) {
        pickerKind = null; awaitingAspect = null; render(); notifyGateChange(); return;
      }
      if (t.closest('[data-open-look-picker]')) {
        if (stream) {
          mobileLookChooser = true;
          pickerKind = null;
          awaitingAspect = null;
          view = 'live';
          step = 2;
          setLiveStatus('Оберіть інший збережений образ');
          render();
          setLiveVideo(stream);
          notifyGateChange();
          return;
        }
        stopCamera(); mobileLookChooser = true; pickerKind = null; awaitingAspect = null; view = 'look';
        render(); notifyGateChange(); return;
      }
      if (t.closest('[data-close-look-picker]')) {
        if (stream) {
          mobileLookChooser = false;
          pickerKind = null;
          awaitingAspect = null;
          view = 'live';
          step = 2;
          render();
          setLiveVideo(stream);
          notifyGateChange();
          return;
        }
        mobileLookChooser = false; pickerKind = null; awaitingAspect = null; view = 'look';
        render(); notifyGateChange(); return;
      }
      if (t.closest('[data-format-back]')) {
        pickerKind = awaitingAspect; awaitingAspect = null; render(); notifyGateChange(); return;
      }
      if (t.closest('[data-edit-items]')) {
        stopCamera(); mobileLookChooser = false; pickerKind = null; awaitingAspect = null;
        step = 1; view = 'look'; render(); return;
      }
      if ((b = t.closest('[data-act]'))) {
        var k = b.getAttribute('data-act');
        actionError = null; mobileLookChooser = false;
        /* Live is not a generated branch. Every generated action opens its visual
         * catalogue on the left mirror first, then the destination format. */
        if (k === 'live') {
          pickerKind = null; awaitingAspect = null; view = 'live'; render(); return;
        }
        if (view === 'live') { stopCamera(); camError = ''; }
        pickerKind = k;
        awaitingAspect = null;
        render(); notifyGateChange(); return;
      }
      if ((b = t.closest('[data-aspect]'))) {
        var kind = awaitingAspect;
        if (!kind) return;
        if (kind === 'fash') {
          var style = selectedOption('fash', current());
          startGeneratedAction('fash', style, null);
          return;
        }
        var aspect = b.getAttribute('data-aspect');
        if (aspect !== '16:9' && aspect !== '9:16') return;
        var chosen = selectedOption(kind, current());
        startGeneratedAction(kind, chosen, aspect);
        return;
      }
      if (t.closest('[data-live-return]')) {
        liveRequirementError = null;
        view = 'look';
        render();
        return;
      }
      if (t.closest('[data-retry-action]')) {
        var inputRejected = inputReplacementError(actionError);
        if (bridge && bridgeReady() && (actionError || lookReview) && !inputRejected) {
          lookReview = null;
          bridge.retryActive().catch(function (error) {
            actionError = {
              kind: actionError && actionError.kind || 'look',
              code: error && error.code || null,
              message: actionFailureCopy(error)
            };
            render(); notifyGateChange();
          });
          actionError = null;
          render(); notifyGateChange();
          return;
        }
        var retryKind = actionError ? actionError.kind : (lookReview ? 'look' : null);
        if (inputRejected && bridge && bridge.resetLook) bridge.resetLook();
        pickerKind = retryKind === 'shoot' || retryKind === 'fash' || retryKind === 'bg' ? retryKind : null;
        if (retryKind === 'look') step = 1;
        awaitingAspect = null; actionError = null; lookReview = null; view = 'look';
        render(); notifyGateChange(); return;
      }
      if (t.closest('[data-cancel-action]')) {
        pickerKind = null; awaitingAspect = null; actionError = null; lookReview = null; view = 'look';
        render(); notifyGateChange(); return;
      }
      if (t.closest('[data-cam-start]')) { startCamera(); return; }
      if (t.closest('[data-cam-stop]')) { stopCamera(); camError = ''; render(); return; }
      if (t.closest('[data-live-start]')) { startServerLive(); return; }
      if (t.closest('[data-live-close]')) { stopCamera(); camError = ''; render(); return; }
      if ((b = t.closest('[data-view]'))) {
        var next = b.getAttribute('data-view');
        /* Leaving the live view switches the device off. Nothing keeps streaming behind a
         * panel the viewer is no longer looking at. */
        if (view === 'live' && next !== 'live') { stopCamera(); camError = ''; }
        view = next;
        var cur = current();
        if (cur) { if (view === 'shoot') cur.shot = true; if (view === 'video') cur.video = true; }
        render(); return;
      }
      if ((b = t.closest('[data-step]'))) {
        pickerKind = null; awaitingAspect = null;
        step = Number(b.getAttribute('data-step')); render(); return;
      }
      if ((b = t.closest('[data-next]')) && !b.disabled) {
        if (step === 0) { if (hasMain()) { step = 1; render(); } }
        else if (step === 1) { makeLook(); }
        else { stopCamera(); step = 1; view = 'look'; render(); }   // another look starts at the things
        return;
      }
      if ((b = t.closest('[data-back]')) && !b.disabled) {
        pickerKind = null; awaitingAspect = null;
        step = Math.max(0, step - 1); render(); return;
      }
    });

    /* HOVERING A WORD SWAPS THE SENTENCE, and nothing else moves.
     * The approved mock keys the sentence off focus, so pointing at an action explains it
     * before committing to it. Written straight into the one text node — a re-render here
     * would rebuild the row under the cursor and drop the hover. */
    ['pointerover', 'focusin'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        var a = ev.target.closest && ev.target.closest('[data-ui-show] [data-act]');
        if (!a) return;
        var say = showRoot.querySelector('[data-actsay]');
        var k = a.getAttribute('data-act');
        if (say && ACTS[k]) say.textContent = ACTS[k][1];
      });
    });
    /* Leaving the row puts the active action's own sentence back. */
    document.addEventListener('pointerout', function (ev) {
      var row = ev.target.closest && ev.target.closest('[data-ui-show] .acts');
      if (!row || (ev.relatedTarget && row.contains(ev.relatedTarget))) return;
      var say = showRoot.querySelector('[data-actsay]');
      if (say) say.textContent = ACTS[activeAct() || 'shoot'][1];
    });

    document.addEventListener('change', function (ev) {
      if (ev.target.matches('#io-items')) prepareSelected('items', ev.target.files);
      else if (ev.target.matches('#io-main')) prepareSelected('main', ev.target.files);
      else if (ev.target.matches('#io-face')) prepareSelected('face', ev.target.files);
    });

    document.addEventListener('keydown', function (ev) {
      var upload = ev.target.closest && ev.target.closest('.pslot[role="button"]');
      if (upload && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        var input = upload.querySelector('input[type="file"]');
        if (input && !input.disabled) input.click();
        return;
      }
      if (!liveOverlay || liveOverlay.hidden) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        stopCamera(); camError = ''; render();
        return;
      }
      /* The immersive plane exposes only its explicit Live action and close. Keep focus
       * inside it until the spatial return has finished. */
      if (ev.key === 'Tab' && liveClose) {
        ev.preventDefault();
        if (liveStart && !liveStart.hidden && document.activeElement === liveClose) liveStart.focus();
        else liveClose.focus();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && stream) {
        stopCamera();
        camError = '';
        render();
      }
    });

    /* Delegated drop handling survives the mirror's innerHTML renders. It mirrors beta's
     * nested drag depth so a child thumbnail cannot make the highlight blink off. */
    var dragZone = null;
    var dragDepth = 0;
    function clearDragState() {
      if (dragZone) dragZone.classList.remove('is-dragover');
      dragZone = null; dragDepth = 0;
    }
    function hasDraggedFiles(dataTransfer) {
      return !!dataTransfer && (Array.prototype.indexOf.call(dataTransfer.types || [], 'Files') >= 0
        || Number(dataTransfer.files && dataTransfer.files.length || 0) > 0);
    }
    document.addEventListener('dragenter', function (ev) {
      var zone = ev.target.closest && ev.target.closest('.pslot, .slot--drop');
      if (!zone || locked() || preparingFiles || !hasDraggedFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      if (dragZone && dragZone !== zone) dragZone.classList.remove('is-dragover');
      dragZone = zone; dragDepth += 1; zone.classList.add('is-dragover');
    });
    document.addEventListener('dragover', function (ev) {
      var zone = ev.target.closest && ev.target.closest('.pslot, .slot--drop');
      if (!zone || locked() || preparingFiles || !hasDraggedFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      if (dragZone !== zone) {
        if (dragZone) dragZone.classList.remove('is-dragover');
        dragZone = zone; dragDepth = 0;
      }
      zone.classList.add('is-dragover');
    });
    document.addEventListener('dragleave', function (ev) {
      if (!hasDraggedFiles(ev.dataTransfer)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) clearDragState();
    });
    document.addEventListener('drop', function (ev) {
      var zone = ev.target.closest && ev.target.closest('.pslot, .slot--drop');
      if (!zone || locked() || preparingFiles || !hasDraggedFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      ev.stopPropagation();
      clearDragState();
      var input = zone.querySelector('input');
      var kind = input && input.id === 'io-main' ? 'main'
        : input && input.id === 'io-face' ? 'face' : 'items';
      prepareSelected(kind, ev.dataTransfer.files);
    });
    window.addEventListener('drop', clearDragState);
    window.addEventListener('dragend', clearDragState);

    new MutationObserver(applyEnabled)
      .observe(stage, { attributes: true, attributeFilter: ['data-station', 'data-leg'] });

    if (bridge) {
      adapterLoading = false;
      bindBridge(bridge);
    } else {
      render();
      /* Dynamic import keeps b/index.html free of API knowledge and lets any future
       * presentation bundle reuse this exact UI file. A supplied warm promise was
       * started while intro media loaded; the fallback remains for other hosts that
       * instantiate this UI directly. Failure is fail-closed: the mirror never falls
       * back to a timer-generated fake result. */
      var bridgeTask = bridgePromise && typeof bridgePromise.then === 'function'
        ? bridgePromise
        : import('./adapters/cinematic-ui-bridge.mjs').then(function (module) {
          var loaded = module.createCinematicUiBridge();
          global.WardrobeCinematicBridge = loaded;
          return loaded;
        });
      bridgeTask.then(function (loaded) {
        if (!loaded) throw new Error('CINEMATIC_BRIDGE_UNAVAILABLE');
        adapterLoading = false;
        bindBridge(loaded);
      }).catch(function () {
        adapterLoading = false;
        adapterUnavailable = true;
        bridgeState = { availability: 'unavailable', phase: 'idle', activeKind: null };
        render(); notifyGateChange();
      });
    }

    return {
      state: function () {
        return {
          step: step, stepId: STEPS[step].id,
          person: { main: !!person.main, face: !!person.face },
          hasMain: hasMain(),
          items: items.map(function (i) { return { name: i.name, uploaded: !!i.url }; }),
          itemCount: items.length, max: MAX_ITEMS,
          looks: looks.map(function (l) {
            return { id: l.id, items: l.items.length,
                     background: l.bg != null ? BACKGROUNDS[l.bg] : null,
                     shootStyle: l.shootStyle != null ? SHOOT_STYLES[l.shootStyle].name : null,
                     videoStyle: l.videoStyle != null ? VIDEO_STYLES[l.videoStyle].name : null,
                     shot: l.shot, video: l.video };
          }),
          selected: selected, lookVisible: lookVisible(), pending: pending,
          awaitingAspect: awaitingAspect, pendingAction: pendingAction,
          actionError: actionError,
          pickerKind: pickerKind, mobileLookChooser: mobileLookChooser, bgOpen: pickerKind === 'bg',
          view: view, cameraOn: !!stream, cameraError: camError || null,
          liveError: liveRequirementError ? { ...liveRequirementError } : null,
          actionsOffered: lookVisible(),
          simulated: false,
          bridge: bridgeState ? {
            availability: bridgeState.availability,
            releaseSha: bridgeState.releaseSha || null,
            phase: bridgeState.phase,
            activeKind: bridgeState.activeKind || null
          } : null,
          sells: false,                  // no prices, no basket, by canon
          station: station(), controlsEnabled: !locked()
        };
      },
      /* Asked by the engine at every station through config.canAdvance.
       * Leg 0 holds until a look exists — the next room is a gallery of finished work, so
       * arriving with nothing made would be arriving at an empty shelf. Long Fashion Video
       * generation is deliberately different: TV is its gallery, so the viewer may leave
       * the mirror while the server job continues and the result arrives there later. */
      canAdvance: function (leg) {
        if (leg !== 0) return true;
        if (!looks.length) return false;
        if (!hasResult()) return false;
        if (pickerKind || awaitingAspect) return false;
        var videoMayContinue = (pendingAction && pendingAction.kind === 'fash') ||
          (bridgeState && bridgeState.activeKind === 'video' && bridgeWorking());
        if (pendingAction && !videoMayContinue) return false;
        if (stream) return false;
        if (!videoMayContinue && bridge && bridge.canLeaveAttentionStation && !bridge.canLeaveAttentionStation()) return false;
        return true;
      },
      /* THE ONLY WAY AN IMAGE BECOMES A RESULT.
       *
       * There is no generation route on this page yet, so nothing calls this in normal use
       * and the journey rests on the orb — which is the honest state, not a defect. The
       * adapter will call it when a real look returns; until then it is also how a result
       * can be put on the glass deliberately for review. Opening the forward gate lives
       * here because arrival of the image is the event that makes the next room meaningful. */
      setLookResult: function (asset) {
        var l = current();
        var source = typeof asset === 'string' ? { image_url: asset } : asset;
        var assets = lookAssets(source, '');
        if (!l || !(assets.masterUrl || assets.displayFallback)) return false;
        l.result = assets.masterUrl || assets.displayFallback;
        l.resultUrl = l.result;
        l.masterSourceUrl = assets.masterUrl || '';
        l.resultPreviewUrl = assets.displayUrl !== l.result ? assets.displayUrl : null;
        l.masterSha256 = assets.masterSha256;
        l.cutoutNativeUrl = assets.cutoutNativeUrl;
        l.cutoutNativeSha256 = assets.cutoutNativeSha256;
        l.cutoutPreviewUrl = assets.cutoutPreviewUrl;
        l.cutoutPreviewSha256 = assets.cutoutPreviewSha256;
        l.cutoutNativeSourceMasterSha256 = assets.nativeBound ? assets.masterSha256 : null;
        l.cutoutNativeHasAlpha = assets.nativeBound;
        ensureMasterCutout(l);
        render();
        if (typeof opts.onLookReady === 'function') opts.onLookReady();
        return true;
      },
      /* The orb renderer is a deferred module, so it can arrive after the first render has
       * already written its canvas. This lets it announce itself instead of the waiting
       * state having to poll for it. */
      refreshOrbs: mountOrbs,
      /* The fixed chrome needs one safe way back to a saved look.  It deliberately
       * leaves any independent Fashion Video or Fashion Shoot job running; returning to
       * the library changes the viewing context, never the server job.  On portrait this
       * also promotes the left-mirror library into the one usable attention plane. */
      openLookLibrary: function () {
        stopCamera();
        pickerKind = null;
        awaitingAspect = null;
        mobileLookChooser = true;
        if (looks.length) {
          if (!current()) selected = 0;
          step = 2;
        } else {
          step = hasMain() ? 1 : 0;
        }
        view = 'look';
        render();
        notifyGateChange();
        return looks.length > 0;
      },
      addPreset: function (name) { togglePreset(name); return items.length; },
      makeLook: makeLook,
      setLiveError: function (error) {
        liveRequirementError = liveLookErrorCopy(error);
        stopCamera();
        view = 'live';
        render();
        return { ...liveRequirementError };
      },
      clearLiveError: function () {
        liveRequirementError = null;
        render();
      },
      setBridge: bindBridge,
      showFailure: function (kind, message) {
        if (kind !== 'shoot' && kind !== 'fash' && kind !== 'bg') kind = 'look';
        pendingAction = null;
        actionError = { kind: kind, message: message || 'Спробуємо ще раз' };
        render(); notifyGateChange();
      },
      steps: STEPS, presets: PRESET_ITEMS, backgrounds: BACKGROUNDS,
      backgroundOptions: BACKGROUND_OPTIONS, shootStyles: SHOOT_STYLES, videoStyles: VIDEO_STYLES
    };
  }

  global.WardrobeUI = {
    create: create,
    STEPS: STEPS,
    MAX_ITEMS: MAX_ITEMS,
    LIVE_LOOK_INCOMPLETE_COPY: LIVE_LOOK_INCOMPLETE_COPY
  };
})(window);
