# Agent updates

Each non-orchestrator agent writes only its own file here:
`updates/<agent-id>.md`.

Use exactly these seven lines: Agent ID, task ID, commit tested, concise
rationale/decision, result, evidence command, next action. Its commit subject
must start `[agent:<agent-id>]`. The rationale explains why the agent chose
the action, not raw model reasoning.
Do not put secrets, raw user media, absolute local paths, or model reasoning
in an update. The orchestrator copies verified facts to `UPDATE.md`.
