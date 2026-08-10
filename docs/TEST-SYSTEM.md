# Wardrobe executable test system

The test system has one entrypoint and reports the first real behavior that
failed. It never turns a failed QA or runtime check into an advisory result.

```text
npm test
  ├─ locked alpha source + contracts
  ├─ real Chromium bridge and two look journeys
  ├─ real main + beta processes over loopback HTTP
  └─ immutable JSON receipt with per-stage logs
```

## Commands

```bash
npm run test:quick   # source lock + complete main suite; no processes
npm test             # canonical local acceptance gate
npm run test:full    # local gate + every backend test
npm run test:live    # read-only public deployment and browser bridge proof
npm run test:all     # full local + live; keeps going to collect every failure
```

`npm test` is the evaluator-facing answer. It verifies behavior, not source
strings:

1. `PRODUCT_CONTRACTS` validates release ancestry, the main behavior suite,
   backend contracts/canon and focused provider/video tests.
2. `BROWSER_CORE` opens Chromium, loads the page-owned bridge, creates a text
   look and a reference-image look, downloads outputs, saves both looks,
   verifies a structured error and reopens the profile after reload.
3. `TWO_PROCESS_RUNTIME` starts the actual main gateway and beta engine as two
   processes, checks their same-origin API connection and requires `206` for an
   MP4 byte range.
4. `PATCH_INTEGRITY` blocks a corrupt working patch.

`test:live` is read-only. It does not start provider jobs. It requires both
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

To continue independent checks after a failure:

```bash
node scripts/test-system.mjs all --keep-going
```

To store the main receipt at a caller-owned path:

```bash
node scripts/test-system.mjs local --report /tmp/wardrobe-test-report.json
```

Provider credentials are never printed or copied. Real paid generation is a
separate, explicitly authorised campaign; it is not hidden inside an install
or regression command.
