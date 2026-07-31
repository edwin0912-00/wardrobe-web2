/* WARDROBE — measured screen-plane math.
 *
 * A television can be represented by a rectangle, but the D laptop approach is
 * perspective: its four display corners are a quadrilateral. This module has
 * no DOM, media or UI dependency. It turns only explicitly measured quads into
 * a projective transform, so a future laptop document can occupy the filmed
 * display without spilling onto its chin or keyboard.
 */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.WardrobeSurfaceMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EPSILON = 0.000001;

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }

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

  function point(raw, label) {
    if (!raw || typeof raw !== 'object') throw new TypeError(label + ' must be a point');
    return Object.freeze({ x: unit(raw.x, label + '.x'), y: unit(raw.y, label + '.y') });
  }

  function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function signedArea(points) {
    var sum = 0;
    for (var i = 0; i < points.length; i++) {
      var a = points[i];
      var b = points[(i + 1) % points.length];
      sum += a.x * b.y - a.y * b.x;
    }
    return sum / 2;
  }

  function assertConvexClockwise(points, label) {
    var sign = 0;
    for (var i = 0; i < points.length; i++) {
      var value = cross(points[i], points[(i + 1) % points.length], points[(i + 2) % points.length]);
      if (Math.abs(value) <= EPSILON) throw new RangeError(label + ' must not have collinear corners');
      if (!sign) sign = value > 0 ? 1 : -1;
      if ((value > 0 ? 1 : -1) !== sign) throw new RangeError(label + ' must be a convex ordered display quad');
    }
    if (Math.abs(signedArea(points)) <= EPSILON) throw new RangeError(label + ' must have a visible area');
  }

  /* Required order is the visual order around the display, never browser-box order:
   * tl → tr → br → bl. This is the one condition that makes the projective transform
   * deterministic and prevents a crossed/bow-tie screen from being accepted. */
  function normaliseQuad(raw, label) {
    label = label || 'screen frame';
    if (!raw || typeof raw !== 'object') throw new TypeError(label + ' must be an object');
    var time = finite(raw.time == null ? raw.at : raw.time, label + '.time');
    if (time < 0) throw new RangeError(label + '.time must be zero or later');

    var tl = point(raw.tl, label + '.tl');
    var tr = point(raw.tr, label + '.tr');
    var br = point(raw.br, label + '.br');
    var bl = point(raw.bl, label + '.bl');
    assertConvexClockwise([tl, tr, br, bl], label);
    return Object.freeze({ time: time, tl: tl, tr: tr, br: br, bl: bl });
  }

  function normaliseQuadCalibration(raw, surfaceName) {
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
      return normaliseQuad(frame, surfaceName + '.frames[' + index + ']');
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

  function interpolatePoint(a, b, ratio) {
    return Object.freeze({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
  }

  function interpolateQuad(frames, time) {
    if (!Array.isArray(frames) || !frames.length) return null;
    var t = finite(time, 'surface time');
    if (t <= frames[0].time) return frames[0];
    var last = frames[frames.length - 1];
    if (t >= last.time) return last;
    for (var i = 0; i < frames.length - 1; i++) {
      var a = frames[i];
      var b = frames[i + 1];
      if (t <= b.time) {
        var ratio = clamp01((t - a.time) / (b.time - a.time));
        return Object.freeze({
          time: t,
          tl: interpolatePoint(a.tl, b.tl, ratio), tr: interpolatePoint(a.tr, b.tr, ratio),
          br: interpolatePoint(a.br, b.br, ratio), bl: interpolatePoint(a.bl, b.bl, ratio)
        });
      }
    }
    return last;
  }

  function positive(value, label) {
    var number = finite(value, label);
    if (number <= EPSILON) throw new RangeError(label + ' must be greater than zero');
    return number;
  }

  /* Homography from a unit square to a target quad. This closed-form solution maps
   * (0,0)/(1,0)/(1,1)/(0,1) exactly to tl/tr/br/bl. */
  function unitHomography(quad, stageWidth, stageHeight) {
    var width = positive(stageWidth, 'stageWidth');
    var height = positive(stageHeight, 'stageHeight');
    var p0 = { x: quad.tl.x * width, y: quad.tl.y * height };
    var p1 = { x: quad.tr.x * width, y: quad.tr.y * height };
    var p2 = { x: quad.br.x * width, y: quad.br.y * height };
    var p3 = { x: quad.bl.x * width, y: quad.bl.y * height };

    var dx1 = p1.x - p2.x;
    var dx2 = p3.x - p2.x;
    var dx3 = p0.x - p1.x + p2.x - p3.x;
    var dy1 = p1.y - p2.y;
    var dy2 = p3.y - p2.y;
    var dy3 = p0.y - p1.y + p2.y - p3.y;
    var denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) <= EPSILON) {
      /* A parallelogram has no projective term. */
      return Object.freeze({
        a: p1.x - p0.x, b: p3.x - p0.x, c: p0.x,
        d: p1.y - p0.y, e: p3.y - p0.y, f: p0.y,
        g: 0, h: 0
      });
    }
    var g = (dx3 * dy2 - dx2 * dy3) / denominator;
    var h = (dx1 * dy3 - dx3 * dy1) / denominator;
    return Object.freeze({
      a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x,
      d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y,
      g: g, h: h
    });
  }

  function project(homography, x, y) {
    var h = homography;
    var denominator = h.g * x + h.h * y + 1;
    if (Math.abs(denominator) <= EPSILON) throw new RangeError('projective denominator collapsed');
    return Object.freeze({
      x: (h.a * x + h.b * y + h.c) / denominator,
      y: (h.d * x + h.e * y + h.f) / denominator
    });
  }

  /* Build a CSS matrix3d for an element with sourceWidth × sourceHeight CSS pixels.
   * CSS applies matrix3d in column-major order; x/y are divided by source dimensions
   * before the unit-square homography is evaluated. */
  function cssMatrix3dForQuad(quad, options) {
    options = options || {};
    var sourceWidth = positive(options.sourceWidth, 'sourceWidth');
    var sourceHeight = positive(options.sourceHeight, 'sourceHeight');
    var h = unitHomography(quad, options.stageWidth, options.stageHeight);
    var matrix = Object.freeze([
      h.a / sourceWidth, h.d / sourceWidth, 0, h.g / sourceWidth,
      h.b / sourceHeight, h.e / sourceHeight, 0, h.h / sourceHeight,
      0, 0, 1, 0,
      h.c, h.f, 0, 1
    ]);
    return Object.freeze({
      homography: h,
      matrix: matrix,
      css: 'matrix3d(' + matrix.map(function (value) { return Number(value.toFixed(12)); }).join(',') + ')'
    });
  }

  return Object.freeze({
    clamp01: clamp01,
    normaliseQuad: normaliseQuad,
    normaliseQuadCalibration: normaliseQuadCalibration,
    interpolateQuad: interpolateQuad,
    unitHomography: unitHomography,
    project: project,
    cssMatrix3dForQuad: cssMatrix3dForQuad
  });
});
