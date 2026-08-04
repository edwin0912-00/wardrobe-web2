Beta SHA: 77c2b1d
Deployed SHA: 77c2b1d
Changed block: 2
Journey: saved avatar opens from profile
Viewport: 390x844
Result: PASS

## Reproduction steps

1. Opened the public beta in a clean browser.
2. Selected the persisted avatar.
3. Refreshed and reopened the persisted result.

## Expected

The saved avatar remains available after refresh.

## Observed

The persisted avatar reopened after refresh.

## Evidence manifest

- screenshot SHA-256: example
- persistence receipt: example

## Console and network

No console errors. Network requests returned their expected status.

weakened_checks: none
Owner block: 2
Targeted retest: reopen the same saved avatar after the next Block 2 commit.
