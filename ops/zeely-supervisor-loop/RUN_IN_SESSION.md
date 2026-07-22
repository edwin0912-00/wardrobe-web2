# Run `zeely-live-bug-hunt` In This Session

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

Diagnose the latest sanitized incident in runtime/supervisor without opening runtime images or secrets. If it is a code defect, add a deterministic regression test, fix the root cause, run targeted and full tests, and write FIX-REPORT.md. If behavior is correct NEEDS_INPUT, make no code change and document the evidence.

## Definition Of Done

The incident has a reproducible classification, FIX-REPORT.md has exact evidence and file:line locations, targeted tests and npm test pass, no unrelated files change, and monitor receives a terminal agent result.

## Context Sources

- Read file `./inputs/current-incident.json`
- Run command `["git", "-C", "../..", "log", "--oneline", "-10"]`

## Verification Criteria

- `targeted-tests` programmatic: run `["node", "--test", "test/web/garment-passport.test.js", "test/providers/codex-vlm-evaluator.test.js", "test/web/run-service.test.js", "test/monitor/agent-supervisor.test.js"]` and expect `exit_zero`
- `full-tests` programmatic: run `["npm", "test"]` and expect `exit_zero`
- `report-schema` programmatic: run `["python3", "scripts/check-fix-report.py", "loop-workspace/FIX-REPORT.md"]` and expect `exit_zero`
- `root-cause-sound` judge rubric: Compare FIX-REPORT.md with the incident JSON, persisted run state, tests, and diff. Pass only when the stated cause explains the exact transition, the fix removes that cause without weakening fail-closed behavior, and no runtime images, secrets, model policy, or unrelated files were used.


## Council

- `judge-1` judge via `["codex", "exec"]` (non-local; timeout 600s)

## Gates

### plan_gate

- When: `after_plan`
- Policy: `revise_until_clean`
- Verdict source: `judge-1`
- Criteria: `root-cause-sound`
- Max revisions: `2`

### delivery_gate

- When: `after_each_delivery`
- Policy: `revise_until_clean`
- Verdict source: `judge-1`
- Criteria: `targeted-tests, full-tests, report-schema, root-cause-sound`
- Max revisions: `3`

## Loop Control

- Max iterations: `10`
- Budget: `{"tokens": 2000000, "usd": 5.0, "wall_clock_min": 45}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["same incident fingerprint repeats without a new test or diagnosis", "targeted test fails with an unchanged error after revision", "FIX-REPORT.md has no material change after revision"]}`
- Human checkpoints: `none`
- Stop conditions:
  - delivery_gate passes clean
  - max_iterations reached
  - same blocker repeats twice
  - any budget cap exceeded

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "The user explicitly authorized automatic diagnosis and repair. The loop may edit source/tests only; it never commits, pushes, deploys, restarts, deletes data, changes secrets, or changes model policy.\n", "requires_approval": false}`

If the loop needs scheduled runs, child-agent lifecycle management, concurrency control, or restart-safe step retries, stop and tell the user this Looper spec should be handed to a durable orchestrator.

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

Use `state.json` for the latest resumable status and `run-log.md` for the append-only history of what happened.

## Privacy

- Before sending `sanitized-incident-json, source-diff, test-results, fix-report` to `judge-1`, confirm consent and apply redactions `.env, .env.*, secrets/**, **/*.key, runtime/runs/**/inputs/**, runtime/drafts/**`.

## Start Now

If the user asked to run now, begin at step 1 under Operator Instructions and keep going until a stop condition is reached.
