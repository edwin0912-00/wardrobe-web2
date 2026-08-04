#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
PRIVATE_DIR="$PROJECT_ROOT/runtime/private"

umask 077
mkdir -p "$PRIVATE_DIR" "$PROJECT_ROOT/runtime/logs" "$PROJECT_ROOT/runtime/monitor"

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export MONITOR_PORT="4174"
export ZEELY_RUNTIME_ROOT="${ZEELY_RUNTIME_ROOT:-$PROJECT_ROOT/runtime}"
export ZEELY_APP_HEALTH_URL="${ZEELY_APP_HEALTH_URL:-http://127.0.0.1:4173/api/health}"
if [[ -s "$PRIVATE_DIR/source-root" ]]; then
  export ZEELY_SOURCE_ROOT="$(<"$PRIVATE_DIR/source-root")"
  export ZEELY_SUPERVISOR_AGENT="${ZEELY_SUPERVISOR_AGENT:-true}"
else
  export ZEELY_SOURCE_ROOT="$PROJECT_ROOT"
  export ZEELY_SUPERVISOR_AGENT="${ZEELY_SUPERVISOR_AGENT:-false}"
fi
# Public testing mode. Existing secret files remain untouched for a later
# one-line restoration of the PIN gate.
unset ZEELY_DEMO_PIN ZEELY_SESSION_SECRET ZEELY_COOKIE_SECURE

cd "$PROJECT_ROOT"
exec /opt/homebrew/bin/node src/monitor/start.js
