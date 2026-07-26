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
# 2026-07-28), so every VLM call — semantic QA and garment classification —
# goes through OpenRouter instead of the local Codex CLI. Set
# ZEELY_VLM_PROVIDER=codex to restore that transport; nothing was removed.
#
# Image GENERATION also runs through OpenRouter. Both other transports are
# unavailable, and each failed differently rather than gracefully:
#   codex-imagegen-test — ChatGPT session hit its usage limit (resets 2026-07-28)
#   higgsfield          — api.higgsfield.ai returned 521 (provider outage)
# The Higgsfield outage additionally blocked promotion twice, because the
# higgsfield preflight branch polls the account over the network and a dead
# provider is then indistinguishable from a broken release. The openrouter
# branch in src/web/preflight.js checks only that OPENROUTER_API_KEY is present
# and makes no network call, so a provider outage degrades individual jobs
# instead of preventing the service from booting.
# To switch back: set this to higgsfield (or codex-imagegen-test) — neither
# path was removed.
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
