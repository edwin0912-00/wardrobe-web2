# Image speed and video preservation implementation plan

**Goal:** Preserve the working video recipe, add durable Slow/Fast image routing on both sites, publish/activate one verified alpha source and remove proven redundant Wardrobe leftovers.

**Architecture:** Extend the existing per-request image context and authoritative run/scene/shoot records. Existing provider instances, QA and idempotency guards remain shared; route selection is immutable per job.

**Tech stack:** Existing Node.js ESM, native browser JavaScript/CSS, node:test, existing Chromium acceptance, Python/OpenCV/Transformers for the optional video preparation tools.

**Spec:** `docs/superpowers/specs/2026-10-03-image-speed-and-video-preservation-design.md`.

## Decision record and staffing

Principles: immutable job intent; one existing provider/router lifecycle; truthful source/runtime/provider evidence; preservation before deletion. Drivers: user-controlled image cost/latency, recovery without duplicate billing, and one reproducible alpha deployment.

Options considered: per-job existing-router selection is preferred because it preserves concurrency and lifecycle. A global setting is smaller but cannot represent concurrent users or immutable jobs; a runtime per request isolates choices but duplicates workers and health/resource handling. Both alternatives are rejected against the stated requirements.

Available native routes: `luna_worker` for bounded implementation, `architect` and `critic` for independent review, `luna_medium` for bounded inventory, root for integration/release/deletion. Spark is unavailable for this account and is not retried. Core, scene/shoot and UI are independent implementation lanes; video preservation and operations remain root-owned. No Team or second orchestrator is needed.

Pre-mortem: (1) mode disappears in conditioning or recovery and spends through the wrong provider—cover immutable jobs and every child context with dispatch spies; (2) main and engine deploy different SHAs or lose private references—build one verified source, use active-work guards, compare public health and preserve rollback; (3) cleanup removes a sole historical asset or shared dependency—require archive/Git/hash coverage plus fresh link/open-file checks before deletion.

## Constraints and interfaces

- Public/persisted field: `image_generation_mode`, values `slow` or `fast`, omission defaults to `slow`.
- Provider context field: `imageGenerationMode`. Authoritative producers populate it from persisted state.
- Shared module: `beta/src/providers/image-generation-mode.js`, exporting `resolveImageGenerationMode(value)` and `DEFAULT_IMAGE_GENERATION_MODE`.
- Invalid input raises code `IMAGE_GENERATION_MODE_INVALID` and maps to HTTP 400 before creating work. Configured Fast absence raises a distinct unavailable error; it never invokes Codex.
- Logical quality/model ladders, reference ordering, QA, maximum required references, and existing unknown-outcome guards are unchanged.
- Legacy Slow fingerprints remain compatible. Include the mode in new Fast request identity and immutable manifests; distinguish omission from an explicit incompatible value.
- Persisted mode absence means Slow without rewriting old `job.json` or old request manifests. Preserve the existing Slow fingerprint/manifest bytes; add a distinct mode binding for Fast. Legacy shoot fingerprint compatibility is allowed only for effective Slow.
- Health capability shape is `image_generation_modes: { slow: { available: boolean }, fast: { available: boolean } }`. A hard runtime fault disables both; a Codex preflight fault must not disable configured Fast.
- Backend route registration receives `assertImageGenerationAvailable(mode)`, an async callback that throws HTTP 503 for a known unavailable mode. Call it after parsing the new request or resolving the owned persisted job for retries. Do not let the current pre-parse aggregate gate reject Fast before the mode is known.
- Root owns commits, deployment, cleanup and public board. Children own disjoint files in separate worktrees and return patches; no child commits, deploys, spends or deletes.

## 1. Provider and core-run lane

Own `beta/src/providers/image-generation-mode.js`, `image-generation-router.js`, `beta/src/web/generation-provider.js`, `app.js`, `start.js`, `preflight.js`, `run-service.js`, `draft-service.js`, `image-asset-generator.js`, `garment-conditioner.js`, `beta/src/runner/pipeline-runner.js`, `beta/src/runner/job.js`, `beta/schemas/pipeline-job.schema.json`, `beta/schemas/generation-job.schema.json`, and their focused provider/core/draft/runner tests. Coordinate any other required core-run caller with root before editing.

- [ ] Add the strict mode normalizer and tests for omitted/slow/fast/null/unknown/non-string values.
- [ ] Add per-call Fast dispatch to the existing router; preserve Slow fallback/6-reference behavior, classify Fast routing receipts accurately, keep health/probe of Codex separate from configured Fast capability.
- [ ] Accept the field through multipart `/api/runs` and JSON `/api/draft/run`, persist it before execution, forward it into garment, avatar and outfit generation, and retain it on retry/restart.
- [ ] Bind mode into new immutable `job.json` and validate effective run/job agreement before generation. Same-run-ID/finalization-key replay with a different effective mode must conflict, including the pending-run path. Missing legacy fields mean Slow without rewriting existing immutable artifacts.
- [ ] Replace the aggregate pre-parse provider gate with mode-aware checks at each generation trigger. Pass the callback to scene/editorial route registration. Retry/approval routes look up the owned persisted job's mode rather than the current UI preference; hard runtime health remains a shared gate.
- [ ] Tests must prove Fast never calls Codex, Slow uses existing fallback, unknown submitted jobs are not duplicated, and simultaneous Slow/Fast contexts do not mutate each other.

