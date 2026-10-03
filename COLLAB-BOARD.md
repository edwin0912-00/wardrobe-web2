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

Read `CHANGELOG.md` and `docs/PROVIDER-ROUTING.md` before touching installation
or generation. The owner explicitly requested complete GitHub source parity
after the FAL implementation. Publication is authorized even while the
documented Seedance person-reference and host-resource blockers remain;
activation of the live services is a separate operation.

The installation contract is `./verify --run`, covering both website surfaces
and the complete engine. `./setup run` wraps it with the private operator
questionnaire described in `docs/OPERATOR-SETUP.md`. It does not provision
remote machines, DNS, TLS or service managers. Preserve its full-product
receipts and the explicit provider/private-media requirements.

Both websites now have an image-only Slow/Fast choice; Slow is the default and
Fast calls FAL Sunburst directly. Each new image job stores its mode, and retry
or recovery uses the stored value. See `docs/PROVIDER-ROUTING.md` for API and
health contracts. The 2026-10-03 Seedance 2.5 result was a separate,
request-specific derivative test; the 2026-10-01 original-reference refusals
remain terminal. See `docs/VIDEO-REFERENCE-PIPELINE.md` for reproduction.

This local handoff does not establish that current source changes were pushed,
that a new source SHA passed the complete acceptance contract, or that either
service was activated. Record each only from its own source, test and runtime
receipts.

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

## Conservation and video reliability handoff — 2026-10-02 (updated 2026-10-03)

Historical SSD source/media has been consolidated after hash and restoration checks; see `docs/SSD-CONSOLIDATION.md`. The private archive is preservation data, not another active checkout. Keep provider state, current runtime and original references in place. Video acknowledgement recovery must reuse the recorded request and exact model; missing/invalid receipts remain quarantined. Current source repairs do not grant blanket FAL access for person references and do not imply live deployment.

The 2026-10-03 accepted derivative request is separate from the rejected
original-reference jobs and does not grant blanket person-reference access.
Those rejected jobs stay terminal, and the result is not a deployment receipt.
