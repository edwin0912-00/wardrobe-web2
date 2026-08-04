# Run `zeely-production-scene-until-clean` In This Session

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
- Workspace: `./loop-workspace-production-v2`
- State file: `state.json`
- Run log: `run-log.md`

## Goal

Deliver a working Zeely production scene layer in which an anonymous browser profile can select a saved approved look, choose an approved standard scene or an Edwin editorial program, generate persistent 4:5 results through resumable jobs, and retry only failed scenes or shots. Complete the launch reference assets, strict contracts, provenance, SceneService, API, profile graph, live progress UI, production QA, and the six-shot ShootBible flow. Do not call the result complete until every deterministic requirement is proved and independent judges return 100/100 with no pending, skipped, aggregate-only, or unbound evidence.

## Definition Of Done

The catalog has five explicitly selected and approved standard launch presets. Every selected preset has an immutable empty environment plate, lighting preview, versioned reference pack, source/rights ledger, exact prompt lineage, stable provider/model receipt, and per-asset QA evidence. A persisted SceneService accepts an exact approved-look receipt, produces 4:5 scene jobs independently of core avatar generation, survives restart, supports idempotent scene-only retry, stores results under the saved look, and streams truthful progress. The UI exposes preset selection, generation, retry, deletion and download without forcing a new avatar. All nine scene gates are programmatically or judge enforced. The Edwin mode produces a validated ShootBible and six independently retryable shots using a hero-first gate and concurrency two. Full tests, strict contract/release validators, browser E2E, privacy checks, per-asset visual matrices and production-result judges all pass with zero unresolved findings.

## Context Sources

- Read file `./inputs/scene-brief.md`
- Run command `["git", "-C", "../..", "status", "--short"]`
- Run command `["node", "--test", "../../test/contracts/scene-preset-catalog.test.js"]`
- Run command `["npm", "--prefix", "../..", "test"]`

## Verification Criteria

- `implementation-plan` judge rubric: Review plan.md against the complete definition of done and current repository architecture. Pass only if the plan names every missing contract, asset, service, persistence, API, UI, QA, privacy, E2E and editorial-series obligation; preserves approved avatar/look outputs; sequences interfaces so parallel edits do not conflict; assigns authoritative proof to every requirement; and contains no step that can declare broad completion from a narrower test.

- `full-repository-tests` programmatic: run `["npm", "test"]` and expect `exit_zero`
- `strict-contracts` programmatic: run `["node", "tools/validate-contracts.mjs"]` and expect `exit_zero`
- `scene-release-contract` programmatic: run `["node", "tools/validate-scene-release.mjs", "--strict"]` and expect `exit_zero`
- `scene-service-integration` programmatic: run `["node", "--test", "test/web/scene-service.test.js", "test/web/scene-api.test.js", "test/web/scene-profile-integration.test.js"]` and expect `exit_zero`
- `scene-ui-contract` programmatic: run `["node", "--test", "test/web/scene-ui-contract.test.js"]` and expect `exit_zero`
- `scene-privacy` programmatic: run `["node", "tools/validate-scene-privacy.mjs", "--strict"]` and expect `exit_zero`
- `scene-events-restart` programmatic: run `["node", "--test", "test/web/scene-events-restart.test.js"]` and expect `exit_zero`
- `browser-scene-e2e` programmatic: run `["node", "--test", "test/web/scene-browser-e2e.test.js"]` and expect `exit_zero`
- `editorial-orchestration` programmatic: run `["node", "--test", "test/web/editorial-shoot-service.test.js"]` and expect `exit_zero`
- `scene-retention-cascade` programmatic: run `["node", "--test", "test/web/scene-retention.test.js"]` and expect `exit_zero`
- `scene-provider-capabilities` programmatic: run `["node", "--test", "test/providers/scene-provider-capabilities.test.js"]` and expect `exit_zero`
- `personal-scene-receipts` programmatic: run `["node", "tools/validate-personal-scene-receipts.mjs", "--strict"]` and expect `exit_zero`
- `production-architecture` judge rubric: Inspect current source, schemas, tests and receipts. Score 100 only when: SceneService is independent from core; exact approved-look SHA and PASS receipt are verified; preset/version/reference-pack bindings are immutable; 4:5 is enforced; jobs persist and resume; retries are idempotent and defect-specific; outputs and QA are stored under the profile look; every declared gate is actually enforced; failures never invalidate an already approved avatar/look; and tests exercise success, retry, crash-resume, rejection, authorization and deletion. Return structured JSON and name every missing proof.

