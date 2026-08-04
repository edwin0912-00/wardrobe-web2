# WARDROBE agent entrypoint

## Alpha unified branch

When the checked-out branch is `alpha`, this repository intentionally contains
both products: the cinematic site at the repository root and the complete beta
engine under `beta/`. Read `README-ALPHA.md` and `release/RELEASE.lock.json`
before changing either side. `scripts/install-alpha.sh` is the installation
acceptance gate and `scripts/run-alpha.sh` is the only supported combined local
entrypoint. The restriction below against modifying beta applies to the live
`canonical-site-main` line; on `alpha`, beta changes must remain explicit,
tested and release-locked.

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

GitHub has two durable branches only: `main` is the owner-approved official
release line, while `canonical-site-main` is the shared working and test-deploy
line for Codex and Claude Code. `site.madeforthisjob.com` is deployed only from
the latter. Do not advance or deploy `main` without explicit owner approval.
This is the cinematic main-site repository; do not modify or deploy beta from
here.
