# Wardrobe verified state

## Fast-mode live position — 2026-07-27

- Safe baseline: `main`.
- Active shared branch: `beta` at `90d6119` plus the fast-mode control commit.
- Beta environment: `https://beta.madeforthisjob.com` — health verified
  `ready`; it runs the Create Universe release built from `90d6119`.
- `iwas.madeforthisjob.com` was not changed during this beta release.
- Current task board: `UPDATE.md`. Historical lanes and `TASKS.json` are not
  an assignment source for this sprint.
- Each joined agent has an ID-bound local `.agent-local/<agent-id>.md` journal
  for concise intent/decision/risk/evidence/next-action checkpoints. It is
  Git-ignored; shared `updates/` include a concise rationale/decision line and
  `UPDATE.md` remains the task-state record.
- `tools/watch-beta-board.sh` is the shared read-only live monitor: it fetches
  beta every 20 seconds and flags overlapping active scopes or help requests.
- `tools/bootstrap-beta-agent.sh` gives a replacement agent a generated unique
  ID, the current help/context, local journal, ONLINE report, and live monitor.
  `WARDROBE_AGENT_LABEL` makes that generated ID human-readable.
- Dedicated bootstrap wrappers exist for Claude Code, Antigravity, and
  OpenCloud; each uses the same beta context and monitor.
- Operator access is remote-first: `USERS.md` is the canonical rule for links
  and localhost OAuth callbacks. A host-local browser is never assumed.
- Higgsfield host authentication is verified active. Magnific is not an active
  beta provider: the supplied API credential received HTTP 401 and was removed
  from the host Keychain; no secret is retained in this repository.
- OpenRouter is a validated backup transport credential on the beta host. It
  remains outside Git and is not the active provider.
- Agents may self-claim one existing `READY` task when the orchestrator is
  unavailable. Parallel code is allowed where `UPDATE.md` reserves different
  concrete paths; a collision, not concurrency itself, is the blocker.
- A direct Edwin assignment is also authority for that specific agent to create
  its own path-reserved row and STARTED report. The orchestrator observes and
  resolves collisions; it is not a task-creation bottleneck.
- `BETA-SMOKE-001` PASS: beta exposes five expected `shoot.*` styles and each
  preview returns HTTP 200. The two newer male style-unit directories are not
  registered in the catalog and are therefore not yet user-selectable.
- `BETA-UNIVERSE-001` is the active product bridge for those two male style
  units. They remain `ASSETS_ONLY — NOT IN PRODUCT` until strict manifests and
  reference packs compile, the focused preview checks pass, and the exact
  tested commit is activated and smoke-tested on beta.
- `BETA-UI-001` is live on beta release `ac7259b`: a saved avatar with two or
  more looks opens the look grid so the user selects a specific look; exactly
  one look still opens directly. Focused tests: 24/24; live static-module and
  health smoke: PASS.
- `PIPELINE.md` is the canonical named-step product map. It distinguishes a
  core feature from a live beta-proven feature, without a fictitious overall
  completion count.
- `ART_SHOOT`, `VIDEO`, and `LIVE_WEBCAM` are explicit downstream blocks in
  the canonical map. None is claimed live; video and live both start only from
  a concrete approved fashion-shoot output.
- `docs/VIDEO_LIVE_CANON_UA.md` defines the current approved product boundary:
  fashion motion is source-bound; Live Director is local-first; a generated
  webcam result is labelled delayed preview and requires explicit capture.
- `BETA-POST-SHOOT-001` was owned by external agent `codex-live-20260727` and
  is now beta-smoked as the local/mock approved shoot → Video/Lucy Live MVP.
- Beta release `37e51c8` is active and health is `ready`. The post-shoot mock
  UI and validated graph API are live; real paid Lucy/WebRTC is deliberately
  disabled. All five `shoot.*` previews return HTTP 200.
- Standard-background expansion is not accepted: 11 new production plates are
  deployed but the live catalog exposes only 5 canonical cards, while the
  committed config has 21 presets against a strict maximum of 10 and fails 4
  focused catalog tests. The required resolution is a product/catalog decision,
  not a test relaxation.

Updated: 2026-07-27 08:55 UTC.

