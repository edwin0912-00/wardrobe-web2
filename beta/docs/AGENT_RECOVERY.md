# Agent recovery

Use this when an agent loses its chat, subscription, or local context. The
repository is the authority; conversation history is not.

Run this one command from any terminal that has GitHub CLI installed:

```bash
export WARDROBE_AGENT_LABEL=codex-recovery
curl -fsSL https://raw.githubusercontent.com/edwin0912-00/zeely-ai-engineering-test/beta/tools/bootstrap-beta-agent.sh | bash -s -- --watch
```

The bootstrap creates a new unique agent ID, a new beta workspace, its local
`.agent-local/<agent-id>.md` operational journal, an `updates/<agent-id>.md`
ONLINE report, and the 20-second read-only board monitor. Before monitoring it
prints the recovery pack from the checked-out beta commit: `USERS.md`,
`AGENTS.md`, `UPDATE.md`, `PIPELINE.md`, video/live canon, `STATE.md`, `LOG.md`
and `OWNERS.md`.

GitHub access is deliberately not stored in this repository. If `gh` is not
authenticated, the script starts `gh auth login`; use the owner-authorised
GitHub account. Do not paste tokens, browser cookies, passwords, SSH private
keys, or provider credentials into chat, Markdown, Git, or the local journal.

The new agent starts read-only. It may take only a task allowed by `UPDATE.md`;
the board owns assignments and path reservations.

## SSH-only recovery — no GitHub web login

Use this when the Mac already has an SSH private key whose public key has
write access to this repository on GitHub. It uses no GitHub CLI session or
browser approval:

```bash
export WARDROBE_AGENT_LABEL=codex-recovery
export WARDROBE_GIT_TRANSPORT=ssh
export GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new'
bootstrap_dir="$(mktemp -d)" && git clone --depth=1 --branch beta git@github.com:edwin0912-00/zeely-ai-engineering-test.git "$bootstrap_dir" && bash "$bootstrap_dir/tools/bootstrap-beta-agent.sh" --watch
```

For an old SSD workspace, use this one-command variant instead:

```bash
export WARDROBE_AGENT_LABEL=codex-recovery
export WARDROBE_GIT_TRANSPORT=ssh
export GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new'
export WARDROBE_RECOVER_FROM="/absolute/path/to/old/zeely-workspace"
bootstrap_dir="$(mktemp -d)" && git clone --depth=1 --branch beta git@github.com:edwin0912-00/zeely-ai-engineering-test.git "$bootstrap_dir" && bash "$bootstrap_dir/tools/bootstrap-beta-agent.sh" --watch --recover-from "$WARDROBE_RECOVER_FROM"
```

GitHub does not grant Git access by IP address. This works without a login only
when the existing SSH key is already registered with the required repository
access. `StrictHostKeyChecking=accept-new` only records GitHub's host key on
the first connection; it does not bypass repository authorization.

## Recover an old local workspace too

When a lost agent may have important work that exists only on an SSD, point the
same command at that workspace:

```bash
export WARDROBE_AGENT_LABEL=codex-recovery
export WARDROBE_RECOVER_FROM="/absolute/path/to/old/zeely-workspace"
curl -fsSL https://raw.githubusercontent.com/edwin0912-00/zeely-ai-engineering-test/beta/tools/bootstrap-beta-agent.sh | bash -s -- --watch --recover-from "$WARDROBE_RECOVER_FROM"
```

The old workspace is read-only. The command first verifies that its `origin`
is this exact repository, then creates a separate `*-rescue` worktree and
branch. It preserves tracked changes as an uncommitted three-way patch, stores
the original status and base SHA, copies untracked files under
`.recovery/untracked/`, and copies the ignored local agent journal under
`.recovery/local-journal/`. Nothing is force-applied to `beta`, committed,
pushed, deleted, or changed in the old workspace. A recovery agent reviews the
rescue worktree and moves only verified changes into a normally assigned task.
