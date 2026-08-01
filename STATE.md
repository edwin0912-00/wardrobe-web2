# Wardrobe verified state

## Create Universe transport repair — 2026-08-01

- The immutable style pack remains seven sheets per `shoot.*` unit, and the
  resolver still validates all four image sheets including the generic
  `blocking` board.
- Per-frame provider transport now uses only the three slot-safe sheets:
  `camera_lens`, `expression_gaze`, and `garment_behaviour`.
- If the provider attachment budget is exceeded, those three sheets are packed
  mechanically into one horizontal authority image. The pack cannot address an
  undefined fourth cell and records its three source hashes and layout.
- A focused regression covers four items plus a mechanical framing guide, the
  live failure shape. No paid generation or beta activation has run for this
  repair yet.
- Code: `release/candidate-20260801`, pending release-owner integration.
- Beta: NOT_DEPLOYED. Journey: NOT_RUN. `weakened_checks: none`.

## Block 6 capability integration — 2026-07-30

- The consolidated beta source now has one backend capability contract for
  Fashion Video. It verifies the approved master-look receipt/image, selected
  style pack and motion reference by SHA before the existing VideoService may
  create a provider job.
- The GET readiness route and POST create route use the same contract. Missing
  resolver or incomplete evidence fails before provider spend.
- The saved-look Action Hub was deliberately not replaced by Block 6's older
  UI implementation. Focused video/profile/Live regression is 130/130 PASS.
- Code proof is ready for deployment. A real beta journey remains unavailable
  until the runtime supplies a verified motion-reference resolver.

## Seven-block coordination state — 2026-07-29

- `beta` remains the tested integration/deploy line.
- Seven `beta-block-*` branches isolate product ownership; only `codex-main`
  integrates and deploys.
- `antigravity-qa` is a permanent read-only browser observer on
  `beta-block-08-antigravity-qa`; it reports exact deployed-SHA journeys and
  owns no product paths.
- Block 1 is permanently owned by `codex-main`: person/clothing inputs,
  extraction, candidate routes, avatar, master look, immutable receipts and
  all core plus standard-background QA.
- The pre-split mixed Universe work is safely preserved at `46d1650` on
  `part-job/2026-07-29-universe-checkpoint`. It is not deployable evidence:
  14/16 focused tests pass and the strict runtime draft currently disables all
  ten `shoot.*` routes.
- Ephemeral Playwright and generated QA output was copied with SHA-256 inventory
  to the external SSD and deliberately excluded from Git.

## Current reconciliation — 2026-07-29

See `BLOCK_STATUS.md` for the canonical compact matrix. Verified directly on
the beta host today: health is `ready`; 16 standard-background cards and 14
Create Universe modes are served (12 generation-available); the existing
post-shoot API is 200; the new `/api/video/*` routes are 404. Therefore the
branch contains capabilities that the live host does not yet contain. No
agent may collapse these facts into a single "live" claim.

## Look-reference route — active on beta, controlled journey passed

- Avatar and garment-reference processing has a reversible server route
  setting. `fast` is explicitly Nano Banana 2 → GPT Image 2 → Nano Banana Pro;
  it is not an arbitrary model permutation and does not apply to backgrounds
  or Fashion Shoot.
- The garment source/candidate rule is stricter where evidence exists and does
  not manufacture a requirement for hidden details. A raw side shoe stays a
  side-oriented evidence request; hidden sole/rear facts remain UNKNOWN.
- For look-reference preparation, operator-approved close surface-rendering
  differences (weave, grain, gloss, microtexture) are advisory rather than a
  route-blocking mismatch. This is not a waiver for changed product identity,
  silhouette, visible design/branding, color, panel layout or distinctive
  geometry. Focused tests are 19/19 PASS. Beta release
  `release-babd2c6-1785354288108` from commit `babd2c6` is active; strict
  release verification and local/public health returned `ready`.
- Focused code proof: `node --test test/runner/model-policy.test.js
  test/web/garment-conditioner.test.js test/providers/codex-vlm-evaluator.test.js
  test/runner/pipeline-runner.test.js` — 27/27 PASS. Beta release
  `release-bda3ee9-1785350382449` is active; its local and public health both
  returned `ready`. Controlled public run `01b1195f-4653-4275-9293-cdc66fc58cfd`
  completed and was saved to its browser profile. It recorded a Nano Banana 2
  footwear retry followed by GPT Image 2 PASS; avatar and complete-look QA PASS.

