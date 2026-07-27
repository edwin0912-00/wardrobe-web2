# Wardrobe verified state

Updated: 2026-07-27 00:03 UTC.

## Canonical source position

- GitHub repository: `edwin0912-00/zeely-ai-engineering-test`.
- `main` is `b12ecf5` and is not the current development truth.
- Claude branch `feature/wardrobe-editorial-mvp-20260726` is `622c878`.
- Codex branch `codex-new-2026-07-26` is `f891719`.
- Their merge base is `d7f760f`; Claude has 6 unique commits and Codex has 14.
- `integration/wardrobe-20260726` is `0e9bde1`.
- WARD-001 implementation is frozen at `dc06b99` with isolated handoff
  `ee7d50f`; GitHub PR #5 preserved that evidence but its trusted acceptance
  runner lacked `rg`. Lease generation 3 reissues the unchanged implementation
  on a fresh handoff branch using portable `git diff --check` (PR #8).
- WARD-001 is now BLOCKED rather than merge-forced: GitHub accepted its focused
  contracts but trusted-base compatibility found real legacy-contract failures.
  The evidence lane is preserved; future work must split it into compatible
  slices with one failing regression test each.
- Claude's newer uncommitted tail was preserved without review as
  `wip/claude-tail-20260726` at `7c3fb32`. WIP is evidence, not integrated
  product code.

## What is proved

- CodeCode's merge analysis identifies the overlapping rule owners and exact
  conflict strategy. Its local source SHA-256 is
  `8f16faffcb1ea3c93589e186588e2e876a29a403047c14a6aebee50c3634f76d`.
- The Codex privacy branch is pushed. Focused privacy/provider tests passed
  there; the full suite did not start because the local resource preflight
  refused 10.79 GiB swap and high load.
- The Claude tail is now recoverable from GitHub. It remains unreviewed and
  must not be merged wholesale.
- GitHub currently has no enforceable branch protection for this private
  repository. The protection/ruleset API returned `403` on the current plan.
  Until the plan is upgraded, the only effective write gate is separate
  branches plus the orchestrator as sole merger.
- The permanent orchestrator queue route is merged through PR #2. Its exact
  local acceptance, pre-change regression, and two independent adversarial
  reviews passed. The task runner
  accepts only narrow command shapes, requires a changed focused test to fail
  against the pinned base, and scans every introduced commit for known
  credential families without emitting matched values.
- WARD-001 history scan and focused scene/privacy contracts pass. Independent
  adversarial review of exact implementation SHA `dc06b99` returned PASS with
  `weakened_checks: none`.
- PR #5 failed before candidate execution only because its trusted Ubuntu
  runner could not spawn `rg`; no product test failed. The replacement
  acceptance command uses installed Git and preserves fail-closed diff checks.

## What is not working or not yet proved

- The reconciled WARD-001 candidate is not yet merged; clean hosted regression
  remains mandatory because the local Mac is below release preflight capacity.
- Standard scenes do not yet prove end-to-end convergence across every preset;
  the observed blocker is insufficient clear space above hair.
- The copied-edge `deterministic_headroom_shift` is not product-approved. It
  adds pixels and therefore remains blocked.
- The taupe-specific relaxation is not approved.
- Backgrounds and photoshoots still share editorial-to-`std.*` coupling through
  `EDITORIAL_BASE_PRESETS`; the product split is not complete.
- A complete production contact sheet and independent six-frame
  style-faithfulness proof are not established.
- Deployment from the merged integration commit has not happened.

## Temporary test baseline

CodeCode reported 540/542 tests passing on its branch, but that claim is not
reproduced on the current integration base `622c878`. A direct strict-baseline
run on that base exits `UNEXPECTED_REGRESSION`; among the observed failures,
scene tests import `contactPointInsideFrame` from a revision that does not
export it. Therefore the current base is not product-green.

The target ceiling after WARD-001 reconciliation remains:

- `test/contracts/scene-production-packs.test.js`: rights-receipt SHA
  `b2fd5090` versus `f9091e2e`.
- `test/qa/scene-release-validator.test.mjs`: `SOURCE_LEDGER_MISSING`.

This is a target ceiling, not a claim about the current base and not a waiver.
A third failure blocks product-code integration. Control-plane-only changes
run governance gates but do not pretend to repair or regress product code.
Each new test must also demonstrate failure against the pinned pre-change
code.

## Current priority

1. Install `CTRL-002`: a durable, GitHub-backed listener and sanitized status
   channel. It will make assignment, progress, blocked state, and handoff
   observable without granting an agent merge, deploy, or credential authority.
2. Accept only small compatible slices; WARD-001 remains preserved evidence,
   not a merge candidate.
3. Land the active profile, monitor, style-unit, and contact-sheet lanes with
   their independent evidence.
4. Build one complete fashion-shoot vertical slice: private contact sheet,
   style unit, six approved stills, then a separate UI task.
5. Remove `EDITORIAL_BASE_PRESETS` only in its own product-split task after
   the vertical slice has a verified contract.
6. Prove standard scenes on every preset and deploy only through
   `tools/deploy-add-items-release.mjs`.
7. Start video only after the image/editorial surface is stable.

## Parallel 24-hour lanes

- `STYLE-001` is leased to `codecod`: durable non-generative style-unit
  extraction and one observed reference unit.
- `PROFILE-001` is leased to `opencode`: browser-bound saved-avatar backend
  and add-items lineage.
- `MONITOR-001` is leased to `antigravity`: sanitized durable diagnostics for
  stalled execution.
- `SITE-002` is IN_PROGRESS with `codex-contact-sheet`: a private immutable
  manifest for six approved fashion-shoot frames; it does not create pixels or
  UI.
- `WARD-002` is IN_PROGRESS with `claude-code-dev`: it owns standard-scene
  headroom-repair convergence across every `std.*` preset, without exceptions,
  synthetic pixels, or paid calls.

They are disjoint from WARD-001's active scene/editorial/privacy locks. Each
agent watches the canonical board with
`node tools/coordination/watch-assignments.mjs --agent <agent-id> --interval 20`.

`CTRL-002` is the active control-plane task that extends this read-only
assignment listener into a schema-validated status/heartbeat protocol and a
single context pack. It must not claim that a terminal watcher can wake an
unattended LLM: the runner remains an explicit agent-side process.

## Stop conditions awaiting Edwin

- Any copied-edge or other synthetic-pixel headroom repair.
- Any gate relaxation or per-preset exception.
- Paid generation outside an explicitly assigned task.
- Any credential operation.
- Anything involving `site.madeforthisjob.com` or port `4180`.
