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
    var person = { full: null, face: null };

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

    /* What the last programmatic travel did: 'arrived' means the page moved the viewer,
     * 'user took over' means they moved themselves. Different facts. */
    var travel = null;

    function station() { return stage.getAttribute('data-station') === '1'; }
    function locked() { return !station(); }
    function hasFull() { return !!person.full; }
    function hasItems() { return items.length >= MIN_ITEMS; }
    function current() { return selected >= 0 ? looks[selected] : null; }
    /* THE gate for every action: a look with things in it must be VISIBLE first. */
    function lookVisible() { return !!current() && !pending; }

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function plural(n, one, few, many) { return n === 1 ? one : n < 5 ? few : many; }

    function makeLook() {
      if (!hasFull() || !hasItems() || pending) return;
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
        /* Forward travel was closed until a look existed, so the page carries the viewer on
         * itself rather than leaving them to discover that scrolling works again. The move
         * belongs to the engine — this layer never animates position, or there would be two
         * clocks. */
        if (typeof opts.onLookReady === 'function') opts.onLookReady();
      }, SIM_MS);
    }

    /* ============================================================== ASK — left mirror */

    function photoSlot(kind, label, note) {
      var p = person[kind];
      return '<label class="pslot' + (p ? ' pslot--has' : '') + '" for="io-' + kind + '">' +
        (p ? '<img class="pslot__img" src="' + p.url + '" alt="">'
           : '<span class="pslot__t">' + label + '</span>') +
        '<span class="pslot__n">' + (p ? 'замінити' : note) + '</span>' +
        '<input id="io-' + kind + '" type="file" accept="image/*" hidden>' +
      '</label>';
    }

    function askPerson() {
      return '<div class="pslots">' +
          photoSlot('full', 'на весь зріст', 'потрібне') +
          photoSlot('face', 'обличчя', 'за бажанням') +
        '</div>' +
        '<p class="glass__lede">Зріст — зі ступнями, інакше образ нема на чому тримати. ' +
        'Обличчя окремо, бо на повному кадрі його не прочитати.</p>';
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

    /* At the mirrors the left pane is where you CHOOSE: which look is the context, and —
     * when asked for — which background it stands in. */
    function askLooks() {
      var l = current();
      var strip = looks.map(function (x, i) {
        return '<button class="lookpick" type="button" data-select="' + i + '"' +
          ' aria-pressed="' + (i === selected ? 'true' : 'false') + '">' +
          '<span class="lookpick__n">' + (i + 1) + '</span>' +
          '<span class="lookpick__d">' + x.items.length + ' ' +
            plural(x.items.length, 'річ', 'речі', 'речей') + '</span>' +
          (x.bg != null ? '<span class="lookpick__b">' + esc(BACKGROUNDS[x.bg]) + '</span>' : '') +
        '</button>';
      }).join('');
      return '<div class="lookpicks">' + strip + '</div>' +
        (bgOpen && l
          ? '<div class="rowpick">' + BACKGROUNDS.map(function (o, i) {
              return '<button class="rowpick__item" type="button" data-bg="' + i + '"' +
                ' aria-pressed="' + (l.bg === i ? 'true' : 'false') + '">' +
                '<span class="rowpick__name">' + esc(o) + '</span></button>';
            }).join('') + '</div>'
          : '');
    }

    function renderAsk() {
      var s = STEPS[step];
      var blocked = (step === 0 && !hasFull()) || (step === 1 && (!hasItems() || pending));

      /* UNREACHED STEPS ARE NOT RENDERED AT ALL. A greyed-out label still advertises an
       * offer, and there is no offer before the thing it applies to exists. */
      var reachable = [true, hasFull(), looks.length > 0];
      var doneFlag  = [hasFull(), looks.length > 0, looks.length > 0];
      var trail = STEPS.map(function (x, i) {
        if (!reachable[i]) return '';
        return '<button class="trail__i" type="button" data-step="' + i + '"' +
          ' aria-current="' + (step === i ? 'step' : 'false') + '" data-done="' + (doneFlag[i] ? '1' : '0') + '">' +
          x.label + '</button>';
      }).join('');

      var body = step === 0 ? askPerson() : step === 1 ? askItems() : askLooks();

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

    /* Every result frame carries the same admission: no render is attached. The viewer's own
     * photograph is all we have, so it is shown desaturated under the placeholder hatching.
     * An undressed input photo presented as a finished look would be input passed off as
     * output. */
    function resultFrame(caption, state) {
      var src = person.full ? person.full.url : '';
      return '<div class="lookframe" data-state="' + state + '">' +
        (src ? '<img class="lookframe__img" src="' + src + '" alt="">' : '') +
        '<span class="lookframe__cap">' + caption + '</span>' +
      '</div>';
    }

    function actionBlocks() {
      var l = current();
      /* PHOTOSHOOT AND FASHION VIDEO ARE SIBLINGS, not a shoot with a video bolted on. The
       * canon is explicit: the fashion style is one for now and it must be a full offer. So
       * they sit in one row at equal weight, and neither is a footnote to the other. */
      return '<div class="acts2">' +
          '<button class="act" type="button" data-view="shoot" aria-pressed="' + (view === 'shoot' ? 'true' : 'false') + '">' +
            '<span class="act__t">Фотозйомка в стилі</span>' +
            '<span class="act__d">' + (l.shot ? 'зроблено' : 'згенерувати') + '</span></button>' +
          '<button class="act" type="button" data-view="video" aria-pressed="' + (view === 'video' ? 'true' : 'false') + '">' +
            '<span class="act__t">Фешн-відео</span>' +
            '<span class="act__d">' + (l.video ? 'зроблено' : 'згенерувати') + '</span></button>' +
        '</div>' +
        '<div class="acts2">' +
          '<button class="act" type="button" data-bgopen aria-pressed="' + (bgOpen ? 'true' : 'false') + '">' +
            '<span class="act__t">Змінити фон</span>' +
            '<span class="act__d">' + (l.bg != null ? esc(BACKGROUNDS[l.bg]) : 'обрати') + '</span></button>' +
          '<button class="act" type="button" data-view="live" aria-pressed="' + (view === 'live' ? 'true' : 'false') + '">' +
            '<span class="act__t">Приміряти лайв</span>' +
            '<span class="act__d">камера</span></button>' +
        '</div>' +
        /* The OMNI 3 branch exists only once a background is chosen — it generates video ON
         * that background, so without one there is nothing to generate onto. */
        (l.bg != null
          ? '<button class="act act--wide" type="button" data-view="video" data-omni>' +
              '<span class="act__t">Відео на фоні «' + esc(BACKGROUNDS[l.bg]) + '»</span>' +
              '<span class="act__d">згенерувати в OMNI 3</span></button>'
          : '');
    }

    function renderShow() {
      /* The right mirror opens when a look is asked for, so the pending state is itself the
       * reveal. Before that there is no second mirror at all — not a stub, not a plate. */
      var open = pending || looks.length > 0;
      showRoot.setAttribute('data-live', open ? '1' : '0');
      showRoot.setAttribute('aria-hidden', open ? 'false' : 'true');

      var lab = document.querySelector('[data-livelab]');
      if (lab) {
        lab.setAttribute('data-live', lookVisible() ? '1' : '0');
        lab.setAttribute('aria-hidden', lookVisible() ? 'false' : 'true');
        lab.disabled = !lookVisible() || locked();
      }

      if (!open) { showRoot.innerHTML = ''; return; }

      if (pending) {
        showRoot.innerHTML = '<div class="glass__eyebrow">Образ створюється</div>' +
          resultFrame('створюємо образ…', 'pending');
        applyEnabled();
        return;
      }

      var l = current();
      var head = view === 'shoot' ? 'Фотозйомка'
               : view === 'video' ? 'Фешн-відео'
               : view === 'live'  ? 'Лайв-примірка' : 'Ваш образ';
      var cap = view === 'live' ? 'камера не підключена' : 'рендер не підключений';

      showRoot.innerHTML =
        '<div class="glass__eyebrow">' + head + '</div>' +
        resultFrame(cap, 'ready') +
        '<div class="glass__rows glass__rows--show">' +
          '<div class="glass__row"><span>З речей</span> ' + l.items.length + ' ' +
            plural(l.items.length, 'річ', 'речі', 'речей') + '</div>' +
          (l.bg != null ? '<div class="glass__row"><span>Фон</span> ' + esc(BACKGROUNDS[l.bg]) + '</div>' : '') +
        '</div>' +
        actionBlocks();
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
        hint.textContent = (step === 0 && !hasFull()) ? 'потрібне одне фото на весь зріст'
                         : (step === 1 && !hasItems()) ? 'додайте хоча б одну річ'
                         : lock ? 'камера рухається — рішення на зупинці' : '';
      }
      var lab = document.querySelector('[data-livelab]');
      if (lab) lab.disabled = !lookVisible() || lock;
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
      if ((b = t.closest('[data-select]'))) { selected = Number(b.getAttribute('data-select')); view = 'look'; render(); return; }
      if ((b = t.closest('[data-bg]'))) {
        var lb = current(); if (lb) lb.bg = Number(b.getAttribute('data-bg'));
        bgOpen = false; render(); return;
      }
      if (t.closest('[data-bgopen]')) { bgOpen = !bgOpen; render(); return; }
      if ((b = t.closest('[data-view]'))) {
        view = b.getAttribute('data-view');
        var cur = current();
        if (cur) { if (view === 'shoot') cur.shot = true; if (view === 'video') cur.video = true; }
        render(); return;
      }
      if ((b = t.closest('[data-step]'))) { step = Number(b.getAttribute('data-step')); render(); return; }
      if ((b = t.closest('[data-next]')) && !b.disabled) {
        if (step === 0) { if (hasFull()) { step = 1; render(); } }
        else if (step === 1) { makeLook(); }
        else { step = 1; view = 'look'; render(); }   // another look starts at the things
        return;
      }
      if ((b = t.closest('[data-back]')) && !b.disabled) { step = Math.max(0, step - 1); render(); return; }
    });

    document.addEventListener('change', function (ev) {
      if (ev.target.matches('#io-items')) addFiles(ev.target.files);
      else if (ev.target.matches('#io-full')) setPhoto('full', ev.target.files[0]);
      else if (ev.target.matches('#io-face')) setPhoto('face', ev.target.files[0]);
    });

    ['dragover', 'drop'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        var zone = ev.target.closest && ev.target.closest('.pslot, .slot--drop');
        if (!zone || locked()) return;
        ev.preventDefault();
        if (type !== 'drop' || !ev.dataTransfer || !ev.dataTransfer.files) return;
        var inp = zone.querySelector('input');
        if (inp && inp.id === 'io-full') setPhoto('full', ev.dataTransfer.files[0]);
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
          person: { full: !!person.full, face: !!person.face },
          hasFull: hasFull(),
          items: items.map(function (i) { return { name: i.name, uploaded: !!i.url }; }),
          itemCount: items.length, max: MAX_ITEMS,
          looks: looks.map(function (l) {
            return { id: l.id, items: l.items.length,
                     background: l.bg != null ? BACKGROUNDS[l.bg] : null,
                     shot: l.shot, video: l.video };
          }),
          selected: selected, lookVisible: lookVisible(), pending: pending,
          view: view, bgOpen: bgOpen,
          actionsOffered: lookVisible(),
          simulated: true,               // no render backend is attached to this page
          sells: false,                  // no prices, no basket, by canon
          station: station(), controlsEnabled: !locked(), travel: travel
        };
      },
      /* Asked by the engine at every station through config.canAdvance. Leg 0 holds until a
       * look exists: the next room is a gallery of finished work, so arriving with nothing
       * made would be arriving at an empty shelf. */
      canAdvance: function (leg) { return leg === 0 ? looks.length > 0 : true; },
      travelled: function (how) { travel = how || null; return travel; },
      addPreset: function (name) { togglePreset(name); return items.length; },
      makeLook: makeLook,
      steps: STEPS, presets: PRESET_ITEMS, backgrounds: BACKGROUNDS
    };
  }

  global.WardrobeUI = { create: create, STEPS: STEPS, MAX_ITEMS: MAX_ITEMS };
})(window);
