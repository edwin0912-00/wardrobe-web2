# Wardrobe integration log

Append one entry for every change that enters
`integration/wardrobe-20260726`. The entry must be committed with the code it
describes. Claims without a command, artifact, commit, or observable result are
not evidence.

Format:

```text
YYYY-MM-DD · TASK-ID · lane head · handoff/PR
Change: …
Why: …
Evidence: …
weakened_checks: none | BLOCKED: …
```

## Entries

2026-08-02 · CHAT04-UNIMPLEMENTED-HANDOFF-CLARIFICATION · beta `26ea365` · codex-live-40
Change: distinguish Chat 04's three unimplemented scene/UI proposals from
assets that were already recovered into beta.
Why: mood-card recovery could otherwise be mistaken for delivery of its
cross-block framing, lighting and settings work.
Evidence: `updates/chat-04.md` at `62e361a` labels those items as ownership
handoff and `NOT_IMPLEMENTED`; its seven mood-card files already match beta.
weakened_checks: none; documentation only, no runtime release.

2026-08-02 · SOURCE-AND-CHAT-RECONCILIATION · beta `3240c70` · codex-live-40
Change: record the exact public beta source/release SHA and classify the
unmerged Chat 04/05 historical branches without merging stale code. Add an
explicit beta fetch rule for clones with a narrow refspec.
Why: stale local `origin/beta` refs made released code appear missing and
encouraged unsafe whole-branch recovery. Chat labels also no longer identify a
product reliably because the cinematic main lives in a separate repository.
Evidence: direct `git fetch origin +refs/heads/beta:refs/remotes/origin/beta`
resolved `3240c7069e9eaaa878b554bd02bcbfde3a6b6f52`; public beta health
reported the same `release_sha`. Chat 04 mood cards were present in that tree;
its Shutter-only blocking atom is preserved separately. Chat 05 formal
Fashion Shoot is contained; its older video modules are present in newer form.
weakened_checks: none; docs-only, no runner restart or product release.

2026-08-01 · PRODUCT-RELEASE-PUBLISHED-STYLE-ROOTS · release/candidate-20260801 · codex-live-40
Change: build the product release from the exact fifteen published Create
Universe `shoot.*` unit roots instead of copying the whole development
`docs/style-units` directory. Every published sheet remains byte-for-byte
unchanged and verifier-enforced; two unpublished workspace units stay in Git
but are not production authority.
Why: the release reached 544,255,600 bytes and exceeded its finite 512 MiB
budget solely because draft/retired source units were copied into production.
Evidence: product release deterministic/completeness test 2/2 PASS, including
full fifteen-unit hash verification and adversarial tamper rejection.
weakened_checks: none; production allowlist is narrower.

2026-08-01 · READ-ONLY-TEST-SWAP-PREFLIGHT · release/candidate-20260801 · codex-live-40
Change: stop using macOS historical swap usage as a refusal condition for
read-only test runs. Memory, CPU load, free disk and known heavy background
process checks remain active; build and deploy swap limits remain unchanged.
Why: the host had more than 50% free memory and no heavy background agents,
but old compressed/swap pages prevented the complete verification suite from
starting. A reboot would change the number without changing code safety.
Evidence: existing resource-policy tests preserve all five deploy refusal
signals; production build/deploy policies are untouched.
weakened_checks: none for build or deploy; test-only historical swap gate removed.

2026-08-01 · CREATE-UNIVERSE-LEGACY-DUPLICATE · release/candidate-20260801 · codex-live-40
Change: remove the blocked legacy `editorial.edwin_novak.institutional_modernism`
record from the public choice catalog and render only `shoot.*` modes that are
both `READY` and generation-available. Legacy preview URLs stay immutable and
legacy generation deep links still resolve to `shoot.zayn_institutional`.
Why: the prepared old preview record and the verified Create Universe style
appeared as two versions of one product, although only the `shoot.*` unit can
generate. That made a working style look broken or duplicated.
Evidence: editorial catalog/UI tests 17/17 PASS; alias/backend tests 7/7 PASS;
syntax and `git diff --check` PASS.
weakened_checks: none.

2026-08-03 · Fashion Shoot retry calibration / Video IP readiness / cache chain
Change: scoped `shoot.*` review-mode camera-scale variance to a non-blocking
receipt note; added one exact immutable retry for Higgsfield's pre-submit
`IP check not finished for input media`; advanced the linked Fashion Shoot
frontend modules as one cache-busted chain.
Why: camera art direction had spent 2+3 paid retries on an already saved
five-frame shoot, and an unaccepted video job showed only a generic failure.
Evidence: focused UI/provider/video/scene tests 177/177 PASS; contracts and
canon PASS. No paid provider work was used.
weakened_checks: only Create Universe camera-scale in explicit `review`/`off`;
identity, items, anatomy, leakage and standard-scene framing stay blocking.

2026-08-03 · Fashion Shoot retry policy + Higgsfield input-media readiness · candidate pending deploy
Change: scoped Fashion Shoot camera-scale defects to `NON_BLOCKING_FASHION_REVIEW`
only for `shoot.*` in the already live `review`/`off` policy; standard scenes
are untouched. Classified Higgsfield's exact `IP check not finished for input
media` create response as a pre-submit readiness state, persisted it, waited
3 seconds and retried the exact immutable request once. A second response is
stored and returned as `VIDEO_INPUT_MEDIA_IP_CHECK_PENDING`, not a fake timeout
or a claim that a job exists.
Why: one completed five-frame shoot appeared as many duplicate images because
two slots spent 2 and 3 retries solely on an art-direction camera band. A video
user received a generic create failure while Higgsfield had not yet accepted
their media.
Evidence: the new regressions fail against prior code and pass after the
repair; focused provider/video/routes/Fashion Shoot suite PASS. The inspected
shoot has a durable five-frame profile projection.
weakened_checks: camera-scale for `shoot.*` in review/off is advisory by explicit
operator decision. Identity, item fidelity, reference leakage, anatomy and all
`std.*` framing remain blocking. No paid generation was run.

2026-08-02 · Fashion Shoot catalogue / direct-five / video input metadata
Change: restored server-ready legacy Fashion Shoot modes to the customer
catalogue, changed the persisted scheduler guard to the exact product mode set,
and added safe Fashion Video input-role metadata plus cut count to the capability
response.
Why: UI prefix checks hid two valid styles and routed them into a one-frame
hero/Continue workflow; the video picker had no truthful explanation of which
reference is direction-only versus the approved visible person.
Evidence: direct-five legacy regression plus targeted editorial/video suite
45/45 PASS; `verify:contracts` PASS; `verify:canon` PASS.
Beta: NOT_DEPLOYED at this log entry. No paid generation.
weakened_checks: none.

2026-08-01 · SCENE-NATIVE-3-4-TEST-CONTRACT · release/candidate-20260801 · codex-live-40
Change: align the scene adapter regression fixtures with the already-approved
native `3:4` image transport and `1536×2048` delivery. The tests no longer ask a
Nano Banana fake for `4:5`, pair a GPT response with a Nano request, or expect a
crop that production explicitly forbids.
Why: four stale fixtures failed after the intentional native `3:4` migration,
while the production adapter correctly rejected their contradictory provider
contracts. Structured `composition_anchor` references remain `4:5`; only the
generated scene transport and delivery are `3:4`.
Evidence: `test/web/scene-adapters.test.js` 54/54 PASS; combined Create Universe,
editorial anchors and scene-adapter suite 68/68 PASS; production code and QA
thresholds unchanged.
weakened_checks: none.

2026-08-01 · CREATE-UNIVERSE-TRANSPORT-001 · release/candidate-20260801 · codex-main
Change: keep the complete four-image Create Universe reference pack validated,
but transport only the three slot-safe style sheets. When the eight-image
provider budget is exceeded, pack those three sheets into one mechanical
three-panel authority image; generic multi-pose blocking is not sent as pose
authority.
Why: the previous composer expected four cells after the generic blocking sheet
was intentionally removed from per-slot transport. A four-item look plus a
mechanical framing guide therefore passed three inputs and crashed on
`cells[3] = undefined` before Higgsfield.
Evidence: Create Universe transport regression 2/2 PASS; all Creative Universe
runtime-style checks PASS; `verify:contracts` PASS (41/41); `verify:canon` PASS
(43/43); no provider call or paid generation.
weakened_checks: none.

2026-08-01 · FASHION-VIDEO-QA-RETRY-AND-DEADZONE · beta `b0f76d6` · claude-code-handoff
Change: three independent Fashion Video defects, all reproduced against the exact bytes
of a real failed live clip (`d2a7fc04-cefc-4136-b929-0f55a4d17dd5`), not guessed from
source reading.
  (1) `videoService.claimRetry`/`completeRetryClaim` were defined only on the private
      `ClipStore`; `registerVideoRoutes` calls them directly on the `VideoService` facade,
      so every production retry click threw `videoService.claimRetry is not a function` —
      confirmed against the live running process (release-7f7c271, PID 85078) reading its
      actual deployed file, not a stale-code guess. Both methods now delegate from the
      facade to `#store`.
  (2) The deterministic exact-reference-copy path in `video-semantic-qa.js` marks its
      receipt `evaluator: 'deterministic/exact-reference-copy-v1'` specifically so it can
      be told apart from an ordinary VLM rejection, but `recordReferenceAdherenceQa`
      collapsed both into the same generic `VIDEO_REFERENCE_QA_FAILED`. Now reported as
      `VIDEO_REFERENCE_NOT_REPLACED`: "the model said no" and "the delivery is
      byte-identical to the directing reference, so nothing was ever generated" are
      different failures with different remedies.
  (3) The real cause of the observed live incident. Salvage correctly detected a 0.5s
      reference-performer leak via a real VLM pass (`gpt-5.6-terra`), correctly trimmed it,
      and technical QA on the trimmed file passed — the second, client-facing QA pass then
      crashed with a bare `ENOENT` before recording any verdict, and the client displayed
      it as an opaque failure. Root cause, confirmed with a manual `ffmpeg` run against the
      actual salvaged file: container duration 14.526s, last decodable frame at
      348 frames / 24fps = 14.500s — a 26ms gap the existing 50ms end-boundary margin did
      not reliably clear on this file. `ffmpeg` exits 0 and writes nothing in that dead
      zone; the following `readFile` threw `ENOENT`, which propagated to the clip's
      `failureCode` indistinguishable from any unrelated filesystem fault. `extractJpeg`
      now retreats the seek time in bounded steps (0/100/250/450ms) when `ffmpeg` produces
      no file, and raises a named `VIDEO_AUTOMATIC_QA_FRAME_EXTRACTION_FAILED` only if none
      of them recover a frame.
Why: this is the Fashion Video path directly behind the approved master look — one of the
two links in the pipeline right after the avatar step, alongside Fashion Shoot below. A
viewer who received an almost-complete, correctly-salvaged 14.5s clip saw an opaque error
instead, then a broken retry button.
Evidence: `node --test test/video/*.test.js` → 187/187 PASS; `test/providers/*.test.js` →
71/71 PASS. Each of the three fixes has a dedicated test that fails against the pre-fix
commit (`a2b263f`) and passes after — verified both ways, not asserted. No paid generation
was created in this session; the dead-zone reproduction used the exact bytes of an
already-paid, already-failed clip copied read-only from the live host.
weakened_checks: none introduced. `fashion_shoot_qa_mode: off` on the live host predates
this change and is untouched by it; still no owner authorisation recorded in `UPDATE.md`.

