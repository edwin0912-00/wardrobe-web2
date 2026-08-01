/* WARDROBE — small transparent media derivatives.
 *
 * Originals remain the transport/source-of-truth bytes. This module creates a cached,
 * same-origin preview only for visual surfaces: it downsizes the image, removes the
 * near-white region connected to the outer edge, and encodes a compact alpha WebP. A
 * white shirt or a white logo in the interior is never removed because it is not connected
 * to the image edge. If a browser cannot decode or encode the derivative, callers keep the
 * original URL rather than replacing a real image with a placeholder.
 */
(function (global, factory) {
  var api = factory(global || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.WardrobeMediaPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
  'use strict';

  var DEFAULTS = Object.freeze({
    maxEdge: 640,
    whiteThreshold: 238,
    whiteChroma: 18,
    featherAlpha: 150,
    quality: 0.84,
    removeBackground: true
  });
  var cache = new Map();

  function options(value) {
    value = value || {};
    return {
      maxEdge: Math.max(64, Math.min(1600, Number(value.maxEdge) || DEFAULTS.maxEdge)),
      whiteThreshold: Math.max(200, Math.min(255, Number(value.whiteThreshold) || DEFAULTS.whiteThreshold)),
      whiteChroma: Math.max(0, Math.min(64, Number(value.whiteChroma) || DEFAULTS.whiteChroma)),
      featherAlpha: Math.max(0, Math.min(255, Number(value.featherAlpha) || DEFAULTS.featherAlpha)),
      quality: Math.max(0.4, Math.min(1, Number(value.quality) || DEFAULTS.quality)),
      removeBackground: value.removeBackground !== false
    };
  }

  function nearWhite(data, index, opts) {
    var alpha = data[index + 3];
    var red = data[index];
    var green = data[index + 1];
    var blue = data[index + 2];
    return alpha > 0 && red >= opts.whiteThreshold && green >= opts.whiteThreshold &&
      blue >= opts.whiteThreshold && Math.max(red, green, blue) - Math.min(red, green, blue) <= opts.whiteChroma;
  }

  /* Pure pixel operation: useful in tests and independent of Canvas APIs. */
  function removeEdgeBackground(imageData, settings) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
      throw new TypeError('imageData must contain width, height and data');
    }
    var opts = options(settings);
    var width = imageData.width;
    var height = imageData.height;
    var data = imageData.data;
    var visited = new Uint8Array(width * height);
    var queue = new Int32Array(width * height);
    var head = 0;
    var tail = 0;
    function enqueue(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      var offset = y * width + x;
      if (visited[offset] || !nearWhite(data, offset * 4, opts)) return;
      visited[offset] = 1;
      queue[tail++] = offset;
    }
    for (var x = 0; x < width; x++) { enqueue(x, 0); enqueue(x, height - 1); }
    for (var y = 1; y < height - 1; y++) { enqueue(0, y); enqueue(width - 1, y); }
    while (head < tail) {
      var point = queue[head++];
      var px = point % width;
      var py = (point - px) / width;
      enqueue(px - 1, py); enqueue(px + 1, py); enqueue(px, py - 1); enqueue(px, py + 1);
    }
    for (var index = 0; index < visited.length; index++) {
      if (!visited[index]) continue;
      data[index * 4 + 3] = 0;
    }
    /* One-pixel feather keeps a white fringe from outlining dark garments without
     * sacrificing interior white cloth. */
    for (var row = 1; row < height - 1; row++) {
      for (var column = 1; column < width - 1; column++) {
        var current = row * width + column;
        if (visited[current]) continue;
        var nearRemoved = visited[current - 1] || visited[current + 1] ||
          visited[current - width] || visited[current + width];
        if (nearRemoved && nearWhite(data, current * 4, opts)) data[current * 4 + 3] = opts.featherAlpha;
      }
    }
    return imageData;
  }

  function blobFromCanvas(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (!canvas || typeof canvas.toBlob !== 'function') return reject(new Error('Canvas encoding unavailable'));
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('Preview encoding failed'));
      }, type, quality);
    });
  }

  async function decode(blob) {
    var decoder = global.createImageBitmap;
    if (typeof decoder !== 'function') throw new Error('Image decoding unavailable');
    try { return await decoder(blob, { imageOrientation: 'from-image' }); }
    catch (_) { return decoder(blob); }
  }

  async function fromBlob(blob, settings) {
    if (!blob || !String(blob.type || '').toLowerCase().startsWith('image/')) return null;
    var opts = options(settings);
    var bitmap = await decode(blob);
    var scale = Math.min(1, opts.maxEdge / Math.max(bitmap.width, bitmap.height));
    var width = Math.max(1, Math.round(bitmap.width * scale));
    var height = Math.max(1, Math.round(bitmap.height * scale));
    var canvas = global.document && global.document.createElement('canvas');
    if (!canvas) { bitmap.close?.(); throw new Error('Canvas unavailable'); }
    canvas.width = width; canvas.height = height;
    var context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!context) { bitmap.close?.(); throw new Error('Canvas unavailable'); }
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    if (opts.removeBackground) {
      var pixels = context.getImageData(0, 0, width, height);
      removeEdgeBackground(pixels, opts);
      context.putImageData(pixels, 0, 0);
    }
    var output;
    try { output = await blobFromCanvas(canvas, 'image/webp', opts.quality); }
    catch (_) { output = await blobFromCanvas(canvas, 'image/png'); }
    canvas.width = 1; canvas.height = 1;
    var url = global.URL && global.URL.createObjectURL ? global.URL.createObjectURL(output) : '';
    return { url: url, blob: output, width: width, height: height };
  }

  async function fromUrl(url, settings) {
    var opts = options(settings);
    var source = String(url || '');
    if (!source) return null;
    var key = source + '|' + (opts.removeBackground ? 'cutout' : 'thumb');
    if (cache.has(key)) return cache.get(key);
    var task = (async function () {
      var response = await global.fetch(source, { credentials: 'same-origin', cache: 'force-cache' });
      if (!response.ok) throw new Error('Preview source unavailable');
      return fromBlob(await response.blob(), opts);
    })().catch(function () { return null; });
    cache.set(key, task);
    return task;
  }

  function forget(url) {
    var key = String(url || '');
    var entry = cache.get(key);
    cache.delete(key);
    Promise.resolve(entry).then(function (value) {
      if (value && value.url && global.URL && global.URL.revokeObjectURL) global.URL.revokeObjectURL(value.url);
    });
  }

  return Object.freeze({
    defaults: DEFAULTS,
    nearWhite: nearWhite,
    removeEdgeBackground: removeEdgeBackground,
    fromBlob: fromBlob,
    fromUrl: fromUrl,
    forget: forget
  });
});
