#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_DIR"

fail() {
  echo "alpha install failed: $*" >&2
  exit 1
}

for command in git python3 node npm; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done

python3 - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("alpha install failed: Python 3.10+ is required")
print("python:", sys.version.split()[0])
PY

node - <<'JS'
const major = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(major) || major < 22) {
  process.stderr.write(`alpha install failed: Node.js 22+ is required; found ${process.version}\n`);
  process.exit(1);
}
process.stdout.write(`node: ${process.version}\n`);
JS

echo "Installing the locked beta dependencies..."
(cd beta && npm ci --no-audit --no-fund)

echo "Verifying both source trees and their integration..."
node scripts/verify-alpha.mjs --install

echo "Running the real two-process HTTP integration check..."
./scripts/run-alpha.sh --check

echo ""
echo "Wardrobe alpha installation passed."
echo "Run: ./scripts/run-alpha.sh"
echo "Open: http://127.0.0.1:4173/b/"

if [ "${1:-}" = "--run" ]; then
  exec ./scripts/run-alpha.sh
fi
