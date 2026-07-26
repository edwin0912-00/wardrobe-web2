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
