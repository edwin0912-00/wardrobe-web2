# WARDROBE agent entrypoint

## Current operational handoff — 2026-10-01

Start with `README.md`, then `docs/UNIFIED_PROJECT_MONOREPO_PLAN.md` and
`COLLAB-BOARD.md`. The handoff is the current operational map; older live SHA,
host paths and branch guidance in beta documentation are dated history.
`alpha` is the sole active integration line. Do not recreate the split project
from `main`, `beta` or `canonical-site-main`.

Read `docs/PROVIDER-ROUTING.md` before changing generation. Preserve every
mandatory reference, selected Seedance model and persisted remote request.
Do not resubmit unknown outcomes or silently replace a model. FAL credentials
remain server-only; OpenRouter retains semantic QA.
The 2026-10-01 real Seedance tests were rejected by the partner's content
policy for the supplied person references. Treat those receipts as blocked
provider evidence, not a reason to crop faces, change identities or retry the
same rejected input. Configuration-ready is not generation-proven.

Source, deployed artifacts and private runtime are separate. Preserve the
existing runtime and the dedicated Codex account when changing code. Verify
the actual provider before claiming generation works; health or fixture PASS
alone is insufficient. Do not silently substitute another account or model.
The controller is pinned in `beta/src/providers/codex-app-server-client.js`;
check its availability before modifying that contract.

Restart, stop or cleanup only within the owner's requested scope. Check active
work first, use project launch-agent labels rather than broad process kills,
and keep credentials and generated/client data out of commits and board posts.
The owner removed the consolidation backup; never assume a backup exists.

## Unified release branch

The official evaluator and installation branch is `alpha`, which is also the
public repository default. It intentionally contains both products: the cinematic
site at the repository root and the complete beta engine under `beta/`. Read
`README.md` and `release/RELEASE.lock.json` before changing either side.
The root `./verify` executable is the sole installation and acceptance
contract; README, npm aliases and GitHub Actions must delegate to it instead of
reconstructing its stages. `./verify --run` is the supported combined local
entrypoint. Changes to either product must remain explicit, behavior-tested and
release-locked.

Before changing, merging, or deploying this repository, read
`INTEGRATION-HANDOFF.md` in full. Claude Code must also read `CLAUDE.md` and
`docs/15-CLAUDE-CODE-SIDEBYSIDE.md`.

Before every work atom and every commit, read `COLLAB-BOARD.md` and the live
board it points to. Claim the lane, intended files, and possible intersections
before editing. The installed pre-commit hook enforces an active non-overlapping
claim.

The current D fabric-world journey is the visual and structural source of
truth. Preserve it and the documented mobile/video guarantees. Do not restore
rejected A/B candidates, a version-choice landing page, temporary preview
URLs, or a black mobile video fallback.

GitHub has one active line: public `alpha` is the owner-approved integration,
installation and release source containing both products. Historical `beta`,
`canonical-site-main` and `main` refs are audit history, not places for new
fixes. A deployment may still run the site and engine as separate processes,
but both artifacts must be built from the same verified `alpha` SHA. Never put
credentials, runtime user data, or encrypted credential backups in an
evaluator-facing branch.

Never give a remote or mobile reviewer `localhost` or `127.0.0.1`. For a local
preview, run `npm run share -- --port <port> --background --json` and return
only the HTTPS URL after its health check passes. Stop it with
`npm run share -- --stop`; details are in
`docs/PUBLIC_PREVIEW_TUNNEL_UA.md`.

The canonical behavior gate is `./verify` (`npm test` is only an alias). It must start and inspect the real
browser bridge and the real two-process local runtime. A string-presence check
cannot substitute for those stages.
