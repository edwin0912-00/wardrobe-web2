#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: bash tools/join-beta-agent.sh <agent-id> [--watch]" >&2
  exit 64
}

agent_id="${1:-}"
watch_mode="${2:-}"
[[ "$agent_id" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || usage
[[ -z "$watch_mode" || "$watch_mode" == "--watch" ]] || usage

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this from a clone of zeely-ai-engineering-test." >&2
  exit 2
}
cd "$repo_root"

existing_id="$(git config --local --get wardrobe.agent-id || true)"
if [[ -n "$existing_id" && "$existing_id" != "$agent_id" ]]; then
  echo "This clone is already assigned to agent: $existing_id" >&2
  exit 3
fi

git fetch origin beta --quiet
git switch beta
git pull --ff-only origin beta

git config --local wardrobe.agent-id "$agent_id"
git config --local user.name "Wardrobe/$agent_id"

hook_path="$(git rev-parse --git-path hooks/commit-msg)"
mkdir -p "$(dirname "$hook_path")"
cat > "$hook_path" <<HOOK
#!/usr/bin/env sh
first_line=\$(sed -n '1p' "\$1")
case "\$first_line" in
  "[agent:$agent_id]"*) exit 0 ;;
  *) echo "Commit subject must start: [agent:$agent_id]" >&2; exit 1 ;;
esac
HOOK
chmod 755 "$hook_path"

bash tools/agent-local-log.sh sync "$agent_id"

echo "Agent ID: $agent_id"
echo "Branch: $(git branch --show-current)"
echo "Read now: AGENTS.md, UPDATE.md, STATE.md"
sed -n '1,90p' AGENTS.md
sed -n '1,160p' UPDATE.md

if [[ "$watch_mode" != "--watch" ]]; then
  exit 0
fi

while true; do
  git fetch origin beta --quiet
  printf '\033c'
  echo "Wardrobe beta board · agent: $agent_id · $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  git log --oneline -12 origin/beta
  echo
  git show origin/beta:UPDATE.md
  sleep 20
done