Generation context contract:

```js
await provider.generate({ ...existingContext, imageGenerationMode: persisted.image_generation_mode ?? 'slow' });
```

## 2. Scene and photoshoot lane

Own `beta/src/web/scene-routes.js`, `scene-service.js`, `scene-adapters.js`, `scene-contract.js`, `editorial-shoot-routes.js`, `editorial-shoot-service.js`, `editorial-scene-executor.js`, `editorial-shoot-contract.js`, `beta/schemas/scene-job.schema.json`, `beta/schemas/editorial-shoot-job.schema.json`, and focused scene/editorial tests. Do not edit lane 1 files.

- [ ] Validate mode on background/shoot create endpoints before creating jobs.
- [ ] Persist and fingerprint it; preserve legacy Slow identities and reject an idempotency-key replay with a different mode.
- [ ] Extend exact-key state/job validators with the optional mode. Only effective Slow can match legacy shoot fingerprints; Fast must have a distinct request identity and immutable provider manifest.
- [ ] Accept the shared availability callback in route registration. Call it after mode validation for creates and after owner-authorized persisted-state lookup for scene retries and shoot approve/retry actions.
- [ ] Feed the immutable mode into every scene provider call and each shoot child scene, including recovery and retry paths.
- [ ] Verify route propagation, old records and exact-child-scene retry reuse.

Request shapes:

```js
{ preset, expected_reference_pack_sha256, image_generation_mode: 'fast' }
{ modeId, modeVersion, image_generation_mode: 'fast' }
```

## 3. Both-site UI lane

Own root `ui.js`, `style.css`, `adapters/cinematic-ui-bridge.mjs`, `adapters/zeely-client.mjs`, their client tests, and `beta/web/public/` plus its UI/client tests. Do not modify backend services.

- [ ] Reuse existing selector styling for exactly `Slow` and `Fast`, default Slow; preserve the cinematic D/mirror layout.
- [ ] Carry `imageGenerationMode` through bridge calls and serialize `image_generation_mode` on core/draft/background/shoot requests.
- [ ] Persist only the preference in browser storage; capture the selected value when each request starts. Existing jobs display/retain their own selection.
- [ ] Honor Fast availability from server capability, preserve keyboard/accessibility behavior, keep video/Live independent.
- [ ] Tests cover both options on both sites, all image request bodies, reload and a toggle while a request is pending.

## 4. Root video and documentation lane

- [ ] Finish independent verification of all four RGB/matte/depth packs, preserving source hashes, exact frame counts and neutral mask pixels.
- [ ] Preserve portable, hash-bound processing/replay tools and the successful FAL receipt summary without secrets/media/URLs in Git. Document the $11 test's input-video billing and visual limitations.
- [ ] Preserve original video prompt scene authority without invalidating historical persisted wire-prompt receipts; use an explicit compatibility path if the adapter behavior changes.
- [ ] Update README, AGENTS, provider routing and changelog around the final implementation.

Exact sources are listed in the private `.omx/context/wardrobe-slow-fast-20261003.md` evidence index. Within the operator workspace, the source videos are `deliverables/video-references-20261003/reference-01.mp4` through `reference-04.mp4`; source scripts are `audit/video-derivatives-20261003/{root_mask01.py,root_mask03.py,face_masks.py,depth_maps.py,fal-derived-test.mjs,verify_derivatives.py}`. Reviewed detections and provider receipts are adjacent JSON files; final RGB/matte/depth and provider output are in `deliverables/video-derivatives-20261003/`.

Git destinations: `beta/tools/prepare-video-references.py` for portable OpenCV/depth processing, `beta/config/video-reference-preparation/fashion-cool-style-v1.json` for hash-bound reviewed mask tracks and timing, `beta/tools/seedance-reference-pack.mjs` for dry-run/explicit-submit/resume of a standard FAL reference pack, and `docs/VIDEO-REFERENCE-PIPELINE.md` for reproduction, cost and verification. The four authorized sources are bound to the existing catalog SHA-256 values, never selected by filename alone. Public files contain code, model revision, source hashes, geometric tracks and a redacted outcome summary; original/derived media, keys, local absolute paths, raw receipts and uploaded URLs remain private.

The owner explicitly authorized these local privacy derivatives and the separately identified normal API test. Earlier rejected jobs stay terminal. No automatic resubmission of a rejected job, no duplicate unknown paid job, no disabling provider checks, no silent identity/model/account substitution and no further paid video call are part of this release. This supersedes the earlier overbroad interpretation that every local face mask or depth derivative was forbidden.