2026-08-01 · FASHION-SHOOT-STRUCTURED-REFERENCE-BOUND · beta `a2b263f` (already integrated,
confirmed here) · chat-00-master via `dc67de6` / `fix/shoot-structured-reference-bound-20260801`
Change: every compiled Fashion Shoot structured-reference fact is bounded at
`referenceAsset()`/`boundedReferenceFact()` before it is written into a `references[0..n]`
document, closing the gap where `spatial_cues[3]` — composed from
`Subject light interaction: ${shot.subject_lighting}` — compiled to 303 characters against
the schema's 240-character `maxLength`.
Why (independently reproduced by `claude-code-handoff` before finding this already fixed):
the live runtime record for `shoot.skylight_haze.sculptural_three_quarter` showed every one
of the five customer slots exhausting all six attempts with `EXECUTOR_FAILED: Scene
execution ended without a hash-bound QA candidate`; the actual per-attempt cause underneath
was `GENERATION_FAILED: references[0] does not match the strict structured-reference
schema`. Nothing reached a provider on any slot, so no candidate and no QA evidence ever
existed — the whole five-frame Fashion Shoot was down behind a green test suite, because
the two tests that should have caught it each covered only half the real compile path.
Evidence: `test/web/editorial-structured-reference-bounds.test.js` compiles every ready
style × every slot × every asset against the real AJV schema and fails without the bound,
passes with it — verified directly on this beta head. This is the second of the two most
important pipeline links right after the avatar step, alongside Fashion Video above.
weakened_checks: none.

2026-07-30 · BETA-BLOCK-6-CAPABILITY-PORT · beta integration · codex-main
Change: port only the server-owned Fashion Video capability contract from the
latest Block 6 branch. GET readiness and POST creation now share immutable
approved-look, style-pack and motion-reference SHA gates. The older Block 6 UI
was not integrated, so the consolidated Action Hub remains unchanged.
Why: the raw branch could report READY while its conflicting UI and a separate
unconditional POST guard disagreed. One server contract now owns both answers.
Evidence: focused video/profile/Live suite 130/130 PASS; syntax and diff checks
PASS; no provider call or paid generation.
weakened_checks: none. Missing resolver or reference hash remains fail-closed.

2026-07-29 · ANTIGRAVITY-QA-LOOP-001 · beta QA observer · codex-main
Change: add Block 0.8 as an independent Gemini/Antigravity observer. Its
bounded loop watches GitHub, tests the exact deployed beta through visible
browser UI, records screenshot/console/network/persistence evidence, and
publishes a typed verdict.
Why: integrated code and health checks do not prove that a user can complete
the public journey; the project needs a permanent third-party browser witness.
Evidence: compiled Looper contract, report-schema checker, governance tests and
one-shot all-branch watcher.
weakened_checks: none. Product files, QA thresholds, beta, main and deployment
remain read-only to the observer.

2026-07-29 · SEVEN-BLOCK-BETA-001 · beta coordination · codex-main
Change: replace direct multi-agent writes to shared `beta` with seven isolated
`beta-block-*` branches. `codex-main` owns Block 1 and remains the only
integration/deployment owner. Add per-block handoffs, join command, read-only
all-branch monitor and explicit Code/Beta/Journey reporting.
Why: parallel agents need visible ownership and status without mixing
unfinished work or making every agent a release authority.
Preservation: all secret-free current source changes were captured at `46d1650`
on `part-job/2026-07-29-universe-checkpoint`. The checkpoint is not merged
because focused proof is 14/16 and the draft makes all ten `shoot.*`
generation routes unavailable.
Evidence: governance block-map tests and shell syntax checks are required
before this control-plane commit is integrated.
weakened_checks: none.

2026-07-31 · Fashion Video terminal QA/retry repair · pending commit
Change: fixed runtime/profile status split, surfaced `CLIP_HAS_AUDIO`, and
replaced the UI’s synthetic “Generate” click with an explicit child retry
route protected by durable idempotency.
Why: a failed provider result could leave a stale `CREATED` projection, so the
browser polled forever and never reached a real retry action. A retry is a new
paid provider job and must not be automatic or duplicable.
Evidence: focused service + route tests 48/48 PASS; no provider generation.
weakened_checks: none.

2026-07-31 · Fashion Video white-master and cut-sheet repair · pending commit
Change: removed raw identity-photo media from the V2V request; Image 1 is a
verified exact-white approved master and Image 2 is only a white garment card.
Added immutable per-style timed cut sheets to the reference pack and prompt.
Why: any photo background can compete with Video 1’s environment, while a
single generic instruction can miss source-performer leakage in a later cut.
Evidence: current runtime master passes the white-surface diagnostic; focused
Fashion Video tests 69/69 PASS; no provider creation.
weakened_checks: none.

2026-07-30 · Fashion Video motion-reference authority
Change: registered three operator-provided motion videos as a content-addressed
runtime pack and wired deterministic per-mode selection into Seedance's native
video-reference input. The media remains outside Git; manifests and receipts
contain hashes only. OpenRouter refuses the unsupported video-reference
contract before a network request.
Why: Fashion Video must copy real motion/style authority rather than animate a
saved look from prompt text alone.
Evidence: real-path/size/hash verification passed for all three SSD files; all
four modes select exactly one reference; focused suites PASS 138/138.
weakened_checks: none.

2026-07-30 · Two independent browser-QA observers and beta node monitor
Change: preserved Antigravity as Observer 0.8 and added a separate external
Handoff Cloud Code Observer 0.9 with unique identity, branch, report and
evidence paths. Monitor runtime configuration now binds the current beta
runtime and loopback health endpoint; a sanitized terminal watcher maps
persisted events to Blocks 1–7.
Why: two QA writers must never share a branch or evidence file, and the live
monitor was still tied to a retired source path and port.
Evidence: focused governance/monitor tests, shell syntax, strict release and
local/public monitor health are required before activation.
weakened_checks: none.

2026-07-30 · Public health release binding
Change: release runtime loads the immutable product manifest and publishes only
its exact Git SHA and cache token in `/api/health`.
Why: independent browser QA must prove it tested the deployed release, not
merely a healthy endpoint or stale browser cache.
Evidence: manifest validation and public health regression tests.
weakened_checks: none.

2026-07-30 · Upload drag-and-drop + HEIC · `6f17367` → beta
Change: every person/garment upload field accepts pointer drag-and-drop; HEIC
and HEIF are decoded in-browser to a server-supported JPEG before upload.
Why: the deployed beta still required the file picker and rejected iPhone HEIC.
Evidence: focused upload suite 23/23 PASS; strict release verification PASS;
public beta cache `product-6f173677-40947f90c94b`; physical browser smoke
dropped PNG + real HEIC, persisted both, reloaded, and restored both previews.
weakened_checks: none.

2026-07-29 · BETA-SCENE-E2E-ROUTE-ALIGNMENT-001 · beta tooling · codex-main
Change: repaired the real-scene control runner to use RunService's immutable
approved-item-evidence reader and the one shared 3:4 scene provider map.
Why: its hand-written read facade omitted garment evidence and duplicated Nano
Banana as 4:5. Both caused immediate pre-provider failures and made a control
run falsely look like a background-model failure.
Evidence: the saved full-look resolves three approved item-evidence records;
the shared runtime map reports 3:4 for GPT Image 2, Nano Banana 2 and Nano
Banana Pro.
weakened_checks: none. This reuses the live item lock and aspect contract.

2026-07-29 · BETA-BACKGROUND-RELEASE-16-001 · beta · codex-main
Change: removed the stale five-background verifier list. Release verification
now derives the complete background loop from the approved candidate selection
and requires exactly 16 unique packs; the regression test asserts the same
full catalog count and all selected release assets.
Why: live beta resolves 16 packs, while the former verifier only performed
deep hash/reference validation for five. A successful release could therefore
silently regress eleven backgrounds.
Evidence: rebuilt candidate reports `scene_presets: 16`; product release test
passes after the change. The focused test failed against the prior verifier
because it still reported five.
weakened_checks: none. The complete 16-pack reference/hash verification is
strictly broader than before.

2026-07-29 · BETA-BOOT-GUARD-ACTIVE-WORK-001 · beta host + beta · codex-main
Change: the installed hourly beta boot guard and its tracked source now scan
persisted master runs, standard scenes and Fashion Shoot slots before recovery.
When any executable work is live, a failed health probe emits
`BLOCKED beta.kickstart.active-work` and does not call `launchctl kickstart`.
Why: the deploy adapter was the observed SIGTERM source, but a future transient
health failure in the independently scheduled guard could otherwise reproduce
the same destructive restart path.
Evidence: `zsh -n` passed for both tracked and installed guard copies; the
function returned active against the real current persisted scene/shoot work.
weakened_checks: none. Unknown/malformed job directories remain restart-blocking.

2026-07-29 · BETA-DEPLOY-ACTIVE-WORK-GUARD-001 · beta · codex-main
Change: extend the beta deploy refusal check from active master-look runs to
active standard scenes and Fashion Shoot slots. Completed history and explicit
approval-waiting states are not treated as running work.
Why: a dry-run during a real background generation showed the old guard could
have restart-killed it even though it correctly blocked an active master run.
Evidence: focused deployment test 4/4 PASS; current dry-run names only the
actual running scene/shoot ids and ignores incident/quarantine ledgers.
weakened_checks: none. Unknown durable job directories remain fail-closed.

2026-07-29 · BETA-STANDARD-SCENE-VISIBLE-FACTS-001 · beta · codex-main
Change: standard-background QA now treats an item fact that is naturally
occluded by another approved item or too small at required full-body scale as
unobservable, not as a fabricated mismatch. Visible contradiction or
substitution remains a blocking item-fidelity failure.
Why: a real white-window studio candidate passed identity, scene, contact shadow
and framing but was rejected solely because the full-body crop cannot expose
jeans waistband construction and a shoe air unit beneath an approved hoodie.
Evidence: focused adapter tests prove standard prompt scope and preserve a
visible-substitution `REVISE`; editorial remains on its existing strict scope.
weakened_checks: none. The approved master and all visible item facts remain
immutable blocking authority.

2026-07-29 · BETA-RESTART-RESUME-001 · beta activation · codex-main
Change: activated the immutable garment-attempt resume repair as
`release-bda3ee9-1785350382449`, then completed one fresh controlled full-look
and saved its avatar/master-look in the browser profile.
Why: prove the repair on the actual beta process before opening background and
Fashion Shoot branches.
Evidence: run `01b1195f-4653-4275-9293-cdc66fc58cfd` completed. The footwear
receipt records Nano Banana 2 `RETRY`, then GPT Image 2 `PASS`; avatar and
complete-look QA passed. During the running interval, the deploy adapter
reported that exact active run id and would have refused `kickstart`.
weakened_checks: none. No candidate, source hash, item, identity or framing
rule was weakened.

2026-07-29 · BETA-RESTART-RESUME-001 · beta · codex-main
Change: every garment candidate now has an immutable attempt receipt containing
the exact source hashes, route model, candidate hash and QA verdict. Restart
continues from the next model or the existing PASS candidate; a stored candidate
without a receipt is QA-resumed once. The beta deployment adapter now rejects
activation while a persisted run is QUEUED or RUNNING.
Why: beta deployment used `launchctl kickstart -k`, sending SIGTERM and
previously causing garment candidates to be regenerated and overwritten.
Evidence: targeted suite 32/32 PASS, including an injected daemon-stop test
and a no-duplicate-generation test. Adapter dry-run on the host reported
`active_run_ids: []`.
weakened_checks: none. Candidate/source hash mismatch fails closed; no raw
garment evidence, QA condition or provider route was relaxed.

