# Agent updates

Each non-orchestrator agent writes only its own file here:
`updates/<agent-id>.md`.

Use five lines: task ID, commit tested, result, evidence command, next action.
Do not put secrets, raw user media, absolute local paths, or model reasoning
in an update. The orchestrator copies verified facts to `UPDATE.md`.
