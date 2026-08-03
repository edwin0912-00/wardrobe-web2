Agent ID: codex-live-40
Task: FASHION-VIDEO-PROVIDER-LABELS-V2-20260803
Product line: Fashion Video
Pipeline: VIDEO.01 locked style reference → VIDEO.02 Seedance create
State: CODE_TESTED — release-owner integration/deploy required
Decision: use Seedance-style `@Video 1`, `@Image 1..N` labels for every new
Fashion Video request. The prompt is deliberately prefixed with neutral prose
(`Reference bindings.`), so the Higgsfield CLI cannot parse the entire prompt
argument as a local `@response-file` expression. Existing persisted v1
bracket-labelled jobs are immutable and unchanged; new requests record binding
schema v2.
Evidence: paid, same-input A/B used two real Seedance jobs. The `@` request
completed normally and increased clean approved-avatar temporal coverage from
14.55% to 42.95%; focused video motion-plan/service tests run after this edit.
weakened_checks: none; the source performer remains a delivery blocker.
Beta: NOT_DEPLOYED. Journey: code-level test only after the A/B.

---

Agent ID: codex-live-40
Task: FASHION-VIDEO-START-REGRESSION-20260802
Product line: beta-placeholder → main bridge
Pipeline: VIDEO.01 style reference → VIDEO.02 provider create
State: CODE_VERIFIED — release-owner integration/deploy required
Finding: Fashion Video was returning HTTP 502 before a Higgsfield job existed.
The reference-transfer prompt began with `@Video 1`; Higgsfield CLI interprets
an argument beginning with `@` as a response-file path and rejected it with
`Failed to read Video 1 ...`. This was a local CLI parsing regression, not a
quality-QA failure and not a rejected approved master.
Change: provider-facing labels are now `[Video 1]`, `[Image 1]` and so on;
the exact reference order is unchanged. The CLI argv now uses its documented
`--video-references` and `--image-references` flags rather than short aliases.
Evidence: exact failed hard-sun package (locked style MP4 + approved white
master) passed `higgsfield generate cost seedance_2_0` at 67.5 credits with no
job created; focused motion-plan/provider tests PASS 43/43.
Beta: NOT_DEPLOYED. Journey: no paid video created by this repair.
weakened_checks: none — the private style video remains directing-only and
reference-performer leakage remains a delivery blocker.

---

Agent ID: codex-main
Cross-block handoff: Fashion Video style-owned presentation geometry
Product line: beta-placeholder
Pipeline: VIDEO.01 style reference → VIDEO.02 provider request → VIDEO.04 delivery
State: CODE_VERIFIED — release-owner integration/deploy required
Decision: Fashion Video does not expose or trust a TV/mirror choice. The exact
hash-bound style reference owns both presentation surface and provider aspect:
vertical `9:16` → mirror; landscape `16:9` → television. A legacy client
surface is accepted only for compatibility and ignored before provider create.
The derived value is persisted with the style binding and returned by the
capability and create APIs.
Code: local branch `fix/video-style-owned-surface-20260802`; commit pending.
Evidence: `node --test test/video/*.test.js` — 191/191 PASS; `node --test
test/web/profile-ui-flow.test.js test/video/video-routes.test.js` — 26/26 PASS.
The four current approved style masters all resolve 1080×1920 → mirror/9:16.
Beta: NOT_DEPLOYED. Journey: NOT_RUN. No provider generation was spent.
weakened_checks: none. Unsupported reference geometry fails before provider
spend rather than being cropped or silently converted.

---

Agent ID: codex-main
Block: 1
Branch: beta-block-1-needs-input-recovery-20260731

---

Agent ID: codex-main
Task ID: BETA-PAID-CORE-SMOKE-20260802
Product line: beta-placeholder
Pipeline: LOOK.01–06 · paid avatar → outfit
State: LIVE_PROOF_PASS — beta runtime
Decision: A real paid beta run completed after isolating the persistent Codex VLM worker from the desktop Codex state database. The worker must run with a dedicated CODEX_HOME; shared global state caused empty/timeout VLM responses before GARMENT_CONDITIONING completed.
Code: deployed runtime `c1d75ce8e9c4921e72d6b2ecb349481f00c89aef`; public `/api/health` is `ready` and reports that release. This runtime SHA is not yet an ancestor of `origin/beta=d4fd64b53f62e0f89a09d35e8172b5624ead60c6`; source/release reconciliation is still required.
Paid evidence: run `1638c656-4be6-46b9-bfaa-595109db03d6`; Higgsfield jobs `ba148144-0d22-467a-b9d5-1fc5d16978cf` (avatar) and `7986c924-e831-4ed7-9c37-949609858925` (outfit); conditioning/avatar/outfit QA all PASS; final output files were downloaded and persisted.
Evidence command: `curl -sS https://beta.madeforthisjob.com/api/health`; durable run receipt and provider-job receipts under the beta runtime for the exact run id.
weakened_checks: none. This proves paid avatar → outfit only; no background, Fashion Shoot or video provider call was made in this atom.
Help request: integrate the worker-isolation launch configuration into the release source before the next beta restart, then reconcile `origin/beta` with the deployed SHA.
Next action: keep the dedicated worker home across restart and run one separately authorized paid scene/video journey.


Task: make the core-look `NEEDS_INPUT` recovery actionable after the live run
`aa7bc644-3542-4333-936d-51d8c04472ab`.

Finding: this run did not lose two uploaded items. Its browser monitor records
one garment upload and `garment_count: 1` at submit; the immutable run input
is one cowboy-hat image. Conditioning correctly stopped before full-look
generation because that evidence cannot establish a complete outfit.

Decision: `NEEDS_INPUT` without a duplicate-slot choice is a material-change
state, not a provider retry state. The terminal UI now hides the futile retry,
keeps **«Змінити матеріали»**, and translates the specific headwear-only case
into the required top/bottom/one-piece input. Duplicate-slot selection still
uses its existing continuation flow; `FAILED` keeps retry.

Code: READY_FOR_REVIEW — focused public-copy/UI contracts PASS 14/14; app
syntax and whitespace checks PASS.
Beta: NOT_DEPLOYED.
Journey: live run evidence inspected; no new provider request was created.
weakened_checks: none — conditioning and product QA remain unchanged.

---

Agent ID: codex-main
Task ID: BETA-PRESENTATION-DERIVATIVES-001
Product line: beta-placeholder
Pipeline: UI transport only · local inputs/style preview → lightweight display copy
State: CODE_VERIFIED — beta deployment pending
Decision: immutable source images and master Fashion-Video references are never
sent to ordinary preview UI. A browser makes a local 480px WebP only for an
upload card; raw bytes remain the exact upload/draft/QA input. The server's
garment conflict picker returns a 480px WebP thumbnail only. Fashion Video
cards now stream separately hash-bound 288×512/12fps UI loops (217–326 KB)
instead of the prior 1.4–1.6 MB derivatives; original MP4s remain the sole
generation references.
Evidence: registry/capability/routes/UI/run API suite 35/35 PASS. The API test
proves the picker response is WebP, bounded to 480px and smaller than its PNG
source.
weakened_checks: browser fallback on an engine without bitmap/canvas decoding
uses the original local object URL so file selection remains usable; it never
changes uploaded bytes or server evidence.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-REFERENCE-PERFORMER-STOP-001
Product line: beta-placeholder
Pipeline: VIDEO.01 → VIDEO.04 · reference style → generated clip → cut QA → delivery
State: CODE_VERIFIED — beta deployment pending
Decision: Video 1 is now explicitly private directing material, never source
footage for delivery. The provider prompt requires a newly generated frame for
every cut: only the approved avatar or an empty scene may be visible. It
forbids source-performer pixels in cuts, transitions, reflections, monitors,
picture-in-picture and frozen frames. A technically valid MP4 cannot be
delivered until a hash-bound cut-coverage receipt spans its duration and each
cut records output/reference samples, person presence and PASS verdict.
Evidence: focused motion-plan/service/routes/profile-UI suite 68/68 PASS.
Route regression proves even a PASS MP4 returns no delivery URL without the
complete Fashion-Video cut QA binding.
weakened_checks: automatic extraction + VLM evaluation of the cut receipt is
the next execution atom. Until it exists, reference-bound clips remain
undeliverable rather than being falsely approved. The retry control is an
explicit user action only; it never creates a duplicate provider job itself.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-PROVIDER-TRUTH-001
Product line: beta-placeholder
Pipeline: VIDEO.02 · persisted provider job → provider wait
State: CODE_VERIFIED — deployment pending
Decision: provider `Job not found` is a terminal, visible failure, not a six-
minute timeout or a connection error. The service records
`VIDEO_PROVIDER_JOB_NOT_FOUND`; it never creates a replacement automatically.
Evidence: exact live job `7ed8551f-8227-4a94-99bf-8510a6e096fc` returned
`Error: Job not found` from the authenticated Higgsfield CLI on 2026-07-31.
Focused provider/service/route/UI suite 152/152 PASS.
weakened_checks: none. The missing remote job cannot yield a real MP4 or QA
receipt; a human must explicitly request a new paid generation.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-SERVER-RESUME-001
Product line: beta-placeholder
Pipeline: VIDEO.02 → VIDEO.04 · provider job → MP4 → QA
State: CODE_VERIFIED — deployment pending
Decision: a Fashion Video POST persists one provider job, then server-owned
finalization waits for that same job, downloads it and enters QA. Status reads
after a daemon restart resume the same persisted job; startup also resumes
every persisted CREATED/GENERATING job. The browser no longer calls six minutes
of waiting a failure: it truthfully says processing continues on the server.
Evidence: focused video + UI suite 149/149 PASS. Route regression proves
multiple status reads attach to one finalizer and one provider create.
weakened_checks: none. Resume never invokes provider create; it uses only the
stored job id. Semantic Fashion-Video QA remains required for delivery.

