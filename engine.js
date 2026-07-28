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

    function layout() {
      var vh = viewport();
      stage.style.height = vh + 'px';
      track.style.height = (vh * config.screensPerLeg * legs.length) + 'px';

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

      var w = sw, h = sw / aspect;
      if (h < sh) { h = sh; w = sh * aspect; }   // cover, not contain
      w *= over; h *= over;

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
      if (loader && !config.holdLoader) loader.setAttribute('data-done', '1');
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

    /* Split the global scalar into a leg index plus eased local progress. */
    function resolve(p) {
      var n = legs.length;
      var scaled = clamp01(p) * n;
      var idx = Math.min(n - 1, Math.floor(scaled));
      var local = clamp01(scaled - idx);
      return { idx: idx, local: local, eased: easeSine(local) };
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
      var W = config.seamWindow || 0.10;   // fraction of a leg spent overlapping
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

      /* A station is a leg's settled end — where the camera has stopped and the
       * interface belongs. Held slightly before 1 so it is reached before the seam. */
      var station = r.local > 0.86 ? 1 : 0;
      root.style.setProperty('--station', String(station));
      stage.setAttribute('data-leg', String(r.idx));
      stage.setAttribute('data-station', String(station));

      if (readout) {
        readout.textContent =
          'відрізок ' + (r.idx + 1) + '/' + legs.length + ' · ' + legs[r.idx].name +
          '  ·  ' + (d && isFinite(d) ? v.currentTime.toFixed(2) : '—') + 's' +
          (station ? '  ·  станція' : '');
      }
      lastWritten = p;
    }

    function tick() {
      raf = null;

      if (!ready) {
        var pr = preloadProgress();
        paintLoader(pr);
        if (pr > 0.995) { openJourney(); } else { schedule(); return; }
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
      root.style.setProperty('--resist', resistance(current).toFixed(4));
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
     *      Backward motion is never blocked — leaving is always allowed.
     *
     * Damping is applied to the TARGET, not to the wheel. Native scroll is never
     * intercepted while a gate is open, so trackpad, keyboard and reverse scrolling
     * behave normally. Only a closed gate pins the page, and it pins it honestly by
     * holding the scroll position rather than by swallowing events.
     */
    function stationLocalOf(p) {
      return resolve(p).local;
    }

    /* How much a station resists, 0 free .. 1 immovable. */
    function resistance(p) {
      var r = resolve(p);
      var enter = config.dampFrom !== undefined ? config.dampFrom : 0.72;
      var at = config.stationAt !== undefined ? config.stationAt : 0.92;
      if (r.local <= enter) return 0;
      /* Normalised over enter -> STATION, not enter -> 1. Ramping to the end of the leg
       * meant the resistance was still only a third of maximum when the hard gate took
       * over, so the "insensitive" stretch never actually arrived. */
      var span = Math.max(0.0001, at - enter);
      var x = (r.local - enter) / span;
      /* Cubic so the first part of the approach is barely affected and the last part is
       * heavy. A linear ramp makes the whole approach feel sticky instead of arriving. */
      return clamp01(x * x * x) * (config.dampMax !== undefined ? config.dampMax : 0.94);
    }

    function gateOpen(idx) {
      if (typeof config.gateFor !== 'function') return true;
      return config.gateFor(idx) !== false;
    }

    /* The scroll position that corresponds to the current leg's station. */
    function stationScrollFor(idx) {
      var max = root.scrollHeight - viewport();
      var pStation = (idx + (config.stationAt !== undefined ? config.stationAt : 0.92)) / legs.length;
      return Math.round(clamp01(pStation) * max);
    }

    var lockedLeg = -1;

    function applyLock() {
      var r = resolve(current);
      var shouldLock = r.local >= (config.stationAt !== undefined ? config.stationAt : 0.92) &&
                       r.idx < legs.length - 1 &&
                       !gateOpen(r.idx);

      if (shouldLock && lockedLeg !== r.idx) {
        lockedLeg = r.idx;
        root.setAttribute('data-gate', 'closed');
        stage.setAttribute('data-gate', 'closed');
      } else if (!shouldLock && lockedLeg !== -1) {
        lockedLeg = -1;
        root.removeAttribute('data-gate');
        stage.removeAttribute('data-gate');
      }
      return shouldLock;
    }

    function onScroll() {
      var raw = readTarget();

      /* A closed gate holds the page at the station. Scrolling further does nothing and
       * says so — the page simply does not move forward. Scrolling back is untouched. */
      if (lockedLeg >= 0) {
        var pin = stationScrollFor(lockedLeg);
        if (window.scrollY > pin) {
          window.scrollTo(0, pin);
          target = readTarget();
          schedule();
          return;
        }
      }

      /* Resistance: the target only follows part of the way, so the film crawls as the
       * station arrives while the page itself keeps scrolling normally. */
      var res = resistance(current);
      if (res > 0 && raw > current) {
        target = current + (raw - current) * (1 - res);
      } else {
        target = raw;   // leaving, or free travel
      }
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
    setTimeout(function () { if (!ready) openJourney(); }, config.loaderTimeoutMs || 25000);

    schedule();

    /* Exposed so the state can be asserted from outside. The embedded pane this was
     * developed in has no viewport and never fires requestAnimationFrame, so visual
     * checks are worthless there and state checks are the only honest ones. */
    return {
      state: function () {
        var r = resolve(current);
        return {
          ready: ready,
          target: target,
          current: current,
          leg: r.idx,
          legName: legs[r.idx].name,
          local: r.local,
          eased: r.eased,
          station: r.local > 0.86,
          videoTime: videos[r.idx].currentTime,
          videoDuration: videos[r.idx].duration,
          durations: videos.map(function (v) { return v.duration; }),
          preload: preloadProgress(),
          motionTableLoaded: !!(motion && motion.legs),
          usingTableForLeg: !!(motion && motion.legs && motion.legs[r.idx] && motion.legs[r.idx].table),
          resistance: resistance(current),
          gateOpen: gateOpen(r.idx),
          lockedLeg: lockedLeg,
          uiLag: uiLag
        };
      },
      seek: function (p) { target = current = clamp01(p); write(current, true); applyLock(); return this.state(); },
      forceOpen: openJourney,
      /* The UI calls this when a step's media has arrived and generated, which is the
       * only thing that opens a gate. */
      refreshGate: refreshGate
    };
  }

  global.WardrobeJourney = { create: create, easeSine: easeSine };
})(window);
