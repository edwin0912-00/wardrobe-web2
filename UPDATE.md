# Wardrobe update board

This is the only live coordination board for the current sprint.

The earlier detailed noticeboard is preserved at
[`docs/coordination/UPDATE_ARCHIVE_2026-07-27.md`](docs/coordination/UPDATE_ARCHIVE_2026-07-27.md).

## Branches and live test

- Safe baseline: `main` — agents never write here.
- Shared work: `beta` — every approved small change is committed and pushed
  here.
- Live test: `https://beta.madeforthisjob.com` — deploy the exact tested beta
  commit, then record its result below.

## Current verified state

- Beta is healthy (`ready`).
- Create Universe catalog exposes five locked `shoot.*` styles.
- Four styles are generation-ready. `shoot.terracotta_hardlight` remains
  visible but blocked by a real SHA-256 reference mismatch; do not bypass it.
- `iwas.madeforthisjob.com` is outside this sprint's deployment flow.
- Higgsfield is authenticated on the beta host. Magnific has no accepted API
  credential on the host yet; it is not an active beta provider.

## Active queue

| ID | Owner | State | Type | Scope | One concrete outcome |
| --- | --- | --- | --- | --- |
| BETA-SMOKE-001 | antigravity-20260727-fb7a90 | IN_PROGRESS | QA | catalog | Verify beta UI/API exposes the five Create Universe styles; report exact result, no code change. |
| BETA-CORE-001 | unassigned | WAITING | CODE | public-ui | After smoke passes, reproduce one user-visible flow defect and propose one minimal fix. |

## Agent protocol

1. New agents run the one bootstrap command from `START_HERE.md`; existing
   clones run `bash tools/join-beta-agent.sh <agent-id> --watch`. Then read
   `AGENTS.md`, this file, and `STATE.md`.
2. Work only on your assigned row. If `codex-main` is unavailable, an online
   agent may self-claim one `unassigned` + `READY` row in a small board commit;
   never self-claim `WAITING`, `BLOCKED`, or `DONE`.
3. Code agent: one focused change, one focused test, one commit, then push to
   `beta`. Include `updates/<agent-id>.md` in that same commit.
4. Research/QA agent: do not modify product code. Write only
   `updates/<agent-id>.md`, commit, pull-rebase, push. A report may set
   `Help request: <what is needed>`; otherwise it writes `Help request: NONE`.
5. Do not overwrite this board. `codex-main` curates it; a self-claiming agent
   may change only its own row and then report the result.

Every agent commit subject starts `[agent:<agent-id>]`; this and the matching
`updates/<agent-id>.md` make ownership visible even with one shared GitHub
login.

Each agent additionally keeps `.agent-local/<agent-id>.md` on its own Mac.
It records concise operational rationale (intent, decision, risk, evidence,
next action) and syncs against this board, `STATE.md`, and `LOG.md`. It is
intentionally local and never committed; shared reports contain only verified
facts.

## Latest events

- 2026-07-27 — `90d6119` Create Universe release deployed to beta and health
  verified `ready`.
- 2026-07-27 — FAST-001 enabled: `beta` is now the shared working branch.
- 2026-07-27 — Antigravity assigned `BETA-SMOKE-001`; READY rows may now be
  self-claimed if the orchestrator is unavailable.
