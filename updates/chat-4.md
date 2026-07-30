## Fashion Shoot all-style hero smoke matrix — 2026-07-30

Result: **15/15** current `shoot.*` styles produced a QA-passed technical hero.
The immutable mapping style → reference pack → shoot → output → receipt is in
`docs/qa/FASHION_SHOOT_HERO_SMOKE_MATRIX_2026-07-30.md`; media stays in runtime/SSD.

Execution decision: all 15 styles advance, not a selected six. Five customer
frames after each hero makes 75 frames. The versioned matrix config fixes
campaign concurrency at four shoots × the existing two post-hero jobs = eight
provider jobs. The runner stops after the current wave and names any failed
style; it does not modify an existing shoot's own scheduler.

Code is ready for integration; beta was not edited or deployed by this atom.
No existing runtime shoot was mutated and no paid generation was started.
`weakened_checks: none`.
