# Real pipeline smoke — 2026-07-29

## Result

The controlled real run reached `CONDITIONING_QA` and terminated honestly as
`NEEDS_INPUT`, before avatar or scene generation. It must not be retried with
the same single side-view sneaker input.

## What passed

- Higgsfield CLI authenticated and completed job `ca6945c8-ebbf-46f1-b88b-ec46fe4c5667`.
- Item extraction classified top (0.99), bottom (0.99), footwear (0.97).
- Identity, top and bottom evidence passed the VLM condition check.

## Blocking evidence

Footwear has only a lateral-side source view. The QA receipt requires an
opposite/medial side, top or toe view, heel, and sole where those facts must
be preserved. This is source-evidence insufficiency, not a provider failure,
timeout or a reason to weaken the lock.

## Next action

Supply the additional images of the exact same pair. Resume this same bounded
smoke only then: first obtain a completed PASS full-look receipt, then execute
one `std.*` background and one `shoot.*` Create Universe hero.

weakened_checks: none.
