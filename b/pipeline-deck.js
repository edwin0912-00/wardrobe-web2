/* WARDROBE — same-origin laptop pipeline deck.
 *
 * The supplied deck is vendored byte-for-byte in pipeline-deck-v2.html. This adapter loads
 * that exact document, verifies its SHA-256 before it can reach the laptop plane, and runs
 * the deck inside a ShadowRoot so its styles and controls cannot leak into the cinematic
 * chrome. The one DOM tree is moved by screen-surfaces.js from the calibrated laptop quad
 * to the viewport and back; there is no iframe and no second page scroll owner.
 */
(function (global) {
  'use strict';

  var SOURCE_URL = 'pipeline-deck-v2.html';
  var SOURCE_SHA256 = '43262d5359b53f02ab3fb22792ab984da25dfa6484530dd1b672286d868f813e';

  function clamp01(value) {
    value = Number(value);
    return isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function sourceDocument(markup) {
    var parser = new DOMParser();
    var parsed = parser.parseFromString(markup, 'text/html');
    if (!parsed || !parsed.body || !parsed.head) throw new Error('pipeline deck is not an HTML document');
    return parsed;
  }

  function scopedCss(css) {
    /* `html` and `body` are the only document selectors in the supplied sheet. Inside a
     * shadow tree they mean the host; use a boundary-aware expression so `.drawer-body`
     * is never accidentally rewritten as `:host`. */
    css = css.replace(/(^|[}\s])html\s*\{/g, '$1:host{')
      .replace(/(^|[}\s])body\s*\{/g, '$1:host{');
    return css + '\n' + [
      ':host{display:block;position:relative;width:100%;height:100%;overflow:hidden;background:#080B10;color:#E6ECF4;} ',
      '.deck{width:100%;height:100%;overflow-y:auto;overscroll-behavior:contain;} ',
      '.panel{min-height:100%;} ',
      '.bar,.prog,.dots,.hint{position:absolute;} ',
      '.drawer{position:absolute;} ',
      '.scrim{position:absolute;inset:0;} ',
      '.pipeline-deck-error{height:100%;display:grid;place-items:center;padding:24px;text-align:center;',
        'font:12px/1.5 var(--mono,ui-monospace,monospace);letter-spacing:.08em;color:#7F91A8;} '
    ].join('');
  }

  function createDocumentProxy(root) {
    var ownerDocument = root.ownerDocument;
    return {
      createElement: function (tag) { return ownerDocument.createElement(tag); },
      getElementById: function (id) {
        /* The supplied deck uses fixed, simple ids. Avoid making the adapter depend on
         * CSS.escape being present in an older embedded WebKit build. */
        var escaped = String(id).replace(/([\\.#:[\],>+~*'"])/g, '\\$1');
        return root.querySelector('#' + escaped);
      },
      querySelector: function (selector) { return root.querySelector(selector); },
      querySelectorAll: function (selector) { return root.querySelectorAll(selector); },
      addEventListener: function () { return root.addEventListener.apply(root, arguments); }
    };
  }

  function create(options) {
    options = options || {};
    var surface = options.surface || null;
    var sourceUrl = options.sourceUrl || SOURCE_URL;
    var expectedSha256 = options.expectedSha256 || SOURCE_SHA256;
    var host = document.createElement('div');
    host.className = 'pipeline-deck-host';
    host.tabIndex = 0;
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Історія створення');
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
    var deck = null;
    var mode = 'camera';
    var ready = false;
    var loadError = null;
    var touchY = null;
    var lastFrame = null;

    function errorPanel(message) {
      if (!shadow) return;
      shadow.innerHTML = '';
      var style = document.createElement('style');
      style.textContent = ':host{display:block;width:100%;height:100%;background:#080B10;color:#E6ECF4}' +
        '.pipeline-deck-error{height:100%;display:grid;place-items:center;padding:24px;text-align:center;font:12px/1.5 ui-monospace,monospace;color:#7F91A8}';
      var panel = document.createElement('div');
      panel.className = 'pipeline-deck-error';
      panel.setAttribute('role', 'status');
      panel.textContent = message || 'Історія створення недоступна';
      shadow.appendChild(style);
      shadow.appendChild(panel);
    }

    function runDeckScript(script) {
      /* The script is first-party, vendored with the exact source document. Passing a
       * narrow document facade is what makes the original interaction code work inside
       * the shadow tree without giving it access to the cinematic document. */
      var localDocument = createDocumentProxy(shadow);
      return (new Function('document', script))(localDocument);
    }

    function load() {
      if (!shadow) {
        loadError = new Error('ShadowRoot is unavailable');
        errorPanel('Цей екран потребує сучасного браузера');
        return Promise.reject(loadError);
      }
      return fetch(sourceUrl).then(function (response) {
        if (!response.ok) throw new Error('pipeline deck returned ' + response.status);
        return response.arrayBuffer();
      }).then(function (buffer) {
        return crypto.subtle.digest('SHA-256', buffer).then(function (digest) {
          var actual = hex(digest);
          if (actual !== expectedSha256) {
            throw new Error('pipeline deck SHA-256 mismatch');
          }
          return new TextDecoder().decode(buffer);
        });
      }).then(function (markup) {
        var parsed = sourceDocument(markup);
        var style = document.createElement('style');
        style.textContent = scopedCss(Array.prototype.map.call(
          parsed.head.querySelectorAll('style'), function (node) { return node.textContent; }
        ).join('\n'));
        shadow.appendChild(style);
        Array.prototype.forEach.call(parsed.body.childNodes, function (node) {
          if (node.nodeType === 1 && node.tagName.toLowerCase() === 'script') return;
          shadow.appendChild(node.cloneNode(true));
        });
        var script = parsed.body.querySelector('script');
        if (!script) throw new Error('pipeline deck script is missing');
        runDeckScript(script.textContent || '');
        deck = shadow.querySelector('#deck');
        if (!deck) throw new Error('pipeline deck scroll root is missing');
        ready = true;
        return controller;
      }).catch(function (error) {
        loadError = error;
        errorPanel('Історія створення недоступна');
        throw error;
      });
    }

    function maxScroll() {
      return deck ? Math.max(0, deck.scrollHeight - deck.clientHeight) : 0;
    }

    function progress() {
      var max = maxScroll();
      return max ? clamp01(deck.scrollTop / max) : 0;
    }

    function setProgress(value) {
      if (!deck) return 0;
      var max = maxScroll();
      deck.scrollTop = clamp01(value) * max;
      return progress();
    }

    function handBack(delta) {
      var amount = Number(delta) || 0;
      mode = 'camera';
      if (surface && surface.setLaptopFullscreen) surface.setLaptopFullscreen(false);
      host.removeAttribute('data-fullscreen');
      if (amount) {
        var y = Math.max(0, window.scrollY + amount);
        window.scrollTo(0, y);
      }
    }

    function consumeDelta(delta) {
      if (mode !== 'fullscreen' || !deck) return false;
      var amount = Number(delta) || 0;
      if (!amount) return true;
      var current = deck.scrollTop;
      var next = current + amount;
      if (amount < 0 && next < 0) {
        deck.scrollTop = 0;
        handBack(next);
        return true;
      }
      deck.scrollTop = clamp(next, 0, maxScroll());
      return true;
    }

    function enterFullscreen() {
      if (!ready || mode === 'fullscreen') return false;
      mode = 'fullscreen';
      setProgress(0);
      if (surface && surface.setLaptopFullscreen) surface.setLaptopFullscreen(true);
      host.setAttribute('data-fullscreen', '1');
      host.focus({ preventScroll: true });
      return true;
    }

    function drawerScrollTarget(event) {
      var path = event.composedPath ? event.composedPath() : [];
      return path.some(function (node) {
        return node && node.classList && node.classList.contains('drawer-body');
      });
    }

    function wheel(event) {
      if (mode !== 'fullscreen' || drawerScrollTarget(event)) return;
      event.preventDefault();
      event.stopPropagation();
      consumeDelta(event.deltaY);
    }

    function touchStart(event) {
      if (mode !== 'fullscreen' || drawerScrollTarget(event) || !event.touches.length) return;
      touchY = event.touches[0].clientY;
      event.preventDefault();
    }

    function touchMove(event) {
      if (mode !== 'fullscreen' || touchY === null || drawerScrollTarget(event) || !event.touches.length) return;
      var y = event.touches[0].clientY;
      var delta = touchY - y;
      touchY = y;
      event.preventDefault();
      event.stopPropagation();
      consumeDelta(delta);
    }

    function touchEnd() { touchY = null; }

    function keydown(event) {
      if (mode !== 'fullscreen') return;
      var amount = Math.max(160, Math.round(window.innerHeight * 0.82));
      if (event.key === 'Escape') return;
      if (event.key === 'Home') {
        event.preventDefault(); event.stopPropagation();
        if (progress() <= 0.001) handBack(-amount); else setProgress(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault(); event.stopPropagation(); setProgress(1); return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight' ||
          event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation(); consumeDelta(amount); return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault(); event.stopPropagation(); consumeDelta(-amount);
      }
    }

    function installInput() {
      window.addEventListener('wheel', wheel, { capture: true, passive: false });
      window.addEventListener('touchstart', touchStart, { capture: true, passive: false });
      window.addEventListener('touchmove', touchMove, { capture: true, passive: false });
      window.addEventListener('touchend', touchEnd, { capture: true, passive: true });
      window.addEventListener('keydown', keydown, { capture: true, passive: false });
    }

    function onCameraFrame(frame) {
      lastFrame = frame || lastFrame;
      if (!ready || !surface || !surface.laptopWindow) return;
      var windowInfo = surface.laptopWindow();
      if (!windowInfo || !lastFrame) return;
      if (lastFrame.leg !== windowInfo.leg) {
        if (mode === 'fullscreen') handBack(0);
        return;
      }
      if (mode === 'camera' && lastFrame.videoTime >= windowInfo.last - 0.04) {
        enterFullscreen();
      } else if (mode === 'fullscreen' && lastFrame.videoTime < windowInfo.last - 0.35) {
        handBack(0);
      }
    }

    function destroy() {
      window.removeEventListener('wheel', wheel, { capture: true });
      window.removeEventListener('touchstart', touchStart, { capture: true });
      window.removeEventListener('touchmove', touchMove, { capture: true });
      window.removeEventListener('touchend', touchEnd, { capture: true });
      window.removeEventListener('keydown', keydown, { capture: true });
    }

    var controller = {
      host: host,
      ready: null,
      load: load,
      enterFullscreen: enterFullscreen,
      exitFullscreen: function () { if (mode === 'fullscreen') handBack(0); },
      onCameraFrame: onCameraFrame,
      consumeDelta: consumeDelta,
      setProgress: setProgress,
      progress: progress,
      state: function () {
        return { ready: ready, mode: mode, progress: progress(), error: loadError, sourceSha256: expectedSha256 };
      },
      destroy: destroy
    };
    controller.ready = load().then(function (value) {
      installInput();
      /* If the camera reached the terminal frame while the 114 KB deck was loading, the
       * next engine tick may be far away. Re-evaluate the handoff immediately after the
       * verified DOM is mounted so the laptop cannot remain parked at its hidden state. */
      onCameraFrame(lastFrame);
      return value;
    });
    return controller;
  }

  global.WardrobePipelineDeck = { create: create, sourceSha256: SOURCE_SHA256 };
})(window);
