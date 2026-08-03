#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_DIR"

fail() {
  echo "install check failed: $*" >&2
  exit 1
}

command -v python3 >/dev/null 2>&1 || fail "Python 3.10+ is required"

python3 - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("install check failed: Python 3.10+ is required")
print("python:", sys.version.split()[0])
PY

for required_path in \
  serve.py \
  b/index.html \
  b/assets/intro.mp4 \
  b/assets/seg1.mp4 \
  b/pipeline-deck-v2.html \
  b/pipeline-deck.js \
  b/screen-calibration.json
do
  [ -f "$required_path" ] || fail "missing tracked file: $required_path"
done

python3 -m py_compile serve.py

if command -v node >/dev/null 2>&1; then
  node --check engine.js
  node --check screen-surfaces.js
  node --check b/pipeline-deck.js
  node --test test/pipeline-deck.test.mjs test/laptop-placeholder.test.mjs >/dev/null
  echo "node: $(node --version) · focused checks passed"
else
  echo "node: not installed · runtime is ready; development tests were skipped"
fi

echo "Wardrobe is installed at $REPO_DIR"
echo "Run: ./scripts/run-local.sh"
echo "Open: http://127.0.0.1:${PORT:-4173}/b/"

if [ "${1:-}" = "--run" ]; then
  exec ./scripts/run-local.sh
fi

