# Run log

- 2026-08-10: Read official GitHub Actions, artifact, summary, Playwright CI,
  Dev Container, Docker Compose, Dagger and Task sources.
- 2026-08-10: Chose the existing runtime stack plus GitHub Actions; rejected
  additional required orchestrators because they add evaluator prerequisites.
- 2026-08-10: Compiled and strict-linted the Looper spec; no findings.
- 2026-08-10: Plan gate PASS — existing test-system tests 6/6.
- 2026-08-10: First quick run correctly failed on an obsolete README command
  criterion after the locked media bundle was materialized. Updated the
  criterion to the single root contract; no product behavior check was removed.
- 2026-08-10: Delivery checks PASS — focused contract 13/13, quick main
  behavior 177/177, local contracts 337/337 plus Chromium/two-process runtime,
  and read-only live parity. Paid generation was not started.
- 2026-08-10: First clean `--depth 8` clone failed source provenance because
  the locked beta import commit was outside shallow history. Removed the
  shallow depth from README rather than weakening or auto-fetching around the
  ancestry gate; retained blob filtering and the single alpha branch.
- 2026-08-10: Clean external clone delivery gate PASS in 64.8s. It downloaded
  and verified the 780 MB media bundle, passed 337/337 contracts, Chromium
  journey/reload/bridge-404 recovery and real main+beta runtime with Range 206.
  Weakened checks: none.
- 2026-08-10: Publication is blocked only by GitHub authorization: the active
  OAuth token has `repo` but not `workflow`, so GitHub rejected the workflow
  file. No credential scope was changed autonomously and the push was not
  repeated against the unchanged authorization state.
- 2026-08-10: User authorized credential completion. Registered one temporary
  SSH key through the existing `admin:public_key` scope, pushed alpha, then
  deleted that key locally and from GitHub. No persistent credential changed.
- 2026-08-10: First Ubuntu Actions run preserved its receipt and correctly
  failed MEDIA_BUNDLE: GNU tar exposed 1248 physical/PAX records while BSD tar
  exposed the 624 logical members locked by the bundle. Repair replaces
  platform `tar -tf` counting with Python `tarfile` logical-member inspection
  and additionally rejects links/devices before extraction.
- 2026-08-10: Portable PAX regression PASS 2/2 and unified quick gate PASS
  179/179. The repair is awaiting a clean Ubuntu Actions delivery run; no
  product gate or media-integrity check was weakened.
