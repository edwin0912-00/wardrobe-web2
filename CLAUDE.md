# WARDROBE main-site contract for Claude Code

Read `AGENTS.md` and `INTEGRATION-HANDOFF.md` in full before doing any work.
Then read `LEVEL-DESIGN.md`, `FUNCTION-MAP.md`,
`docs/10-CLIENT-UI-WINDOW-MAP.md`, and
`docs/15-CLAUDE-CODE-SIDEBYSIDE.md`.

## Identity and boundaries

- Repository: `https://github.com/edwin0912-00/wardrobe-web2.git`
- Product: cinematic customer-facing main site, not engineering beta.
- Canon: the D fabric-world journey in `b/`.
- Public release branch: `main`.
- Integration branch: `preflight/0.2-canonical-d`.
- Your working branch: `agent/claude-main-site-0.2`.
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

1. Work only in your Claude worktree and `agent/claude-main-site-0.2` branch.
2. Before starting an atom: `git fetch origin` and inspect both
   `origin/main` and `origin/preflight/0.2-canonical-d`.
3. Keep each commit to one reviewable visual or interaction atom.
4. Run `./scripts/site-preflight.sh` before every commit and push.
5. Push only your own branch. Report the exact SHA and changed files.
6. Do not merge or force-push `main` or preflight. Codex/the release
   coordinator integrates your SHA into preflight, verifies it, then promotes
   preflight to `main` by fast-forward.
7. Deploy only from a clean, current `main` checkout with
   `./scripts/deploy-site.sh`. The script refuses every other branch.
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
