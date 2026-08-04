# Coordination brief

This loop is a read-only observer of GitHub-backed task reports. The canonical
board is `TASKS.json` on `origin/integration/wardrobe-20260726`; the direct
machine-readable view is produced by
`tools/coordination/watch-agent-reports.mjs --once`.

Valid observations are only: a lane report is present and valid, a lane is
unavailable, a status has not been published, or a status is invalid. The loop
does not repair any of those states. It produces a sanitized report for the
orchestrator, who separately decides whether to reissue, review, or block a
task.

Never include a credential, prompt, raw media description, runtime/output
identifier, user identifier, local absolute path, provider response, or code
outside this loop workspace in the report.
