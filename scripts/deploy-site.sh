#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_DIR"

RUNTIME_ROOT=${WARDROBE_RUNTIME_ROOT:-"${HOME:?HOME is required}/Library/Application Support/WardrobeRuntime"}
VERSIONS_ROOT=${WARDROBE_SITE_VERSIONS_ROOT:-"${RUNTIME_ROOT}.releases"}
SITE_ORIGIN=${WARDROBE_SITE_ORIGIN:-'https://site.madeforthisjob.com'}
LOCAL_ORIGIN=${WARDROBE_SITE_LOCAL_ORIGIN:-'http://127.0.0.1:4180'}
SITE_LABEL=${WARDROBE_SITE_LABEL:-'com.madeforthisjob.web2'}
PYTHON_BIN=${WARDROBE_PYTHON:-'python3'}
GIT_BIN=${WARDROBE_GIT:-'git'}

: "${WARDROBE_BETA_RUNNER:?set WARDROBE_BETA_RUNNER to the configured beta runner path}"
SITE_PLIST=${WARDROBE_SITE_PLIST:-"${HOME:?HOME is required}/Library/LaunchAgents/${SITE_LABEL}.plist"}
BETA_PLIST=${WARDROBE_BETA_PLIST:-"${HOME:?HOME is required}/Library/LaunchAgents/com.madeforthisjob.beta.plist"}

branch=$("$GIT_BIN" branch --show-current)
if [ "$branch" != 'alpha' ]; then
  echo "refusing deploy: branch is $branch, expected alpha" >&2
  exit 1
fi

upstream=$("$GIT_BIN" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
if [ "$upstream" != 'origin/alpha' ]; then
  echo "refusing deploy: upstream is ${upstream:-none}, expected origin/alpha" >&2
  exit 1
fi

if [ -n "$("$GIT_BIN" status --porcelain)" ]; then
  echo "refusing deploy: worktree is dirty" >&2
  exit 1
fi

"$GIT_BIN" fetch origin alpha
local_head=$("$GIT_BIN" rev-parse HEAD)
remote_head=$("$GIT_BIN" rev-parse origin/alpha)
if [ "$local_head" != "$remote_head" ]; then
  echo "refusing deploy: local HEAD is not origin/alpha" >&2
  exit 1
fi

./verify quick
./scripts/site-preflight.sh

"$PYTHON_BIN" scripts/site-release.py deploy \
  --repo-root "$REPO_DIR" \
  --runtime-root "$RUNTIME_ROOT" \
  --versions-root "$VERSIONS_ROOT" \
  --source-commit "$local_head" \
  --site-plist "$SITE_PLIST" \
  --site-label "$SITE_LABEL" \
  --beta-plist "$BETA_PLIST" \
  --beta-runner "$WARDROBE_BETA_RUNNER" \
  --local-origin "$LOCAL_ORIGIN" \
  --public-origin "$SITE_ORIGIN"