2026-07-29 · BETA-LOOK-FAST-ROUTE-001 · beta · codex-main
Change: added one explicit, reversible `fast` route for avatar and garment
reference preparation: Nano Banana 2 → GPT Image 2 → Nano Banana Pro. The
default release route remains unchanged for Background and Fashion Shoot.
Also removed the prompt/QA contradiction that forced a front-facing canonical
item from a side-only source photo; unknown unseen details are now explicitly
unknown rather than a generated-candidate mismatch.
Why: side footwear input was wasting all three candidates on an orientation
that contradicted its own source evidence. This corrects the requirement; it
does not accept invented or visibly wrong clothing.
Evidence: `node --test test/runner/model-policy.test.js test/web/garment-conditioner.test.js test/providers/codex-vlm-evaluator.test.js test/runner/pipeline-runner.test.js` — 27/27 PASS; `git diff --check` PASS.
weakened_checks: none. QA still rejects positive contradictions, omitted
visible features, crop, background and product-card defects.

2026-07-29 · BETA-LOOK-FAST-ROUTE-001 · beta activation · codex-main
Change: activated the exact tested `4eb84ac` candidate through the dedicated
beta release adapter.
Why: make the fast look route and source-evidence QA correction available for
the next controlled user journey.
Evidence: release `release-4eb84ac-1785349827315`; local and public
`/api/health` both returned `status: ready`; runner contains
`ZEELY_LOOK_IMAGE_ROUTE=fast`.
weakened_checks: none. No paid fresh-look generation was spent for activation.

2026-07-29 · BETA-FASHION-SHOOT-FIVE-UI-001 · beta · codex-main
Change: Fashion Shoot picker now exposes only complete `shoot.*` Creative
Universe units; its internal identity/look check is auto-approved after PASS
and excluded from the user gallery, which presents exactly five output frames.
Why: Creative Universe contact/reference sheets are conditioning evidence, not
a sixth customer frame or a customer-facing contact sheet.
Evidence: focused Create Universe, catalog, UI state and shoot-service suite
passes 30/30. The unit audit asserts all ten selectable `shoot.*` units have
their manifest and required sheet roles.
weakened_checks: none.

2026-07-29 · Beta adapter real smoke · `5b452ab`
Change: deployed a clean immutable candidate through the dedicated beta adapter.
Why: prove the repaired beta deployment path end to end rather than leaving it
as an unexercised tool.
Evidence: adapter receipt reports `local_status: ready` and
`external_status: ready`; runner now points to the staged `5b452ab` release.
weakened_checks: none.

2026-07-29 · Beta deployment adapter
Change: added the dedicated `deploy-beta-release` adapter and focused tests.
Why: beta's persistent runner topology differs from the generic `app`
topology; treating them as interchangeable caused a safe transaction refusal.
Evidence: `node --test test/release/beta-deployment.test.js` — 2/2 PASS.
The adapter rejects an already-staged runtime release with local symlinks and
accepts only a clean immutable candidate before staging.
weakened_checks: none.

2026-07-29 · Beta Fashion Shoot activation · `95beffb`
Change: activated the strict-verified release through the actual beta runner
after its catalog/deploy duplicates were reconciled.
Why: the generic release transaction controls a different service topology and
correctly refused to stop the real beta runner; it cannot yet be the beta
activation mechanism.
Evidence: public `/api/health` is `ready`; `/api/editorial-modes` reports 14
styles, 12 generation-ready and 10 `shoot.*` entries.
weakened_checks: none.

2026-07-29 · Fashion Shoot deploy asset-path repair
Change: allowed the full hash-bound `assets/scene-mood-cards/` product root in
the deploy path checker.
Why: the release verifier accepted the current 14-style catalogue, but deploy
still allowed only four legacy preview-card paths and refused the first valid
`shoot.*` card.
Evidence: the exact candidate was refused before mutation with `Product
release path is outside the deploy allowlist:
assets/scene-mood-cards/shoot.grey_studio_stride.json`.
weakened_checks: none.

2026-07-29 · Git ↔ beta reconciliation capture
Change: created immutable pre-reconciliation Git and active-release backups;
made GitHub beta the explicit code authority and corrected the runtime ledger
to the actual active release `release-1253aa3-20260729191158`.
Why: a stale release ledger made the public beta and Git history look like two
different products even though the only source delta was a release-journal
entry.
Evidence: Git bundle verified; active release archive listed successfully;
public `/api/health` returned `ready`; `1253aa3..88a20ac` changes only
`updates/codex-main.md`.
weakened_checks: none.

2026-07-29 · Fashion Shoot deployment catalog repair
Change: removed the stale four-mode/two-generation-mode duplicate from the
deployment verifier. The trusted product-release verifier remains the single
authority for exact mode membership; deploy now verifies its signed manifest
is structurally intact and internally consistent.
Why: a valid 14-mode/12-generation-mode release passed its builder and trusted
verifier but was blocked before activation by an obsolete second copy of the
catalog.
Evidence: pre-change deployment refused the candidate with `Product editorial
generation authority is not enabled for the exact approved modes`; after the
repair focused candidate verification is pending a host-capacity recovery.
The full deployment suite currently stops before exercising its fixtures
because the host has 1.08 GiB free disk and 4.65 GiB swap, below its explicit
resource preflight.
weakened_checks: none.

2026-07-29 · Standard scene scale contract 70–80% · pending beta release
Change: widened the standard full-body scale band from 74–78% to 70–80% and
rebuilt every published standard-scene pack, its composition anchor, prompt
hash and catalog binding. Native delivery remains exactly 3:4 (1536×2048);
headroom/footwear locks remain 8%/2%.
Why: `scene_dcfb6…` attempt 01 measured 72.2168% person height and passed
every other gate. The prior band rejected a usable, complete frame.
Evidence: 21/21 framing/catalog tests PASS; 6/6 published-pack and scene API
integration tests PASS. The live request still contains an explicit 1536×2048
3:4 transport lock and rejects provider outputs of another aspect ratio.
weakened_checks: subject-scale acceptance widened by explicit operator decision;
identity, item, full-head, footwear, 3:4 geometry, headroom and ground-space
checks are unchanged.

2026-07-29 · Standard scene aspect-ratio prompt repair · pending beta release
Change: active production prompts were changed from legacy 4:5 wording to the
native 3:4 delivery wording and every corresponding published-pack hash was
re-bound.
Why: runtime already sends `aspect_ratio: 3:4`, `1536×2048` and rejects a
non-3:4 provider response; a 4:5 literal in the inherited base prompt was a
contradiction, not a fallback.
Evidence: standard contract/catalog/API suite remains 27/27 PASS.
weakened_checks: none.

2026-07-29 · Standard scene framing crop quantisation · pending beta release
Change: crop height now aligns to both the 5px mechanical grid and the delivery
ratio's integral-width step. The former 5px-only grid could refuse a valid 3:4
crop solely because its derived width was fractional.
Why: beta scene_dcfb6… failed all three routes only for subject scale, despite
headroom and all non-framing gates passing. The first candidate admits a
1455×1940 crop that yields 76.2371% subject height with 11.8557% headroom.
Evidence: new exact-geometry regression PASS. Existing 1024×1280 schema
fixtures remain failing against the canonical 1536×2048 delivery and are not
counted as proof or altered here.
weakened_checks: none.

2026-07-29 · BETA-FASHION-SHOOT-FIVE-UI-001 · 9cfcd5a · codex-main
Change: activate the DOM-safe five-frame Fashion Shoot picker on public beta.
Why: the first release had removed legacy markup while an older client line
still dereferenced it during picker boot; that was a real public UI crash.
Evidence: release verifier passed; external health is ready; public source has
the five-frame marker and no legacy-grid dereference; API reports ten READY
`shoot.*` units.
weakened_checks: none.

2026-07-29 · BETA-FASHION-SHOOT-CANON-001 · beta · codex-main
Change: preserve the single-frame experiment on a comparison branch; restore
the Fashion Shoot UI/state machine and change its user-facing product name to
Fashion Shoot.
Why: a standard Background is a one-frame scene. A Fashion Shoot is a locked
creative unit; Creative Universe contact sheets are internal style-build/QA
artifacts, not a promised user-facing output sequence.
Evidence: `comparison/fashion-shoot-single-frame-0ba63c1` points to `0ba63c1`;
focused Fashion Shoot tests pass 31/31. Three separate scene API fixture tests
remain red because their provider fixture outputs 4:5 while the delivery
contract is 3:4; they are not a Fashion Shoot UI regression.
weakened_checks: none.

2026-07-29 · BETA-TUNNEL-ISOLATION-001 · beta · routing incident containment
Change: stop the conflicting `wardrobe-tunnel` tmux session while preserving
its separate preview server process.
Why: the preview connector used the beta named-tunnel ID with a different
ingress map, intermittently returning default 404 for every beta route.
Evidence: read-only monitor recorded all-route 404s; after removal, five
consecutive root/health probes returned 200 and only the canonical connector
remained. No product code, runtime data, beta run, or preview server was deleted.
weakened_checks: none.

2026-07-29 · BETA-HEALTH-GUARD-001 · beta · release safety repair
Change: restore the canonical web `/api/health` handler after a shared-branch
UI commit removed it.
Why: release verification, beta tunnel monitoring and the public readiness
contract depend on this endpoint; it is not fake UI state.
Evidence: `node --test test/web/outbound-privacy.test.js test/web/profile-ui-flow.test.js` passes 11/11.
weakened_checks: none. Current running beta already retains this handler; the
source guard is pending a later source release.

2026-07-29 · BETA-LOOK-E2E-001 · beta `7314256` · public node journey
Change: verify the full first product block from uploaded person + garment to
persisted approved master look on the deployed beta runtime.
Why: a local/unit proof cannot establish that the public beta server actually
binds the inputs, provider jobs, QA receipts and saved outputs together.
Evidence: run `922f8a25-ab08-46ae-b1f4-f9488d3fa03f` reached `COMPLETED`.
Conditioning, Avatar and Outfit QA receipts each returned PASS; the output
manifest exposes persisted `avatar.png` and `avatar_outfit.png`.
The completed-run profile save returned 201; the same browser profile then
listed exactly one avatar and its one saved look with the configured 30-day TTL.
weakened_checks: none.

2026-07-29 · BETA-LOOK-RESUME-001 · beta · immutable restart repair
Change: retain an existing run `job.json` during automatic resume and remove it
only after an explicit garment re-selection changes the immutable input.
Why: a beta process restart recompiled release-local prompt paths, changing the
job hash while the runner checkpoint correctly remained bound to its original
job. A real public upload reached Avatar QA PASS and then failed at that guard.
Evidence: `node --test --test-name-pattern='restart resumes the original immutable job|initialize resumes persisted' test/web/run-service.test.js` passes 2/2.
weakened_checks: none. Deployment and fresh public journey evidence pending.

