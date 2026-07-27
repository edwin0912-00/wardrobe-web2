# Wardrobe integration log

Append one entry for every change that enters
`integration/wardrobe-20260726`. The entry must be committed with the code it
describes. Claims without a command, artifact, commit, or observable result are
not evidence.

Format:

```text
YYYY-MM-DD · TASK-ID · lane head · handoff/PR
Change: …
Why: …
Evidence: …
weakened_checks: none | BLOCKED: …
```

## Entries

2026-07-27 · MONITOR-002 / UI-002 / FASHION-001 · corrected execution start
Change: move the three tasks to IN_PROGRESS only after fresh STARTED reports
bound to the corrected exact base `f578c28` were observed.
Why: the earlier reports belonged to the old product-base pin and were
intentionally not used as a liveness claim after correction.
Evidence: watcher reports monitor `c83a2a3`, UI `b34d728`, and fashion
`51ad26c` with exact owner/branch/base bindings and no report issues.
weakened_checks: none.

2026-07-27 · MONITOR-002 / UI-002 / FASHION-001 · exact-base correction
Change: return the three tasks to ASSIGNED and repin their `base_sha` from
`66968f9` to the exact issued worktree commit `f578c28`.
Why: the control-only dispatch PR sat between the original product baseline
and the actual worktrees. An agent caught that mismatch before product edits;
the queue must not ask a worker to silently bridge it.
Evidence: no product changes occurred after the hold. Existing status-only
commits are preserved, including UI's typed `ASSIGNMENT_AMBIGUOUS` stop. Fresh
STARTED reports are required before execution resumes.
weakened_checks: none.

2026-07-27 · MONITOR-002 / UI-002 / FASHION-001 · execution acknowledged
Change: move all three assigned recovery tasks to IN_PROGRESS after each owner
published a schema-valid STARTED artifact on its exact Git branch.
Why: task state now reflects observed work rather than intended work; product
code may begin only after this acknowledgement gate.
Evidence: monitor `70089c7`, UI `0179927`, and fashion `3c01a19` each changed
only its matching status artifact; the report watcher resolves all three with
`STARTED / CONTEXT_READ / RUN_PRECHANGE_PROOF` and no sensitive report text.
weakened_checks: none.

2026-07-27 · recovery dispatch review revision · PR #24
Change: move MONITOR-002, UI-002, and FASHION-001 from IN_PROGRESS to
ASSIGNED until each exact worker branch commits a typed STARTED report; bind
FASHION-001 to the preserved reviewed source commit and four source blobs.
Why: independent review found that a queue must not claim liveness before an
acknowledgement, and a port task must have an immutable source rather than
invite an unreviewed reconstruction.
Evidence: independent reviewer verified all scope/lock/path/context checks and
returned REVISE only for those two control defects; the corrected board remains
schema-valid and has no overlapping active scopes.
weakened_checks: none.

2026-07-27 · CTRL-002 / recovery dispatch · integration 66968f9
Change: mark CTRL-002 DONE after PR #22, retire stale or invalid duplicate
leases, and issue MONITOR-002, UI-002, and FASHION-001 as three disjoint
current-base lanes.
Why: the previous remote assignments either had no fresh heartbeat/product
diff, requested a regression against code that already contained the repair,
or targeted a backend that already met the stated ownership contract. The new
lanes cover the actual remaining user-visible flow, live diagnostic evidence,
and fashion-shoot contact-sheet foundation without paid generation or copied
media.
Evidence: CTRL-002 isolated acceptance and independent review passed before
merge; the queue candidate validates with exact task status paths, pinned
context blobs, no active lock/scope overlap, and a 04:38 UTC hard stop.
The known global baseline failure remains reproducible on its own historical
base and is not represented as green.
weakened_checks: none.

2026-07-27 · CTRL-002 · active status-path grants
Change: grant each current active task exactly one matching
`.agents/status/<task-id>.json` path.
Why: an authenticated worker needs a narrow place to commit a sanitized
heartbeat, blocker, or ready report; absence of that exact lease otherwise
keeps the shared queue silent.
Evidence: five paths are exact task IDs, no wildcard or cross-task scope was
added, and the trusted board validator accepts the candidate.
weakened_checks: none.