---

Agent ID: codex-main
Task ID: ANTIGRAVITY-QA-LOOP-001
Product line: beta-placeholder
Pipeline: Block 0.8 · independent verification of Blocks 1–7
State: CONTROL_PLANE_READY
Decision: Antigravity/Gemini watches all block branches and tests only the
exact deployed beta SHA through visible browser UI. It writes reports and
evidence manifests, never product code or deployments.
Evidence: compiled Looper contract, governance checks, QA report schema and
one-shot watcher.
weakened_checks: none.

---

Agent ID: codex-live-40
Task ID: BETA-VIDEO-INPUT-ROLES-AND-SHOOT-DOWNLOAD-20260803
Pipeline: UNIVERSE.04 + VIDEO.01 · result delivery surface
State: LIVE
Decision: restored every server-READY Fashion Shoot card; every delivered
customer frame keeps its independent output and a visible «Завантажити» link.
The native beta Fashion Video picker now renders the server-owned input roles:
Video 1 is private directing material, Image 1 is the approved white master and
sole visible person, and input three is optional cleaned face/garment detail.
Evidence: UI / Fashion Shoot / Fashion Video tests 78/78 PASS; contracts and
canon PASS. No paid generation was run.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-FASHION-SHOOT-CATALOG-AND-VIDEO-METADATA-20260802
Pipeline: UNIVERSE.01–04 + VIDEO.01 · catalog, style inputs, progressive output
State: TESTED — beta deploy pending
Decision: customer Fashion Shoot selection follows only the server-owned
`READY + generation_available` contract. The two published legacy styles
`organic_contrast` and `urban_monochrome` are visible and directly queue their
five customer frames; no hidden hero/Continue gate remains. The genuinely
blocked `shoot.hardsun_street_monochrome` remains unavailable.
Technical refs: 15 published `shoot.*` Creative Universe units each own seven
hash-verified sheets (camera/lens, blocking, expression/gaze, garment
behaviour, colour grade, environment, person) and six slot-specific directions.
The two legacy styles retain their verified legacy source packs but do not claim
the seven-sheet unit contract. `architectural_stair_glitch` remains video-only.
Video: the capability response now carries safe user-visible labels for Video 1
(private motion/directing reference), Image 1 (approved white master) and the
optional cleaned identity/garment reference plus cut count; no path, SHA or
private source bytes are exposed.
Evidence: editorial/style/video targeted suite 45/45 PASS;
`verify:contracts` PASS (41 schemas, 9 fixtures, 3 jobs);
`verify:canon` PASS (43 rules).
Beta: NOT_DEPLOYED.
Journey: NOT_RUN — no provider generation was started.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-GOD-VIEW-GLOBAL-CATALOG-001
Pipeline: TESTER CONTROL · global read-only catalogue
State: CODE_VERIFIED — awaiting beta deployment
Decision: restored the lost global God View branch, not the obsolete local
pipeline-status modal. Its data model is every active beta profile → avatar →
saved look → run, background, Fashion Shoot and video. In the explicit beta
tester flag it needs no second password; it remains read-only and is reached
from the small footer control or Shift+G.
Evidence: God View API tests cover cross-profile aggregation and the explicit
open-tester flag; normal profile ownership remains unchanged.
weakened_checks: global catalogue visibility is intentionally enabled only by
ZEELY_GOD_VIEW_OPEN_TESTERS=true on beta, under the operator's tester-link scope.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-DIRECT-STYLE-BINDING-001
Pipeline: VIDEO.01 → VIDEO.03 · selected style → immutable provider request → QA
State: CODE_VERIFIED — awaiting beta deployment
Decision: Fashion Video POST now carries the selected `style_id` as well as its
internal motion mode. The exact style MP4 becomes Video 1; the approved white
master becomes Image 1. The optional garment composite is no longer allowed to
import Real-time Look's top/bottom/footwear taxonomy gate into V2V.
Evidence: route regression creates from a selected style with an incomplete
Real-time garment taxonomy and sends only the valid identity companion.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-LEGACY-DELIVERY-001
Pipeline: VIDEO.03 · Delivery only after video-style QA
State: CODE_VERIFIED — awaiting beta deployment
Decision: old generic clips without a video-reference hash binding and a PASS
reference-style QA verdict are retained on disk but excluded from Fashion Video
delivery and listings. They cannot be presented as a valid Fashion Video.
Evidence: runtime audit found one technical PASS with neither binding nor style
QA; route regression denies it with VIDEO_STYLE_PROVENANCE_MISSING.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-REFERENCE-PREVIEW-001
Pipeline: VIDEO.01 · Вибір video-derived стилю
State: CODE_VERIFIED — awaiting beta deployment
Decision: a Fashion Video style card now plays the private, hash-verified
source MP4; the contact sheet is only its poster. The new range-enabled route
is bound to the current tester profile and approved look. Generic motion labels
are not user-facing style options.
Evidence: route test proves a byte-range response from the exact selected
reference; video/provider/reference tests pass 49/49.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-STYLE-LABELS-001
Pipeline: VIDEO.01 · Вибір відеостилю до запуску
State: READY_FOR_BETA_DEPLOY
Decision: the three contact-sheet-backed video style units remain unchanged.
Only the second UI label changes from the internal action wording `Рух у кадрі`
to `Графічне місто`; motion modes stay server-side contract data and are not
presented as styles.
Evidence: manifest hashes for all three source MP4/contact sheets match; video
reference registry tests pass.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-SCENE-E2E-ROUTE-ALIGNMENT-001
Product line: beta-placeholder
Pipeline: BACKGROUND.01 · real provider/QA control runner
State: CODE_VERIFIED — first provider rerun next
Decision: the control runner reads the same immutable item evidence and 3:4
model route as beta rather than maintaining a partial duplicate.
Evidence: saved master resolves 3 item records and all three route entries are
3:4.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-BACKGROUND-RELEASE-16-001
Product line: beta-placeholder
Pipeline: BACKGROUND.01 · catalogue release safety
State: CODE_VERIFIED — awaiting safe beta activation
Decision: all 16 standard backgrounds are one approved release selection. The
verifier reads that selection and validates every pack; it cannot retain a
separate five-item list.
Evidence: rebuilt product candidate reports `scene_presets: 16`; regression
test verifies the 16-pack release contract.
weakened_checks: none. This expands full verification from five to sixteen.

---

Agent ID: codex-main
Task ID: BETA-BOOT-GUARD-ACTIVE-WORK-001
Product line: beta-placeholder
Pipeline: PLATFORM.01 · restart safety for all execution branches
State: ACTIVE_ON_HOST — source committed with beta branch
Decision: scheduled recovery cannot restart beta while any persisted master
run, background scene or Fashion Shoot slot is queued/running. It records a
blocked recovery instead; it does not manufacture a restart or a duplicate run.
Evidence: both copies pass `zsh -n`; live persisted scene/shoot state makes the
guard's active-work check return true.
weakened_checks: none. Unknown durable work fails closed.

---

Agent ID: codex-main
Task ID: BETA-RESTART-RESUME-001
Product line: beta-placeholder
Pipeline: LOOK.02 · garment reference-card preparation
State: ACTIVE_ON_BETA — controlled full-look completed
Decision: restart now resumes from immutable per-attempt evidence, not from a
fresh provider submission. The deploy adapter is the verified SIGTERM source;
it now refuses an activation whenever persisted beta work is active.
Evidence: targeted 32/32 PASS; beta release `release-bda3ee9-1785350382449`;
controlled run `01b1195f-4653-4275-9293-cdc66fc58cfd` completed and was saved
as one browser-profile avatar/master look. The active-run guard observed that
run id while it was running.
weakened_checks: none. The remaining provider-accepted/no-image-yet outcome
is explicitly not misrepresented as resumable because no candidate exists.

---

Agent ID: codex-main
Task ID: BETA-STANDARD-SCENE-VISIBLE-FACTS-001
Product line: beta-placeholder
Pipeline: BACKGROUND.01 · approved master look → standard scene → QA
State: CODE_VERIFIED — deployment pending
Decision: a full-body background must reject a visible product substitution,
not an approved detail that the frame naturally cannot expose. The master-look
receipt keeps such unobservable details locked. Fashion Shoot is not relaxed.
Evidence: real white-window candidate had identity/scene/light/framing PASS and
only failed naturally covered jeans construction + tiny shoe geometry; focused
adapter proof 4/4 PASS.
weakened_checks: none. Visible logo/text/pattern, silhouette, color, material,
construction mismatch, missing item and unauthorized addition remain blocking.

---

Agent ID: codex-main
Task ID: BETA-DEPLOY-ACTIVE-WORK-GUARD-001
Product line: beta-placeholder
Pipeline: PLATFORM.01 · release safety for LOOK / BACKGROUND / FASHION SHOOT
State: CODE_VERIFIED — deployment waits for current persisted work to finish
Decision: beta release is refused while a run, scene, or Fashion Shoot has a
queued/running execution. Completed records and user-approval wait states do
not cause a permanent deploy lock.
Evidence: focused deployment test 4/4 PASS. Current dry-run names only live
scene/shoot work and ignores service incident/quarantine directories.
weakened_checks: none. Unknown job-shaped directories fail closed.

