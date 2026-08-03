/* Private test-journey signal for the cinematic main site.
 *
 * This is deliberately not an identity or marketing tracker. It emits only a
 * random per-tab session token plus the visible journey state: leg, station,
 * gate and bridge phase. The beta engine supplies the existing anonymous
 * profile session; it stores the coarse browser/OS/device and trusted edge
 * country on the server. No user content, media address, raw agent string,
 * visual fingerprint or diagnostic text leaves the browser here.
 */
(function (global) {
  'use strict';

  var ENDPOINT = '/api/test-audit/events';
  var STORAGE_KEY = 'wardrobe_test_audit_session';
  var lastSignature = '';
  var stageTimer = null;

  function token(value, fallback, maximum) {
    var text = typeof value === 'string' ? value : '';
    text = text.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^[._:-]+|[._:-]+$/g, '');
    return (text || fallback || 'unknown').slice(0, maximum || 120);
  }

  function sessionId() {
    try {
      var existing = global.sessionStorage.getItem(STORAGE_KEY);
      if (existing && /^[a-z0-9_.:-]{8,120}$/i.test(existing)) return existing;
      var value = global.crypto && typeof global.crypto.randomUUID === 'function'
        ? global.crypto.randomUUID()
        : 'main-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      global.sessionStorage.setItem(STORAGE_KEY, value);
      return value;
    } catch (_) {
      return 'main-' + Date.now().toString(36);
    }
  }

  var auditSessionId = sessionId();

  function snapshot() {
    var root = document.documentElement;
    var stage = document.querySelector('[data-stage]');
    var rawLeg = Number(stage && stage.getAttribute('data-leg'));
    var rawStation = stage && stage.getAttribute('data-station-id');
    return {
      session_id: auditSessionId,
      stage: token(rawStation || ('leg-' + (Number.isInteger(rawLeg) ? rawLeg : 0)), 'entry'),
      gate: token(root.getAttribute('data-gate'), 'open', 80),
      leg: Number.isInteger(rawLeg) && rawLeg >= 0 && rawLeg <= 9 ? rawLeg : 0
    };
  }

  function send(type, extra) {
    if (!global.fetch) return;
    var data = snapshot();
    data.type = type;
    if (extra && extra.status) data.status = token(extra.status, 'unknown', 80);
    if (extra && extra.stage) data.stage = token(extra.stage, data.stage);
    if (extra && extra.gate) data.gate = token(extra.gate, data.gate, 80);
    global.fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      keepalive: true
    }).catch(function () { /* the test journal must never affect the journey */ });
  }

  function reportStage() {
    var data = snapshot();
    var signature = [data.stage, data.gate, data.leg].join(':');
    if (signature === lastSignature) return;
    lastSignature = signature;
    send('main.stage');
  }

  function start() {
    send('main.ready');
    reportStage();
    var root = document.documentElement;
    var stage = document.querySelector('[data-stage]');
    if (stage) {
      new MutationObserver(function () {
        global.clearTimeout(stageTimer);
        stageTimer = global.setTimeout(reportStage, 80);
      }).observe(stage, {
        attributes: true,
        attributeFilter: ['data-leg', 'data-station', 'data-station-id', 'data-gate']
      });
    }
    new MutationObserver(function () {
      global.clearTimeout(stageTimer);
      stageTimer = global.setTimeout(reportStage, 80);
    }).observe(root, { attributes: true, attributeFilter: ['data-gate'] });
  }

  send('main.open');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  global.addEventListener('wardrobe:bridge-state', function (event) {
    var detail = event && event.detail || {};
    if (detail.phase) send('main.bridge', { status: detail.phase, stage: 'bridge-' + detail.phase });
  });
  global.addEventListener('pagehide', function () { send('main.exit'); });
  global.addEventListener('pageshow', function () { send('main.open'); });
}(window));
