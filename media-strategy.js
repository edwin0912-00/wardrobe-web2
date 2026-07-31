/* WARDROBE — first-room media strategy.
 *
 * The fabric intro is the first visible clip, but room one is the first clip it hands
 * into. Those are different delivery requirements. Desktop can keep room one in memory
 * before the curtain opens, while iOS must keep its H.264 source native (a fetched Blob
 * can report ready while Safari paints a black compositor plane).
 *
 * This module owns that split in one small, testable place. It deliberately has no DOM,
 * scroll or loading side effects: the page chooses when to mount a native source, and
 * loader.js remains the only byte-progress owner.
 */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.WardrobeMediaStrategy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function url(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(label + ' must be a non-empty media URL');
    }
    return value.trim();
  }

  function urls(values, label) {
    if (!Array.isArray(values) || !values.length) {
      throw new TypeError(label + ' must be a non-empty URL list');
    }
    return values.map(function (value, index) { return url(value, label + '[' + index + ']'); });
  }

  function frozenList(values) { return Object.freeze(values.slice()); }

  /* Desktop gets a truthful loader for the first visible handoff: by the time fabric
   * dissolves, room one is a local Blob and cannot arrive as a black/late plane. iOS
   * starts room one native before the loader; its later rooms are mounted natively in
   * sequence, never fetched into a Blob and then fetched a second time by <video>. */
  function create(options) {
    options = options || {};
    var videos = urls(options.videos, 'videos');
    var tracks = urls(options.tracks, 'tracks');
    var intro = url(options.intro, 'intro');
    var ios = options.ios === true;

    return Object.freeze({
      ios: ios,
      critical: frozenList(ios ? [tracks[0], intro] : [tracks[0], intro, videos[0]]),
      background: frozenList(ios ? [] : videos.slice(1)),
      nativeInitialLegs: frozenList(ios ? [0] : []),
      nativeDeferredLegs: frozenList(ios ? videos.slice(1).map(function (_url, index) {
        return index + 1;
      }) : [])
    });
  }

  /* A native iOS source may only be handed over when the loader actually owns that
   * file. This prevents an early `handOver()` from accidentally assigning seg2–seg4
   * while their independent fetches are still in flight. */
  function hasBlob(blobs, mediaUrl) {
    return !!(blobs && Object.prototype.hasOwnProperty.call(blobs, mediaUrl) && blobs[mediaUrl]);
  }

  return Object.freeze({ create: create, hasBlob: hasBlob });
});