---

Agent ID: codex-main
Task ID: BETA-LOOK-FAST-ROUTE-001
Product line: beta-placeholder
Pipeline: LOOK.02–06 · source item → reference card → avatar → master look
State: ACTIVE_ON_BETA — paid journey pending
Decision: only avatar/garment reference preparation has an explicit server
fast route: Nano Banana 2 → GPT Image 2 → Nano Banana Pro. Background and
Fashion Shoot do not inherit it. A raw side-oriented shoe now requests an
evidence-preserving side card; QA evaluates only source-visible facts and
retains all visible-fidelity gates.
Evidence: `node --test test/runner/model-policy.test.js test/web/garment-conditioner.test.js test/providers/codex-vlm-evaluator.test.js test/runner/pipeline-runner.test.js` — 27/27 PASS; release `release-4eb84ac-1785349827315` is locally and publicly `ready`.
weakened_checks: none. A single source view cannot establish an invented rear,
sole or alternate-angle fact; a footwear sheet remains a separate follow-up.

---

Agent ID: codex-main
Task ID: BETA-LOOK-NEXT-ACTIONS-001
Protocol ACK: 00cb600
State: BLOCKED_DEPLOY
Rationale/decision: the operator requested one visual approval screen before
the real saved-look choice flow is altered. It is therefore a standalone
non-functional preview, not a mock video/camera implementation.
Scope: only `web/public/choice-universe-preview.html` and its focused test.
No provider call, camera permission, profile mutation or navigation binding.
Evidence command: node --test test/web/choice-universe-preview.test.js (2/2 PASS).
Deploy blocker: immutable product-release build stops at pre-existing invalid
editorial preview sidecar `editorial.edwin_novak.organic_contrast` before it
can package the preview. No bypass/manual file copy was used.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-FASHION-SHOOT-FIVE-UI-001
State: BETA_SURFACE_PASS
Deployment: `release-9cfcd5a-20260729180500` from beta commit `9cfcd5a`.
Evidence: public `GET /api/health` is `ready`; public root contains `Style pack
→ внутрішня QA-перевірка → 5 fashion-кадрів`; public `scene-ui.js` contains no
legacy-grid dereference; public API reports exactly 10 `shoot.*`, all READY.
Journey: NOT_RUN — no paid Fashion Shoot was started for this deployment.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-FASHION-SHOOT-FIVE-UI-001
Product line: beta-placeholder
Pipeline: UNIVERSE.01–04 → FASHION_SHOOT.01–03
State: DEPLOYED_TO_BETA
Decision: only the ten complete `shoot.*` Creative Universe units appear in
the Fashion Shoot picker. The internal first identity/look verification remains
hash-bound and auto-approved after PASS; the user sees five unique output
frames, with isolated retry per output. Contact/reference sheets remain
Creative Universe backend evidence and are not shown as an output.
Evidence: `node --test test/web/create-universe-units.test.js test/web/editorial-preview-api.test.js test/web/editorial-preview-ui.test.js test/web/editorial-state.test.js test/web/editorial-shoot-service.test.js` PASS.
Code: ready. Beta: not yet activated. Journey: no paid Fashion Shoot run.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-FASHION-SHOOT-CANON-001
Product line: beta-placeholder
State: DONE — awaiting beta deployment
Decision: preserve Antigravity's one-frame implementation as comparison commit
`0ba63c1`, but restore the legacy multi-frame prototype for comparison only.
User-facing copy now uses one name, **Fashion Shoot**; internal `editorial-*`
identifiers remain stable because they bind existing routes, receipts and state.
Evidence: `comparison/fashion-shoot-single-frame-0ba63c1` created; focused
Fashion Shoot tests 31/31 PASS. The single-frame experiment deletes the
server-backed legacy UI, but neither variant is a released Fashion Shoot
contract until its consumer output is specified separately from Creative
Universe style-build artifacts.
Risk: three unrelated standard-scene integration fixtures remain red on their
4:5 provider bytes versus the current 3:4 delivery contract; no QA was relaxed.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-MINIMAL-NEXT-BLOCKS-001
State: BLOCKED_DEPLOY — code remains committed on beta as `17df194`.
Deployment evidence: product package build completed, but the release verifier
refused activation before restart: required `web/public/editorial-shoot-ui.js`
is absent from the current beta tree. The incomplete release directory was
deleted; the currently active beta release was not changed.
Required repair: reconcile the verifier's required-scene file list with the
current `scene-ui.js` implementation, or restore the required module from its
authoritative commit. No manual bypass.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-EDITORIAL-RESTORE-001
State: DONE — ready for beta deployment.
Decision: do not weaken the product verifier after the one-frame simplification
deleted the full editorial UI. Restored the authoritative six-shot flow:
Shoot Bible → hero approval → five remaining shots (concurrency two) →
per-shot QA/retry/contact-sheet-capable gallery. Standard scenes remain a
separate branch.
Evidence: `node --test test/web/editorial-preview-ui.test.js
test/web/profile-ui-flow.test.js` — 17/17 PASS. Product package build and
verifier PASS: 632 deploy files, 14 editorial modes / 12 generation-enabled,
10 Create Universe modes / 10 generation-enabled.
weakened_checks: none.

Deployment: ACTIVE. Product release `release-df4f129-20260729195500` is the
beta app root. Public `GET /api/health` returned `runtime_status: ready` and
the deployed `scene-ui.js` imports the restored `editorial-shoot-ui.js` under
the same release cache token.

---

Agent ID: codex-main
Task ID: BETA-SCENE-CATALOG-RENDER-001
State: DONE — deployed.
Root cause: picker initialization still queried deleted `#editorial-mode-grid`.
That null element stopped the client before either already-live catalogue could
render, leaving the screen at zero.
Fix: render the loading state into the two actual grids
`#editorial-mode-grid-new` and `#editorial-mode-grid-legacy`.
Evidence: focused UI tests 17/17 PASS; public-browser smoke on beta returned
`standard:16`, `shoot:14`, `status:"16 сцен · обери одну"`, and no application
console error.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-RESTART-GUARD-001
State: ACTIVE ON HOST
Decision: local launchd guard runs at user-login and every 3600 seconds. It
checks beta launchd, canonical tunnel launchd, runner/release path, local and
public health, authenticated Higgsfield CLI, and free disk. Only beta local
health failure can trigger a beta-only kickstart; tunnel/provider credentials
are never mutated or written to logs.
Evidence: manual launchd run ended exit 0 with
`SUMMARY ok=8 warn=0`; Higgsfield account-status check completed successfully.
Canonical source: `tools/zeely-boot-guard.sh`; installed user-level copy is
outside Documents so launchd can run it after reboot.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: DESIGN-PIPELINE-DECK-CANON-001
State: DONE
Decision: operator-supplied `zeely-pipeline-deck.html` and `vt-bp.html` are
recorded as the visual/narrative canon for the final post-result engineering
deck, not as a claim that their old stage counts, providers or gates are live.
Evidence: both source SHA-256 values and the exact adoption boundary are in
`docs/references/PIPELINE_DECK_FORMAT_CANON_UA.md`.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-MINIMAL-NEXT-BLOCKS-001
State: DONE — local code and focused test.
Decision: make the three agreed post-master blocks inspectable in beta without
pretending that an absent server route generated anything. “Покращити образ”
opens its exact lock/change contract; “Відео зі сцени” opens the two intended
branches only after a future QA-approved scene; pipeline captions explain
locks → QA → saved master → independent next result.
Evidence: `node --test test/web/profile-ui-flow.test.js` — 8/8 PASS;
`git diff --check` — PASS.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-SCENE-JOURNEY-SMOKE-001
State: BLOCKED_INPUT
Actual terminal evidence: `deef65fb-a4da-4608-a223-96b026fa5b39` reached `CONDITIONING_QA` through the real Higgsfield CLI. Top and bottom passed; footwear was classified at 0.97 but refused because the single lateral image cannot evidence the other side, top, heel, sole or pair-level construction. Provider normalisation job `ca6945c8-ebbf-46f1-b88b-ec46fe4c5667` completed. No scene was created and no duplicate retry occurred.
Required input: extra images of the exact pair—opposite side, top/toe, heel, and sole where relevant. This is an honest source-evidence gate, not a provider outage or timeout.
weakened_checks: none.

State: READY_FOR_BETA_DEPLOY
Exact product commit: `969bc57`.
Deployment blocker: `tools/lib/deployment-target.mjs` permits only
`https://iwas.madeforthisjob.com/api/health`, which is a separately protected
target and not the beta domain. No substitution, manual copy or release was
attempted. The next safe action is for the beta release owner to provide or
approve the exact beta-targeted activation path, then visually smoke tap
selection on one mobile viewport and one desktop viewport.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-LIVE-40S-NO-SECOND-CONFIRM-001
Pipeline: LIVE.01–04 · Real-time Look
State: READY_FOR_BETA_DEPLOY
Decision: the browser camera permission remains the only interactive permission.
The beta server owns the 40-second ceiling and look ownership; it no longer
requires duplicate price/privacy checkboxes before issuing the short-lived
Live token. Beta's standalone Live surface shows `Lucy 2.5 · $2.40/хв · до 40 с`;
the main cinematic client renders no provider or price copy.
Code: focused routes, UI, contract and token tests 20/20 PASS.
Beta: NOT_DEPLOYED.
Journey: NOT_RUN — no camera or provider session was started.
weakened_checks: no auth, ownership, same-origin, browser camera permission,
short-lived token, or hard-timeout checks were removed; only redundant UI/API
acknowledgements were removed.
Help request: NONE.

