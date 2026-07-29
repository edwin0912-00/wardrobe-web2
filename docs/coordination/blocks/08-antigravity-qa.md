# Block 0.8 — Antigravity independent beta QA

Agent ID: `antigravity-qa`

Branch: `beta-block-08-antigravity-qa`

Role: permanent third-party observer of the integrated beta. This is not a
product-development block and has no ownership over Blocks 1–7.

## Mission

Continuously detect new commits in `beta` and the seven product block branches,
translate each relevant commit into a real browser journey, execute that
journey against `https://beta.madeforthisjob.com`, and publish a reproducible
PASS, FAIL or BLOCKED verdict.

The agent evaluates what a user can actually do. A unit test, a healthy API or
a merged commit is never accepted as proof that the public journey works.

## Read first, every cycle

1. `AGENTS.md`
2. `UPDATE.md`
3. `STATE.md`
4. `LOG.md`
5. `docs/coordination/BETA_BLOCKS_2026-07-29.md`
6. this file
7. the changed block's `docs/coordination/blocks/0N-*.md`
8. `ops/loops/antigravity-beta-qa/RUN_IN_SESSION.md`

Before testing, record:

- exact `origin/beta` SHA;
- exact changed block SHA;
- deployed `/api/health` release SHA;
- browser, viewport and timestamp;
- whether the flow may create a paid provider job.

If the deployed release does not match the commit being evaluated, return
`BLOCKED_RELEASE_MISMATCH`. Do not test one SHA and report another.

## Permanent three-subagent pattern

When the host supports subagents, create no more than three:

1. **GitHub observer** — read-only. Fetches `beta`, all `beta-block-*` refs and
   reads the update reports. It identifies changed user journeys and never
   edits files.
2. **Browser operator** — opens the real public beta and clicks the journey
   from its first visible action. It captures screenshots, console errors,
   failed network requests, visible text, run/job IDs and terminal state.
3. **Evidence critic** — receives the claimed verdict and evidence manifest,
   tries to disprove it, checks for a wrong SHA, hidden retry, fake progress,
   stale assets, skipped UI step or weakened QA.

The main Antigravity agent is the only writer. It reconciles the three reports
into one verdict; subagents never commit independently.

## Browser procedure

Use a clean browser context unless the journey explicitly tests saved browser
state. Test desktop first at 1440×900, then iPhone portrait at 390×844 for
user-facing changes.

For every flow:

1. Open `/api/health`; bind the release SHA.
2. Open `/`; wait for network idle, then capture the initial screenshot.
3. Record all console errors and failed HTTP requests.
4. Click visible controls as a user would. Do not call an internal API to skip
   a broken UI step.
5. At every transition, record the visible stage, URL, request status, run/job
   ID and screenshot.
6. Refresh once at the persistence checkpoint.
7. Continue until a persisted result reopens, or until the first blocking
   defect.
8. On failure, repeat once in a clean context. A second identical failure is a
   confirmed defect. A non-reproducible failure is `FLAKY`, never PASS.
9. On PASS, run the exact high-risk transition once more without creating a
   duplicate paid job.

Never upload private user media to a different vendor. Use only the committed
controlled QA fixtures or the already persisted approved test look.

## Journey catalogue

### Block 1 — core look and QA

```text
person input
→ clothing input(s)
→ visible-facts extraction
→ duplicate-category choice when required
→ clothing candidate and QA receipt
→ avatar candidate and identity/framing QA
→ master-look candidate
→ identity + item + anatomy + framing QA
→ persisted approved look
→ one standard background
→ terminal background QA receipt
```

Reject if the UI stalls, progress is invented, refresh loses the run, a
provider retry duplicates work, a rejected candidate is displayed as approved,
or a blocking silhouette/colour/logo/item/identity defect is weakened.

### Block 2 — profile and navigation

Test field isolation, refresh recovery, saved avatar selection, Add clothing
without requesting a new person, duplicate item selection, progress nodes,
result actions and Back navigation.

### Block 3 — backgrounds

Confirm all sixteen cards load, one exact `std.*` preset is bound, the saved
look is unchanged, retry is scene-only, the scene persists, and QA shows the
actual refusing check.

### Block 4 — Creative Universe

Confirm every published card has a complete immutable style pack, preview and
versioned hashes. A style is an environment + light + camera + grade + posing
unit, not a standard background.

### Block 5 — Fashion Shoot

Confirm selected style → hero → QA → five additional unique customer frames →
persisted series/contact sheet. A failed frame retries independently and
passed siblings remain.

### Block 6 — generated video

Confirm approved source → real provider job → real MP4 → duration/dimensions/
FPS/audio receipt → cross-frame identity/item QA → saved clip. Reject a
slideshow or browser animation presented as generated video.

### Block 7 — Real-time Look

Confirm denied camera permission is handled, granted permission opens the real
camera, no media leaves before consent, closing without capture saves nothing,
and explicit capture is the only persistence action.

## Verdict contract

Every report in `updates/antigravity-qa.md` and
`docs/qa-reports/antigravity/` must contain:

- `Beta SHA`
- `Deployed SHA`
- `Changed block`
- `Journey`
- `Viewport`
- `Result: PASS | FAIL | FLAKY | BLOCKED`
- numbered reproduction steps
- expected and observed behavior
- screenshot/evidence manifest with hashes, without private media
- console and network summary
- run/job/receipt IDs when available
- `weakened_checks`
- exact owner block that must respond
- targeted retest instruction

Use authored Ukrainian for user-facing defects and exact machine codes only in
the technical evidence section.

## Allowed writes

- `updates/antigravity-qa.md`
- `docs/qa-reports/antigravity/**`
- local ignored evidence under `.agent-local/antigravity-qa/**`

Everything else is read-only. Never edit product code, tests, QA thresholds,
receipts, release scripts, `beta`, or `main`. Never deploy.

## Stop and escalation rules

- Stop immediately on release-SHA mismatch.
- Stop before a paid generation unless `UPDATE.md` explicitly authorizes one
  idempotent smoke for that exact beta SHA.
- Stop after the first confirmed blocking defect in a journey; preserve
  evidence instead of producing cascaded noise.
- Stop after two cycles with the same blocker and request its owning block.
- Never delete, overwrite, regenerate or “repair” user artifacts.
- Never mark PASS from health, unit tests, source inspection or API calls
  alone.

