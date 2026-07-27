#!/usr/bin/env bash
set -euo pipefail

agent_id="${1:-}"
mode="${2:-}"
[[ "$agent_id" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || {
  echo "Usage: bash tools/watch-beta-board.sh <agent-id> [--once]" >&2
  exit 64
}
[[ -z "$mode" || "$mode" == "--once" ]] || exit 64
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 2
cd "$repo_root"
[[ "$(git config --local --get wardrobe.agent-id || true)" == "$agent_id" ]] || exit 3

render_once() {
  git fetch origin beta --quiet
  board="$(git show origin/beta:UPDATE.md)"
  printf '\033c'
  printf 'Wardrobe beta live board · observer: %s · %s\n\n' "$agent_id" "$(date '+%Y-%m-%d %H:%M:%S')"
  git log --oneline -12 origin/beta
  printf '\n%s\n' "$board"
  printf '\n--- monitor alerts ---\n'
  printf '%s\n' "$board" | awk -F'|' '
    $4 ~ /IN_PROGRESS/ && $5 ~ /CODE/ && $6 !~ /^[[:space:]]*$/ {
      paths=$6; gsub(/`/, "", paths)
      split(paths, parts, ";")
      for (index in parts) {
        path=parts[index]; gsub(/^[[:space:]]+|[[:space:]]+$/, "", path)
        if (path == "") continue
        if (seen[path] && seen[path] != $2) overlap=1
        seen[path]=$2
      }
    }
    END {
      if (overlap) print "ALERT: two active CODE tasks reserve the same path"
      if (!overlap) print "No active code-path collision detected."
    }'
  help_found=0
  while IFS= read -r report; do
    request="$(git show "origin/beta:$report" 2>/dev/null | sed -n 's/^Help request: //p' | head -1)"
    if [[ -n "$request" && "$request" != "NONE" ]]; then
      printf 'HELP %s — %s\n' "$report" "$request"
      help_found=1
    fi
  done < <(git ls-tree -r --name-only origin/beta updates | grep -E '^updates/[^/]+\.md$' || true)
  [[ "$help_found" == 1 ]] || printf 'No agent help request.\n'
}

while true; do
  render_once
  [[ "$mode" == "--once" ]] && exit 0
  sleep 20
done
