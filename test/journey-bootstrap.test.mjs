import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const mediaStrategy = require('../media-strategy.js');
const html = await readFile(new URL('../b/index.html', import.meta.url), 'utf8');
const audioSource = await readFile(new URL('../audio.js', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].at(-1)?.[1];

if (!inline) throw new Error('WARDROBE inline journey bootstrap is missing');

function node(attributes = {}) {
  const listeners = new Map();
  const values = new Map(Object.entries(attributes));
  const dataset = {};
  return {
    style: { setProperty() {} },
    dataset,
    hidden: false,
    textContent: '',
    duration: 15,
    readyState: 0,
    currentTime: 0,
    src: '',
    loadCalls: 0,
    getAttribute(name) { return values.get(name) ?? null; },
    setAttribute(name, value) { values.set(name, String(value)); },
    removeAttribute(name) { values.delete(name); },
    addEventListener(type, handler, options = {}) {
      const list = listeners.get(type) ?? [];
      list.push({ handler, once: options.once === true });
      listeners.set(type, list);
    },
    emit(type) {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((entry) => !entry.once));
      for (const entry of list) entry.handler({ type, target: this, preventDefault() {}, stopPropagation() {} });
    },
    load() { this.loadCalls += 1; },
    play() { return Promise.resolve(); },
    pause() {}
  };
}

