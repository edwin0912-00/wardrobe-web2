#!/usr/bin/env python3
"""Static server that actually supports HTTP Range.

This exists because `python3 -m http.server` does NOT implement Range requests, and
without Range a browser reports an EMPTY `seekable` range on a video element even when
the whole file is already buffered. Setting `currentTime` then sets `seeking = true`
and never completes, so a scroll-scrubbed film sits frozen on frame one with nothing in
the console to explain it. Any host serving this site must support Range for the same
reason.
"""
import json
import os
import re
import sys
import time
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
OBSERVABILITY_PATH = "/__site-observability"
MAX_OBSERVABILITY_BODY = 4096
OBSERVABILITY_EVENTS = {
    "client_error", "unhandled_rejection", "media_error", "media_stall",
    "gate_stalled", "bridge_failed", "bridge_needs_input",
}
SAFE_OBSERVABILITY_TOKEN = re.compile(r"[^a-z0-9_.-]+")

# Paths the cinematic client must never be able to reach through this origin.
#
# God View is the internal control room: one anonymous request to its overview returns a
# cross-profile inventory, and its asset routes address the uploaded person and identity
# photographs of other people. Verified on the live beta host: /api/god-view/session answers
# `authenticated: true` and /api/god-view/overview answers 200 to a caller with no cookie,
# because the runtime is started with the open-tester auth whose require() always returns a
# session. This gateway forwarded every /api/ path indiscriminately, so the customer-facing
# domain published it too.
#
# Fixing the runtime flag is a beta-side, release-owner decision and is not this file's to
# make. What this origin can decide is what it is willing to relay, and it has no reason to
# relay an internal control room to the public: nothing in the cinematic client calls it.
#
# A denylist rather than an allowlist on purpose: the adapter surface is still being extended
# on the other side of this seam, and an allowlist here would silently break a client route
# the moment one is added. This blocks a known-public internal surface without pretending to
# know the full shape of the legitimate one.
BLOCKED_API_PREFIXES = ("/api/god-view",)


class RangeHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _is_api_request(self):
        path = urlsplit(self.path).path
        return path == "/api" or path.startswith("/api/")

    def _is_blocked_api_request(self):
        path = urlsplit(self.path).path.rstrip("/")
        return any(path == prefix or path.startswith(prefix + "/")
                   for prefix in BLOCKED_API_PREFIXES)

    def _is_observability_request(self):
        return urlsplit(self.path).path == OBSERVABILITY_PATH

    @staticmethod
    def _safe_observability_token(value, limit=48):
        """Keep observability useful without ever turning it into user telemetry.

        Event payloads intentionally carry no file names, request URLs, form values,
        generated media URLs, error messages or stacks.  The token form also means an
        accidental future caller cannot put arbitrary text into the server log.
        """
        if not isinstance(value, str):
            return "unknown"
        value = SAFE_OBSERVABILITY_TOKEN.sub("-", value.lower()).strip("-._")
        return (value or "unknown")[:limit]

    def _observability_origin_is_same_site(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if not origin or not host:
            return False
        parsed = urlsplit(origin)
        return parsed.scheme in {"http", "https"} and parsed.netloc == host

    def _handle_observability(self):
        """Accept a tiny, same-origin, privacy-safe browser health signal.

        This endpoint exists solely so the on-call monitor can distinguish an actual
        browser failure from a quiet static server. It is neither analytics nor product
        state and deliberately does not persist anything.
        """
        if not self._observability_origin_is_same_site():
            self.send_error(403, "Same-origin observability only")
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self.send_error(415, "Expected application/json")
            return
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            self.send_error(400, "Chunked observability is not accepted")
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.send_error(400, "Malformed Content-Length")
            return
        if content_length < 1:
            self.send_error(400, "Empty observability payload")
            return
        if content_length > MAX_OBSERVABILITY_BODY:
            self.send_error(413, "Observability payload too large")
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400, "Malformed observability JSON")
            return
        if not isinstance(payload, dict) or payload.get("event") not in OBSERVABILITY_EVENTS:
            self.send_error(400, "Unknown observability event")
            return

        record = {
            "ts": round(time.time(), 3),
            "event": payload["event"],
            "code": self._safe_observability_token(payload.get("code")),
        }
        gate = self._safe_observability_token(payload.get("gate"))
        if gate != "unknown":
            record["gate"] = gate
        try:
            leg = int(payload.get("leg"))
            if 0 <= leg <= 3:
                record["leg"] = leg
        except (TypeError, ValueError):
            pass
        print("WARDROBE_OBSERVABILITY " + json.dumps(record, separators=(",", ":")), flush=True)
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _proxy_api(self):
        """Stream same-origin API requests to the local beta engine.

        The browser always talks to the active presentation origin.  Host-only
        cookies, mutation Origin checks, private media and EventSource therefore
        keep working even when the visual bundle is replaced.  The upstream is a
        fixed loopback service, never a request-controlled URL.
        """
        # Refused before the upstream is even resolved, so a blocked path cannot reach the
        # engine by any method, framing or header trick. 404 rather than 403: this origin does
        # not host that surface, which is the truthful answer and reveals nothing about what
        # exists behind the seam.
        if self._is_blocked_api_request():
            self.send_error(404, "Not found")
            return

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
        if self._is_observability_request():
            return self._handle_observability()
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
