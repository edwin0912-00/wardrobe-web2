# create-universe-real-smoke-20260729

Bounded real-provider proof of the standard background and Create Universe image routes.

## Goal

Using one controlled non-personal full-look fixture, prove the real Higgsfield scene pipeline, first for one std.* background and then for one ready shoot.* Create Universe hero. Persist immutable job/QA receipts locally and report only identifiers, hashes and gate outcomes. Expand to one hero per remaining ready shoot only after both canaries pass.

## Definition of Done

A real provider receipt exists for the standard canary and the Create Universe canary; each is terminal with its exact QA result recorded. No mocked media, no raw personal media, and no more than ten Create Universe provider attempts are made.

## Verification

- `runtime-ready` (programmatic)
- `catalog-integrity` (programmatic)
- `receipts-present` (programmatic)

## Council

- No council members configured.

## Gates

- Plan gate: fixed_passes
- Delivery gate: fixed_passes

## Loop Control

- Max iterations: 12
- Budget: `{"wall_clock_min": 90}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["same provider or authentication blocker repeats without a changed receipt", "the same mode fails QA twice without a new typed defect"]}`

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "Explicit user approval authorizes these bounded paid Higgsfield calls. The fixture is controlled test media. Never submit user uploads, secrets, or raw prompts to a judge.\n", "requires_approval": true}`

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
               | needs work -> revise <= 1 -> step 2
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
               | needs work -> revise <= 1 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 12 iterations | no progress x2 | budget 90m
```
