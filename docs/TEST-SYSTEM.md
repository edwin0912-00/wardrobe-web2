# Wardrobe executable test system

The test system has one entrypoint and reports the first real behavior that
failed. It never turns a failed QA or runtime check into an advisory result.

```text
./verify
  ├─ locked dependency + media + browser bootstrap
  ├─ locked alpha source + contracts
  ├─ real Chromium bridge and two look journeys
  ├─ real main + beta processes over loopback HTTP
  └─ immutable JSON receipt with per-stage logs
```

## Commands

```bash
./verify quick   # locked media + source + complete main suite; no processes
./verify         # canonical clean local acceptance gate
./verify full    # local gate + every backend test
./verify live    # read-only public deployment and browser bridge proof
./verify all     # full local + live; collect every independent failure
```

`./verify` is the evaluator-facing answer. README, npm aliases and GitHub
Actions invoke this executable rather than maintaining their own stage lists.
It verifies behavior, not source
strings:

1. `ROOT_DEPENDENCIES`, `ENGINE_DEPENDENCIES`, `MEDIA_BUNDLE` and
   `BROWSER_RUNTIME` install only from committed locks and verify demo-media
   bytes before product checks begin. They are inside the receipt, so bootstrap
   failure cannot disappear before evidence is written.
2. `PRODUCT_CONTRACTS` validates release ancestry, the main behavior suite,
   backend contracts/canon and focused provider/video tests.
3. `BROWSER_CORE` opens Chromium, loads the page-owned bridge, creates a text
   look and a reference-image look, downloads outputs, saves both looks,
   verifies a structured error and reopens the profile after reload.
4. `TWO_PROCESS_RUNTIME` starts the actual main gateway and beta engine as two
   processes, checks their same-origin API connection and requires `206` for an
   MP4 byte range.
5. `PATCH_INTEGRITY` blocks a corrupt working patch.

The runtime gate starts the site through the caller's actual `python3`, so it
also covers the Python installation an evaluator will use. The loopback server
does not perform reverse DNS; startup therefore cannot stall on macOS mDNS.

`./verify live` is read-only. It does not start provider jobs. It requires both
public main mirrors to be byte-identical to the checked-out alpha page, checks
the real bridge and API through Chromium, confirms the beta release SHA and
tests streamed media delivery.

## Receipts

Every run writes:

```text
artifacts/test-system/<timestamp>-<mode>.json
artifacts/test-system/latest.json
artifacts/test-system/logs/<run-id>/<check>.log
```

The JSON receipt contains source branch/SHA, durations, exact commands,
PASS/FAIL per layer, the first failure, the corresponding log and an explicit
empty `weakened_checks` list. All receipt paths are ignored by Git.

GitHub Actions runs the same executable on a fresh Ubuntu checkout. The job
summary is rendered from `latest.json`, and the complete receipt/log directory
is uploaded even after failure. Scheduled runs select `live`; pull requests and
pushes to `alpha` select the canonical local gate. Action dependencies are
pinned to immutable commit SHAs.

To continue independent checks after a failure:

```bash
./verify all
```

To store the main receipt at a caller-owned path:

```bash
node scripts/test-system.mjs local --report /tmp/wardrobe-test-report.json
```

Provider credentials are never printed or copied. Real paid generation is a
separate, explicitly authorised campaign; it is not hidden inside an install
or regression command.