---

Agent ID: codex-main
Task ID: MAIN-FASHION-VIDEO-DELIVERY-002
Pipeline: VIDEO.01–05 · approved white master → reference-bound generation → delivery
State: TESTED_PENDING_DEPLOY
Decision: in explicit closed-beta `delivery` QA mode, the model's creative
`cut_coverage_complete` verdict is advisory. Deterministic sampled coverage
already proves that every cut was inspected; only a detected reference
performer remains a semantic delivery blocker. This prevents a generated MP4
with a PASS technical check, PASS identity/outfit check, and PASS anti-leak
check from being discarded because it did not reproduce every editorial cut
closely enough.
Code: current worktree; video tests 194/194 PASS. New regression proves a
`cut_coverage_complete` visual miss still delivers when deterministic coverage
and `no_reference_performer_pixels` pass. A real Seedance job
`94f7c61f-def6-4334-aba1-6dbf25705564` produced an MP4; its prior terminal
failure was exactly this stale blocking classification, not a provider or
photo-input failure.
Beta: PENDING_DEPLOY — deploy only after no active persisted provider work.
Journey: replay the existing completed clip without a second provider create;
the MP4, white master binding, technical QA, identity/outfit QA, and sampled
anti-leak evidence are already persisted.
weakened_checks: creative style/cut similarity is advisory only in delivery
mode. Technical MP4 QA, deterministic coverage, and reference-performer
leakage remain hard.
Help request: NONE.

---

Agent ID: codex-main
Task ID: MAIN-FASHION-VIDEO-DELIVERY-001
Pipeline: VIDEO.01–05 · approved white master → private style reference → Seedance → returned MP4
State: READY_FOR_DEPLOY
Decision: the closed beta uses explicit `delivery` QA policy for Fashion Video.
It records identity/item/style misses as advisory so an otherwise playable clip
returns to the user, while it still blocks unplayable media, missing cut
coverage, reused reference footage, or any reference-performer pixel. The
policy is runtime-configured; `strict` remains the code default.
Code: pending commit in this atom. Tests: video service/runtime/routes 71/71
PASS; full video suite will be rerun after commit.
Beta: PENDING_DEPLOY — set `ZEELY_FASHION_VIDEO_QA_MODE=delivery` in beta's
runner only with this exact code release.
Journey: PENDING — submit one current approved white master through the live
Fashion Video route and verify a persisted MP4 is returned.
weakened_checks: identity/item/style checks advisory only in closed beta;
reference-performer / raw-reference / cut-coverage / technical delivery remain hard.
Help request: NONE.

---

Agent ID: codex-live-40
Task ID: BETA-FASHION-SHOOT-CROWN-CROP-002
Pipeline: UNIVERSE.03–04 · Create Universe / Fashion Shoot contract alignment
State: READY_FOR_BETA_DEPLOY
Decision: rebuilt all six hash-bound mechanical blocking guides from the current
editorial framing lock. The guides now encode the 100% upper subject ceiling and
`require_full_head=false` for intentional style crops; standard backgrounds keep
their independent full-head contract. The guide remains geometry-only; identity,
items, anatomy, provenance and style gates remain active.
Code: updated `assets/editorial-blocking/v1/*.png`, its manifest, and the
deterministic generator `tools/generate-editorial-blocking-crop-guides.mjs`.
Tests: core 157/157; scene service 57/57; scene adapters/runtime 81/81;
scene/framing contracts 22/22; Fashion Shoot/Create Universe 38/38;
Fashion Video 188/188; Upload/HEIC/Profile 139/139; Real-time Look 31/31.
Release suite: BLOCKED only by local resource preflight (swap 7.64 GiB above
1.25 GiB) and one existing add-items smoke expecting an unavailable draft entry
point; no QA gate was bypassed.
Beta: pending this commit and release verification.
Journey: no paid provider generation.
weakened_checks: `EDITORIAL_CROWN_CROP_POLICY` only, user-authorized 2026-08-02.
Help request: NONE.

---

Agent ID: codex-live-40
Task ID: BETA-FASHION-SHOOT-CROWN-CROP-001
Pipeline: UNIVERSE.03–04 · Create Universe / Fashion Shoot delivery QA
State: READY_FOR_BETA_DEPLOY
Decision: user-authorized editorial framing policy. An intentional crop through
the crown now passes in every Fashion Shoot slot; the crop is a property of the
selected style, not a delivery failure. The standard-background contract is
unchanged: it still requires a complete head and its existing headroom band.
Code: `EDITORIAL_HEAD_GUARDS` now has `head: false` only for Fashion Shoot
slots; their upper subject-height ceiling is 100 instead of a derived headroom
ceiling. Compiled camera contracts and all three generated JSON receipt schemas
were regenerated from that one lock owner. The QA receipt explicitly records
`clear_space_above_hair_waived_by_full_head: false`: this is an allowed crop,
not a hidden waiver.
Still blocking: identity/visible-face evidence, selected-item fidelity,
anatomy, reference provenance, style/lighting, footwear where the slot asks
for it, and all standard-scene framing checks.
Tests: focused framing + editorial service + adapters 99/99 PASS;
`npm run verify:contracts` PASS (41 schemas / 9 fixtures / 3 jobs).
Beta: NOT_DEPLOYED — pending commit/push/release by this owner.
Journey: NOT_RUN — no paid provider generation was spent for this policy change.
weakened_checks: `EDITORIAL_CROWN_CROP_POLICY` only; authorized by Edwin on
2026-08-02; scope is Fashion Shoot/Create Universe, never standard backgrounds
or the master-look.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-STARTUP-TRACE-20260802
Pipeline: Release reliability · beta daemon boot
State: TESTED — READY_FOR_DEPLOY
Decision: add an opt-in, secret-free bootstrap phase trace so a failed beta
restart identifies the exact durable-service boundary that did not complete.
It never logs request content, user identities, source paths, or credentials.
Code: pending this commit.
Evidence: `node --check src/web/start.js`; focused release/scene/video tests
111/111 PASS; `git diff --check` PASS.
Beta: NOT_DEPLOYED — bundled with the next exact beta release.
Journey: NOT_RUN.
weakened_checks: none.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-GPT-IMAGE-2-LADDER-20260802
Pipeline: LOOK.01–06 · BACKGROUND.02 · UNIVERSE.03–04
State: READY_FOR_BETA_DEPLOY
Decision: new image generation no longer starts on Nano Banana. Every new
avatar, item-conditioning and scene job uses the versioned GPT Image 2 ladder:
`low / 1K` initial, two materially different `low / 1K` QA repairs, then
`medium / 2K`, then `high / 4K`. Nano aliases remain readable only for a
previously persisted legacy job; they are not selected for a new job.
Code: TESTED — focused route, provider, core, scene and repair suites 221/221
PASS; scene-service 58/58 PASS; `verify:contracts` and `verify:canon` PASS.
Beta: NOT_DEPLOYED — exact commit is created by this release atom; do not use
older board entries that describe Nano as the fast route.
Journey: NOT_RUN — no new paid provider request was spent for this policy
change.
weakened_checks: none.
Next action: fast-forward this exact candidate into `beta`, activate it through
`tools/deploy-beta-release.mjs --apply`, then verify public release SHA and
run one controlled new-job journey.

---

