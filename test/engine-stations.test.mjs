import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const engineSource = fs.readFileSync(path.resolve('engine.js'), 'utf8');

function element() {
  const attributes = new Map();
  const properties = new Map();
  return {
    style: {
      setProperty(name, value) { properties.set(name, String(value)); },
      getPropertyValue(name) { return properties.get(name) ?? ''; },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    hasAttribute(name) { return attributes.has(name); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener() {},
    removeEventListener() {},
  };
}

function video() {
  const node = element();
  node.duration = 12;
  node.currentTime = 0;
  node.src = 'memory://leg.mp4';
  node.buffered = { length: 1, start: () => 0, end: () => 12 };
  return node;
}

function boot(overrides = {}) {
  const root = element();
  root.scrollHeight = 10_000;
  root.clientHeight = 1_000;
  const body = element();
  const stage = element();
  stage.clientWidth = 1_000;
  const track = element();
  const film = element();
  const videos = [video(), video()];

  const document = {
    documentElement: root,
    body,
    querySelector(selector) {
      if (selector === '[data-stage]') return stage;
      if (selector === '[data-track]') return track;
      if (selector === '[data-film]') return film;
      if (/^video\[data-leg="\d+"\]$/.test(selector)) {
        return videos[Number(selector.match(/\d+/)[0])];
      }
      return null;
    },
  };
  const listeners = new Map();
  let pendingFrame = null;
  let frameId = 0;
  const window = {
    innerHeight: 1_000,
    innerWidth: 1_000,
    scrollY: 0,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    scrollTo(_x, y) { this.scrollY = y; },
  };
  const context = {
    window,
    document,
    console,
    Math,
    Promise,
    setTimeout() { return 0; },
    clearTimeout() {},
    requestAnimationFrame(fn) { pendingFrame = fn; frameId += 1; return frameId; },
    fetch: async () => ({ ok: false }),
  };
  vm.runInNewContext(engineSource, context, { filename: 'engine.js' });

  const journey = window.WardrobeJourney.create({
    preloaded: true,
    inertia: 0.085,
    screensPerLeg: 1,
    seamWindow: 0,
    legs: [{ id: 0, name: 'first' }, { id: 1, name: 'second' }],
    ...overrides,
  });
  journey.forceOpen();
  return {
    journey, stage, root, window,
    scrollToProgress(progress) {
      window.scrollY = progress * (root.scrollHeight - root.clientHeight);
      for (const fn of listeners.get('scroll') ?? []) fn({ type: 'scroll' });
    },
    flushFrame() {
      const fn = pendingFrame;
      pendingFrame = null;
      if (fn) fn(16.7);
    },
  };
}

/* The engine resolves a page scalar across all configured legs. These focused tests talk
   in the clearer local coordinate used by the station registry. */
function seekLeg(journey, leg, local, legCount = 2) {
  return journey.seek((leg + local) / legCount);
}

test('selects independent stations in one leg and publishes their real IDs', () => {
  const gateCalls = [];
  const { journey, stage } = boot({
    stations: [
      {
        leg: 0, id: 'person', at: 0.25, enter: 0.22, exit: 0.14,
        dampFrom: 0.10, dampMax: 0.90, deadSpan: 0.02,
        canAdvance: (station, leg) => {
          gateCalls.push({ station, leg });
          return false;
        },
      },
      { leg: 0, id: 'garments', at: 0.55, enter: 0.52, exit: 0.41, dampFrom: 0.43, gate: true },
      { leg: 0, id: 'mirrors', at: 0.90, enter: 0.87, exit: 0.76, dampFrom: 0.78, gate: true, seam: true },
    ],
  });

  let state = seekLeg(journey, 0, 0.23);
  assert.equal(state.station, true);
  assert.equal(state.stationId, 'person');
  assert.equal(state.gateOpen, false);
  assert.equal(state.lockedStationId, 'person');
  assert.equal(stage.getAttribute('data-station'), '1');
  assert.equal(stage.getAttribute('data-station-id'), 'person');
  assert.equal(gateCalls.at(-1).leg, 0);
  assert.equal(gateCalls.at(-1).station.id, 'person');

  state = seekLeg(journey, 0, 0.54);
  assert.equal(state.stationId, 'garments');
  assert.equal(state.gateOpen, true);
  assert.equal(stage.getAttribute('data-station-id'), 'garments');

  /* Garments stays latched through its own exit band; it releases independently below
     .41 and reveals the still-latched prior physical station. */
  state = seekLeg(journey, 0, 0.50);
  assert.equal(state.stationId, 'garments');
  state = seekLeg(journey, 0, 0.40);
  assert.equal(state.stationId, 'person');
  state = seekLeg(journey, 0, 0.13);
  assert.equal(state.station, false);
  assert.equal(state.stationId, null);
  assert.equal(stage.getAttribute('data-station'), '0');
  assert.equal(stage.getAttribute('data-station-id'), null);
});

test('keeps the one-station legacy contract when config.stations is absent', () => {
  const { journey, stage } = boot({
    stationAt: 0.80,
    stationEnter: 0.70,
    stationExit: 0.50,
    dampFrom: 0.60,
    dampMax: 0.94,
    canAdvance: (leg) => leg !== 0,
  });

  let state = seekLeg(journey, 0, 0.71);
  assert.equal(state.station, true);
  assert.equal(state.stationId, 'leg-0-end');
  assert.equal(state.stationInfo.at, 0.80);
  assert.equal(state.gateOpen, false);
  assert.equal(state.lockedLeg, 0);
  assert.equal(state.lockedStationId, 'leg-0-end');
  assert.equal(stage.getAttribute('data-station'), '1');
  assert.equal(stage.getAttribute('data-station-id'), 'leg-0-end');
  /* This is the former cubic global formula: ((.71 - .60) / (.80 - .60))^3 × .94. */
  assert.ok(Math.abs(state.resistance - 0.1563925) < 0.0001);

  state = seekLeg(journey, 0, 0.49);
  assert.equal(state.station, false);
  assert.equal(state.stationId, null);
  assert.equal(stage.getAttribute('data-station'), '0');
  assert.equal(stage.getAttribute('data-station-id'), null);

  /* Re-entering a leg inside its hysteresis band stays false until its entry threshold
     is crossed again — the one-latch engine reset this state at every video seam. */
  state = seekLeg(journey, 1, 0.93);
  assert.equal(state.stationId, 'leg-1-end');
  state = seekLeg(journey, 0, 0.60);
  assert.equal(state.station, false);
});

test('a single fast flick cannot jump over a closed attention station', () => {
  const { journey, stage, root, window, scrollToProgress, flushFrame } = boot({
    inertia: 1,
    stationAt: 0.80,
    stationEnter: 0.70,
    stationExit: 0.50,
    canAdvance: (leg) => leg !== 0,
  });

  scrollToProgress(1);
  flushFrame();

  const state = journey.state();
  assert.equal(state.leg, 0);
  assert.equal(state.stationId, 'leg-0-end');
  assert.equal(state.lockedLeg, 0);
  assert.equal(stage.getAttribute('data-gate'), 'held');
  assert.equal(window.scrollY, Math.round(0.40 * (root.scrollHeight - root.clientHeight)));
});

test('the same fast flick passes a station whose gate is open', () => {
  const { journey, scrollToProgress, flushFrame } = boot({
    inertia: 1,
    stationAt: 0.80,
    canAdvance: () => true,
  });

  scrollToProgress(1);
  flushFrame();

  assert.equal(journey.state().leg, 1);
});

test('a station authored at local 1 pins to the final frame of its own leg', () => {
  const { journey, scrollToProgress, flushFrame } = boot({
    inertia: 1,
    stationAt: 1,
    stationEnter: 0.99,
    canAdvance: (leg) => leg !== 0,
  });

  scrollToProgress(1);
  flushFrame();

  const state = journey.state();
  assert.equal(state.leg, 0);
  assert.equal(state.stationId, 'leg-0-end');
  assert.ok(state.local > 0.998 && state.local < 1);
});

test('accepts the earlier station-map shape and releases local resistance after a mid-leg stop', () => {
  const { journey } = boot({
    stations: {
      0: [{ id: 'person', at: 0.30, enter: 0.28, exit: 0.20, dampFrom: 0.16, dampTo: 0.36, gate: true }],
    },
  });

  let state = seekLeg(journey, 0, 0.30);
  assert.equal(state.stationId, 'person');
  assert.ok(state.resistance > 0.9);
  state = seekLeg(journey, 0, 0.37);
  assert.equal(state.resistance, 0);
  /* A missing entry for leg 1 remains the old implicit end station. */
  state = seekLeg(journey, 1, 0.93);
  assert.equal(state.leg, 1);
  assert.equal(state.stationId, 'leg-1-end');
});

test('a caller can require a decoded native next-room frame before releasing its seam', () => {
  let nextRoomPainted = false;
  const { journey, stage } = boot({
    stationAt: 0.90,
    stationEnter: 0.90,
    stationExit: 0.72,
    isFilmReady: (_video, index) => index !== 1 || nextRoomPainted,
  });

  let state = seekLeg(journey, 0, 0.92);
  assert.equal(state.lockedLeg, 0);
  assert.equal(stage.getAttribute('data-gate'), 'loading');

  nextRoomPainted = true;
  journey.refreshGate();
  state = journey.state();
  assert.equal(state.lockedLeg, -1);
  assert.equal(stage.getAttribute('data-gate'), null);
});

test('rejects an unknown explicit station instead of travelling to another surface', () => {
  const { journey } = boot({
    stations: [{ leg: 0, id: 'person', at: 0.30, enter: 0.28, exit: 0.20 }],
  });

  assert.throws(
    () => journey.advanceToStation(0, 'not-a-station'),
    /Unknown station "not-a-station" for leg 0/
  );
});
