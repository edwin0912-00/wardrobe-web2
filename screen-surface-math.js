/* WARDROBE — geometry helpers for calibrated screen surfaces.
 *
 * This tiny UMD module deliberately contains no DOM work.  It is shared by the
 * browser surface layer and node tests so a bad TV calibration is rejected before
 * it can put a rectangle somewhere invented in the film.
 */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.WardrobeSurfaceMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPSILON = 0.000001;

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function finite(value, label) {
    var number = Number(value);
    if (!isFinite(number)) throw new TypeError(label + ' must be a finite number');
    return number;
  }

  function unit(value, label) {
    var number = finite(value, label);
    if (number < -EPSILON || number > 1 + EPSILON) {
      throw new RangeError(label + ' must be within 0…1 of the film frame');
    }
    return clamp01(number);
  }

  function normaliseFrame(raw, label) {
    label = label || 'surface frame';
    if (!raw || typeof raw !== 'object') throw new TypeError(label + ' must be an object');

    var time = finite(raw.time == null ? raw.at : raw.time, label + '.time');
    if (time < 0) throw new RangeError(label + '.time must be zero or later');

    var x = unit(raw.x, label + '.x');
    var y = unit(raw.y, label + '.y');
    var width = unit(raw.width == null ? raw.w : raw.width, label + '.width');
    var height = unit(raw.height == null ? raw.h : raw.height, label + '.height');

    if (width <= EPSILON || height <= EPSILON) {
      throw new RangeError(label + ' must have a positive width and height');
    }
    if (x + width > 1 + EPSILON || y + height > 1 + EPSILON) {
      throw new RangeError(label + ' must stay inside the measured film frame');
    }

    return Object.freeze({ time: time, x: x, y: y, width: width, height: height });
  }

  function normaliseCalibration(raw, surfaceName) {
    surfaceName = surfaceName || 'surface';
    if (!raw || typeof raw !== 'object') throw new TypeError(surfaceName + ' calibration must be an object');

    var leg = finite(raw.leg, surfaceName + '.leg');
    if (leg < 0 || Math.floor(leg) !== leg) {
      throw new RangeError(surfaceName + '.leg must be a non-negative integer');
    }
    if (typeof raw.measuredFrom !== 'string' || !raw.measuredFrom.trim()) {
      throw new TypeError(surfaceName + ' calibration requires measuredFrom; do not guess screen geometry');
    }
    if (!Array.isArray(raw.frames) || !raw.frames.length) {
      throw new TypeError(surfaceName + ' calibration requires at least one measured frame');
    }

    var frames = raw.frames.map(function (frame, index) {
      return normaliseFrame(frame, surfaceName + '.frames[' + index + ']');
    }).sort(function (a, b) { return a.time - b.time; });

    for (var i = 1; i < frames.length; i++) {
      if (frames[i].time - frames[i - 1].time <= EPSILON) {
        throw new RangeError(surfaceName + ' calibration frame times must be strictly increasing');
      }
    }

    return Object.freeze({
      leg: leg,
      measuredFrom: raw.measuredFrom.trim(),
      frames: Object.freeze(frames)
    });
  }

  function interpolateFrame(frames, time) {
    if (!Array.isArray(frames) || !frames.length) return null;
    var t = finite(time, 'surface time');
    if (t <= frames[0].time) return frames[0];
    var last = frames[frames.length - 1];
    if (t >= last.time) return last;

    for (var i = 0; i < frames.length - 1; i++) {
      var a = frames[i];
      var b = frames[i + 1];
      if (t <= b.time) {
        var span = b.time - a.time;
        var ratio = span > 0 ? clamp01((t - a.time) / span) : 0;
        return {
          time: t,
          x: a.x + (b.x - a.x) * ratio,
          y: a.y + (b.y - a.y) * ratio,
          width: a.width + (b.width - a.width) * ratio,
          height: a.height + (b.height - a.height) * ratio
        };
      }
    }
    return last;
  }

  return Object.freeze({
    clamp01: clamp01,
    normaliseFrame: normaliseFrame,
    normaliseCalibration: normaliseCalibration,
    interpolateFrame: interpolateFrame
  });
});