## Restart / resume — active on beta, controlled journey passed

- The verified source of the observed beta `SIGTERM` is the dedicated deploy
  adapter's required `launchctl kickstart -k`. The adapter now refuses to
  kickstart while persisted executable work is active. The installed hourly
  boot guard uses the same persisted-work scan: a transient health failure
  logs `BLOCKED beta.kickstart.active-work` instead of restarting a live job.
- Garment preparation now writes immutable per-attempt candidate/QA receipts.
  Tests prove a simulated daemon stop resumes on the next provider and a
  candidate saved before a receipt is QA-resumed, not regenerated.
- Focused proof: `node --test test/web/garment-conditioner.test.js
  test/release/beta-deployment.test.js test/runner/model-policy.test.js
  test/runner/pipeline-runner.test.js test/providers/codex-vlm-evaluator.test.js`
  — 32/32 PASS. Beta release `release-bda3ee9-1785350382449` is active. The
  deploy adapter reported the controlled run id while it was RUNNING, proving
  that it would refuse a restart instead of sending `SIGTERM`.

## Background catalog release proof — 16, not an unverified five

- The beta resolver expands `selected_preset_ids`, which currently names 16
  standard backgrounds. The former release verifier checked only a stale,
  hard-coded subset of five. That would have left eleven background packs
  outside the full hash/reference verification performed before deployment.
- The verifier now derives its complete pack loop from the approved candidate
  file and requires exactly the 16 selected IDs. A release build verified all
  16 packs; it did not trim the live catalog to match the old test.

## Git ↔ beta release truth — 2026-07-29

- Immutable pre-reconciliation backups exist for the complete Git history and
  exact active beta release. Raw runtime runs, uploads, drafts and credentials
  are not part of those code/release backups.
- `origin/beta` is the code authority. Active `release-*` directories are
  generated deploy outputs and must never be edited as source.
- At the capture point the active release was
  `release-1253aa3-20260729191158` (`1253aa3`) and GitHub beta was `88a20ac`.
  The only intervening GitHub change was a release-journal entry, not product
  code. `ops/RUNTIME.json` was corrected from an obsolete 28 July release to
  the captured active release.
- Runtime receipts and logs are operational evidence. They may justify a
  reviewed source change, but are never copied into Git as code.
- The Fashion Shoot deployment verifier previously duplicated an obsolete
  four-style catalog while the strict product-release verifier and live catalog
  carried 14 styles. That duplicate was removed; the strict release verifier
  is the one exact-catalog owner, while deploy additionally checks manifest
  structure and then probes the activated API.
- The deploy-file allowlist now admits the whole hash-bound mood-card root;
  manifest inventory and SHA-256 verification still decide the exact files.
- Beta release `release-95beffb-202607291945` is active and public health is
  `ready`; its Fashion Shoot catalog reports 14 styles, 12 generation-ready,
  and 10 `shoot.*` units. The generic deploy transaction remains incompatible
  with the separately established beta runner (`com.madeforthisjob.beta`), so
  it must be reconciled before it is used for beta again; it was not bypassed
  for source code or content verification.
- `tools/deploy-beta-release.mjs` now owns beta activation: it verifies a
  clean candidate before staging, atomically updates the beta runner pointer,
  restarts `com.madeforthisjob.beta`, probes local/public health, and rolls the
  runner pointer back on a failed health check.
- The beta adapter completed its first real activation on 2026-07-29: clean
  candidate `5b452ab` → staged beta release → `com.madeforthisjob.beta`
  restart → local and public `ready`. The previous runner file is retained as
  an on-host rollback backup; the temporary candidate was archived externally.

## Current release truth — 2026-07-27

This section supersedes every earlier “Fast-mode live position” statement
below. Earlier sections are preserved only as historical evidence.

- Safe baseline: `main`. Shared working branch: `beta`; every agent fetches
  `origin/beta` immediately before beginning a task rather than relying on a
  copied SHA in this document.
- Running product release: `abd9afd`; later branch commits have intentionally
  not triggered a deployment. Its release directory measures 481 MiB, but the
  160 MiB value is only a product-test assertion, not a deploy/verifier/server
  ceiling. Treat it as a capacity signal, not a release blocker.
- Beta environment: `https://beta.madeforthisjob.com` — health verified
  `ready`; focused non-billable regression is 20/20 PASS.
