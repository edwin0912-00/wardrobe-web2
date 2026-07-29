#!/bin/bash
set -e

cd /Users/airliner/wardrobe-antigravity-20260727-fb7a90

echo "========================================"
echo "  Step 1: Unit Tests"
echo "========================================"
node --test \
  test/video/higgsfield-video-provider.test.js \
  test/video/video-motion-plan.test.js \
  test/video/video-clip-qa.test.js \
  test/video/video-service.test.js \
  test/video/ffprobe-video-probe.test.js

echo ""
echo "========================================"
echo "  Step 2: Integration Test (no server)"
echo "========================================"
node tools/test-video-pipeline.mjs

echo ""
echo "========================================"
echo "  Step 3: Git commit & push"
echo "========================================"
git add \
  src/web/video-motion-plan.js \
  src/web/video-clip-qa.js \
  src/web/video-contract.js \
  src/web/video-service.js \
  src/web/ffprobe-video-probe.js \
  src/web/profile-service.js \
  test/video/ \
  tools/test-video-pipeline.mjs

git status --short

git commit -m '[agent:antigravity-20260727-fb7a90] feat(video): ffprobe probe, profile video_clips, integration test — full pipeline'

git push origin beta

echo ""
echo "✅ Done. All tests green, committed and pushed."
