> **HISTORICAL / MISASSIGNED:** this preserved report was written when Chat 06
> was incorrectly mapped to technical Block 6. Chat 06 is MAIN_SITE-only.
> Current Block 6 owner/report is `chat-5` / `updates/chat-5.md`. Do not append
> new beta-video status here and do not delete this historical evidence.

Agent ID: chat-6
Block: 6
Branch: beta-block-6-fashion-video
Task ID: BLOCK-6-VIDEO-PROVIDER-ROUTING
Pipeline: VIDEO.01-04; backend BACKGROUND_VIDEO.01-04
Protocol ACK: fd64dd68347a4ea70d2802eb743004e2aa4e7080
Block-map ACK: fd64dd68347a4ea70d2802eb743004e2aa4e7080; Code=ACTIVE; Beta=NOT_DEPLOYED; Journey=NOT_RUN.
Commit tested: 28ef2d12c604ef389c471ad2db9509f5707a8987 plus current OpenRouter adapter worktree
Rationale/decision: VideoService is the canonical web execution path because it already owns the profile HTTP route; MotionService remains the source of strict gates/receipt requirements, not a second runtime. A new provider router gives Higgsfield exactly three retryable create attempts and permits OpenRouter only after all three fail. Once any provider returns a job ID, that provider is persisted and every poll resumes only that paid job.
Code: ACTIVE — provider routing, provider/job affinity and the OpenRouter asynchronous image-to-video fallback adapter are implemented and covered by focused tests.
Beta: NOT_DEPLOYED
Journey: NOT_RUN — no paid generation was authorized or started.
Evidence command: node --test test/video/openrouter-video-provider.test.js test/video/video-provider-router.test.js test/video/video-service.test.js test/video/higgsfield-video-provider.test.js
Evidence result: PASS 39/39.
weakened_checks: none
Help request: codex-main must apply the eventual minimal integration wiring in src/web/start.js; Block 6 does not edit integration-only bootstrap.
Wiring handoff: instantiate HiggsfieldVideoProvider with an execFile-based command runner, instantiate OpenRouterVideoProvider with OPENROUTER_API_KEY plus a private expiring HTTPS look-asset resolver, wrap both in VideoProviderRouter, and pass that router to VideoService instead of generation.provider.
External contract checked: OpenRouter POST /api/v1/videos with frame_images, generate_audio=false, then GET /api/v1/videos/{jobId}; the adapter never embeds a local runtime path.
Next action: add the resumable finalization route and exact ffprobe/frame QA, then reconcile Video Reference Pipeline inputs without mannequin/EDL artifacts.

---

Task: saved-look action hub — truthful Fashion Video capability
Base: 5fab5b4095711821a5a256d4063a80d659d5478a
Branch: atom/saved-look-hub-block6-20260730
Decision: Route presence is not product readiness. The saved-look UI now has a
profile-owned, no-store capability endpoint that reports Fashion Video
unavailable until both the verified style reference and verified motion
reference exist. The existing create route continues to fail closed before
provider spend; this atom does not invent a resolver or bypass the two-reference
contract.
API: GET /api/profile/looks/:lookId/video-capability
Code: PASS — endpoint returns `available:false`,
`FASHION_VIDEO_REFERENCE_PACK_REQUIRED`, both unmet reference requirements and
the existing create route. A look outside the browser profile returns
`LOOK_NOT_FOUND`.
Beta: NOT_DEPLOYED
Journey: NOT_RUN — no provider call or paid generation was made.
Pre-change proof: applying the new route tests to base 5fab5b4 failed 3/5
because the endpoint returned Fastify 404.
Focused proof: `node --test test/video/video-routes.test.js` PASS 4/4.
Block proof: `node --test test/video/*.test.js` PASS 113/113.
Blocker: no executable, immutable Fashion Video resolver currently binds both
verified references to `/api/profile/video-clips`; therefore capability must
remain false and the POST route must remain blocked.
weakened_checks: none