## Canonical position

- Repository: `edwin0912-00/zeely-ai-engineering-test`.
- Development target: `integration/wardrobe-20260726` at
  `5df0df404f3ed5ffb81d1c4490da57f042920bed`.
- `main` is not a deployment target for this sprint. Only independently
  reviewed, scoped PRs may merge into `integration`.
- Create Universe is now wired on the `lane/INT-001/codex-main` release
  candidate: four hash-valid `shoot.*` units compile into six independent
  image-reference packs; `shoot.terracotta_hardlight` remains visible but
  blocked because six declared source SHA-256 values do not match the tracked
  bytes. This is integrity enforcement, not a product or QA waiver.
- `CTRL-002` is merged through PR #22. The repository now has a typed,
  schema-validated agent status artifact, a Git-backed report watcher, and
  exact per-task status paths. This is observability, not proof that an
  unattended external LLM is running.

## Three-hour recovery sprint

Continuation window: through 2026-07-27 10:30 UTC. Edwin has now authorized generation and
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
   Generation two measures the exact parser matrix separately from the full
   release suite: local full-suite resource refusal remains a later release
   preflight gate, not a false PASS or a waived deploy check.

The issued worktrees start at `f578c28`, while the first queue record pinned
their product baseline at `66968f9`. This exact-base mismatch was caught before
product edits and corrected. Fresh typed STARTED reports now bind the corrected
base: MONITOR-002 `c83a2a3`, UI-002 `b34d728`, and FASHION-001 `51ad26c`.
All three are IN_PROGRESS. Each lane has a separate lock, pinned source blobs,
exact status path, test-first acceptance, isolated handoff, and independent
review requirement.

`SCENE-001` generation two is DONE: PR #35 merged as `df9e887`. The current
integration checkout passes all six scene suites (60/60). The GitHub broad
baseline job remains unable to classify its pre-existing asset-hash fixture
under that runner; exact PR-merge reproduction showed only the known
`b2fd…`/`f909…` fixture mismatch, not a scene regression.

`RELEASE-001` and `MONITOR-002` are reissued against current integration
`5df0df4` (generations 3 and 2). Their old product candidates were clean, but
their former bases predated SCENE-001 and therefore truthfully failed the
task-base drift guard. The reissue changes no allowed path, acceptance rule,
or product behavior; it requires refreshed status and isolated handoff after
rebasing. The broad release suite remains a later candidate gate.

## Verified product facts

- Beta preview delivery is content-addressed as of the preview-revision fix:
  background and Create Universe catalog cards carry the SHA-256 of their
  exact preview bytes in `preview_url`. Immutable image caching therefore
  cannot preserve an older visual after a new release.
- The operator approved beta publication of the eleven new hash-bound
  background packs. The published catalog retains the five prior packs so
  saved scenes remain resolvable; it now has sixteen selectable backgrounds.
  Every additional pack is bound by an exact local-pack-index SHA before the
  resolver will expose it.
- Beta is currently deployed at product commit `34f727f`. A 16-background
  catalog release has passed focused contract/API verification and is pending
  the immediate beta activation smoke check.

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

## Live external-agent connectivity check

At 2026-07-27 09:36 UTC the local watcher successfully fetched the canonical
GitHub board for both `codecod` and `antigravity`, but returned no assignments:
their only historic leases are BLOCKED or owned by different agent ids. Two
temporary, non-product smoke leases now require each external agent to publish
a typed `STARTED` status from its exact lane branch. The test is successful
only after that status is observable on GitHub; starting a local watcher alone
is not treated as proof that an external agent is alive.

## Known baseline limitation

`node tools/coordination/check-test-baseline.mjs --base 44aa829…` reports
`UNEXPECTED_REGRESSION` on that base itself (82 affected test files). The
verified source defects are an import of `contactPointInsideFrame` in
`src/web/scene-adapters.js` with no matching export from
`src/web/scene-contract.js`, and an evaluator call that omits its required
delivery canvas. `SCENE-001` generation one proved the first repair and
reported the second as out-of-lease; generation two is formally limited to both
existing contract handoffs and regression coverage, including a separate static
acceptance check for the evaluator handoff. Scoped governance and lane
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
