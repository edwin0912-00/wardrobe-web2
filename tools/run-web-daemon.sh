#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
PRIVATE_DIR="$PROJECT_ROOT/runtime/private"

umask 077
mkdir -p "$PRIVATE_DIR" "$PROJECT_ROOT/runtime/logs"

if [[ ! -s "$PRIVATE_DIR/demo-pin" ]]; then
  /usr/bin/jot -r 1 100000 999999 > "$PRIVATE_DIR/demo-pin"
fi
if [[ ! -s "$PRIVATE_DIR/session-secret" ]]; then
  /usr/bin/openssl rand -hex 32 > "$PRIVATE_DIR/session-secret"
fi

export PATH="/Users/jarvis1/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PORT="4173"
export ZEELY_DEMO_PIN="$(/usr/bin/tr -d '\n' < "$PRIVATE_DIR/demo-pin")"
export ZEELY_SESSION_SECRET="$(/usr/bin/tr -d '\n' < "$PRIVATE_DIR/session-secret")"
export ZEELY_COOKIE_SECURE="true"

cd "$PROJECT_ROOT"
exec /opt/homebrew/bin/node src/web/start.js
