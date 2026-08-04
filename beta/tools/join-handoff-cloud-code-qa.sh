#!/usr/bin/env bash
set -euo pipefail

agent_id="${1:-handoff-cloud-code-qa}"
watch_mode="${2:-}"
[[ "$agent_id" == "handoff-cloud-code-qa" ]] || {
  echo "This observer must use the exact ID: handoff-cloud-code-qa" >&2
  exit 64
}
[[ -z "$watch_mode" || "$watch_mode" == "--watch" ]] || exit 64

branch="beta-block-09-handoff-cloud-code-qa"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this inside the Wardrobe repository." >&2
  exit 2
}
cd "$repo_root"
[[ -z "$(git status --porcelain)" ]] || {
  echo "Workspace is dirty. Preserve its work before joining QA." >&2
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
git config --local wardrobe.block-number "0.9"
git config --local user.name "Wardrobe/$agent_id"

hook_path="$(git rev-parse --git-path hooks/commit-msg)"
mkdir -p "$(dirname "$hook_path")"
cat > "$hook_path" <<HOOK
#!/usr/bin/env sh
first_line=\$(sed -n '1p' "\$1")
case "\$first_line" in
  "[agent:$agent_id] [qa]"*) exit 0 ;;
  *) echo "Commit subject must start: [agent:$agent_id] [qa]" >&2; exit 1 ;;
esac
HOOK
chmod 755 "$hook_path"

bash tools/agent-local-log.sh sync "$agent_id"
echo "ONLINE: $agent_id"
echo "Role: Observer 0.9 external public-beta QA"
echo "Branch: $branch"
sed -n '1,180p' AGENTS.md
sed -n '1,240p' docs/coordination/blocks/09-handoff-cloud-code-qa.md

if [[ "$watch_mode" == "--watch" ]]; then
  watch_dir=".agent-local/handoff-cloud-code-qa"
  watch_log="$watch_dir/watch.log"
  watch_pid_file="$watch_dir/watch.pid"
  mkdir -p "$watch_dir"
  running_pid=''
  [[ -f "$watch_pid_file" ]] && running_pid="$(sed -n '1p' "$watch_pid_file")"
  if [[ "$running_pid" =~ ^[0-9]+$ ]] && kill -0 "$running_pid" 2>/dev/null; then
    echo "GitHub watcher already running: PID $running_pid"
  else
    nohup bash tools/watch-beta-blocks.sh "$agent_id" \
      >"$watch_log" 2>&1 </dev/null &
    running_pid="$!"
    printf '%s\n' "$running_pid" >"$watch_pid_file"
    echo "GitHub watcher started: PID $running_pid"
  fi
  echo "Watcher log: $watch_log"
fi
