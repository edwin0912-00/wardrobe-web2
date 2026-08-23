# Wardrobe / Zeely — final context pack

> **Current entry point:** the modern, source/runtime-aware canonical pack is
> [`../canonical/README.md`](../canonical/README.md). This directory remains a
> detailed historical/audit pack and is intentionally not rewritten whenever
> the active alpha release moves.

Verified snapshot: **2026-08-09 00:26 Europe/Madrid**.
Schema version: **1.0.0**.

This directory is the shortest safe entry point into the project. It separates
literal test-task requirements, later product decisions, source code, deployed
state and historical evidence. A future agent should not reconstruct these
facts from chat.

## Read in this order

1. [`TASK_AND_PRODUCT_CANON.md`](TASK_AND_PRODUCT_CANON.md) — what was requested
   originally and what the product later added.
2. [`ARCHITECTURE_AND_PIPELINES.md`](ARCHITECTURE_AND_PIPELINES.md) — repositories,
   deployable modules, runtime boundaries and every pipeline.
3. [`STATUS_AND_GAPS.md`](STATUS_AND_GAPS.md) — verified current status, release
   SHAs, open gaps and honest completion claims.
4. [`HISTORY_AND_LESSONS.md`](HISTORY_AND_LESSONS.md) — compressed project history,
   evaluator feedback and decisions that must not be rediscovered.
5. [`RECOVERY.md`](RECOVERY.md) — exact bootstrap/recovery procedure for a new agent.
6. [`project-canon.json`](project-canon.json) — machine-readable version of the
   same facts, validated by [`project-canon.schema.json`](project-canon.schema.json).

## Truth precedence

```text
literal task snapshot
→ explicit later operator decision
→ verified code contract
→ exact deployed release evidence
→ historical report
→ idea/backlog
```

`Code`, `deployed surface` and `E2E journey` are different facts. Never collapse
them into “live”. A health response proves reachability/capability, not that a
paid generation journey passed.

## Canonical repositories

- Private engine and engineering beta:
  `https://github.com/edwin0912-00/zeely-ai-engineering-test`
  — source authority is branch `beta`, not its older `main`.
- Public cinematic frontend:
  `https://github.com/edwin0912-00/wardrobe-web2`
  — source authority is branch `main`.

The two UIs are intentionally separate. The cinematic frontend calls the beta
engine through same-origin `/api/*`. Do not merge their DOM/CSS or assume that
one repository currently contains the whole production system.

## Security boundary

This pack contains **no credentials, tokens, cookies, user photos or private
runtime artifacts**. Authentication is an operator/runtime concern. Never put
secrets into Git, a handoff Markdown file, a generation receipt or a browser
bundle.

## Older authoritative sources

This pack summarizes rather than deletes the detailed evidence:

- [`../../spec/ZEELY_TASK_SOURCE_UA.md`](../../spec/ZEELY_TASK_SOURCE_UA.md)
- [`../../spec/ZEELY_CANON_UA.md`](../../spec/ZEELY_CANON_UA.md)
- [`../../spec/acceptance.json`](../../spec/acceptance.json)
- [`../ZEELY_TEST_PIPELINE_SCHEME_UA.md`](../ZEELY_TEST_PIPELINE_SCHEME_UA.md)
- [`../FASHION_SHOOT_CANON_UA.md`](../FASHION_SHOOT_CANON_UA.md)
- [`../VIDEO_LIVE_CANON_UA.md`](../VIDEO_LIVE_CANON_UA.md)
- [`../TEST_TASK_STATUS_2026-08-04_UA.md`](../TEST_TASK_STATUS_2026-08-04_UA.md)
- [`../../STATE.md`](../../STATE.md), [`../../LOG.md`](../../LOG.md),
  [`../../OWNERS.md`](../../OWNERS.md)

When an older document conflicts with this snapshot, first check whether it is
describing a different date, a historical adapter, or the literal test rather
than the expanded product. Do not silently rewrite immutable receipts.
