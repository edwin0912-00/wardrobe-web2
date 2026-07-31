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
from http.client import HTTPConnection
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
API_UPSTREAM = os.environ.get("WARDROBE_API_UPSTREAM", "http://127.0.0.1:4176")
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
}


class RangeHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _is_api_request(self):
        path = urlsplit(self.path).path
        return path == "/api" or path.startswith("/api/")

    def _proxy_api(self):
        """Stream same-origin API requests to the local beta engine.

        The browser always talks to the active presentation origin.  Host-only
        cookies, mutation Origin checks, private media and EventSource therefore
        keep working even when the visual bundle is replaced.  The upstream is a
        fixed loopback service, never a request-controlled URL.
        """
        upstream = urlsplit(API_UPSTREAM)
        if upstream.scheme != "http" or upstream.hostname not in {"127.0.0.1", "localhost"}:
            self.send_error(500, "WARDROBE_API_UPSTREAM must be a loopback http URL")
            return

        content_length = self.headers.get("Content-Length")
        request_is_chunked = "chunked" in self.headers.get("Transfer-Encoding", "").lower()
        if content_length is not None and request_is_chunked:
            self.send_error(400, "Ambiguous request framing")
            return
        if content_length is not None:
            try:
                remaining = int(content_length)
            except ValueError:
                self.send_error(400, "Malformed Content-Length")
                return
            if remaining < 0:
                self.send_error(400, "Malformed Content-Length")
                return
        else:
            remaining = 0

        conn = HTTPConnection(upstream.hostname, upstream.port or 80, timeout=3600)
        response_started = False
        try:
            conn.putrequest(self.command, self.path, skip_host=True, skip_accept_encoding=True)
            for name, value in self.headers.items():
                lower = name.lower()
                if lower in HOP_BY_HOP or lower in {
                    "content-length", "host", "x-forwarded-host", "x-forwarded-proto",
                }:
                    continue
                conn.putheader(name, value)
            conn.putheader("Host", self.headers.get("Host", "site.madeforthisjob.com"))
            conn.putheader("X-Forwarded-Host", self.headers.get("Host", ""))
            conn.putheader("X-Forwarded-Proto", self.headers.get("X-Forwarded-Proto", "https"))
            if request_is_chunked:
                conn.putheader("Transfer-Encoding", "chunked")
            else:
                conn.putheader("Content-Length", str(remaining))
            conn.putheader("Connection", "close")
            conn.endheaders()

            if request_is_chunked:
                while True:
                    line = self.rfile.readline(65_537)
                    if not line or len(line) > 65_536 or not line.endswith(b"\r\n"):
                        raise ConnectionError("malformed chunk header")
                    try:
                        size = int(line.split(b";", 1)[0].strip(), 16)
                    except ValueError as error:
                        raise ConnectionError("malformed chunk size") from error
                    if size == 0:
                        # Consume trailers locally. Forwarding request trailers is not
                        # needed by the product API and would expand the trust surface.
                        while True:
                            trailer = self.rfile.readline(65_537)
                            if not trailer or trailer == b"\r\n":
                                break
                        conn.send(b"0\r\n\r\n")
                        break
                    chunk = self.rfile.read(size)
                    ending = self.rfile.read(2)
                    if len(chunk) != size or ending != b"\r\n":
                        raise ConnectionError("request chunk ended early")
                    conn.send(("%x\r\n" % size).encode("ascii") + chunk + b"\r\n")
            else:
                while remaining:
                    chunk = self.rfile.read(min(128 * 1024, remaining))
                    if not chunk:
                        raise ConnectionError("request body ended before Content-Length")
                    conn.send(chunk)
                    remaining -= len(chunk)

            response = conn.getresponse()
            self._proxying = True
            self.send_response(response.status, response.reason)
            response_headers = response.getheaders()
            for name, value in response_headers:
                if name.lower() in HOP_BY_HOP:
                    continue
                self.send_header(name, value)
            if not any(name.lower() == "cache-control" for name, _ in response_headers):
                self.send_header("Cache-Control", "no-store")
            # http.client decodes an upstream chunked body before we relay it. Closing
            # the downstream API response is therefore its reliable message boundary;
            # for SSE the close happens only when the upstream event stream ends.
            self.send_header("Connection", "close")
            self.close_connection = True
            self.end_headers()
            self._proxying = False
            response_started = True

            if self.command != "HEAD":
                while True:
                    chunk = response.read(128 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except (OSError, ConnectionError) as error:
            if not response_started and not self.wfile.closed:
                try:
                    self.send_error(502, "Product engine unavailable: %s" % error)
                except OSError:
                    pass
        finally:
            conn.close()

    def do_GET(self):
        if self._is_api_request():
            return self._proxy_api()
        return super().do_GET()

    def do_HEAD(self):
        if self._is_api_request():
            return self._proxy_api()
        return super().do_HEAD()

    def do_POST(self):
        if self._is_api_request():
            return self._proxy_api()
        self.send_error(405, "Method not allowed")

    def do_PUT(self):
        if self._is_api_request():
            return self._proxy_api()
        self.send_error(405, "Method not allowed")

    def do_PATCH(self):
        if self._is_api_request():
            return self._proxy_api()
        self.send_error(405, "Method not allowed")

    def do_DELETE(self):
        if self._is_api_request():
            return self._proxy_api()
        self.send_error(405, "Method not allowed")

    def end_headers(self):
        if not getattr(self, "_proxying", False):
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
