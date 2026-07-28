/* WARDROBE — the interface on the glass.
 *
 * Information architecture comes from the handoff, not from here:
 *
 *   Required:            LOOK -> WORLD -> MOTION
 *   Optional premium:    SIGNATURE
 *   Optional beta edge:  LIVE LAB
 *
 * And two behavioural rules from the same source:
 *
 *   "Product decisions мають відбуватися на стабільних зупинках, а не під час руху
 *    камери" — controls are inert unless the engine reports a station. Nothing here
 *    reads scroll; it watches the flag the engine writes.
 *
 *   "image input/output та зрозумілі кнопки" — every step takes an input and names its
 *    output, and buttons say what they do.
 *
 * THREE INTERACTION MODELS are implemented behind a switch, because the open question is
 * which one fits — arrows, a list, or a tray. Visual style is deliberately identical
 * across all three so the comparison is about behaviour and nothing else.
 *
 *   carousel  one slot at a time, ‹ › to cycle, the look assembles as you go
 *   list      all slots visible at once, picking one reveals its options in a row
 *   tray      slots on the left, a full tray of options along the bottom of the glass
 *
 * Left pane is always STATE (what exists so far). Right pane is always ACTION. The
 * concrete pier between the two mirrors is the divider, which is what makes two panes
 * structural rather than decorative.
 */
