Agent role: CHAT 05 — Video Block
Thread: 019faf52-0a8b-7de0-a123-7cea87d3124b
Compatibility branch: beta-block-6-fashion-video
Task: executable Fashion Video runtime and one controlled real clip
Base: 0b788bd13c569e850482bb664ba1ca28f4a25b9d
Rationale/decision: VideoService remains the single profile HTTP execution path. The runtime now constructs the dedicated Higgsfield video provider plus the OpenRouter fallback router, supplies authenticated/size-bounded MP4 download and real ffprobe/frame extraction, and exposes an explicit resume/finalize route that never creates a second paid job.
Code: ACTIVE — runtime/finalizer commit da407ac707f8001d9a7f3165dd73847d012e394f plus current immutable source/create-receipt worktree.
Beta: NOT_DEPLOYED
Journey: NOT_RUN — controlled provider run follows this code commit.
Evidence command: node --test test/video/video-service.test.js test/video/video-routes.test.js test/video/video-runtime.test.js test/video/higgsfield-video-provider.test.js test/video/video-provider-router.test.js
Evidence result: PASS 42/42. Before paid create, VideoService copies the exact source into clip ownership, hashes it, persists SUBMITTING, then writes create-receipt.json with wx semantics and its SHA-256 after receiving the provider job ID.
Source candidate: persisted run 7ebf5b2e-be9f-4869-bca6-33a69fe173d9; COMPLETED; avatar/outfit QA PASS; avatar_outfit SHA-256 17bf6f2b518534784ccbb0e27fb7a002e09c44258a23915badce21a7be403579. It is half-body, so only editorial_micro_moment is permitted.
Integration wiring handoff: replace the image provider passed to VideoService in src/web/start.js with createVideoRuntime({ runtimeRoot, openRouterApiKey: process.env.OPENROUTER_API_KEY, assetUrlResolver }); pass the returned videoService to createWebApp. The OpenRouter resolver must produce a short-lived private HTTPS first-frame URL; no local path may leave the host.
weakened_checks: none
Next action: commit/push this runtime atom, then run exactly one controlled Higgsfield Seedance editorial_micro_moment and record immutable provider/MP4/QA evidence.
