#!/usr/bin/env bash
set -euo pipefail

repository="edwin0912-00/zeely-ai-engineering-test"
watch_mode=""
dry_run="false"
recover_from=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch) watch_mode="--watch" ;;
    --dry-run) dry_run="true" ;;
    --recover-from)
      recover_from="${2:-}"
      [[ -n "$recover_from" ]] || { echo "--recover-from requires an existing workspace path" >&2; exit 64; }
      shift
      ;;
    *) echo "Usage: bash bootstrap-beta-agent.sh [--watch] [--dry-run] [--recover-from <workspace>]" >&2; exit 64 ;;
  esac
  shift
done
command -v gh >/dev/null 2>&1 || {
  echo "Install GitHub CLI (gh), then run this command again." >&2
  exit 2
}
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth setup-git

suffix="$(openssl rand -hex 3 2>/dev/null || date -u +%H%M%S)"
agent_label="${WARDROBE_AGENT_LABEL:-agent}"
[[ "$agent_label" =~ ^[a-z0-9][a-z0-9-]{1,18}$ ]] || {
  echo "WARDROBE_AGENT_LABEL must match [a-z0-9][a-z0-9-]{1,18}" >&2
  exit 64
}
agent_id="${WARDROBE_AGENT_ID:-$agent_label-$(date -u +%Y%m%d)-$suffix}"
[[ "$agent_id" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || {
  echo "WARDROBE_AGENT_ID must match [a-z0-9][a-z0-9-]{1,30}" >&2
  exit 64
}
workspace="${WARDROBE_AGENT_WORKSPACE:-$PWD/wardrobe-$agent_id}"
[[ ! -e "$workspace" ]] || {
  echo "Workspace already exists: $workspace" >&2
  exit 3
}

recovery_tmp=""
source_workspace=""
source_status=""
if [[ -n "$recover_from" ]]; then
  source_workspace="$(cd "$recover_from" && pwd)" || {
    echo "Recovery workspace is not accessible: $recover_from" >&2
    exit 5
  }
  git -C "$source_workspace" rev-parse --show-toplevel >/dev/null 2>&1 || {
    echo "Recovery workspace is not a Git repository: $source_workspace" >&2
    exit 5
  }
  source_remote="$(git -C "$source_workspace" remote get-url origin 2>/dev/null || true)"
  [[ "$source_remote" == *"$repository"* ]] || {
    echo "Recovery workspace origin does not match $repository; refusing to mix projects." >&2
    exit 5
  }
  recovery_tmp="$(mktemp -d)"
  trap '[[ -n "$recovery_tmp" ]] && rm -rf "$recovery_tmp"' EXIT
  git -C "$source_workspace" status --short > "$recovery_tmp/status.txt"
  git -C "$source_workspace" diff --binary HEAD > "$recovery_tmp/tracked.patch"
  git -C "$source_workspace" rev-parse HEAD > "$recovery_tmp/source-head.txt"
  source_status="$(cat "$recovery_tmp/status.txt")"
fi

git clone --branch beta --single-branch "https://github.com/$repository.git" "$workspace"
cd "$workspace"
bash tools/join-beta-agent.sh "$agent_id"
test -f START_HERE.md && cp START_HERE.md .agent-local/HELP.md

if [[ -n "$source_workspace" ]]; then
  rescue_workspace="${workspace}-rescue"
  rescue_branch="recovery/${agent_id}-$(date -u +%Y%m%d%H%M%S)"
  git worktree add -b "$rescue_branch" "$rescue_workspace" beta >/dev/null
  mkdir -p "$rescue_workspace/.recovery"
  cp "$recovery_tmp/status.txt" "$rescue_workspace/.recovery/original-status.txt"
  cp "$recovery_tmp/source-head.txt" "$rescue_workspace/.recovery/original-head.txt"
  cp "$recovery_tmp/tracked.patch" "$rescue_workspace/.recovery/tracked-changes.patch"
  if [[ -s "$recovery_tmp/tracked.patch" ]]; then
    if git -C "$rescue_workspace" apply --3way "$recovery_tmp/tracked.patch"; then
      tracked_result="applied as uncommitted changes"
    else
      tracked_result="not applied automatically; patch preserved at .recovery/tracked-changes.patch"
    fi
  else
    tracked_result="none"
  fi
  mkdir -p "$rescue_workspace/.recovery/untracked"
  while IFS= read -r -d '' relative_path; do
    mkdir -p "$rescue_workspace/.recovery/untracked/$(dirname "$relative_path")"
    cp -a "$source_workspace/$relative_path" "$rescue_workspace/.recovery/untracked/$relative_path"
  done < <(git -C "$source_workspace" ls-files --others --exclude-standard -z)
  if [[ -d "$source_workspace/.agent-local" ]]; then
    cp -a "$source_workspace/.agent-local" "$rescue_workspace/.recovery/local-journal"
  fi
  printf '%s\n' "Source workspace: $source_workspace" "Source beta/base: $(cat "$recovery_tmp/source-head.txt")" "Tracked recovery: $tracked_result" "Untracked source files are preserved under .recovery/untracked/; local journal under .recovery/local-journal/." > "$rescue_workspace/.recovery/README.txt"
  echo "RECOVERY PRESERVED: $rescue_workspace"
  echo "RECOVERY BRANCH: $rescue_branch"
  echo "RECOVERY TRACKED CHANGES: $tracked_result"
  [[ -n "$source_status" ]] && echo "RECOVERY SOURCE STATUS WAS NOT CLEAN. Inspect rescue before using it."
fi

# A fresh chat has no conversation memory. Print the canonical recovery pack
# from beta itself before the agent can take a task. These are policy and state
# documents only; credentials and personal media are intentionally excluded.
echo
echo "=== WARDROBE CONTEXT RECOVERY · $agent_id · $(git rev-parse --short HEAD) ==="
for context_file in USERS.md AGENTS.md UPDATE.md PIPELINE.md docs/VIDEO_LIVE_CANON_UA.md STATE.md LOG.md OWNERS.md; do
  [[ -f "$context_file" ]] || continue
  echo
  echo "===== $context_file ====="
  case "$context_file" in
    AGENTS.md) sed -n '1,260p' "$context_file" ;;
    UPDATE.md) sed -n '1,260p' "$context_file" ;;
    PIPELINE.md) sed -n '1,320p' "$context_file" ;;
    docs/VIDEO_LIVE_CANON_UA.md) sed -n '1,300p' "$context_file" ;;
    STATE.md|LOG.md) sed -n '1,260p' "$context_file" ;;
    *) cat "$context_file" ;;
  esac