2026-07-29 · BETA-MANUAL-AUDIT-001 · beta · independent browser/API audit
Change: record the first independent manual checks for Look/Background,
Create Universe/Art Shoot, and Video/Live; set root UI recovery as the shared
first atom.
Why: health and catalog APIs were being mistaken for a reachable user journey.
The root page currently cannot navigate into those products.
Evidence: three read-only QA cells reproduced `Unexpected identifier
'collisionContainer'` and `scrollToSection is not defined`; direct check:
`/api/health` 200, `/api/post-shoot/pipeline` 200, `/api/video/contract` 404.
No paid provider call, camera permission or personal media was used.
weakened_checks: none.

2026-07-29 · BOARD-PROTOCOL-002 · beta · agent onboarding and block map
Change: make `BLOCK_STATUS.md` a mandatory onboarding document and require
Code/Beta/Journey labels in every product-task report; publish the current
product-block structure on the live board.
Why: code existence, beta activation, and a completed real provider journey
were being conflated as “live”, making it impossible to see what actually
changed or what still needs a node-level test.
Evidence: `bash -n tools/join-beta-agent.sh tools/bootstrap-beta-agent.sh` and
the board files are committed together.
weakened_checks: none.

2026-07-29 · BETA-SCENE-JOURNEY-SMOKE-001 · beta · full standard-scene run
Change: fixed the repair reference transport to retain the provider-required
`APPROVED_LOOK_MASTER → FAILED_SCENE_CANDIDATE` order and changed the third
mechanical layout attachment to a deterministic neutral opaque canvas.
Why: the earlier attempted priority order caused the provider to reject repair
attempts before generation; a transparent guide rendered as a dark field in
the provider viewer.
Evidence: focused mechanical-guide tests pass 4/4. Commit `694757e` is pushed
to `beta`. Real scene `scene_c5d47bf2144e1b9ecfb236dd5d9378f27c106cf54d7f65d1`
completed all three Higgsfield jobs (`8387b8a5-372f-4090-a72f-02b635999323`,
`9075d63c-0c4f-484b-9751-2a2ccd914ba6`,
`737fda57-147a-4090-86fa-dba7be8e2582`) and reached `QA_EXHAUSTED` only after
each output was evaluated. All failed the unchanged `ITEM_FIDELITY` and
`FRAMING_AND_ANATOMY` gates; full receipts remain in the isolated runtime.
weakened_checks: none.

2026-07-29 · BLOCK-STATUS-001 · separate code proof from beta journey proof
Change: add `BLOCK_STATUS.md` and make it part of the control plane.
Why: branch commits, catalog availability and real beta execution had been
reported under the same word "live", hiding that current beta lacks the new
Video API while serving healthy background and Universe catalogs.
Evidence: direct beta HTTP checks — health `ready`; 16 `std.*` cards; 14
editorial modes / 12 generation-available; `/api/video/*` 404; post-shoot API
200. No provider request was made for this reconciliation.
weakened_checks: none.

2026-07-29 · SCENE-DELIVERY-3-4 · native standard-scene output
Change: standard-scene delivery is `1536×2048` / `3:4`; GPT Image 2 and both
Nano routes request the same native ratio. Rounded 3:4 provider buckets are
rescaled only. The former 3:4→4:5 centre crop is removed.
Why: operator decision — preserve every generated image pixel rather than
discarding vertical content to fit 4:5. Reference images remain authorities
for environment, lighting, composition and palette, not delivery geometry.
Evidence: adapter geometry regression 5/5 PASS; immutable scene release test
1/1 PASS; real request binds `std.city.golden_hour_gloss` with delivery 3:4
and enters GPT Image 2 generation.
weakened_checks: none.

2026-07-28 · LIGHT-STAGE.01 · beta · portable UI component
Change: add a reusable black-and-gold `Light Stage` component, CSS, demo entry point and deterministic white-edge matte test.
Why: an approved master needs a premium 3D presentation treatment without changing any source pixels or downstream generation inputs.
Evidence: `node --test test/web/light-stage.test.js` passes 3/3; `git diff --check` passes. Component documentation explicitly refuses a generative fallback and marks its output presentation-only.
weakened_checks: none.

2026-07-29 · BETA-SCENE-JOURNEY-SMOKE-001 · real controlled preflight
Change: ran one non-mock Higgsfield/Codex full-look preflight and recorded the
typed terminal receipt instead of issuing a duplicate retry.
Why: Create Universe and standard background output must begin with a completed
PASS full look; an earlier half-body source or a manually asserted receipt is
not acceptable evidence.
Evidence: run `deef65fb-a4da-4608-a223-96b026fa5b39` reached
`CONDITIONING_QA`; Higgsfield job `ca6945c8-ebbf-46f1-b88b-ec46fe4c5667`
completed. Top/bottom passed. Single lateral footwear view was refused with
`FOOTWEAR_REFERENCE_INSUFFICIENT`; redacted receipt is in the bounded smoke
workspace. `node ops/loops/create-universe-real-smoke-20260729/scripts/check-receipts.mjs
ops/loops/create-universe-real-smoke-20260729/loop-workspace` passes; Create
Universe catalogue test passes 2/2.
weakened_checks: none.

2026-07-28 · BETA-LOOK-NEXT-ACTIONS-001 · beta `2a1a445` · preview built, deploy blocked
Change: add a standalone interactive visual preview for the five post-look
directions, with distinct slow glow/spotlight languages and reduced-motion
fallback.
Why: the operator requested the all-actions screen for visual approval before
changing the working saved-look journey.
Evidence: `node --test test/web/choice-universe-preview.test.js` passes 2/2.
`node tools/build-product-release.mjs <candidate>` stops at the existing
`editorial.edwin_novak.organic_contrast` sidecar-contract error before release
packaging. No manual copy/bypass, provider call, camera request or runtime
change was performed.
weakened_checks: none.

2026-07-28 · CHOICE.01–02 · beta · Real-time Look and choice-universe canon
Change: name the user-facing webcam route Real-time Look and define five
distinct post-look action cards with slow spotlight/glow motion.
Why: the operator wants all continuations to feel desirable and visibly
different while their light intensity communicates mode complexity.
Evidence: `PIPELINE.md` defines color, motion, reduced-motion and honest-state
rules; `docs/VIDEO_LIVE_CANON_UA.md` maps Real-time Look to `LIVE_WEBCAM`.
No UI code, camera operation, provider call or beta release was performed.
weakened_checks: none.

2026-07-28 · VIDEO product split · beta · operator decision recorded
Change: split primary Fashion Video from the later, simpler background-video
product and define their different entry points and goals.
Why: Fashion Video must be an equal button on the approved master-look, while
a clip after a generated background is a distinct product with a garment-focus
or posing choice.
Evidence: `PIPELINE.md`, `docs/VIDEO_LIVE_CANON_UA.md` and `UPDATE.md` now
define `VIDEO.01–04` and proposed `BACKGROUND_VIDEO.01–04`; no provider call,
UI code, source-pixel change, or beta release was performed.
weakened_checks: none.

2026-07-28 · BETA-LOOK-REFINE-001 · beta · product proposal recorded
Change: record the optional «Покращити образ» step between approved master-look
and standard backgrounds.
Why: the operator wants a controlled refinement of non-selected styling,
hair, modest makeup and pose without modifying the chosen wardrobe or
identity.
Evidence: `PIPELINE.md` defines `LOOK.07`; `UPDATE.md` preserves the task as
`PROPOSED` with no product paths reserved and no implementation authorization.
weakened_checks: none; no image/video provider call or pixel-generation work
was performed.

2026-07-28 · BETA-FASHION-SHOOT-RELEASE-001 · beta · operator assignment to Claude
Change: expand Claude's portfolio style-unit work into a complete fashion-shoot
release outcome: inventory, strict unit completion, Create Universe catalog
registration, focused proof, beta activation and smoke.
Why: the repo contains more work than the five historical cards, but the old
unit-only reservation allowed valid work to stop before it became selectable
on beta.
Evidence: the live catalog currently exposes ten generation-ready `shoot.*`
modes while checked-in unit directories additionally include portfolio work and
two assets-only male units. The board names every integration surface and the
required non-release status for incomplete sources.
weakened_checks: none.

2026-07-28 · BETA-POSTSHOOT-CHOICE-001 · beta `39e369a` · live activation
Change: add the three explicit post-look continuations: Photoshoot, Fashion
video and Live camera.
Why: Live had been the only visible continuation and the product contract was
already clear that a selected master-look must offer three separate products.
Evidence: `node --test test/web/profile-ui-flow.test.js` 9/9; beta health 200;
the live `/`, `/app.js` and `/result.css` expose the three choice bindings in
`release-39e369a-20260728003149`.
weakened_checks: none. Fashion video remains explicitly unavailable until its
real Seedance 2 transport, QA and persistence are implemented.

2026-07-28 · beta activation recovery · host release
Change: recover the beta daemon after the first copy of
`release-39e369a-20260728003149` omitted `node_modules` and could not import
Fastify.
Why: the failed restart returned HTTP 502; restoring the already verified
dependencies from the prior beta release was required to return the current
release to service.
Evidence: initial startup logged `ERR_MODULE_NOT_FOUND` for Fastify; after the
dependency copy and one restart, the daemon logged listening on port 4176 and
beta health returned HTTP 200.
weakened_checks: none.

2026-07-28 · BETA-FULL-JOURNEY-GATE-001 · beta `ac3d406` · release reconciliation
Change: replace the stale beta-release claim with the actual running release
`release-de07869-20260727233615` and create a concrete release ledger for the
saved-look → Background / Create Universe / Fashion video / Live / explainer
journey.
Why: current beta has valid catalog and Live surfaces, but the Video transport,
three-way choice and end-to-end smoke evidence do not exist yet and must not be
mistaken for delivery.
Evidence: live `/api/scene-presets` returns 16 cards; `/api/editorial-modes`
returns 12 modes with 10 generation-ready; `/api/post-shoot/pipeline` declares
Video and Live but `post-shoot-mvp.html` currently renders Live only; host
release daemon points to `release-de07869-20260727233615`.
weakened_checks: none.

2026-07-27 · BETA-RELEASE-001 · beta `37e51c8` · latest committed product smoke
Change: activate all latest committed beta work, including post-shoot MVP and
production background assets, then run focused local and live API/UI smoke.
Why: committed product work must be visible on beta immediately, while real
contract failures must remain visible rather than be represented as delivery.
Evidence: health `ready`; `/post-shoot-mvp.html` HTTP 200; post-shoot graph API
HTTP 200; five `shoot.*` previews HTTP 200; focused suite 44/49 PASS. Four
background-catalog failures are new (21 config entries versus strict 10); one
production-pack SHA mismatch is the known Terracotta condition.
weakened_checks: none; BETA-STD-001 remains BLOCKED.

2026-07-27 · COORD-POST-SHOOT-001 · beta · external video/live owner recorded
Change: record `codex-live-20260727` as the sole in-progress owner of the
approved-shoot → Video/Lucy Live MVP and broadcast its reserved scope.
Why: video/live implementation is assigned to another chat; duplicate edits in
its server, schema, public UI, and tests would corrupt the shared beta branch.
Evidence: commits `008ea06` and `3b05589`, its STARTED report, and its exact
reserved-path row in `UPDATE.md`.
weakened_checks: none.

2026-07-27 · release truth and task handoff
Change: record `abd9afd` as the actual beta release and assign the exact next
tasks to the connected agents.
Why: the board must distinguish measured capacity from an actual deployment
gate.
Evidence: daemon points at `release-abd9afd-20260727202146`; beta health is
ready; release directory measures 481 MiB. No product, credential, provider,
or deployment mutation was performed by this coordination change.
weakened_checks: none.

