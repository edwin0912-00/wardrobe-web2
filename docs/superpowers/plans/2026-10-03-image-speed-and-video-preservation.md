# Image speed and video preservation implementation plan

**Goal:** Preserve the working video recipe, add durable Slow/Fast image routing on both sites, publish/activate one verified alpha source and remove proven redundant Wardrobe leftovers.

**Architecture:** Extend the existing per-request image context and authoritative run/scene/shoot records. Existing provider instances, QA and idempotency guards remain shared; route selection is immutable per job.

**Tech stack:** Existing Node.js ESM, native browser JavaScript/CSS, node:test, existing Chromium acceptance, Python/OpenCV/Transformers for the optional video preparation tools.

**Spec:** `docs/superpowers/specs/2026-10-03-image-speed-and-video-preservation-design.md`.

## Constraints and interfaces

- Public/persisted field: `image_generation_mode`, values `slow` or `fast`, omission defaults to `slow`.
- Provider context field: `imageGenerationMode`. Authoritative producers populate it from persisted state.
- Shared module: `beta/src/providers/image-generation-mode.js`, exporting `resolveImageGenerationMode(value)` and `DEFAULT_IMAGE_GENERATION_MODE`.
- Invalid input raises code `IMAGE_GENERATION_MODE_INVALID` and maps to HTTP 400 before creating work. Configured Fast absence raises a distinct unavailable error; it never invokes Codex.
- Logical quality/model ladders, reference ordering, QA, maximum required references, and existing unknown-outcome guards are unchanged.
- Legacy Slow fingerprints remain compatible. Include the mode in new Fast request identity and immutable manifests; distinguish omission from an explicit incompatible value.
- Root owns commits, deployment, cleanup and public board. Children own disjoint files in separate worktrees and return patches; no child commits, deploys, spends or deletes.

## 1. Provider and core-run lane

Own `beta/src/providers/image-generation-mode.js`, `image-generation-router.js`, `beta/src/web/generation-provider.js`, `app.js`, `run-service.js`, `draft-service.js`, `image-asset-generator.js`, and their focused provider/core/draft tests. Coordinate any other required core-run caller with root before editing.

- [ ] Add the strict mode normalizer and tests for omitted/slow/fast/null/unknown/non-string values.
- [ ] Add per-call Fast dispatch to the existing router; preserve Slow fallback/6-reference behavior, classify Fast routing receipts accurately, keep health/probe of Codex separate from configured Fast capability.
- [ ] Accept the field through multipart `/api/runs` and JSON `/api/draft/run`, persist it before execution, forward it into garment, avatar and outfit generation, and retain it on retry/restart.
- [ ] Tests must prove Fast never calls Codex, Slow uses existing fallback, unknown submitted jobs are not duplicated, and simultaneous Slow/Fast contexts do not mutate each other.

Generation context contract:

```js
await provider.generate({ ...existingContext, imageGenerationMode: persisted.image_generation_mode ?? 'slow' });
```

## 2. Scene and photoshoot lane

Own `beta/src/web/scene-routes.js`, `scene-service.js`, `scene-adapters.js`, `editorial-shoot-routes.js`, `editorial-shoot-service.js`, `editorial-scene-executor.js`, and focused scene/editorial tests. Do not edit lane 1 files.

- [ ] Validate mode on background/shoot create endpoints before creating jobs.
- [ ] Persist and fingerprint it; preserve legacy Slow identities and reject an idempotency-key replay with a different mode.
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

Browser: both sites choose Slow/Fast and send correct payloads; preference reload, pending-job immutability, availability and mobile layout.

Operations: source/tree/branch parity, release lock, same source SHA for active artifacts, active-work safety, auth/private-data preservation, public read-back and cleanup post-state.

Paid generation: no new video calls. Existing video result and previous image receipts are retained; any necessary image smoke must fit the remaining aggregate $20 validation cap and be estimated before submission.
