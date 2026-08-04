#!/usr/bin/env bash
set -euo pipefail
export WARDROBE_AGENT_LABEL=opencloud
exec bash <(gh api -H 'Accept: application/vnd.github.raw' 'repos/edwin0912-00/zeely-ai-engineering-test/contents/tools/bootstrap-beta-agent.sh?ref=beta') --watch
