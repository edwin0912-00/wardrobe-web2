#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${PORT:-4173}
WARDROBE_API_UPSTREAM=${WARDROBE_API_UPSTREAM:-http://127.0.0.1:4176}

export PORT WARDROBE_API_UPSTREAM
export SERVE_ROOT="$REPO_DIR"

echo "Wardrobe: http://127.0.0.1:$PORT/b/"
echo "API upstream: $WARDROBE_API_UPSTREAM"
exec python3 "$REPO_DIR/serve.py"
