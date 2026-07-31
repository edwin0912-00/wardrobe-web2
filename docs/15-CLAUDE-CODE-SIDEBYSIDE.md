# Claude Code + Codex side-by-side workflow

This is the operational source of truth for parallel main-site work.

## Branch topology

```text
agent/claude-main-site-0.2  -- small Claude commits --\
                                                       > preflight/0.2-canonical-d
Codex feature atoms         -- small Codex commits ----/             |
                                                                      | verified fast-forward
                                                                      v
                                                                    main
                                                                      |
                                                                      v
                                                        site.madeforthisjob.com
```

`main` is the public release source. `preflight/0.2-canonical-d` is the only
integration line. An agent branch is never deployed directly.

## Local checkouts

- Codex integration worktree:
  `/Volumes/diskSSD/Codex-offload/wardrobe-canonical-preflight-0.2`
- Claude worktree:
  `/Volumes/diskSSD/Codex-offload/wardrobe-claude-main-site-0.2`
- Existing local `main` release checkout:
  `/Volumes/diskSSD/urgent-offload/user/Documents/Codex/2026-07-23/zeely-3-web-2-0/wardrobe-web2-runtime`

Never point both agents at one of these directories.

## Starting Claude Code

```bash
cd /Volumes/diskSSD/Codex-offload/wardrobe-claude-main-site-0.2
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

## Commit and push from Claude

```bash
./scripts/site-preflight.sh
git status --short
git add <only-the-files-owned-by-this-atom>
git commit -m "feat: <one concrete main-site atom>"
git push -u origin agent/claude-main-site-0.2
```

Claude then gives Codex the SHA. Codex reviews/cherry-picks or fast-forwards
that atom into preflight, resolves any overlap in the canonical architecture,
runs the same preflight, and only then advances `main`.

## What actually serves the public domain

```text
Cloudflare Tunnel
  -> 127.0.0.1:4180
  -> Python Range server
  -> /Users/jarvis1/Library/Application Support/WardrobeRuntime/
```

The Next/vinext app, `npm run build`, Cloudflare Workers deploys, and the beta
runtime are not on this request path.

After a reviewed preflight is promoted to `main`, update the local `main`
checkout and run:

```bash
./scripts/deploy-site.sh
```

The deploy script requires a clean `main` exactly equal to `origin/main`, runs
the full test set, creates a timestamped runtime backup, copies the static
site, and verifies loopback plus the public domain. It never deploys beta.

## Parallel ownership

Agents coordinate through commits, not shared uncommitted files. Before an
atom, announce the files it expects to own. If both atoms need `ui.js`,
`style.css`, or `b/index.html`, serialize those atoms or split the API seam
first. Good parallel seams are:

- Claude: visual composition, copy, motion curves, mirror/TV/laptop layouts.
- Codex: media transport, scroll clock, adapter contracts, tests, release.
- Either agent may review the other, but neither silently rewrites the other's
  active atom.
