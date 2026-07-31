# Chat 04 — Fashion Shoot progress atom

Protocol ACK: `afa34d8fcc92026824e20fb98c7e5e9532a772a4`.

Block-map ACK: `afa34d8fcc92026824e20fb98c7e5e9532a772a4`; Code=TESTED; Beta=NOT_DEPLOYED; Journey=NOT_RUN.

Pipeline step: `ART_SHOOT.01–05`.

The Fashion Shoot gallery now names the internal hero QA gate, preserves an
indeterminate active state while it runs, and shows a label, actual state and
per-frame automatic-repair ordinal on all five customer cards. It never counts
the internal hero as a customer photograph.

Follow-up execution atom: after the hero passes, all five customer frames are
scheduled together (not two at a time). A QA or executor failure automatically
requeues only that frame with a new attempt and exponential backoff; approved
siblings remain immutable. Retry budget is persisted and server-owned (five
automatic retries), so a permanent provider/QA fault cannot create an unbounded
paid loop. Previously persisted FAILED frames below that budget are requeued
during service initialization, so a user never has to press a retry control to
resume an old shoot. The event schema and public monitor allowlist accept the
emitted automatic-repair events.

Pre-change proof: the focused service test changed to require five concurrent
customer jobs and repair beyond the previous third failure; against the base it
failed 4/15 (all four requirements timed out under the old two-job / three-retry
contract).

Code: TESTED — `node --test test/web/editorial-shoot-service.test.js test/web/editorial-preview-ui.test.js test/web/editorial-state.test.js test/web/scene-mobile-contract.test.js` (34/34 pass), `npm run verify:contracts` (41 schemas / 9 fixtures / 3 jobs PASS), one direct public-monitor projection assertion, plus `git diff --check`.

Independent adversarial review: PASS — checked concurrency ownership, retry budget/backoff, event allowlisting, multi-instance recovery, cancellation and inactive exhausted-state copy.

Route smoke: BLOCKED — `node --test test/web/editorial-activation-backend.test.js` and the full monitor integration test cannot load their declared `fastify` dependency in this isolated worktree (`ERR_MODULE_NOT_FOUND`); no dependency install or paid provider request was made.

Beta: NOT_DEPLOYED — branch handoff only.

Journey: NOT_RUN — no paid generation was requested or run.

weakened_checks: none.
