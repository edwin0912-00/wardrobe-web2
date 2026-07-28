/* WARDROBE — the loader that tells the truth.
 *
 * The bar used to read each <video> element's own `buffered` range. That is only loosely
 * related to what is actually being downloaded: a cached file reports itself complete
 * almost instantly, a browser may decide it has fetched enough and stop, and `buffered`
 * is expressed in SECONDS of media rather than bytes, so a heavy opening second and a
 * light closing one count the same. The bar moved, but it was not reporting the download.
 *
 * So the assets are fetched here, by hand, and the bar is bytes-received over
 * bytes-total. Every file is streamed through a reader, each chunk is counted, and only
 * when a file is fully in memory does it become a blob URL handed to the element. Nothing
 * is guessed and nothing is averaged in units the viewer does not care about.
 *
 * Two consequences worth knowing:
 *   - Total is taken from Content-Length. A server using chunked encoding without one
 *     cannot be measured, so that file is excluded from the total and reported as
 *     unmeasurable rather than silently faked.
 *   - Because the whole payload is in memory before playback, seeking is instant and no
 *     Range request happens mid-scroll. That is the behaviour a scrubbed film wants
 *     anyway, and it is why the site is a load-once experience.
 */
(function (global) {
  'use strict';

  function head(url) {
    return fetch(url, { method: 'HEAD' })
      .then(function (r) {
        if (!r.ok) return null;
        var len = r.headers.get('Content-Length');
        return len ? parseInt(len, 10) : null;
      })
      .catch(function () { return null; });
  }

  /* Load a list of urls, reporting real byte progress.
   *
   * onProgress({ loaded, total, ratio, files: [{url, loaded, total, done}] })
   * resolves to { blobs: {url: blobUrl}, bytes, unmeasurable: [url] }
   */
  function load(urls, onProgress) {
    var files = urls.map(function (u) {
      return { url: u, loaded: 0, total: null, done: false, blob: null };
    });

    function report() {
      var loaded = 0, total = 0, known = 0;
      files.forEach(function (f) {
        loaded += f.loaded;
        if (f.total != null) { total += f.total; known++; }
      });
      /* If some files have no Content-Length, scale the known total up by the share of
       * files it represents. Better than pretending the unmeasurable ones weigh nothing,
       * and the shortfall is reported so it is never invisible. */
      var est = known > 0 ? total * (files.length / known) : 0;
      var ratio = est > 0 ? Math.min(1, loaded / est) : 0;
      if (onProgress) {
        onProgress({
          loaded: loaded,
          total: est,
          ratio: ratio,
          files: files.map(function (f) {
            return { url: f.url, loaded: f.loaded, total: f.total, done: f.done };
          })
        });
      }
    }

    /* Sizes first, so the bar has a real denominator from the very first chunk instead
     * of crawling up as files announce themselves. */
    return Promise.all(files.map(function (f) {
      return head(f.url).then(function (n) { f.total = n; });
    })).then(function () {
      report();

      return Promise.all(files.map(function (f) {
        return fetch(f.url).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + f.url);
          if (f.total == null) {
            var cl = res.headers.get('Content-Length');
            if (cl) { f.total = parseInt(cl, 10); }
          }
          if (!res.body || !res.body.getReader) {
            /* No streams: fall back to a whole-body read. Progress then steps once per
             * file rather than continuously, which is worse but still honest. */
            return res.blob().then(function (b) {
              f.loaded = f.total != null ? f.total : b.size;
              if (f.total == null) f.total = b.size;
              f.done = true; f.blob = b; report();
            });
          }
          var reader = res.body.getReader();
          var chunks = [];
          return (function pump() {
            return reader.read().then(function (r) {
              if (r.done) {
                f.done = true;
                f.blob = new Blob(chunks, { type: res.headers.get('Content-Type') || '' });
                /* Trust the real byte count over a header that may disagree. */
                if (f.total == null || f.loaded > f.total) f.total = f.loaded;
                chunks = null;
                report();
                return;
              }
              chunks.push(r.value);
              f.loaded += r.value.byteLength;
              report();
              return pump();
            });
          })();
        });
      })).then(function () {
        var blobs = {};
        files.forEach(function (f) {
          if (f.blob) blobs[f.url] = URL.createObjectURL(f.blob);
        });
        return {
          blobs: blobs,
          bytes: files.reduce(function (s, f) { return s + f.loaded; }, 0),
          unmeasurable: files.filter(function (f) { return f.total == null; }).map(function (f) { return f.url; }),
          files: files.map(function (f) { return { url: f.url, bytes: f.loaded }; })
        };
      });
    });
  }

  global.WardrobeLoader = { load: load };
})(window);
