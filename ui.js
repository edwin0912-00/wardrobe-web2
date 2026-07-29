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
 * WHAT IS SIMULATED, STATED PLAINLY: no generation backend is attached to this page. Every
 * result frame is a declared stand-in that says so on its face, and state() reports
 * `simulated: true`. No stock photograph is ever shown as output.
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

  /* How long a result frame sits pending. A stated stand-in for a request that does not
   * exist yet, not an estimate of anything. */
  var SIM_MS = 1100;

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
    var pendingTimer = 0;

    /* Which face of the selected look the right mirror is showing. */
    var view = 'look';          // 'look' | 'shoot' | 'video' | 'live'
    var bgOpen = false;         // the background list is open in the left mirror

    /* An action (shoot/fash/bg — not live) waits for its aspect pick, then runs a
     * generating phase before it resolves. Both states gate the scroll: a light swipe
     * must not carry the viewer off a room that is still working. */
    var awaitingAspect = null;   // null | 'shoot' | 'fash' | 'bg'
    var pendingAction = null;    // null | { kind, aspect }
    var pendingActionTimer = 0;

    function notifyGateChange() { if (typeof opts.onGateChange === 'function') opts.onGateChange(); }

    function station() { return stage.getAttribute('data-station') === '1'; }
    function locked() { return !station(); }
    function hasMain() { return !!person.main; }
    function hasItems() { return items.length >= MIN_ITEMS; }
    function current() { return selected >= 0 ? looks[selected] : null; }
    /* THE gate for every action: a look with things in it must be VISIBLE first. */
    function lookVisible() { return !!current() && !pending; }

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function plural(n, one, few, many) { return n === 1 ? one : n < 5 ? few : many; }

    function makeLook() {
      if (!hasMain() || !hasItems() || pending) return;
      pending = true; view = 'look';
      render();
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(function () {
        looks.push({ id: 'look-' + (looks.length + 1), items: items.slice(),
                     bg: null, shot: false, video: false });
        selected = looks.length - 1;
        items = [];                 // the next look starts empty
        pending = false;
        step = 2;
        render();
        /* Forward travel was closed until a look existed; this is only the unlock. The
         * viewer stays exactly where they are, at the mirrors, with the action row now
         * reachable — moving them on automatically would carry them past the very row this
         * step exists to reveal. */
        if (typeof opts.onLookReady === 'function') opts.onLookReady();
      }, SIM_MS);
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
          photoSlot('face', 'обличчя', 'детальніше, за бажанням') +
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
        '<input id="io-items" type="file" accept="image/*" multiple hidden' + (full ? ' disabled' : '') + '>' +
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

    function renderAsk() {
      /* THE APPROVED LOOKS SCREEN has its own shape entirely — no eyebrow, no generic
       * CTA, no trail — so it bypasses the shared template below rather than bending it
       * to fit. */
      if (step === 2) { renderAskLook(); return; }

      var s = STEPS[step];
      var blocked = (step === 0 && !hasMain()) || (step === 1 && (!hasItems() || pending));

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
            (pending ? 'Створюємо…' : s.cta) +
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

    /* Every result frame carries the same admission: no render is attached. The viewer's own
     * photograph is all we have, so it is shown desaturated under the placeholder hatching.
     * An undressed input photo presented as a finished look would be input passed off as
     * output. */
    function resultFrame(caption, state) {
      var src = person.main ? person.main.url : '';
      return '<div class="lookframe" data-state="' + state + '">' +
        (src ? '<img class="lookframe__img" src="' + src + '" alt="">' : '') +
        '<span class="lookframe__cap">' + caption + '</span>' +
      '</div>';
    }

    /* THE APPROVED LOOK FRAME — a watermark, not a caption bar. Copied from the same
     * picture as the thumbnail strip: the freshly-made look carries one faint centred
     * word, the way a proof print is stamped, instead of the bottom label the other
     * result states use. */
    function lookResultFrame() {
      var src = person.main ? person.main.url : '';
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
        '</div>';
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
      var open = pending || looks.length > 0;
      showRoot.setAttribute('data-live', open ? '1' : '0');
      showRoot.setAttribute('aria-hidden', open ? 'false' : 'true');

      /* The invitation only exists once there is a look to try things on. */
      var invite = document.querySelector('[data-live-invite]');
      if (invite) {
        invite.setAttribute('data-live', lookVisible() && view !== 'live' ? '1' : '0');
        invite.setAttribute('aria-hidden', lookVisible() && view !== 'live' ? 'false' : 'true');
        invite.disabled = !lookVisible() || locked() || view === 'live';
      }

      if (!open) { showRoot.innerHTML = ''; return; }

      if (pending) {
        showRoot.innerHTML = '<div class="glass__eyebrow">Образ створюється</div>' +
          resultFrame('створюємо образ…', 'pending');
        applyEnabled();
        return;
      }

      /* An action (shoot/fash/bg) is working — no result to show yet, and nothing to
       * click until it clears. Same pending treatment as the look itself, labelled for
       * which action it is. */
      if (pendingAction) {
        showRoot.innerHTML = '<div class="glass__eyebrow">' + esc(ACTS[pendingAction.kind][0]) + '</div>' +
          resultFrame('генерується…', 'pending');
        applyEnabled();
        return;
      }

      var l = current();
      /* view 'look' is the approved picture exactly: no eyebrow, no details rows —
       * just the watermarked frame and the action row beneath it. The other views
       * (shoot/video/bg/live) are not what was approved here, so they keep what they had. */
      var head = view === 'shoot' ? 'Фотозйомка'
               : view === 'video' ? 'Фешн-відео'
               : view === 'bg'    ? 'Новий фон'
               : view === 'live'  ? 'Лайв-примірка' : null;
      var cap = view === 'live' ? 'камера не підключена' : 'рендер не підключений';

      showRoot.innerHTML =
        (head ? '<div class="glass__eyebrow">' + head + '</div>' : '') +
        (view === 'live' ? liveWindow() : view === 'look' ? lookResultFrame() : resultFrame(cap, 'ready')) +
        (view === 'look' ? '' :
          '<div class="glass__rows glass__rows--show">' +
            '<div class="glass__row"><span>З речей</span> ' + l.items.length + ' ' +
              plural(l.items.length, 'річ', 'речі', 'речей') + '</div>' +
            (l.bg != null ? '<div class="glass__row"><span>Фон</span> ' + esc(BACKGROUNDS[l.bg]) + '</div>' : '') +
          '</div>') +
        (awaitingAspect ? aspectPicker(awaitingAspect) : actionBlocks());
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
                         : lock ? 'камера рухається — рішення на зупинці' : '';
      }
      var invite = document.querySelector('[data-live-invite]');
      if (invite) invite.disabled = !lookVisible() || lock || view === 'live';
    }

    function render() { renderAsk(); renderShow(); }

    function addFiles(fileList) {
      var room = MAX_ITEMS - items.length;
      Array.prototype.slice.call(fileList, 0, Math.max(0, room)).forEach(function (f) {
        items.push({ name: f.name, url: URL.createObjectURL(f) });
      });
      render();
    }

    function setPhoto(kind, file) {
      if (!file) return;
      /* Release the old object URL: camera-sized photographs are real memory and nothing
       * else references them. */
      if (person[kind] && person[kind].url) URL.revokeObjectURL(person[kind].url);
      person[kind] = { name: file.name, url: URL.createObjectURL(file) };
      render();
    }

    function removeAt(i) {
      if (items[i] && items[i].url) URL.revokeObjectURL(items[i].url);
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

    document.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if (t.closest('[data-presets]')) { presetsOpen = !presetsOpen; renderAsk(); return; }
      if (locked()) return;

      if ((b = t.closest('[data-remove]'))) { removeAt(Number(b.getAttribute('data-remove'))); return; }
      if ((b = t.closest('[data-preset]'))) { togglePreset(PRESET_ITEMS[Number(b.getAttribute('data-preset'))]); return; }
      if ((b = t.closest('[data-select]'))) { stopCamera(); selected = Number(b.getAttribute('data-select')); view = 'look'; render(); return; }
      if ((b = t.closest('[data-bg]'))) {
        var lb = current(); if (lb) lb.bg = Number(b.getAttribute('data-bg'));
        bgOpen = false;
        /* Choosing a background is what actually starts "Новий фон" — the video on it.
         * Same aspect-then-generate flow as shoot/fash below. */
        awaitingAspect = 'bg';
        render(); return;
      }
      if (t.closest('[data-bgopen]')) { bgOpen = !bgOpen; render(); return; }
      if (t.closest('[data-edit-items]')) { stopCamera(); step = 1; view = 'look'; render(); return; }
      if ((b = t.closest('[data-act]'))) {
        var k = b.getAttribute('data-act');
        if (k === 'bg') { bgOpen = !bgOpen; render(); return; }
        /* Live is not a generation — there is nothing to await an aspect for, it just
         * opens the camera. shoot/fash do generate, so they ask which aspect first. */
        if (k === 'live') { view = 'live'; render(); return; }
        awaitingAspect = k;
        render(); return;
      }
      if ((b = t.closest('[data-aspect]'))) {
        var kind = awaitingAspect;
        if (!kind) return;
        var aspect = b.getAttribute('data-aspect');
        awaitingAspect = null;
        pendingAction = { kind: kind, aspect: aspect };
        render(); notifyGateChange();
        clearTimeout(pendingActionTimer);
        pendingActionTimer = setTimeout(function () {
          var want = kind === 'fash' ? 'video' : kind;
          if (view === 'live' && want !== 'live') { stopCamera(); camError = ''; }
          view = want;
          var cur3 = current();
          if (cur3) {
            if (kind === 'shoot') { cur3.shot = true; cur3.shotAspect = aspect; }
            if (kind === 'fash')  { cur3.video = true; cur3.videoAspect = aspect; }
            if (kind === 'bg')    { cur3.bgVideo = true; cur3.bgAspect = aspect; }
          }
          pendingAction = null;
          render(); notifyGateChange();
          /* 16:9 belongs on the television — go look at it there. 9:16 belongs right
           * here in the mirror; nothing carries the viewer anywhere for it. */
          if (aspect === '16:9' && typeof opts.onWideResult === 'function') opts.onWideResult();
        }, SIM_MS);
        return;
      }
      if (t.closest('[data-cam-start]')) { startCamera(); return; }
      if (t.closest('[data-cam-stop]')) { stopCamera(); camError = ''; render(); return; }
      if (t.closest('[data-live-invite]')) { view = 'live'; render(); return; }
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

    render();

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
          awaitingAspect: awaitingAspect, pendingAction: pendingAction,
          view: view, bgOpen: bgOpen, cameraOn: !!stream, cameraError: camError || null,
          actionsOffered: lookVisible(),
          simulated: true,               // no render backend is attached to this page
          sells: false,                  // no prices, no basket, by canon
          station: station(), controlsEnabled: !locked()
        };
      },
      /* Asked by the engine at every station through config.canAdvance.
       * Leg 0 holds until a look exists — the next room is a gallery of finished work, so
       * arriving with nothing made would be arriving at an empty shelf. It also holds
       * while an action is actually working: generating a photoshoot/video/background
       * (`pendingAction`), or the live camera actually streaming (`stream`) — a swipe
       * should not carry the viewer off a room that's still busy. */
      canAdvance: function (leg) {
        if (leg !== 0) return true;
        if (!looks.length) return false;
        if (pendingAction) return false;
        if (stream) return false;
        return true;
      },
      addPreset: function (name) { togglePreset(name); return items.length; },
      makeLook: makeLook,
      steps: STEPS, presets: PRESET_ITEMS, backgrounds: BACKGROUNDS
    };
  }

  global.WardrobeUI = { create: create, STEPS: STEPS, MAX_ITEMS: MAX_ITEMS };
})(window);
