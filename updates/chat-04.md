# Chat 04 — Fashion Shoot progress atom

Protocol ACK: `afa34d8fcc92026824e20fb98c7e5e9532a772a4`.

Block-map ACK: `afa34d8fcc92026824e20fb98c7e5e9532a772a4`; Code=TESTED; Beta=NOT_DEPLOYED; Journey=NOT_RUN.

Pipeline step: `ART_SHOOT.01–05`.

The Fashion Shoot gallery now names the internal hero QA gate, preserves an
indeterminate active state while it runs, and shows a label, actual state and
per-frame automatic-repair ordinal on all five customer cards. It never counts
the internal hero as a customer photograph and does not change generation,
provider, QA or persistence behavior.

Code: TESTED — `node --test test/web/editorial-preview-ui.test.js test/web/editorial-state.test.js test/web/scene-mobile-contract.test.js` (18/18 pass), plus `git diff --check`.

Beta: NOT_DEPLOYED — branch handoff only.

Journey: NOT_RUN — no paid generation was requested or run.

weakened_checks: none.
