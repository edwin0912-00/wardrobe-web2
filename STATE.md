# Wardrobe verified state

Updated: 2026-07-26 17:53 UTC.

## Canonical source position

- GitHub repository: `edwin0912-00/zeely-ai-engineering-test`.
- `main` is `b12ecf5` and is not the current development truth.
- Claude branch `feature/wardrobe-editorial-mvp-20260726` is `622c878`.
- Codex branch `codex-new-2026-07-26` is `f891719`.
- Their merge base is `d7f760f`; Claude has 6 unique commits and Codex has 14.
- `integration/wardrobe-20260726` is based on `622c878`; the semantic merge has
  not started.
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
- The control-plane governance suite passes 76/76 locally. Its task runner
  accepts only narrow command shapes, requires a changed focused test to fail
  against the pinned base, and scans every introduced commit for known
  credential families without emitting matched values.

## What is not working or not yet proved

- Claude and Codex changes are not reconciled in integration.
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

1. Establish this control plane and preserve all handoffs.
2. Reconcile `integration/wardrobe-20260726` according to the checked-in merge
   analysis, without invented pixels or one-preset exceptions.
3. Make standard scenes reach a verified frame on every preset.
4. Deploy only through `tools/deploy-add-items-release.mjs`.
5. Remove `EDITORIAL_BASE_PRESETS` and complete the backgrounds/photoshoots
   separation.
6. Complete the four remaining styles using the approved style-creation
   workflow.
7. Start video only after the image/editorial surface is stable.

## Stop conditions awaiting Edwin

- Any copied-edge or other synthetic-pixel headroom repair.
- Any gate relaxation or per-preset exception.
- Paid generation outside an explicitly assigned task.
- Any credential operation.
- Anything involving `site.madeforthisjob.com` or port `4180`.
