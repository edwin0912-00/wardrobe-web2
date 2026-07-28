/* WARDROBE — the step gate.
 *
 * The level-design rule, as the owner stated it: a station is not a place you scroll
 * past. Approaching it the swipe goes insensitive so the interface takes priority, and
 * then forward travel is BLOCKED until the step's required media has been supplied and
 * has finished generating. Only that opens the gate.
 *
 * So this module owns three things and nothing else:
 *   1. what media each step requires
 *   2. whether it has been supplied
 *   3. whether it has finished generating
 * and it answers one question: gateOpen(leg).
 *
 * HONESTY NOTE, deliberately left visible in the UI: there is no backend here. The
 * generation step is a LOCAL PLACEHOLDER — it consumes the supplied files, waits, and
 * reports done. It does not send anything anywhere and it does not produce a real
 * result. `adapter` below is the seam where a real pipeline drops in; until one is wired
 * the panel says so on screen rather than implying work that is not happening.
 */
(function (global) {
  'use strict';

  /* What each leg's station demands before it will let you past. */
  var REQUIREMENTS = [
    {
      leg: 0,
      title: 'Дзеркало',
      needs: [
        { id: 'person', label: 'Фото людини', hint: 'на весь зріст, одне', min: 1 },
        { id: 'items', label: 'Фото речей', hint: 'верх, низ, взуття — від двох', min: 2 }
      ]
    }
    /* Legs 1 and 2 have no media gate yet — they open freely. Adding one is a matter of
     * another entry here, not of touching the engine. */
  ];

  function reqFor(leg) {
    for (var i = 0; i < REQUIREMENTS.length; i++) {
      if (REQUIREMENTS[i].leg === leg) return REQUIREMENTS[i];
    }
    return null;
  }

  function create(config) {
    config = config || {};
    var mount = document.querySelector('[data-gate-panel]');
    var banner = document.querySelector('[data-gate-text]');

    /* files[leg][needId] = array of { name, size, url } */
    var files = {};
    /* status[leg] = 'idle' | 'generating' | 'done' | 'failed' */
    var status = {};

    /* Every object URL this module hands out, so none is ever orphaned.
     *
     * A blob URL keeps its entire File alive until it is revoked, so a viewer who
     * re-picks their photos a few times leaks every earlier pick for the life of the
     * document. Tracked here rather than trusted to garbage collection, because the
     * browser deliberately will not collect them. */
    var created = [];

    function revokeAll() {
      for (var i = 0; i < created.length; i++) {
        try { URL.revokeObjectURL(created[i]); } catch (e) { /* already gone */ }
      }
      created.length = 0;
    }

    function revoke(url) {
      if (!url) return;
      try { URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
      var i = created.indexOf(url);
      if (i !== -1) created.splice(i, 1);
    }

    /* A page unload without this still frees the memory, but doing it explicitly keeps
     * the invariant true for anything that tears the gate down and rebuilds it. */
    window.addEventListener('pagehide', revokeAll);

    function bucket(leg, id) {
      if (!files[leg]) files[leg] = {};
      if (!files[leg][id]) files[leg][id] = [];
      return files[leg][id];
    }

    function suppliedFor(leg) {
      var req = reqFor(leg);
      if (!req) return true;
      for (var i = 0; i < req.needs.length; i++) {
        var n = req.needs[i];
        if (bucket(leg, n.id).length < n.min) return false;
      }
      return true;
    }

    function gateOpen(leg) {
      if (!reqFor(leg)) return true;           // no requirement, no gate
      return status[leg] === 'done';           // supplied AND generated
    }

    function missingText(leg) {
      var req = reqFor(leg);
      if (!req) return '';
      var out = [];
      for (var i = 0; i < req.needs.length; i++) {
        var n = req.needs[i];
        var have = bucket(leg, n.id).length;
        if (have < n.min) out.push(n.label.toLowerCase() + ' (' + have + '/' + n.min + ')');
      }
      return out.join(', ');
    }

    function bannerText(leg) {
      if (!reqFor(leg)) return '';
      if (status[leg] === 'generating') return 'Генеруємо — свайп відкриється, коли буде готово';
      if (status[leg] === 'failed') return 'Не вдалося згенерувати. Спробуйте ще раз';
      if (!suppliedFor(leg)) return 'Треба ще: ' + missingText(leg);
      return 'Натисніть «Згенерувати», щоб відкрити прохід';
    }

    /* ---- the placeholder generation ----------------------------------------
     * Replaced by handing in config.adapter. The contract is one function that takes
     * the collected files and resolves when a real result exists. */
    function runGeneration(leg) {
      status[leg] = 'generating';
      render();
      notify();

      var collected = files[leg] || {};
      var job = config.adapter
        ? config.adapter(leg, collected)
        : new Promise(function (resolve) {
            /* No backend. Wait a plausible amount of time so the gate can be exercised,
             * and say on screen that nothing was generated. */
            setTimeout(resolve, 2600);
          });

      job.then(function () {
        status[leg] = 'done';
        render();
        notify();
      }).catch(function () {
        status[leg] = 'failed';
        render();
        notify();
      });
    }

    function notify() {
      if (global.journey && global.journey.refreshGate) global.journey.refreshGate();
      if (banner) banner.textContent = bannerText(currentLeg());
    }

    function currentLeg() {
      var s = global.journey && global.journey.state ? global.journey.state() : null;
      return s ? s.leg : 0;
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function render() {
      if (!mount) return;
      var leg = currentLeg();
      var req = reqFor(leg);
      if (!req) { mount.innerHTML = ''; mount.hidden = true; return; }
      mount.hidden = false;

      var st = status[leg] || 'idle';
      var rows = req.needs.map(function (n) {
        var have = bucket(leg, n.id);
        var ok = have.length >= n.min;
        var thumbs = have.slice(0, 4).map(function (f) {
          return '<img class="drop__thumb" src="' + esc(f.url) + '" alt="">';
        }).join('');
        return '' +
          '<div class="drop" data-ok="' + (ok ? '1' : '0') + '">' +
            '<div class="drop__head">' +
              '<b>' + esc(n.label) + '</b>' +
              '<em>' + have.length + '/' + n.min + '</em>' +
            '</div>' +
            '<div class="drop__hint">' + esc(n.hint) + '</div>' +
            '<div class="drop__thumbs">' + thumbs + '</div>' +
            '<label class="drop__btn">' +
              (have.length ? 'Додати ще' : 'Вибрати файли') +
              '<input type="file" accept="image/*" multiple hidden data-need="' + esc(n.id) + '">' +
            '</label>' +
            /* Without this there is no way to undo a wrong pick, and no path that can
             * revoke an object URL — the leak an independent review flagged. */
            (have.length
              ? '<button class="drop__clear" type="button" data-clear="' + esc(n.id) + '">Скинути</button>'
              : '') +
          '</div>';
      }).join('');

      var canGenerate = suppliedFor(leg) && st !== 'generating';
      mount.innerHTML = '' +
        '<div class="glass__eyebrow">Гейт кроку · ' + esc(req.title) + '</div>' +
        '<div class="glass__h">Щоб іти далі</div>' +
        '<div class="drops">' + rows + '</div>' +
        '<button class="glass__cta" type="button" data-generate' +
          (canGenerate ? '' : ' disabled') + '>' +
          (st === 'generating' ? 'Генеруємо…' : st === 'done' ? 'Готово' : 'Згенерувати') +
        '</button>' +
        '<div class="gate__state" data-state="' + st + '">' + esc(bannerText(leg)) + '</div>' +
        (config.adapter ? '' :
          '<div class="gate__warn">Бекенду не підключено — цей крок лише перевіряє ' +
          'наявність файлів і не генерує нічого насправді.</div>');
    }

    /* Delegated, so re-rendering the panel never loses its handlers. */
    document.addEventListener('change', function (e) {
      var input = e.target.closest ? e.target.closest('input[data-need]') : null;
      if (!input) return;
      var leg = currentLeg();
      var id = input.getAttribute('data-need');
      var list = bucket(leg, id);
      Array.prototype.forEach.call(input.files || [], function (f) {
        if (!/^image\//.test(f.type)) return;   // images only, silently ignore the rest
        /* Every object URL created here is tracked so it can be revoked. An unrevoked
         * blob URL pins its whole File in memory for the life of the document, so a
         * viewer who re-picks their photos a few times leaks every earlier pick. */
        var url = URL.createObjectURL(f);
        created.push(url);
        list.push({ name: f.name, size: f.size, url: url });
      });
      /* Supplying new media invalidates any previous result. */
      if (status[leg] === 'done' || status[leg] === 'failed') status[leg] = 'idle';
      render();
      notify();
    });

    document.addEventListener('click', function (e) {
      var clr = e.target.closest ? e.target.closest('[data-clear]') : null;
      if (clr) {
        var cleg = currentLeg();
        var cid = clr.getAttribute('data-clear');
        var clist = bucket(cleg, cid);
        for (var ci = 0; ci < clist.length; ci++) revoke(clist[ci].url);
        clist.length = 0;
        /* Removing media invalidates any result generated from it. */
        if (status[cleg] === 'done' || status[cleg] === 'failed') status[cleg] = 'idle';
        render();
        notify();
        return;
      }

      var btn = e.target.closest ? e.target.closest('[data-generate]') : null;
      if (!btn || btn.disabled) return;
      var leg = currentLeg();
      if (!suppliedFor(leg) || status[leg] === 'generating') return;
      runGeneration(leg);
    });

    render();
    notify();

    return {
      gateOpen: gateOpen,
      supplied: suppliedFor,
      status: function (leg) { return status[leg] || 'idle'; },
      render: render,
      /* For assertions from outside, since this pane cannot be scrolled or clicked. */
      _addFake: function (leg, id, n) {
        var list = bucket(leg, id);
        for (var i = 0; i < (n || 1); i++) list.push({ name: 'test' + i + '.jpg', size: 1, url: '' });
        if (status[leg] === 'done') status[leg] = 'idle';
        render(); notify();
        return list.length;
      },
      _generate: function (leg) { runGeneration(leg); },
      requirements: REQUIREMENTS
    };
  }

  global.WardrobeGate = { create: create, REQUIREMENTS: REQUIREMENTS };
})(window);