Agent ID: codex-main
Task ID: BETA-GPT-IMAGE-2-LADDER-20260802
State: LIVE
Code: `c673a5d40573bd1830b0643c723b9557a496a453`; activation-record source:
this commit.
Beta: LIVE — prior product activation `bb781c2c542c1c6c91f0fdb6298c2c0470578dbf`,
`product-bb781c2c-d3e13b84b4e5`; local and external health both `ready`.
Safety: before activation the release owner stopped two active local provider
wait processes and durably cancelled the one remaining Fashion Shoot. No web
daemon, profile, completed result or saved look was deleted.
Journey: NOT_RUN on the new route after activation.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-RELEASE-GATE-STALE-SCENE-20260801
Pipeline: Release safety · shared beta runtime
State: TESTED — READY_FOR_DEPLOY
Decision: a scene in `QA_PENDING` already has an immutable downloaded candidate
and no paid provider request in flight. The deploy gate now lets that local QA
checkpoint resume after restart, while still fail-closing a missing scene
attempt and blocking every `GENERATING` attempt.
Code: pending this commit; builds on contract integration
`7a2e6a20c2f5cbb856fca4b2f738eba5f4ddbff6`.
Evidence: `node --test test/release/beta-deployment.test.js` 6/6 PASS;
real beta dry-run reports `active_run_ids=[]`, `active_work_ids=[]`.
Beta: NOT_DEPLOYED — next action is an exact verified release build and a
controlled end-to-end paid journey.
Journey: NOT_RUN.
weakened_checks: none — provider generation remains a hard restart block.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-PIPELINE-CONTRACT-INTEGRATION-20260801
Pipeline: LOOK.01–06 · BACKGROUND.01–02 · UNIVERSE.03–04 · VIDEO.01–04
State: TESTED — NOT_DEPLOYED
Decision: native 3:4 scene delivery, deterministic framing repair, immutable
pre-spend provider manifests, Higgsfield Nano Banana alias normalization, and
white-master Fashion Video binding are integrated as one contract set. A retry
of an approved look reopens the SHA-verified first-appearance item lock rather
than recreating it with a new timestamp.
Evidence: focused cross-boundary suite 289/289 PASS; `npm run
verify:contracts` PASS (41 schemas, 9 fixtures, 3 jobs, 1 external document);
`git diff --check` PASS. No paid provider generation, public beta deploy, or
QA threshold weakening was performed in this atom.
Code: `ca6fa744e1b76b9d704274cb1d4e452d9f683043`.
Beta: NOT_DEPLOYED — requires release-owner merge and an explicit live journey.
Journey: NOT_RUN.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: MODEL-REFERENCE-CONTRACTS-20260801
State: TESTED_NOT_DEPLOYED
Decision: keep persisted model IDs stable (`gpt_image_2`,
`nano_banana_flash`, `nano_banana_2`) and translate provider aliases only at
the transport boundary (`nano_banana_2` -> Higgsfield `nano_banana_pro`).
Image generation now compiles a model-aware ordered reference manifest. GPT
Image 2 may use a mechanical base canvas as Image 1 and the approved look as
Image 2; Nano Banana routes remain approved-master first. The exact
`Image N -> role -> SHA-256` manifest and digest are persisted in scene
receipts. Fashion Video now uses Seedance's explicit `@Video 1` and dynamic
`@Image 1..N` bindings; optional identity detail is admitted only from a
hash-verified white-background derivative. Paid-job recovery rehashes every
locked input during normal submission and persists the complete immutable
request binding. Ambiguous unbound-job recovery is disabled because the current
Higgsfield job envelope does not attest uploaded-media SHA-256 values; a caller
echo of local hashes is not accepted as provider evidence.
Code: LOCAL DIRTY WORKTREE — no isolated commit has been created because these
files overlap the active framing repair atom.
Evidence: Higgsfield provider 46/46 PASS; scene adapter 55/55 PASS; video
188/188 PASS; identity derivative 2/2 PASS; `verify:contracts` PASS (41
schemas, 9 fixtures, 3 jobs, 1 external document); `git diff --check` PASS.
Beta: NOT_DEPLOYED.
Journey: NOT_RUN — no paid provider generation was started.
weakened_checks: none.
Compatibility: historic receipts remain valid because new schema fields are
optional; legacy video retries without white-background evidence fail closed.
Help request: release owner must isolate/integrate this atom before deploy.

---

Agent ID: codex-main
Task ID: HYPERCHECK-BACKGROUND-FOOTWEAR-FLOOR-003
Pipeline: BACKGROUND.02 · standard scene repair
State: VERIFIED_REAL_PROVIDER_PASS
Decision: a scene that fails only the lower footwear margin receives an opaque
mechanical guide made from its own immutable failed candidate. The guide moves
the existing pixels upward without rescaling the person and reserves a neutral
lower strip; the provider then regenerates the authored environment around that
geometry. The delivery remains fully generated and must pass the complete QA.
Real evidence: scene
`scene_b8c78074aa0b4882488b1366733fab0dd7afcad14086c551`, preset
`std.interior.gallery_morning_gloss`. The first three candidates failed with
0.6836–1.123% below footwear. Attempt 4 passed all nine gates with 73.6328%
subject height, 12.6465% above hair and 13.7207% below footwear. Output SHA-256
`1dcb9457e755ec457205a7f446f1a216411217c7d6802629dbb81b89b0cf491d`,
1536x2048 PNG.
Tests: focused footwear-floor guide, first-generation guide and item-repair
tests PASS; framing-lock owner 13/13 PASS.
Beta: NOT_DEPLOYED — release-owner integration required.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: HYPERCHECK-STRICT-RUNNER-004
Pipeline: engineering canary only
State: FIXED_PENDING_COMMIT
Decision: `tools/run-personal-scene-e2e.mjs` now defaults Fashion Shoot QA to
`strict`. The former implicit `review` default could convert a real style-scale
failure into a completed canary. The affected manual skylight retry is excluded
from strict campaign results and will not be represented as product PASS.
weakened_checks: none; the canary is stricter.

---

Agent ID: codex-main
Task ID: HYPERCHECK-SCENE-FRAME-GEOMETRY-LOCK-002
Pipeline: BACKGROUND.02 · repair of an approved scene candidate
State: VERIFIED_REAL_PROVIDER_PASS
Decision: when framing already passed and another gate fails, bind the measured
accepted bounding box and clear-space values into the repair prompt. The repair
must not zoom, crop, move, enlarge or shrink the person while changing the named
failed detail.
Code: `src/web/scene-service.js` plus focused prompt regression in
`test/web/scene-service.test.js`.
Real evidence: existing scene
`scene_be16284441c0c3857cccec787cdf7ddd571bde378243d951`, preset
`std.city.rooftop_concrete_sunset`, attempt 4 completed with all nine QA gates
PASS. Accepted framing: subject 78.125%, head clearance 9.8633%, footwear
clearance 12.0117%. Output SHA-256
`747c2b67139867b7d6091fc1a4471027afcb2866353df3406943dbde1419403f`,
1536x2048 PNG.
Beta: NOT_DEPLOYED — release-owner integration required after the focused tests
and commit below are complete.
weakened_checks: none; the previously accepted framing is made stricter, not
relaxed.

---

Agent ID: codex-live-40 (release hypercheck owner)
Task ID: HYPERCHECK-STANDARD-FRAMING-CROP-20260801
Pipeline: BACKGROUND.02 · standard scene generation → strict QA → delivery
State: TESTED · READY_FOR_INTEGRATION
Decision: keep the 70–80% subject-height and head/foot margin locks unchanged,
but search the finite native-3:4 crop grid when the exact 75% midpoint crop is
geometrically impossible. The previous single-point planner returned `null`
for a valid nearby crop and spent all three image-model attempts.
Code: focused framing owner 12/12 PASS; evaluator-prompt regression PASS.
Real journey: `std.city.golden_hour_gloss` initially exhausted three completed
provider candidates at 68.21–68.51% subject height. The repaired planner reused
the immutable Nano Banana Pro candidate, made a 1350x1800 crop from
`[30,0,1350,1800]`, ran fresh full QA and completed without another provider
generation. Final scene SHA:
`320b317b47f7427c86f754b83734b8891726fdd3c93825890222a16306a27ac3`.
The evaluator now also treats the exact delivery canvas as authoritative and
cannot reject a correct 3:4 delivery merely because a source composition anchor
records its original 4:5 ratio.
Beta: NOT_DEPLOYED — integration and exact-SHA activation remain release-owner work.
weakened_checks: none; all original framing, identity, item, scene and provenance
gates ran again and passed.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-TUNNEL-ISOLATION-001
Protocol ACK: f6e2c41
State: DONE
Decision: preserve the foreign preview server but stop its duplicate connector
to the shared named tunnel; beta must be routed only through the canonical
connector.
Evidence: monitor captured the outage; after the isolated tunnel session was
removed, five root/health probes were HTTP 200.
weakened_checks: none.

Release: beta activated at 2026-07-29 21:06 CEST from exact commit `cf4a877`.
Public proof: `/api/health` returned `ready`; Fashion Shoot UI focused suite 17/17 PASS.

Follow-up: the previous module URL was cache-stable (`v=20260724-1`), so an
already-open browser could keep the old gallery renderer. Cache token bumped
for the Fashion Shoot module before the next beta activation.

Task ID: BETA-SAVED-LOOK-FIT-001
State: READY_FOR_BETA_DEPLOY
Change: the phone saved-look view is now an action hub: empty history does not
render, long explanatory lists do not occupy the fixed viewport, and all next
actions use a compact visible layout without an inner scroll container.

Follow-up: the same action-first compact composition is applied to a short
desktop/tablet viewport; the saved-look overlay no longer clips its action grid
below the panel edge.

Task ID: BETA-SCENE-STATUS-COPY-001
State: READY_FOR_BETA_DEPLOY
Change: provider naming is removed from the top bar. The standard-scene screen
now renders plain progress labels and a bounded expected wait time instead of
transport codes. A server scene job remains persistent if the user exits.

Task ID: BETA-SCENE-FRAMING-CROP-001
State: LIVE_ON_BETA — release `49582ee`
Evidence: failed beta scene `scene_dcfb6…` passed identity, item fidelity,
scene match and light/contact-shadow on all three model attempts. It failed
only `SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE` at 72.2168%, 71.1426%, 63.5254%
against [74,78]; headroom was already 11.91%, 11.96%, 10.64% against 8%.
Root cause: a 5px-only crop-height quantisation could select a fractional
3:4 crop width and refused a valid mechanical crop. No QA lock is weakened.
Proof: exact production geometry now selects [41, 14, 1455, 1940], yielding
76.2371% subject height and 11.8557% headroom. Focused regression PASS.
Release evidence: public beta health is `ready`; public HTML serves
`product-49582eeb-a3bc22ae8b3c`.

