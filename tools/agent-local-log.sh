#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: bash tools/agent-local-log.sh <sync|note> <agent-id> [task-id] --intent TEXT --decision TEXT --risk TEXT --evidence TEXT --next TEXT" >&2
  exit 64
}

mode="${1:-}"
agent_id="${2:-}"
[[ "$mode" == sync || "$mode" == note ]] || usage
[[ "$agent_id" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || usage
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 2
cd "$repo_root"
configured_id="$(git config --local --get wardrobe.agent-id || true)"
[[ "$configured_id" == "$agent_id" ]] || { echo "Run join-beta-agent first for $agent_id." >&2; exit 3; }

local_dir="$repo_root/.agent-local"
journal="$local_dir/$agent_id.md"
mkdir -p "$local_dir"
exclude_file="$(git rev-parse --git-path info/exclude)"
touch "$exclude_file"
grep -qxF '.agent-local/' "$exclude_file" || printf '.agent-local/\n' >> "$exclude_file"
if [[ ! -f "$journal" ]]; then
  cat > "$journal" <<EOF
# Local operational journal — $agent_id

Local only. Never commit this file. Do not write secrets, private media, raw
prompts, hidden model reasoning, or local paths. Use concise work rationale.
EOF
fi

git fetch origin beta --quiet
beta_sha="$(git rev-parse --short origin/beta)"
board_hash="$(git show origin/beta:UPDATE.md | shasum -a 256 | awk '{print $1}')"
if [[ "$mode" == sync ]]; then
  {
    printf '\n## Sync %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf -- '- beta commit: `%s`\n' "$beta_sha"
    printf -- '- UPDATE.md SHA-256: `%s`\n' "$board_hash"
    printf -- '- check: reconcile UPDATE.md, STATE.md, and LOG.md before work.\n'
  } >> "$journal"
  echo "Local journal synced: $journal"
  exit 0
fi

task_id="${3:-}"
[[ -n "$task_id" ]] || usage
shift 3
intent=''; decision=''; risk=''; evidence=''; next=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --intent) intent="${2:-}"; shift 2 ;;
    --decision) decision="${2:-}"; shift 2 ;;
    --risk) risk="${2:-}"; shift 2 ;;
    --evidence) evidence="${2:-}"; shift 2 ;;
    --next) next="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$intent" && -n "$decision" && -n "$risk" && -n "$evidence" && -n "$next" ]] || usage
{
  printf '\n## %s · %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$task_id"
  printf -- '- beta commit: `%s`\n' "$beta_sha"
  printf -- '- intent: %s\n- decision: %s\n- risk/blocker: %s\n- evidence: %s\n- next: %s\n' "$intent" "$decision" "$risk" "$evidence" "$next"
} >> "$journal"
echo "Local journal updated: $journal"
