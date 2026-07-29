Agent role: CHAT 05 — Video Block
Thread: 019faf52-0a8b-7de0-a123-7cea87d3124b
Compatibility branch: beta-block-6-fashion-video
Task: executable Fashion Video runtime and one controlled real clip
Base: 0b788bd13c569e850482bb664ba1ca28f4a25b9d
Rationale/decision: VideoService remains the single profile HTTP execution path. The runtime constructs Higgsfield plus the three-attempt OpenRouter fallback router, supplies authenticated/size-bounded MP4 download and real ffprobe/frame extraction, and exposes resume/finalize without creating a second paid job. Higgsfield CLI 0.2.3 returned a batched create response, so the adapter now resolves job IDs from both object and array envelopes. A strict recovery path binds an orphaned SUBMITTING clip only when provider prompt/aspect/duration/model exactly match. Semantic first/last-frame QA is persisted as an immutable receipt and overrides technical MP4 PASS.
Code: ACTIVE — commits da407ac707f8001d9a7f3165dd73847d012e394f and 78bf5b77f1425e845f57d0600378bb621c195be6 plus current recovery/FPS/semantic-QA atom.
Beta: NOT_DEPLOYED
Journey: CONTROLLED_LOCAL_RUN_COMPLETE — real provider output persisted; final semantic status FAIL, therefore not eligible for beta delivery.
Evidence command: node --test test/video/*.test.js
Evidence result: PASS 97/97.
Source candidate: persisted run 7ebf5b2e-be9f-4869-bca6-33a69fe173d9; COMPLETED; avatar/outfit QA PASS; avatar_outfit SHA-256 17bf6f2b518534784ccbb0e27fb7a002e09c44258a23915badce21a7be403579. It is half-body, so only editorial_micro_moment is permitted.
Provider evidence: Higgsfield / seedance_2_0, create attempt 1, fallback false, job 1c38704e-8324-40cd-b6d9-f03783982184. Request: editorial_micro_moment, mirror 9:16, 5 seconds, 720p, audio false. Immutable create receipt SHA-256 501cefac05b73241245a5a71a3b657fb14fc7973884f5a8ad1541b1bee43a0f3.
MP4 evidence: runtime/controlled-fashion-video-20260729/clips/c23799c6-aa96-49bf-b6c0-48ba0038898a/clip.mp4; SHA-256 297466e53d19b04f3d953a9bd9272c55aa55d8642c94ae5caf1403fd1f77a4b8; ffprobe 720x1280, 5.041667 seconds, 24 FPS, no audio. Technical byte/frame QA PASS. A fresh VideoService reopened the same clip/job/path/SHA from disk.
Identity/item evidence: openai-codex-cli/gpt-5.6-terra receipt SHA-256 1e0c024e676721f9e29e5d928785e0f5e9f25a9ce4358e898ef7934b55fa5374. Identity PASS on first (0.95) and last (0.98). Last-frame outfit PASS. First-frame outfit RETRY because blazer color/material became darker and more texture-heavy, with lower-edge rendering artifacts. Persisted clip status is therefore FAIL.
Integration wiring handoff: replace the image provider passed to VideoService in src/web/start.js with createVideoRuntime({ runtimeRoot, openRouterApiKey: process.env.OPENROUTER_API_KEY, assetUrlResolver }); pass the returned videoService to createWebApp. The OpenRouter resolver must produce a short-lived private HTTPS first-frame URL; no local path may leave the host.
weakened_checks: source is an approved completed outfit still but half-body, not a full-length full-look; semantic item fidelity failed on the first frame; beta journey was not run because deployment was explicitly prohibited.
Next action: commit/push this atom. Do not deploy this failed clip. A later authorized atom may tighten the first-frame item lock and run a new controlled generation from an approved full-length look.