(function (global) {
  'use strict';

  /* The wardrobe. Slots are the parts of a look; each carries real options so the
   * choosing is exercised rather than implied. */
  var SLOTS = [
    { id: 'top',   label: 'Верх',   options: ['вовняний джемпер', 'бавовняна сорочка', 'трикотажний лонгслів', 'лляний жакет'] },
    { id: 'bottom', label: 'Низ',   options: ['лляні штани', 'вовняні брюки', 'широкі джинси', 'спідниця міді'] },
    { id: 'shoes', label: 'Взуття', options: ['без взуття', 'шкіряні лофери', 'білі кеди', 'замшеві боти'] },
    { id: 'layer', label: 'Шар',    options: ['без шару', 'довге пальто', 'вʼязаний кардиган', 'дощовик'] }
  ];

  var STEPS = [
    { id: 'look',   label: 'LOOK',   title: 'Зібрати образ', input: 'ваші речі', output: 'аватар в образі', cta: 'Створити образ' },
    { id: 'world',  label: 'WORLD',  title: 'Обрати світ',   input: 'локація',   output: 'фон під образ',   cta: 'Створити світ' },
    { id: 'motion', label: 'MOTION', title: 'Оживити',       input: 'образ і світ', output: 'фільм',        cta: 'Створити фільм' }
  ];

  var WORLDS = ['ця квартира', 'бетонна галерея', 'ранкове місто', 'студія, нейтральний фон'];
  var MOTIONS = ['повільний оберт', 'крок до камери', 'вітер у тканині', 'статичний портрет'];

  function create() {
    var stateRoot = document.querySelector('[data-ui-state]');
    var stepRoot = document.querySelector('[data-ui-step]');
    var stage = document.querySelector('[data-stage]');
    if (!stateRoot || !stepRoot) return null;

    var variant = 'carousel';
    var step = 0;                       // 0 look, 1 world, 2 motion
    var slot = 0;                       // active slot inside LOOK
    var chosen = { top: 0, bottom: 0, shoes: 0, layer: 0 };
    var world = 0, motion = 0;
    var doneLook = false, doneWorld = false, doneMotion = false;
    var signature = false;

    function station() { return stage.getAttribute('data-station') === '1'; }
    function locked() { return !station(); }

    /* ---------------------------------------------------------------- state pane */
    function renderState() {
      /* The assembled look, one row per slot, each with the slot where its image lands. */
      var rows = SLOTS.map(function (s, i) {
        var on = (step === 0 && i === slot);
        return '<button class="step step--withph" type="button" data-slot="' + i + '"' +
          ' aria-current="' + (on ? 'step' : 'false') + '" data-done="1">' +
          tile('garment', s.label) +
          '<span class="step__label">' + s.options[chosen[s.id]] + '</span>' +
          '<span class="step__status">' + (on ? 'зараз' : 'змінити') + '</span>' +
          '</button>';
      }).join('');

      var stepRows = STEPS.map(function (s, i) {
        var done = (i === 0 && doneLook) || (i === 1 && doneWorld) || (i === 2 && doneMotion);
        return '<button class="step" type="button" data-step="' + i + '"' +
          ' aria-current="' + (step === i ? 'step' : 'false') + '" data-done="' + (done ? '1' : '0') + '"' +
          (i === 0 || doneLook ? '' : ' disabled') + '>' +
          '<span class="step__n">' + (i + 1) + '</span>' +
          '<span class="step__label">' + s.label + '</span>' +
          '<span class="step__status">' + (done ? 'готово' : step === i ? 'зараз' : 'далі') + '</span>' +
          '</button>';
      }).join('');

      stateRoot.innerHTML =
        '<div class="glass__eyebrow">Дзеркало</div>' +
        '<div class="glass__h">' + (step === 0 ? 'Ваш образ' : 'Що вже зібрано') + '</div>' +
        '<div class="steps">' + (step === 0 ? rows : stepRows) + '</div>' +
        '<div class="opt">' +
          '<button class="opt__btn" type="button" data-signature aria-pressed="' + (signature ? 'true' : 'false') + '">' +
            'SIGNATURE · власна фотосесія</button>' +
          '<p class="opt__note">' + (signature ? 'додано' : 'необовʼязково, за вашими референсами') + '</p>' +
        '</div>';
    }

    /* --------------------------------------------------------------- action pane */
    function currentChoices() {
      if (step === 0) return { list: SLOTS[slot].options, index: chosen[SLOTS[slot].id], name: SLOTS[slot].label };
      if (step === 1) return { list: WORLDS, index: world, name: 'Світ' };
      return { list: MOTIONS, index: motion, name: 'Рух' };
    }

    /* PLACEHOLDER TILES.
     *
     * Every pipeline element the viewer will choose gets a visible slot now, before the
     * imagery exists, so the layout is judged at real size rather than imagined. A slot
     * says what it is waiting for instead of showing a grey box: an empty frame that
     * explains itself is reviewable, an anonymous one is not.
     *
     * `kind` drives the little glyph so a garment, a room and a movement are not all the
     * same shape. When real assets land, only the inner markup changes — the geometry,
     * the states and the click targets are already settled here.
     */
    function tile(kind, label, size) {
      var glyph =
        kind === 'garment' ? '<span class="ph__g ph__g--garment"></span>' :
        kind === 'world'   ? '<span class="ph__g ph__g--world"></span>' :
                             '<span class="ph__g ph__g--motion"></span>';
      return '<span class="ph ph--' + (size || 'sm') + '" aria-hidden="true">' +
               glyph +
               '<span class="ph__tag">' + label + '</span>' +
             '</span>';
    }

    function tileKind() {
      return step === 0 ? 'garment' : step === 1 ? 'world' : 'motion';
    }

    function pickerCarousel(c) {
      var k = tileKind();
      return '' +
        '<div class="pick">' +
          '<button class="pick__arrow" type="button" data-nudge="-1" aria-label="попереднє"' + (locked() ? ' disabled' : '') + '>‹</button>' +
          '<div class="pick__now">' +
            tile(k, 'зображення', 'lg') +
            '<span class="pick__name">' + c.list[c.index] + '</span>' +
            '<span class="pick__count">' + (c.index + 1) + ' / ' + c.list.length + '</span>' +
          '</div>' +
          '<button class="pick__arrow" type="button" data-nudge="1" aria-label="наступне"' + (locked() ? ' disabled' : '') + '>›</button>' +
        '</div>' +
        '<div class="dots">' + c.list.map(function (_, i) {
          return '<i data-choose="' + i + '"' + (i === c.index ? ' data-on="1"' : '') + '></i>';
        }).join('') + '</div>';
    }

    function pickerList(c) {
      var k = tileKind();
      return '<div class="rowpick">' + c.list.map(function (o, i) {
        return '<button class="rowpick__item" type="button" data-choose="' + i + '"' +
          (i === c.index ? ' aria-pressed="true"' : ' aria-pressed="false"') +
          (locked() ? ' disabled' : '') + '>' +
          tile(k, String(i + 1)) +
          '<span class="rowpick__name">' + o + '</span>' +
          '</button>';
      }).join('') + '</div>';
    }

    function pickerTray(c) {
      var k = tileKind();
      return '<div class="tray">' + c.list.map(function (o, i) {
        return '<button class="tray__chip" type="button" data-choose="' + i + '"' +
          (i === c.index ? ' aria-pressed="true"' : ' aria-pressed="false"') +
          (locked() ? ' disabled' : '') + '>' +
          tile(k, String(i + 1), 'md') +
          '<span>' + o + '</span>' +
          '</button>';
      }).join('') + '</div>';
    }

    function renderStep() {
      var s = STEPS[step];
      var c = currentChoices();
      var picker =
        variant === 'list' ? pickerList(c) :
        variant === 'tray' ? pickerTray(c) : pickerCarousel(c);

      var nextLabel = step === 0
        ? (slot < SLOTS.length - 1 ? 'Далі: ' + SLOTS[slot + 1].label : s.cta)
        : s.cta;

      stepRoot.innerHTML =
        '<div class="glass__eyebrow">' +
          (step === 0 ? 'Крок 1 з 3 · LOOK · ' + c.name : 'Крок ' + (step + 1) + ' з 3 · ' + s.label) +
        '</div>' +
        '<div class="glass__h">' + (step === 0 ? 'Оберіть ' + c.name.toLowerCase() : s.title) + '</div>' +
        picker +
        '<div class="io">' +
          '<label class="io__drop" for="io-' + s.id + '">' +
            '<span>або своє зображення</span>' +
            '<input id="io-' + s.id + '" type="file" accept="image/*" hidden' + (locked() ? ' disabled' : '') + '>' +
          '</label>' +
        '</div>' +
        '<div class="acts">' +
          '<button class="glass__cta glass__cta--ghost" type="button" data-back' +
            (step === 0 && slot === 0 ? ' disabled' : locked() ? ' disabled' : '') + '>Назад</button>' +
          '<button class="glass__cta" type="button" data-next' + (locked() ? ' disabled' : '') + '>' + nextLabel + '</button>' +
        '</div>' +
        '<div class="vary">' +
          ['carousel', 'list', 'tray'].map(function (v) {
            return '<button class="vary__b" type="button" data-variant="' + v + '"' +
              ' aria-pressed="' + (variant === v ? 'true' : 'false') + '">' + v + '</button>';
          }).join('') +
        '</div>' +
        (locked() ? '<p class="glass__hint">камера рухається — рішення на зупинці</p>' : '');
    }

    function render() { renderState(); renderStep(); }

    function setChoice(i) {
      var c = currentChoices();
      var n = c.list.length;
      var v = ((i % n) + n) % n;
      if (step === 0) chosen[SLOTS[slot].id] = v;
      else if (step === 1) world = v;
      else motion = v;
    }

    function advance() {
      if (step === 0) {
        if (slot < SLOTS.length - 1) { slot++; return; }
        doneLook = true; step = 1; return;
      }
      if (step === 1) { doneWorld = true; step = 2; return; }
      doneMotion = true;
    }

    function back() {
      if (step === 0) { if (slot > 0) slot--; return; }
      if (step === 1) { step = 0; slot = SLOTS.length - 1; return; }
      step = 1;
    }

    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var b;

      if ((b = t.closest('[data-variant]'))) { variant = b.getAttribute('data-variant'); render(); return; }
      if (locked()) return;

      if ((b = t.closest('[data-nudge]'))) { setChoice(currentChoices().index + Number(b.getAttribute('data-nudge'))); render(); return; }
      if ((b = t.closest('[data-choose]'))) { setChoice(Number(b.getAttribute('data-choose'))); render(); return; }
      if ((b = t.closest('[data-slot]')))   { step = 0; slot = Number(b.getAttribute('data-slot')); render(); return; }
      if ((b = t.closest('[data-step]')) && !b.disabled) { step = Number(b.getAttribute('data-step')); render(); return; }
      if (t.closest('[data-signature]'))    { signature = !signature; render(); return; }
      if (t.closest('[data-next]'))         { advance(); render(); return; }
      if (t.closest('[data-back]'))         { back(); render(); return; }
    });

    /* Keyboard: arrows cycle the current choice. Cheap to add, and it is how anyone
     * comparing four garments actually wants to move. */
    document.addEventListener('keydown', function (ev) {
      if (locked()) return;
      if (ev.key === 'ArrowRight') { setChoice(currentChoices().index + 1); render(); }
      else if (ev.key === 'ArrowLeft') { setChoice(currentChoices().index - 1); render(); }
    });

    document.addEventListener('change', function (ev) {
      if (ev.target.matches('input[type="file"]')) {
        var l = ev.target.closest('.io__drop');
        var f = ev.target.files && ev.target.files[0];
        if (l && f) l.querySelector('span').textContent = f.name;
      }
    });

    /* The station flag belongs to the engine. Watching it keeps one clock. */
    new MutationObserver(renderStep)
      .observe(stage, { attributes: true, attributeFilter: ['data-station', 'data-leg'] });

    render();

    return {
      state: function () {
        return {
          variant: variant, step: step, stepId: STEPS[step].id, slot: slot,
          slotId: SLOTS[slot].id,
          chosen: Object.keys(chosen).reduce(function (a, k) {
            var s = SLOTS.filter(function (x) { return x.id === k; })[0];
            a[k] = s.options[chosen[k]]; return a;
          }, {}),
          world: WORLDS[world], motion: MOTIONS[motion],
          doneLook: doneLook, doneWorld: doneWorld, doneMotion: doneMotion,
          signature: signature, station: station(),
          controlsEnabled: !locked()
        };
      },
      setVariant: function (v) { variant = v; render(); return variant; },
      variants: ['carousel', 'list', 'tray']
    };
  }

  global.WardrobeUI = { create: create, SLOTS: SLOTS, STEPS: STEPS };
})(window);