2026-07-27 · CTRL-002 · execution started
Change: move the durable queue-listener and sanitized agent-status lease from
ASSIGNED to IN_PROGRESS.
Why: its isolated implementation branch has begun work; this state is required
before its evidence PR can be reviewed by the trusted queue runner.
Evidence: owner, branch, pinned base, lease generation, scoped paths, and stop
conditions are unchanged; no product, deployment, or credential authority was
added.
weakened_checks: none.

2026-07-27 · CTRL-002 · durable report protocol candidate
Change: add an exact per-task status schema, authenticated lane-side status
writer, read-only report watcher, bootstrap pack, and bounded coordination
observer loop; require every active lease to reserve only its exact status
artifact.
Why: remote agents need one shared, durable queue and factual progress signal
without shared conversation context, shared credentials, broad write authority,
or an unattended process pretending to be an agent.
Evidence: the focused governance command passed 25/25, the candidate board
validates, the legacy free-text publisher regression fails against the
pre-change implementation and passes after the typed error repair, status
writer and both watchers emit typed startup events, and the
deterministic Looper compiler/linter reports zero findings. Fresh live reports
expire after fifteen minutes; compiler-local paths and report text containing
credentials, prompts, runtime identifiers, local paths, email, or phone are
rejected. A new test is recorded as failing against the pinned pre-change tree
because the status contract module did not exist there.
weakened_checks: none.
2026-07-27 · CTRL-002 · reporting activation scope
Change: widen the existing coordination lease to update the ownership and task
board rules required for per-task status artifacts.
Why: a listener without a task-owned status path cannot report a heartbeat,
blocker, or ready state to the orchestrator through GitHub files.
Evidence: scope remains limited to the root control ledgers plus the original
coordination artifacts; the implementation must grant only exact per-task
status paths and its tests must reject wildcard or cross-task writes.
weakened_checks: none.

2026-07-27 · CTRL-002 · durable agent coordination lease
Change: issue a control-plane task for GitHub-backed assignment listening,
sanitized agent heartbeat/status reports, and one canonical context pack.
Why: a read-only task watcher alone cannot notify the orchestrator about
progress or make disconnected agents share verified model/crop/pipeline rules.
Evidence: the task is isolated to coordination artifacts, requires a new
contract test and adversarial handoff, explicitly forbids secrets, local paths,
external-agent impersonation, deployment, and product-code modification.
weakened_checks: none.

2026-07-27 · CTRL-001 · state-ref correction
Change: update the recorded integration revision after the accepted control
leases were merged.
Why: agents must resolve the live integration ref from Git, and the durable
state ledger must not point to a stale ancestor.
Evidence: `git rev-parse origin/integration/wardrobe-20260726` resolved
`0e9bde1` before this ledger update.
weakened_checks: none.

2026-07-26 · CTRL-001 · lane head pending · handoff pending
Change: establish the repository control plane, immutable task leases,
non-overlapping write scopes, handoff contract, PR scope validation, and a
read-only assignment watcher. Acceptance uses a strict command-shape allowlist
and every task has a focused test-first CI route; the history scanner covers
the repository's supported credential families without printing matched
values.
Why: Claude and Codex diverged without a shared queue, ownership gate, current
state ledger, or GitHub checks; Claude's merge analysis and newer tail existed
only locally.
Evidence: the new governance test failed before implementation with
`ERR_MODULE_NOT_FOUND`; post-change evidence is recorded in the CTRL-001
handoff and PR checks. The current focused governance suite passes 76/76.
weakened_checks: none.

2026-07-26 · WARD-002 · core standard-scene lane started
Change: reissue standard-scene convergence as an active, narrowly-scoped core
lane for `claude-code-dev`; it no longer waits on the incompatible WARD-001
batch.
Why: the observed production failure is headroom repair exhaustion on `std.*`.
This is a separate core product vector and can be proven without changing
assets, gates, or paid-provider state.
Evidence: the lease requires a new all-standard-preset regression test plus
the existing scene-service, API, framing-owner, and framing-schema contracts.
weakened_checks: none.