2026-07-27 · correction · 160 MiB is not a deploy limit
Change: cancel `BETA-RELEASE-SIZE-001` as a release blocker and correct the
board/state wording.
Why: the 160 MiB value was added by commit `f9326a3` as a single assertion in
`test/release/product-release.test.js`, raised from 40 MiB to accommodate five
Create Universe units. It is not present in `verify-product-release.mjs` or
the deploy script.
Evidence: `git blame` identifies `f9326a3` / `Codex Backup`; deploy calls the
verifier, and verifier checks manifest integrity but has no size ceiling.
weakened_checks: none.

2026-07-27 · legacy queue reconciliation
Change: cancel the six expired active leases in the archival `TASKS.json`.
Why: the current sprint uses `UPDATE.md`, but the legacy validator still read
those abandoned leases and reported them as current work.
Evidence: `node tools/coordination/validate-board.mjs --board-only` passes
after cancellation. The task records, commits, and handoff evidence remain in
Git; no product or runtime file changed.
weakened_checks: none.

2026-07-27 · release-pointer correction
Change: distinguish shared-branch HEAD `ab310d3` from running product commit
`39442c4` in the coordination documents.
Why: the reconciliation and legacy-queue commits contain no product code and
must not be mistaken for a beta deployment.
Evidence: the beta daemon release directory is named for `39442c4`; both newer
commits modify coordination files only.
weakened_checks: none.

2026-07-27 · BETA-VIDEO-FIDELITY-001 · QA finding recorded
Change: record the reported video lower-body/footwear failure as a blocked
input-contract issue, not a generation or model-quality issue.
Why: the submitted look evidence contained only a locked hoodie, so the video
gate had no approved bottoms or footwear to enforce.
Evidence: agent report `51d46f4`; no product code or provider call was made by
this reconciliation. A future code task must first reserve the exact affected
contract paths and preserve, rather than relax, fidelity checks.
weakened_checks: none.

2026-07-27 · BETA-STD-001 · `7bca845` live activation
Change: activate the approved 16-background catalog on beta.
Why: a code commit is not product delivery until the actual beta API serves the
new catalog and preview assets.
Evidence: beta health is `ready`; `/api/scene-presets` returns 16 entries;
all 16 hash-versioned previews, `/post-shoot-mvp.html`, and
`/api/post-shoot/pipeline` return HTTP 200.
weakened_checks: none.

2026-07-27 · VIDEO-TRANSPORT-001 · beta · Seedance 2 source-bound video decision
Change: record Seedance 2 as the intended async fashion-video transport.
Why: video generation must be distinct from local live camera and inherit an
approved art-shoot source.
Evidence: canonical video contract binds Seedance 2 to `VIDEO.03` only and
requires separate route verification before any active-beta claim.
weakened_checks: none.

2026-07-27 · LIVE-ARCHITECTURE-001 · beta · local-first camera architecture
Change: define the hardware, browser, local inference, server, provider, and
optional WebRTC transport boundaries for Live Camera.
Why: live camera must be an observable local camera experience, not an
ambiguous label for delayed cloud generation or a silent media upload.
Evidence: the canonical document cites W3C Media Capture, MDN getUserMedia,
MediaPipe Pose Landmarker and LiveKit transport documentation.
weakened_checks: none.

2026-07-27 · VIDEO-LIVE-CANON-001 · beta · source-bound motion and local-first live
Change: define the canonical video modes, immutable visual locks, QA/delivery,
and two explicitly separate live-camera products.
Why: a fashion-motion product must inherit an approved shoot, while a webcam
experience must not claim delayed generation is real-time or collect footage
silently.
Evidence: `docs/VIDEO_LIVE_CANON_UA.md` binds source, UI flow, privacy states,
and prohibited behavior before implementation begins.
weakened_checks: none.

2026-07-27 · PIPELINE-EXTENSION-001 · beta · art shoot, video, live camera map
Change: extend the named product map with separate `ART_SHOOT`, `VIDEO`, and
`LIVE_WEBCAM` blocks and require every user-visible task to ship its whole UI
unit: entry, choice, process, result, persistence, and next action.
Why: a fashion shoot must become a visible product after style selection, while
video/live are explicit downstream modes of an approved shoot rather than
unrelated generation paths.
Evidence: `PIPELINE.md` declares the source boundaries and current status for
every new step; no unbuilt path is labelled live.
weakened_checks: none.

2026-07-27 · OPS-OPENROUTER-BACKUP-001 · beta host · validated reserve transport
Change: register a validated OpenRouter credential in host-only secure storage
as a reserve transport; document the non-secret operational fact for agents.
Why: beta needs a verified fallback without exposing a credential through Git
history, task reports, prompts, or public output.
Evidence: authenticated OpenRouter key endpoint returned HTTP 200; host secure
store and private runtime file accepted the credential with mode 600.
weakened_checks: none.

2026-07-27 · PIPELINE-MAP-001 · beta · canonical named-step product map
Change: add `PIPELINE.md` and require all active tasks to name their actual
pipeline step in plain Ukrainian, without a fictitious total stage count.
Why: agents and the operator need one shared answer to what is being built,
what is live, and where each task belongs.
Evidence: all four live-board rows now link to their named step; core-only and
beta-proven status are stated separately.
weakened_checks: none.

2026-07-27 · BOARD-LANGUAGE-001 · beta · readable pipeline task names
Change: require a Ukrainian plain-language product name and pipeline stage for
every live task; retain terse IDs only for Git routing.
Why: internal ticket labels must not replace an explanation of what changes for
the user or where a task sits in the pipeline.
Evidence: `UPDATE.md` maps every current task to a readable stage and outcome.
weakened_checks: none.

2026-07-27 · BETA-UI-001 · beta `ac7259b` · multi-look selection live smoke
Change: activate Antigravity's saved-avatar selection repair on beta.
Why: selecting an avatar with multiple existing looks must reveal the user’s
choice grid, not auto-open the newest look and hide the rest.
Evidence: commit `205a8c4`; `node --test test/web/profile-ui-flow.test.js
test/web/add-items-flow.test.js` 24/24; beta health `ready`; public
`/add-items-flow.js` serves `avatarLooks.length === 1 ? 'OPEN_LOOK' :
'FILTER_AVATAR'` from release `ac7259b`.
weakened_checks: none.

2026-07-27 · BETA-DELIVERY-001 · beta · immediate beta completion contract
Change: make focused-test → exact commit → beta activation → narrow live smoke
the mandatory atomic completion path for user-facing work; assign the existing
male Create Universe assets a strict product-integration task.
Why: assets and a passing local test are not a delivered style until the
catalog can compile it and beta demonstrates the user-visible route.
Evidence: `shoot.ochre_stage_tailoring` and `shoot.shutter_amber_interior`
contain `unit.json` and reference assets but no required `manifest.json`, while
the resolver reads only modes in `CREATE_UNIVERSE_MODE_META` and requires both
files. The task reserves that resolver, two focused test files, and exactly
those two unit directories.
weakened_checks: none.

2026-07-27 · BETA-SMOKE-001 · beta · Create Universe catalog smoke
Change: mark Antigravity's catalog smoke as DONE.
Why: its report verified the public beta API and preview delivery, with no code
change or weakened condition.
Evidence: health `ready`; five `shoot.*` modes, all preview endpoints HTTP 200;
four generation-ready and Terracotta correctly excluded for SHA mismatch.
weakened_checks: none.

2026-07-27 · AGENT-AUTONOMY-002 · beta · direct-assignment task creation
Change: allow an agent directly instructed by Edwin to create its own
path-reserved task row and STARTED report.
Why: agent autonomy must not wait on the orchestrator for routine task entry.
Evidence: a new row is valid only with owner, concrete paths, testable outcome,
and no active-path collision; otherwise it stays PROPOSED.
weakened_checks: none.

2026-07-27 · AGENT-PARALLEL-002 · beta · board monitor parser repair
Change: repair the path-reservation monitor's macOS awk variable name.
Why: the initial parallel-work commit used `index`, which collides with awk's
built-in function and prevented the monitor from rendering alerts.
Evidence: `bash -n tools/watch-beta-board.sh` and one live monitor render pass.
weakened_checks: none.

2026-07-27 · AGENT-PARALLEL-001 · beta · path-reserved parallel work
Change: replace the one-code-task rule with exact path reservation; assign
Magnific provider wiring to Claude Code and publish an independent Add-items
UI task as READY.
Why: logs and the task board should enable parallel delivery, not serialize it.
Evidence: active code rows reserve disjoint paths; the board monitor now alerts
only when two active code rows reserve the same concrete path.
weakened_checks: none.

2026-07-27 · AGENT-AUTONOMY-001 · beta · continuity self-claim
Change: assign `BETA-SMOKE-001` to Antigravity and permit agents to atomically
self-claim one existing READY board row when the orchestrator is unavailable.
Why: the product must keep moving if the primary Codex session ends.
Evidence: the board has one active QA task, zero active code tasks, and the
claim protocol rejects WAITING/BLOCKED/DONE rows and push races.
weakened_checks: none.

2026-07-27 · OPS-REMOTE-001 · beta · remote operator access
Change: add `USERS.md` with the remote-first operator and OAuth callback rule.
Why: Edwin cannot approve browser windows or credentials on the build host.
Evidence: the Magnific MCP OAuth redirect is host-local; a remote browser
requires an explicit callback relay before authentication can complete.
weakened_checks: none.

2026-07-27 · FAST-007 · beta · dedicated external-agent entries
Change: add distinct bootstrap entry files for Claude Code, Antigravity, and
OpenCloud.
Why: each external agent needs an unmistakable identity prefix without manual
environment configuration.
Evidence: each wrapper fixes only its label and delegates to the tested shared
bootstrap; generated instance IDs remain unique.
weakened_checks: none.

2026-07-27 · FAST-006 · beta · readable generated agent IDs
Change: bootstrap now prefixes each generated unique ID with an optional agent
label, while retaining random uniqueness.
Why: the live board must show both who joined and which instance they are.
Evidence: dry-run generated a valid `antigravity-YYYYMMDD-hex` ID and completed
local onboarding.
weakened_checks: none.

2026-07-27 · FAST-005 · beta · one-command agent bootstrap
Change: add automatic-ID beta bootstrap and `START_HERE.md` context entrypoint.
Why: a replacement agent must be able to join, announce itself, and recover
the same project context without a manual handoff.
Evidence: dry-run cloned beta, configured an ID-bound local journal and help,
and prepared the exact ONLINE report without publishing a synthetic agent.
weakened_checks: none.

2026-07-27 · FAST-004 · beta · shared live board monitor
Change: add a 20-second read-only beta board watcher with scope-collision and
agent-help-request alerts.
Why: agents need a common live view without autonomous writes or a second
coordination system.
Evidence: isolated agent-clone smoke rendered the board and monitor alerts;
the watcher performs only `git fetch` and Git reads.
weakened_checks: none.

2026-07-27 · FAST-003 · beta · shared rationale line
Change: require each agent update to include a concise rationale/decision line.
Why: other agents need the reason for an action, not only the final fact.
Evidence: update template and agent entrypoint require the field while keeping
raw reasoning and private data out of Git.
weakened_checks: none.