- Live catalog facts: 16 standard backgrounds; `/api/editorial-modes` exposes
  9 mode records; five `shoot.*` cards are published, four are integrity-ready,
  and Terracotta remains blocked by its real reference hash mismatch.
- `dbc2442` (Art Fashion mood-card preview / correct tab counts) and `6e9cc68`
  (saved-look panel layout) are ancestors of `39442c4`. They are live code, but
  their browser visual smoke is a separate QA task, not inferred from tests.
- Lucy is no longer accurately described as “mock only”: live code has a
  server-token route and an explicit 5-second/$0.20 consent guard. A request
  without consent returns HTTP 409; no consented request/provider session was
  made here. The UI currently lacks the explicit Video-versus-Live choice that
  its own pipeline graph declares, so `BETA-POSTSHOOT-RECON-001` owns that
  correction before the feature can be called complete.
- The authoritative assignments and agent messages are in `UPDATE.md`.
- `TASKS.json` is retained as an archival typed ledger only. Its six expired
  active leases (`MONITOR-002`, `UI-002`, `FASHION-001`, `SMOKE-001`,
  `SMOKE-002`, `RELEASE-001`) are now `CANCELLED`; agents must not revive them
  or use their old branches. This removes false “active” work from the legacy
  validator without discarding its evidence.
- Video QA has a real input-contract finding: a look with only one declared
  garment cannot guarantee bottoms or footwear in a downstream video. This is
  not a model-quality excuse and not a reason to weaken ITEM_FIDELITY. It is
  blocked pending a narrow, evidence-backed full-look input gate.

## Historical notes — do not use as current release state
- `iwas.madeforthisjob.com` was not changed during this beta release.
- Current task board: `UPDATE.md`. Historical lanes and `TASKS.json` are not
  an assignment source for this sprint.
- Each joined agent has an ID-bound local `.agent-local/<agent-id>.md` journal
  for concise intent/decision/risk/evidence/next-action checkpoints. It is
  Git-ignored; shared `updates/` include a concise rationale/decision line and
  `UPDATE.md` remains the task-state record.
- `tools/watch-beta-board.sh` is the shared read-only live monitor: it fetches
  beta every 20 seconds and flags overlapping active scopes or help requests.
- `tools/bootstrap-beta-agent.sh` gives a replacement agent a generated unique
  ID, the current help/context, local journal, ONLINE report, and live monitor.
  `WARDROBE_AGENT_LABEL` makes that generated ID human-readable.
- Dedicated bootstrap wrappers exist for Claude Code, Antigravity, and
  OpenCloud; each uses the same beta context and monitor.
- Operator access is remote-first: `USERS.md` is the canonical rule for links
  and localhost OAuth callbacks. A host-local browser is never assumed.
- Higgsfield host authentication is verified active. Magnific is not an active
  beta provider: the supplied API credential received HTTP 401 and was removed
  from the host Keychain; no secret is retained in this repository.
- OpenRouter is a validated backup transport credential on the beta host. It
  remains outside Git and is not the active provider.
- Agents may self-claim one existing `READY` task when the orchestrator is
  unavailable. Parallel code is allowed where `UPDATE.md` reserves different
  concrete paths; a collision, not concurrency itself, is the blocker.
- A direct Edwin assignment is also authority for that specific agent to create
  its own path-reserved row and STARTED report. The orchestrator observes and
  resolves collisions; it is not a task-creation bottleneck.
- `BETA-SMOKE-001` PASS: beta exposes five expected `shoot.*` styles and each
  preview returns HTTP 200. The two newer male style-unit directories are not
  registered in the catalog and are therefore not yet user-selectable.
- `BETA-UNIVERSE-001` is the active product bridge for those two male style
  units. They remain `ASSETS_ONLY — NOT IN PRODUCT` until strict manifests and
  reference packs compile, the focused preview checks pass, and the exact
  tested commit is activated and smoke-tested on beta.
- `BETA-UI-001` is live on beta release `ac7259b`: a saved avatar with two or
  more looks opens the look grid so the user selects a specific look; exactly
  one look still opens directly. Focused tests: 24/24; live static-module and
  health smoke: PASS.
- `PIPELINE.md` is the canonical named-step product map. It distinguishes a
  core feature from a live beta-proven feature, without a fictitious overall
  completion count.
- `ART_SHOOT`, `VIDEO`, and `LIVE_WEBCAM` are explicit downstream blocks in
  the canonical map. None is claimed live; video and live both start only from
  a concrete approved fashion-shoot output.