function makeResult(urls) {
  const blobs = Object.fromEntries(urls.map((url) => [url, `blob:${url}`]));
  return {
    blobs,
    bytes: urls.length * 100,
    unmeasurable: [],
    files: urls.map((url) => ({ url, bytes: 100 }))
  };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function boot({ ios, videoFrameCallback = false, withStrategy = true, progressSamples = [1] }) {
  const intro = node({ 'data-src': 'assets/intro.mp4' });
  const rooms = [0, 1, 2, 3].map((index) => node({
    'data-leg': String(index),
    'data-src': index === 0
      ? 'assets/seg1.mp4?v=seg1-d-20260730'
      : `assets/seg${index + 1}.mp4`
  }));
  const loader = node();
  const loaderBar = node();
  const loaderPct = node();
  const loaderBytes = node();
  const loaderFiles = node();
  const sound = node();
  const looks = node();
  const film = node();
  const gateText = node();
  const stage = node();
  const track = node();
  const root = node();
  const calls = [];
  const audioEvents = [];
  const journeyCalls = [];
  const lookLibraryCalls = [];
  let reportedRatio = null;

  const allVideos = [intro, ...rooms];
  if (videoFrameCallback) {
    for (const video of allVideos) {
      video.requestVideoFrameCallback = (callback) => {
        video.frameCallback = callback;
        return 1;
      };
    }
  }
  const document = {
    documentElement: root,
    querySelector(selector) {
      if (selector === '[data-loader]') return loader;
      if (selector === '[data-loader-bar]') return loaderBar;
      if (selector === '[data-loader-pct]') return loaderPct;
      if (selector === '[data-loader-bytes]') return loaderBytes;
      if (selector === '[data-loader-files]') return loaderFiles;
      if (selector === '[data-sound]') return sound;
      if (selector === '[data-looks]') return looks;
      if (selector === '[data-intro]') return intro;
      if (selector === '[data-film]') return film;
      if (selector === '[data-gate-text]') return gateText;
      if (selector === '[data-stage]') return stage;
      if (selector === '[data-track]') return track;
      const match = selector.match(/^video\[data-leg="(\d+)"\]$/);
      return match ? rooms[Number(match[1])] : null;
    },
    querySelectorAll(selector) {
      return selector === 'video[data-src]' ? allVideos : [];
    }
  };

  const window = {
    addEventListener() {},
    removeEventListener() {},
    WardrobeLoader: {
      load(urls, onProgress, options = {}) {
        calls.push({ urls: [...urls], options });
        const files = urls.map((url) => ({ url, blobUrl: `blob:${url}`, done: true }));
        for (const ratio of progressSamples) {
          reportedRatio = ratio;
          onProgress?.({
            ratio,
            loaded: Math.round(urls.length * 100 * ratio),
            total: urls.length * 100,
            files,
          });
        }
        return Promise.resolve(makeResult(urls));
      }
    },
    WardrobeAudio: {
      create() {
        audioEvents.push({ type: 'create', ratio: reportedRatio });
        return {
          unlock() {},
          start: () => {
            audioEvents.push({ type: 'start', ratio: reportedRatio });
            return Promise.resolve(true);
          },
          state: () => ({ muted: false, activeIndex: 0, paused: [false] }),
          setMuted() {}, toggleMute: () => false, setSpeed() {}
        };
      }
    },
    WardrobeJourney: { create: () => ({
      refreshGate() {},
      releaseAndAdvance() {},
      advanceTo(leg) { journeyCalls.push(leg); return Promise.resolve('arrived'); },
    }) },
    WardrobeUI: { create: () => ({
      canAdvance: () => true,
      openLookLibrary() { lookLibraryCalls.push('opened'); return true; },
    }) },
    score: null
  };
  if (withStrategy) window.WardrobeMediaStrategy = mediaStrategy;
  const context = {
    window,
    document,
    WardrobeMediaStrategy: window.WardrobeMediaStrategy,
    WardrobeLoader: window.WardrobeLoader,
    WardrobeAudio: window.WardrobeAudio,
    WardrobeJourney: window.WardrobeJourney,
    WardrobeUI: window.WardrobeUI,
    navigator: ios
      ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 }
      : { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 0 },
    performance: { now: () => 0 },
    Promise,
    MutationObserver: class { observe() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    console,
    Math,
    isFinite
  };
  vm.runInNewContext(inline, context, { filename: 'b/index.inline.js' });
  await settle();
  return { calls, intro, rooms, audioEvents, looks, journeyCalls, lookLibraryCalls };
}

test('desktop fully loads selected D before the fabric handoff and backgrounds only later rooms', async () => {
  const app = await boot({ ios: false });
  assert.deepEqual(app.calls.map((call) => call.urls), [
    ['audio/t1.mp3', 'assets/intro.mp4', 'assets/seg1.mp4?v=seg1-d-20260730'],
    ['assets/seg2.mp4', 'assets/seg3.mp4', 'assets/seg4.mp4']
  ]);
  assert.equal(app.intro.src, 'blob:assets/intro.mp4');
  assert.equal(app.rooms[0].src, 'blob:assets/seg1.mp4?v=seg1-d-20260730');
});

test('a missing companion strategy asset falls back safely instead of blanking the journey', async () => {
  const app = await boot({ ios: false, withStrategy: false });
  assert.deepEqual(app.calls.map((call) => call.urls), [
    ['audio/t1.mp3', 'assets/intro.mp4', 'assets/seg1.mp4?v=seg1-d-20260730'],
    ['assets/seg2.mp4', 'assets/seg3.mp4', 'assets/seg4.mp4']
  ]);
  assert.equal(app.rooms[0].src, 'blob:assets/seg1.mp4?v=seg1-d-20260730');
});

test('prepares the score early but requests audible playback at the factual 50% mark', async () => {
  const app = await boot({ ios: false, progressSamples: [0.49, 0.5, 1] });
  assert.deepEqual(app.audioEvents, [
    { type: 'create', ratio: 0.49 },
    { type: 'start', ratio: 0.5 },
  ]);
});

test('the factual 50% audio entry fades in rather than switching the room on at full gain', () => {
  assert.match(html, /entryFadeInMs:\s*1400/);
  assert.match(audioSource, /var masterTargetGain/);
  assert.match(audioSource, /master\.gain\.value = 0/);
  assert.match(audioSource, /function bringMasterIn\(\)[\s\S]*?rampGain\(master\.gain, masterTargetGain, entryFadeInMs\)/);
});

test('header “Образи” returns to the selected look library and mirror station', async () => {
  const app = await boot({ ios: false });
  assert.equal(app.looks.disabled, false, 'the control becomes usable after UI and journey are ready');
  app.looks.emit('click');
  await settle();
  assert.deepEqual(app.lookLibraryCalls, ['opened']);
  assert.deepEqual(app.journeyCalls, [0]);
});

test('iOS starts D native, does not launch Blob work for later rooms, then prewarms one next room at a time', async () => {
  const app = await boot({ ios: true });
  assert.deepEqual(app.calls.map((call) => call.urls), [['audio/t1.mp3', 'assets/intro.mp4']]);
  assert.equal(app.intro.src, 'assets/intro.mp4');
  assert.equal(app.rooms[0].src, 'assets/seg1.mp4?v=seg1-d-20260730');
  assert.equal(app.rooms[1].src, '');
  assert.equal(app.rooms[2].src, '');

  app.rooms[0].readyState = 2;
  app.rooms[0].emit('loadeddata');
  assert.equal(app.rooms[1].src, '', 'decoded data alone must not release the next native room');
  app.rooms[0].readyState = 4;
  app.rooms[0].emit('canplaythrough');
  assert.equal(app.rooms[1].src, 'assets/seg2.mp4');
  assert.equal(app.rooms[1].dataset.iosPrewarm, '1');

  app.rooms[1].readyState = 2;
  app.rooms[1].emit('loadeddata');
  assert.equal(app.rooms[2].src, '', 'one queued room remains the decoder bound');
  app.rooms[1].readyState = 4;
  app.rooms[1].emit('canplaythrough');
  assert.equal(app.rooms[1].dataset.iosPrewarm, undefined);
  assert.equal(app.rooms[2].src, 'assets/seg3.mp4');
  assert.equal(app.rooms[2].dataset.iosPrewarm, '1');
});

test('iOS with requestVideoFrameCallback keeps a prewarm plane until a composited frame is proven', async () => {
  const app = await boot({ ios: true, videoFrameCallback: true });

  app.rooms[0].readyState = 2;
  app.rooms[0].emit('loadeddata');
  assert.equal(typeof app.rooms[0].frameCallback, 'function');
  app.rooms[0].readyState = 4;
  app.rooms[0].emit('canplaythrough');
  assert.equal(app.rooms[1].src, '', 'playback coverage alone cannot release a native seam');

  app.rooms[0].frameCallback(0, { mediaTime: 0.001 });
  assert.equal(app.rooms[1].src, 'assets/seg2.mp4');
  assert.equal(app.rooms[1].dataset.iosPrewarm, '1');
});
