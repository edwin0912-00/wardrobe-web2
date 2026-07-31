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
 * RESULTS ARE NEVER SIMULATED. The mirror receives runs through the presentation-neutral
 * ZeelyClient bridge. Until the same-origin /api gateway is ready, an unfinished mirror
 * remains calm and non-interactive; a local input photo is never passed off as an output.
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

  /* The three places where the viewer is asked something, in travel order. Named for the
   * place, because that is what the canon fixes — the surface follows the room. */
  var STEPS = [
    { id: 'person', label: 'ВИ',     title: 'Завантажте себе',  cta: 'Далі — речі' },
    { id: 'items',  label: 'РЕЧІ',   title: 'Ваші пʼять речей', cta: 'Створити образ' },
    { id: 'looks',  label: 'ОБРАЗИ', title: 'Ваш образ',        cta: 'Ще один образ' }
  ];

  /* Secondary path only — for someone with nothing to photograph. */
  var PRESET_ITEMS = [
    'вовняний джемпер', 'бавовняна сорочка', 'лляні штани', 'вовняні брюки',
    'широкі джинси', 'довге пальто', 'вʼязаний кардиган', 'шкіряні лофери', 'білі кеди'
  ];
  var BACKGROUNDS = ['ця квартира', 'бетонна галерея', 'ранкове місто', 'студія, нейтральний фон'];

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

  /* THE ASPECT CHOICE. No real backend means no real result to read an aspect off of, so
   * the viewer states it up front instead — and the choice decides where the result gets
   * watched: 16:9 belongs on the television, 9:16 belongs right here in the mirror. */
  var ASPECTS = ['16:9', '9:16'];

  function create(opts) {
    opts = opts || {};
    var askRoot = document.querySelector('[data-ui-ask]') || document.querySelector('[data-ui-state]');
    var showRoot = document.querySelector('[data-ui-show]') || document.querySelector('[data-ui-step]');
    var stage = document.querySelector('[data-stage]');
    if (!askRoot || !showRoot) return null;

    var step = 0;

    /* TWO PHOTOGRAPHS OF THE VIEWER, doing different jobs. Full length with feet is
     * required — a look cropped at the shins cannot be dressed below the crop. The face
     * close-up is optional and exists because a reference only carries what DISTINGUISHES:
     * at full-length scale there is no face to read. */
    var person = { main: null, face: null };

    /* The things currently being gathered for the NEXT look. */
    var items = [];
    var presetsOpen = false;

    /* Several looks are allowed, and one is selected. Each carries what was done to it, so
     * the actions are per-look rather than global. */
    var looks = [];
    var selected = -1;
    var pending = false;
    var submittedItems = null;

    /* This is deliberately a bridge, not a beta UI import. It is supplied by the small
     * ES module loaded by b/index.html and can be replaced in tests or by a future site
     * shell. Before it is ready, no click can manufacture a successful result locally. */
    var bridge = opts.bridge || global.WardrobeCinematicBridge || null;
    var bridgeState = bridge && typeof bridge.state === 'function'
      ? bridge.state()
      : { availability: 'checking', phase: 'idle', run: null, choices: [], result: null };
    var bridgeUnsubscribe = null;
    var garmentSelections = {};

    /* Which face of the selected look the right mirror is showing. */
    var view = 'look';          // 'look' | 'shoot' | 'video' | 'live'
    var bgOpen = false;         // the background list is open in the left mirror

    function notifyGateChange() { if (typeof opts.onGateChange === 'function') opts.onGateChange(); }

    function station() { return stage.getAttribute('data-station') === '1'; }
    function locked() { return !station(); }
    function hasMain() { return !!person.main; }
    /* The real engine requires a source image for each garment. Preset words belonged to
     * the old demo only; counting one as a submission would make a live-looking control
     * fail only after the click. */
    function hasItems() { return items.some(function (item) { return !!item.file; }); }
    function current() { return selected >= 0 ? looks[selected] : null; }
    /* THE gate for every action: a look with things in it must be VISIBLE first. */
    function lookVisible() { return !!current() && !pending; }

    function bridgeReady() { return !!bridge && bridgeState.availability === 'ready'; }
    function bridgeWorking() {
      return ['uploading', 'running', 'needs_input', 'waiting_for_approval', 'recovering']
        .indexOf(bridgeState.phase) >= 0;
    }
    function bridgeCopy() {
      var copy = {
        checking: 'Відкриваємо дзеркало',
        unavailable: 'Ця частина простору ще готується',
        uploading: 'Приймаємо матеріали',
        running: 'Збираємо образ',
        needs_input: 'Оберіть речі',
        waiting_for_approval: 'Готуємо наступний кадр',
        recovering: 'Повертаємося до образу',
        completed: 'Образ готовий',
        failed: 'Не вдалося завершити'
      };
      return copy[bridgeState.availability === 'unavailable' ? 'unavailable' : bridgeState.phase] || copy.checking;
    }

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function plural(n, one, few, many) { return n === 1 ? one : n < 5 ? few : many; }

    function addCompletedRun(run) {
      if (!run || run.status !== 'COMPLETED' || !run.outputs || !run.outputs.avatar_outfit) return;
      var at = looks.findIndex(function (look) { return look.runId === run.run_id; });
      var existing = at >= 0 ? looks[at] : null;
      var next = {
        id: bridgeState.savedLook && bridgeState.savedLook.look_id || run.run_id,
        runId: run.run_id,
        lookId: bridgeState.savedLook && bridgeState.savedLook.look_id || null,
        imageUrl: run.outputs.avatar_outfit,
        items: submittedItems ? submittedItems.slice() : existing ? existing.items : items.slice(),
        bg: null, shot: false, video: false
      };
      if (at >= 0) looks[at] = Object.assign(looks[at], next);
      else { looks.push(next); at = looks.length - 1; }
      selected = at;
      items = [];
      submittedItems = null;
      pending = false;
      step = 2;
      if (typeof opts.onLookReady === 'function') opts.onLookReady();
    }

    function receiveBridge(event) {
      bridgeState = event || bridgeState;
      var run = bridgeState.run;
      pending = bridgeWorking() && bridgeState.phase !== 'needs_input';
      if (bridgeState.phase === 'needs_input') step = 1;
      if (run && run.status === 'COMPLETED') addCompletedRun(run);
      if (run && bridgeState.savedLook && selected >= 0 && looks[selected] && looks[selected].runId === run.run_id) {
        looks[selected].lookId = bridgeState.savedLook.look_id || looks[selected].lookId;
        looks[selected].id = looks[selected].lookId || looks[selected].id;
      }
      render();
      notifyGateChange();
    }

    function bindBridge(next) {
      if (bridgeUnsubscribe) bridgeUnsubscribe();
      bridge = next || null;
      bridgeState = bridge && typeof bridge.state === 'function'
        ? bridge.state()
        : { availability: 'checking', phase: 'idle', run: null, choices: [], result: null };
      bridgeUnsubscribe = bridge && typeof bridge.subscribe === 'function'
        ? bridge.subscribe(receiveBridge)
        : null;
      render();
      notifyGateChange();
    }

    function makeLook() {
      if (!hasMain() || !hasItems() || pending || !bridgeReady() || !bridge || !bridge.canStartLook()) return;
      submittedItems = items.slice();
      pending = true; view = 'look';
      render();
      bridge.createLook({
        person: person.main.file,
        identityDetail: person.face && person.face.file,
        garments: items.filter(function (item) { return !!item.file; }).map(function (item) { return item.file; })
      }).catch(function () {
        /* The bridge records the failure and tells the right mirror. Do not turn it into
         * a local "ready" frame or a guessed progress value. */
      });
    }

    /* ============================================================== ASK — left mirror */

    /* The plus is the affordance: an empty dashed box with two lines of text did not read
     * as an upload target on its own, so an empty slot now says so with a glyph before it
     * says anything else. Gone the moment a photograph fills the slot — the photograph
     * itself is the evidence then, and "замінити" takes over as the one word that matters. */
    function photoSlot(kind, label, note) {
      var p = person[kind];
      return '<label class="pslot' + (p ? ' pslot--has' : '') + '" for="io-' + kind + '">' +
        (p ? '<img class="pslot__img" src="' + p.url + '" alt="">'
           : '<span class="pslot__plus" aria-hidden="true">+</span><span class="pslot__t">' + label + '</span>') +
        '<span class="pslot__n">' + (p ? 'замінити' : note) + '</span>' +
        '<input id="io-' + kind + '" type="file" accept="image/*" hidden>' +
      '</label>';
    }

    function askPerson() {
      /* No pose dictated. The full-body mandate was the earlier assumption — the owner
       * rejected it outright — so this slot now asks for a photo, not a stance. `full` stays
       * the internal name only because hasMain()/gates elsewhere key on it; nothing here
       * tells the viewer how to stand or frame themselves. */
      return '<div class="pslots">' +
          photoSlot('main', 'ваше фото', 'потрібне') +
          photoSlot('face', 'обличчя', 'за бажанням') +
        '</div>' +
        '<p class="glass__lede">Обличчя окремо — за бажанням, якщо хочете точніше.</p>';
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
              (it.url ? '<img class="slot__img" src="' + it.url + '" alt="">'
                      : '<span class="slot__ph"><span class="ph__g ph__g--garment"></span></span>') +
              '<button class="slot__x" type="button" data-remove="' + i + '" aria-label="прибрати">×</button>' +
            '</div>'
          : '<label class="slot slot--drop" data-filled="0" for="io-items">' +
              '<span class="slot__empty">' + (i + 1) + '</span></label>';
      }
      return '<div class="slots slots--big">' + cells + '</div>' +
        '<input id="io-items" type="file" accept="image/*" multiple hidden' + (full ? ' disabled' : '') + '>';
    }

    /* Small counts read as words in running Ukrainian text ("три речі"), not digits —
     * matches the approved picture, which never puts a numeral in a sentence. */
    var NUM_WORDS = ['', 'одна', 'дві', 'три', 'чотири', 'пʼять', 'шість'];
    function numWord(n) { return NUM_WORDS[n] || String(n); }

    function lookLede(l) {
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
        var thumb = l.items[0] && l.items[0].url;
        return '<button class="lookthumb" type="button" data-select="' + i + '"' +
          ' aria-pressed="' + (i === selected ? 'true' : 'false') + '">' +
          (thumb ? '<img class="lookthumb__img" src="' + thumb + '" alt="">' : '') +
          '</button>';
      }).join('');
      /* Padded to at least four so the row reads as an ongoing strip rather than a tally
       * that stops. The empty cells are inert — a fifth action hiding as a thumbnail
       * would be exactly the kind of thing the approved row was designed to avoid. */
      for (var i = looks.length; i < 4; i++) cells += '<span class="lookthumb" aria-hidden="true"></span>';
      return cells;
    }

    /* The background picker survives from the earlier build: it opens from the 'bg'
     * action in the right mirror regardless of which screen this is, so it is appended
     * here rather than folded into the approved layout above, which has no such state
     * in the picture it was copied from. */
    function bgPicker() {
      var l = current();
      if (!bgOpen || !l) return '';
      return '<div class="rowpick">' + BACKGROUNDS.map(function (o, i) {
        return '<button class="rowpick__item" type="button" data-bg="' + i + '"' +
          ' aria-pressed="' + (l.bg === i ? 'true' : 'false') + '">' +
          '<span class="rowpick__name">' + esc(o) + '</span></button>';
      }).join('') + '</div>';
    }

    function renderAskLook() {
      var l = current();
      askRoot.innerHTML =
        '<div class="glass__h">Образ ' + (selected + 1) + '</div>' +
        '<p class="glass__lede">' + esc(lookLede(l)) + '</p>' +
        '<div class="looklabel">ваші образи</div>' +
        '<div class="lookthumbs">' + askLookThumbs() + '</div>' +
        '<button class="secondary" type="button" data-edit-items>Змінити речі</button>' +
        bgPicker();
      applyEnabled();
    }

    /* If the engine needs a real choice between garments, that question remains on the
     * left mirror. The right mirror only holds the orb, so selection and outcome never
     * compete on the same piece of glass. */
    function renderGarmentChoice() {
      var choices = bridgeState.choices || [];
      var complete = choices.length > 0 && choices.every(function (choice) {
        return !!garmentSelections[choice.category];
      });
      var groups = choices.map(function (choice) {
        var options = choice.options.map(function (reference) {
          var on = garmentSelections[choice.category] === reference;
          return '<button class="rowpick__item" type="button" data-garment-choice="' +
            encodeURIComponent(choice.category) + '" data-garment-reference="' + encodeURIComponent(reference) +
            '" aria-pressed="' + (on ? 'true' : 'false') + '"><span class="rowpick__name">обрати</span></button>';
        }).join('');
        return '<div class="choicegroup"><div class="glass__lede">оберіть одну річ</div><div class="rowpick">' + options + '</div></div>';
      }).join('');
      askRoot.innerHTML =
        '<div class="glass__eyebrow">РЕЧІ</div>' +
        '<div class="glass__h">Оберіть речі</div>' +
        '<div class="askbody">' + groups + '</div>' +
        '<div class="acts"><button class="glass__cta" type="button" data-submit-garments data-blocked="' + (!complete ? '1' : '0') + '">Продовжити</button></div>';
      applyEnabled();
    }

    function renderAsk() {
      /* THE APPROVED LOOKS SCREEN has its own shape entirely — no eyebrow, no generic
       * CTA, no trail — so it bypasses the shared template below rather than bending it
       * to fit. */
      if (bridgeState.phase === 'needs_input' && (bridgeState.choices || []).length) {
        renderGarmentChoice(); return;
      }
      if (step === 2) { renderAskLook(); return; }

      var s = STEPS[step];
      var blocked = (step === 0 && !hasMain()) || (step === 1 && (!hasItems() || pending || !bridgeReady()));

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

      askRoot.innerHTML =
        /* Digits and a slash, never "КРОК 1 З 3": at this tracking the Cyrillic З between
         * two digits reads as a third digit — on screen it said "КРОК 1 3 3". */
        '<div class="glass__eyebrow">0' + (step + 1) + ' / 0' + STEPS.length + ' · ' + s.label + '</div>' +
        '<div class="glass__h">' + s.title + '</div>' +
        '<div class="askbody">' + body + '</div>' +
        '<div class="acts">' +
          (step > 0 ? '<button class="glass__cta glass__cta--ghost" type="button" data-back>Назад</button>' : '') +
          '<button class="glass__cta" type="button" data-next data-blocked="' + (blocked ? '1' : '0') + '">' +
            (pending ? 'Збираємо…' : s.cta) +
          '</button>' +
        '</div>' +
        '<p class="glass__hint" data-hint></p>' +
        '<div class="trail">' + trail + '</div>';
      applyEnabled();
    }

    /* ============================================================ SHOW — right mirror */

    /* THE CAMERA. Held here so it can be switched off again: a live view that leaves the
     * device streaming after the viewer has moved on is a privacy fault, not a feature.
     * Nothing is requested until the viewer presses for it — arriving at the mirror must not
     * by itself turn a camera on. */
    var stream = null;
    var camError = '';

    function stopCamera() {
      if (!stream) return;
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      notifyGateChange();
    }

    function startCamera() {
      if (stream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (!navigator.mediaDevices) { camError = 'браузер не дає доступу до камери'; render(); }
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        .then(function (st) {
          stream = st; camError = '';
          render();
          notifyGateChange();
          var v = showRoot.querySelector('[data-cam]');
          if (v) { v.srcObject = st; v.play().catch(function () {}); }
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
      if (stream) {
        return '<div class="lookframe" data-state="live">' +
            '<video class="lookframe__cam" data-cam autoplay playsinline muted></video>' +
            '<span class="lookframe__cap">камера · ' + esc(BACKGROUNDS[current().bg != null ? current().bg : 0]) + '</span>' +
          '</div>' +
          '<button class="camctl" type="button" data-cam-stop>Вимкнути камеру</button>';
      }
      return '<div class="lookframe" data-state="camoff">' +
          '<span class="lookframe__cap">' + (camError ? esc(camError) : 'камера вимкнена') + '</span>' +
        '</div>' +
        '<button class="camctl" type="button" data-cam-start>' +
          (camError ? 'Спробувати ще' : 'Увімкнути камеру') + '</button>';
    }

    /* A completed output can only originate from the engine URL. The local portrait stays
     * in the input slot and is never used as a stand-in result. */
    function resultFrame(caption, state, src) {
      return '<div class="lookframe" data-state="' + state + '">' +
        (src ? '<img class="lookframe__img" src="' + src + '" alt="">' : '') +
        '<span class="lookframe__cap">' + caption + '</span>' +
      '</div>';
    }

    function waitingOrb(copy, phase) {
      return '<div class="mirror-orb" data-phase="' + esc(phase) + '" role="status" aria-live="polite">' +
          '<i class="mirror-orb__halo" aria-hidden="true"></i>' +
          '<i class="mirror-orb__core" aria-hidden="true"></i>' +
          '<span class="mirror-orb__copy">' + esc(copy) + '</span>' +
        '</div>';
    }

    /* THE APPROVED LOOK FRAME — a watermark, not a caption bar. Copied from the same
     * picture as the thumbnail strip: the freshly-made look carries one faint centred
     * word, the way a proof print is stamped, instead of the bottom label the other
     * result states use. */
    function lookResultFrame() {
      var look = current();
      var src = look && look.imageUrl ? look.imageUrl : '';
      return '<div class="lookframe" data-state="ready">' +
        (src ? '<img class="lookframe__img" src="' + src + '" alt="">' : '') +
        '<span class="lookframe__word">образ</span>' +
      '</div>';
    }

    /* view uses 'video'; the approved table calls the same thing 'fash'. One mapping, here. */
    function activeAct() {
      return view === 'video' ? 'fash'
           : view === 'shoot' || view === 'live' || view === 'bg' ? view
           : bgOpen ? 'bg' : null;
    }

    function actionBlocks() {
      /* Secondary actions are intentionally absent until their catalog/approval contract is
       * wired through the same bridge. A beautiful action row that resolves to a local timer
       * is worse than no row; the result remains real and usable. */
      return '';
    }

    /* THE ASPECT PICK. No real backend to read a result's aspect off of, so the viewer
     * states it before generating — and it decides where the result gets watched (see
     * onWideResult below). Same list-of-choices shape as the background picker
     * (`.rowpick`), not a new pattern. */
    function aspectPicker(kind) {
      return '<div class="actwrap">' +
          '<div class="actsay">' + esc(ACTS[kind][1]) + ' — який формат?</div>' +
          '<div class="rowpick">' + ASPECTS.map(function (a) {
            return '<button class="rowpick__item" type="button" data-aspect="' + a + '">' +
              '<span class="rowpick__name">' + a + '</span></button>';
          }).join('') + '</div>' +
        '</div>';
    }

    function renderShow() {
      /* The right mirror opens when a look is asked for, so the pending state is itself the
       * reveal. Before that there is no second mirror at all — not a stub, not a plate. */
      var bridgePending = bridgeWorking();
      var bridgeFailed = bridgeState.phase === 'failed';
      var open = bridgePending || bridgeFailed || looks.length > 0;
      showRoot.setAttribute('data-live', open ? '1' : '0');
      showRoot.setAttribute('aria-hidden', open ? 'false' : 'true');

      /* The invitation only exists once there is a look to try things on. */
      var invite = document.querySelector('[data-live-invite]');
      if (invite) {
        /* Live needs its own server capability and 40-second contract. Keep the global
         * invitation absent until that real flow is wired rather than opening a local-only
         * camera and implying that the product session has started. */
        invite.setAttribute('data-live', '0');
        invite.setAttribute('aria-hidden', 'true');
        invite.disabled = true;
      }

      if (!open) { showRoot.innerHTML = ''; return; }

      if (bridgePending) {
        showRoot.innerHTML = waitingOrb(bridgeCopy(), bridgeState.phase);
        applyEnabled();
        return;
      }

      if (bridgeFailed) {
        showRoot.innerHTML = waitingOrb(bridgeCopy(), 'failed') +
          (bridgeReady() && bridge && bridgeState.run
            ? '<button class="glass__cta" type="button" data-retry-look>Спробувати ще раз</button>'
            : '');
        applyEnabled();
        return;
      }

      showRoot.innerHTML = lookResultFrame() + actionBlocks();
      applyEnabled();
    }

    /* A station change is a change of PERMISSION, not of content. Re-rendering innerHTML on
     * every flip tore the panels down and rebuilt them — that was the flicker, and it also
     * dropped focus and restarted every image decode mid-swipe. */
    function applyEnabled() {
      var lock = locked();
      document.querySelectorAll('[data-ui-ask] button, [data-ui-show] button, [data-ui-ask] input')
        .forEach(function (el) {
          if (el.hasAttribute('data-presets')) return;
          var blocked = el.getAttribute('data-blocked') === '1';
          var full = el.id === 'io-items' && items.length >= MAX_ITEMS;
          el.disabled = lock || blocked || full;
        });
      var hint = askRoot.querySelector('[data-hint]');
      if (hint) {
        hint.textContent = (step === 0 && !hasMain()) ? 'потрібне одне фото'
                         : (step === 1 && !hasItems()) ? 'додайте хоча б одну річ'
                         : (step === 1 && !bridgeReady()) ? bridgeCopy()
                         : lock ? 'камера рухається — рішення на зупинці' : '';
      }
      var invite = document.querySelector('[data-live-invite]');
      if (invite) invite.disabled = true;
    }

    function render() { renderAsk(); renderShow(); }

    function addFiles(fileList) {
      var room = MAX_ITEMS - items.length;
      Array.prototype.slice.call(fileList, 0, Math.max(0, room)).forEach(function (f) {
        items.push({ name: f.name, file: f, url: URL.createObjectURL(f) });
      });
      render();
    }

    function setPhoto(kind, file) {
      if (!file) return;
      /* Release the old object URL: camera-sized photographs are real memory and nothing
       * else references them. */
      if (person[kind] && person[kind].url) URL.revokeObjectURL(person[kind].url);
      person[kind] = { name: file.name, file: file, url: URL.createObjectURL(file) };
      render();
    }

    function removeAt(i) {
      if (items[i] && items[i].url) URL.revokeObjectURL(items[i].url);
      items.splice(i, 1);
      render();
    }

    document.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if (locked()) return;

      if ((b = t.closest('[data-remove]'))) { removeAt(Number(b.getAttribute('data-remove'))); return; }
      if ((b = t.closest('[data-select]'))) { stopCamera(); selected = Number(b.getAttribute('data-select')); view = 'look'; render(); return; }
      if (t.closest('[data-edit-items]')) { stopCamera(); step = 1; view = 'look'; render(); return; }
      if ((b = t.closest('[data-garment-choice]'))) {
        garmentSelections[decodeURIComponent(b.getAttribute('data-garment-choice'))] =
          decodeURIComponent(b.getAttribute('data-garment-reference'));
        renderAsk(); return;
      }
      if ((b = t.closest('[data-submit-garments]')) && !b.disabled) {
        if (!bridge || !bridgeReady()) return;
        bridge.selectGarments(garmentSelections).catch(function () {});
        return;
      }
      if (t.closest('[data-retry-look]')) {
        if (bridge && bridgeReady()) bridge.retryLook().catch(function () {});
        return;
      }
      if ((b = t.closest('[data-step]'))) { step = Number(b.getAttribute('data-step')); render(); return; }
      if ((b = t.closest('[data-next]')) && !b.disabled) {
        if (step === 0) { if (hasMain()) { step = 1; render(); } }
        else if (step === 1) { makeLook(); }
        else { stopCamera(); step = 1; view = 'look'; render(); }   // another look starts at the things
        return;
      }
      if ((b = t.closest('[data-back]')) && !b.disabled) { step = Math.max(0, step - 1); render(); return; }
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
      if (ev.target.matches('#io-items')) addFiles(ev.target.files);
      else if (ev.target.matches('#io-main')) setPhoto('main', ev.target.files[0]);
      else if (ev.target.matches('#io-face')) setPhoto('face', ev.target.files[0]);
    });

    ['dragover', 'drop'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        var zone = ev.target.closest && ev.target.closest('.pslot, .slot--drop');
        if (!zone || locked()) return;
        ev.preventDefault();
        if (type !== 'drop' || !ev.dataTransfer || !ev.dataTransfer.files) return;
        var inp = zone.querySelector('input');
        if (inp && inp.id === 'io-main') setPhoto('main', ev.dataTransfer.files[0]);
        else if (inp && inp.id === 'io-face') setPhoto('face', ev.dataTransfer.files[0]);
        else addFiles(ev.dataTransfer.files);
      });
    });

    new MutationObserver(applyEnabled)
      .observe(stage, { attributes: true, attributeFilter: ['data-station', 'data-leg'] });

    if (bridge) bindBridge(bridge);
    else render();

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
                     shot: l.shot, video: l.video };
          }),
          selected: selected, lookVisible: lookVisible(), pending: pending,
          bridge: {
            availability: bridgeState.availability,
            phase: bridgeState.phase,
            runId: bridgeState.run && bridgeState.run.run_id || null,
            choices: (bridgeState.choices || []).length
          },
          view: view, bgOpen: bgOpen, cameraOn: !!stream, cameraError: camError || null,
          actionsOffered: false,
          simulated: false,
          sells: false,                  // no prices, no basket, by canon
          station: station(), controlsEnabled: !locked()
        };
      },
      /* Asked by the engine at every station through config.canAdvance.
       * Leg 0 holds until a look exists — the next room is a gallery of finished work, so
       * arriving with nothing made would be arriving at an empty shelf. It also holds
       * while a real engine job is working. An unavailable gateway does not trap a person
       * inside the room: it disables the submission affordance but leaves the film free. */
      canAdvance: function (leg) {
        if (leg !== 0) return true;
        if (!bridgeReady()) return true;
        if (!looks.length) return false;
        return bridge ? bridge.canLeaveAttentionStation() : true;
      },
      makeLook: makeLook,
      setBridge: bindBridge,
      steps: STEPS, backgrounds: BACKGROUNDS
    };
  }

  global.WardrobeUI = { create: create, STEPS: STEPS, MAX_ITEMS: MAX_ITEMS };
})(window);