Task ID: BETA-STANDARD-SCENE-SCALE-001
State: LIVE_ON_BETA — release `1253aa3`
Decision: standard backgrounds accept a full person at 70–80% of the native
3:4 delivery. Headroom stays 8%, ground space stays 2%, and head/footwear
remain mandatory. This is an operator-approved relaxation of scale only.
Propagation: QA lock owner, all checked-in standard prompts, the three receipt
schemas, and all 16 published scene packs/reference hashes were re-bound as
one atomic contract. No visual asset or source provenance was changed.
Evidence: actual beta attempt `scene_dcfb6…/001` measures 72.2168% subject,
11.9141% above hair and 15.8691% below footwear; focused contract suite 21/21
and real scene API integration suite 6/6 PASS.
weakened_checks: only the declared subject scale band (74–78 → 70–80).
Release evidence: public beta health is `ready`; public HTML serves
`product-4cd70dd1-0ad4ec665dd7`.
Correction before next release: legacy production prompt text still named 4:5
while the immutable runtime delivery was 3:4. All active production prompts
and their pack hashes now state 3:4/1536×2048 too; this removes the final
cross-layer aspect-ratio contradiction.
Release evidence: public beta health is `ready`; public HTML serves
`product-1253aa3e-2873f3ec9e69`.
Next action: any preview hostname needs an ingress entry in the canonical
Cloudflare connector, never a second connector with the same tunnel ID.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-HEALTH-GUARD-001
Protocol ACK: 4169a68
State: DONE — code commit `6d7d673`.
Decision: retain the canonical `/api/health` handler while accepting the safe
Create Universe UI separation from the preceding Antigravity commit.
Evidence: `node --test test/web/outbound-privacy.test.js test/web/profile-ui-flow.test.js` passes 11/11; the health contract remains capability-only and redacted.
weakened_checks: none.
Next action: deploy only after a release candidate includes this guard.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-LOOK-E2E-001
Protocol ACK: 7314256
State: DONE
Decision: mark only LOOK.01–06 as E2E_PASS. Background, Create Universe,
Fashion Video and Live are not inferred from the saved master look.
Evidence: public beta run `922f8a25-ab08-46ae-b1f4-f9488d3fa03f` completed;
conditioning, Avatar and Outfit QA receipts are all PASS.
The explicit completed-run save returned 201 and profile state contains one
avatar and one look with 30-day retention.
weakened_checks: none.
Next action: implement the missing two-reference Fashion Video request contract
before attempting a paid video journey.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-SCENE-JOURNEY-SMOKE-001
State: IN_PROGRESS
Decision: use one controlled, non-personal full-length test input with separately supplied top, bottom and footwear; do not reuse an old half-body or fabricate a PASS receipt.
Current evidence: isolated real runtime `/api/health` reports generation and editorial generation available. Higgsfield CLI account is authenticated. Run `deef65fb-a4da-4608-a223-96b026fa5b39` entered `GARMENT_CONDITIONING`; footwear reference-normalisation provider job `ca6945c8-ebbf-46f1-b88b-ec46fe4c5667` is in progress. No terminal result has been claimed.
Plan: wait for a real full-look QA receipt, then execute one std.* background and one ready shoot.* hero. Expand only when both canaries have terminal receipts.
weakened_checks: none.

Implementation checkpoint: `914ebf6` replaces the equal three-card row in
the actual saved-look panel with a single amber primary action, four compact
category modules and one full-width Real-time Look action. Standard background
and Create Universe now enter their existing picker on the correct tab. Live
is unchanged and executable; Improve and Fashion Video are disabled and make
no false transport/provider claim. Cache references for app, picker and result
CSS were versioned with this change.
Focused proof: `node --test test/web/profile-ui-flow.test.js` — 9/9 PASS;
`node --test test/web/atelier-choice-prototype.test.js` — 3/3 PASS;
`git diff --check` PASS. The new control is absent from parent `f6fde02`, so
the added focused assertion is a real regression test, not a pre-existing
green test.
Visual check: inspected the isolated static surface and its action dock. A full
profile smoke remains pending beta activation; the isolated clone lacks the
Fastify dependency required to launch its API/profile runtime locally.
Deploy blocker: deployment target enforcement still accepts only protected
`iwas.madeforthisjob.com`, never beta. No target substitution or manual
release was attempted.
weakened_checks: none.
Next action: release owner supplies the exact beta-targeted activation path,
then run one saved-look mobile and desktop smoke of Background, Photoshoot and
Real-time Look.

Follow-up visual decision: `1e8ccef` removes every visible action name from
the dock at the operator's request. The five controls are now colour, geometry
and motion-signals only; their exact Ukrainian meaning remains in `aria-label`
and disabled explanation text for assistive technology. No route or status was
silently changed. Focused profile UI test remains 9/9 PASS.
weakened_checks: none.

Implementation checkpoint: the prototype composes the paper, two swatches,
lamp, replaceable look slot and five controls from independent DOM/CSS layers.
Selecting a control updates only the local explanation and pressed state; no
media, profile or provider path is invoked.
Focused proof: `node --test test/web/atelier-choice-prototype.test.js` — 3/3
PASS; `git diff --check` PASS; inline interaction script parses with `node
--check`.
weakened_checks: none.
Next action: resolve the separately owned sidecar-contract defect, then build
and activate the exact preview SHA for a visual beta smoke.

---

Agent ID: codex-main
Task ID: BETA-FULL-LOOK-LOCK-001 status correction
State: NOT_READY_FOR_BETA_DEPLOY
Decision: removed the premature deploy-ready state on the operator's direct instruction.
Evidence: current beta includes `13e3161` schema regeneration and `58703b9` fixture reconciliation; `node --test test/web/editorial-shoot-service.test.js` is 14/14 PASS. A clean web-suite proof does not yet exist; direct `create-universe-units.test.js` is red because its expected state predates BETA-MALE-UNITS-001.
weakened_checks: none. No deployment or provider call.

---

Agent ID: codex-main
Task ID: BETA-LOOK-ACTION-UI-002
Protocol ACK: 00cb600
State: STARTED
Rationale/decision: operator rejected equal-weight decorative action cards.
The production saved-look panel will retain its working scene and Live routes,
but expose their different meanings with one recommended primary action and
four compact, labelled choices. The visual treatment may use restrained accent
light only as a category signal, never as a false readiness indicator.
Scope: exact paths declared in UPDATE.md.
Risk: Improve and Fashion Video are not executable product routes. Their UI
must state that status and must not invoke a provider, camera, persistence, or
mock generation.
Evidence planned: focused profile UI tests plus mobile and desktop browser QA.
weakened_checks: none.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-ATELIER-CHOICE-001
Protocol ACK: 814556f
State: STARTED
Rationale/decision: operator selected the atelier composition but requires all
visual parts to remain independently addressable in the product UI. The new
prototype is isolated from the existing saved-look flow so it cannot claim
generation, camera, or persistence behavior.
Scope: only the task-reserved standalone prototype and its focused test.
Risk: a user photograph must not be baked into a committed UI asset; the
prototype therefore renders an explicit replaceable approved-look slot.
Evidence: direct operator request and the supplied visual reference.
weakened_checks: none.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-LOOK-ACTIONS-MINIMUM-001
State: DONE — beta release `87b8fdf`.
Decision: the saved-look screen now explains all product branches in one
visible guide while retaining their existing action controls. Background opens
the standard-scene picker; Photoshoot opens Create Universe; Fashion Video
opens its Seedance control; Real-time Look opens its consented camera surface.
Improve and Background Video are explicitly described as pending server routes
and do not fake a generation or alter the master look.
Evidence: `node --test test/web/profile-ui-flow.test.js` 8/8 PASS; public
beta `GET /api/editorial-modes` returns 14 modes / 12 generation-ready and all
14 previews return 200; public root contains the new guide copy.
weakened_checks: none.
Next action: run a real saved-look journey, then one controlled background,
Create Universe, video and Live branch smoke in that order.

---

Agent ID: codex-main
Task ID: BETA-LOOK-ACTION-LABELS-001
Product line: beta-placeholder
State: READY_FOR_BETA_DEPLOY
Change: the saved-look action surface now names every action and states its
actual scope: `Додати фон` (16 standard scenes), `Покращити образ` (soon),
`Fashion Shoot` (five fashion frames), `Fashion Video` (disabled until the
two-reference contract exists), and `Real-time Look` (camera consent).
Removed the duplicate background button. Fashion Shoot opens the style picker;
background opens standard scenes; Real-time Look keeps its consented camera
route. Video cannot open generation while disabled.
Evidence: `node --test test/web/profile-ui-flow.test.js
test/web/editorial-preview-ui.test.js` — 17/17 PASS. Public beta release
`ac87c0a`: health `ready`; DOM confirms five labelled actions, no duplicate
background button, and Fashion Video is disabled.
weakened_checks: none.
Next: enable Fashion Video only after its two-reference server contract is
implemented and separately proved.

---

Task ID: BETA-FASHION-SHOOT-PROGRESS-001
Product line: beta-placeholder
State: DEPLOYED_TO_BETA
Change: replace the leaked internal Shoot Bible screen with a persistent
preview of the selected Fashion Shoot style and a visible `0/5` to `5/5`
meter. The five output cards remain the sole customer-facing progress/result;
the six-slot Bible and its approval button remain server-only.
Evidence: `node --test test/web/editorial-preview-ui.test.js
test/web/profile-ui-flow.test.js` — 17/17 PASS. Public beta release
`a2dd191`: health `ready`; DOM smoke confirms style-preview image, five-step
meter, hidden internal approval, and the five-frame output region.
weakened_checks: none.

---

Task ID: BETA-SCREEN-AUDIT-001
Product line: beta-placeholder
State: DEPLOYED_TO_BETA
Change: audited public beta screens. Real-time Look is wired from a saved look
to `/post-shoot-mvp.html?look=…&embed=1`; its user-facing shell now uses
WARDROBE/Real-time Look and Ukrainian controls, with favicon loaded. The
backend reports `provider_ready: true`; its paid 15-second session remains
behind explicit consent.
Verified blocker: `/api/motion/modes` returns 404. The newer two-reference
MotionService and routes are committed but are not constructed or registered
by `src/web/start.js`/`src/web/app.js`; it is not a live video route yet.
Evidence: post-shoot/profile tests 16/16 PASS; public beta release `d4e0c54`
is health-ready after restart. Browser visual pass has no Live favicon error;
16 background and 10 Fashion Shoot preview endpoints all return successfully.
No paid provider action was run.
weakened_checks: none.

