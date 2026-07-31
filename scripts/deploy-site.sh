#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME_DIR='/Users/jarvis1/Library/Application Support/WardrobeRuntime'
BACKUP_BASE='/Users/jarvis1/.local/share/madeforthisjob/app/runtime/backups'
PUBLIC_ORIGIN='https://site.madeforthisjob.com'
EXPECTED_UPSTREAM='origin/canonical-site-main'

cd "$REPO_DIR"

upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
if [ "$upstream" != "$EXPECTED_UPSTREAM" ]; then
  echo "refusing deploy: upstream is ${upstream:-none}, expected $EXPECTED_UPSTREAM" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing deploy: worktree is dirty" >&2
  exit 1
fi

git fetch origin canonical-site-main
local_head=$(git rev-parse HEAD)
remote_head=$(git rev-parse origin/canonical-site-main)
if [ "$local_head" != "$remote_head" ]; then
  echo "refusing deploy: local HEAD is not origin/canonical-site-main" >&2
  exit 1
fi

./scripts/site-preflight.sh

if [ ! -d "$RUNTIME_DIR/b" ]; then
  echo "refusing deploy: runtime directory is missing" >&2
  exit 1
fi

stamp=$(date +%Y%m%d-%H%M%S)
backup_dir="$BACKUP_BASE/WardrobeRuntime-pre-$local_head-$stamp"
mkdir -p "$backup_dir"
/bin/cp -Rp "$RUNTIME_DIR/." "$backup_dir/"

/usr/bin/rsync -a \
  --exclude '.git' \
  --exclude '.gitignore' \
  --exclude '.DS_Store' \
  "$REPO_DIR/" "$RUNTIME_DIR/"

# `serve.py` is also the same-origin /api gateway. Static bytes update on the
# next request, but Python code does not; restart only this launchd job so the
# exact committed gateway and Range implementation become active together.
/bin/launchctl kickstart -k "gui/$(id -u)/com.madeforthisjob.web2"

/usr/bin/cmp "$REPO_DIR/b/index.html" "$RUNTIME_DIR/b/index.html"
/usr/bin/cmp "$REPO_DIR/engine.js" "$RUNTIME_DIR/engine.js"
/usr/bin/cmp "$REPO_DIR/ui.js" "$RUNTIME_DIR/ui.js"
/usr/bin/cmp "$REPO_DIR/style.css" "$RUNTIME_DIR/style.css"
/usr/bin/cmp "$REPO_DIR/screen-surfaces.js" "$RUNTIME_DIR/screen-surfaces.js"
/usr/bin/cmp "$REPO_DIR/serve.py" "$RUNTIME_DIR/serve.py"
/usr/bin/cmp "$REPO_DIR/adapters/zeely-client.mjs" "$RUNTIME_DIR/adapters/zeely-client.mjs"
/usr/bin/cmp "$REPO_DIR/adapters/cinematic-ui-bridge.mjs" "$RUNTIME_DIR/adapters/cinematic-ui-bridge.mjs"

attempt=0
until /usr/bin/curl -fsS -o /dev/null "http://127.0.0.1:4180/b/"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then
    echo "deploy failed: site service did not become ready" >&2
    exit 1
  fi
  /bin/sleep 1
done
/usr/bin/curl -fsS -r 0-1023 -o /dev/null "http://127.0.0.1:4180/b/assets/seg1.mp4"
/usr/bin/curl -fsS -o /dev/null "$PUBLIC_ORIGIN/b/"
/usr/bin/curl -fsS -r 0-1023 -o /dev/null "$PUBLIC_ORIGIN/b/assets/seg1.mp4"
/usr/bin/curl -fsS -o /dev/null "http://127.0.0.1:4180/api/health"
/usr/bin/curl -fsS -o /dev/null "$PUBLIC_ORIGIN/api/health"

echo "deployed $local_head"
echo "backup: $backup_dir"
echo "public: $PUBLIC_ORIGIN/"
