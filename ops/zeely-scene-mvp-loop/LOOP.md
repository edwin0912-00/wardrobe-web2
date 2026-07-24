# zeely-production-scene-until-clean

Build and verify the complete saved-look scene and six-shot editorial pipeline, not only its mood board.

## Goal

Deliver a working Zeely production scene layer in which an anonymous browser profile can select a saved approved look, choose an approved standard scene or an Edwin editorial program, generate persistent 4:5 results through resumable jobs, and retry only failed scenes or shots. Complete the launch reference assets, strict contracts, provenance, SceneService, API, profile graph, live progress UI, production QA, and the six-shot ShootBible flow. Do not call the result complete until every deterministic requirement is proved and independent judges return 100/100 with no pending, skipped, aggregate-only, or unbound evidence.

## Definition of Done

The catalog has five explicitly selected and approved standard launch presets. Every selected preset has an immutable empty environment plate, lighting preview, versioned reference pack, source/rights ledger, exact prompt lineage, stable provider/model receipt, and per-asset QA evidence. A persisted SceneService accepts an exact approved-look receipt, produces 4:5 scene jobs independently of core avatar generation, survives restart, supports idempotent scene-only retry, stores results under the saved look, and streams truthful progress. The UI exposes preset selection, generation, retry, deletion and download without forcing a new avatar. All nine scene gates are programmatically or judge enforced. The Edwin mode produces a validated ShootBible and six independently retryable shots using a hero-first gate and concurrency two. Full tests, strict contract/release validators, browser E2E, privacy checks, per-asset visual matrices and production-result judges all pass with zero unresolved findings.

## Verification

- `implementation-plan` (judge)
- `full-repository-tests` (programmatic)
- `strict-contracts` (programmatic)
- `scene-release-contract` (programmatic)
- `scene-service-integration` (programmatic)
- `scene-ui-contract` (programmatic)
- `scene-privacy` (programmatic)
- `scene-events-restart` (programmatic)
- `browser-scene-e2e` (programmatic)
- `editorial-orchestration` (programmatic)
- `scene-retention-cascade` (programmatic)
- `scene-provider-capabilities` (programmatic)
- `personal-scene-receipts` (programmatic)
- `production-architecture` (judge)
- `production-visual-quality` (judge)
- `editorial-series-quality` (judge)
- `browser-product-flow` (judge)

## Council

- `architecture-reviewer`: reviewer via codex (gpt-5.6-sol)
- `production-judge`: judge via codex (gpt-5.6-sol)

## Gates

- Plan gate: revise_until_clean
- Delivery gate: revise_until_clean

## Loop Control

- Max iterations: 24
- Budget: `{"wall_clock_min": 720}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["the same failing requirement has the same evidence after a targeted revision", "a deterministic check fails with byte-identical output after a relevant edit", "a scene or shot hash and its named visual defect remain unchanged after retry", "runtime restart or reload reproduces the same unaddressed persistence failure"]}`

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "The user explicitly authorized autonomous implementation and verification. The loop may edit scene and profile runtime, schemas, migrations, UI, tests, generated scene assets, prompts, manifests and local QA artifacts. It may call configured image providers for scoped scene assets and inspect an existing local approved-look output for in-session E2E. It must not reveal personal input paths, copy runtime inputs to reviewer contexts, expose secrets, delete unrelated user data, commit, push, deploy or restart the live service without a separate explicit request.\n", "requires_approval": false}`

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
| verdict: production-judge      |
+--------------------------------+
               | needs work -> revise <= 3 -> step 2
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
| verdict: production-judge      |
+--------------------------------+
               | needs work -> revise <= 3 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 24 iterations | no progress x2 | budget 720m
```
