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

The next campaign advances **all 15**, not a hand-picked subset. A Fashion
Shoot starts all five customer frames when it is created: 75 total for this
matrix. The checked-in [`fashion-shoot-matrix.json`](../../../config/fashion-shoot-matrix.json)
fixes one global ceiling of eight provider jobs. One shoot may use five slots;
the remaining three can serve another queued shoot. The runner
[`run-fashion-shoot-matrix.mjs`](../../../tools/run-fashion-shoot-matrix.mjs)
is only a migration for the already-created QA-passed hero records; it
dispatches all of them and records non-secret terminal state locally.
