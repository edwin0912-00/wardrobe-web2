# Run `zeely-agent-coordination` In This Session

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

Keep the GitHub coordination plane observable without editing product code, contacting providers, or impersonating an agent. For each active lease, determine whether its exact status artifact is present, schema and lease valid, and reachable from its declared lane. Write a sanitized coordination report that identifies only concrete follow-up actions.

## Definition Of Done

loop-workspace/coordination-report.md names the exact report state for every active lease, separates a missing report from an invalid report or unavailable lane, includes no secret, prompt, raw media, runtime/output identifier, or local absolute path, and all programmatic checks pass.

## Context Sources

- Run command `["node", "../../tools/coordination/validate-board.mjs", "--board-only"]`
- Run command `["node", "../../tools/coordination/watch-agent-reports.mjs", "--once"]`
- Read file `./inputs/coordination-brief.md`

## Verification Criteria

- `board-valid` programmatic: run `["node", "../../tools/coordination/validate-board.mjs", "--board-only"]` and expect `exit_zero`
- `report-snapshot` programmatic: run `["node", "../../tools/coordination/watch-agent-reports.mjs", "--once"]` and expect `exit_zero`
- `report-safe` programmatic: run `["node", "../../tools/coordination/check-coordination-report.mjs", "loop-workspace/coordination-report.md"]` and expect `exit_zero`
- `reporting-contract` programmatic: run `["node", "--test", "../../test/governance/agent-status.test.js", "../../test/governance/agent-control.test.js"]` and expect `exit_zero`

## Council

- No council members configured.

## Gates

### plan_gate

- When: `after_plan`
- Policy: `fixed_passes`
- Verdict source: `none`
- Criteria: `board-valid, report-snapshot, report-safe, reporting-contract`
- Max revisions: `0`

### delivery_gate

- When: `after_each_delivery`
- Policy: `fixed_passes`
- Verdict source: `none`
- Criteria: `board-valid, report-snapshot, report-safe, reporting-contract`
- Max revisions: `0`

## Loop Control

- Max iterations: `12`
- Budget: `{"tokens": 300000, "usd": 0.01, "wall_clock_min": 30}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["same report snapshot repeats without a new valid agent report", "coordination report has no material change after a revision", "programmatic verifier has unchanged failure output"]}`
- Human checkpoints: `none`
- Stop conditions:
  - delivery gate passes clean
  - max_iterations reached
  - same blocker repeats twice
  - any budget cap exceeded
  - a report would require product, deployment, provider, or credential action

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "The user authorized autonomous coordination observation. This loop may write only its own loop-workspace report. It never edits product code, TASKS.json, another agent branch, credentials, media, provider state, deployment, or a live process. Its host is a checked-in deterministic reporter, not Codex or any external model.\n", "requires_approval": false}`

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
