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
export ZEELY_PUBLIC_HTTPS_ORIGIN="https://site.madeforthisjob.com"
# Codex Worker is the primary image/scene transport. The web process keeps the
# guarded OpenRouter image/scene fallback and the explicit OpenRouter video
# adapter; no Higgsfield or local CLI provider is constructed at startup.
export ZEELY_GENERATION_PROVIDER="codex-primary"
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
