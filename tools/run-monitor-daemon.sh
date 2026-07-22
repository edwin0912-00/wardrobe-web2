#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
PRIVATE_DIR="$PROJECT_ROOT/runtime/private"

umask 077
mkdir -p "$PROJECT_ROOT/runtime/logs" "$PROJECT_ROOT/runtime/monitor"

export PATH="/Users/jarvis1/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export MONITOR_PORT="4174"
# Public testing mode. Existing secret files remain untouched for a later
# one-line restoration of the PIN gate.
unset ZEELY_DEMO_PIN ZEELY_SESSION_SECRET ZEELY_COOKIE_SECURE

cd "$PROJECT_ROOT"
exec /opt/homebrew/bin/node src/monitor/start.js
