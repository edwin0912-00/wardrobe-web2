# Start here — Wardrobe beta agents

Run the bootstrap command supplied by the orchestrator. It gives this clone a
unique agent ID, reads the current context, creates a local operational journal,
publishes an `ONLINE` update to `beta`, and can keep the live board open.

Set `WARDROBE_AGENT_LABEL` before bootstrap for a readable generated ID, for
example `antigravity-20260727-a1b2c3`.

After bootstrap, read in this order:

1. `AGENTS.md` — hard rules and what is forbidden.
2. `UPDATE.md` — live assignments, scopes, and help signals.
3. `STATE.md` — verified product/runtime position.
4. `LOG.md` — why verified changes happened.

Only start a product task explicitly assigned in `UPDATE.md`. Shared facts go
to `updates/<agent-id>.md`; local rationale stays in `.agent-local/` and is
never committed.
