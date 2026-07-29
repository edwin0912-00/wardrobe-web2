Agent ID: chat-6
Block: 6
Branch: beta-block-6-fashion-video
Task ID: BLOCK-6-VIDEO-PROVIDER-ROUTING
Pipeline: VIDEO.01-04; backend BACKGROUND_VIDEO.01-04
Protocol ACK: fd64dd68347a4ea70d2802eb743004e2aa4e7080
Block-map ACK: fd64dd68347a4ea70d2802eb743004e2aa4e7080; Code=ACTIVE; Beta=NOT_DEPLOYED; Journey=NOT_RUN.
Commit tested: WORKTREE (replace with committed SHA after commit)
Rationale/decision: VideoService is the canonical web execution path because it already owns the profile HTTP route; MotionService remains the source of strict gates/receipt requirements, not a second runtime. A new provider router gives Higgsfield exactly three retryable create attempts and permits OpenRouter only after all three fail. Once any provider returns a job ID, that provider is persisted and every poll resumes only that paid job.
Code: ACTIVE — provider routing and provider/job affinity are implemented and covered by focused tests.
Beta: NOT_DEPLOYED
Journey: NOT_RUN — no paid generation was authorized or started.
Evidence command: node --test test/video/video-provider-router.test.js test/video/video-service.test.js test/video/higgsfield-video-provider.test.js
Evidence result: PASS 35/35.
weakened_checks: none
Help request: codex-main must apply the eventual minimal integration wiring in src/web/start.js; Block 6 does not edit integration-only bootstrap.
Wiring handoff: instantiate HiggsfieldVideoProvider with an execFile-based command runner, instantiate the OpenRouter video fallback adapter, wrap both in VideoProviderRouter, and pass that router to VideoService instead of generation.provider.
Next action: implement the OpenRouter async video adapter and the resumable finalization route, then reconcile Video Reference Pipeline inputs without mannequin/EDL artifacts.