- `production-visual-quality` judge rubric: Review every non-personal released plate and lighting preview at original resolution. For personal avatar-conditioned outputs, do not receive pixels: review the redacted exact-hash receipt structure and the result of the strict local personal-receipt validator. Score 100 only when every non-personal asset has its own visual matrix and every personal candidate hash has all blocking same-vendor/current-session receipts for identity, items, scene, lighting, framing, anatomy, leakage and provenance. Aggregate counts or a receipt not bound to the final hash are a failure.

- `editorial-series-quality` judge rubric: Review the ShootBible and all six exact shot hashes. Score 100 only when the series contains a clean identity hero, environmental hero, sculptural three-quarter, one controlled interference frame, material/accessory detail and wide campaign coda; identity and outfit are consistent; each shot follows its own camera/pose/light authority; experimental devices never obscure critical identity or item evidence; and a failed shot can be retried without regenerating the approved look or the other five shots.

- `browser-product-flow` judge rubric: Inspect desktop and iPhone-size browser evidence for the complete flow: open saved profile, choose an existing look, choose a scene, start, observe truthful real-time stages, survive reload, inspect or retry a failed scene, and view/delete/download the saved result. Score 100 only if the active screen is legible, no required action is hidden, no internal paths or engineering-only labels leak, and core look results stay accessible throughout.


## Council

- `architecture-reviewer` reviewer via `["codex", "exec"]` (non-local; timeout 1800s)
- `production-judge` judge via `["codex", "exec"]` (non-local; timeout 1800s)

## Gates

### plan_gate

- When: `after_plan`
- Policy: `revise_until_clean`
- Verdict source: `production-judge`
- Criteria: `strict-contracts, implementation-plan`
- Max revisions: `3`

### delivery_gate

- When: `after_each_delivery`
- Policy: `revise_until_clean`
- Verdict source: `production-judge`
- Criteria: `full-repository-tests, strict-contracts, scene-release-contract, scene-service-integration, scene-ui-contract, scene-privacy, scene-events-restart, browser-scene-e2e, editorial-orchestration, scene-retention-cascade, scene-provider-capabilities, personal-scene-receipts, production-architecture, production-visual-quality, editorial-series-quality, browser-product-flow`
- Max revisions: `3`

## Loop Control

- Max iterations: `24`
- Budget: `{"wall_clock_min": 720}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["the same failing requirement has the same evidence after a targeted revision", "a deterministic check fails with byte-identical output after a relevant edit", "a scene or shot hash and its named visual defect remain unchanged after retry", "runtime restart or reload reproduces the same unaddressed persistence failure"]}`
- Human checkpoints: `none`
- Stop conditions:
  - every delivery-gate criterion passes and every judge score is 100 with zero blocking issues
  - max_iterations reached
  - the same blocker repeats twice without measurable improvement
  - wall-clock budget is exceeded

## Execution Boundary

- Mode: `in_session`
- Isolation: `current_workspace`
- Side effects: `{"duplicate_action_check": true, "notes": "The user explicitly authorized autonomous implementation and verification. The loop may edit scene and profile runtime, schemas, migrations, UI, tests, generated scene assets, prompts, manifests and local QA artifacts. It may call configured image providers for scoped scene assets and inspect an existing local approved-look output for in-session E2E. It must not reveal personal input paths, copy runtime inputs to reviewer contexts, expose secrets, delete unrelated user data, commit, push, deploy or restart the live service without a separate explicit request.\n", "requires_approval": false}`

If the loop needs scheduled runs, child-agent lifecycle management, concurrency control, or restart-safe step retries, stop and tell the user this Looper spec should be handed to a durable orchestrator.

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

Use `state.json` for the latest resumable status and `run-log.md` for the append-only history of what happened.

## Privacy

- Before sending `source-code, schemas, tests, redacted-contracts, generated-nonpersonal-assets` to `architecture-reviewer`, confirm consent and apply redactions `.env, .env.*, secrets/**, **/*.key, runtime/**, inputs/**, output/*/avatar*, artifacts/conditioning/humans/**`.
- Before sending `source-code, schemas, tests, redacted-contracts, generated-nonpersonal-assets` to `production-judge`, confirm consent and apply redactions `.env, .env.*, secrets/**, **/*.key, runtime/**, inputs/**, output/*/avatar*, artifacts/conditioning/humans/**`.

## Start Now

If the user asked to run now, begin at step 1 under Operator Instructions and keep going until a stop condition is reached.
