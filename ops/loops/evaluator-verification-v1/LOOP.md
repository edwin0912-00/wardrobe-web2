# wardrobe-evaluator-verification-v1

Keep Wardrobe installable and behavior-verifiable from one public command, with the identical contract used locally and in GitHub Actions.

## Goal

Deliver an evaluator-grade public repository in which a clean clone can run one root command to install and test both the cinematic site and beta engine. The same command must be the GitHub required check. A separate read-only mode must compare the checked-out product with the deployed main mirrors and beta bridge. Every failure must identify the first broken behavior and preserve machine-readable evidence. README text may point to the contract but must not reimplement it. Paid generation, credentials, production mutation, and cosmetic product work are outside this loop.

## Definition of Done

The root ./verify command, README command, package scripts and GitHub Actions all delegate to one executable test-system implementation; quick, clean local acceptance and read-only live modes pass; a real Chromium journey and two-process same-origin bridge are covered; failures produce JSON and logs; generated CI artifacts remain available even on failure; no secret or paid provider route is invoked; and no unresolved placeholder remains.

## Verification

- `current-runner` (programmatic)
- `runner-contract` (programmatic)
- `quick-gate` (programmatic)
- `live-gate` (programmatic)
- `clean-install-gate` (programmatic)

## Council

- No council members configured.

## Gates

- Plan gate: fixed_passes
- Delivery gate: fixed_passes

## Loop Control

- Max iterations: 5
- Budget: `{"wall_clock_min": 60}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["the same check fails with the same first_failure twice", "no source or test evidence changes between revisions", "clean-install output repeats without reaching a later stage"]}`

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "The loop may edit only the claimed evaluator/test/docs paths. It never starts paid generation, deploys production, stores credentials, changes branch protection, or repeats a push for an already-published SHA.\n", "requires_approval": true}`

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
               | needs work -> revise <= 2 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 5 iterations | no progress x2 | budget 60m
```