done
echo "=== END WARDROBE CONTEXT RECOVERY ==="

initial_commit="$(git rev-parse --short HEAD)"
bash tools/agent-local-log.sh note "$agent_id" ONBOARDING \
  --intent "join the shared beta workflow" \
  --decision "start read-only until the board assigns a task" \
  --risk "no product change is authorized during onboarding" \
  --evidence "bootstrap completed at beta $initial_commit" \
  --next "monitor UPDATE.md and wait for an assignment"

mkdir -p updates
cat > "updates/$agent_id.md" <<EOF
Agent ID: $agent_id
Task ID: ONBOARDING
Commit tested: $initial_commit
Rationale/decision: joined beta; no product task starts before board assignment.
Result: ONLINE
Evidence command: tools/bootstrap-beta-agent.sh
Help request: NONE
Next action: monitoring UPDATE.md for an assigned task.
EOF
if [[ "$dry_run" == "true" ]]; then
  echo "DRY RUN READY: $agent_id"
  echo "Workspace: $workspace"
  exit 0
fi
git add "updates/$agent_id.md"
git commit -m "[agent:$agent_id] chore: agent online"
for attempt in 1 2 3; do
  git pull --rebase origin beta
  if git push origin beta; then
    break
  fi
  [[ "$attempt" == 3 ]] && {
    echo "Online report could not be pushed after three attempts." >&2
    exit 4
  }
done

echo "ONLINE: $agent_id"
echo "Workspace: $workspace"
echo "Shared board: https://github.com/$repository/blob/beta/UPDATE.md"
if [[ "$watch_mode" == "--watch" ]]; then
  exec bash tools/watch-beta-board.sh "$agent_id"
fi
