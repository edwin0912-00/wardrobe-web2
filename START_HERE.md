# Start here — Wardrobe beta agents

Run the block-join command supplied by the orchestrator. It binds this clone to
one agent ID and one `beta-block-*` branch, creates a local operational journal,
publishes `ONLINE` only on that branch, and can keep all seven block reports
open.

```bash
bash tools/join-beta-block-agent.sh <agent-id> <1-7> --watch
```

After bootstrap, read in this order:

1. `AGENTS.md` — hard rules and what is forbidden.
2. `UPDATE.md` — live assignments, scopes, and help signals.
3. `STATE.md` — verified product/runtime position.
4. `LOG.md` — why verified changes happened.

Only start the assigned block task. Shared facts go to
`updates/chat-<block>.md` on that block branch; local rationale stays in
`.agent-local/` and is never committed. Agents never push directly to `beta`;
`codex-main` integrates and deploys reviewed commits.

Independent Antigravity QA uses a separate observer entry:

```bash
bash tools/join-antigravity-qa.sh antigravity-qa --watch
```

Its detailed browser procedure and stop rules are in
`docs/coordination/blocks/08-antigravity-qa.md`.
