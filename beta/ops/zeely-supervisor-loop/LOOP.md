# zeely-live-bug-hunt

Reproduce, repair, verify, and report one deduplicated Zeely production incident.

## Goal

Diagnose the latest sanitized incident in runtime/supervisor without opening runtime images or secrets. If it is a code defect, add a deterministic regression test, fix the root cause, run targeted and full tests, and write FIX-REPORT.md. If behavior is correct NEEDS_INPUT, make no code change and document the evidence.

## Definition of Done

The incident has a reproducible classification, FIX-REPORT.md has exact evidence and file:line locations, targeted tests and npm test pass, no unrelated files change, and monitor receives a terminal agent result.

## Verification

- `targeted-tests` (programmatic)
- `full-tests` (programmatic)
- `report-schema` (programmatic)
- `root-cause-sound` (judge)

## Council

- `judge-1`: judge via codex (gpt-5.6-terra)

## Gates

- Plan gate: revise_until_clean
- Delivery gate: revise_until_clean

## Loop Control

- Max iterations: 10
- Budget: `{"tokens": 2000000, "usd": 5.0, "wall_clock_min": 45}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["same incident fingerprint repeats without a new test or diagnosis", "targeted test fails with an unchanged error after revision", "FIX-REPORT.md has no material change after revision"]}`

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "The user explicitly authorized automatic diagnosis and repair. The loop may edit source/tests only; it never commits, pushes, deploys, restarts, deletes data, changes secrets, or changes model policy.\n", "requires_approval": false}`

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
| verdict: judge-1               |
+--------------------------------+
               | needs work -> revise <= 2 -> step 2
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
| verdict: judge-1               |
+--------------------------------+
               | needs work -> revise <= 3 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 10 iterations | no progress x2 | budget 45m, $5.0, 2000000 tokens
```
