#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
agent=${1:-}
case "$agent" in
  codex|claude|release) ;;
  *) echo 'usage: install-collab-hooks.sh codex|claude|release' >&2; exit 64 ;;
esac

cd "$REPO_DIR"
git config extensions.worktreeConfig true
git config --worktree wardrobe.agent "$agent"
git config --worktree core.hooksPath "$REPO_DIR/.githooks"

echo "installed collaboration hook for $agent in $REPO_DIR"
git config --worktree --get core.hooksPath
