/* WARDROBE — the score, and the room it is heard in.
 *
 * One track per leg, crossfaded on the seam. Then the whole thing is put inside the same
 * space the picture is in: a wide concrete room.
 *
 * WHY WEBAUDIO, after first deciding against it
 * ---------------------------------------------
 * The first version faded element volume only, on the grounds that WebAudio would mean
 * decoding three long mp3s into buffers and paying tens of megabytes of memory. That
 * reasoning was wrong in the way that mattered: it is only true of AudioBufferSourceNode.
 * `createMediaElementSource` taps a streaming <audio> element, so the whole node graph is
 * available at no memory cost — and reverb is not possible without it.
 *
 * THE GRAPH, per track
 *
 *   <audio> -> source -> trackGain ->  dry ------------------------------>|
 *                                  ->  convolver -> reverbWet ----------->|-> lowShelf
 *                                  ->  delay <-> feedback -> echoWet ---->|      |
 *                                                                              master
 *                                                                                |
 *                                                                            destination
 *
 *   reverbWet sits at a fixed 0.20 — the owner asked for twenty percent.
 *   lowShelf trims the bottom slightly: he asked for the bass a little damped.
 *   echoWet and feedback are DRIVEN BY SCROLL SPEED: they open as the swipe accelerates
 *   and decay back to nothing when the movement stops.
 *
 * The impulse response is synthesised rather than loaded: decaying noise with an RT60
 * around two seconds, which is what a large hard-surfaced concrete room measures. No
 * asset to ship, and it is deterministic.
 *
 * Legs and speed both come from the engine. This file reads no scroll of its own, so
 * there is still one clock.
 */
