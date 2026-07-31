#!/usr/bin/env bash
# Deliberately conservative deploy helper. Run only from a clean checkout of
# main after scripts/preflight-site.mjs has passed against the candidate host.
set -euo pipefail

if [[ "${1:-}" != "--commit" || -z "${2:-}" ]]; then
  echo "Usage: $0 --commit <exact-main-sha>" >&2
  exit 64
fi

deploy_sha="$2"
repo_root="$(git rev-parse --show-toplevel)"
runtime_root="/Users/jarvis1/Library/Application Support/WardrobeRuntime"

[[ "$(git -C "$repo_root" branch --show-current)" == "main" ]] || {
  echo "Refusing: deployment must start from main, not $(git -C "$repo_root" branch --show-current)" >&2; exit 65;
}
[[ -z "$(git -C "$repo_root" status --porcelain)" ]] || {
  echo "Refusing: main checkout is dirty" >&2; exit 66;
}
[[ "$(git -C "$repo_root" rev-parse HEAD)" == "$deploy_sha" ]] || {
  echo "Refusing: supplied SHA is not checked-out main HEAD" >&2; exit 67;
}
[[ -d "$runtime_root" ]] || { echo "Refusing: persistent runtime not found" >&2; exit 68; }

# This is the only destructive operation: an exact, prevalidated main tree
# replaces the known persistent runtime. No globs, variables or broad home
# directory targets are used.
rsync -a --delete "$repo_root/" "$runtime_root/" --exclude '.git' --exclude '.gitignore'
printf 'deployed %s to %s\n' "$deploy_sha" "$runtime_root"
