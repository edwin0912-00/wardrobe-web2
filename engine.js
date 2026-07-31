/* WARDROBE — scroll journey engine.
 *
 * One clock, one normalised scalar. Everything downstream reads it and nothing else
 * touches scroll. Three things this engine owns:
 *
 *   INERTIA   Scroll sets a TARGET. A separate value chases it with exponential
 *             smoothing, and that chased value is what drives the film. Without this,
 *             video.currentTime jumps exactly as hard as the wheel does and the whole
 *             thing feels like dragging a slider. Native scroll is never intercepted,
 *             so reverse scrolling, trackpad flicks and keyboard paging all still work.
 *
 *   SINE      Inside each leg the scroll-to-time mapping is eased, not linear. The
 *             footage's own pace is uneven and could not be steered accurately by
 *             prompt, so the curve is imposed here instead, where it is exact and free.
 *
 *   PARALLAX  Layers read the same scalar and move at different rates. Depth comes from
 *             the rate difference, not from a 3D scene.
 *
 * Reads: window scroll. Writes: one video currentTime, and CSS custom properties.
 * It never writes width/height/top/left on a per-frame path, so nothing here can force
 * a synchronous layout.
 */
(function (global) {
  'use strict';

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  /* Sine ease-in-out. Slow out of rest, fastest at the middle, slow into the next rest —
   * which is exactly the brief: the move settles where the interface appears. */
  function easeSine(t) { return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t)); }

  /* Look up a time in a precomputed scroll-to-time table with linear interpolation.
   *
   * Easing CLOCK TIME is not the same as easing VISUAL MOTION, and that difference is
   * why the movement still did not read as a sine after the mapping was eased: the
   * footage carries its own uneven pace — measured unevenness of 0.35, 0.59 and 0.92 of
   * the mean across the three legs — so an eased time mapping COMPOUNDS with it instead
   * of correcting it.
   *
   * The table is built offline by motion-table.py: it measures the master's real
   * per-frame motion, integrates it, and inverts it against the wanted curve. Verified
   * afterwards by resampling — corrected peak lands at 0.50 with a correlation of 1.0000
   * against sin(pi*u) and a worst-case step error of 0.01%. So the curve below is exact
   * regardless of how unevenly the model happened to shoot. */
  function tableLookup(table, u) {
    var n = table.length;
    if (n === 0) return null;
    if (n === 1) return table[0];
    var x = clamp01(u) * (n - 1);
    var i = Math.floor(x);
    if (i >= n - 1) return table[n - 1];
    var f = x - i;
    return table[i] + (table[i + 1] - table[i]) * f;
  }

  function create(config) {
    var legs = config.legs;                    // [{ video, name, copy }]

    /* ---- attention stations --------------------------------------------------
     *
     * A station is a physical place inside one camera leg, not a generic overlay that
     * happens to appear near its end. Leg 0 needs three of them (person → garments →
     * mirrors), each with an independent hysteresis latch and its own gate. The original
     * journey predates that geography and had one implicit station near every leg seam.
     *
     * `config.stations` therefore accepts the new explicit form while retaining the old
     * one as an exact fallback for every leg that does not declare stations:
     *
     *   stations: [
     *     { leg: 0, id: 'person',   at: .24, enter: .22, exit: .14,
     *       dampFrom: .12, dampMax: .94, canAdvance: function (station, leg) { ... } },
     *     { leg: 0, id: 'garments', at: .54, enter: .52, exit: .43, gate: true },
     *     { leg: 0, id: 'mirrors',  at: .90, enter: .88, exit: .78, seam: true }
     *   ]
     *
     * An array-of-arrays (`stations[legIndex]`) and the early documented map
     * (`stations: { 0: [...] }`) are also accepted. That makes the migration small for
     * the existing level-design note, but the flat array above is the canonical API.
     *
     * `at` is the exact scroll pin. `enter` / `exit` make the visual latch hysteretic.
     * An explicit station gets no post-station damping unless `dampTo` says otherwise:
     * once its gate opens, travelling on to the next physical place should be free. The
     * implicit legacy station deliberately keeps its old flat resistance after `at` all
     * the way to the seam. */
    function legacyStationAt() {
      return config.stationAt !== undefined ? config.stationAt : 0.92;
    }
    function legacyStationEnter() {
      return config.stationEnter !== undefined ? config.stationEnter : legacyStationAt();
    }
    function legacyStationExit() {
      var e = config.stationExit !== undefined ? config.stationExit : legacyStationEnter();
      return Math.min(e, legacyStationEnter());
    }

    function own(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    }
    function finiteNumber(value, fallback) {
      return typeof value === 'number' && isFinite(value) ? value : fallback;
    }
    function localNumber(value, fallback) {
      return clamp01(finiteNumber(value, fallback));
    }

    function configuredStationsForLeg(idx) {
      var all = config.stations;
      if (!all) return null;

      if (Array.isArray(all)) {
        if (Array.isArray(all[idx])) return all[idx];
        /* A flat list is canonical. Entries without `leg` are a convenient shorthand
         * for leg 0, where the first three stations currently live. */
        return all.filter(function (entry) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
          var legRef = own(entry, 'leg') ? entry.leg
                     : (own(entry, 'legIndex') ? entry.legIndex : entry.legId);
          if (legRef === undefined || legRef === null) return idx === 0;
          return String(legRef) === String(idx) || String(legRef) === String(legs[idx].id);
        });
      }

      if (typeof all === 'object') {
        var byIndex = all[idx];
        var byId = all[legs[idx].id];
        return Array.isArray(byIndex) ? byIndex : (Array.isArray(byId) ? byId : null);
      }
      return null;
    }

    function makeStation(spec, idx, order, legacy) {
      spec = spec || {};
      var at = localNumber(own(spec, 'at') ? spec.at : spec.stationAt,
                           legacy ? legacyStationAt() : 0.92);
      var enter = localNumber(spec.enter, legacy ? legacyStationEnter() : at);
      /* A pin before the latch would pull a person backwards as soon as the interface
       * appears. Treat that malformed ordering as a pin at entry instead. */
      at = Math.max(at, enter);
      var exit = Math.min(localNumber(spec.exit, legacy ? legacyStationExit() : enter), enter);
      var dampFrom = localNumber(spec.dampFrom,
                                 legacy ? (config.dampFrom !== undefined ? config.dampFrom : 0.72)
                                        : enter);
      dampFrom = Math.min(dampFrom, at);
      var dampMax = finiteNumber(spec.dampMax,
                                 config.dampMax !== undefined ? config.dampMax : 0.94);
      var dampTo = legacy ? 1 : localNumber(spec.dampTo, at);
      dampTo = Math.max(at, dampTo);

      return {
        id: spec.id != null ? String(spec.id)
          : (legacy ? 'leg-' + idx + '-end' : 'leg-' + idx + '-station-' + order),
        leg: idx,
        index: order,
        at: at,
        enter: enter,
        exit: exit,
        dampFrom: dampFrom,
        dampTo: dampTo,
        dampMax: Math.max(0, dampMax),
        deadSpan: own(spec, 'deadSpan') ? Math.max(0, finiteNumber(spec.deadSpan, 0)) : null,
        seam: legacy || spec.seam === true,
        legacyDamping: legacy,
        hasOwnGate: own(spec, 'canAdvance') || own(spec, 'gate'),
        canAdvance: spec.canAdvance,
        gate: spec.gate,
        latched: false
      };
    }

    var stationsByLeg = legs.map(function (leg, idx) {
      var source = configuredStationsForLeg(idx);
      var list;
      if (source && source.length) {
        list = source.map(function (spec, order) { return makeStation(spec, idx, order, false); });
      } else {
        /* No explicit entry means exactly the legacy station, including end-of-leg
         * damping, global gate callback and the leg-0 departure deadzone. */
        list = [makeStation({}, idx, 0, true)];
      }
      list.sort(function (a, b) { return a.at === b.at ? a.index - b.index : a.at - b.at; });
      return list;
    });

    function stationPublic(station) {
      if (!station) return null;
      return {
        id: station.id,
        leg: station.leg,
        index: station.index,
        at: station.at,
        enter: station.enter,
        exit: station.exit,
        dampFrom: station.dampFrom,
        dampTo: station.dampTo,
        dampMax: station.dampMax,
        seam: station.seam,
        latched: station.latched
      };
    }

    /* Every station owns its latch. Several can be latched while travelling forward;
     * the most recently reached one is the active surface. On a reverse travel its own
     * exit threshold releases it and the previous station becomes active again. A leg
     * change clears that leg's latches first — this preserves the old engine's rule that
     * a station never leaks across a video seam or reappears merely because we jumped
     * back into the middle of a room. */
    var stationLatchLeg = -1;
    function activeStation(r) {
      var list = stationsByLeg[r.idx] || [];
      if (r.idx !== stationLatchLeg) {
        stationLatchLeg = r.idx;
        for (var reset = 0; reset < list.length; reset++) list[reset].latched = false;
      }
      var active = null;
      for (var i = 0; i < list.length; i++) {
        var station = list[i];
        if (station.latched) {
          if (r.local < station.exit) station.latched = false;
        } else if (r.local >= station.enter) {
          station.latched = true;
        }
        if (station.latched) active = station;
      }
      return active;
    }

    function stationAtId(idx, id) {
      var list = stationsByLeg[idx] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === String(id)) return list[i];
      }
      return null;
    }
    var stage = document.querySelector('[data-stage]');
    var loader = document.querySelector('[data-loader]');
    var loaderBar = document.querySelector('[data-loader-bar]');
    var loaderPct = document.querySelector('[data-loader-pct]');
    var track = document.querySelector('[data-track]');
    var readout = document.querySelector('[data-readout]');
    var root = document.documentElement;

    var videos = legs.map(function (leg) {
      return document.querySelector('video[data-leg="' + leg.id + '"]');
    });

    /* Measured scroll-to-time tables, one per leg. Loaded async: the journey is usable
     * without them (it falls back to easing clock time) and upgrades the moment they
     * land, so a missing or slow file degrades rather than blocks. */
    var motion = null;
    if (config.motionTable) {
      fetch(config.motionTable)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (json) {
          if (json && json.legs && json.legs.length) {
            motion = json;
            lastWritten = -1;
            schedule();
          }
        })
        .catch(function () { /* fallback path already works */ });
    }

    /* ---- layout in pixels ------------------------------------------------------
     * Viewport units are avoided for the track and the stage. In an embedded pane
     * that reports innerHeight 0 every vh collapses to zero, the page becomes
     * unscrollable, and there is nothing on screen to tell you why. Pixels with a
     * fallback keep it working everywhere. */
    function viewport() {
      return window.innerHeight || root.clientHeight || 800;
    }
    var film = document.querySelector('[data-film]');

    /* ---- THE INTRO ------------------------------------------------------------
     *
     * A film that plays before the rooms and is not one of them. It is deliberately NOT
     * added to `legs`: the copy lines, the mirror panels and ui.js are all keyed to
     * data-leg 0..3, and renumbering them to make room for an intro would silently move
     * every one of those. So the intro gets its own scroll span in front of the legs and
     * the leg indices stay exactly as they were.
     *
     * config.intro = { screens, handoverAt, fadeFrom }
     *   screens     how much scroll the intro owns, in viewport heights
     *   handoverAt  where inside the intro's span the scroll STOPS being the intro's alone
     *               and starts driving room one as well. Both advance from here: nothing
     *               freezes, and by the time the intro dissolves the room has already begun
     *               assembling. This is the "swipe is bound to the second video slightly
     *               before the first one starts to fade" requirement.
     *   fadeFrom    where the intro starts dissolving. Must be >= handoverAt, otherwise the
     *               room would be revealed before it had started moving.
     */
    var intro = config.intro || null;
    var introEl = document.querySelector('[data-intro]');
    if (intro && !introEl) intro = null;          // configured but absent: carry on without
    /* Do not remove the textile safety frame until room one has produced a meaningful
     * seek/timeupdate.  Metadata and readyState alone do not prove that Safari painted
     * the native video plane.  The engine's initial 0.001 s nudge is deliberately below
     * this threshold, so it cannot falsely certify the handover. */
    var firstLegPainted = !intro;
    if (intro && videos[0]) {
      var confirmFirstLegFrame = function () {
        if (videos[0].currentTime > 0.02) {
          firstLegPainted = true;
          schedule();
        }
      };
      videos[0].addEventListener('seeked', confirmFirstLegFrame);
      videos[0].addEventListener('timeupdate', confirmFirstLegFrame);
    }

    function introScreens() { return intro ? (intro.screens || 1.6) : 0; }
    function totalScreens() { return introScreens() + config.screensPerLeg * legs.length; }

    /* Fraction of the whole page the intro owns, and where the legs' own 0..1 begins.
     * The legs start EARLY — at handoverAt inside the intro's span — so leg progress is
     * continuous across the dissolve instead of jumping from nothing to something. */
    function introFrac() { return intro ? introScreens() / totalScreens() : 0; }
    function legsStart() {
      if (!intro) return 0;
      var h = intro.handoverAt !== undefined ? intro.handoverAt : 0.74;
      return introFrac() * h;
    }

    function layout() {
      var vh = viewport();
      stage.style.height = vh + 'px';
      track.style.height = (vh * totalScreens()) + 'px';

      /* SIZE FRAME SPACE.
       *
       * `.film` must cover the stage while keeping the footage's own aspect ratio, so
       * that a percentage inside it addresses the same point it addressed on the video
       * frame the rectangles were measured from. Anything painted on the picture — the
       * glass panels — is a child of this box.
       *
       * Overscan is applied by enlarging the BOX, never by transform: scale(). A scale
       * pushes every child away from the centre in proportion to its distance, which
       * quietly displaces an off-centre rectangle; the mirrors are off-centre, so that
       * displacement was part of why the interface missed them.
       *
       * Written on resize only, never per frame, so this cannot cost a layout during a
       * scroll. */
      if (!film) return;
      var sw = stage.clientWidth || (window.innerWidth || 1280);
      var sh = vh;
      var aspect = config.filmAspect || (16 / 9);
      var over = config.overscan || 1.045;

      /* WIDTH FIRST, NOT COVER — because the interface lives on the far left and right.
       *
       * The old rule covered the stage: on a window taller than 16:9 it grew the box until
       * the height was filled, which pushed the sides past the edges. Measured on the
       * shipped mirror rectangles (x 5.0-44.0% and 55.7-94.6%): at 1512x982 each mirror lost
       * 9% of its width, at 1024x768 23%, at 1280x1024 29%. The panels were never misplaced
       * — they were glued to mirrors that had left the screen. That is the drift the owner
       * sees when the browser zoom changes, and shrinking the panels would not touch it.
       *
       * So the horizontal is authoritative: the film is exactly as wide as the stage, which
       * keeps the whole 0-100% of frame space — and therefore both mirrors — on screen at
       * every window shape. If that leaves the frame shorter than the stage, the remainder
       * is let be: the grade and vignette already darken top and bottom, and a hair of
       * background is cheaper than an interface that walks off the edge.
       *
       * Overscan is only spent when there is height to spare, so it can never re-introduce
       * the horizontal crop it is not there to cause. */
      /* How much of frame WIDTH the interface occupies. The film may be enlarged only until
       * that span still fits the stage; past it, a mirror leaves the screen. Shipped panels
       * run 5.0% to 94.6%, so 0.90 with a little margin. */
      var span = config.uiSpan || 0.92;

      var w = sw;                    // start locked to the stage: the whole frame is on screen
      var h = w / aspect;

      if (h < sh) {
        /* Window is WIDER than the footage, so the frame is shorter than the stage and
         * background would show above and below. Grow it to cover — but only as far as the
         * interface span allows, so covering height can never crop a mirror away.
         * On a 16:9 window these two are the same number and nothing is given up. */
        var toCover = sh * aspect;
        var toKeepUi = sw / span;
        w = Math.min(toCover * over, toKeepUi);
        w = Math.max(w, sw);         // never narrower than the stage
        h = w / aspect;
      }
      film.style.width = Math.round(w) + 'px';
      film.style.height = Math.round(h) + 'px';
    }

    /* ---- preload --------------------------------------------------------------
     * The owner's condition from the start: load once, 0 to 100, then run without a
     * hitch. So every master is fetched to a playable state before the journey opens.
     * Progress is the mean of each element's own buffered fraction, which moves
     * smoothly instead of stepping once per file. */
    var ready = false;
    function preloadProgress() {
      var total = 0;
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        var d = v.duration;
        if (!d || !isFinite(d)) { continue; }
        var buffered = 0;
        try {
          for (var r = 0; r < v.buffered.length; r++) {
            buffered += v.buffered.end(r) - v.buffered.start(r);
          }
        } catch (e) { buffered = 0; }
        total += clamp01(buffered / d);
      }
      return total / videos.length;
    }

    function paintLoader(p) {
      var pct = Math.round(clamp01(p) * 100);
      if (loaderBar) loaderBar.style.transform = 'scaleX(' + clamp01(p) + ')';
      if (loaderPct) loaderPct.textContent = pct < 10 ? '0' + pct : String(pct);
    }

    function openJourney() {
      if (ready) return;
      ready = true;
      document.body.setAttribute('data-ready', '1');
      /* `holdLoader` leaves the loader on screen once preloading is done, so a page that
       * needs a gesture to unlock audio can put its button there. Dismissing it then
       * belongs to whoever owns that button — the engine must not race it. */
      /* The page owns the loader when it preloaded, so dismissing it is the page's call
       * and the engine racing it would flash the journey before the reveal. */
      if (loader && !config.holdLoader && !config.preloaded) {
        loader.setAttribute('data-done', '1');
      }
      current = target = readTarget();
      write(current, true);
    }

    /* ---- the clock ------------------------------------------------------------ */
    var target = 0;      // where scroll says we are
    var current = 0;     // where the film actually is, chasing target
    var speed = 0;       // smoothed movement rate, 0..1, published as --speed
    var uiLag = 0;       // signed pixel lag the glass panels trail by, published as --ui-lag
    var raf = null;
    var lastWritten = -1;
    var onSpeed = typeof config.onSpeed === 'function' ? config.onSpeed : null;

    function readTarget() {
      var max = root.scrollHeight - viewport();
      return max > 0 ? clamp01(window.scrollY / max) : 0;
    }

    /* Split the global scalar into a leg index plus eased local progress.
     *
     * The legs live on [legsStart, 1] rather than on the whole page, so an intro can own
     * the front of the scroll. legsStart is INSIDE the intro's span, which is what makes
     * the handover early: room one is already advancing while the intro is still on screen.
     * With no intro configured legsStart is 0 and this is the original mapping exactly. */
    function resolve(p) {
      var n = legs.length;
      var s = legsStart();
      var q = s >= 1 ? 1 : clamp01((clamp01(p) - s) / (1 - s));
      var scaled = q * n;
      var idx = Math.min(n - 1, Math.floor(scaled));
      var local = clamp01(scaled - idx);
      return { idx: idx, local: local, eased: easeSine(local) };
    }

    /* Where the intro is, and how visible. Linear in time on purpose: the silk flows
     * continuously and has no station to arrive at, so the measured sine correction the
     * rooms need would only fight it. */
    function introState(p) {
      if (!intro) return null;
      var f = introFrac();
      var u = f > 0 ? clamp01(clamp01(p) / f) : 1;
      var from = intro.fadeFrom !== undefined ? intro.fadeFrom : 0.86;
      var x = clamp01((u - from) / Math.max(0.0001, 1 - from));
      var s = x * x * (3 - 2 * x);              // smoothstep, same ramp as the seams
      return { u: u, opacity: 1 - s, gone: u >= 1 };
    }

    /* Where in a leg's own film a given local progress sits. */
    function timeFor(idx, local) {
      var v = videos[idx];
      var d = v.duration;
      if (!d || !isFinite(d)) return null;
      var mt = motion && motion.legs && motion.legs[idx];
      /* Prefer the measured table. Fall back to easing clock time only when no table has
       * been supplied — that fallback is visibly worse, so it is a fallback, not the
       * design. */
      return mt && mt.table
        ? Math.min(d - 0.001, tableLookup(mt.table, clamp01(local)))
        : easeSine(clamp01(local)) * (d - 0.001);
    }

    function seekTo(v, t, force) {
      if (t === null) return;
      /* Seeking costs real work. Below roughly a third of a frame the viewer cannot
       * tell, so skip it and let the decoder breathe. */
      if (force || Math.abs(v.currentTime - t) > 0.012) v.currentTime = t;
    }

    function write(p, force) {
      var r = resolve(p);

      /* ---- the intro, scrubbed and dissolving ----------------------------------
       * Painted above the rooms so it hides them until it fades. Once gone it is taken out
       * of the compositor entirely rather than left at opacity 0 — a full-frame transparent
       * layer still costs a blend on every frame of the rest of the journey. */
      if (intro) {
        var ist = introState(p);
        if (ist.gone && firstLegPainted) {
          if (!introEl.hidden) { introEl.hidden = true; introEl.style.opacity = '0'; }
        } else {
          if (introEl.hidden) introEl.hidden = false;
          /* Once its own timeline is over, keep the final textile frame opaque only
           * while Safari is still preparing room one's first painted frame. */
          introEl.style.opacity = (ist.gone ? 1 : ist.opacity).toFixed(4);
          introEl.style.zIndex = '4';
          var id = introEl.duration;
          if (id && isFinite(id)) seekTo(introEl, Math.min(id - 0.001, ist.u * (id - 0.001)), force);
        }
        stage.setAttribute('data-intro',
          ist.gone ? (firstLegPainted ? 'gone' : 'waiting-room') :
          (ist.opacity > 0.999 ? 'solid' : 'fading'));
      }

      /* ---- the seam ------------------------------------------------------------
       * Swapping one element for another at a leg boundary is visible even though the
       * outgoing last frame and the incoming first frame are the same picture — what
       * pops is the display toggle and the decoder handover, not the image.
       *
       * So the two films OVERLAP across a narrow window either side of the seam. Both
       * are painted, the outgoing one parked on its final frame and the incoming one on
       * its first, and opacity carries one into the other. Because the frames match,
       * the blend changes nothing in the content; it only hides the discontinuity.
       *
       * The ramp is smoothstep rather than linear so there is no perceptible kink at
       * either end of the crossfade — a linear opacity ramp announces its own start and
       * finish, which is exactly the thing being hidden. */
      /* `|| 0.10` treated a deliberate 0 as absent, so asking for a clean cut silently
       * got the 10% dissolve back. Only null/undefined may fall through to the default. */
      var W = config.seamWindow == null ? 0.10 : config.seamWindow;
      var partner = -1, partnerLocal = 0, mix = 0;

      if (r.local > 1 - W && r.idx < videos.length - 1) {
        partner = r.idx + 1;
        partnerLocal = 0;
        mix = (r.local - (1 - W)) / W;      // 0 at window start, 1 at the seam
      } else if (r.local < W && r.idx > 0) {
        partner = r.idx - 1;
        partnerLocal = 1;
        mix = (W - r.local) / W;            // 1 just after the seam, 0 at window end
      }
      mix = clamp01(mix);
      var blend = mix * mix * (3 - 2 * mix);  // smoothstep

      /* The one below stays FULLY OPAQUE and the one above fades in over it.
       *
       * Fading both towards each other looks correct and is not: two identical frames at
       * 0.5 each, composited over black, give 0.75 of the original luminance, so the seam
       * would dip about a quarter darker — a different artefact in the same place. With
       * an opaque base and only the top element ramping, the composite is a full-strength
       * image at every value of blend. */
      for (var i = 0; i < videos.length; i++) {
        var isCurrent = (i === r.idx);
        var isPartner = (i === partner);
        /* Only the two elements at play are painted. Everything else stays out of the
         * compositor entirely so we are never decoding four films at once. */
        videos[i].hidden = !(isCurrent || isPartner);
        if (isCurrent) {
          videos[i].style.opacity = '1';
          videos[i].style.zIndex = '1';
        } else if (isPartner) {
          videos[i].style.opacity = blend.toFixed(4);
          videos[i].style.zIndex = '2';
        }
      }

      var v = videos[r.idx];
      var d = v.duration;
      seekTo(v, timeFor(r.idx, r.local), force);
      if (partner >= 0) seekTo(videos[partner], timeFor(partner, partnerLocal), force);
      root.style.setProperty('--seam', blend.toFixed(4));

      /* Everything visual downstream is CSS reading these. */
      root.style.setProperty('--p', p.toFixed(5));
      root.style.setProperty('--leg', String(r.idx));
      root.style.setProperty('--leg-p', r.local.toFixed(5));
      root.style.setProperty('--leg-eased', r.eased.toFixed(5));

      /* Depth: each layer is given its own rate. The differences are the parallax. */
      root.style.setProperty('--par-slow', (p * 100).toFixed(2) + 'px');
      root.style.setProperty('--par-mid', (p * 260).toFixed(2) + 'px');
      root.style.setProperty('--par-fast', (p * 520).toFixed(2) + 'px');

      /* The active station is the most recently reached independently-latched place in
       * this leg. Keep the old numeric attribute for existing CSS, then publish the real
       * identity beside it so new surfaces never have to infer geography from a progress
       * percentage. */
      var active = activeStation(r);
      var station = active ? 1 : 0;
      root.style.setProperty('--station', String(station));
      stage.setAttribute('data-leg', String(r.idx));
      stage.setAttribute('data-station', String(station));
      if (active) {
        stage.setAttribute('data-station-id', active.id);
        stage.setAttribute('data-station-index', String(active.index));
      } else {
        stage.removeAttribute('data-station-id');
        stage.removeAttribute('data-station-index');
      }

      /* Just the number. This is a dev readout, not shipped UI — the leg fraction, leg
       * name and "станція" word were noise for what it is actually used for: reading the
       * current frame time while testing. */
      if (readout) {
        readout.textContent = (d && isFinite(d) ? v.currentTime.toFixed(2) : '—') + 's';
      }
      lastWritten = p;
    }

    function tick() {
      raf = null;

      if (!ready) {
        /* ONE OWNER for loading.
         *
         * When the page has already downloaded everything itself — loader.js counts real
         * bytes and hands the elements blob URLs — the engine must not second-guess it.
         * It used to recompute progress from video.buffered and REPAINT the bar, and a
         * freshly assigned blob URL reports buffered 0, so the bar snapped back to "00"
         * and the journey stayed shut until a 25-second fallback timer fired. That is the
         * loader "not finishing, or disappearing". Two writers, one progress bar.
         *
         * With `preloaded` the engine opens at once and never touches the loader. */
        if (config.preloaded) { openJourney(); }
        else {
          var pr = preloadProgress();
          paintLoader(pr);
          if (pr > 0.995) { openJourney(); } else { schedule(); return; }
        }
      }

      /* Exponential chase. `ease` is per-frame catch-up; lower is heavier. */
      var delta = target - current;
      var moved = 0;
      if (Math.abs(delta) < 0.00004) {
        current = target;
      } else {
        moved = delta * config.inertia;
        current += moved;
        schedule();
      }

      /* SPEED, published for anything that wants to react to how hard the viewer is
       * moving — the score opens its echo on it. Two smoothings, deliberately:
       * `moved` alone is spiky frame to frame, and a value that spikes makes an audio
       * ramp chatter. The decay is slower than the attack so a flick blooms and then
       * settles rather than snapping shut. */
      var instant = Math.min(1, Math.abs(moved) / (config.speedFullScale || 0.006));
      speed = instant > speed ? speed + (instant - speed) * 0.5   // attack
                              : speed + (instant - speed) * 0.06; // release
      if (speed < 0.0005) speed = 0;
      root.style.setProperty('--speed', speed.toFixed(4));
      if (onSpeed) onSpeed(speed);
      if (speed > 0) schedule();   // keep ticking while the tail decays

      if (Math.abs(current - lastWritten) > 0.00008) write(current, false);

      applyLock();

      /* BLOCK INERTIA. The glass panels are not painted onto the film — they are objects
       * with their own weight, and a swipe should shove them and let them settle. This
       * publishes a signed lag that trails the motion: it grows with the direction and
       * speed of travel and decays on its own, so CSS can offset the panels by it. */
      var wanted = (target - current) * (config.blockLagScale || 900);
      uiLag += (wanted - uiLag) * (config.blockLagEase || 0.12);
      if (Math.abs(uiLag) < 0.05) uiLag = 0;
      root.style.setProperty('--ui-lag', uiLag.toFixed(2) + 'px');
      var resistanceNow = resistanceInfo(current);
      root.style.setProperty('--resist', resistanceNow.value.toFixed(4));
      /* --resist normalised to its OWN ceiling (dampMax), so CSS can ask "how settled is
       * this, 0..1" without hardcoding dampMax and drifting from it — the exact two-numbers-
       * for-one-idea trap `stationAt`/`stationEnter` already got fixed for once. Used by
       * `.glass` to appear only once truly at rest and start hiding the instant real
       * departure motion begins, rather than snapping on the discrete station latch alone. */
      var dampMax = resistanceNow.ceiling || (config.dampMax !== undefined ? config.dampMax : 0.94);
      root.style.setProperty('--rest', (dampMax > 0 ? clamp01(resistanceNow.value / dampMax) : 0).toFixed(4));
      if (uiLag !== 0) schedule();
    }

    function schedule() {
      if (raf === null) raf = requestAnimationFrame(tick);
    }

    /* ---- attention: damping, then a gate ---------------------------------------
     *
     * The interface is not a decoration laid over a film that keeps rolling. At a
     * station it takes priority, and the brief is explicit about how:
     *
     *   1. APPROACHING a station the swipe becomes very insensitive, so the viewer
     *      feels the journey arriving somewhere rather than sliding through it.
     *   2. AT a station whose step is unfinished, forward motion is BLOCKED. The gate
     *      opens only when the step's required media has been supplied and generated.
     *      Backward motion is never BLOCKED — leaving is always possible — but it is
     *      damped by the same ramp the arrival used. Without that, a station was a
     *      deadzone in one direction only: any light backward flick shot the viewer
     *      straight out at full speed, undoing an arrival the forward ramp had spent the
     *      whole approach building up. A deadzone is not one-way.
     *
     * Damping is applied to the TARGET, not to the wheel. Native scroll is never
     * intercepted while a gate is open, so trackpad, keyboard and reverse scrolling
     * behave normally — resisted, not swallowed. Only a closed gate pins the page, and
     * it pins it honestly by holding the scroll position rather than by swallowing
     * events.
     */
    /* State for the true deadzone below — where the departure is measured from, and
     * which exact station armed it. A person station and garment station may share a leg,
     * so leg index alone is no longer enough identity. */
    var deadAnchor = null;
    var deadArmedStation = null;

    function stationDeadSpan(station) {
      if (!station) return 0;
      if (station.deadSpan !== null) return station.deadSpan;
      /* This is the shipped one-station behaviour: only leg 0 had the deliberate
       * backwards departure deadzone. Explicit stations opt in individually instead of
       * inheriting a deadzone intended for the old mirror-only surface. */
      if (station.legacyDamping && station.leg === 0) {
        return config.deadSpan !== undefined ? config.deadSpan : 0.014;
      }
      return 0;
    }

    /* How much one station resists, 0 free .. 1 immovable.
     *
     * Explicit stations have a local resistance envelope. This is essential for three
     * stops in one leg: a garment station that stayed at 94% resistance until the end of
     * the room would make the later mirror station feel broken. The legacy implicit stop
     * preserves the old plateau from `at` all the way to the seam. */
    function stationResistance(station, local) {
      var from = station.dampFrom;
      var at = station.at;
      var x;

      if (station.legacyDamping) {
        if (local <= from) return 0;
        x = (local - from) / Math.max(0.0001, at - from);
        return clamp01(x * x * x) * station.dampMax;
      }

      if (local < from || local > station.dampTo) return 0;
      if (local <= at) {
        x = (local - from) / Math.max(0.0001, at - from);
      } else {
        /* `dampTo === at` means "release immediately after the pin" — the normal
         * default for an intermediate station once its gate has opened. */
        if (station.dampTo <= at) return 0;
        x = (station.dampTo - local) / (station.dampTo - at);
      }
      return clamp01(x * x * x) * station.dampMax;
    }

    /* The maximum wins if two intentionally nearby envelopes overlap. That keeps a
     * hand from finding an accidental low-resistance gap between physical stations. */
    function resistanceInfo(p) {
      var r = resolve(p);
      var list = stationsByLeg[r.idx] || [];
      var strongest = 0;
      var ceiling = 0;
      for (var i = 0; i < list.length; i++) {
        var value = stationResistance(list[i], r.local);
        if (value > strongest) {
          strongest = value;
          ceiling = list[i].dampMax;
        }
      }
      return { value: strongest, ceiling: ceiling };
    }

    function resistance(p) {
      return resistanceInfo(p).value;
    }

    /* MAY THE JOURNEY LEAVE THIS LEG'S STATION?
     *
     * The answer is not the engine's to give. The interface layer knows whether the step is
     * finished — whether a look exists yet — so it hands in a predicate and the clock obeys.
     * `canAdvance` is the current name; `gateFor` is still honoured because it is what the
     * page used to pass and silently ignoring it would turn a closed gate into an open one. */
    function globalGateOpen(idx, station) {
      var fn = typeof config.canAdvance === 'function' ? config.canAdvance
             : (typeof config.gateFor === 'function' ? config.gateFor : null);
      if (!fn) return true;
      /* Existing pages receive precisely the old first argument. The second is additive
       * context for a multi-station UI and can be ignored by legacy callbacks. */
      return fn(idx, stationPublic(station)) !== false;
    }

    function gateOpen(idx, station) {
      if (!station) return true;
      var ownGate = typeof station.canAdvance === 'function' ? station.canAdvance
        : (typeof station.gate === 'function' ? station.gate : null);
      if (ownGate) return ownGate(stationPublic(station), idx) !== false;
      if (station.hasOwnGate) {
        /* `gate: true` is an explicit open station; `gate: false` is an explicit hold.
         * The same works for a boolean `canAdvance` to keep configuration declarative. */
        var value = station.canAdvance !== undefined ? station.canAdvance : station.gate;
        return value !== false;
      }
      return globalGateOpen(idx, station);
    }

    /* Is a leg's film actually usable — arrived, decoded far enough to seek into?
     *
     * The page no longer waits for all forty megabytes before opening. It loads the first
     * room, starts, and fetches the rest underneath. That is the honest reading of "the
     * loading is of the first scene": the bar measures what is required to begin, and 100
     * means begin. The consequence is that a fast scroller can reach a seam before the
     * next room has landed, so readiness has to be checked rather than assumed.
     *
     * The criterion is a finite duration, which is exactly what timeFor() needs to produce
     * a seek target — without it every seek silently does nothing and the room looks frozen
     * rather than absent.
     *
     * It is deliberately NOT readyState >= 2. That was tried and measured wrong: a film
     * whose blob is entirely in memory reports readyState 1 while its element is hidden and
     * has never been seeked, so the guard held rooms that were already there. Every film
     * here is handed a blob URL, so parsed metadata means the bytes are local — there is no
     * network left to stall on. */
    function filmReady(idx) {
      var v = videos[idx];
      return !!(v && v.src && v.duration && isFinite(v.duration));
    }

    /* The scroll position that corresponds to the current leg's station.
     *
     * Must invert resolve(), including the intro offset — pinning to a raw legs-only
     * fraction would park the page in the wrong place by the whole width of the intro,
     * which reads as the gate yanking you backwards. */
    function stationScrollFor(idx, station) {
      var max = root.scrollHeight - viewport();
      var s = legsStart();
      var list = stationsByLeg[idx] || [];
      station = station || list[list.length - 1];
      var at = station ? station.at : legacyStationAt();
      var q = (idx + at) / legs.length;                  // position within the legs' domain
      var pStation = s + q * (1 - s);                    // back out to page coordinates
      return Math.round(clamp01(pStation) * max);
    }

    var lockedLeg = -1;
    var lockedStation = null;

    function applyLock() {
      /* An auto-advance is a deliberate move past a station that has just opened. Locking
       * during it would fight the very transition it was called to perform. */
      if (autoDrive) return false;

      var r = resolve(current);
      var station = activeStation(r);
      var atStation = !!(station && r.local >= station.enter);
      /* A mid-leg station owns its own gate but must not pretend the next video is a
       * problem. Only an explicit `seam: true` station controls preloading the next leg.
       * The implicit legacy station is always a seam station, preserving old behaviour. */
      var atSeam = atStation && station.seam && r.idx < legs.length - 1;
      /* THREE STATES, NOT ONE FLAG.
       *   loading — the next room's film has not arrived. Says so on the banner, because the
       *             viewer did nothing wrong and silence would read as a broken page.
       *   held    — the step is not finished. Deliberately carries NO on-screen plaque: the
       *             owner asked for the block to live in the MOVEMENT, not in a panel. It is
       *             not silent even so — the resistance ramp has already made the film creep
       *             for the whole approach, so stopping is the end of a gesture the viewer
       *             can feel rather than an unexplained wall.
       * `closed` is gone. Any CSS still keyed to it can no longer fire — that is the point. */
      var nextMissing = atSeam && !filmReady(r.idx + 1);
      var shouldLock = atStation && (nextMissing || !gateOpen(r.idx, station));
      var why = nextMissing ? 'loading' : 'held';

      if (shouldLock && (lockedLeg !== r.idx || lockedStation !== station ||
                         root.getAttribute('data-gate') !== why)) {
        lockedLeg = r.idx;
        lockedStation = station;
        root.setAttribute('data-gate', why);
        stage.setAttribute('data-gate', why);
      } else if (!shouldLock && lockedLeg !== -1) {
        lockedLeg = -1;
        lockedStation = null;
        root.removeAttribute('data-gate');
        stage.removeAttribute('data-gate');
      }
      return shouldLock;
    }

    /* ---- AUTO-ADVANCE ---------------------------------------------------------
     *
     * "When it has generated, it swipes there by itself." The interface layer knows when the
     * look is ready; it calls this and the clock performs the move.
     *
     * It drives the real scroll position, not an internal variable. That matters: scroll IS
     * the source of truth here, so animating anything else would make a second clock that
     * disagrees with the first the moment the viewer touches the trackpad — which is exactly
     * the bug this engine exists to avoid. Because it moves scrollY, the ordinary tick picks
     * it up and every downstream reader (film time, parallax, score echo) follows for free.
     *
     * The chase constant is the same `inertia` a hand gets, so a programmatic arrival is
     * indistinguishable from a scrolled one. A real wheel or touch cancels it immediately —
     * the viewer always wins over the machine. */
    var autoDrive = null;
    var autoY = -1;      // the last scroll position advanceTo wrote, so a hand can be told apart

    /* Real input, listened for only while an automatic move is in flight. These are the
     * events a person generates; a programmatic scrollTo generates none of them, which is
     * what makes this unambiguous where a position comparison was not. Passive, so nothing
     * here can delay a scroll. */
    var TAKEOVER = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

    function onTakeover(e) {
      /* Ignore keys that do not scroll — a viewer typing into the interface has not taken
       * over the film. */
      if (e.type === 'keydown' &&
          ' ArrowUp ArrowDown PageUp PageDown Home End '.indexOf(' ' + e.key + ' ') === -1) return;
      cancelAuto('user took over');
    }

    function listenTakeover(on) {
      for (var i = 0; i < TAKEOVER.length; i++) {
        if (on) window.addEventListener(TAKEOVER[i], onTakeover, { passive: true });
        else window.removeEventListener(TAKEOVER[i], onTakeover, { passive: true });
      }
    }

    function cancelAuto(why) {
      if (!autoDrive) return;
      var done = autoDrive.resolve;
      autoDrive = null;
      listenTakeover(false);
      root.removeAttribute('data-auto');
      if (done) done(why || 'cancelled');
    }

    function advanceTo(idx, opts) {
      opts = opts || {};
      var n = legs.length;
      var leg = Math.max(0, Math.min(n - 1, idx));
      var requestedStation = opts.stationId !== undefined ? stationAtId(leg, opts.stationId) : null;
      var dest = opts.toStation === false
        ? Math.round(clamp01(legsStart() + (leg / n) * (1 - legsStart())) * (root.scrollHeight - viewport()))
        : stationScrollFor(leg, requestedStation);

      cancelAuto('superseded');
      /* Release the hold for the duration. The gate that was closed a moment ago is the
       * reason this call exists, and applyLock re-locking mid-flight would pin the page
       * back to the station it is trying to leave. */
      lockedLeg = -1;
      lockedStation = null;
      root.removeAttribute('data-gate');
      stage.removeAttribute('data-gate');
      root.setAttribute('data-auto', '1');

      return new Promise(function (resolve) {
        autoDrive = {
          dest: dest, resolve: resolve,
          ease: opts.ease || config.inertia || 0.085,
          /* Which way this move travels, so the backstop can tell an external jump from
           * ordinary interpolation. */
          dir: dest >= window.scrollY ? 1 : -1
        };
        listenTakeover(true);
        step();
        function step() {
          if (!autoDrive) return;
          var y = window.scrollY;
          var d = autoDrive.dest - y;
          if (Math.abs(d) < 1.5) {
            autoY = autoDrive.dest;
            window.scrollTo(0, autoDrive.dest);
            target = readTarget();
            schedule();
            cancelAuto('arrived');
            return;
          }
          /* Advance at least one whole pixel. Rounding a sub-pixel step to the same integer
           * would write the identical position every frame and the move would sit still
           * short of its destination forever, never reaching the 1.5 px finish. */
          var stepPx = d * autoDrive.ease;
          if (Math.abs(stepPx) < 1) stepPx = autoDrive.dir;
          autoY = Math.round(y + stepPx);
          window.scrollTo(0, autoY);
          target = readTarget();
          schedule();
          requestAnimationFrame(step);
        }
      });
    }

    function onScroll() {
      var raw = readTarget();

      /* A HAND OUTRANKS THE MACHINE — but a hand is detected from its INPUT, not from the
       * scroll position it produces. See the listeners in advanceTo.
       *
       * This used to compare window.scrollY against advanceTo's own last write and call any
       * difference over 2 px a takeover. It reported "user took over" on moves nobody
       * touched: an independent session measured a clean 2237 px arrival that still resolved
       * as interrupted. Inferring intent from an effect the engine itself causes cannot be
       * made reliable by widening the tolerance — a threshold loose enough to stop the false
       * positive is also loose enough to miss a real nudge. So the inference is gone.
       *
       * What remains is a backstop for a genuine external jump: something moved the page
       * AGAINST the direction of travel, which no interpolation toward a destination can do. */
      if (autoDrive) {
        var awayFromDest = (autoDrive.dest - window.scrollY) * autoDrive.dir < 0;
        if (awayFromDest && Math.abs(window.scrollY - autoY) > 24) cancelAuto('scroll moved elsewhere');
      }

      /* A closed gate holds the page at the station. Scrolling further does nothing and
       * says so — the page simply does not move forward. Scrolling back is untouched. */
      if (lockedLeg >= 0) {
        var pin = stationScrollFor(lockedLeg, lockedStation);
        if (window.scrollY > pin) {
          window.scrollTo(0, pin);
          target = readTarget();
          schedule();
          return;
        }
      }

      /* A TRUE DEADZONE while an opted-in attention surface is showing. The resistance ramp
       * below is still a ramp:
       * even at dampMax it lets 6% of every tick through, which reads as "sticky", not
       * "stopped" — the owner asked for genuinely zero movement until a swipe back is
       * committed to, so leaving is a deliberate gesture rather than a slow leak.
       *
       * `deadAnchor` is where the viewer was resting when they started pulling back.
       * `shortfall` is how far the RAW scroll position has since drifted below that
       * anchor. Below `deadSpan()`, target is pinned to the anchor exactly — not damped,
       * literally unchanged, however hard or however many times the wheel fires. Past
       * it, the anchor stays put and the ordinary resistance ramp below takes over
       * computed from `current` (which has been sitting at the anchor the whole time),
       * so the handoff is smooth rather than a jump: at dampMax the first tick past the
       * threshold only moves 6% of the way to `raw`, same as any other departure. */
      var r = resolve(current);
      var active = activeStation(r);
      var span = stationDeadSpan(active);
      var deadKey = active ? (active.leg + ':' + active.id) : null;
      if (active && span > 0) {
        if (deadArmedStation !== deadKey) { deadArmedStation = deadKey; deadAnchor = current; }
        var shortfall = deadAnchor - raw;
        if (shortfall > 0) {
          if (shortfall < span) { target = deadAnchor; schedule(); return; }
        } else {
          deadAnchor = current;   // not pulling back right now — keep the anchor at "here"
        }
      } else {
        deadAnchor = null; deadArmedStation = null;
      }

      /* Resistance: the target only follows part of the way, so the film crawls as the
       * station arrives AND as it is left. The same zone the arrival crawls through is
       * the deadzone a light swipe back cannot punch through — one tick of a small wheel
       * delta moves the target by only (1-res) of it, so a flick barely dents the
       * position while a sustained scroll still leaves eventually. This used to check
       * `raw > current` and let a departure through at full speed unconditionally, which
       * is exactly why a light swipe back bounced you straight out — resistance is a
       * function of POSITION, not of the direction you happen to be moving in, so it has
       * to apply both ways to mean anything. Never a hard block: the target still moves
       * every tick, just slower, so leaving is still always possible, only no longer
       * effortless. */
      var res = resistance(current);
      target = res > 0 ? current + (raw - current) * (1 - res) : raw;
      schedule();
    }

    /* Called by the UI when a step's media has been supplied and generated. */
    function refreshGate() {
      applyLock();
      target = readTarget();
      schedule();
    }

    /* ---- wiring -------------------------------------------------------------- */
    layout();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () {
      layout();
      target = readTarget();
      current = target;
      write(current, true);
    });

    videos.forEach(function (v) {
      v.addEventListener('loadedmetadata', schedule);
      v.addEventListener('progress', schedule);
      v.addEventListener('canplaythrough', schedule);
      v.addEventListener('error', function () {
        if (readout) readout.textContent = 'не завантажилось: ' + v.getAttribute('src');
      });
      /* Nudging currentTime forces the browser to actually fetch rather than sit on
       * metadata alone, which some engines do until the element is displayed. */
      v.addEventListener('loadedmetadata', function () {
        try { if (v.currentTime === 0) v.currentTime = 0.001; } catch (e) {}
      }, { once: true });
    });

    /* If a decode stalls, open anyway rather than trapping the viewer on a loader. */
    /* Fallback for the engine's OWN preload path, so a stalled decode cannot trap the
     * viewer on a loader. Not needed when the page preloaded — there it would just be a
     * second thing racing to open the journey. */
    if (!config.preloaded) {
      setTimeout(function () { if (!ready) openJourney(); }, config.loaderTimeoutMs || 25000);
    }

    schedule();

    /* Exposed so the state can be asserted from outside. The embedded pane this was
     * developed in has no viewport and never fires requestAnimationFrame, so visual
     * checks are worthless there and state checks are the only honest ones. */
    return {
      state: function () {
        var r = resolve(current);
        var active = activeStation(r);
        return {
          ready: ready,
          target: target,
          current: current,
          leg: r.idx,
          legName: legs[r.idx].name,
          local: r.local,
          eased: r.eased,
          /* `station` stays boolean for existing consumers. The identity and the full
           * current-leg registry make a new UI deterministic without reverse-engineering
           * thresholds from a global scroll value. */
          station: !!active,
          stationId: active ? active.id : null,
          stationIndex: active ? active.index : -1,
          stationInfo: stationPublic(active),
          stations: (stationsByLeg[r.idx] || []).map(stationPublic),
          videoTime: videos[r.idx].currentTime,
          videoDuration: videos[r.idx].duration,
          durations: videos.map(function (v) { return v.duration; }),
          preload: preloadProgress(),
          motionTableLoaded: !!(motion && motion.legs),
          usingTableForLeg: !!(motion && motion.legs && motion.legs[r.idx] && motion.legs[r.idx].table),
          resistance: resistance(current),
          gateOpen: gateOpen(r.idx, active),
          lockedLeg: lockedLeg,
          lockedStationId: lockedStation ? lockedStation.id : null,
          uiLag: uiLag
        };
      },
      seek: function (p) { target = current = clamp01(p); write(current, true); applyLock(); return this.state(); },
      forceOpen: openJourney,
      /* Programmatic arrival, for the interface layer to call when a step completes. Same
       * easing as a hand, and a hand cancels it. Returns a promise resolving to why it ended:
       * 'arrived' | 'user took over' | 'superseded'. */
      advanceTo: advanceTo,
      /* Explicitly target a physical station without teaching UI code the scroll
       * arithmetic. `advanceTo(leg)` remains the backwards-compatible "last station in
       * that leg" primitive. */
      advanceToStation: function (leg, stationId, opts) {
        var legIndex = Math.max(0, Math.min(legs.length - 1, Number(leg) || 0));
        if (!stationAtId(legIndex, stationId)) {
          throw new RangeError('Unknown station "' + stationId + '" for leg ' + legIndex);
        }
        opts = opts || {};
        opts.stationId = stationId;
        return advanceTo(legIndex, opts);
      },
      releaseAndAdvance: function (opts) { return advanceTo(resolve(current).idx + 1, opts); },
      /* The UI calls this when a step's media has arrived and generated, which is the
       * only thing that opens a gate. */
      refreshGate: refreshGate
    };
  }

  global.WardrobeJourney = { create: create, easeSine: easeSine };
})(window);
