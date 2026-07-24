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

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export PORT="4173"
# Codex CLI's ChatGPT-authenticated session hit its usage limit (resets
# 2026-07-28). Avatar/outfit/garment/scene generation and semantic QA now run
# through OpenRouter instead of the local Codex app-server worker/CLI. Set
# ZEELY_GENERATION_PROVIDER/ZEELY_VLM_PROVIDER back to codex-imagegen-test /
# codex (or higgsfield) to restore the previous transport; nothing about
# those paths was removed, this is a plain switch.
export ZEELY_GENERATION_PROVIDER="openrouter"
export ZEELY_VLM_PROVIDER="openrouter"
if [[ -s "$PRIVATE_DIR/openrouter-api-key" ]]; then
  OPENROUTER_API_KEY="$(cat "$PRIVATE_DIR/openrouter-api-key")"
  export OPENROUTER_API_KEY
fi
# Public testing mode: keep the existing secrets on disk so PIN protection can
# be restored without rotating credentials, but do not enable the auth gate.
unset ZEELY_DEMO_PIN ZEELY_SESSION_SECRET ZEELY_COOKIE_SECURE

cd "$PROJECT_ROOT"
exec /opt/homebrew/bin/node src/web/start.js