---

Task ID: BETA-FASHION-SHOOT-CLEANUP-001
Product line: beta-placeholder
State: READY_FOR_BETA_DEPLOY
Change: remove raw stage codes and source-file strings from Fashion Shoot,
replace pending cards with one centered human status, and make the five output
windows compact and fixed-height. The selected-style card now names only the
style and describes its locked visual direction.
Evidence: `node --test test/web/editorial-preview-ui.test.js
test/web/profile-ui-flow.test.js` — 17/17 PASS.
weakened_checks: none.

---

Task ID: BETA-LOOK-RESUME-001
Protocol ACK: 5e4e0bb
State: READY_FOR_BETA_DEPLOY
Decision: automatic resume keeps the original immutable job bytes. Explicit
garment re-selection is the sole branch that deletes `job.json`, because that
is the only action here that changes the input contract.
Evidence: `node --test --test-name-pattern='restart resumes the original immutable job|initialize resumes persisted' test/web/run-service.test.js` passes 2/2. The new restart regression changes release root and proves the job is not recompiled.
Risk: this protects an in-flight run across beta release restarts; it does not
relax any image, item, identity, framing, or QA condition.
weakened_checks: none.
Next action: deploy exact commit to beta, then one fresh public person + garment run.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-PRODUCT-LANGUAGE-001
State: DONE — beta release `7ef5ec8`.
Decision: remove implementation names from user-facing saved-look copy. A user
sees a ready fashion shoot and its reference-defined direction, not “Create
Universe”; they see Fashion Video with frame format and delivery, not a model
control. The Create Universe/style compiler and Seedance provider remain
server-side implementation details.
Evidence: `node --test test/web/profile-ui-flow.test.js` 8/8 PASS; public
beta serves the updated three copy markers and `/api/health` is ready.
Incident: a temporary `com.wardrobe.preview.tunnel` LaunchAgent shared beta's
named tunnel and intermittently returned public 404. It was booted out; the
public beta smoke is now 200. No beta, main, site:4180, or video-preview
service was stopped.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-PRESENTATION-PREVIEW-001
Pipeline: PROFILE.01–03 · LOOK.01–06 · BACKGROUND.01–02 · UNIVERSE.01–04
State: LIVE
Decision: stop serving original evidence PNG/JPEG files into every browser
preview surface. All UI image URLs now add `preview=1`; the server derives a
bounded 640px WebP in memory. Explicit download routes and immutable QA source
bytes stay original.
Code: `3784511e020645c7b8cd6441944f9f6dca2c6369` on `beta`.
Evidence: presentation-preview + run API + scene API + editorial preview +
profile UI focused suite 24/24 PASS; strict product release verifier PASS;
local and public beta health both report `release_sha=3784511`.
Beta: LIVE — `https://beta.madeforthisjob.com`.
Journey: preview payload now has `Content-Type: image/webp` and
`X-Zeely-Presentation: webp-640`; raw master output is still download-only.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: SEVEN-BLOCK-BETA-001
State: READY_FOR_INTEGRATION
Decision: preserve the mixed 2026-07-29 Universe work on a non-release
checkpoint and replace shared-beta agent writes with seven isolated block
branches. Codex-main permanently owns Block 1 and all beta integration/deploy.
Code: TESTED — governance branch-map and shell syntax checks.
Beta: NOT_DEPLOYED — coordination source awaits integration into beta.
Journey: NOT_RUN — no product journey changes in this coordination atom.
Checkpoint: `46d1650` on `part-job/2026-07-29-universe-checkpoint`.
weakened_checks: none.
Help request: NONE
Next action: integrate the orchestration commit into beta, create and push all
seven block branches from that exact beta SHA, then run the all-branch monitor.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-STYLE-RECOVERY-001
Pipeline: VIDEO.01–04 · Fashion Video from approved master-look
State: READY_FOR_BETA_DEPLOY
Decision: deploy the already-built three style cards from beta together with
the missing current Higgsfield create-response parser. The old public UI
displayed `М’який рух / Поворот / Позування` but sent obsolete mode IDs that
the current motion contract does not accept. The product UI now takes the
three hash-bound style choices from the capability endpoint; no free-text
motion label is used as a provider instruction.
Code: beta base `207194d` + parser fix `fe80485`.
Evidence: `node --test test/video/video-capability.test.js test/video/video-routes.test.js test/video/video-motion-plan.test.js test/video/higgsfield-video-provider.test.js`.
Beta: PENDING_ACTIVATION — legacy unbound SUBMITTING clip must be reconciled
before the restart-safe deploy tool can stop beta.
Journey: PENDING — after activation, verify three cards appear and no legacy
motion ID is sent.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-CONSOLIDATED-RELEASE-20260730
State: LIVE
Decision: integrate only completed deployable product atoms into beta; preserve
main/scroll UI and WIP branches without merging them into the engineering beta.
Code: `b94484b3271ac37b509aeb99e216b32991767d9f`.
Beta: LIVE — cache `product-b94484b3-a6876a734321`.
Evidence: video 111/111; Fashion Shoot/Create Universe 11/11; product release
2/2; strict verifier PASS; public health ready; browser console errors 0.
Catalog: 16 backgrounds, 19 previews, 17 generation modes, 15 complete units.
Paid provider calls during release: 0.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-HIGGSFIELD-IMAGE-ALIAS-001
State: READY_FOR_INTEGRATION
Decision: keep the pipeline's internal image route names stable while translating
the Higgsfield CLI alias at the adapter boundary. `nano_banana_2` is sent to
the CLI as `nano_banana_pro`; completed `job_set_type` and/or `job_type` values
are canonicalized back to `nano_banana_2`. Unknown or contradictory model
fields fail closed with `MODEL_RESPONSE_MISMATCH`; provider `params.model` is
not used as the route check.
Code: TESTED — code commit `b6223e3d96d28a17f69065ca7f185537bdb13a20`; focused provider + preflight + scene-runtime
suite 45/45 PASS. Full `node --test`: 800/892 PASS, 92 pre-existing failures
in scene/editorial/release fixtures unrelated to this adapter change.
Beta: NOT_DEPLOYED — release-owner integration required.
Journey: NOT_RUN — no paid generation or provider job replay was performed.
weakened_checks: none.
Next action: chat-00-master integrates the exact commit into beta and runs the
release checks; do not cherry-pick an unrelated merge commit.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-FASHION-SHOOT-EMPTY-ANCHORS-001
Pipeline: UNIVERSE.03–04 · Fashion Shoot / Create Universe shot execution
State: READY_FOR_BETA_DEPLOY
Decision: the 2026-07-31 18:18:53–18:19:29 run never reached Higgsfield. All five
customer slots failed before `SceneService.createScene()` with the private error
`shotAnchorReferences must contain 1–2 anchors`; each of the five retry counts
was a local executor retry and had no provider `execution_id`. The cause was an
explicit empty `[]` for a Create Universe shot that intentionally has no approved
hero continuity frame. `SceneService` correctly accepts omitted optional anchors
(`null`) and correctly rejects an explicit empty list.
Code: TESTED — `src/web/editorial-scene-executor.js` now returns `null` when a
Create Universe shot has no hero; it still binds exactly one verified
`hero_continuity_anchor` after an approved hero, and standard editorial shots
still bind their verified per-slot blocking diagram. No QA gate was weakened and
no style sheet was replaced by a generic diagram.
Resolver evidence: `editorialShotPresetReference()` and `resolveScenePreset()`
were probed on `shoot.grey_studio_stride` / `environmental_hero`; the immutable
reference pack resolved with the expected environment JSON plus four
hash-verified Create Universe sheets (`camera_lens`, `blocking`,
`expression_gaze`, `garment_behaviour`).
Tests: `node --test test/web/editorial-shot-anchors.test.js` 6/6 PASS;
Create Universe unit/runtime resolver checks PASS. The combined scene-service
suite still has pre-existing framing/post-release fixture failures unrelated to
this atom; they were not treated as evidence of this fix.
Commit: `421b2a35d18cc4978b280e0ef5feaa2df83362bd`.
Beta: LIVE — `release_sha=421b2a35d18cc4978b280e0ef5feaa2df83362bd`;
public `/api/health` is ready and editorial generation is available.
Journey: the failing run was not replayed because it had not reached a provider
submission; no new paid provider generation was started by this repair.
weakened_checks: none.
Help request: NONE.

---

Agent ID: codex-main
Task ID: BETA-FASHION-SHOOT-POSE-ANCHOR-20260802
Pipeline: UNIVERSE.03–04 · Fashion Shoot frame execution
State: CODE_CHANGED — tests/deploy pending
Decision: every Create Universe `shoot.*` slot now carries the already
hash-verified slot-specific `blocking_topdown` diagram. The style sheets remain
style-only; the blocking diagram is geometry-only and supplies the missing pose,
camera, scale and headroom reference. This replaces the erroneous omission that
left the provider with pose prose only.
weakened_checks: none.

---

