# Chat 03 — Block 3 audit, 2026-07-30

Pipeline step: `LOOK.06 → BACKGROUND.01–02`

## Exact versions

- Audit branch: `chat03/background-integrity-audit-20260730`
- Base integration SHA: `5fab5b4095711821a5a256d4063a80d659d5478a`
- Active public beta release: `afa34d8fcc92026824e20fb98c7e5e9532a772a4`
  (`release-afa34d8-1785399949701`)
- Remote `origin/beta-block-3-backgrounds`:
  `9de13b268bd04e3811b746d7d5d4b96594bf55a2`

## BACKGROUND stages

### BACKGROUND.01 catalog and previews — PASS

- `GET https://beta.madeforthisjob.com/api/scene-presets`: `200`,
  exactly 16 records, all `std.*`.
- All 16 exact `preview_url` values: `200 image/webp`.
- WebKit physical-browser load: 16/16 images completed with
  `naturalWidth=1024`, `naturalHeight=1280`.
- Focused UI contracts pass: portrait controls stay at mobile touch size and
  the five-card picker is readable without document scrolling.

### BACKGROUND.02 create boundary and item handoff — PASS on persisted server evidence

Two current runtime scenes are complete and independently hash-bound:

1. `scene_bdac74d3f85706cfd48dd0b9c073c8343cfe34a4ac8abf5e`
   - look `0e3a21a6-dae5-4f41-aa00-a801e56a668c`
   - preset `std.studio.white_window_honeycomb@1.0.0`
   - item evidence categories: `top`, `bottom`, `footwear`
   - QA receipt: `PASS`, no defects
   - output: `1536×2048`, declared and actual SHA-256 both
     `f2d92f5754d646fd32599faf446087828c9be6f5966910ba1786adbb92eb9a86`

2. `scene_6ad135440bf832e3b02a662870fe7230e80309999617b9ef`
   - look `84edcca4-7dae-4a7f-817b-eb63eac826db`
   - preset `std.studio.white_window_honeycomb@1.0.0`
   - item evidence categories: `top`, `bottom`, `footwear`
   - QA receipt: `PASS`, no defects
   - output: `1536×2048`, declared and actual SHA-256 both
     `24eec68528c1a4b01a8828e9c589ae87e459e4964cde9c389395e8a025d13895`

Public authenticated reopen was not claimed: the isolated audit browser has no
verifier cookie for either private profile. No cookie, verifier or auth gate
was bypassed.

### Progress/status/retry/save/error UI — PASS in focused contracts

- Completed scene survives reload/restart with private ownership and exact
  download.
- Failed scene retries independently; later source-run tampering does not
  mutate the durable saved look.
- Structured `LOOK_ITEM_EVIDENCE_INVALID` 409 is shown as an item-evidence
  conflict, not as a lost connection.
- Transport failure still exposes reconnect.

Focused command:

```text
node --test \
  test/contracts/scene-preset-catalog.test.js \
  test/contracts/scene-production-packs.test.js \
  test/web/scene-api-integration.test.js \
  test/web/scene-mobile-contract.test.js \
  test/web/scene-ui-error-presentation.test.js
```

Result after the block-owned fix: `27/27 PASS`.

## Block-owned defect and fix

The first focused run was `26/27`: five approved standard packs still declared
license-evidence hashes that never matched the checked-in Pexels/Unsplash
evidence bytes. The license files themselves are unchanged since their first
commit; only the bindings were stale.

The fix rebinds the exact evidence bytes in the embedded and standalone source
ledgers and updates all transitive pack/index SHA-256 values. Reproduction is
kept in `tools/relock-standard-scene-license-evidence.mjs`; it changes no
pixels, source facts, rights state, operator approval, prompts, generation or
QA.

## Branch/worktree audit

- `origin/beta-block-3-backgrounds` is fully contained in integration and has
  zero unique commits; it is 27 commits behind current integration.
- There was no live local worktree on the named Block 3 branch.
- The shared integration checkout was dirty in Block 0/1-owned files, so this
  audit/fix was made in a clean worktree from exact `5fab5b4`.
- No deploy and no paid generation were performed.

## Cross-block UI blocker

The user's compact one-screen Fashion Video + E-Live request crosses Block 2
profile layout, Block 6 video, and Block 7 live. Current code has a long
six-item guide, three nested branch briefs with `scrollIntoView()`, and a video
panel with internal `overflow-y:auto`. Chat 00 acknowledged this as a combined
integration atom. Chat 03 did not edit those paths or bypass the video
two-reference, QA, or live-consent gates.

`weakened_checks: none`