2026-07-27 · FAST-002 · beta · local operational journal
Change: add an ID-bound local journal command and make beta-agent setup sync it
to the current shared board.
Why: agents need concise decision context between sessions without mixing
private scratch work with verified shared facts.
Evidence: isolated clone smoke created, synced, wrote and Git-ignored the
local journal; commit identity guard remains active.
weakened_checks: none; journals are local-only and forbid secrets, personal
media, raw prompts, hidden model reasoning, and local paths.

2026-07-27 · FAST-001 · beta · direct beta workflow
Change: create shared `beta` branch and replace lane/lease entry rules with a
single live board in `UPDATE.md`.
Why: the MVP needs small verified commits and immediate beta testing; the prior
multi-lane workflow blocked work on expired leases and PR administration.
Evidence: `beta` starts from verified Create Universe commit `90d6119`; beta
health returns `ready` and its editorial catalog returns five `shoot.*` modes.
weakened_checks: none; code changes remain serial and every beta deploy still
requires a focused test.

2026-07-27 · INT-001 · lane/INT-001/codex-main · pending PR/update
Change: add only `docs/style-units/` to the PRODUCT_SCENES_V1 deploy allowlist.
Why: the verified Create Universe resolver consumes these immutable source
units at runtime; a broad `docs/` exception would violate the release boundary.
Evidence: deploy path validation now accepts the exact source-unit subtree and
continues to reject every other `docs/` path.
weakened_checks: none.

2026-07-27 · INT-001 · lane/INT-001/codex-main · pending PR/update
Change: wire Create Universe `shoot.*` units into the editorial resolver as a
separate source-pack product: catalog, immutable PNG-reference shot packs,
preview API, source-ledger URI contract, release inventory, and verification.
Why: the five reviewed units existed only in repository documentation, while
the product exposed only legacy `editorial.*` modes. Mapping them to `std.*`
would recreate the stock-style coupling the product explicitly rejects.
Evidence: four valid units compile six shot packs each with five hash-bound
image references; focused editorial tests pass 8/8, release tests pass 2/2,
and `node tools/validate-contracts.mjs` passes 9/9. Terracotta is intentionally
catalogued as `BLOCKED_INTEGRITY_MISMATCH`: six source bytes differ from its
declared SHA-256 values.
weakened_checks: none; the release size budget is explicitly raised from 40 MB
to 160 MB because it now ships the immutable contact-sheet units, with an
allowlist and presence test for that exact directory only.

2026-07-27 · MONITOR-002 / RELEASE-001 · reissued on current integration
Change: reissue MONITOR-002 generation 2 and RELEASE-001 generation 3 at
current integration `5df0df4`, preserving each lane's exact allowed paths and
acceptance checks.
Why: after SCENE-001 merged, the prior task bases predated an unrelated product
delta and the scope guard correctly returned TASK_BASE_PRODUCT_DRIFT. Extending
an old base would hide that fact; the fresh base makes a current candidate
provable.
Evidence: all pinned required-context blobs resolve identically at `5df0df4`.
Prior code/handoff evidence remains historical only; each lane must publish a
new typed status and isolated final handoff before review/merge.
weakened_checks: none.

2026-07-27 · SMOKE-001 / SMOKE-002 · external queue connectivity check
Change: issue two 45-minute, no-product-write smoke leases to `codecod` and
`antigravity`.
Why: a local watcher proved it can fetch GitHub, but cannot prove that an
external agent process is alive until that agent publishes a typed status from
its own GitHub lane.
Evidence: each task has a unique owner, branch, lock, exact status path,
current integration base, pinned `AGENTS.md`, and a focused governance test.
Success requires an observable remote `STARTED` commit; no silence is counted
as a successful connection.
weakened_checks: none.

2026-07-27 · SCENE-001 / MONITOR-002 / RELEASE-001 · controlled continuation
Change: mark merged SCENE-001 DONE and grant the already-evidenced MONITOR-002
and RELEASE-001 lanes a bounded review/merge extension through 10:30 UTC;
extend UI-002 and FASHION-001 only to complete current-base verification.
Why: their evidence was published before the previous lease deadline, but CI
and review completed after it. No implementation, model, QA gate, runtime, or
credential scope changes with this ledger update.
Evidence: SCENE PR #35 merged as `df9e887` and its six focused suites pass
60/60 on integration. MONITOR `db22b77` and RELEASE `d62a8a8` have isolated
handoffs and prior independent PASS evidence. The broad CI baseline's remaining
asset-fixture classification is recorded separately, not waived.
weakened_checks: none.

2026-07-27 · RELEASE-001 · execution acknowledged
Change: move RELEASE-001 generation 2 from ASSIGNED to IN_PROGRESS after its
exact owner published its bounded canonical-target parser proof and report.
Why: code may proceed only after a typed owner checkpoint; this transition does
not approve a release or convert the broad resource-gated suite into a PASS.
Evidence: checkpoint `4f5616a` and report `e7fff23` bind owner, branch, exact
base `d372e6a`, and generation 2. Independent review reproduced two base
behavioral failures and passed candidate contract tests (2/2), scanner, and
diff hygiene; it found no runtime, credential, or deploy operation.
weakened_checks: none.

2026-07-27 · SCENE-001 · execution acknowledged
Change: move SCENE-001 generation 2 from ASSIGNED to IN_PROGRESS after its
exact owner published the bounded evaluator-delivery repair and typed report.
Why: the task now has observed evidence, not merely a leased intent; this
transition neither approves a scene nor changes QA policy.
Evidence: checkpoint `bbcfe71` and report `0e823ec` bind the current owner,
branch, exact base `44aa829`, and generation 2. Independent review reproduced
both exact-base failures and passed six scene suites (60/60), the source-only
static regression, scanner, and diff hygiene.
weakened_checks: none.

2026-07-27 · RELEASE-001 · reissued generation 2 at 7cb13f6 · control queue
Change: bind the lease acceptance to the exact deploy/recovery parser matrix
that owns canonical external health validation.
Why: the local full release suite is resource-refused before unrelated
assertions (swap/disk and optional image dependency), while the changed parser
tests have an independent behavioral pre-change failure on the exact base. A
handoff must not falsely mark the resource-refused broad command green.
Evidence: generation two requires one dedicated parser-contract test with
literal canonical and rejected URLs; patched onto `d372e6a` it must fail on
old/arbitrary/credential URL acceptance, and on candidate it must pass. The
full suite, resource preflight, candidate verification, and deployment remain
explicit later release gates; none is removed or declared green here.
weakened_checks: none.

2026-07-27 · RELEASE-001 · execution acknowledged
Change: move RELEASE-001 from ASSIGNED to IN_PROGRESS after a current typed
heartbeat from its exact owner/branch/base was observed.
Why: code may proceed only after the worker has read the canonical queue and
reported a bounded checkpoint; this state transition does not approve a deploy.
Evidence: `a35b7aa` started the lease and `b9fe429` recorded focused proof;
the current report binds owner `release-target`, branch
`lane/RELEASE-001/release-target`, base `d372e6a`, generation 1, and product
checkpoint `342fc42`.
weakened_checks: none.

2026-07-27 · SCENE-001 · reissued generation 2 at 721bc9a · control queue
Change: formally extend the active scene-core lease from the proven missing
contract export to the adjacent evaluator call that must pass its existing
delivery canvas into validation.
Why: generation one repaired the export and then stopped at its scope boundary;
the remaining three test failures are a second, specific handoff omission in
the same scene-core rule surface, not a reason to weaken QA or skip CI.
Evidence: preserved checkpoint `1e4cfe77` passes contact-point geometry but
leaves 56/59 scene assertions passing. The base contract already accepts
`validateEvaluatorPayload(payload, delivery)`; generation two therefore adds
only `context.delivery` at the evaluator call site and a static source test
which proves that omission on exact base `44aa829` without importing the
blocked evaluator/adapter module. It does not import or introduce any waiver
policy, makes that static proof a separate acceptance check, and requires a
new status acknowledgement before code resumes.
weakened_checks: none.

2026-07-27 · RELEASE-001 · assigned at d372e6a · control queue
Change: issue a narrow release-ops lease that makes deploy and recovery accept
only `https://iwas.madeforthisjob.com/api/health` as external health.
Why: the declared target is healthy, but current tools validate HTTPS and lack
credentials while accepting any external host; that cannot prove a release
reached the intended domain.
Evidence: read-only health check returned 200/ready for `iwas`; repository
search found no existing canonical target. The lease is limited to one shared
validator, both CLIs, their tests, and operator docs; it excludes runtime,
plists, tunnel, credentials, candidates, and deploy apply.
weakened_checks: none.

2026-07-27 · SCENE-001 · assigned at 44aa829 · control queue
Change: issue a narrow scene-core lease to restore the one missing
`contactPointInsideFrame` export and add a regression test.
Why: four scene suites cannot load on the integration base because
`scene-adapters` imports a contract primitive that is absent from its export
surface; that base failure blocks objective CI for otherwise-scoped lanes.
Evidence: `node tools/coordination/check-test-baseline.mjs --base
44aa829176b76f8da0d08233d996ebac982ff06e` fails on the base itself; the four
named suites reproduce the same ESM import error. The lease pins the exact
contract, adapter, and adapter-test blobs and prohibits any framing, QA,
provider, runtime, media, or deployment change.
weakened_checks: none.

2026-07-27 · MONITOR-002 / UI-002 / FASHION-001 · corrected execution start
Change: move the three tasks to IN_PROGRESS only after fresh STARTED reports
bound to the corrected exact base `f578c28` were observed.
Why: the earlier reports belonged to the old product-base pin and were
intentionally not used as a liveness claim after correction.
Evidence: watcher reports monitor `c83a2a3`, UI `b34d728`, and fashion
`51ad26c` with exact owner/branch/base bindings and no report issues.
weakened_checks: none.

2026-07-27 · MONITOR-002 / UI-002 / FASHION-001 · exact-base correction
Change: return the three tasks to ASSIGNED and repin their `base_sha` from
`66968f9` to the exact issued worktree commit `f578c28`.
Why: the control-only dispatch PR sat between the original product baseline
and the actual worktrees. An agent caught that mismatch before product edits;
the queue must not ask a worker to silently bridge it.
Evidence: no product changes occurred after the hold. Existing status-only
commits are preserved, including UI's typed `ASSIGNMENT_AMBIGUOUS` stop. Fresh
STARTED reports are required before execution resumes.
weakened_checks: none.

2026-07-27 · MONITOR-002 / UI-002 / FASHION-001 · execution acknowledged
Change: move all three assigned recovery tasks to IN_PROGRESS after each owner
published a schema-valid STARTED artifact on its exact Git branch.
Why: task state now reflects observed work rather than intended work; product
code may begin only after this acknowledgement gate.
Evidence: monitor `70089c7`, UI `0179927`, and fashion `3c01a19` each changed
only its matching status artifact; the report watcher resolves all three with
`STARTED / CONTEXT_READ / RUN_PRECHANGE_PROOF` and no sensitive report text.
weakened_checks: none.

2026-07-27 · recovery dispatch review revision · PR #24
Change: move MONITOR-002, UI-002, and FASHION-001 from IN_PROGRESS to
ASSIGNED until each exact worker branch commits a typed STARTED report; bind
FASHION-001 to the preserved reviewed source commit and four source blobs.
Why: independent review found that a queue must not claim liveness before an
acknowledgement, and a port task must have an immutable source rather than
invite an unreviewed reconstruction.
Evidence: independent reviewer verified all scope/lock/path/context checks and
returned REVISE only for those two control defects; the corrected board remains
schema-valid and has no overlapping active scopes.
weakened_checks: none.