- `docs/VIDEO_LIVE_CANON_UA.md` defines the current approved product boundary:
  fashion motion is source-bound; Live Director is local-first; a generated
  webcam result is labelled delayed preview and requires explicit capture.
- `BETA-POST-SHOOT-001` was owned by external agent `codex-live-20260727` and
  is now beta-smoked as the local/mock approved shoot → Video/Lucy Live MVP.
- Beta release `37e51c8` is active and health is `ready`. The post-shoot mock
  UI and validated graph API are live; real paid Lucy/WebRTC is deliberately
  disabled. All five `shoot.*` previews return HTTP 200.
- Standard-background expansion is not accepted: 11 new production plates are
  deployed but the live catalog exposes only 5 canonical cards, while the
  committed config has 21 presets against a strict maximum of 10 and fails 4
  focused catalog tests. The required resolution is a product/catalog decision,
  not a test relaxation.

## Presentation-only Light Stage — 2026-07-28

- `web/public/light-stage.js` is a portable, black-and-gold presentation block. It derives an in-memory alpha matte only from near-white pixels connected to the edge of an approved master image.
- It cannot modify master pixels, QA receipts, scene/photo-shoot/video inputs, or persistence. If the master does not have a clean white border or canvas access fails, the integration must retain the original master rather than generate a replacement.

Updated: 2026-07-28 00:45 UTC.

## Beta completion truth — 2026-07-28

- Running beta is `release-e05eb44-20260728003504`; current branch head
  `e05eb44` contains the corresponding deployment record. Pushed is not
  synonymous with deployed.
- The live catalog returns 16 `std.*` backgrounds and 12 Art Fashion modes;
  10 modes declare generation available. This proves catalog availability, not
  one complete execution through image QA and persistence.
- Live fitting is implemented with a five-second explicit $0.20 consent gate.
  Fashion video has a product choice and JSON graph, but the repository has no
  Seedance/Higgsfield video transport or video result store.
- A saved look now visibly offers Photoshoot, Fashion video and Live camera in
  one place. The Fashion video card is honest: it reports the missing real
  transport instead of producing or claiming a mock clip.
- Fashion-shoot release is now assigned as one end-to-end outcome to Claude:
  inventory all units, complete only source-valid ones, wire each into Create
  Universe, and activate/smoke beta. The previous documents-only portfolio
  task is retained as evidence but is no longer the finish line.
- Full `npm test` is currently refused before tests by the resource preflight:
  swap is 5.16 GiB, above the 1.50 GiB safety ceiling. No test result is being
  represented as a PASS while this condition holds.

## Canonical position

- Repository: `edwin0912-00/zeely-ai-engineering-test`.
- Development target: `integration/wardrobe-20260726` at
  `5df0df404f3ed5ffb81d1c4490da57f042920bed`.
- `main` is not a deployment target for this sprint. Only independently
  reviewed, scoped PRs may merge into `integration`.
- Create Universe is now wired on the `lane/INT-001/codex-main` release
  candidate: four hash-valid `shoot.*` units compile into six independent
  image-reference packs; `shoot.terracotta_hardlight` remains visible but
  blocked because six declared source SHA-256 values do not match the tracked
  bytes. This is integrity enforcement, not a product or QA waiver.
- `CTRL-002` is merged through PR #22. The repository now has a typed,
  schema-validated agent status artifact, a Git-backed report watcher, and
  exact per-task status paths. This is observability, not proof that an
  unattended external LLM is running.

## Three-hour recovery sprint

Continuation window: through 2026-07-27 10:30 UTC. Edwin has now authorized generation and
deployment in principle, but neither may run until a specific approved job and
a verified release candidate exist. Credential operations and gate relaxation
remain prohibited.

1. `MONITOR-002` — add durable typed stall diagnostics and throttled recovery
   heartbeat evidence, with sanitized API/SSE projection only.
2. `UI-002` — reproduce and repair the saved avatar/look → Add items flow in
   the public UI. If no real failing UI regression exists, it stops with a
   typed blocker rather than inventing a backend change.
3. `FASHION-001` — port the already-reviewed private immutable six-frame
   editorial contact-sheet manifest to the current integration contract. It
   indexes approved outputs only; it does not generate media or create UI.
