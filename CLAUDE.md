# WARDROBE main-site contract for Claude Code

Read `AGENTS.md` and `INTEGRATION-HANDOFF.md` in full before doing any work.
Then read `LEVEL-DESIGN.md`, `FUNCTION-MAP.md`,
`docs/10-CLIENT-UI-WINDOW-MAP.md`, and
`docs/15-CLAUDE-CODE-SIDEBYSIDE.md`. Read `COLLAB-BOARD.md` and claim a lane
on its live board before editing anything.

## Identity and boundaries

- Repository: `https://github.com/edwin0912-00/wardrobe-web2.git`
- Product: cinematic customer-facing main site, not engineering beta.
- Canon: the D fabric-world journey in `b/`.
- Official release branch: `main` — frozen until the owner approves release.
- Shared working branch on GitHub: `canonical-site-main`.
- Your worktree uses a private local branch but pushes only to
  `origin/canonical-site-main`; never publish another agent branch.
- Public review target: `https://site.madeforthisjob.com/` only.
- Never edit or deploy the beta repository, beta branch, beta UI, or
  `beta.madeforthisjob.com` from this worktree.
- The beta adapter is consumed through its documented presentation-neutral
  interface. Do not copy beta DOM/CSS into this site.

## Current owner-approved experience

- No people in the environment.
- Scroll controls continuous video time in both directions.
- Textile remains above D until approximately 4.4 seconds into `seg1.mp4`,
  when the rails/wardrobe assembly is visible.
- The left mirror owns the person, things, and look stages.
- The right mirror owns the monochrome waiting orb, result, actions, and Live.
- Live expands from the right mirror to fullscreen, lasts up to 40 seconds in
  the standalone preview, and reverses back. Production duration is supplied
  by the server capability.
- TV accepts a real 16:9 Fashion Video or five real portrait Fashion Shoot
  images fitted inside the measured filmed screen.
- Laptop stays empty until the owner supplies real HTML. It then needs a
  reversible camera-scroll to page-scroll handoff; never fake it with a loose
  rectangle or unrelated iframe.
- Client copy contains no provider/model names, prices, security language, or
  implementation diagnostics.

## Side-by-side Git protocol

1. Work only in your Claude worktree. Both agents share the one remote working
   line `origin/canonical-site-main`, but never share a checkout.
2. Before starting an atom: read the live board, claim the direction, files,
   and expected intersection, then fetch and rebase onto
   `origin/canonical-site-main` before editing.
3. Keep each commit to one reviewable visual or interaction atom.
4. Run `./scripts/site-preflight.sh` before every commit and push.
5. Immediately before push, fetch and rebase onto the current shared branch,
   then push explicitly with `git push origin HEAD:canonical-site-main`.
   Report the exact SHA and changed files.
   After push, release the board claim with that SHA and result.
6. Never force-push. Never push `main`. `main` advances from the tested shared
   branch only after explicit owner approval for the official release.
7. Test-deploy only when the local HEAD exactly equals
   `origin/canonical-site-main`, using `./scripts/deploy-site.sh`.
8. Never run two agents in the same checkout. Git worktrees are the isolation
   boundary; Git commits are the handoff mechanism.

## Required handoff after every atom

Return exactly:

```text
branch:
HEAD:
changed files:
tests:
visual result:
known limitation:
ready for Codex integration: yes/no
```

Do not claim browser or device QA you did not actually perform.