(function (global) {
  'use strict';

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  /* A LARGE ROOM WITH CONCRETE WALLS.
   *
   * Three things make concrete sound like concrete rather than like a generic reverb:
   *
   *   1. DISCRETE EARLY REFLECTIONS. Bare parallel walls slap — you hear individual
   *      returns before the tail smears into diffusion. Pure decaying noise never does
   *      that and always reads as a plate. So a handful of taps are written in at real
   *      arrival times for a room of this size, each one alternating channel so the
   *      slaps come off opposite walls.
   *   2. A BRIGHT TAIL. Concrete barely absorbs high frequencies, so the top does not
   *      die away much faster than the bottom. The tail is therefore only gently
   *      low-passed with distance rather than heavily damped.
   *   3. PREDELAY. The gap before the first return is what the ear reads as volume of
   *      space. Too little and any amount of wet just sounds like mud sitting on the mix.
   *
   * Deterministic: a fixed seed per channel means the room is identical on every load,
   * so nobody ever hears a different space after a refresh.
   */
  function buildImpulse(ctx, seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * seconds);
    var ir = ctx.createBuffer(2, len, rate);

    /* Arrival times in seconds and relative strengths of the early slaps. Spacing is
     * deliberately uneven — evenly spaced taps ring on one pitch. */
    var taps = [
      [0.021, 0.92], [0.037, 0.74], [0.049, 0.66], [0.071, 0.55],
      [0.094, 0.47], [0.118, 0.38], [0.151, 0.31], [0.186, 0.24]
    ];

    for (var ch = 0; ch < 2; ch++) {
      var data = ir.getChannelData(ch);
      var seed = ch === 0 ? 0x2f6e2b1 : 0x5bd1e995;

      /* Diffuse tail. The exponent is small so the decay is long and even, which is what
       * a hard-walled hall does; a steep curve is what a furnished room does. */
      for (var i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        var noise = (seed / 0x3fffffff) - 1;
        var t = i / len;
        /* Predelay: silence, then the tail builds rather than starting at full level. */
        var pre = 0.020;
        var tt = i / rate;
        var gate = tt < pre ? 0 : Math.min(1, (tt - pre) / 0.09);
        data[i] = noise * gate * Math.pow(1 - t, decay) * 0.62;
      }

      /* Early reflections on top, offset per channel so left and right slap differently. */
      for (var k = 0; k < taps.length; k++) {
        var when = taps[k][0] * (ch === 0 ? 1 : 1.13);
        var idx = Math.floor(when * rate);
        if (idx >= len) continue;
        var amp = taps[k][1] * (ch === 0 ? 1 : 0.94);
        /* A tap is a short burst, not a single sample: one sample is a click, a few
         * milliseconds is a wall. */
        var burst = Math.floor(rate * 0.0016);
        for (var j = 0; j < burst && idx + j < len; j++) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          var n2 = (seed / 0x3fffffff) - 1;
          data[idx + j] += n2 * amp * (1 - j / burst);
        }
      }
    }
    return ir;
  }

  function create(config) {
    var stage = document.querySelector('[data-stage]');
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;

    var ctx = new Ctx();

    /* ---- shared tail of the graph ---- */
    var master = ctx.createGain();
    master.gain.value = typeof config.volume === 'number' ? config.volume : 0.55;

    /* "Трошки приглушений бас" — a gentle shelf, not a filter sweep. */
    var lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 170;
    lowShelf.gain.value = -3.5;

    /* Concrete is reflective up top; a small high shelf lift keeps it from sounding
     * like a blanket once the low end is trimmed. */
    var highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 4200;
    highShelf.gain.value = 1.5;

    lowShelf.connect(highShelf);
    highShelf.connect(master);
    master.connect(ctx.destination);

    /* ---- room ---- */
    var convolver = ctx.createConvolver();
    /* Long and evenly decaying: a big hall with hard walls, not a treated room. */
    convolver.buffer = buildImpulse(ctx, config.roomSeconds || 3.6, config.roomDecay || 1.5);
    var reverbWet = ctx.createGain();
    var baseReverb = typeof config.reverb === 'number' ? config.reverb : 0.35;
    reverbWet.gain.value = baseReverb;
    convolver.connect(reverbWet);
    reverbWet.connect(lowShelf);

    /* ---- echo, driven by scroll speed ---- */
    var delay = ctx.createDelay(1.5);
    delay.delayTime.value = config.delaySeconds || 0.34;
    var feedback = ctx.createGain();
    feedback.gain.value = 0;
    var echoWet = ctx.createGain();
    echoWet.gain.value = 0;
    /* Roll the top off inside the loop so repeats darken as they go, the way a real room
     * loses high frequencies with every bounce. */
    var echoDamp = ctx.createBiquadFilter();
    echoDamp.type = 'lowpass';
    echoDamp.frequency.value = 2600;

    delay.connect(echoDamp);
    echoDamp.connect(feedback);
    feedback.connect(delay);
    echoDamp.connect(echoWet);
    echoWet.connect(lowShelf);

    /* ---- one chain per track ---- */
    var els = [], gains = [];
    config.tracks.forEach(function (src, i) {
      var a = new Audio();
      a.src = src;
      a.loop = true;
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      els.push(a);

      var srcNode = ctx.createMediaElementSource(a);
      var g = ctx.createGain();
      g.gain.value = 0;
      srcNode.connect(g);
      g.connect(lowShelf);   // dry
      g.connect(convolver);  // room
      g.connect(delay);      // echo
      gains.push(g);
    });

    var activeIndex = -1;
    var unlocked = false;
    var muted = config.startMuted === true ? true : (false);
    /* Muted at the start means the score can begin playing under the loader without a
     * gesture — a muted element is allowed to play. The sound button then unmutes, and
     * that click is itself the gesture the browser was waiting for. */

    /* Long fades that OVERLAP. `gapMs` is allowed to be negative, and a negative value is
     * an overlap: the incoming track starts that many milliseconds BEFORE the outgoing one
     * has finished falling. The earlier build took the handover all the way down to
     * silence, which read as a dropout between two tracks rather than as one continuous
     * score; a short crossing keeps the room breathing across the seam. */
    var fadeOutMs = config.fadeOutMs || 4200;
    var gapMs = typeof config.gapMs === 'number' ? config.gapMs : -1200;
    var fadeInMs = config.fadeInMs || 3400;

    function rampGain(param, to, ms) {
      var now = ctx.currentTime;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(to, now + ms / 1000);
    }

    /* TRANSITION THROUGH SILENCE, not a crossfade.
     *
     * A direct crossfade means both tracks are audible together for its whole length, and
     * with two mixes of the same song that overlap reads as phasing rather than as a
     * change. So the outgoing track falls all the way to silence, the room is left empty
     * for a beat — long enough for the reverb tail to finish, which is what makes the
     * silence read as architectural rather than as a dropout — and only then does the next
     * track rise.
     *
     * Total handover is fadeOutMs + gapMs + fadeInMs, so the numbers below are long on
     * purpose. A pending handover is cancelled if the viewer scrolls back before it lands.
     */
    var pending = null;

    function to(index) {
      if (!unlocked) { activeIndex = index; return; }
      if (index === activeIndex || !els[index]) return;

      if (pending) { clearTimeout(pending.inTimer); clearTimeout(pending.parkTimer); pending = null; }

      var from = activeIndex;
      activeIndex = index;   // claim it now so a second call is a no-op

      if (from >= 0) {
        rampGain(gains[from].gain, 0, fadeOutMs);
      }

      var outFor = from >= 0 ? fadeOutMs : 0;
      var gap = from >= 0 ? gapMs : 0;

      var parkTimer = setTimeout(function () {
        /* Park the old element only after it is fully silent, so nobody hears it stop. */
        if (from >= 0 && activeIndex !== from) els[from].pause();
      }, outFor + 80);

      var inTimer = setTimeout(function () {
        if (activeIndex !== index) return;   // scrolled away mid-handover
        /* Resume where the track is rather than restarting: a retrigger on every reverse
         * scroll is the fastest way to make audio feel cheap. */
        var p = els[index].play();
        if (p && p.catch) p.catch(function () {});
        rampGain(gains[index].gain, muted ? 0 : 1, fadeInMs);
        pending = null;
      }, outFor + gap);

      pending = { inTimer: inTimer, parkTimer: parkTimer, index: index };
    }

    function unlock() {
      if (unlocked) return;
      if (ctx.state === 'suspended') ctx.resume();
      unlocked = true;
      var i = activeIndex >= 0 ? activeIndex : 0;
      activeIndex = -1;
      to(i);
    }

    /* START IMMEDIATELY IF THE BROWSER ALLOWS IT.
     *
     * Audible playback without a user gesture is blocked by policy, but NOT always: a
     * visitor who has used the site before carries enough engagement for it to be
     * permitted outright. The earlier version never even asked — it waited for a gesture
     * unconditionally, which meant silence for everyone including the cases where sound
     * was allowed.
     *
     * So: try now. Resolve tells us it played, and nothing else is needed. Reject means
     * policy really did block it, and only then is a gesture listener attached — quietly,
     * so the page is not nagging about something that may not even apply.
     *
     * Resolves to true if sound is already running, false if it is waiting on a gesture.
     */
    function start() {
      var resumed = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
      return Promise.resolve(resumed).then(function () {
        var first = els[activeIndex >= 0 ? activeIndex : 0];
        return first.play();
      }).then(function () {
        unlock();
        return true;
      }).catch(function () {
        /* Blocked. Wait for the first real gesture, then come up. */
        var wake = function () {
          detach();
          unlock();
        };
        var evts = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
        var detach = function () {
          evts.forEach(function (e) { window.removeEventListener(e, wake); });
        };
        evts.forEach(function (e) { window.addEventListener(e, wake, { passive: true, once: false }); });
        return false;
      });
    }

    /* ---- speed -> echo -------------------------------------------------------
     * `speed` arrives already normalised and smoothed from the engine. Fast movement
     * opens the repeats; stillness closes them. Ramps are short so it tracks a flick,
     * but not so short that they click. */
    var maxEcho = typeof config.echoMax === 'number' ? config.echoMax : 0.80;
    var maxFeedback = typeof config.feedbackMax === 'number' ? config.feedbackMax : 0.66;

    function setSpeed(speed) {
      var s = clamp01(speed);
      /* SINE, as specified: the echo comes UP on a sine to its ceiling at speed and falls
       * back to nothing at rest. Not a power curve — a power curve is steep at one end and
       * flat at the other, so it either ignores ordinary scrolling or slams on a flick.
       * A raised cosine is symmetric: gentle out of stillness, steepest in the middle,
       * easing into the ceiling. It is also the same shape the camera moves on, so the room
       * opens in step with the picture instead of on its own schedule. */
      var shaped = 0.5 - 0.5 * Math.cos(Math.PI * s);
      rampGain(echoWet.gain, muted ? 0 : maxEcho * shaped, 90);
      rampGain(feedback.gain, maxFeedback * shaped, 140);

      /* Concrete keeps its top end, so the repeats brighten a long way as they open —
       * from a dark thud at rest to hard slapback at speed. */
      var f = 2400 + 8600 * shaped;
      echoDamp.frequency.cancelScheduledValues(ctx.currentTime);
      echoDamp.frequency.linearRampToValueAtTime(f, ctx.currentTime + 0.12);

      /* THE ROOM IS CONSTANT. Reverb sits at its configured share and does not follow the
       * speed: the apartment does not get more concrete when you scroll faster. It used to
       * rise to 0.55 of the remaining headroom with movement, which made two effects answer
       * one gesture and muddied the echo it was supposed to sit behind. The echo alone
       * carries the movement now. */
      rampGain(reverbWet.gain, baseReverb, 180);
    }

    function setMuted(m) {
      muted = m;
      if (activeIndex >= 0) rampGain(gains[activeIndex].gain, muted ? 0 : 1, 220);
      if (muted) rampGain(echoWet.gain, 0, 220);
      return muted;
    }

    new MutationObserver(function () {
      var leg = Number(stage.getAttribute('data-leg'));
      if (isFinite(leg)) to(Math.min(els.length - 1, Math.max(0, leg)));
    }).observe(stage, { attributes: true, attributeFilter: ['data-leg'] });

    return {
      unlock: unlock,
      start: start,
      setSpeed: setSpeed,
      toggleMute: function () { return setMuted(!muted); },
      setMuted: setMuted,
      state: function () {
        return {
          contextState: ctx.state,
          unlocked: unlocked,
          muted: muted,
          handover: { fadeOutMs: fadeOutMs, gapMs: gapMs, fadeInMs: fadeInMs,
                      totalMs: fadeOutMs + gapMs + fadeInMs, inFlight: !!pending },
          activeIndex: activeIndex,
          activeSrc: activeIndex >= 0 ? els[activeIndex].src.split('/').pop() : null,
          trackGains: gains.map(function (g) { return +g.gain.value.toFixed(3); }),
          reverbWet: +reverbWet.gain.value.toFixed(3),
          echoWet: +echoWet.gain.value.toFixed(3),
          feedback: +feedback.gain.value.toFixed(3),
          echoCutoffHz: Math.round(echoDamp.frequency.value),
          lowShelfDb: lowShelf.gain.value,
          highShelfDb: highShelf.gain.value,
          impulseSeconds: convolver.buffer ? +(convolver.buffer.length / ctx.sampleRate).toFixed(2) : null,
          paused: els.map(function (e) { return e.paused; }),
          readyStates: els.map(function (e) { return e.readyState; })
        };
      }
    };
  }

  global.WardrobeAudio = { create: create };
})(window);