2026-07-26 · SITE-002 · execution started
Change: move the accepted contact-sheet lease from ASSIGNED to IN_PROGRESS.
Why: the implementation worker has started on its exact isolated branch and
its eventual PR must be accepted against an active lease.
Evidence: task owner, branch, lock, scope, base, and expiry are unchanged from
the accepted queue assignment.
weakened_checks: none.

2026-07-26 · WARD-001 · blocked after hosted compatibility proof
Change: mark the evidence lane BLOCKED and release its locks.
Why: PR #8 passed focused acceptance but failed trusted-base compatibility:
candidate strict provenance expects fields absent from legacy fixture contracts.
Evidence: hosted `trusted-test-compatibility` failed with legacy scene-service
and provider assertions; no gate was weakened and the branch remains preserved.
weakened_checks: none.

2026-07-26 · STYLE-001 / PROFILE-001 / MONITOR-001 · parallel leases
Change: issue three non-overlapping 24-hour implementation lanes for CodeCod,
OpenCode, and Antigravity, plus one shared GitHub onboarding procedure.
Why: core merge review must not serialize style-system preservation, saved-avatar
backend work, and monitor reliability work.
Evidence: each task has one owner, one branch, unique lock group, exact base,
focused CI acceptance, isolated handoff path, and no runtime/deploy/credential
authority.
weakened_checks: none.

2026-07-26 · SITE-002 · contact-sheet backend lease
Change: issue an isolated editorial task for a private, immutable six-frame
contact-sheet manifest after a shoot reaches COMPLETED.
Why: fashion shoot needs a reviewable product artifact before UI reconnect,
without re-generating images or leaking another browser profile's media.
Evidence: the task has one editorial lock, exact source-context pins, a new
route test that must fail against its base, ownership/no-store requirements,
and an isolated handoff path.
weakened_checks: none.

2026-07-26 · CTRL-001 · 36ae95a · PR #2
Change: install the permanent `control/codex-main` queue route, stale-base and
candidate-board validation, and correct prior-handoff drift classification.
Why: task assignment and completion must be GitHub-reviewed ledger changes,
while a previous task handoff must not be mistaken for product-code drift.
Evidence: exact local acceptance passed; the new regression failed against the
pre-fix implementation and passed after it; two independent reviews returned
PASS. PR #2 merged as `9d4780f`. Its integration-base jobs exposed the exact
old-checker bootstrap defect before candidate execution, which this merge
replaced.
weakened_checks: none.

2026-07-26 · WARD-001 · assigned at 9d4780f · control queue
Change: close CTRL-001 and lease the Claude/Codex semantic reconciliation to
`codex-wardrobe-merge` on `lane/WARD-001/codex-wardrobe-merge`.
Why: the control plane is now installed and reconciliation is the first product
priority.
Evidence: task base and both required-context blob hashes resolve at
`9d4780f`; lease generation 2 expires 2026-07-27T21:29:08Z.
weakened_checks: none.

2026-07-26 · WARD-001 · dc06b99 · handoff ee7d50f
Change: freeze the reconciled wardrobe/scene implementation and move its lease
from ASSIGNED to REVIEW.
Why: the lane now has an isolated handoff, exact history scan, focused
integration proof, and an independent adversarial PASS.
Evidence: initial and repair-mode source-staging provenance tests pass; the
scene integration command passed 51/51 before the final fixture-parity
correction, whose exact affected tests pass 3/3. Local full regression remains
resource-refused and the clean hosted regression is mandatory before merge.
weakened_checks: none.

2026-07-26 · WARD-001 · dc06b99 unchanged · lease generation 3
Change: preserve failed evidence PR #5 and reissue the unchanged implementation
to `codex-wardrobe-merge-v2` on a fresh handoff branch.
Why: the trusted GitHub runner did not have the `rg` binary, so acceptance
failed before candidate regression with no product-test failure. A reviewed
handoff branch cannot be force-pushed.
Evidence: governance passed on PR #5; task acceptance reported only
`conflict-marker-scan` with no executable exit code. The replacement portable
check is exact `git diff --check $TASK_BASE_SHA...$TESTED_CODE_SHA`.
weakened_checks: none.
