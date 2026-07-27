# zeely-agent-coordination

Observe sanitized GitHub task and agent-status evidence, verify its contract, and record only actionable queue findings for the orchestrator.

## Goal

Keep the GitHub coordination plane observable without editing product code, contacting providers, or impersonating an agent. For each active lease, determine whether its exact status artifact is present, schema and lease valid, and reachable from its declared lane. Write a sanitized coordination report that identifies only concrete follow-up actions.

## Definition of Done

loop-workspace/coordination-report.md names the exact report state for every active lease, separates a missing report from an invalid report or unavailable lane, includes no secret, prompt, raw media, runtime/output identifier, or local absolute path, and all programmatic checks pass.

## Verification

- `board-valid` (programmatic)
- `report-snapshot` (programmatic)
- `report-safe` (programmatic)
- `reporting-contract` (programmatic)

## Council

- No council members configured.

## Gates

- Plan gate: fixed_passes
- Delivery gate: fixed_passes

## Loop Control

- Max iterations: 12
- Budget: `{"tokens": 300000, "usd": 0.01, "wall_clock_min": 30}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["same report snapshot repeats without a new valid agent report", "coordination report has no material change after a revision", "programmatic verifier has unchanged failure output"]}`

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "The user authorized autonomous coordination observation. This loop may write only its own loop-workspace report. It never edits product code, TASKS.json, another agent branch, credentials, media, provider state, deployment, or a live process. Its host is a checked-in deterministic reporter, not Codex or any external model.\n", "requires_approval": false}`

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

## Flow Preview

```text
+--------------------------------+
| 1. Goal + context              |
| read sources                   |
+--------------------------------+
               |
               v
+--------------------------------+
| 2. Draft plan.md               |
| state -> state.json            |
+--------------------------------+
               |
               v
+--------------------------------+
| 3. Plan gate                   |
| verdict: human                 |
+--------------------------------+
               | needs work -> revise <= 0 -> step 2
               | pass
               v
+--------------------------------+
| 4. Write delivery-N.md         |
| log -> run-log.md              |
+--------------------------------+
               |
               v
+--------------------------------+
| 5. Delivery gate               |
| verdict: human                 |
+--------------------------------+
               | needs work -> revise <= 0 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 12 iterations | no progress x2 | budget 30m, $0.01, 300000 tokens
```
