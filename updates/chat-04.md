# Chat 04 — slot pose and subject-light binding

Pipeline step: `UNIVERSE.03–04` → `ART_SHOOT.01–05`.

Code: TESTED — branch `beta-chat-04-shoot-back-pose-lighting`; generic static blocking diagrams are no longer provider pose references for `shoot.*`, every compiled shot carries `subject_lighting`, and `shoot.shutter_amber_interior` binds a distinct slatted-light interaction for each slot. `shoot.terracotta_hardlight` keeps head/body rotation in its sculptural slot pose, not in the unit-wide expression signature.

Focused checks: `node --test test/web/editorial-shot-anchors.test.js`; `node --test test/web/create-universe-units.test.js`; `node --test --test-name-pattern='Create Universe generation omits' test/web/scene-adapters.test.js`; resolver compilation probes for Shutter and Terracotta; all passed. `test/web/editorial-activation-backend.test.js` was stopped after it did not terminate in this worktree; the direct resolver probes cover the modified compiler paths.

Beta: NOT_DEPLOYED.

Journey: NOT_RUN — no paid generation was authorized or performed.

weakened_checks: none.