2026-07-27 · CTRL-002 / recovery dispatch · integration 66968f9
Change: mark CTRL-002 DONE after PR #22, retire stale or invalid duplicate
leases, and issue MONITOR-002, UI-002, and FASHION-001 as three disjoint
current-base lanes.
Why: the previous remote assignments either had no fresh heartbeat/product
diff, requested a regression against code that already contained the repair,
or targeted a backend that already met the stated ownership contract. The new
lanes cover the actual remaining user-visible flow, live diagnostic evidence,
and fashion-shoot contact-sheet foundation without paid generation or copied
media.
Evidence: CTRL-002 isolated acceptance and independent review passed before
merge; the queue candidate validates with exact task status paths, pinned
context blobs, no active lock/scope overlap, and a 04:38 UTC hard stop.
The known global baseline failure remains reproducible on its own historical
base and is not represented as green.
weakened_checks: none.

2026-07-27 · CTRL-002 · active status-path grants
Change: grant each current active task exactly one matching
`.agents/status/<task-id>.json` path.
Why: an authenticated worker needs a narrow place to commit a sanitized
heartbeat, blocker, or ready report; absence of that exact lease otherwise
keeps the shared queue silent.
Evidence: five paths are exact task IDs, no wildcard or cross-task scope was
added, and the trusted board validator accepts the candidate.
weakened_checks: none.

2026-07-27 · CTRL-002 · execution started
Change: move the durable queue-listener and sanitized agent-status lease from
ASSIGNED to IN_PROGRESS.
Why: its isolated implementation branch has begun work; this state is required
before its evidence PR can be reviewed by the trusted queue runner.
Evidence: owner, branch, pinned base, lease generation, scoped paths, and stop
conditions are unchanged; no product, deployment, or credential authority was
added.
weakened_checks: none.

2026-07-27 · CTRL-002 · durable report protocol candidate
Change: add an exact per-task status schema, authenticated lane-side status
writer, read-only report watcher, bootstrap pack, and bounded coordination
observer loop; require every active lease to reserve only its exact status
artifact.
Why: remote agents need one shared, durable queue and factual progress signal
without shared conversation context, shared credentials, broad write authority,
or an unattended process pretending to be an agent.
Evidence: the focused governance command passed 25/25, the candidate board
validates, the legacy free-text publisher regression fails against the
pre-change implementation and passes after the typed error repair, status
writer and both watchers emit typed startup events, and the
deterministic Looper compiler/linter reports zero findings. Fresh live reports
expire after fifteen minutes; compiler-local paths and report text containing
credentials, prompts, runtime identifiers, local paths, email, or phone are
rejected. A new test is recorded as failing against the pinned pre-change tree
because the status contract module did not exist there.
weakened_checks: none.
2026-07-27 · CTRL-002 · reporting activation scope
Change: widen the existing coordination lease to update the ownership and task
board rules required for per-task status artifacts.
Why: a listener without a task-owned status path cannot report a heartbeat,
blocker, or ready state to the orchestrator through GitHub files.
Evidence: scope remains limited to the root control ledgers plus the original
coordination artifacts; the implementation must grant only exact per-task
status paths and its tests must reject wildcard or cross-task writes.
weakened_checks: none.

2026-07-27 · CTRL-002 · durable agent coordination lease
Change: issue a control-plane task for GitHub-backed assignment listening,
sanitized agent heartbeat/status reports, and one canonical context pack.
Why: a read-only task watcher alone cannot notify the orchestrator about
progress or make disconnected agents share verified model/crop/pipeline rules.
Evidence: the task is isolated to coordination artifacts, requires a new
contract test and adversarial handoff, explicitly forbids secrets, local paths,
external-agent impersonation, deployment, and product-code modification.
weakened_checks: none.

2026-07-27 · CTRL-001 · state-ref correction
Change: update the recorded integration revision after the accepted control
leases were merged.
Why: agents must resolve the live integration ref from Git, and the durable
state ledger must not point to a stale ancestor.
Evidence: `git rev-parse origin/integration/wardrobe-20260726` resolved
`0e9bde1` before this ledger update.
weakened_checks: none.

2026-07-26 · CTRL-001 · lane head pending · handoff pending
Change: establish the repository control plane, immutable task leases,
non-overlapping write scopes, handoff contract, PR scope validation, and a
read-only assignment watcher. Acceptance uses a strict command-shape allowlist
and every task has a focused test-first CI route; the history scanner covers
the repository's supported credential families without printing matched
values.
Why: Claude and Codex diverged without a shared queue, ownership gate, current
state ledger, or GitHub checks; Claude's merge analysis and newer tail existed
only locally.
Evidence: the new governance test failed before implementation with
`ERR_MODULE_NOT_FOUND`; post-change evidence is recorded in the CTRL-001
handoff and PR checks. The current focused governance suite passes 76/76.
weakened_checks: none.

2026-07-26 · WARD-002 · core standard-scene lane started
Change: reissue standard-scene convergence as an active, narrowly-scoped core
lane for `claude-code-dev`; it no longer waits on the incompatible WARD-001
batch.
Why: the observed production failure is headroom repair exhaustion on `std.*`.
This is a separate core product vector and can be proven without changing
assets, gates, or paid-provider state.
Evidence: the lease requires a new all-standard-preset regression test plus
the existing scene-service, API, framing-owner, and framing-schema contracts.
weakened_checks: none.

2026-07-26 · SITE-002 · execution started
Change: move the accepted contact-sheet lease from ASSIGNED to IN_PROGRESS.
Why: the implementation worker has started on its exact isolated branch and
its eventual PR must be accepted against an active lease.
Evidence: task owner, branch, lock, scope, base, and expiry are unchanged from
the accepted queue assignment.
weakened_checks: none.

2026-07-26 · WARD-001 · blocked after hosted compatibility proof
Change: mark the evidence lane BLOCKED and release its locks.
Why: PR #8 passed focused acceptance but failed trusted-base compatibility:
candidate strict provenance expects fields absent from legacy fixture contracts.
Evidence: hosted `trusted-test-compatibility` failed with legacy scene-service
and provider assertions; no gate was weakened and the branch remains preserved.
weakened_checks: none.

2026-07-26 · STYLE-001 / PROFILE-001 / MONITOR-001 · parallel leases
Change: issue three non-overlapping 24-hour implementation lanes for CodeCod,
OpenCode, and Antigravity, plus one shared GitHub onboarding procedure.
Why: core merge review must not serialize style-system preservation, saved-avatar
backend work, and monitor reliability work.
Evidence: each task has one owner, one branch, unique lock group, exact base,
focused CI acceptance, isolated handoff path, and no runtime/deploy/credential
authority.
weakened_checks: none.

2026-07-26 · SITE-002 · contact-sheet backend lease
Change: issue an isolated editorial task for a private, immutable six-frame
contact-sheet manifest after a shoot reaches COMPLETED.
Why: fashion shoot needs a reviewable product artifact before UI reconnect,
without re-generating images or leaking another browser profile's media.
Evidence: the task has one editorial lock, exact source-context pins, a new
route test that must fail against its base, ownership/no-store requirements,
and an isolated handoff path.
weakened_checks: none.

2026-07-26 · CTRL-001 · 36ae95a · PR #2
Change: install the permanent `control/codex-main` queue route, stale-base and
candidate-board validation, and correct prior-handoff drift classification.
Why: task assignment and completion must be GitHub-reviewed ledger changes,
while a previous task handoff must not be mistaken for product-code drift.
Evidence: exact local acceptance passed; the new regression failed against the
pre-fix implementation and passed after it; two independent reviews returned
PASS. PR #2 merged as `9d4780f`. Its integration-base jobs exposed the exact
old-checker bootstrap defect before candidate execution, which this merge
replaced.
weakened_checks: none.

2026-07-26 · WARD-001 · assigned at 9d4780f · control queue
Change: close CTRL-001 and lease the Claude/Codex semantic reconciliation to
`codex-wardrobe-merge` on `lane/WARD-001/codex-wardrobe-merge`.
Why: the control plane is now installed and reconciliation is the first product
priority.
Evidence: task base and both required-context blob hashes resolve at
`9d4780f`; lease generation 2 expires 2026-07-27T21:29:08Z.
weakened_checks: none.

2026-07-26 · WARD-001 · dc06b99 · handoff ee7d50f
Change: freeze the reconciled wardrobe/scene implementation and move its lease
from ASSIGNED to REVIEW.
Why: the lane now has an isolated handoff, exact history scan, focused
integration proof, and an independent adversarial PASS.
Evidence: initial and repair-mode source-staging provenance tests pass; the
scene integration command passed 51/51 before the final fixture-parity
correction, whose exact affected tests pass 3/3. Local full regression remains
resource-refused and the clean hosted regression is mandatory before merge.
weakened_checks: none.

2026-07-26 · WARD-001 · dc06b99 unchanged · lease generation 3
Change: preserve failed evidence PR #5 and reissue the unchanged implementation
to `codex-wardrobe-merge-v2` on a fresh handoff branch.
Why: the trusted GitHub runner did not have the `rg` binary, so acceptance
failed before candidate regression with no product-test failure. A reviewed
handoff branch cannot be force-pushed.
Evidence: governance passed on PR #5; task acceptance reported only
`conflict-marker-scan` with no executable exit code. The replacement portable
check is exact `git diff --check $TASK_BASE_SHA...$TESTED_CODE_SHA`.
weakened_checks: none.

2026-07-27 · BETA preview revision URLs
Change: bind every published background and Create Universe preview URL to the
SHA-256 of the bytes it serves.
Why: previews were correctly replaced in a release while retaining the same
`1.0.0` URL and a one-year immutable cache policy, so returning browsers could
truthfully render stale cards.
Evidence: `node --test test/web/scene-api-integration.test.js
test/web/editorial-preview-api.test.js` passes 8/8; the catalog now exposes a
different `?v=<asset-sha256>` URL whenever preview bytes change.
weakened_checks: none.

2026-07-27 · BETA-STD-001 · publish eleven new background packs
Change: record operator approval, publish all eleven new packs alongside the
five existing packs, and bind every selected local pack index by SHA-256.
Why: asset-only packs do not change the beta product; the user explicitly
approved their publication. Existing packs remain published so historical
saved scenes cannot lose their immutable scene reference.
Evidence: all sixteen packs pass exact prompt, preset, reference-pack, source,
role-asset, resolver, API preview and saved-scene regression checks (32/32).
Eleven stale prompt hashes were corrected to their exact checked-in prompt
bytes; their finish metadata was normalized to the existing production lock.
weakened_checks: none.

2026-07-29 · Look-reference QA surface-fidelity threshold · pending commit
Change: garment-reference QA now treats a close weave, grain, gloss or
material-rendering difference as advisory when product identity, silhouette,
panel layout, color, visible branding and distinctive geometry agree.
Why: operator reviewed the Nano Banana 2 footwear candidate and accepted it
as product-satisfactory; retrying it for surface texture alone adds cost and
latency without improving the usable reference.
Evidence: focused provider + garment-conditioner tests 19/19 PASS, including
the accepted mesh-versus-pebbled candidate and a negative changed-silhouette
case. The rule does not alter historical immutable receipts. Exact beta release
`release-babd2c6-1785354288108` was strict-verified and activated; local and
public health both returned `ready`.
weakened_checks: material microtexture is non-blocking only; product identity,
silhouette, color, visible branding, layout and geometry remain blocking.

