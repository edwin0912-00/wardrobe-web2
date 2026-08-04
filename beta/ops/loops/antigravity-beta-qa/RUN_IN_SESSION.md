# Run `antigravity-beta-qa` In This Session

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

For the exact newly deployed beta SHA, identify the affected product block, execute its user-visible journey on https://beta.madeforthisjob.com in a real browser, and publish QA-REPORT.md with reproducible evidence. Never edit product code, weaken checks, deploy, or claim PASS from source/tests alone.

## Definition Of Done

QA-REPORT.md binds the tested and deployed SHAs, names one affected block and journey, contains real browser evidence, console/network summaries and a typed PASS/FAIL/FLAKY/BLOCKED verdict, passes the report checker, and the evidence critic finds no unsupported PASS or weakened check.

## Context Sources

- Run command `["git", "fetch", "origin", "beta", "beta-block-08-antigravity-qa", "beta-block-1-core-look", "beta-block-2-profile-ui", "beta-block-3-backgrounds", "beta-block-4-universe", "beta-block-5-fashion-shoot", "beta-block-6-fashion-video", "beta-block-7-realtime-look"]`
- Run command `["git", "show", "origin/beta:AGENTS.md"]`
- Run command `["git", "show", "origin/beta:UPDATE.md"]`
- Run command `["git", "show", "origin/beta:STATE.md"]`
- Run command `["git", "show", "origin/beta:LOG.md"]`
- Run command `["git", "show", "origin/beta:docs/coordination/BETA_BLOCKS_2026-07-29.md"]`
- Run command `["git", "show", "origin/beta:docs/coordination/blocks/08-antigravity-qa.md"]`
- Run command `["git", "log", "--oneline", "--decorate", "-20", "origin/beta"]`

## Verification Criteria

- `report-schema` programmatic: run `["node", "ops/loops/antigravity-beta-qa/scripts/check-qa-report.mjs", "ops/loops/antigravity-beta-qa/loop-workspace/QA-REPORT.md"]` and expect `exit_zero`
- `board-valid` programmatic: run `["node", "tools/coordination/validate-board.mjs", "--board-only"]` and expect `exit_zero`
- `plan-binds-exact-release` judge rubric: The plan names the exact origin/beta SHA, the deployed health SHA, one affected block and one user journey. Verdict revise if the SHAs do not match, the journey is vague, a private upload is proposed, or a paid generation lacks explicit authorization for this SHA.

- `browser-evidence-is-real` judge rubric: Judge QA-REPORT.md and its evidence manifest. PASS requires a real public-beta browser journey beginning at visible UI, screenshots at transitions, console/network summaries, a persistence refresh, and a terminal saved result. FAIL requires repeatable numbered steps and the first blocking observation. Revise if evidence comes only from source, tests, health, internal API shortcuts, stale screenshots, or another release SHA.

- `checks-not-weakened` judge rubric: Try to disprove the verdict. Revise if the report hides a failed QA check, treats retry as PASS, accepts fake progress, skips a visible UI action, creates a duplicate paid job, or recommends weakening identity, item, silhouette, colour, logo/text, anatomy, framing or persistence checks.


## Council

- `evidence-critic` judge via `["codex", "exec"]` (non-local; timeout 600s)

## Gates

### plan_gate

- When: `after_plan`
- Policy: `revise_until_clean`
- Verdict source: `evidence-critic`
- Criteria: `plan-binds-exact-release`
- Max revisions: `2`

### delivery_gate

- When: `after_each_delivery`
- Policy: `revise_until_clean`
- Verdict source: `evidence-critic`
- Criteria: `report-schema, board-valid, browser-evidence-is-real, checks-not-weakened`
- Max revisions: `2`

## Loop Control

- Max iterations: `8`
- Budget: `{"tokens": 750000, "wall_clock_min": 45}`
- No-progress: `{"action": "stop", "max_stalled_iterations": 2, "signals": ["the same release mismatch repeats", "the same browser blocker repeats without a new owner commit", "QA-REPORT.md has no new evidence after a revise verdict"]}`
- Human checkpoints: `none`
- Stop conditions:
  - delivery_gate passes clean on QA-REPORT.md
  - first confirmed blocking defect is documented with reproducible evidence
  - max_iterations reached
  - same blocker repeats for 2 iterations
  - wall-clock or token budget is exceeded

## Execution Boundary

- Mode: `in_session`
- Isolation: `branch`
- Side effects: `{"duplicate_action_check": true, "notes": "Product code, beta and main are read-only. The agent writes only its QA report/update paths on beta-block-08-antigravity-qa. A provider job is forbidden unless UPDATE.md explicitly authorizes one idempotent smoke for the exact beta SHA.\n", "requires_approval": false}`

If the loop needs scheduled runs, child-agent lifecycle management, concurrency control, or restart-safe step retries, stop and tell the user this Looper spec should be handed to a durable orchestrator.

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

Use `state.json` for the latest resumable status and `run-log.md` for the append-only history of what happened.

## Privacy

- Before sending `qa-plan, qa-report, redacted-browser-evidence-manifest` to `evidence-critic`, confirm consent and apply redactions `.env, .env.*, secrets/**, **/*.key, runtime/**, uploads/**, **/.zeely-run/**, **/*token*`.

## Start Now

If the user asked to run now, begin at step 1 under Operator Instructions and keep going until a stop condition is reached.