Reconcile both root `AGENTS.md` and `beta/AGENTS.md` before releasing beta-owned lanes: root records the current successful authorized test and budget boundary; beta identifies alpha as authoritative and marks the old Seven-Block/other-branch instructions historical.

Video acceptance commands (operator supplies private paths):

```sh
python3 beta/tools/prepare-video-references.py verify --manifest beta/config/video-reference-preparation/fashion-cool-style-v1.json --source-root "$WARDROBE_VIDEO_REFERENCE_ROOT" --output-root "$WARDROBE_VIDEO_DERIVATIVE_ROOT"
node --test beta/test/video/video-reference-preparation.test.js beta/test/video/seedance-reference-pack.test.js
```

Verification requires four unchanged original hashes, twelve distinct derivative hashes, exact source frame counts (331/379/378/375), 25 FPS and exact input durations, binary full-range mattes and neutral encoded mask cores. Test hash mismatch, changed timing, missing/partial upload, total input-duration limits, exact positional labels, budget failure before submit, and one-submit/known-ID resume using fakes. The already downloaded provider MP4 is matched to its real request receipt; no new inference is needed.

## 5. Integration, release and cleanup

- [ ] Apply reviewed lane patches to the root integration worktree; run focused tests, root/browser/two-process acceptance and full engine suite as required by `./verify`.
- [ ] Obtain independent architecture review, make a changed-files-only simplification pass, and rerun affected checks after any edits.
- [ ] Refresh release lock using repository tooling; create Lore commits and push `HEAD:alpha` without rewriting history. Fast-forward canonical local/server source.
- [ ] Inspect active work and actual launcher artifacts. Build and activate the same verified SHA via existing release tools, preserving private runtime/auth and a concrete rollback until smoke passes.
- [ ] Verify public main/Studio/provider capabilities, selector-to-request behavior, catalogs, health SHA and MP4 Range; update the board.
- [ ] Only then delete freshly proven redundant Wardrobe worktrees/builds/failed renders/config leftovers; preserve useful media/history/auth. Record logical and physically reclaimed bytes without double-counting hardlinks.

## Verification matrix

Unit: mode validation, router transport choice, safe fallback, reference limits, unknown-result fail-stop and concurrent requests.

Integration: every create endpoint, persisted fields, immutable request identity, changed-mode replay, legacy Slow records, restart and shoot-child retry.

Health integration: Codex preflight failure with configured FAL still permits Fast and invokes FAL; a hard runtime fault disables both modes before generation.

Browser: both sites choose Slow/Fast and send correct payloads; preference reload, pending-job immutability, availability and mobile layout.

Operations: source/tree/branch parity, release lock, same source SHA for active artifacts, active-work safety, auth/private-data preservation, public read-back and cleanup post-state.

## Architecture review dispositions

- F1 incorporated: immutable core job, runner, garment conditioning and same-run-ID draft replay are explicit lane 1 responsibilities.
- F2 incorporated: exact-key scene/shoot validators and Fast-only fingerprint differentiation are explicit lane 2 responsibilities; legacy Slow records remain byte-compatible.
- F3 incorporated: mode-specific health and post-parse/owned-state gates replace the aggregate pre-parse provider block, with a fixed capability/callback contract for all lanes.
- C1 incorporated: exact private video sources, public tool/config/doc destinations and acceptance commands are specified above.
- C2 clarified: authorized source hashes and one successful ordinary request are the evidence boundary. The suggested blanket prohibition on all transformed versions of previously rejected source footage is rejected because the owner explicitly corrected it and authorized the benign test; terminal-job and unknown-outcome retry protection remains mandatory.
- C3 incorporated: both AGENTS files are updated before beta-owned execution so alpha/current owner authority is unambiguous.

Paid generation: no new video calls. Existing video result and previous image receipts are retained; any necessary image smoke must fit the remaining aggregate $20 validation cap and be estimated before submission.

## Deployment and installer findings incorporated during integration

The old main deploy command copies the entire monorepo into the serving tree
and has no concrete rollback artifact. Replace that copy step with a scoped
static artifact, source/hash receipt, active-work guard, and rollback on failed
health/static/Range checks. Retain the existing alpha/origin verification gates
and the existing beta deployment tool. Tests use temporary trees and fake
service commands; only root activates a real service.

The whole-product command already exists, but the owner's requested operator
questionnaire does not. Add a small standard-library `./setup` wrapper that
stores host/origin/ports/provider settings outside Git, masks secret entry,
and delegates installation and startup to `./verify --run`. A host label is
not remote provisioning; document the clone-and-run command on the chosen
server and the separate DNS/TLS responsibility. Validate permissions, inputs,
environment mapping and reuse of existing values without paid calls.

The media downloader also needs unique temporary files, bounded networking
and cleanup on errors. Preserve its exact archive length, SHA and path checks;
prove failure and concurrency behavior with a local HTTP fixture.
