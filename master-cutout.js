/* WARDROBE — exact-master foreground derivative.
 *
 * The beta profile currently exposes the approved look master, while a native
 * CUTOUT_NATIVE may be added by the server later.  This small presentation-only
 * bridge is the narrow fallback for that gap: it fetches the exact master bytes,
 * removes only border-connected white pixels at native resolution, and stores the
 * resulting RGBA PNG in the browser Cache API.  It never reads or segments a
 * thumbnail/preview, and a failed/unsupported operation returns null so the UI
 * keeps the approved master instead of inventing a foreground.
 */
(function (global) {
  'use strict';

  /* Bump the cache name whenever the native alpha policy changes.  A 640px or
   * white-matte legacy derivative must never survive into the answer mirror. */
  var CACHE_NAME = 'wardrobe-cutout-native-v2';
  var SHA256 = /^[0-9a-f]{64}$/i;

  function isPreviewOnlyUrl(value) {
    var source = String(value || '');
    /* Presentation query values identify a compact derivative, not the immutable
     * approved master.  Refuse it here too: UI selection mistakes must fail safe
     * rather than segmenting a low-resolution preview. */
    return /[?&](?:preview|thumbnail|derivative|max_edge|width|quality)=/i.test(source);
  }

  function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  async function digest(bytes) {
    if (!global.crypto || !global.crypto.subtle) throw new Error('SHA-256 unavailable');
    var hash = await global.crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(new Uint8Array(hash));
  }

  function cacheKey(sourceSha) {
    if (!global.location || !global.location.origin || !SHA256.test(sourceSha)) return null;
    return new Request(global.location.origin + '/__wardrobe/cutout-native/' + sourceSha);
  }

  async function cachedNative(sourceSha) {
    var key = cacheKey(sourceSha);
    if (!key || !global.caches) return null;
    try {
      var cache = await global.caches.open(CACHE_NAME);
      var response = await cache.match(key);
      if (!response || !response.ok) return null;
      var storedSource = response.headers.get('x-wardrobe-source-sha256');
      var storedNative = response.headers.get('x-wardrobe-native-sha256');
      if (storedSource !== sourceSha || !SHA256.test(storedNative || '')) return null;
      return { blob: await response.blob(), sourceSha256: storedSource, nativeSha256: storedNative };
    } catch (_) {
      return null;
    }
  }

  async function storeNative(sourceSha, nativeSha, blob) {
    var key = cacheKey(sourceSha);
    if (!key || !global.caches || typeof Response !== 'function') return;
    try {
      var cache = await global.caches.open(CACHE_NAME);
      await cache.put(key, new Response(blob, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=31536000, immutable',
          'x-wardrobe-source-sha256': sourceSha,
          'x-wardrobe-native-sha256': nativeSha,
          'x-wardrobe-has-alpha': '1',
        },
      }));
    } catch (_) { /* Cache API is an optimisation; the master remains the fallback. */ }
  }

  function decode(blob) {
    if (typeof global.createImageBitmap === 'function') return global.createImageBitmap(blob);
    return new Promise(function (resolve, reject) {
      if (!global.document || !global.document.createElement) return reject(new Error('Image decoding unavailable'));
      var image = global.document.createElement('img');
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('Image decoding failed')); };
      image.src = global.URL.createObjectURL(blob);
    });
  }

  function pngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (!canvas || typeof canvas.toBlob !== 'function') return reject(new Error('PNG encoding unavailable'));
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('PNG encoding failed'));
      }, 'image/png');
    });
  }

  async function previewFromNative(blob) {
    var preview = global.WardrobeMediaPreview;
    if (!preview || typeof preview.fromBlob !== 'function') return null;
    try {
      return await preview.fromBlob(blob, { removeBackground: false, maxEdge: 640 });
    } catch (_) {
      return null;
    }
  }

  async function create(masterUrl, knownSourceSha256) {
    var sourceUrl = String(masterUrl || '');
    if (!sourceUrl || typeof global.fetch !== 'function') return null;
    if (isPreviewOnlyUrl(sourceUrl)) {
      throw new Error('Preview derivative is not an approved master');
    }
    var sourceResponse = await global.fetch(sourceUrl, {
      credentials: 'same-origin',
      cache: 'force-cache',
    });
    if (!sourceResponse.ok) throw new Error('Approved master unavailable');
    var sourceBytes = await sourceResponse.arrayBuffer();
    var sourceSha256 = SHA256.test(String(knownSourceSha256 || ''))
      ? String(knownSourceSha256).toLowerCase()
      : await digest(sourceBytes);

    var stored = await cachedNative(sourceSha256);
    var nativeBlob = stored ? stored.blob : null;
    var nativeSha256 = stored ? stored.nativeSha256 : null;
    if (!nativeBlob) {
      var bitmap = await decode(new Blob([sourceBytes], { type: sourceResponse.headers.get('content-type') || 'image/png' }));
      var canvas = global.document && global.document.createElement
        ? global.document.createElement('canvas') : null;
      if (!canvas) throw new Error('Canvas unavailable');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      var context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === 'function') bitmap.close();
      var pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      if (!global.WardrobeMediaPreview || typeof global.WardrobeMediaPreview.removeEdgeBackground !== 'function') {
        throw new Error('Native cutout operation unavailable');
      }
      global.WardrobeMediaPreview.removeEdgeBackground(pixels, {
        whiteThreshold: 238,
        whiteChroma: 18,
        /* On the dark answer mirror a semitransparent white matte reads as a
         * low-quality pixel fringe.  This operation is at native source size;
         * remove the edge-connected white matte fully, then make the compact
         * WebP only from this native alpha asset. */
        featherAlpha: 0,
      });
      context.putImageData(pixels, 0, 0);
      nativeBlob = await pngBlob(canvas);
      nativeSha256 = await digest(await nativeBlob.arrayBuffer());
      await storeNative(sourceSha256, nativeSha256, nativeBlob);
    }

    var nativeUrl = global.URL && global.URL.createObjectURL ? global.URL.createObjectURL(nativeBlob) : '';
    if (!nativeUrl || !SHA256.test(nativeSha256 || '')) return null;
    var preview = await previewFromNative(nativeBlob);
    var previewSha256 = preview && preview.blob ? await digest(await preview.blob.arrayBuffer()) : null;
    return {
      nativeUrl: nativeUrl,
      nativeBlob: nativeBlob,
      nativeSha256: nativeSha256,
      sourceMasterSha256: sourceSha256,
      previewUrl: preview && preview.url || '',
      previewBlob: preview && preview.blob || null,
      previewSha256: previewSha256,
      previewSourceNativeSha256: previewSha256 ? nativeSha256 : null,
    };
  }

  global.WardrobeMasterCutout = Object.freeze({ create: create, cacheName: CACHE_NAME });
})(typeof globalThis !== 'undefined' ? globalThis : this);
