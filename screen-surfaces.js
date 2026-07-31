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

  function resultModel(raw) {
    raw = raw || {};
    var kind = raw.kind === 'shoot' ? 'shoot' : 'video';
    var aspect = raw.aspect === '9:16' ? '9:16' : '16:9';
    var urls = Array.isArray(raw.urls) ? raw.urls.filter(function (url) {
      return typeof url === 'string' && url.length > 0;
    }).slice(0, kind === 'shoot' ? 5 : 1) : [];
    return Object.freeze({
      kind: kind,
      aspect: aspect,
      urls: Object.freeze(urls),
      mediaUrl: typeof raw.mediaUrl === 'string' ? raw.mediaUrl : '',
      label: kind === 'shoot' ? 'Фотосесія' : 'Фешн-відео',
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

    function videoFrame(item) {
      if (item.mediaUrl) {
        return '<video class="tv-result-video" src="' + esc(item.mediaUrl) +
          '" controls playsinline preload="metadata" aria-label="Фешн-відео"></video>';
      }
      return '<div class="tv-result-wait" role="status"><span class="orb orb--small" aria-hidden="true">' +
        '<i></i><i></i><i></i></span><b>Відео зʼявиться тут</b></div>';
    }

    function renderTelevision() {
      if (!tvGallery) return;
      if (!results.length) {
        tvGallery.innerHTML = '';
        return;
      }
      var item = results[activeResult < 0 ? results.length - 1 : activeResult];
      tvGallery.innerHTML =
        '<div class="tv-gallery__head"><span>' + esc(item.label) + '</span><span>' +
          esc(item.aspect) + '</span></div>' +
        (item.kind === 'shoot' ? portraitStrip(item) : videoFrame(item));
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

    function addResult(raw) {
      var item = resultModel(raw);
      if (item.aspect !== '16:9' && item.kind !== 'shoot') return item;
      results.push(item);
      activeResult = results.length - 1;
      renderTelevision();
      update(lastFrame);
      return item;
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

    return Object.freeze({
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
  }

  return Object.freeze({
    create: create,
    normaliseRectFrames: normaliseRectFrames,
    interpolateRect: interpolateRect,
    resultModel: resultModel
  });
});
