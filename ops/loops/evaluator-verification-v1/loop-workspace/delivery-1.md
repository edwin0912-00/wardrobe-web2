# Delivery 1 — executable evaluator contract

## Implemented

- One executable root contract: `./verify`.
- Dependency, media and Chromium bootstrap moved inside the receipted plan.
- README, npm scripts and GitHub Actions delegate to that contract.
- GitHub Markdown summary and immutable test/log artifacts are emitted even on
  failure.
- Quick, local and live plans remain separate and start no paid generation.
- README-ALPHA is a compatibility pointer rather than a second instruction set.

## Verification

- Focused contract: 13/13 PASS.
- Quick: PASS; main behavior 179/179, locked source/media and patch integrity.
- Local: PASS; 337 engine tests with zero failures (334 pass and 3 explicit
  environment skips), real Chromium journey, bridge-module 404 recovery, two
  real processes, same-origin API and MP4 Range 206.
- Live: PASS; both public main mirrors match, beta is ready and the bridge loads
  in Chromium; paid generation was not started.
- Clean external clone: PASS in 64.8s from complete filtered alpha history;
  locked dependencies/media, 337/337 contracts, Chromium, reload history,
  bridge-404 recovery and the real two-process runtime all passed.
- Clean Ubuntu GitHub Actions: PASS in 2m20s on SHA `932a691`; the exact README
  contract installed the 780 MB locked media, dependencies and Chromium before
  repeating the local behavioral acceptance. Evidence and logs were preserved
  at https://github.com/edwin0912-00/wardrobe-web2/actions/runs/31431373492.

## Adversarial finding repaired

The first quick run failed because an older reviewer test required the obsolete
`install-local.sh` README command. The criterion now points to `./verify`; its
real gateway/bridge behavior test remains unchanged. Quick also now materializes
the locked media before the main behavior suite, so a fresh checkout cannot
obtain a misleading missing-file failure.

The first clean shallow clone then proved that the inherited `--depth 8`
instruction omitted a locked provenance commit. The public command now uses a
blob-filtered but complete single-branch history; the source verifier remains
strict instead of fetching around or suppressing the missing ancestry.

The first Ubuntu delivery then exposed 624 macOS AppleDouble `._*` sidecars in
the release tar in addition to its 624 intended assets. The installer now
validates all 1248 physical members, requires every sidecar to match a real
sibling, counts exactly 624 logical assets and extracts only those assets. The
archive SHA, allowlist and expected logical count remain unchanged.

Weakened checks: none.
