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

## Status reports

For an active task whose `allowed_paths` contains the exact matching path, the
owner may also write `.agents/status/<task-id>.json`. It conforms to
`schemas/agent-status.schema.json` and is validated against the canonical
integration board before the publishing tool writes it.

Status is a code-only snapshot of one task lease: `STARTED`, `HEARTBEAT`,
`BLOCKED`, or `READY_FOR_REVIEW`. It carries checked-in `summary_code`,
`next_action_code`, and optional `blocker_code`, not prose. It is committed
only to that task's lane, never directly to integration. It does not replace
the final handoff or grant a merge, deployment, or credential action.

`STARTED` and `HEARTBEAT` are live states: publish a heartbeat at least every
ten minutes. The watcher reports `STATUS_STALE` after fifteen minutes without
a fresh live status. `BLOCKED` and `READY_FOR_REVIEW` remain readable until the
task state itself changes.

After bootstrap, GitHub runs the trusted base acceptance runner. It executes
only `ci` argv from the trusted task board in a secret-free PR job, verifies
their expected exit codes on `tested_code_sha`, and proves the focused changed
test fails against the pinned pre-change code. `manual`, `paid`, and
`orchestrator_local` checks are never auto-executed. The command-shape allowlist
prevents a task record from smuggling a shell command; candidate tests are
still executable candidate code and therefore run only in the read-only,
credential-free PR job.
