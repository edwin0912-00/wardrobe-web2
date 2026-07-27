# Wardrobe verified state

Updated: 2026-07-27 01:58 UTC.

## Canonical position

- Repository: `edwin0912-00/zeely-ai-engineering-test`.
- Development target: `integration/wardrobe-20260726` at
  `66968f9915bbddb1095174711cfd845bf95da0f8`.
- `main` is not a deployment target for this sprint. Only independently
  reviewed, scoped PRs may merge into `integration`.
- `CTRL-002` is merged through PR #22. The repository now has a typed,
  schema-validated agent status artifact, a Git-backed report watcher, and
  exact per-task status paths. This is observability, not proof that an
  unattended external LLM is running.

## Three-hour recovery sprint

Hard stop: 2026-07-27 04:38 UTC. No paid generation, deployment, credential
operation, runtime/output mutation, synthetic pixels, or gate relaxation is
authorized in this run.

1. `MONITOR-002` — add durable typed stall diagnostics and throttled recovery
   heartbeat evidence, with sanitized API/SSE projection only.
2. `UI-002` — reproduce and repair the saved avatar/look → Add items flow in
   the public UI. If no real failing UI regression exists, it stops with a
   typed blocker rather than inventing a backend change.
3. `FASHION-001` — port the already-reviewed private immutable six-frame
   editorial contact-sheet manifest to the current integration contract. It
   indexes approved outputs only; it does not generate media or create UI.

Each lane is ASSIGNED, not claimed as active. It has a separate lock, branch,
pinned source blobs, exact status path, test-first acceptance, isolated
handoff, and independent review requirement. A lane moves to IN_PROGRESS only
after its assigned worker publishes a typed STARTED report.

## Verified product facts

- Browser-bound 30-day profile persistence, avatar → look → child-look lineage,
  immutable Add-items source binding, and cross-profile denial are already in
  the backend. The reported defect belongs to the public UI transition, not a
  reason to duplicate the profile backend lane.
- The monitor already detects stale persisted runs and emits recovery behavior.
  What is missing is a durable, typed, bounded diagnostic and restart-safe
  heartbeat proof.
- A reviewed contact-sheet implementation exists on preserved source commit
  `352066443d0a8db46260db022b36f1c9b09adba1` / PR #16, but it is not yet
  safely integrated at the current base. `FASHION-001` is pinned to that
  source and may port/reprove it narrowly; it may not recreate it from memory.
- Standard scene repair code already contains the generic measured-headroom
  branch; the old `WARD-002` demand for a new failing test against a base that
  already contains the fix was invalid. It is not being fabricated.
- Backgrounds (`std.*`) and locked photoshoots (`shoot.*`) remain a required
  product split. The four unapproved photoshoot styles are blocked on supplied
  rights/reference packs, not solvable by inventing sources or spending on
  generation.

## Known baseline limitation

`node tools/coordination/check-test-baseline.mjs --base e1ff773…` reports
`UNEXPECTED_REGRESSION` on that base itself (82 affected test files). It is a
pre-existing integration-baseline defect. Scoped governance and lane
acceptance checks remain required; this fact is not a waiver and no check may
be weakened to hide it.

## Retired or blocked assignments

- `CTRL-002`: DONE.
- `WARD-002`: CANCELLED because its pinned base already has the requested
  repair; a manufactured pre-change failure would be false evidence.
- `PROFILE-001`: CANCELLED because the backend contract is already present;
  `UI-002` owns the user-visible regression.
- `MONITOR-001` and `SITE-002`: CANCELLED after stale/unfinished external
  leases; their evidence is preserved and replaced by scoped current-base
  work.
- `STYLE-001`: BLOCKED pending legitimate reference-rights evidence and a
  conforming current-base branch.

## Stop and ask Edwin

- Any new or reconstructed image pixels, including crop expansion.
- Any global or preset-specific gate relaxation.
- Any paid provider, credential, deploy, `site.madeforthisjob.com`, or port
  `4180` action.
- Any style-reference approval without supplied rights and hash evidence.
