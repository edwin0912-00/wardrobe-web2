#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_DIR"

fail() {
  echo "alpha install failed: $*" >&2
  exit 1
}

mode=local
run_after=false
case "${1:-}" in
  ""|local) mode=local ;;
  quick|full|live) mode=$1 ;;
  all) mode=all ;;
  --run|run) mode=local; run_after=true ;;
  --help|-h)
    echo 'usage: ./verify [quick|local|full|live|all|--run]'
    exit 0
    ;;
  *) fail "unknown verification mode: $1" ;;
esac

for command in git python3 node npm tar; do
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

echo "Running the unified behavioral verification system ($mode)..."
if [ "$mode" = all ]; then
  node scripts/test-system.mjs all --keep-going
else
  node scripts/test-system.mjs "$mode"
fi

echo ""
echo "Wardrobe alpha verification passed ($mode)."
echo "Run: ./scripts/run-alpha.sh"
echo "Open: http://127.0.0.1:4173/b/"

if [ "$run_after" = true ]; then
  exec ./scripts/run-alpha.sh
fi
