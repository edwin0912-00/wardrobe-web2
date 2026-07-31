#!/bin/sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BOARD_REPO='edwin0912-00/wardrobe-web2'
BOARD_ISSUE='2'
STATE_SCRIPT="$REPO_DIR/scripts/collab-board-state.mjs"

cd "$REPO_DIR"

agent=$(git config --worktree --get wardrobe.agent 2>/dev/null || true)
if [ -z "$agent" ]; then
  agent=$(git config --get wardrobe.agent 2>/dev/null || true)
fi

require_agent() {
  if [ -z "$agent" ]; then
    echo "no worktree agent identity; run ./scripts/install-collab-hooks.sh codex|claude" >&2
    exit 65
  fi
}

board_json() {
  gh issue view "$BOARD_ISSUE" --repo "$BOARD_REPO" --json number,title,url,comments
}

command=${1:-read}
case "$command" in
  read)
    board_json | node "$STATE_SCRIPT" summary
    echo "board: https://github.com/$BOARD_REPO/issues/$BOARD_ISSUE"
    ;;
  claim)
    require_agent
    lane=${2:-}
    files=${3:-}
    intersects=${4:-}
    if [ -z "$lane" ] || [ -z "$files" ] || [ -z "$intersects" ]; then
      echo 'usage: collab-board.sh claim "lane" "file, path/*" "possible intersection or none"' >&2
      exit 64
    fi
    if ! board_json | WARDROBE_AGENT="$agent" WARDROBE_FILES="$files" node "$STATE_SCRIPT" proposal; then
      echo "claim not posted; coordinate the overlap or narrow the file set" >&2
      exit 66
    fi
    base=$(git rev-parse HEAD)
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    body="<!-- wardrobe-board:v1 -->
ACTION: CLAIM
AGENT: $agent
LANE: $lane
FILES: $files
INTERSECTS: $intersects
BASE: $base
TIME: $now
STATUS: ACTIVE"
    gh issue comment "$BOARD_ISSUE" --repo "$BOARD_REPO" --body "$body"
    ;;
  release)
    require_agent
    sha=${2:-}
    result=${3:-}
    if [ -z "$sha" ] || [ -z "$result" ]; then
      echo 'usage: collab-board.sh release "sha" "result"' >&2
      exit 64
    fi
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    body="<!-- wardrobe-board:v1 -->
ACTION: RELEASE
AGENT: $agent
SHA: $sha
RESULT: $result
TIME: $now
STATUS: RELEASED"
    gh issue comment "$BOARD_ISSUE" --repo "$BOARD_REPO" --body "$body"
    ;;
  abandon)
    require_agent
    result=${2:-abandoned without commit}
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    body="<!-- wardrobe-board:v1 -->
ACTION: ABANDON
AGENT: $agent
RESULT: $result
TIME: $now
STATUS: ABANDONED"
    gh issue comment "$BOARD_ISSUE" --repo "$BOARD_REPO" --body "$body"
    ;;
  check)
    require_agent
    staged=$(git diff --cached --name-only)
    if [ -z "$staged" ]; then
      echo "board check: no staged files"
      exit 0
    fi
    board_json | WARDROBE_AGENT="$agent" WARDROBE_STAGED="$staged" node "$STATE_SCRIPT" check
    ;;
  *)
    echo 'usage: collab-board.sh read|claim|check|release|abandon' >&2
    exit 64
    ;;
esac
