#!/usr/bin/env bash
set -euo pipefail

agent_id="${1:-}"
mode="${2:-}"
[[ "$agent_id" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || {
  echo "Usage: bash tools/watch-beta-blocks.sh <agent-id> [--once]" >&2
  exit 64
}
[[ -z "$mode" || "$mode" == "--once" ]] || exit 64

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 2
cd "$repo_root"

branches=(
  beta-block-1-core-look
  beta-block-2-profile-ui
  beta-block-3-backgrounds
  beta-block-4-universe
  beta-block-5-fashion-shoot
  beta-block-6-fashion-video
  beta-block-7-realtime-look
)

render_once() {
  fetch_refspecs=("+refs/heads/beta:refs/remotes/origin/beta")
  for branch in "${branches[@]}"; do
    fetch_refspecs+=("+refs/heads/$branch:refs/remotes/origin/$branch")
  done
  git fetch origin "${fetch_refspecs[@]}" --quiet
  printf '\033c'
  printf 'Wardrobe beta blocks · observer: %s · %s\n\n' "$agent_id" "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'Integration beta: %s\n' "$(git log -1 --format='%h %s' origin/beta)"
  printf 'Board SHA-256: %s\n\n' "$(git show origin/beta:UPDATE.md | shasum -a 256 | awk '{print $1}')"

  for block_index in {1..7}; do
    branch="${branches[$((block_index - 1))]}"
    ref="origin/$branch"
    printf 'Block %s · %s\n' "$block_index" "$(git log -1 --format='%h %s' "$ref")"
    if git merge-base --is-ancestor "$ref" origin/beta; then
      printf '  integration: already contained in beta\n'
    else
      printf '  integration: branch has commits not yet in beta\n'
    fi
    report="updates/chat-$block_index.md"
    if git cat-file -e "$ref:$report" 2>/dev/null; then
      git show "$ref:$report" | tail -14 | sed 's/^/  /'
    else
      printf '  report: not online yet\n'
    fi
    printf '\n'
  done

  printf 'Current assignments from beta:\n'
  git show origin/beta:UPDATE.md | sed -n '/## Seven beta block branches/,/## /p' | sed -n '1,180p'
}

while true; do
  render_once
  [[ "$mode" == "--once" ]] && exit 0
  sleep 20
done
