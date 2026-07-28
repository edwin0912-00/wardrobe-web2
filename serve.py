#!/usr/bin/env python3
"""Static server that actually supports HTTP Range.

This exists because `python3 -m http.server` does NOT implement Range requests, and
without Range a browser reports an EMPTY `seekable` range on a video element even when
the whole file is already buffered. Setting `currentTime` then sets `seeking = true`
and never completes, so a scroll-scrubbed film sits frozen on frame one with nothing in
the console to explain it. Any host serving this site must support Range for the same
reason.
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class RangeHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(f.fileno()).st_size
        m = RANGE_RE.match(rng.strip())
        if not m:
            f.close()
            self.send_error(400, "Malformed Range")
            return None

        start_s, end_s = m.group(1), m.group(2)
        if start_s == "":
            # suffix form: bytes=-N means the last N bytes
            length = int(end_s or 0)
            start = max(0, size - length)
            end = size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1

        if start >= size or start > end:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        end = min(end, size - 1)
        f.seek(start)
        self._remaining = end - start + 1

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(self._remaining))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        self._remaining = None
        chunk = 128 * 1024
        while remaining > 0:
            data = source.read(min(chunk, remaining))
            if not data:
                break
            outputfile.write(data)
            remaining -= len(data)

    def log_message(self, fmt, *args):
        pass  # quiet


def main():
    """Port comes from the PORT environment variable first.

    A hardcoded port in the launch arguments collides the moment a second session wants
    the same one, and the harness cannot reassign around it. Taking PORT from the
    environment lets whoever starts this choose, and the argv form stays available for
    running it by hand.
    """
    env_port = os.environ.get("PORT")
    if env_port and env_port.isdigit():
        port = int(env_port)
    elif len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    else:
        port = 0  # let the OS pick a free one rather than fail on a busy port

    root = os.environ.get("SERVE_ROOT")
    if not root:
        root = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__))

    handler = partial(RangeHandler, directory=root)
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    actual = srv.server_address[1]
    print("serving %s on http://127.0.0.1:%d (Range enabled)" % (root, actual), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
