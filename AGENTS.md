# WARDROBE agent entrypoint

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

GitHub has three durable lines: public `alpha` is the owner-approved installable
release containing both products; `canonical-site-main` is the cinematic-site
working/deploy line; `beta` in the private engine repository remains the engine
working/deploy line. Historical `main` is not the current installation authority.
Do not deploy live sites directly from unified `alpha`; deploy each
surface from its owned working line after its own gate. Never put credentials,
runtime user data, or encrypted credential backups in an evaluator-facing
branch.

The canonical behavior gate is `./verify` (`npm test` is only an alias). It must start and inspect the real
browser bridge and the real two-process local runtime. A string-presence check
cannot substitute for those stages.
