# Main Site collaboration board

The live board is GitHub issue
[`#2 — Main Site live agent claims and intersections`](https://github.com/edwin0912-00/wardrobe-web2/issues/2).
It is shared by every worktree and branch; this file defines the protocol only.

## Current project handoff

The complete product is in `alpha`; the current operating map is
[`docs/UNIFIED_PROJECT_MONOREPO_PLAN.md`](docs/UNIFIED_PROJECT_MONOREPO_PLAN.md).
Read it and `README.md` before claiming work. Main, Studio and the Node/Codex
engine are one product; do not create a separate backend or restart an old
clone based on historical documentation.

For each completion, record source commit, deployed product SHA, verification
scope and remaining gaps on this board. Distinguish a real provider result from
fixture tests or health. A docs-only commit may advance alpha while the tested
product artifact stays on its previous SHA; say so explicitly. Never publish
credentials, client images, private absolute paths or full provider receipts.

Stopping services or removing old copies requires an explicit owner request
and the handoff's active-work/path checks; a board claim alone does not grant
that authority.

## Every work atom

```bash
./scripts/collab-board.sh read
./scripts/collab-board.sh claim "<lane>" "<comma-separated files or paths/*>" "<possible intersection>"
```

The claim must happen before editing. It states the direction, intended files,
base SHA, and where the work might cross another agent's contract.

Before commit, the installed pre-commit hook reads the live board again. It
refuses the commit when:

- the current worktree has no agent identity;
- that agent has no active claim;
- staged files fall outside the claim;
- staged files overlap another active claim.

After a successful commit and push:

```bash
./scripts/collab-board.sh release "$(git rev-parse HEAD)" "<short result>"
```

One active claim per agent is allowed. A new claim supersedes that agent's old
claim. Claims are coordination locks, not ownership of the product.

Both agents publish completed atoms to the single remote working and release
branch `alpha`. Local branch names are intentionally private to their separate
worktrees and must not be pushed. Historical `canonical-site-main`, `beta` and
`main` refs are outside day-to-day work.

## Worktree identities

Install once in each worktree:

```bash
./scripts/install-collab-hooks.sh codex
./scripts/install-collab-hooks.sh claude
```

Never share one checkout between agents. Never bypass the hook to race an
overlapping atom; release or narrow the conflicting claim on the board first.