4. `SCENE-001` — generation two carries the preserved missing contract export
   plus the evaluator's existing delivery handoff. The first scoped
   checkpoint proved the export repair, then truthfully blocked on the adjacent
   evaluator call rather than changing it out of lease. This remains one
   scene-core rule surface and does not change framing or QA policy.
5. `RELEASE-001` — make deploy and recovery enforce the declared canonical
   external health target `https://iwas.madeforthisjob.com/api/health`. The
   target is healthy now, but the current tools accept an arbitrary URL.
   Generation two measures the exact parser matrix separately from the full
   release suite: local full-suite resource refusal remains a later release
   preflight gate, not a false PASS or a waived deploy check.

The issued worktrees start at `f578c28`, while the first queue record pinned
their product baseline at `66968f9`. This exact-base mismatch was caught before
product edits and corrected. Fresh typed STARTED reports now bind the corrected
base: MONITOR-002 `c83a2a3`, UI-002 `b34d728`, and FASHION-001 `51ad26c`.
All three are IN_PROGRESS. Each lane has a separate lock, pinned source blobs,
exact status path, test-first acceptance, isolated handoff, and independent
review requirement.

`SCENE-001` generation two is DONE: PR #35 merged as `df9e887`. The current
integration checkout passes all six scene suites (60/60). The GitHub broad
baseline job remains unable to classify its pre-existing asset-hash fixture
under that runner; exact PR-merge reproduction showed only the known
`b2fd…`/`f909…` fixture mismatch, not a scene regression.

`RELEASE-001` and `MONITOR-002` are reissued against current integration
`5df0df4` (generations 3 and 2). Their old product candidates were clean, but
their former bases predated SCENE-001 and therefore truthfully failed the
task-base drift guard. The reissue changes no allowed path, acceptance rule,
or product behavior; it requires refreshed status and isolated handoff after
rebasing. The broad release suite remains a later candidate gate.

## Verified product facts

- `LOOK.07` «Покращити образ» is an operator-approved **proposal**, not a
  live feature. It sits after approved master-look and before backgrounds. Its
  future contract must lock the user-selected garments and identity; only
  unselected elements, hairstyle, subtle 15–20% makeup and a slight pose
  adjustment may be considered. No generation, pixel change or beta release
  has been performed for it.
- Fashion video now has two distinct proposed product routes. Primary
  `VIDEO.01–04` begins directly from an approved master-look and is independent
  of photoshoots/backgrounds. `BACKGROUND_VIDEO.01–04` begins only from an
  approved background result and offers exactly product-focused garment motion
  or model posing. Neither route is live or implemented by this decision.
- The planned post-look selector is a five-card `CHOICE.01–02` universe:
  Improve, Background, Photoshoot, Fashion Video and user-facing
  **Real-time Look** (technical `LIVE_WEBCAM`). Its color/motion hierarchy is
  a proposed UI contract only; no animated production UI has been shipped.
- The standalone `choice-universe-preview.html` was implemented and its
  focused static contract test passes 2/2 at beta commit `2a1a445`. Its beta
  activation is blocked before packaging by the unrelated pre-existing invalid
  editorial preview sidecar `editorial.edwin_novak.organic_contrast`; no
  manual deployment bypass was used.

- Beta preview delivery is content-addressed as of the preview-revision fix:
  background and Create Universe catalog cards carry the SHA-256 of their
  exact preview bytes in `preview_url`. Immutable image caching therefore
  cannot preserve an older visual after a new release.
- The operator approved beta publication of the eleven new hash-bound
  background packs. The published catalog retains the five prior packs so
  saved scenes remain resolvable; it now has sixteen selectable backgrounds.
  Every additional pack is bound by an exact local-pack-index SHA before the
  resolver will expose it.
- Beta is deployed at product commit `7bca845`: the 16-background catalog,
  each of its 16 preview routes, and the post-shoot page/API are live-verified
  HTTP 200. No billable image generation was run for this verification.

- Browser-bound 30-day profile persistence, avatar → look → child-look lineage,
  immutable Add-items source binding, and cross-profile denial are already in
  the backend. The reported defect belongs to the public UI transition, not a
  reason to duplicate the profile backend lane.
- The monitor already detects stale persisted runs and emits recovery behavior.
  What is missing is a durable, typed, bounded diagnostic and restart-safe
  heartbeat proof.
- A reviewed contact-sheet implementation exists on preserved source commit
  `352066443d0a8db46260db022b36f1c9b09adba1` / PR #16, but it is not yet
  safely integrated at the current base. `FASHION-001` is pinned to that
  source and may port/reprove it narrowly; it may not recreate it from memory.