2026-07-29 · Fashion Shoot visual cleanup · pending commit
Change: compact style card and compact five-frame progress grid; removed raw
file-derived title, internal stage codes, placeholder numerals and duplicate
pending labels.
Evidence: focused Fashion Shoot/profile UI suite 17/17 PASS.
weakened_checks: none.

2026-07-29 · Real-time Look screen audit · `d4e0c54` → beta
Change: localised and rebranded the live camera surface; linked favicon fixes
the sole browser-console error found in the live visual check.
Verified limitation: MotionService/video routes are committed but not wired
into app startup; `/api/motion/modes` is 404. The old video route remains
intentionally unavailable from the saved-look button because it has only one
reference.
Evidence: live/profile contract suite 16/16 PASS; public beta health ready,
Live browser screen has no favicon error, and 16 background + 10 Fashion Shoot
preview endpoints all resolve.
weakened_checks: none.

2026-07-29 · Fashion Shoot visual cleanup · `937c157` → beta
Change: removed raw pipeline-state and source-file UI content from the Fashion
Shoot screen, compacted the five empty output windows, and replaced the large
numeric skeletons with one centered human status per future frame.
Why: internal state names and source filenames are noise; empty frames must
read as progress, not broken content.
Evidence: focused Fashion Shoot/profile UI suite 17/17 PASS; exact beta
release health returned `ready`.
weakened_checks: none.

2026-07-29 · Fashion Shoot connection language · `cf4a877` → beta
Change: localized the short-lived connection and polling states too; no raw
transport state is rendered while a shoot begins or reconnects.
Evidence: focused UI suite 17/17 PASS; beta health `ready` after restart.
weakened_checks: none.

2026-07-29 · Fashion Shoot visible progress · `a2dd191` → beta
Change: style preview plus five-frame progress meter replace the internal
Shoot Bible/six-slot display in the customer-facing Fashion Shoot screen.
Why: reference sheets and internal QA are conditioning artifacts, not output.
Evidence: focused Fashion Shoot/profile UI suite 17/17 PASS; public beta
health ready and DOM smoke confirms style example, five-step meter, internal
approval hidden, and five-frame output region.
weakened_checks: none.

2026-07-29 · Saved-look action labels · `ac87c0a` → beta
Change: replaced icon-only saved-look controls with names and scoped states;
removed duplicate background action; disabled Fashion Video until its required
two-reference route is actually available.
Why: controls must say what they do and must not imply a generation capability
that the current video contract cannot satisfy.
Evidence: profile and Fashion Shoot UI suite 17/17 PASS; public beta health
ready and browser DOM smoke confirms all five labels, exactly one background
action, and disabled Fashion Video.
weakened_checks: none.

2026-07-27 · BETA reconciliation · `39442c4`
Change: reconcile the shared board and verified state to the actual running
beta commit, and give each connected agent one explicit next action.
Why: prior rows correctly preserved historical work but incorrectly described
the running Lucy implementation as mock-only and left already-live picker/UI
commits marked merely ready for deployment.
Evidence: `git merge-base --is-ancestor dbc2442 39442c4` and `6e9cc68 39442c4`
both succeed; focused non-billable suite is 20/20 PASS; beta health is `ready`;
the API reports 16 backgrounds and 9 editorial-mode records; post-shoot page
is HTTP 200; unconsented Lucy token request returns HTTP 409 before provider use.
weakened_checks: none.

2026-07-30 · Consolidated beta product release · `b94484b` → beta
Change: integrated every completed deployable atom from the current block
branches: drag/drop + HEIC, the restored Fashion Shoot catalog/style units,
and the resumable Fashion Video runtime with its private source bridge.
Why: committed agent work existed on isolated branches but was absent from the
running beta release.
Evidence: video 111/111 PASS; Fashion Shoot/Create Universe 11/11 PASS;
product release 2/2 PASS; strict verifier PASS; public health ready; 16
backgrounds, 19 Fashion Shoot previews, 17 generation modes, and 15 complete
Create Universe units. Browser console errors: 0.
weakened_checks: none.

2026-07-30 · Modern iPhone HEIC fallback · `c094a0a` → beta
Change: when Chrome and bundled libheif cannot decode an HEIC/HEIF variant,
the browser sends the file to a same-origin transient conversion route; macOS
`sips` returns a validated JPEG and the existing draft pipeline continues.
Evidence: focused upload/conversion suite 15/15 PASS; a real HEIC passed the
public endpoint and returned a 96×96 JPEG; browser upload persisted the
converted `-upload.jpg`; public health ready.
weakened_checks: none.

2026-07-30 · Chat 00 release ownership
Change: separated beta integration/version/deploy authority from Chat 01
product development. Chat 00 writes no feature code and accepts only exact,
tested handoffs.
Why: deployment is a persistent control-plane responsibility; combining it
with Block 1 implementation creates avoidable queueing and context overload.

2026-07-30 · Durable saved-look boundary and runtime recovery · `afa34d8`
Change: deployed the hash-bound approved-look snapshot from `3a387c2`, including
the look bytes, PASS receipt and immutable item evidence. Restored the beta web
and Cloudflare LaunchAgents after offload by keeping their log/runtime control
paths on the internal SSD while retaining bulk releases and backups externally.
Why: a completed saved look could return `LOOK_ITEM_EVIDENCE_INVALID` before a
background generation, while the UI falsely called HTTP 409 a connection loss;
LaunchAgents also returned `EX_CONFIG` because stdout/stderr resolved through an
external-volume symlink.
Evidence: the exact previously failing saved look resolves `top`, `footwear`
and `bottom` and owns a durable snapshot; focused tests PASS `40/40`; strict
release verification PASS; local/public health ready; public catalogs report
16 backgrounds and 19 Fashion Shoot modes.
weakened_checks: none.

2026-07-31 · Fashion Video delivery-audio assembly · `21fd0c8` → beta
Change: provider output is retained only as `provider.mp4` for audit. Before
technical QA, Fashion Video freezes the exact approved Video 1 locally,
rebuilds `clip.mp4` with provider video stream plus that reference's audio
stream; when Video 1 is silent it emits a silent delivery. Explicit stream maps
make provider audio ineligible for delivery.
Why: `CLIP_HAS_AUDIO` incorrectly rejected otherwise reviewable provider output
before the final delivery file existed.
Evidence: video suite 155/155 PASS; actual ffmpeg verification on the existing
provider MP4 produced one HEVC video stream plus AAC from `reference-03.mp4`.
Beta health reports release SHA `21fd0c8` ready.
weakened_checks: legacy clips created before this change have no frozen
reference copy and remain rejected; the observed legacy clip also has a video
SHA equal to its directing reference and is blocked for reference leakage.

2026-08-01 · Fashion Shoot structured-reference bounds · `dc67de6` → candidate
Change: bound every compiled structured-reference fact at the single
`referenceAsset()` producer boundary, with a word-boundary truncation rule and
a catalogue-wide schema regression.
Why: the live shoot path compiled 90 facts over the strict 240-character
contract; no provider call or QA candidate was possible, so the UI surfaced a
generic executor failure after retries.
Evidence: structured-reference plus editorial/Create Universe suite `67/67`
PASS; `verify:contracts` and `verify:canon` PASS; no weakened checks and no
paid generation.

2026-08-02 · Internal/external storage boundary
Change: recorded a hard operational rule: active beta runtime stays on the
internal SSD; the external SSD can hold only explicit archive/cache classes.
Why: a runtime dependency path placed on the external volume made the
LaunchAgent unable to boot beta after restart, even though the source and node
graph were intact.
Evidence: the restored beta release is healthy with local runtime dependencies;
the full rule and allowlist are in `docs/DEPLOYMENT_UA.md`.
weakened_checks: no runtime files were moved or deleted as part of this note.

2026-08-02 · Paid beta core smoke · `c1d75ce8e9c4921e72d6b2ecb349481f00c89aef`
Change: ran one real paid avatar → outfit journey on beta after isolating the Codex VLM worker with a dedicated `CODEX_HOME`.
Why: prior paid attempts failed before generation because the persistent beta worker shared desktop Codex state and returned empty/timeout VLM results; unit tests did not exercise that host-level contention.
Evidence: run `1638c656-4be6-46b9-bfaa-595109db03d6` completed; Higgsfield jobs `ba148144-0d22-467a-b9d5-1fc5d16978cf` and `7986c924-e831-4ed7-9c37-949609858925`; conditioning/avatar/outfit QA PASS; public `/api/health` ready with release SHA `c1d75ce8e9c4921e72d6b2ecb349481f00c89aef`.
weakened_checks: none. Background/Fashion Shoot/video were not charged in this atom.

2026-08-02 · Current new-image route override · candidate pending deploy
Change: new avatar, garment-conditioning and scene jobs use GPT Image 2 only:
low/1K initial, two distinct low/1K QA repair attempts, medium/2K escalation,
then high/4K final escalation. The generation profile is sent as provider
request configuration and stored with the durable request/receipt.
Why: Nano Banana and Nano Banana Pro frequently returned unsuitable images.
Legacy Nano identifiers remain accepted solely to reopen or audit historical
jobs; they cannot be selected for a new job.
Evidence: focused route/provider/core/scene suite 221/221 PASS; scene-service
58/58 PASS; contract and canon verifiers PASS.
Beta: NOT_DEPLOYED at the time of this log entry; a release record must name
the exact activated SHA after `tools/deploy-beta-release.mjs --apply`.
weakened_checks: none.

2026-08-02 · GPT Image 2 ladder beta activation
Change: activated the tested GPT Image 2 ladder release through the dedicated
beta deploy tool after active generation work was cancelled by the release
owner.
Evidence: public and local health both returned `ready`; product release SHA
`bb781c2c542c1c6c91f0fdb6298c2c0470578dbf`, cache
`product-bb781c2c-d3e13b84b4e5`.
Safety: two local Higgsfield wait processes were stopped; the remaining active
Fashion Shoot was durably marked CANCELLED. No completed output was removed.
weakened_checks: none.

2026-08-03 · Fashion Shoot progressive downloads and Fashion Video input roles
Change: made the progressive Fashion Shoot download control visibly labelled
«Завантажити» while keeping its direct immutable output URL; added the verified
three-input Fashion Video contract to the native beta picker.
Why: a ready customer frame must be usable immediately, and the interface must
state exactly that Video 1 is private direction, Image 1 is the approved white
master / sole visible person, and optional input three is a cleaned face or
garment detail.
Evidence: relevant web / Fashion Shoot / Fashion Video suite 78/78 PASS;
contract and canon verifiers PASS; no paid provider work.
weakened_checks: none.

2026-08-03 · Beta activation · Fashion Shoot catalogue + Fashion Video roles
Change: activated product release `85bce99fc2e90b5f1689f5daffd56f931cd57ab0`.
The public Fashion Shoot catalogue reads readiness from the service contract
rather than an ID-prefix heuristic, restoring the two valid legacy styles.
Ready progressive frames expose a visible «Завантажити» full-asset link;
Fashion Video exposes its safe three-input reference contract in beta.
Why: the prefix filter silently hid valid styles, while the product needed an
honest explanation of the references actually bound to a video job.
Evidence: beta and same-origin main API health both return `ready` and this
exact release SHA; focused suite 78/78 PASS; contract and canon verification
PASS. No paid generation was run.
weakened_checks: none.
