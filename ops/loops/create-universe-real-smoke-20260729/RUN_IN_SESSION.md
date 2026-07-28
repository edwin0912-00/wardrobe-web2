# Run `create-universe-real-smoke-20260729` In This Session

Use this prompt when the user wants to run the Looper-designed loop in the current LLM session.
This is the default/easy execution path. The Python runner is the advanced path for running later or outside the session.

## Operator Instructions

You are executing a Looper-designed loop in this current session.
Follow the resolved spec below, write handoff files into the workspace, and enforce the caps manually.
Do not use `run-loop.py` unless the user explicitly asks for the advanced external runner.

1. Create the workspace directory if it does not exist.
2. Read the context sources before drafting the plan.
3. Draft `plan.md` in the workspace.
4. Run the plan gate. Apply programmatic checks when available. For judge criteria, use the configured judge only after consent for any non-local egress; otherwise ask the user to approve a human/current-session substitute.
5. Revise until the gate passes or `max_revisions` is reached.
6. Produce `delivery-N.md` in the workspace.
7. Run the delivery gate after each delivery.
8. Stop when all delivery criteria pass, a cap is reached, or the user stops the loop.
9. Keep `state.json` current with status, iteration, last gate, consent, and blockers.
10. Append a compact entry to `run-log.md` after every context read, model call, check, gate verdict, revision, blocker, and stop decision.
11. Compare each blocker against the previous blocker. If the same blocker repeats for the configured no-progress window, stop or ask for the configured human checkpoint instead of revising again.
12. Treat token and USD budgets as operator limits in this session: if exact accounting is unavailable, stop and ask before continuing when the loop appears likely to exceed them.

## Files

- Source spec: `loop.yaml`
- Human summary: `LOOP.md`
- Resolved spec: `loop.resolved.json`
- Workspace: `./loop-workspace`
- State file: `state.json`
- Run log: `run-log.md`

## Goal

Using one controlled non-personal full-look fixture, prove the real Higgsfield scene pipeline, first for one std.* background and then for one ready shoot.* Create Universe hero. Persist immutable job/QA receipts locally and report only identifiers, hashes and gate outcomes. Expand to one hero per remaining ready shoot only after both canaries pass.

## Definition Of Done

A real provider receipt exists for the standard canary and the Create Universe canary; each is terminal with its exact QA result recorded. No mocked media, no raw personal media, and no more than ten Create Universe provider attempts are made.

## Context Sources

- Read file `./README.md`
- Run command `["git", "-C", "/Users/jarvis1/Documents/Codex/2026-07-28/zeely-codex-main-atelier", "status", "--short", "--branch"]`
- Run command `["node", "/Users/jarvis1/Documents/Codex/2026-07-28/zeely-codex-main-atelier/ops/runtime.mjs", "--verify"]`

## Verification Criteria

- `runtime-ready` programmatic: run `["node", "ops/runtime.mjs", "--verify"]` and expect `exit_zero`
- `catalog-integrity` programmatic: run `["node", "--test", "test/web/editorial-preview-api.test.js"]` and expect `exit_zero`
- `receipts-present` programmatic: run `["node", "scripts/check-receipts.mjs", "loop-workspace"]` and expect `exit_zero`

## Council

- No council members configured.

## Gates

### plan_gate

- When: `after_plan`
- Policy: `fixed_passes`
- Verdict source: `none`
- Criteria: `runtime-ready`
- Max revisions: `1`

### delivery_gate

- When: `after_each_delivery`
- Policy: `fixed_passes`
- Verdict source: `none`
- Criteria: `runtime-ready, catalog-integrity, receipts-present`
- Max revisions: `1`

## Loop Control

- Max iterations: `12`
- Budget: `{"wall_clock_min": 90}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["same provider or authentication blocker repeats without a changed receipt", "the same mode fails QA twice without a new typed defect"]}`
- Human checkpoints: `none`
- Stop conditions:
  - both canaries have terminal receipts and the planned expansion is complete
  - max_iterations reached
  - same blocker repeats for 2 iterations
  - wall clock cap exceeded

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "Explicit user approval authorizes these bounded paid Higgsfield calls. The fixture is controlled test media. Never submit user uploads, secrets, or raw prompts to a judge.\n", "requires_approval": true}`

If the loop needs scheduled runs, child-agent lifecycle management, concurrency control, or restart-safe step retries, stop and tell the user this Looper spec should be handed to a durable orchestrator.

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

Use `state.json` for the latest resumable status and `run-log.md` for the append-only history of what happened.

## Privacy

- No cross-vendor egress configured.

## Start Now

If the user asked to run now, begin at step 1 under Operator Instructions and keep going until a stop condition is reached.
