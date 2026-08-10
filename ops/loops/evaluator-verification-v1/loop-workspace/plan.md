# Plan

## Evidence before change

- Public default branch: `alpha` at `942fefa10cd3028f4a868401eb3c31031ff6c882`.
- GitHub Actions workflows: zero.
- `alpha` branch protection: absent.
- Local test runner already proves Chromium, two-process runtime and deployed
  parity, but bootstrap happens outside its JSON receipt.
- README and README-ALPHA repeat commands and test descriptions.

## Decision

Keep the existing Node/Python/Playwright stack. Add no required Docker, Dagger,
Task or Dev Container dependency. Introduce one root `./verify` command whose
entire bootstrap and behavioral plan is executed and receipted by
`scripts/test-system.mjs`. Make README, npm and GitHub Actions delegate to it.
Persist receipts/logs as Actions artifacts and render a concise job summary.

## Delivery atoms

1. Move dependency/media/browser bootstrap into the receipted test plan.
2. Add the root executable and preserve old installer commands as wrappers.
3. Add report-to-Markdown rendering and one pinned GitHub Actions workflow.
4. Reduce duplicate README-ALPHA content to a pointer to the canonical README.
5. Prove unit wiring, quick, clean local acceptance and live parity.
6. Inject/check existing bridge failure behavior so a broken integration cannot
   obtain a false green result.

## Safety boundary

No paid generation, provider credential access, production deploy, branch-rule
mutation or user-data access. Push only the tested `alpha` commit once.
