# Zeely Production Scene Looper

Autonomous in-session loop for the complete `saved look → production scene`
and `ShootBible → six-shot editorial series` product layer.

The previous mood-card result remains preserved under `loop-workspace/`.
Version 2 uses `loop-workspace-production-v2/`; it does not treat the old
`14/14` visual-board verdict as evidence that production runtime exists.

## Easy run / resume

Open `RUN_IN_SESSION.md` in a Codex session and follow it as the active task.
State and every meaningful check are persisted under
`loop-workspace-production-v2/`.

## Completion rule

`100/100` requires deterministic release, service, profile, UI, privacy and
E2E checks plus independent per-hash visual and architecture verdicts. A
`PENDING`, `SKIPPED`, aggregate-only verdict, untracked release artifact or
unverified requirement blocks completion.

## Safety boundary

The loop may edit the scene/profile implementation, UI, contracts, tests and
generated non-personal release assets. It may inspect a local approved look for
in-session E2E, but reviewer contexts exclude `runtime/**`, personal inputs and
secrets. It does not commit, push, deploy, delete unrelated data or restart the
live service.
