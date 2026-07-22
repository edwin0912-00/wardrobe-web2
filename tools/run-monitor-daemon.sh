#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
PRIVATE_DIR="$PROJECT_ROOT/runtime/private"

umask 077
mkdir -p "$PROJECT_ROOT/runtime/logs" "$PROJECT_ROOT/runtime/monitor"

if [[ ! -s "$PRIVATE_DIR/demo-pin" || ! -s "$PRIVATE_DIR/session-secret" ]]; then
  print -u2 "Core web secrets must exist before monitor starts"
  exit 1
fi

export PATH="/Users/jarvis1/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export MONITOR_PORT="4174"
export ZEELY_DEMO_PIN="$(/usr/bin/tr -d '\n' < "$PRIVATE_DIR/demo-pin")"
export ZEELY_SESSION_SECRET="$(/usr/bin/tr -d '\n' < "$PRIVATE_DIR/session-secret")"
export ZEELY_COOKIE_SECURE="true"

cd "$PROJECT_ROOT"
exec /opt/homebrew/bin/node src/monitor/start.js
