# Claude Code + Codex side-by-side workflow

This is the operational source of truth for parallel main-site work.

Live direction/file claims are coordinated through `COLLAB-BOARD.md` and its
GitHub issue. Every atom begins with a claim and every commit is checked against
all active claims.

## Branch topology

```text
Codex local worktree  -- claim / commit / rebase --\
                                                   > canonical-site-main
Claude local worktree -- claim / commit / rebase --/          |
                                                               v
                                                   site.madeforthisjob.com

owner-approved official release only:
canonical-site-main -- explicit reviewed fast-forward --> main --> madeforthisjob.com
```

GitHub intentionally has one working branch: `canonical-site-main`. Both agents
publish to it. `main` is the frozen official release source and does not move
during normal development. There are no persistent agent, feature, or
preflight branches.

Separate local branch names exist only because Git cannot safely check out one
local branch in two worktrees. They are never pushed to GitHub. The live board
serialises overlapping files; a fetch/rebase serialises the shared history.

## Local checkouts

- Codex integration worktree:
  `/Volumes/diskSSD/Codex-offload/wardrobe-main-site-codex`
- Claude worktree:
  `/Volumes/diskSSD/Codex-offload/wardrobe-main-site-claude`
- Local frozen `main` release checkout:
  `/Volumes/diskSSD/Codex-offload/wardrobe-main-site-release`

Never point both agents at one of these directories.

## Starting Claude Code

```bash
cd /Volumes/diskSSD/Codex-offload/wardrobe-main-site-claude
claude --name wardrobe-main-site-claude --permission-mode acceptEdits
```

Claude Code automatically discovers `CLAUDE.md`. Claude authentication and the
machine's GitHub credential are used locally; no token belongs in a prompt,
commit, or handoff.

## Opening a local preview

From the agent worktree:

```bash
PORT=4313 python3 serve.py
open http://127.0.0.1:4313/b/
```

This server supports MP4 Range requests. It is a local preview only. Do not
create Quick Tunnel, `chatgpt.site`, or random preview URLs.

## Claiming work before editing

```bash
./scripts/collab-board.sh read
./scripts/collab-board.sh claim \
  "mirror-result-motion" \
  "ui.js, style.css" \
  "may intersect Codex adapter state names; no engine changes"
```

If the live board has an overlapping active claim, the command refuses to post
the new claim. Narrow the atom or coordinate a release first.

## Commit and push from Claude

```bash
git fetch origin canonical-site-main
git rebase origin/canonical-site-main
./scripts/site-preflight.sh
git status --short
git add <only-the-files-owned-by-this-atom>
git commit -m "feat: <one concrete main-site atom>"
git fetch origin canonical-site-main
git rebase origin/canonical-site-main
git push origin HEAD:canonical-site-main
./scripts/collab-board.sh release "$(git rev-parse HEAD)" "<short result>"
```

Claude then gives Codex the SHA. The board protects file ownership while Git's
non-force push protects history. If the remote moved, Claude rebases the
non-overlapping atom and reruns preflight before pushing.

## What actually serves the public domain

```text
Cloudflare Tunnel
  -> 127.0.0.1:4180
  -> Python Range server
  -> /Users/jarvis1/Library/Application Support/WardrobeRuntime/
```

The Next/vinext app, `npm run build`, Cloudflare Workers deploys, and the beta
runtime are not on this request path.

To update the test domain from a clean checkout whose HEAD exactly matches
`origin/canonical-site-main`, run:

```bash
./scripts/deploy-site.sh
```

The deploy script requires the shared-branch upstream and exact remote HEAD,
runs the full test set, creates a timestamped runtime backup, copies the static
site, and verifies loopback plus the test domain. It never deploys `main` or
beta. The official apex release is a separate owner-approved operation and is
not performed by this test deploy script.

## Parallel ownership

Agents coordinate through commits, not shared uncommitted files. Before an
atom, announce the files it expects to own. If both atoms need `ui.js`,
`style.css`, or `b/index.html`, serialize those atoms or split the API seam
first. Good parallel seams are:

- Claude: visual composition, copy, motion curves, mirror/TV/laptop layouts.
- Codex: media transport, scroll clock, adapter contracts, tests, release.
- Either agent may review the other, but neither silently rewrites the other's
  active atom.
