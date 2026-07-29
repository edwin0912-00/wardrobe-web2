#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: bash tools/join-beta-block-agent.sh <agent-id> <1-7> [--watch]" >&2
  exit 64
}

agent_id="${1:-}"
block_number="${2:-}"
watch_mode="${3:-}"
[[ "$agent_id" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || usage
[[ "$block_number" =~ ^[1-7]$ ]] || usage
[[ -z "$watch_mode" || "$watch_mode" == "--watch" ]] || usage

case "$block_number" in
  1) branch="beta-block-1-core-look"; handoff="docs/coordination/blocks/01-core-look.md" ;;
  2) branch="beta-block-2-profile-ui"; handoff="docs/coordination/blocks/02-profile-ui.md" ;;
  3) branch="beta-block-3-backgrounds"; handoff="docs/coordination/blocks/03-backgrounds.md" ;;
  4) branch="beta-block-4-universe"; handoff="docs/coordination/blocks/04-universe.md" ;;
  5) branch="beta-block-5-fashion-shoot"; handoff="docs/coordination/blocks/05-fashion-shoot.md" ;;
  6) branch="beta-block-6-fashion-video"; handoff="docs/coordination/blocks/06-fashion-video.md" ;;
  7) branch="beta-block-7-realtime-look"; handoff="docs/coordination/blocks/07-realtime-look.md" ;;
esac

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this inside the Wardrobe repository." >&2
  exit 2
}
cd "$repo_root"

[[ -z "$(git status --porcelain)" ]] || {
  echo "Workspace is dirty. Preserve its work before joining a block branch." >&2
  exit 3
}

git fetch origin \
  "+refs/heads/beta:refs/remotes/origin/beta" \
  "+refs/heads/$branch:refs/remotes/origin/$branch" \
  --quiet
if git show-ref --verify --quiet "refs/heads/$branch"; then
  git switch "$branch"
else
  git switch --track -c "$branch" "origin/$branch"
fi
git pull --ff-only origin "$branch"

git config --local wardrobe.agent-id "$agent_id"
git config --local wardrobe.block-number "$block_number"
git config --local user.name "Wardrobe/$agent_id"

hook_path="$(git rev-parse --git-path hooks/commit-msg)"
mkdir -p "$(dirname "$hook_path")"
cat > "$hook_path" <<HOOK
#!/usr/bin/env sh
first_line=\$(sed -n '1p' "\$1")
case "\$first_line" in
  "[agent:$agent_id] [block:$block_number]"*) exit 0 ;;
  *) echo "Commit subject must start: [agent:$agent_id] [block:$block_number]" >&2; exit 1 ;;
esac
HOOK
chmod 755 "$hook_path"

bash tools/agent-local-log.sh sync "$agent_id"

report="updates/chat-$block_number.md"
if [[ ! -f "$report" ]]; then
  {
    printf 'Agent ID: %s\n' "$agent_id"
    printf 'Block: %s\n' "$block_number"
    printf 'Branch: %s\n' "$branch"
    printf 'Task ID: BLOCK-%s-ONBOARDING\n' "$block_number"
    printf 'Commit tested: %s\n' "$(git rev-parse --short HEAD)"
    printf 'Rationale/decision: joined the assigned beta block; no product claim is made by onboarding.\n'
    printf 'Code: NOT_STARTED\nBeta: NOT_DEPLOYED\nJourney: NOT_RUN\n'
    printf 'Evidence command: bash tools/join-beta-block-agent.sh %s %s\n' "$agent_id" "$block_number"
    printf 'weakened_checks: none\nHelp request: NONE\n'
    printf 'Next action: read the block handoff and execute only its first atom.\n'
  } > "$report"
  git add "$report"
  git commit -m "[agent:$agent_id] [block:$block_number] chore: block agent online"
  git push origin "$branch"
fi

echo "ONLINE: $agent_id"
echo "Block: $block_number"
echo "Branch: $branch"
echo "Handoff: $handoff"
sed -n '1,220p' AGENTS.md
sed -n '1,260p' docs/coordination/BETA_BLOCKS_2026-07-29.md
sed -n '1,220p' "$handoff"

if [[ "$watch_mode" == "--watch" ]]; then
  exec bash tools/watch-beta-blocks.sh "$agent_id"
fi
