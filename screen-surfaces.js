/* WARDROBE — measured TV and laptop surfaces.
 *
 * The screen content belongs to planes inside the D footage, not to the browser frame.
 * This controller consumes the journey's existing frame callback, interpolates only
 * committed measurements, and fails closed if calibration or real content is absent.
 */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.WardrobeScreenSurfaces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }
  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function normaliseRect(frame) {
    if (!frame || typeof frame !== 'object') throw new TypeError('TV frame must be an object');
    var result = {
      time: finite(frame.time, -1),
      x: finite(frame.x, -1),
      y: finite(frame.y, -1),
      width: finite(frame.width, -1),
      height: finite(frame.height, -1)
    };
    if (result.time < 0 || result.x < 0 || result.y < 0 ||
        result.width <= 0 || result.height <= 0 ||
        result.x + result.width > 1.000001 || result.y + result.height > 1.000001) {
      throw new RangeError('TV frame must stay inside the film frame');
    }
    return Object.freeze(result);
  }

  function normaliseRectFrames(frames) {
    if (!Array.isArray(frames) || !frames.length) throw new TypeError('TV calibration is empty');
    var list = frames.map(normaliseRect).sort(function (a, b) { return a.time - b.time; });
    for (var i = 1; i < list.length; i++) {
      if (list[i].time <= list[i - 1].time) throw new RangeError('TV frame times must increase');
    }
    return Object.freeze(list);
  }

  function mix(a, b, ratio) { return a + (b - a) * ratio; }
  function interpolateRectPrepared(list, time) {
    var at = finite(time, list[0].time);
    if (at <= list[0].time) return list[0];
    if (at >= list[list.length - 1].time) return list[list.length - 1];
    for (var i = 1; i < list.length; i++) {
      if (at <= list[i].time) {
        var a = list[i - 1], b = list[i];
        var ratio = clamp01((at - a.time) / (b.time - a.time));
        return Object.freeze({
          time: at,
          x: mix(a.x, b.x, ratio),
          y: mix(a.y, b.y, ratio),
          width: mix(a.width, b.width, ratio),
          height: mix(a.height, b.height, ratio)
        });
      }
    }
    return list[list.length - 1];
  }

  function interpolateRect(frames, time) {
    return interpolateRectPrepared(normaliseRectFrames(frames), time);
  }

  function insetQuad(quad, amount) {
    var value = clamp01(finite(amount, 0));
    var cx = (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4;
    var cy = (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4;
    function point(p) {
      return { x: mix(p.x, cx, value), y: mix(p.y, cy, value) };
    }
    return {
      time: quad.time,
      tl: point(quad.tl), tr: point(quad.tr), br: point(quad.br), bl: point(quad.bl)
    };
  }

  /* THE TELEVISION LADDER — owner decision, 2026-07-31.
   *
   * The shelf is never a step and never empty once anything is finished. It carries the
   * most finished artefact the session owns, in this order:
   *
   *   video (4) > shoot (3) > background (2) > look (1)
   *
   * `rank` is what enforces that. The previous contract accepted only a 16:9 item or a
   * shoot and silently dropped everything else, so the two lower rungs could not reach
   * the screen at all: a portrait look returned from addResult without ever being pushed.
   * Ordering by rank rather than by arrival also means a later, weaker artefact does not
   * demote a stronger one that is already on the shelf.
   *
   * Aspect stays part of the model because the surface fits media inside the measured
   * aperture, but it is deliberately NOT rendered as text — see renderTelevision. */
  var RESULT_RANK = { look: 1, background: 2, shoot: 3, video: 4 };
  var RESULT_LABEL = {
    look: 'Образ',
    background: 'Фон',
    shoot: 'Фотосесія',
    video: 'Фешн-відео'
  };

  function resultModel(raw) {
    raw = raw || {};
    var kind = RESULT_RANK[raw.kind] ? raw.kind : 'video';
    var aspect = raw.aspect === '9:16' ? '9:16' : '16:9';
    var urls = Array.isArray(raw.urls) ? raw.urls.filter(function (url) {
      return typeof url === 'string' && url.length > 0;
    }).slice(0, kind === 'shoot' ? 5 : 1) : [];
    return Object.freeze({
      kind: kind,
      rank: RESULT_RANK[kind],
      aspect: aspect,
      urls: Object.freeze(urls),
      mediaUrl: typeof raw.mediaUrl === 'string' ? raw.mediaUrl : '',
      label: RESULT_LABEL[kind],
      pendingRealMedia: raw.pendingRealMedia !== false && !urls.length && !raw.mediaUrl
    });
  }

  function create(options) {
    options = options || {};
    var film = options.film || (typeof document !== 'undefined' && document.querySelector('[data-film]'));
    var tv = film && film.querySelector('[data-tv-surface]');
    var tvGallery = tv && tv.querySelector('[data-tv-gallery]');
    var laptop = film && film.querySelector('[data-laptop-surface]');
    var laptopPage = laptop && laptop.querySelector('[data-laptop-page]');
    var math = typeof globalThis !== 'undefined' ? globalThis.WardrobeSurfaceMath : null;
    var calibration = null;
    var tvFrames = null;
    var laptopFrames = null;
    var results = [];
    var activeResult = -1;
    var tvWake = false;
    var tvWakePending = false;
    var tvWakeTimer = 0;
    var laptopMounted = false;
    var lastFrame = null;

    function setHidden(element, hidden) {
      if (!element) return;
      element.hidden = hidden;
      element.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }

    function portraitStrip(item) {
      var cells = '';
      for (var i = 0; i < 5; i++) {
        var url = item.urls[i];
        cells += '<figure class="tv-shot" data-filled="' + (url ? '1' : '0') + '">' +
          (url ? '<img src="' + esc(url) + '" alt="Кадр ' + (i + 1) + '" width="240" height="360">'
               : '<span aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>') +
          '</figure>';
      }
      return '<div class="tv-contact" aria-label="Пʼять вертикальних кадрів">' + cells + '</div>';
    }

    /* A television shows a moving picture, not a media player. `controls` put a play
     * button, a timecode, a volume slider and a kebab menu on top of filmed furniture —
     * browser chrome floating in front of the television, which the window map forbids
     * outright. It also left the clip parked on its last frame, so the screen read as a
     * dead still. Muted autoplay with loop is what a screen on a wall actually does, and
     * muted playback is not subject to the autoplay policy that would block sound. */
    function videoFrame(item) {
      if (item.mediaUrl) {
        return '<video class="tv-result-video" src="' + esc(item.mediaUrl) +
          '" autoplay loop muted playsinline preload="auto" tabindex="-1"' +
          ' aria-label="Фешн-відео"></video>';
      }
      return '<div class="tv-result-wait" role="status"><span class="orb orb--small" aria-hidden="true">' +
        '<i></i><i></i><i></i></span><b>Відео зʼявиться тут</b></div>';
    }

    /* A single still — the look or the background rung. Fitted inside the aperture by CSS
     * `contain`, never cropped to fill: a portrait look inside the horizontal television
     * is meant to read as a picture on a screen, not as a stretched wallpaper. */
    function stillFrame(item) {
      var url = item.mediaUrl || item.urls[0];
      if (url) {
        return '<figure class="tv-result-still"><img src="' + esc(url) +
          '" alt="' + esc(item.label) + '" loading="lazy"></figure>';
      }
      return '<div class="tv-result-wait" role="status"><span class="orb orb--small" aria-hidden="true">' +
        '<i></i><i></i><i></i></span><b>' + esc(item.label) + ' зʼявиться тут</b></div>';
    }

    function renderTelevision() {
      if (!tvGallery) return;
      if (!results.length) {
        tvGallery.innerHTML = '';
        return;
      }
      var item = results[activeResult < 0 ? results.length - 1 : activeResult];
      /* The head names the artefact only. The aspect string used to be printed next to it,
       * which put implementation vocabulary on a client surface that docs/10 forbids. */
      tvGallery.innerHTML =
        '<div class="tv-gallery__head"><span>' + esc(item.label) + '</span></div>' +
        (item.kind === 'shoot' ? portraitStrip(item)
          : item.kind === 'video' ? videoFrame(item)
          : stillFrame(item));
    }

    function positionTelevision(frame) {
      if (!tv || !calibration || !calibration.tv || !tvFrames || !results.length) {
        setHidden(tv, true);
        return;
      }
      var frames = tvFrames;
      var first = frames[0].time;
      var last = frames[frames.length - 1].time;
      var visible = frame.leg === calibration.tv.leg &&
        frame.videoTime != null && frame.videoTime >= first && frame.videoTime <= last + 0.35;
      if (!visible) {
        setHidden(tv, true);
        return;
      }
      var rect = interpolateRectPrepared(frames, frame.videoTime);
      tv.style.left = (rect.x * 100).toFixed(4) + '%';
      tv.style.top = (rect.y * 100).toFixed(4) + '%';
      tv.style.width = (rect.width * 100).toFixed(4) + '%';
      tv.style.height = (rect.height * 100).toFixed(4) + '%';
      if (tvWakePending && !tvWake) {
        tvWakePending = false;
        tvWake = true;
        clearTimeout(tvWakeTimer);
        tvWakeTimer = setTimeout(function () {
          tvWake = false;
          if (tv) tv.dataset.wake = '0';
        }, 900);
      }
      tv.dataset.wake = tvWake ? '1' : '0';
      setHidden(tv, false);
    }

    function positionLaptop(frame) {
      if (!laptop || !laptopPage || !laptopMounted || !calibration ||
          !calibration.laptop || !laptopFrames || !math) {
        setHidden(laptop, true);
        return;
      }
      var frames = laptopFrames;
      var first = frames[0].time;
      var last = frames[frames.length - 1].time;
      var visible = frame.leg === calibration.laptop.leg &&
        frame.videoTime != null && frame.videoTime >= first && frame.videoTime <= last;
      if (!visible) {
        setHidden(laptop, true);
        return;
      }
      var quad = math.interpolateQuad(frames, frame.videoTime);
      quad = insetQuad(quad, calibration.laptop.safe_inset || 0);
      var sourceWidth = 1200;
      var sourceHeight = 800;
      var projected = math.cssMatrix3dForQuad(quad, {
        sourceWidth: sourceWidth,
        sourceHeight: sourceHeight,
        stageWidth: film.clientWidth || 1920,
        stageHeight: film.clientHeight || 1080
      });
      laptop.style.width = sourceWidth + 'px';
      laptop.style.height = sourceHeight + 'px';
      laptop.style.transform = projected.css;
      setHidden(laptop, false);
    }

    function update(frame) {
      lastFrame = frame || lastFrame;
      if (!lastFrame) return;
      positionTelevision(lastFrame);
      positionLaptop(lastFrame);
    }

    /* Every rung of the ladder is admitted; the shelf then shows the strongest one it
     * holds. The old aspect/shoot guard is gone deliberately — it was the reason a
     * portrait look or a finished background could never appear on the television. */
    function addResult(raw) {
      var item = resultModel(raw);
      results.push(item);
      activeResult = strongestResult();
      renderTelevision();
      update(lastFrame);
      return item;
    }

    /* Highest rank wins; a tie is settled by arrival, so a newer shoot replaces an older
     * shoot but never loses to it. */
    function strongestResult() {
      var best = -1;
      for (var i = 0; i < results.length; i++) {
        if (best < 0 || results[i].rank >= results[best].rank) best = i;
      }
      return best;
    }

    function wakeTelevision() {
      tvWakePending = true;
      update(lastFrame);
    }

    function mountLaptop(content) {
      if (!laptopPage || !content) return false;
      laptopPage.innerHTML = '';
      if (typeof content === 'string') laptopPage.innerHTML = content;
      else if (content.nodeType) laptopPage.appendChild(content);
      else return false;
      laptopMounted = true;
      update(lastFrame);
      return true;
    }

    var calibrationUrl = options.calibrationUrl || 'screen-calibration.json';
    if (typeof fetch === 'function') {
      fetch(calibrationUrl).then(function (response) {
        if (!response.ok) throw new Error('screen calibration unavailable');
        return response.json();
      }).then(function (value) {
        calibration = value;
        if (calibration.tv && calibration.tv.frames) {
          tvFrames = normaliseRectFrames(calibration.tv.frames);
        }
        if (calibration.laptop && calibration.laptop.frames && math) {
          laptopFrames = math.normaliseQuadCalibration({
            leg: calibration.laptop.leg,
            measuredFrom: calibration.laptop.measured_from,
            frames: calibration.laptop.frames
          }, 'Laptop').frames;
        }
        update(lastFrame);
      }).catch(function () {
        calibration = null;
        tvFrames = null;
        laptopFrames = null;
        setHidden(tv, true);
        setHidden(laptop, true);
      });
    }

    setHidden(tv, true);
    setHidden(laptop, true);

    /* The page keeps its instance in a module-scoped variable, so there is no way to put a
     * result on the shelf from outside once the journey is running. That makes the surface
     * impossible to inspect before the adapter exists: the owner cannot see whether the
     * mask tracks the aperture through the push-in without first having a finished job.
     *
     * Publishing the instance is the smallest thing that fixes it. It is a handle, not a
     * route and not a query switch — the journey still shows nothing on its own, and a
     * runtime candidate switch stays as absent as canonical-d-identity requires. */
    var instance = Object.freeze({
      update: update,
      addResult: addResult,
      wakeTelevision: wakeTelevision,
      mountLaptop: mountLaptop,
      state: function () {
        return {
          calibrated: !!calibration,
          results: results.slice(),
          activeResult: activeResult,
          laptopMounted: laptopMounted,
          frame: lastFrame
        };
      }
    });
    current = instance;
    return instance;
  }

  /* The most recently created surface controller. One journey creates one, so this is the
   * live one; it is null until the page builds it. */
  var current = null;

  return Object.freeze({
    create: create,
    normaliseRectFrames: normaliseRectFrames,
    interpolateRect: interpolateRect,
    resultModel: resultModel,
    active: function () { return current; }
  });
});
