#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# A default checkout is unified. `run-alpha.sh` sets WARDROBE_SITE_ONLY while
# starting the child gateway, which prevents recursion. An explicitly supplied
# upstream also remains a supported site-only development mode.
if [ -f "$REPO_DIR/beta/package.json" ] \
  && [ "${WARDROBE_SITE_ONLY:-0}" != "1" ] \
  && [ -z "${WARDROBE_API_UPSTREAM:-}" ]; then
  exec "$REPO_DIR/scripts/run-alpha.sh" "$@"
fi

PORT=${PORT:-4173}
WARDROBE_API_UPSTREAM=${WARDROBE_API_UPSTREAM:-http://127.0.0.1:4176}

export PORT WARDROBE_API_UPSTREAM
export SERVE_ROOT="$REPO_DIR"

echo "Wardrobe: http://127.0.0.1:$PORT/b/"
echo "API upstream: $WARDROBE_API_UPSTREAM"
exec python3 "$REPO_DIR/serve.py"
