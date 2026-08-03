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
    /* A screen can enter from, or leave through, an edge of the shot. Keep the
     * complete plane (including the part currently outside the viewport) and let
     * `.film { overflow:hidden }` do the clipping. Collapsing to the visible slice
     * would squeeze the media while the camera crosses the edge. */
    if (result.time < 0 || result.x < -1.000001 || result.y < -1.000001 ||
        result.width <= 0 || result.height <= 0 ||
        result.x > 1.000001 || result.y > 1.000001 ||
        result.x + result.width < -0.000001 || result.y + result.height < -0.000001 ||
        result.x + result.width > 2.000001 || result.y + result.height > 2.000001) {
      throw new RangeError('TV frame must stay within the extended film bounds');
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
   *   video (4) > shoot (3) > looks (2) > background (1)
   *
   * `rank` is what enforces that. The previous contract accepted only a 16:9 item or a
   * shoot and silently dropped everything else, so the two lower rungs could not reach
   * the screen at all: a portrait look returned from addResult without ever being pushed.
   * Ordering by rank rather than by arrival also means a later, weaker artefact does not
   * demote a stronger one that is already on the shelf.
   *
   * Aspect stays part of the model because the surface fits media inside the measured
   * aperture, but it is deliberately NOT rendered as text — see renderTelevision. */
  var RESULT_RANK = { background: 1, look: 2, shoot: 3, video: 4 };
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
    }).slice(0, (kind === 'shoot' || kind === 'look') ? 5 : 1) : [];
    return Object.freeze({
      kind: kind,
      rank: RESULT_RANK[kind],
      aspect: aspect,
      urls: Object.freeze(urls),
      previewUrls: Object.freeze(Array.isArray(raw.previewUrls) ? raw.previewUrls.filter(function (url) {
        return typeof url === 'string' && url.length > 0;
      }).slice(0, (kind === 'shoot' || kind === 'look') ? 5 : 1) : []),
      previewAttempted: raw.previewAttempted === true,
      mediaUrl: typeof raw.mediaUrl === 'string' ? raw.mediaUrl : '',
      partial: raw.partial === true,
      readyCount: Number.isFinite(Number(raw.readyCount)) ? Number(raw.readyCount) : urls.length,
      expectedCount: Number.isFinite(Number(raw.expectedCount)) ? Number(raw.expectedCount) : urls.length,
      label: RESULT_LABEL[kind],
      pendingRealMedia: raw.pendingRealMedia !== false && !urls.length && !raw.mediaUrl
    });
  }

  /* Resolve the television shelf without knowing anything about the UI that produced it.
   * Multiple completed looks are one client-facing rung, not five competing results: they
   * form a row of 1–5 transparent portraits. Stronger artefacts still replace that rung in
   * the same order (video > shoot > looks > background). This is deliberately pure so the
   * beta bridge, the cinematic runtime and tests can share exactly the same decision. */
  function strongestResult(results) {
    var best = -1;
    for (var i = 0; i < results.length; i++) {
      if (best < 0 || results[i].rank >= results[best].rank) best = i;
    }
    return best;
  }

  /* Keep each portrait's display derivative paired with its source master when
   * the TV coalesces several looks into one row.  `previewUrls` is positional:
   * an entry at index i belongs to `urls[i]`.  Missing derivatives deliberately
   * fall back to that same master, so one missing cutout never shifts every
   * portrait to the wrong person. */
  function mergeLookDisplayUrls(existing, incoming, urls) {
    var previews = new Map();
    [existing, incoming].forEach(function (item) {
      if (!item || !Array.isArray(item.urls) || !Array.isArray(item.previewUrls)) return;
      item.urls.forEach(function (source, index) {
        var preview = item.previewUrls[index];
        if (typeof source === 'string' && source && typeof preview === 'string' && preview) {
          previews.set(source, preview);
        }
      });
    });
    return urls.map(function (source) { return previews.get(source) || source; });
  }

  function addResultToShelf(existing, raw) {
    var shelf = Array.isArray(existing) ? existing.slice() : [];
    var item = resultModel(raw);
    if (item.kind === 'look') {
      var lookIndex = shelf.findIndex(function (entry) { return entry.kind === 'look'; });
      if (lookIndex >= 0) {
        var existingLook = shelf[lookIndex];
        var urls = existingLook.urls.slice();
        item.urls.forEach(function (url) {
          if (urls.indexOf(url) < 0 && urls.length < 5) urls.push(url);
        });
        var previewUrls = mergeLookDisplayUrls(existingLook, item, urls);
        shelf[lookIndex] = resultModel({
          kind: 'look',
          aspect: item.aspect,
          urls: urls,
          previewUrls: previewUrls,
          previewAttempted: existingLook.previewAttempted || item.previewAttempted || false,
          mediaUrl: urls.length === 1 ? urls[0] : ''
        });
      } else {
        shelf.push(item);
      }
    } else if (item.kind === 'shoot') {
      /* A running shoot emits cumulative approved frames, then a final contact
       * sheet. Replace the one shoot rung instead of stacking a stale partial
       * strip beside the finished one. */
      var shootIndex = shelf.findIndex(function (entry) { return entry.kind === 'shoot'; });
      if (shootIndex >= 0) shelf[shootIndex] = item;
      else shelf.push(item);
    } else {
      shelf.push(item);
    }
    return Object.freeze({
      results: Object.freeze(shelf),
      activeResult: strongestResult(shelf)
    });
  }

  function create(options) {
    options = options || {};
    var film = options.film || (typeof document !== 'undefined' && document.querySelector('[data-film]'));
    var tv = film && film.querySelector('[data-tv-surface]');
    var tvGallery = tv && tv.querySelector('[data-tv-gallery]');
    var tvContent = tv && tv.querySelector('.tv-surface__content');
    var laptop = film && film.querySelector('[data-laptop-surface]');
    var laptopPage = laptop && laptop.querySelector('[data-laptop-page]');
    var math = typeof globalThis !== 'undefined' ? globalThis.WardrobeSurfaceMath : null;
    var mediaPreview = typeof globalThis !== 'undefined' ? globalThis.WardrobeMediaPreview : null;
    var calibration = null;
    var tvTracks = [];
    var laptopFrames = null;
    var results = [];
    var activeResult = -1;
    var tvWake = false;
    var tvWakePending = false;
    var tvWakeTimer = 0;
    var laptopMounted = false;
    var laptopFullscreen = false;
    /* The terminal handoff owns the last measured quad until the user explicitly
     * reverses out of the document. This is a geometry lock, not a fullscreen route:
     * the same mounted node remains on the filmed laptop. */
    var laptopTerminalLock = false;
    var laptopHome = laptop && laptop.parentNode;
    var laptopHomeNext = laptop && laptop.nextSibling;
    var lastFrame = null;

    function setHidden(element, hidden) {
      if (!element) return;
      element.hidden = hidden;
      element.setAttribute('aria-hidden', hidden ? 'true' : 'false');
      /* Geometry owns only geometry. HOW's caller reveals the document after its
       * measured camera move resolves; entering the laptop calibration window alone
       * must not fade the document over an earlier frame. */
    }

    function portraitStrip(item) {
      var cells = '';
      var urls = item.previewUrls.length ? item.previewUrls : item.urls;
      for (var i = 0; i < 5; i++) {
        var url = urls[i];
        cells += '<figure class="tv-shot" data-filled="' + (url ? '1' : '0') + '">' +
          (url ? '<img src="' + esc(url) + '" alt="Кадр ' + (i + 1) + '" width="240" height="360">'
               : '<span aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>') +
          '</figure>';
      }
      return '<div class="tv-contact" aria-label="Пʼять вертикальних кадрів">' + cells + '</div>';
    }

    function lookStrip(item) {
      var urls = (item.previewUrls.length ? item.previewUrls : item.urls).slice(0, 5);
      var cells = urls.map(function (url, index) {
        return '<figure class="tv-look" data-filled="1">' +
          '<img src="' + esc(url) + '" alt="Образ ' + (index + 1) + '" width="240" height="360" loading="lazy">' +
          '</figure>';
      }).join('');
      return '<div class="tv-look-strip" data-count="' + urls.length + '" aria-label="' +
        (urls.length === 1 ? 'Один образ' : urls.length + ' образи') + '">' + cells + '</div>';
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
      var url = item.previewUrls[0] || item.mediaUrl || item.urls[0];
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
          : item.kind === 'look' && item.urls.length > 1 ? lookStrip(item)
          : item.kind === 'video' ? videoFrame(item)
          : stillFrame(item));
    }

    function positionTelevision(frame) {
      if (!tv || !calibration || !calibration.tv || !tvTracks.length || !results.length) {
        setHidden(tv, true);
        return;
      }
      var track = tvTracks.find(function (candidate) { return candidate.leg === frame.leg; });
      if (!track) {
        setHidden(tv, true);
        if (tv) tv.dataset.motion = 'still';
        return;
      }
      var frames = track.frames;
      var first = frames[0].time;
      var last = frames[frames.length - 1].time;
      var visible = frame.videoTime != null && frame.videoTime >= first && frame.videoTime <= last + 0.35;
      if (!visible) {
        setHidden(tv, true);
        if (tv) tv.dataset.motion = 'still';
        return;
      }
      var rect = interpolateRectPrepared(frames, frame.videoTime);
      tv.style.left = (rect.x * 100).toFixed(4) + '%';
      tv.style.top = (rect.y * 100).toFixed(4) + '%';
      tv.style.width = (rect.width * 100).toFixed(4) + '%';
      tv.style.height = (rect.height * 100).toFixed(4) + '%';
      var speed = clamp01(finite(frame.speed, 0));
      var rawDirection = finite(frame.direction, 0);
      var direction = rawDirection > 0.01 ? 1 : rawDirection < -0.01 ? -1 : 0;
      if (tvContent) {
        tvContent.style.setProperty('--tv-motion-blur', (speed * 1.8).toFixed(3) + 'px');
        tvContent.style.setProperty('--tv-motion-trail-opacity', (speed * 0.12).toFixed(3));
        tvContent.style.setProperty('--tv-motion-trail-shift', (direction * speed * -8).toFixed(2) + 'px');
        tvContent.style.setProperty('--tv-motion-angle', direction < 0 ? '270deg' : '90deg');
      }
      tv.dataset.motion = speed > 0.035 ? 'moving' : 'settled';
      tv.dataset.direction = direction < 0 ? 'backward' : direction > 0 ? 'forward' : 'still';
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
      if (!laptop || !laptopPage || !laptopMounted) {
        setHidden(laptop, true);
        return;
      }
      /* In fullscreen the same node is moved to document.body. A transformed `.film`
       * ancestor would otherwise make `position: fixed` continue to behave like an
       * absolute child of the movie, and the next camera frame would overwrite the
       * fullscreen geometry. Leave the DOM node and its page scroll untouched until the
       * reverse handoff explicitly returns it to the measured plane. */
      if (laptopFullscreen) {
        setHidden(laptop, false);
        return;
      }
      if (!calibration || !calibration.laptop || !laptopFrames || !math) {
        setHidden(laptop, true);
        return;
      }
      var frames = laptopFrames;
      var first = frames[0].time;
      var last = frames[frames.length - 1].time;
      /* The handoff is measured at 14.145 s, but decoded `currentTime` is a float.
       * Let the calibrated terminal quad hold for one subframe so an arrival at
       * 14.14567 does not hide the document just after it was correctly mounted. */
      var terminalClockTolerance = 0.02;
      var visible = laptopTerminalLock || (frame.leg === calibration.laptop.leg &&
        frame.videoTime != null && frame.videoTime >= first && frame.videoTime <= last + terminalClockTolerance);
      if (!visible) {
        setHidden(laptop, true);
        return;
      }
      /* The movie's decoded clock may continue for a subframe after the terminal
       * handoff. While the document owns scroll, pin it to the last calibrated laptop
       * quad instead of letting a later movie frame remove the only visible document. */
      var geometryTime = laptopTerminalLock ? last : frame.videoTime;
      var quad = math.interpolateQuad(frames, geometryTime);
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

    function prepareResultPreview(index) {
      /* The approved look is already a server-owned master/native-cutout pair.
       * Never run browser remove-white segmentation on its master or on any
       * compact preview: that path creates halos and breaks the SHA binding.
       * The bridge supplies CUTOUT_PREVIEW only when it was derived from the
       * verified CUTOUT_NATIVE; otherwise the master remains the honest fallback. */
      if (!mediaPreview || !results[index] || results[index].kind === 'look') return;
      var item = results[index];
      if (!item.urls.length || item.kind === 'video' || item.previewUrls.length >= item.urls.length) return;
      var removeBackground = item.kind === 'look';
      Promise.all(item.urls.map(function (url) {
        return mediaPreview.fromUrl(url, { removeBackground: removeBackground, maxEdge: 640 });
      })).then(function (entries) {
        var previews = entries.map(function (entry) { return entry && entry.url; }).filter(Boolean);
        if (!results[index] || results[index].urls.join('|') !== item.urls.join('|')) return;
        var current = results[index];
        results = results.slice();
        results[index] = resultModel({
          kind: current.kind,
          aspect: current.aspect,
          urls: current.urls,
          previewUrls: previews,
          previewAttempted: true,
          mediaUrl: current.mediaUrl
        });
        renderTelevision();
        update(lastFrame);
      }).catch(function () {
        /* Protected or unsupported media keeps its original URL as the fallback. */
      });
    }

    /* Every rung of the ladder is admitted; the shelf then shows the strongest one it
     * holds. Multiple looks are coalesced into one 1–5 portrait strip by the pure resolver
     * above, so the TV never renders five separate headings for five saved looks. */
    function addResult(raw) {
      var shelf = addResultToShelf(results, raw);
      results = shelf.results;
      activeResult = shelf.activeResult;
      renderTelevision();
      update(lastFrame);
      results.forEach(function (_item, index) { prepareResultPreview(index); });
      return results[activeResult];
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

    function setLaptopTerminalLock(active) {
      laptopTerminalLock = Boolean(active);
      update(lastFrame);
      return laptopTerminalLock;
    }

    function setLaptopFullscreen(active) {
      active = Boolean(active);
      if (!laptop || !laptopMounted) return false;
      if (active === laptopFullscreen) {
        setHidden(laptop, false);
        return true;
      }
      if (active) {
        laptopHome = laptop.parentNode || laptopHome;
        laptopHomeNext = laptop.nextSibling || laptopHomeNext;
        (laptop.ownerDocument || document).body.appendChild(laptop);
        laptop.classList.add('laptop-surface--fullscreen');
        laptopFullscreen = true;
        setHidden(laptop, false);
      } else {
        laptopFullscreen = false;
        laptop.classList.remove('laptop-surface--fullscreen');
        if (laptopHome) {
          if (laptopHomeNext && laptopHomeNext.parentNode === laptopHome) {
            laptopHome.insertBefore(laptop, laptopHomeNext);
          } else {
            laptopHome.appendChild(laptop);
          }
        }
        positionLaptop(lastFrame || {});
      }
      return true;
    }

    function laptopWindow() {
      if (!calibration || !calibration.laptop || !laptopFrames || !laptopFrames.length) return null;
      return {
        leg: Number(calibration.laptop.leg),
        first: laptopFrames[0].time,
        last: laptopFrames[laptopFrames.length - 1].time
      };
    }

    var calibrationUrl = options.calibrationUrl || 'screen-calibration.json';
    if (typeof fetch === 'function') {
      fetch(calibrationUrl).then(function (response) {
        if (!response.ok) throw new Error('screen calibration unavailable');
        return response.json();
      }).then(function (value) {
        calibration = value;
        if (calibration.tv) {
          var rawTracks = Array.isArray(calibration.tv.tracks)
            ? calibration.tv.tracks
            : calibration.tv.frames
              ? [{ leg: calibration.tv.leg, frames: calibration.tv.frames }]
              : [];
          tvTracks = rawTracks.map(function (track) {
            return {
              leg: Number(track.leg),
              frames: normaliseRectFrames(track.frames)
            };
          }).filter(function (track) { return isFinite(track.leg); });
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
        tvTracks = [];
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
      setLaptopTerminalLock: setLaptopTerminalLock,
      setLaptopFullscreen: setLaptopFullscreen,
      laptopWindow: laptopWindow,
      state: function () {
        return {
          calibrated: !!calibration,
          results: results.slice(),
          activeResult: activeResult,
          laptopMounted: laptopMounted,
          laptopFullscreen: laptopFullscreen,
          laptopTerminalLock: laptopTerminalLock,
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
    addResultToShelf: addResultToShelf,
    strongestResult: strongestResult,
    active: function () { return current; }
  });
});
