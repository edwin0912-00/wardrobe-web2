# antigravity-beta-qa

Independent browser QA for each deployed Wardrobe beta commit, with GitHub change detection, evidence capture, adversarial review and a typed PASS/FAIL/BLOCKED report.

## Goal

For the exact newly deployed beta SHA, identify the affected product block, execute its user-visible journey on https://beta.madeforthisjob.com in a real browser, and publish QA-REPORT.md with reproducible evidence. Never edit product code, weaken checks, deploy, or claim PASS from source/tests alone.

## Definition of Done

QA-REPORT.md binds the tested and deployed SHAs, names one affected block and journey, contains real browser evidence, console/network summaries and a typed PASS/FAIL/FLAKY/BLOCKED verdict, passes the report checker, and the evidence critic finds no unsupported PASS or weakened check.

## Verification

- `report-schema` (programmatic)
- `board-valid` (programmatic)
- `plan-binds-exact-release` (judge)
- `browser-evidence-is-real` (judge)
- `checks-not-weakened` (judge)

## Council

- `evidence-critic`: judge via codex (default)

## Gates

- Plan gate: revise_until_clean
- Delivery gate: revise_until_clean

## Loop Control

- Max iterations: 8
- Budget: `{"tokens": 750000, "wall_clock_min": 45}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["the same release mismatch repeats", "the same browser blocker repeats without a new owner commit", "QA-REPORT.md has no new evidence after a revise verdict"]}`

## Execution Boundary

- Mode: `in_session`
- Isolation: `branch`
- Side effects: `{"duplicate_action_check": true, "notes": "Product code, beta and main are read-only. The agent writes only its QA report/update paths on beta-block-08-antigravity-qa. A provider job is forbidden unless UPDATE.md explicitly authorizes one idempotent smoke for the exact beta SHA.\n", "requires_approval": false}`

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
| verdict: evidence-critic       |
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
| verdict: evidence-critic       |
+--------------------------------+
               | needs work -> revise <= 2 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 8 iterations | no progress x2 | budget 45m, 750000 tokens
```