- Standard scene repair code already contains the generic measured-headroom
  branch; the old `WARD-002` demand for a new failing test against a base that
  already contains the fix was invalid. It is not being fabricated.
- Backgrounds (`std.*`) and locked photoshoots (`shoot.*`) remain a required
  product split. The four unapproved photoshoot styles are blocked on supplied
  rights/reference packs, not solvable by inventing sources or spending on
  generation.
- `iwas.madeforthisjob.com/api/health` is currently healthy and is the
  operator-declared target. `RELEASE-001` must pin it in code before any
  release tool can claim it verified the intended domain.

## Live external-agent connectivity check

At 2026-07-27 09:36 UTC the local watcher successfully fetched the canonical
GitHub board for both `codecod` and `antigravity`, but returned no assignments:
their only historic leases are BLOCKED or owned by different agent ids. Two
temporary, non-product smoke leases now require each external agent to publish
a typed `STARTED` status from its exact lane branch. The test is successful
only after that status is observable on GitHub; starting a local watcher alone
is not treated as proof that an external agent is alive.

## Known baseline limitation

`node tools/coordination/check-test-baseline.mjs --base 44aa829…` reports
`UNEXPECTED_REGRESSION` on that base itself (82 affected test files). The
verified source defects are an import of `contactPointInsideFrame` in
`src/web/scene-adapters.js` with no matching export from
`src/web/scene-contract.js`, and an evaluator call that omits its required
delivery canvas. `SCENE-001` generation one proved the first repair and
reported the second as out-of-lease; generation two is formally limited to both
existing contract handoffs and regression coverage, including a separate static
acceptance check for the evaluator handoff. Scoped governance and lane
acceptance checks remain required; this fact is not a waiver and no check may
be weakened to hide it.

## Retired or blocked assignments

- `CTRL-002`: DONE.
- `WARD-002`: CANCELLED because its pinned base already has the requested
  repair; a manufactured pre-change failure would be false evidence.
- `PROFILE-001`: CANCELLED because the backend contract is already present;
  `UI-002` owns the user-visible regression.
- `MONITOR-001` and `SITE-002`: CANCELLED after stale/unfinished external
  leases; their evidence is preserved and replaced by scoped current-base
  work.
- `STYLE-001`: BLOCKED pending legitimate reference-rights evidence and a
  conforming current-base branch.

## Stop and ask Edwin

- Any new or reconstructed image pixels, including crop expansion.
- Any global or preset-specific gate relaxation.
- Any credential action, `site.madeforthisjob.com`, or port `4180` action.
- Any style-reference approval without supplied rights and hash evidence.

## Current real image-pipeline proof — 2026-07-29

- Higgsfield CLI 0.2.3 is authenticated and accepted a real controlled smoke.
  Run `deef65fb-a4da-4608-a223-96b026fa5b39` reached `CONDITIONING_QA`; its
  footwear-normalisation provider job `ca6945c8-ebbf-46f1-b88b-ec46fe4c5667`
  completed.
- Top and bottom evidence passed; footwear was correctly refused because the
  supplied source shows only one lateral view. The run is `NEEDS_INPUT`, not a
  provider failure. Required next input is the exact pair from opposite side,
  top/toe, heel and sole where relevant.
- Therefore no background or `shoot.*` image job has been claimed as passed.
  The bounded smoke resumes from a newly completed PASS full-look receipt;
  it does not retry the same insufficient source or relax the item lock.
  Redacted receipt/report: `ops/loops/create-universe-real-smoke-20260729/`.

## Public beta upload proof — 2026-07-30

- Every person and garment upload field accepts file-picker input and native
  drag-and-drop.
- PNG/JPEG/WEBP/AVIF remain unchanged. HEIC/HEIF is decoded locally to JPEG
  before the existing upload and persistence contract.
- Physical beta browser proof verified drag highlight, PNG drop, real HEIC
  decode, server draft persistence, reload, and restoration of both previews.
- Active release cache: `product-6f173677-40947f90c94b`.

## Consolidated public beta — 2026-07-30

- Active source: `b94484b3271ac37b509aeb99e216b32991767d9f`.
- Active cache: `product-b94484b3-a6876a734321`.
- Catalog: 16 standard backgrounds; 19 Fashion Shoot previews; 17 Fashion
  Shoot generation modes; 15 complete Create Universe units.
