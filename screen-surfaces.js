/* WARDROBE — calibrated TV and laptop screen surfaces.
 *
 * This is presentation infrastructure, not a beta client and not a gallery. It accepts
 * only real, already-authorised result URLs from the future Zeely adapter. Until it has
 * both a final-media calibration and real media, a surface stays absent.
 *
 * The laptop is deliberately a single DOM tree in a stage-owned viewport layer. The
 * scroll director can transform that one tree from the measured laptop rectangle to the
 * viewport without an iframe, a route jump, or a duplicate document.
 */
(function (global) {
  'use strict';

  var math = global.WardrobeSurfaceMath;
  if (!math) {
    global.console && global.console.warn && global.console.warn('WARDROBE screen surfaces need screen-surface-math.js');
    return;
  }

  function clamp01(value) { return math.clamp01(Number(value) || 0); }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function setHidden(node, hidden) {
    if (!node) return;
    node.hidden = !!hidden;
    node.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  }

  function requireUrl(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(label + ' must be a non-empty result URL');
    }
    return value.trim();
  }

  function emit(name, detail) {
    if (typeof global.CustomEvent !== 'function') return;
    global.dispatchEvent(new global.CustomEvent(name, { detail: detail }));
  }

  function createTvSurface(root) {
    var mask = root && root.querySelector('[data-tv-mask]');
    var calibration = null;
    var content = null;
    var activeFrame = null;

    function place(frame) {
      if (!frame || !root) return;
      root.style.setProperty('--surface-x', (frame.x * 100).toFixed(4) + '%');
      root.style.setProperty('--surface-y', (frame.y * 100).toFixed(4) + '%');
      root.style.setProperty('--surface-w', (frame.width * 100).toFixed(4) + '%');
      root.style.setProperty('--surface-h', (frame.height * 100).toFixed(4) + '%');
    }

    function sync() {
      var visible = !!(root && calibration && content && activeFrame);
      setHidden(root, !visible);
      if (root) root.dataset.surfaceState = visible ? content.kind : 'empty';
    }

    function renderContent() {
      if (!mask) return;
      clear(mask);
      if (!content) { sync(); return; }

      if (content.kind === 'video') {
        var video = document.createElement('video');
        video.className = 'screen-surface__video';
        video.src = content.src;
        if (content.poster) video.poster = content.poster;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.autoplay = true;
        video.preload = 'metadata';
        video.setAttribute('aria-label', content.label || 'Відео');
        /* A TV result is a real moving image, not a poster disguised as one.  Muted
         * inline playback is allowed without a new gesture; retry after decode because
         * an immediate play() can race source attachment on Safari. */
        var start = function () { video.play().catch(function () {}); };
        video.addEventListener('canplay', start, { once: true });
        start();
        mask.appendChild(video);
      } else if (content.kind === 'shoot') {
        var strip = document.createElement('div');
        strip.className = 'screen-surface__contact-strip';
        strip.setAttribute('role', 'group');
        strip.setAttribute('aria-label', content.label || 'Фотосесія');
        content.images.forEach(function (image, index) {
          var cell = document.createElement('div');
          cell.className = 'screen-surface__contact-cell';
          var img = document.createElement('img');
          img.src = image.src;
          img.alt = image.alt || '';
          img.decoding = 'async';
          img.loading = index < 2 ? 'eager' : 'lazy';
          cell.appendChild(img);
          strip.appendChild(cell);
        });
        mask.appendChild(strip);
      }
      sync();
    }

    return {
      calibrate: function (spec) {
        calibration = math.normaliseCalibration(spec, 'TV');
        activeFrame = null;
        sync();
        return calibration;
      },
      clearCalibration: function () {
        calibration = null;
        activeFrame = null;
        sync();
      },
      showVideo: function (result) {
        result = result || {};
        content = {
          kind: 'video',
          src: requireUrl(result.src, 'TV video src'),
          poster: result.poster ? requireUrl(result.poster, 'TV video poster') : '',
          label: typeof result.label === 'string' ? result.label : ''
        };
        renderContent();
      },
      showShoot: function (result) {
        result = result || {};
        if (!Array.isArray(result.images) || result.images.length !== 5) {
          throw new TypeError('TV Fashion Shoot requires exactly five real portrait result images');
        }
        content = {
          kind: 'shoot',
          label: typeof result.label === 'string' ? result.label : '',
          images: result.images.map(function (image, index) {
            image = image || {};
            return {
              src: requireUrl(image.src, 'TV Fashion Shoot image ' + (index + 1)),
              alt: typeof image.alt === 'string' ? image.alt : ''
            };
          })
        };
        renderContent();
      },
      clear: function () {
        content = null;
        renderContent();
      },
      updateJourney: function (frame) {
        if (!calibration || !frame || frame.leg !== calibration.leg) {
          activeFrame = null;
          sync();
          return;
        }
        activeFrame = math.interpolateFrame(calibration.frames, frame.videoTime);
        place(activeFrame);
        sync();
      },
      state: function () {
        return {
          calibrated: !!calibration,
          measuredFrom: calibration ? calibration.measuredFrom : null,
          kind: content ? content.kind : null,
          visible: !!(content && activeFrame)
        };
      }
    };
  }

  function createLaptopSurface(root, stage) {
    var documentRoot = root && root.querySelector('[data-laptop-document]');
    var frame = null;
    var mounted = false;
    var handoff = 0;
    var owner = 'journey';

    function setOwner(next) {
      if (owner === next) return;
      owner = next;
      if (root) root.dataset.scrollOwner = owner;
      emit('wardrobe:laptop-scroll-owner', { owner: owner, handoff: handoff });
    }

    function sync() {
      var visible = !!(root && mounted && frame);
      setHidden(root, !visible);
      if (!visible) return;

      /* `frame` is supplied in stage pixels by engine.js. No bounding-client-rect reads
       * occur in the animation path, so scrubbing video does not force layout. */
      var stageWidth = frame.stageWidth || (stage && stage.clientWidth) || global.innerWidth || 1;
      var stageHeight = frame.stageHeight || (stage && stage.clientHeight) || global.innerHeight || 1;
      var inv = 1 - handoff;
      var x = frame.x * inv;
      var y = frame.y * inv;
      var scaleX = (frame.width / stageWidth) * inv + handoff;
      var scaleY = (frame.height / stageHeight) * inv + handoff;

      root.style.setProperty('--laptop-x', x.toFixed(3) + 'px');
      root.style.setProperty('--laptop-y', y.toFixed(3) + 'px');
      root.style.setProperty('--laptop-scale-x', Math.max(0.0001, scaleX).toFixed(6));
      root.style.setProperty('--laptop-scale-y', Math.max(0.0001, scaleY).toFixed(6));
      root.style.setProperty('--laptop-opacity', String(Math.max(frame.opacity == null ? 1 : frame.opacity, handoff)));

      var nextOwner = handoff >= 0.999 ? 'document' : 'journey';
      root.dataset.handoff = nextOwner === 'document' ? 'viewport' : 'frame';
      root.style.pointerEvents = nextOwner === 'document' ? 'auto' : 'none';
      setOwner(nextOwner);
    }

    return {
      mountDocument: function (node) {
        if (!node || typeof node.nodeType !== 'number') {
          throw new TypeError('Laptop content must be a supplied DOM node; strings and iframes are intentionally unsupported');
        }
        if (!documentRoot) throw new Error('Laptop document host is missing');
        clear(documentRoot);
        documentRoot.appendChild(node); // Moves the one supplied DOM tree; it is never cloned.
        mounted = documentRoot.childNodes.length > 0;
        if (documentRoot.scrollTo) documentRoot.scrollTo(0, 0);
        sync();
      },
      unmountDocument: function () {
        clear(documentRoot);
        mounted = false;
        handoff = 0;
        setOwner('journey');
        sync();
      },
      setHandoff: function (progress) {
        handoff = clamp01(progress);
        sync();
      },
      updateJourney: function (nextFrame) {
        frame = nextFrame || null;
        sync();
      },
      state: function () {
        return {
          mounted: mounted,
          handoff: handoff,
          scrollOwner: owner,
          visible: !!(mounted && frame)
        };
      }
    };
  }

  function create(options) {
    options = options || {};
    var stage = options.stage || document.querySelector('[data-stage]');
    var tvRoot = options.tv || document.querySelector('[data-tv-surface]');
    var laptopRoot = options.laptop || document.querySelector('[data-laptop-viewport]');
    if (!stage || !tvRoot || !laptopRoot) return null;

    var tv = createTvSurface(tvRoot);
    var laptop = createLaptopSurface(laptopRoot, stage);

    return {
      calibrateTv: tv.calibrate,
      clearTvCalibration: tv.clearCalibration,
      showTvVideo: tv.showVideo,
      showTvShoot: tv.showShoot,
      clearTv: tv.clear,
      mountLaptopDocument: laptop.mountDocument,
      unmountLaptopDocument: laptop.unmountDocument,
      setLaptopHandoff: laptop.setHandoff,
      updateJourney: function (frame) {
        tv.updateJourney(frame);
        laptop.updateJourney(frame && frame.laptop ? frame.laptop : null);
      },
      state: function () {
        return { tv: tv.state(), laptop: laptop.state() };
      }
    };
  }

  global.WardrobeScreenSurfaces = Object.freeze({ create: create, version: '0.1.0' });
})(window);
