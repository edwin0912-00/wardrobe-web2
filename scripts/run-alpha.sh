#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

choose_free_port() {
  python3 - "$1" "${2:-}" <<'PY'
import socket
import sys

candidate = int(sys.argv[1])
excluded = {int(value) for value in sys.argv[2:] if value}
while candidate < 65535:
    if candidate in excluded:
        candidate += 1
        continue
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", candidate))
        except OSError:
            candidate += 1
            continue
    print(candidate)
    raise SystemExit(0)
raise SystemExit("alpha runtime failed: no free loopback port was found")
PY
}

if [ -n "${WARDROBE_ALPHA_SITE_PORT:-}" ]; then
  SITE_PORT=$WARDROBE_ALPHA_SITE_PORT
else
  SITE_PORT=$(choose_free_port 4173)
fi
if [ -n "${WARDROBE_ALPHA_ENGINE_PORT:-}" ]; then
  ENGINE_PORT=$WARDROBE_ALPHA_ENGINE_PORT
else
  ENGINE_PORT=$(choose_free_port 4176 "$SITE_PORT")
fi

if [ -n "${WARDROBE_ALPHA_RUNTIME_ROOT:-}" ]; then
  RUNTIME_ROOT=$WARDROBE_ALPHA_RUNTIME_ROOT
else
  RUNTIME_ROOT=$(python3 - <<'PY'
from pathlib import Path
import os
import platform

if platform.system() == "Darwin":
    print(Path.home() / "Library" / "Application Support" / "WardrobeAlpha")
else:
    state = os.environ.get("XDG_STATE_HOME")
    print((Path(state) if state else Path.home() / ".local" / "state") / "wardrobe-alpha")
PY
  )
fi

LOG_ROOT=$RUNTIME_ROOT/logs
mkdir -p "$LOG_ROOT"
RELEASE_MANIFEST=$REPO_DIR/beta/ops/product-release-manifest.json
RELEASE_MANIFEST_CREATED=false

if [ ! -e "$RELEASE_MANIFEST" ]; then
  ALPHA_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
  python3 - "$RELEASE_MANIFEST" "$ALPHA_SHA" <<'PY'
import json
from pathlib import Path
import sys

target = Path(sys.argv[1])
commit = sys.argv[2]
target.write_text(json.dumps({
    "base_commit": commit,
    "cache_token": f"product-{commit[:8]}-{commit[8:20]}",
}, indent=2) + "\n")
PY
  RELEASE_MANIFEST_CREATED=true
fi

fail() {
  echo "alpha runtime failed: $*" >&2
  exit 1
}

[ -d "$REPO_DIR/beta/node_modules" ] || fail "beta dependencies are missing; run ./scripts/install-alpha.sh"

python3 - "$SITE_PORT" "$ENGINE_PORT" <<'PY'
import socket
import sys

for value in sys.argv[1:]:
    port = int(value)
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as exc:
            raise SystemExit(f"alpha runtime failed: port {port} is already in use ({exc})")
PY

SITE_PID=
ENGINE_PID=
cleanup() {
  trap - INT TERM EXIT
  [ -z "$SITE_PID" ] || kill "$SITE_PID" 2>/dev/null || true
  [ -z "$ENGINE_PID" ] || kill "$ENGINE_PID" 2>/dev/null || true
  [ -z "$SITE_PID" ] || wait "$SITE_PID" 2>/dev/null || true
  [ -z "$ENGINE_PID" ] || wait "$ENGINE_PID" 2>/dev/null || true
  if [ "$RELEASE_MANIFEST_CREATED" = true ]; then
    rm -f "$RELEASE_MANIFEST"
  fi
}
trap cleanup INT TERM EXIT

wait_for_url() {
  python3 - "$1" "$2" <<'PY'
import sys
import time
import urllib.error
import urllib.request

url = sys.argv[1]
deadline = time.monotonic() + int(sys.argv[2])
last = "no response"
while time.monotonic() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            if 200 <= response.status < 300:
                raise SystemExit(0)
            last = f"HTTP {response.status}"
    except Exception as exc:
        last = str(exc)
    time.sleep(0.5)
raise SystemExit(f"{url} did not become ready: {last}")
PY
}

