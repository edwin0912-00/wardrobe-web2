# Wardrobe verified state

Updated: 2026-07-27 03:04 UTC.

## Canonical position

- Repository: `edwin0912-00/zeely-ai-engineering-test`.
- Development target: `integration/wardrobe-20260726` at
  `721bc9af8f67a30eb63e3abb51efab8821b2c1ca`.
- `main` is not a deployment target for this sprint. Only independently
  reviewed, scoped PRs may merge into `integration`.
- `CTRL-002` is merged through PR #22. The repository now has a typed,
  schema-validated agent status artifact, a Git-backed report watcher, and
  exact per-task status paths. This is observability, not proof that an
  unattended external LLM is running.

## Three-hour recovery sprint

Hard stop: 2026-07-27 04:38 UTC. Edwin has now authorized generation and
deployment in principle, but neither may run until a specific approved job and
a verified release candidate exist. Credential operations and gate relaxation
remain prohibited.

1. `MONITOR-002` — add durable typed stall diagnostics and throttled recovery
   heartbeat evidence, with sanitized API/SSE projection only.
2. `UI-002` — reproduce and repair the saved avatar/look → Add items flow in
   the public UI. If no real failing UI regression exists, it stops with a
   typed blocker rather than inventing a backend change.
3. `FASHION-001` — port the already-reviewed private immutable six-frame
   editorial contact-sheet manifest to the current integration contract. It
   indexes approved outputs only; it does not generate media or create UI.
4. `SCENE-001` — generation two carries the preserved missing contract export
   plus the evaluator's existing delivery handoff. The first scoped
   checkpoint proved the export repair, then truthfully blocked on the adjacent
   evaluator call rather than changing it out of lease. This remains one
   scene-core rule surface and does not change framing or QA policy.
5. `RELEASE-001` — make deploy and recovery enforce the declared canonical
   external health target `https://iwas.madeforthisjob.com/api/health`. The
   target is healthy now, but the current tools accept an arbitrary URL.

The issued worktrees start at `f578c28`, while the first queue record pinned
their product baseline at `66968f9`. This exact-base mismatch was caught before
product edits and corrected. Fresh typed STARTED reports now bind the corrected
base: MONITOR-002 `c83a2a3`, UI-002 `b34d728`, and FASHION-001 `51ad26c`.
All three are IN_PROGRESS. Each lane has a separate lock, pinned source blobs,
exact status path, test-first acceptance, isolated handoff, and independent
review requirement.

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
- `iwas.madeforthisjob.com/api/health` is currently healthy and is the
  operator-declared target. `RELEASE-001` must pin it in code before any
  release tool can claim it verified the intended domain.

## Known baseline limitation

`node tools/coordination/check-test-baseline.mjs --base 44aa829…` reports
`UNEXPECTED_REGRESSION` on that base itself (82 affected test files). The
verified source defects are an import of `contactPointInsideFrame` in
`src/web/scene-adapters.js` with no matching export from
`src/web/scene-contract.js`, and an evaluator call that omits its required
delivery canvas. `SCENE-001` generation one proved the first repair and
reported the second as out-of-lease; generation two is formally limited to both
existing contract handoffs and regression coverage. Scoped governance and lane
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
- Any credential action, `site.madeforthisjob.com`, or port `4180` action.
- Any style-reference approval without supplied rights and hash evidence.