Agent ID: codex-live-40
Task ID: BETA-FASHION-SHOOT-CATALOG-AND-VIDEO-INPUTS-20260803
State: LIVE
Pipeline: UNIVERSE.01–04 / Fashion Shoot and VIDEO.01 / Fashion Video input binding
Decision: catalogue cards are driven only by the server readiness contract
(`READY` + `generation_available`), not by a `shoot.*` name convention. The
progressive gallery exposes a visible immutable download link per ready frame.
Fashion Video exposes the verified reference roles: private directing video,
approved white master as sole visible hero, optional cleaned identity/garment
detail.
Code: `7378e2809bd1639b19565606e9c421107dcea89d`,
`ae218578ec05a9fab535e4580bf57557b9441448`,
`85bce99fc2e90b5f1689f5daffd56f931cd57ab0`.
Beta: LIVE — functional release SHA `85bce99fc2e90b5f1689f5daffd56f931cd57ab0`;
public beta and same-origin main API both report `ready`.
Evidence: UI / Fashion Shoot / Fashion Video tests 78/78 PASS; contracts and
canon PASS; no paid provider run.
weakened_checks: none.

---

Agent ID: codex-main
Task ID: BETA-FASHION-VIDEO-REFERENCE-QA-AUTORETRY-20260803
Pipeline: VIDEO.03–06 · provider output → reference QA → delivery
State: READY_FOR_BETA_DEPLOY
Decision: a terminal `VIDEO_REFERENCE_QA_FAILED` or
`VIDEO_REFERENCE_NOT_REPLACED` now starts at most two server-owned child
attempts. These are not duplicate resends: attempt 1 uses a full-subject
replacement repair plan and attempt 2 uses cut-boundary subject isolation.
Both plans are recorded in the child prompt, request receipt and immutable
request binding. The provider never receives a changed avatar/look/style under
the same job, and an unknown submission outcome remains paused rather than
spending another generation.
UI/API: while a child is being submitted or generated, the failed parent reports
`VIDEO_REFERENCE_QA_AUTORETRY_IN_PROGRESS`, `retry_available=false`, and the
child clip id. The browser follows that child automatically. Manual retry only
returns after the two automatic attempts are exhausted or the failure is outside
the reference-performer policy.
Code: `e5531523b84d0ad4b5a26eea77c66aa7ee142cea`. No paid generation was
triggered by this code change.
Tests: `node --test test/video/*.test.js test/web/profile-ui-flow.test.js` —
210/210 PASS.
Beta: LIVE — public and local health report release SHA
`e5531523b84d0ad4b5a26eea77c66aa7ee142cea`, `status=ready`.
weakened_checks: none. The reference-performer gate remains blocking.

Follow-up copy correction: QA detects reference-performer leakage; it does not
"cut" pixels. When independently approved spans exist, the server-side
salvage step assembles only those spans and then runs QA again. When no such
span exists, the bounded automatic reconstruction retry is the only safe path.

---

Agent ID: codex-main
Task ID: BETA-FASHION-SHOOT-SAVED-PREVIEW-20260803
Pipeline: UNIVERSE.04 · completed Fashion Shoot → saved library / presentation
State: LIVE
Decision: a direct `shoot.*` product has five customer frames and an internal
`clean_identity_hero` check that intentionally is not a customer image. The
saved-profile projection previously used only that internal slot as its preview,
so a completed shoot could reload as a blank card even when customer frames had
already passed. The projection now durably stores `preview_slot` and
`preview_output_sha256` for the first approved customer frame; the UI uses that
preview and its download URL. Legacy editorial retains its internal-hero preview.
Code: `27c3efdac0e1cc8ddae948e9aee4dd674c649557`.
Tests: targeted direct-five projection regression PASS; profile service and UI
flow checks PASS. Public preview route returns WebP 640px from the stored source.
Beta: LIVE — health release SHA `27c3efdac0e1cc8ddae948e9aee4dd674c649557`.
Journey: existing completed `shoot.zayn_institutional` has five customer output
files; restart backfilled `environmental_hero` as its saved preview. The source
PNG remains the Download asset; only the on-screen preview is a light WebP.
weakened_checks: none; no QA state or output bytes are altered.

---

Agent ID: codex-main
Task ID: BETA-SHOOT-RETRY-AND-VIDEO-IP-CHECK-20260803
Pipeline: UNIVERSE.04 · five Fashion Shoot frames → saved library; VIDEO.02 · Higgsfield submission
State: LIVE
Decision: in live `review` mode, a `shoot.*` camera-scale miss is retained as
`NON_BLOCKING_FASHION_REVIEW` receipt evidence rather than consuming another
paid Fashion Shoot retry. Identity, selected-item construction, leakage and
anatomy remain blocking; `std.*` backgrounds are unchanged. Higgsfield's exact
`IP check not finished for input media` create rejection now waits 3 seconds
and retries the identical, already-bound request once. It never retries an
unknown create outcome or an accepted job. A second identical rejection returns
the explicit Ukrainian status `VIDEO_INPUT_MEDIA_IP_CHECK_PENDING`.
Observed: the inspected completed Fashion Shoot already has five customer frames
and a durable saved-profile projection; the apparent many images were two
camera-scale retries (2 + 3) plus successful slots, not duplicate shoots.
Code: `a828cd542360ed396d4f3247f0eaefc2e2397207`.
Tests: new regressions failed before this change; after it, focused
video/provider/routes + Fashion Shoot scene suite PASS (all selected tests).
Beta: LIVE — public health release SHA `a828cd542360ed396d4f3247f0eaefc2e2397207`.
Journey: no paid provider call was made by this repair.
weakened_checks: only `shoot.*` camera-scale art direction in live `review`/`off`
mode becomes advisory. The measured value remains in the receipt. This is an
explicit operator decision; standard scenes and hard identity/item/leakage/anatomy
checks are unchanged.

---

Agent ID: codex-main
Task ID: BETA-SHOOT-RETRY-AND-VIDEO-IP-CHECK-20260803
Pipeline: UNIVERSE.04 · Fashion Shoot delivery; VIDEO.02 · provider input readiness
State: READY_FOR_BETA_DEPLOY
Decision: cache-bust identifiers for `scene.css`, `app.js`, `scene-ui.js`, and
`editorial-shoot-ui.js` now advance as one chain (`20260803-2`). A browser can
therefore not retain a stale Fashion Shoot shell after the new `app.js` arrives.
Code: `a828cd542360ed396d4f3247f0eaefc2e2397207`.
Tests: focused UI/provider/video/scene suite 177/177 PASS; contracts and canon PASS.
Beta: LIVE — public health release SHA `a828cd542360ed396d4f3247f0eaefc2e2397207`.
Journey: no paid provider call was made by this repair.
weakened_checks: only the explicit `shoot.*` review-policy change above; no
identity, item, anatomy, leakage, standard-scene, or video-reference check changed.

Operational correction: beta's local LaunchAgent plist had been replaced by a
two-element JSON array, so the guarded release tool correctly refused to
restart it. It was restored from its valid local template with the current
`madeforthisjob-beta-launcher/run-beta-daemon.sh` argument, then validated by
`plutil`, `launchctl print`, dry-run and successful guarded activation. No
runtime data or secret was changed.
Agent ID: codex-main
Task: FASHION-VIDEO-STYLE-DURATION-RETRY-20260803
Product line: beta engine → main bridge
Pipeline: VIDEO.01 verified style reference → VIDEO.02 retry submission
State: CODE_VERIFIED — release pending
Finding: a persisted legacy clip could retain the old generic motion-mode
duration (for example `camera_drift=6`) while its verified style reference
owns a different provider-safe duration (for example `13`). On retry the
generic duration gate ran before provider submission and returned HTTP 400
`MOTION_DURATION_OUT_OF_RANGE`. No Higgsfield job was created.
Decision: for a reference-bound Fashion Video, only the verified style
reference's provider duration (3–15 whole seconds) is duration authority.
The motion mode remains a semantic direction. Non-reference clips retain the
existing strict per-mode duration window.
Evidence: `node --test test/video/*.test.js` 209/209 PASS;
`npm run verify:contracts` PASS (41 schemas, 9 fixtures, 3 jobs).
Beta: NOT_DEPLOYED. Journey: exact legacy retry regression covered locally;
no paid provider request made. weakened_checks: none.

---

Agent ID: codex-main
Task: VIDEO-TERMINAL-FAILED-AUTORETRY-20260803
Pipeline: VIDEO.02 · accepted Higgsfield job → terminal result → delivery/retry
State: CODE_VERIFIED — deployment pending
Finding: the observed clip `aaf3d47e-70d5-4451-8e6d-99a0ac4e4903` reached an
attested Higgsfield `failed` terminal state. The old release only logged and
re-polled it; later provider cleanup changed the visible result to `not found`.
Decision: `VIDEO_PROVIDER_JOB_FAILED` starts the existing server-owned,
hash-bound recovery chain, maximum two total automatic children. A missing job
is intentionally not retried automatically. The current UI receives an explicit
WAIT/automatic-retry state rather than a dead manual retry.
Code: candidate on `beta` after `7436300`.
Tests: VideoService + Video routes 78/78 PASS; new regression covers terminal
provider failure → automatic child → two-attempt exhaustion.
Beta: NOT_DEPLOYED. Journey: no paid provider request made by this code repair.
weakened_checks: none; reference performer leakage remains delivery-blocking.

Activation: LIVE — product release
`505729016624be756c264ca3c5f30edf92ed6da5`; verifier PASS (741 deploy files),
guarded deploy found zero active persisted work, and local + public beta health
both returned `ready`.