(
  cd "$REPO_DIR/beta"
  PORT=$ENGINE_PORT \
  ZEELY_RUNTIME_ROOT=$RUNTIME_ROOT/engine \
  ZEELY_COOKIE_SECURE=false \
  npm run app
) >"$LOG_ROOT/engine.log" 2>&1 &
ENGINE_PID=$!

if ! wait_for_url "http://127.0.0.1:$ENGINE_PORT/api/health" 75; then
  tail -n 80 "$LOG_ROOT/engine.log" >&2 || true
  fail "beta engine did not start"
fi

(
  PORT=$SITE_PORT \
  WARDROBE_API_UPSTREAM="http://127.0.0.1:$ENGINE_PORT" \
  WARDROBE_SITE_ONLY=1 \
  "$REPO_DIR/scripts/run-local.sh"
) >"$LOG_ROOT/site.log" 2>&1 &
SITE_PID=$!

if ! wait_for_url "http://127.0.0.1:$SITE_PORT/b/" 30; then
  tail -n 80 "$LOG_ROOT/site.log" >&2 || true
  fail "cinematic site did not start"
fi

python3 - "$SITE_PORT" "$ENGINE_PORT" <<'PY'
import json
import sys
import urllib.request

site_port, engine_port = map(int, sys.argv[1:])

def fetch(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, response.headers, response.read()

checks = [
    (f"http://127.0.0.1:{site_port}/", "main root"),
    (f"http://127.0.0.1:{engine_port}/", "beta UI"),
    (f"http://127.0.0.1:{engine_port}/api/health", "beta health"),
    (f"http://127.0.0.1:{site_port}/b/", "main UI"),
    (f"http://127.0.0.1:{site_port}/api/health", "main-to-beta bridge"),
    (f"http://127.0.0.1:{site_port}/api/editorial-modes", "main API catalog bridge"),
    (f"http://127.0.0.1:{site_port}/adapters/zeely-client.mjs", "browser API client module"),
    (f"http://127.0.0.1:{site_port}/adapters/cinematic-ui-bridge.mjs", "browser state bridge module"),
    (f"http://127.0.0.1:{site_port}/b/zeely-pipeline-clients.html", "pipeline presentation"),
]
for url, label in checks:
    status, _, body = fetch(url)
    if status != 200 or not body:
        raise SystemExit(f"alpha runtime failed: {label} returned HTTP {status} or an empty body")
    print(f"PASS {label}: HTTP {status}")

_, _, bridge_health_bytes = fetch(f"http://127.0.0.1:{site_port}/api/health")
bridge_health = json.loads(bridge_health_bytes)
if bridge_health.get("status") != "ready":
    raise SystemExit("alpha runtime failed: main bridge did not return the ready backend state")

status, headers, body = fetch(
    f"http://127.0.0.1:{site_port}/b/assets/seg1.mp4",
    {"Range": "bytes=0-1023"},
)
if status != 206 or len(body) != 1024 or not headers.get("Content-Range"):
    raise SystemExit("alpha runtime failed: MP4 HTTP Range contract is broken")
print("PASS MP4 Range: HTTP 206")

_, _, health_bytes = fetch(f"http://127.0.0.1:{site_port}/api/health")
health = json.loads(health_bytes)
print("ENGINE", json.dumps({
    "status": health.get("status"),
    "generation": health.get("generation"),
    "release_sha": health.get("release_sha"),
}, ensure_ascii=False))
PY

echo ""
echo "Wardrobe alpha is ready"
echo "Main site: http://127.0.0.1:$SITE_PORT/b/"
echo "Beta UI:   http://127.0.0.1:$ENGINE_PORT/"
echo "Logs:      $LOG_ROOT"

if [ "${1:-}" = "--check" ]; then
  exit 0
fi

while kill -0 "$SITE_PID" 2>/dev/null && kill -0 "$ENGINE_PID" 2>/dev/null; do
  sleep 1
done

tail -n 80 "$LOG_ROOT/site.log" >&2 || true
tail -n 80 "$LOG_ROOT/engine.log" >&2 || true
fail "one of the two alpha processes stopped"