- Fashion Video runtime, retry/resume, immutable receipts, semantic first/last
  frame QA, Seedance job-set parsing and the private one-use source bridge are
  deployed. The API route is live; a new paid generation was not spent during
  this deployment.
- Public browser root rendered with zero console errors. Drag/drop and HEIC
  remain present.

## HEIC compatibility — 2026-07-30

- Active source: `c094a0ac723677b2060ce847e3ed3c68ce186067`.
- Active cache: `product-c094a0ac-91c86ff9cf9d`.
- HEIC decode order is browser native → bundled decoder → same-origin macOS
  converter. Only the resulting validated JPEG enters draft/run storage.
- Public endpoint and browser draft persistence are verified; beta is ready.

## Durable saved look and beta runtime recovery — 2026-07-30

- Active source: `afa34d8fcc92026824e20fb98c7e5e9532a772a4`; it contains the
  saved-look lifecycle repair `3a387c2674832958e682b135bdf5d9809e928674`.
- Active cache: `product-afa34d8f-8b3076d910e9`.
- Approved look image, PASS receipt and item evidence are stored as one
  hash-bound SQLite snapshot. They survive process restart and run-local
  evidence relocation/cleanup.
- The previously failing saved look now resolves three immutable item records:
  `top`, `footwear`, `bottom`; its durable snapshot exists.
- Structured HTTP 409 responses are no longer shown as a lost connection.
- Beta application and Cloudflare Tunnel are `running`; local and public health
  are `ready`.
- LaunchAgent logs and the minimal active runtime/credential set live on the
  internal SSD. Large release archives and backups remain on the external SSD.
- Evidence: focused lifecycle, scene, UI and Fashion Shoot suites PASS `40/40`;
  strict product release verification PASS; 16 background presets, 19 Fashion
  Shoot modes and 17 generation-ready modes are public.
- weakened_checks: none.

## Fashion Video reference authority — 2026-07-30

- Three operator-provided videos are stored outside Git and bound by the
  versioned `fashion.cool_style.v1` manifest.
- Every product motion mode selects exactly one reference. Seedance consumes
  the actual selected MP4; the image-only fallback fails closed.
- Runtime availability depends on the configured SSD reference root and a
  successful real-path, size and SHA-256 verification.
- Focused suite PASS `138/138`; paid generation was not run.

## Independent browser QA and runtime monitor repair — 2026-07-30

- `antigravity-qa` remains Observer 0.8 on its own branch and report paths.
- `handoff-cloud-code-qa` is a distinct Observer 0.9 with a separate branch,
  report, evidence directory, Git identity and commit hook.
- The monitor accepts an explicit beta runtime root and loopback application
  health URL instead of assuming the retired port `4173`.
- `tools/watch-beta-runtime.mjs` renders sanitized live Block 1–7 node
  transitions from the append-only beta event log.
- Public `/api/health` exposes the immutable release SHA and cache token so
  both observers can fail closed on a release mismatch.

## Fashion Video delivery audio — 2026-07-31

- Active source: `21fd0c81e91348db47bf5d9c259f1383a6577498`.
- New Fashion Video jobs snapshot the approved directing reference into the
  clip directory. `provider.mp4` is audit-only; `clip.mp4` is assembled before
  QA with generated picture and reference audio, or silence for a silent
  reference. Provider audio is never a terminal reason by itself.
- The old `bf68b3c8…` job remains ineligible: its provider-video SHA is equal
  to the `hard-sun-pose` reference SHA, which is evidence of reference-footage
  leakage. Audio assembly does not turn that into a PASS.
- Evidence: 155/155 video tests; actual ffmpeg stream verification; beta
  health ready. weakened_checks: no new paid generation was spent.

## Fashion Shoot structured-reference bounds — 2026-08-01

- Candidate integrates Claude handoff `dc67de6c860e7eb4da3cdf8a95b21a5835f3b49c`
  on current beta `7f7c271`.
- `referenceAsset()` now bounds every structured fact before hashing/packing;
  this fixes the live pre-provider failure where 90 compiled facts exceeded the
  240-character schema and every slot ended as a generic executor failure.
- Evidence on the candidate: structured-reference plus editorial/Create
  Universe tests `67/67` PASS; strict contracts and canon verification PASS.
- Beta: READY_FOR_BETA_DEPLOY until exact candidate SHA is activated. Journey:
  NOT_RUN. weakened_checks: none.
