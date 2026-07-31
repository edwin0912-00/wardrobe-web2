/* WARDROBE browser observability — operational only, never analytics.
 *
 * The static server intentionally has no access log, so an interaction on a phone can
 * otherwise be invisible until a server process fails. This reports a very small set of
 * health states to the same origin. It deliberately never transmits photos, file names,
 * text fields, media URLs, error messages, stacks, cookies or identifiers.
 */
(function (global) {
  'use strict';

  var ENDPOINT = '/__site-observability';
  var ALLOWED = {
    client_error: true,
    unhandled_rejection: true,
    media_error: true,
    media_stall: true,
    gate_stalled: true,
    bridge_failed: true,
    bridge_needs_input: true
  };
  var lastSent = {};
  var MIN_INTERVAL_MS = 20000;
  var gateTimer = null;
  var lastBridgeSignature = '';

  function token(value, fallback) {
    var valueText = typeof value === 'string' ? value : '';
    valueText = valueText.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '');
    return (valueText || fallback || 'unknown').slice(0, 48);
  }

  function snapshot(extra) {
    var root = document.documentElement;
    var stage = document.querySelector('[data-stage]');
    return {
      event: extra.event,
      code: token(extra.code, 'unknown'),
      gate: token(root.getAttribute('data-gate'), 'none'),
      leg: Number(stage && stage.getAttribute('data-leg')) || 0
    };
  }

  function report(eventName, code) {
    if (!ALLOWED[eventName] || !global.fetch) return;
    var data = snapshot({ event: eventName, code: code });
    var key = [data.event, data.code, data.gate, data.leg].join(':');
    var now = Date.now();
    if (lastSent[key] && now - lastSent[key] < MIN_INTERVAL_MS) return;
    lastSent[key] = now;
    global.fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      keepalive: true
    }).catch(function () { /* observing must never affect the experience */ });
  }

  function observeGate() {
    function check() {
      if (document.documentElement.getAttribute('data-gate') === 'loading') report('gate_stalled', 'loading');
    }
    new MutationObserver(function () {
      global.clearTimeout(gateTimer);
      if (document.documentElement.getAttribute('data-gate') === 'loading') {
        gateTimer = global.setTimeout(check, 8000);
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-gate'] });
    if (document.documentElement.getAttribute('data-gate') === 'loading') gateTimer = global.setTimeout(check, 8000);
  }

  function observeBridge() {
    /* ui.state() is already the public, redacted presentation snapshot. Polling it
     * avoids coupling diagnostics to the UI's internal transition code and lets a
     * parallel UI change remain independent. */
    global.setInterval(function () {
      if (!global.ui || typeof global.ui.state !== 'function') return;
      var state = global.ui.state();
      var bridge = state && state.bridge;
      if (!bridge || (bridge.phase !== 'failed' && bridge.phase !== 'needs_input')) {
        lastBridgeSignature = '';
        return;
      }
      var signature = bridge.phase + ':' + token(bridge.activeKind, 'look');
      if (signature === lastBridgeSignature) return;
      lastBridgeSignature = signature;
      report(bridge.phase === 'failed' ? 'bridge_failed' : 'bridge_needs_input', bridge.activeKind || 'look');
    }, 1200);
  }

  global.addEventListener('error', function (event) {
    if (event.target && event.target.tagName === 'VIDEO') report('media_error', 'video');
    else report('client_error', 'script');
  }, true);
  global.addEventListener('unhandledrejection', function () { report('unhandled_rejection', 'promise'); });
  global.addEventListener('wardrobe:bridge-state', function (event) {
    var detail = event && event.detail || {};
    if (detail.phase === 'failed') report('bridge_failed', detail.activeKind || 'run');
    if (detail.phase === 'needs_input') report('bridge_needs_input', detail.activeKind || 'look');
  });

  function start() {
    observeGate();
    observeBridge();
    document.querySelectorAll('video').forEach(function (video) {
      video.addEventListener('stalled', function () {
        global.setTimeout(function () {
          if (video.readyState < 3 && !video.paused) report('media_stall', 'video');
        }, 6000);
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}(window));
