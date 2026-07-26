# Agent handoffs

Each task owner writes exactly one
`.agents/handoffs/<task-id>.json` conforming to
`schemas/agent-handoff.schema.json`.

Handoffs are evidence, not self-approval. Only the orchestrator changes the
task to `DONE`, updates the root ledgers, and integrates the code.

The handoff must be the only file in the lane's final commit. Its
`tested_code_sha` is that commit's parent. `lease_generation` must match the
trusted task board, and post-change proofs must cover every assigned
`check_id`.

`weakened_checks` must always be present. Any non-empty value blocks merge
until Edwin explicitly authorizes the product change.

`adversarial_review.result` must be `PASS`. Risks are typed as `INFO`,
`WARNING`, or `BLOCKING`; any `BLOCKING` risk makes the handoff invalid.
Reviewer IDs identify the review route but are not cryptographic identities.

After bootstrap, GitHub runs the trusted base acceptance runner. It executes
only `ci` argv from the trusted task board in a secret-free PR job, verifies
their expected exit codes on `tested_code_sha`, and proves the focused changed
test fails against the pinned pre-change code. `manual`, `paid`, and
`orchestrator_local` checks are never auto-executed. The command-shape allowlist
prevents a task record from smuggling a shell command; candidate tests are
still executable candidate code and therefore run only in the read-only,
credential-free PR job.
