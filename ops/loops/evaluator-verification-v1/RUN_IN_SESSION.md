# Run `wardrobe-evaluator-verification-v1` In This Session

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

Deliver an evaluator-grade public repository in which a clean clone can run one root command to install and test both the cinematic site and beta engine. The same command must be the GitHub required check. A separate read-only mode must compare the checked-out product with the deployed main mirrors and beta bridge. Every failure must identify the first broken behavior and preserve machine-readable evidence. README text may point to the contract but must not reimplement it. Paid generation, credentials, production mutation, and cosmetic product work are outside this loop.

## Definition Of Done

The root ./verify command, README command, package scripts and GitHub Actions all delegate to one executable test-system implementation; quick, clean local acceptance and read-only live modes pass; a real Chromium journey and two-process same-origin bridge are covered; failures produce JSON and logs; generated CI artifacts remain available even on failure; no secret or paid provider route is invoked; and no unresolved placeholder remains.

## Context Sources

- Read file `./inputs/research.md`
- Run command `["git", "log", "--oneline", "-8"]`
- Run command `["git", "status", "--short"]`

## Verification Criteria

- `current-runner` programmatic: run `["node", "--test", "test/test-system.test.mjs"]` and expect `exit_zero`
- `runner-contract` programmatic: run `["node", "--test", "test/test-system.test.mjs", "test/test-report-summary.test.mjs", "test/evaluator-entrypoint.test.mjs"]` and expect `exit_zero`
- `quick-gate` programmatic: run `["./verify", "quick"]` and expect `exit_zero`
- `live-gate` programmatic: run `["./verify", "live"]` and expect `exit_zero`
- `clean-install-gate` programmatic: run `["./verify"]` and expect `exit_zero`

## Council

- No council members configured.

## Gates

### plan_gate

- When: `after_plan`
- Policy: `fixed_passes`
- Verdict source: `none`
- Criteria: `current-runner`
- Max revisions: `1`

### delivery_gate

- When: `after_each_delivery`
- Policy: `fixed_passes`
- Verdict source: `none`
- Criteria: `runner-contract, quick-gate, live-gate, clean-install-gate`
- Max revisions: `2`

## Loop Control

- Max iterations: `5`
- Budget: `{"wall_clock_min": 60}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["the same check fails with the same first_failure twice", "no source or test evidence changes between revisions", "clean-install output repeats without reaching a later stage"]}`
- Human checkpoints: `none`
- Stop conditions:
  - every delivery-gate programmatic criterion passes
  - max_iterations reached
  - the same blocker repeats for 2 iterations
  - wall-clock budget is exhausted

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "The loop may edit only the claimed evaluator/test/docs paths. It never starts paid generation, deploys production, stores credentials, changes branch protection, or repeats a push for an already-published SHA.\n", "requires_approval": true}`

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
