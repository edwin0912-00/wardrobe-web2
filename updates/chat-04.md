# Chat 04 — Fashion Shoot progress and retry integration

Pipeline step: `ART_SHOOT.01–05`.

The Fashion Shoot surface shows all five named customer frames immediately:
their real state, retry ordinal, a determinate 0–5 meter and a compact active
orb. There is no empty anonymous gallery while work is running. A completed
frame is immutable; only the failed frame is automatically requeued.

The current `shoot.*` runtime starts all five customer frames together, with a
global ceiling of eight frames across shoots. Automatic repair is server-owned,
persisted and bounded at five retries, with backoff; legacy failed frames below
that budget resume individually during initialization. A terminal exhausted
frame is reported as a server diagnostic, never as a user retry action.

Integration resolution: rebased the progress and repair atom on current beta
`fc3c8b2`; retained the current direct five-frame Fashion Shoot engine, its
global concurrency lock and Fashion Video UI changes.

Code: focused Fashion Shoot tests and contract verification are pending again
after the beta merge resolution.

Beta: NOT_DEPLOYED — PR #47 still needs a green merge and release-owner deploy.

Journey: NOT_RUN — no paid generation was requested or run.

weakened_checks: none.
