# codex-video-fidelity-20260728

Protocol ACK: 985fcec

## BETA-FULL-LOOK-LOCK-001 — HANDOFF: UPSTREAM FIRST-APPEARANCE CAPTURE REQUIRED

## Re-opened — 2026-07-29

- Direct operator authorization: implement the real first-appearance producer and test it on the real pipeline after local contract checks.
- Reserved implementation boundary: `RunService` + `GarmentConditioner` + isolated first-appearance test. No `app.js`, video transport, provider credential, or another agent's active route is touched.
- Real-pipeline crop/VLM proof (no image/video generation): a completed beta full-body look produced immutable observed `bottom` and `footwear` locks. Record SHA-256: `c8c455671a18e33250a12b6024c7640f6c5087d92eb2e6e752036f503bd82fe1`; source-crop SHA-256 values: `8f97f69ff841ba95f7b2b095c765dc9115918c6495b7d88bee073380f55ef4f7`, `f28766ab4c9988b80fabffe14c635a795f3d6b91e927f0c264b3d8f64199a6df`; cutout SHA-256 values: `a5e7b8995aa4b00d3fc58cbfd57eafc5fbf26f307e4e9b7cd7f801ad4abc3303`, `bdf737260ba304360ed3d5a3ec9229a6ca3c3155fc3bc591e41846d00530e8b8`. Two stricter crop boundaries correctly returned `FIRST_APPEARANCE_NEEDS_INPUT` instead of mislabelling; final deterministic boundary passed.

Implementation commit: `58dd6370feb0d1ecfe3f3016618f95545d256e26` (pushed to `beta`; not live-claimed).

Final correction: the registry-only `FULL_LOOK_ITEMS_REQUIRED` pre-gate has been removed; no runtime duplicate remains. The remaining task is upstream: make `RunService` crop and dossier a visibly present unregistered item from the approved full-body look, then bind it under the existing hash-verified approved-item evidence contract.

- Pipeline: `LOOK.04–06` → `VIDEO.01`.
- Direct operator instruction: make bottoms and footwear first-class locked items; an item visible in delivery must be locked. Existing items use real crops; only absent bottoms may be synthesized once, disclosed and frozen.
- Reservation: the exact paths in `UPDATE.md`; no active row owns them.
- Initial evidence: `approved-items` was top-only. `outfit-black-sneaker` has a real source; no lower-garment source existed in this fixture, so the operator-approved one-time synthetic lock was required.
- Locked footwear: `outfit-black-sneaker` remains `OBSERVED`, sourced only from `inputs/zeely-test/outfits/68d39339521f3-6389105.webp` (`5075f38ef46f9811640c2e0d22849e72f042f43f91d3cc706ae107fa8a62c346`). Its immutable dossier now declares all-black technical sneaker, mesh textile / synthetic overlay / rubber sole, laces / sculpted sole / air units, and plain black technical paneling. Product cutout SHA-256: `655d6fec39dd4b5bea52f6e92a02aff668e6f29d49444f25606387d4dfb0e2ed`; review-card SHA-256: `1c3221bc937727f02eddbde03d31f20f2cb8efba904c17d2d7f75982fccfda51`.
- Locked bottom: `outfit-locked-black-trousers` is the sole disclosed `SYNTHETIC_LOCKED` item. The one-time original is `locked-black-trousers.source-magenta.png` (`f4f27a29e778fc3ed875f46b1d29210105546c13e02857c5f422d793044c053f`); immutable approved source is `locked-black-trousers.png` (`43236b483d8e5acfee4d4c33d2e3cd94a64ec3c31ee0b5b5e4cccd00fe6cf9d8`). Its dossier declares charcoal-black straight-leg five-pocket denim, mid-rise waistband / zip fly / button / belt loops, opaque mid-weight cotton denim, and plain washed-black denim weave. Product cutout SHA-256: `94e25b8ac87da692695e77a966dbf56544d1726903112f9876fd386d19462802`; review-card SHA-256: `3eec69f7e38f51c3f58cd03e4d20d7bcfce72a7e333552bf105d37dd2d6ed5af`.
- Correction after operator clarification: `wide_campaign_coda` remains `wide_full_body`, but it is no longer refused merely because an otherwise visible lower garment or footwear has no registry row. A registered item is used unchanged; visible unregistered pixels are first-appearance evidence to capture and lock before reuse; synthesis is allowed only when no item pixels exist at all. The previous `FULL_LOOK_ITEMS_REQUIRED` pre-generation refusal was removed because it incorrectly blocked full-body looks whose items were already visible.
- Corrective verification: `node --test test/conditioning/conditioning.test.mjs test/web/editorial-activation-backend.test.js test/web/editorial-shoot-service.test.js test/web/scene-framing-lock-owner.test.js` passed 30/30. This narrow SceneService correction deliberately does not claim that it implements the upstream crop-and-dossier extractor: first-appearance capture belongs in the approved-look / `RunService` evidence producer and needs its own reserved integration change before the evidence can be persisted automatically.
- Safety: no QA weakening, no manifest hash rewrite, no provider/video request, and no synthetic replacement for the real sneaker source. The sneaker source is technically `REPAIRABLE` because 437px cannot conservatively reach the preferred 1024px detail target; that risk remains visible and requires a better real source for finer detail, not fabricated replacement pixels.
- Verification: `node --test test/conditioning/conditioning.test.mjs test/conditioning/decision.test.mjs test/conditioning/hash-lineage.test.mjs test/conditioning/image-conditioning.test.mjs` passed 23/23. `git diff --check` passed. The broader selected suite has two pre-existing catalogue expectation failures exactly matching the known beta report (editorial expected 6 but now sees 10; standard expected 5 but now sees 16); they are out of scope and unchanged.

weakened_checks: none.
# Release repair — 2026-07-29

Verified first-appearance evidence is immutable on repeat writes and accepts an
optional expected-look binding. Release QA exposed stale cache scanning and
pre-catalog assumptions: cache checks now inspect actual ES module specifiers,
the deploy smoke reads the release's approved selected preset list, and every
READY Create Universe unit (including restored Terracotta) is SHA-verified.

`node tools/verify-product-release.mjs` passed for base commit `5ab0fa3`.
