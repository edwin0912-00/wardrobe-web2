# Chat 04 — Beta Block 5: Fashion Shoot

Owner: `chat-4`.
Branch: `beta-block-5-fashion-shoot`.
Pipeline: `UNIVERSE.03–04`, `ART_SHOOT.01–05`.

Report: `updates/chat-4.md`. Chat 05 does not own this block.

Own Shoot Bible, hero, five customer frames, identity/item/style QA,
independent retry and persistence. Consume Block 4's immutable packs without
rewriting them. Internal contact/reference sheets remain backend evidence.

First atom: use one currently complete style pack and prove hero creation up to
the first honest terminal QA receipt; do not launch the remaining frames until
hero QA passes.

## Current all-style matrix — 2026-07-30

The first atom is complete for every current product style. The immutable
evidence is recorded in
[`FASHION_SHOOT_HERO_SMOKE_MATRIX_2026-07-30.md`](../../qa/FASHION_SHOOT_HERO_SMOKE_MATRIX_2026-07-30.md):
15/15 `shoot.*` styles have a QA-passed technical hero, exact reference-pack
hash, output hash and receipt hash.

The next campaign advances **all 15**, not a hand-picked subset. Each has five
customer-facing frames after its technical hero: 75 total. The checked-in
[`fashion-shoot-matrix.json`](../../../config/fashion-shoot-matrix.json) fixes
the campaign ceiling at eight provider jobs: four independent shoots per wave
times the existing two post-hero jobs owned by the service. The runner
[`run-fashion-shoot-matrix.mjs`](../../../tools/run-fashion-shoot-matrix.mjs)
only approves the exact recorded QA-passed hero hash, persists non-secret
campaign state locally, and stops after a failed wave with the failed style
named. It does not alter the per-shoot service concurrency.
