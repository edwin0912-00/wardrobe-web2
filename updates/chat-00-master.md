# Chat 00 Master

Agent ID: `chat-00-master`
Branch: `beta-release-master`
Role: permanent beta integration, version, deploy and rollback owner.

## 2026-07-30

State: ACTIVE

Created the narrow release-master contract. Product blocks submit exact tested
SHAs; Chat 00 integrates and deploys them but writes no feature code. The
release checklist, handoff schema, stop rules and rollback evidence are defined
in `docs/coordination/blocks/00-release-master.md`.

Latest beta:

- code: `afa34d8fcc92026824e20fb98c7e5e9532a772a4`
- cache: `product-afa34d8f-8b3076d910e9`
- health: ready
- durable saved-look lifecycle: PASS on the previously failing look
- background catalog: 16; Fashion Shoot catalog: 19, generation-ready: 17
- LaunchAgent web and tunnel: running after internal control-path recovery
- weakened_checks: none

## 2026-07-31 · Safe beta release cut

- Preserved the actually running beta source as immutable remote branch
  `release/backup-beta-live-20260731-e04f04d` at `e04f04d` before changing
  `beta`. The remote `beta` ref was still `fc3c8b2` even though public health
  reported `e04f04d`; this was a source-of-truth drift, not a reason to
  rebuild or overwrite the live runtime.
- The release cut contains that verified live chain plus the clean Block 1
  provider-wait heartbeat (`f509263`). It records a minute-throttled public
  wait state without exposing provider identifiers or creating a duplicate job.
- Focused release evidence: provider, video and Fashion Shoot suites plus the
  heartbeat contract; strict contract validation. The pre-existing core
  `run-service` suite still has nine unrelated failing fixtures on both the
  `e04f04d` baseline and this cut, so it is not represented as green.
- Explicitly held outside this cut: Chat 01 drag/drop+HEIC,
  Chat 02 profile reports, Chat 04 mood/pose/slot-reference branches,
  Chat 05 legacy video branch, Chat 07 legacy Real-time Look branch,
  saved-look-action-hub, beta-site Chat 03, video-preview-resume, and
  video-capability/style branches. Each conflicts with the current release
  surface or is based on an older shared UI/video contract and must be ported
  and tested as its own atom; none was silently discarded or merged.
