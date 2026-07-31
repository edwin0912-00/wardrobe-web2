Agent role: CHAT 05 — Video Block
Thread: 019faf52-0a8b-7de0-a123-7cea87d3124b
Compatibility branch: beta-block-6-fashion-video
Task: executable Fashion Video runtime and one controlled real clip
Base: 0b788bd13c569e850482bb664ba1ca28f4a25b9d

## Full-reference Fashion Video correction — 2026-07-30

Code: TESTED_BRANCH on `fix/video-deploy-inflight-20260730`. The reference
video is now ordered before appearance images and is the explicit authority for
the full shot sequence, cuts, transitions, motion, camera, environment,
lighting, grade and optical effects. The approved full look, immutable identity
reference and deterministic person-free garment card remain appearance-only
authorities. A reference-bound job uses the reference duration (bounded to the
provider's 15-second integer limit), and OpenRouter is not allowed to discard
Video 1. An unparseable create acknowledgement is an unknown paid outcome and
cannot trigger another automatic spend.

Reference-bound clips remain `NEEDS_QA` after MP4/ffprobe checks. `PASS` now
requires both first/last identity-item QA and an immutable reference-adherence
receipt covering motion/pose timing, camera/framing, environment/lighting,
grade/optical effects and shot sequence/transitions. Either semantic failure
blocks the clip; the two receipts may arrive in either order.

Evidence:

- `node --test test/video/*.test.js` — PASS 133/133.
- `node --test --test-name-pattern='approved identity reference returns'
  test/web/run-service.test.js` — PASS 1/1.
- Exact zero-create packet: Higgsfield `seedance_2_0`, vertical, 13 seconds,
  silent, 720p, Video 1 SHA
  `12ff78b162da5a66e1cb05ddae9c878e18468ebeeabce07ddf36821b196c2d72`,
  Image 1 approved look SHA
  `0f154d1d46df84858a8c56bf2cad612a56858b9363fb603031dc245cefe6c6af`,
  Image 2 identity SHA
  `6d0d53680ba7cca9c99d92264d9f61efa088c601ff99cc1ed5472b3a2fb59ff1`,
  Image 3 garment card SHA
  `9a3e0618adf88dfa6c928d8cfcddce7c67902bb71ea78d2484a38a9cb1cd5d0a`.
  Packet fingerprint:
  `6df2c9617f75cfbbce34ef79365559489223d4cf9ec01bbca8f5e0440d8d26fd`.
- Higgsfield zero-create model estimate for the same geometry: 58.5 credits.
- No generation job was created.

Beta: NOT_DEPLOYED. Release ownership remains with Chat 00; this correction
must replace the current image-animation request before another customer or
controlled generation.

Journey: NOT_RUN after correction. The three earlier static-white-background
outputs are rejected evidence and must not be reused.

weakened_checks: none.

## Executable QA action audit — 2026-07-31

Code: TESTED_BRANCH. Repairable Seedance output no longer becomes a semantic
dead end: a failed first/last identity receipt on a reference-bound clip stays
`NEEDS_QA` until per-cut analysis can identify clean avatar-only spans. Any
reference leak with at least one second of independently `PASS`ed
`APPROVED_AVATAR_ONLY` footage now runs the local hero-only edit even when the
discarded cuts also caused a global creative failure. The derivative receives
new technical, identity/item and full reference QA bound to its own SHA before
delivery; the final PASS/provenance gate was not widened.

The edit concatenates only approved spans in chronological order, replaces
provider sound with the exact hash-checked reference audio, and ends audio at
the shortened picture duration. A genuinely silent reference yields a silent
delivery instead of blocking local repair. The status/finalize API now returns
one executable `next_action` plus `retry_available`; terminal `FAIL`/`FAILED`
always exposes an explicit idempotent retry, while in-flight jobs only expose
`WAIT` and never create a second paid request.

Evidence: `node --test test/video/video-clip-qa.test.js
test/video/video-qa-salvage.test.js test/video/video-qa-action.test.js
test/video/video-service.test.js test/video/video-routes.test.js
test/video/video-runtime.test.js` — PASS 80/80. `git diff --check` — PASS.
Pre-change proof against `9e1732f`: the focused identity-to-cut-analysis
regression fails `FAIL !== NEEDS_QA`, proving the former terminal dead end.

Beta: NOT_DEPLOYED. Journey: NOT_RUN. No provider create, paid generation,
beta edit or deployment occurred. `weakened_checks: none`; only remediation
eligibility widened, and every salvaged byte must pass the unchanged final
delivery gates again.

## Narrow capability integration — 2026-07-30

Code: READY_FOR_BETA_DEPLOY. The useful backend portion of the later Block 6
capability atom is ported onto the consolidated beta without its older profile
UI, overlays, CSS, labels or action-card layout. One shared server contract
requires an immutable approved-look image/receipt SHA, a style-pack SHA and a
motion-reference SHA. The capability GET and create POST consume that same
contract. Missing resolver or malformed/missing hashes remain fail-closed with
`FASHION_VIDEO_REFERENCE_PACK_REQUIRED` before `VideoService.createClip`.

Action Hub: unchanged. Its existing capability fetch, AI orb, full-viewport
overlay, duplicate-submit lock and Live action remain the UI authority.

Evidence: `node --test test/video/*.test.js test/web/profile-ui-flow.test.js
test/web/video-capability-ui.test.js test/web/e-live-ui.test.js` — PASS
130/130; syntax and `git diff --check` PASS.

Beta: pending activation of this exact integration commit.
Journey: not claimed; the deployed runtime does not yet expose a verified
motion-reference resolver, so the truthful public state remains unavailable.
No provider call or paid generation was made.
weakened_checks: none.

## Fashion Video HTTP 502 incident — 2026-07-30

The public `POST /api/profile/video-clips` began at 19:05:15Z and persisted clip
`0b5e30f3-0c3e-436f-aea0-877074c2bd65` as `SUBMITTING` without a provider job
id. Beta release `f352a9b` activated at 19:05:25Z and killed that in-flight
request, so Cloudflare returned HTTP 502. A read-only Higgsfield video-job audit
found no Seedance job at or after the submission time; no paid duplicate exists.

`activeBetaWorkIds` now scans `video-clips/clips/*/clip.json`, blocks deployment
for active, unknown, malformed, or mismatched clip state, and permits restart
only for durable `CREATED` or settled terminal states.

Evidence:

- `node --test test/release/beta-deployment.test.js` — PASS 4/4.
- The fixed scanner detects the interrupted clip plus the currently active
  scenes and shoots in the real beta runtime.
- No paid generation or retry was run.
- `weakened_checks: none`.

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

## Controlled full-body rerun — 2026-07-29

Source: Chat 01 accepted full-body look `/Users/jarvis1/.local/share/madeforthisjob/.zeely-beta-runtime/scenes/scene_6ad135440bf832e3b02a662870fe7230e80309999617b9ef/inputs/approved-look.png`; SHA-256 `438aaad21ea4be826e71d958236e9a75c1f62521f040fa0d86d9199765433ee9`. Sibling receipt is `COMPLETED`, outfit QA PASS, SHA-256 `dac80e1378d0f937eedf5f2ea4f22f102d59f44ebd9ae436c170e75bdf945836`. Approved hoodie/jeans/shoes evidence is READY/PASS, SHA-256 `75f748191e83d736e5b5b61eb940aa27350a1e4ddbb53c59d8783350185f2240`.

Provider evidence: Higgsfield / `seedance_2_0`, create attempt 1, fallback false, job `bf6f9c3b-bced-4d87-ad39-b73f20b0e662`. Request: `walk_stride`, mirror 9:16, 6 seconds, 720p, audio false. The CLI returned its job through the `job_set_id` envelope; transport parsing now covers this exact key. Immutable recovered create receipt SHA-256 `376fa43cb545db932c1d1cce28a3137324ecd7ca2d24bfcc4841648697cb9431`.

MP4 evidence: `runtime/controlled-fashion-video-fullbody-20260729/clips/64358cd9-4a50-4831-a755-0e39fe74b047/clip.mp4`; SHA-256 `d3e6ff8444594d405fbdcee859dd1e5a505f3277af94dc877e1a95429062665f`; ffprobe 720x1280, 6.041667 seconds, 24 FPS, no audio. Technical QA PASS. A fresh VideoService reopened the same clip, job, path and hashes.

Identity/item evidence: `openai-codex-cli/gpt-5.6-terra`; immutable receipt SHA-256 `94f1a0c6c6eb1f945d95a23030a3ca2d6c5c511e9fd856217977cd515262d862`. First-frame PASS: identity 0.98, hoodie 0.97, jeans 0.95, shoes 0.91. Last-frame PASS: identity 0.95, hoodie 0.96, jeans 0.93, shoes 0.89. Persisted/reopened final clip status PASS.

Beta: NOT_EDITED, NOT_DEPLOYED. The earlier rejected clip remains rejected and was not reused.

Minimal integration-only `start.js` handoff (not applied):

```diff
-import { VideoService, ClipStore } from './video-service.js';
+import { createVideoRuntime } from './video-runtime.js';
@@
-const clipStore = new ClipStore(path.join(runtimeRoot, 'video-clips'));
-const videoService = new VideoService({
-  provider: generation.provider,
-  clipStore,
+const videoService = createVideoRuntime({
+  runtimeRoot,
+  openRouterApiKey: process.env.OPENROUTER_API_KEY,
+  assetUrlResolver: videoAssetUrlResolver,
 });
```

`videoAssetUrlResolver` is an explicit deployment-owned prerequisite: it must map the exact clip-owned source path to a short-lived private HTTPS URL. No such resolver exists in this branch, so the handoff intentionally does not invent one or weaken source privacy.

weakened_checks: none for the controlled clip. Integration remains blocked only on the missing deployment-owned private HTTPS `videoAssetUrlResolver`; beta was deliberately not exercised.

## Reference-person QA salvage — 2026-07-31

Pipeline step: `VIDEO.03 QA → VIDEO.04 persisted delivery`.

Decision: a hash-bound per-cut QA failure caused only by leaked reference-performer pixels may produce one deterministic hero-only derivative instead of spending on another provider generation. QA keeps only ordered cuts marked `PASS + APPROVED_AVATAR_ONLY`, rejects `NO_PERSON` and ambiguous/reference-person cuts, and refuses salvage when camera, motion, environment, grade, sequence or another creative dimension also fails. At least one second of approved hero footage must remain.

The derivative is a new immutable `clip-salvaged.mp4`; the original provider MP4 and SHA remain preserved. `ffmpeg` concatenates only approved millisecond spans, restores continuous audio exclusively from the exact hash-bound motion reference and fast-starts H.264/yuv420p + AAC output. Provider audio remains forbidden. The derivative stays `NEEDS_QA` until fresh receipts bound to its output SHA independently pass first/last identity-item QA and complete per-cut reference-adherence QA. No salvage result can inherit PASS from the failed parent.

Code: TESTED_BRANCH — `node --test test/video/video-qa-salvage.test.js test/video/video-clip-qa.test.js test/video/video-service.test.js test/video/video-runtime.test.js test/video/ffprobe-video-probe.test.js` PASS 62/62; syntax and `git diff --check` PASS. The Fastify route suite could not load in this isolated worktree because dependencies are not installed; no route behavior is claimed from that suite.

Real no-provider proof: the new runtime salvaged the user-supplied 13.041667s result using three approved spans (`0–1.042`, `3.667–7.375`, `11.083–13.042`) and the exact `Dear.My.Final.mov` audio. Result: 6.709002s, 720×1280, 24fps, 161 H.264 High/yuv420p frames, AAC-LC stereo 44.1kHz; SHA-256 `3e61140383838c02cfbb95492c9a42381d4326d8c60d54a3c3acd5e5b0245407`.

Beta: NOT_DEPLOYED. Journey: LOCAL_SALVAGE_PASS / PUBLIC_BETA_NOT_RUN. No provider create, paid generation, beta edit or deployment occurred. `weakened_checks: none`; the salvage path adds mandatory output-bound re-QA and does not widen PASS criteria.

## No-paid private video-source bridge — 2026-07-29

Implemented `src/web/video-source-bridge.js`, owned by the video module. `createVideoAssetUrlResolver` issues a random opaque capability URL under the deployment-supplied bare HTTPS origin. Clip id, source SHA, approved-look receipt SHA and filesystem path remain server-side. Each capability is bound to the exact clip-owned `source.png`, source SHA-256, approved-look receipt SHA-256, detected media type and byte size.

Security gates:

- TTL is bounded to 1 second–10 minutes; default 2 minutes.
- Fetch count is bounded to 1–5; default one.
- Source must equal `{clipStoreRoot}/clips/{clipId}/source.png`; traversal, alternate files and symlinks are rejected.
- Issuance and every fetch re-read and SHA-256-check the bytes.
- PNG/JPEG/WebP media type and exact byte size are locked.
- Replay, expiry and explicit revocation fail closed.
- Capability tokens are stored only as SHA-256 map keys.
- The route uses `logLevel: silent`; monitor/error stages redact the token as `/api/video-source/[redacted-capability]`.
- Responses are `private, no-store`, `nosniff`, and never contain a token or local path.
- Profile video creation now obtains the existing verified `image_sha256 + receipt_sha256` pair from `ProfileService.approvedLookReference`, checks the source bytes again in VideoService, and forwards the exact binding to OpenRouter only after the primary retry policy selects fallback.

Evidence:

- `node --test test/video/*.test.js` — PASS 111/111.
- Focused app/profile/privacy regression suite — PASS 15/15.
- Bridge security suite after final receipt-binding assertion — PASS 11/11.
- Tamper, expiry, wrong hash, traversal, replay limit, explicit revoke, invalid media, PIN-auth capability access and logging-redaction tests all PASS.
- Full `npm test` did not start because the repository resource preflight refused the host: swap 5.81 GiB exceeded 1.50 GiB and disk free 3.21 GiB was below 8.00 GiB. The resource gate was not bypassed.
- No provider call or paid generation was run.
- `src/web/start.js` remains unchanged; beta remains NOT_EDITED / NOT_DEPLOYED.

Minimal integration-only `start.js` handoff (not applied):

```diff
-import { VideoService, ClipStore } from './video-service.js';
+import { createVideoRuntime } from './video-runtime.js';
+import { createVideoAssetUrlResolver } from './video-source-bridge.js';
@@
-const clipStore = new ClipStore(path.join(runtimeRoot, 'video-clips'));
-const videoService = new VideoService({
-  provider: generation.provider,
-  clipStore,
+const videoSourceBridge = createVideoAssetUrlResolver({
+  clipStoreRoot: path.join(runtimeRoot, 'video-clips'),
+  httpsOrigin: process.env.ZEELY_PUBLIC_HTTPS_ORIGIN,
+});
+const videoService = createVideoRuntime({
+  runtimeRoot,
+  openRouterApiKey: process.env.OPENROUTER_API_KEY,
+  assetUrlResolver: videoSourceBridge.videoAssetUrlResolver,
 });
@@
   videoService,
+  videoSourceBridge,
 });
```

Deployment must supply a bare HTTPS `ZEELY_PUBLIC_HTTPS_ORIGIN` and `OPENROUTER_API_KEY`. `weakened_checks: full npm test blocked before execution by RESOURCE_PREFLIGHT_FAILED; focused code/security suites pass`.

## Fashion Video motion-reference pack — 2026-07-30

Three operator-provided vertical MP4 references are registered as one
content-addressed pack. The large media stays in the runtime SSD reference
root; Git stores only source identifiers, media facts, allowed motion modes and
SHA-256 bindings.

- `editorial-detail` → `editorial_micro_moment`
- `walk-camera-energy` → `walk_stride`, `garment_gesture`
- `hard-sun-pose` → `camera_drift`

The resolver rechecks the real path, byte size and SHA-256 immediately before
use. Higgsfield Seedance receives the selected video through its native
`--video` input in addition to the approved look image. The current OpenRouter
image-only route refuses this contract before any network call instead of
silently discarding the motion reference. Capability remains unavailable when
the runtime pack is absent or invalid.

Evidence: all four product motion modes resolve one deterministic authority
against the three real SSD files; focused video/profile/Live suite PASS
`138/138`; no provider call or paid generation was run.

weakened_checks: none.
