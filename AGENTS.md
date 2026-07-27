# Wardrobe agent entrypoint

## FAST MODE — current sprint

This section overrides the historical lane/lease/PR process below.

New agents use the single bootstrap command in `tools/bootstrap-beta-agent.sh`;
it creates an ID, installs the local help/journal flow, publishes `ONLINE`, and
optionally starts the live board monitor.

There are only two branches that matter now:

- `main` — safe baseline. Read-only for agents.
- `beta` — the one shared working branch and the source for beta testing.

Before doing anything, every agent runs:

```bash
git fetch origin
git switch beta
git pull --ff-only origin beta
sed -n '1,180p' AGENTS.md
sed -n '1,220p' UPDATE.md
sed -n '1,220p' PIPELINE.md
sed -n '1,120p' STATE.md
```

For a one-time identity setup plus an optional live board, run
`bash tools/join-beta-agent.sh <agent-id> --watch` after cloning.

The watcher is a lightweight local monitor, not an autonomous worker. It
fetches `beta` every 20 seconds, renders the board and reports ownership
collisions or explicit agent help requests without writing anything.

`UPDATE.md` is the live task board. `TASKS.json`, `OWNERS.md` historical lane
rules, and old PRs are preserved evidence only; do not use them for a new task.

Technical IDs such as `BETA-UNIVERSE-001` are routing labels only. Every task
must also state a plain-language Ukrainian product name and the exact pipeline
step it changes from `PIPELINE.md`, for example `LOOK.04` or `UNIVERSE.02`.
Never use a tracking ID as though it explained the work.

Fast rules:

1. Take a task assigned to your agent in `UPDATE.md`. If the orchestrator is
   unavailable, an online agent may self-claim exactly one `unassigned` +
   `READY` row: fetch/rebase, change only that row to its own ID +
   `IN_PROGRESS`, add its `STARTED` report, and push the small board commit.
   If the push races, rebase and stop unless the row is still unassigned.
   `WAITING`, `BLOCKED`, and `DONE` rows are never self-claimable.
2. Code, research, and QA tasks may run in parallel. Every code row declares
   its exact reserved paths in `UPDATE.md`; two active code tasks may not share
   a path. A self-claiming agent verifies that its row has concrete paths and
   does not overlap another `IN_PROGRESS` code row.
3. An agent may create and start one new row without waiting for `codex-main`
   only when Edwin has directly given that agent the concrete task. The row
   must name its owner, exact reserved paths, and one testable outcome; the
   agent commits the row plus its `STARTED` report before editing product code.
   If a reserved path overlaps an active row, it records `PROPOSED` and stops
   for collision resolution instead of starting work.
4. Before a push: `git pull --rebase origin beta`, run the task's check, then
   commit only the task files plus `updates/<agent-id>.md`. Every commit
   subject starts with `[agent:<agent-id>]`, even when GitHub login is shared.
   A feature is not considered delivered merely because its assets or source
   files exist: it must be wired into the relevant product entry point, or the
   report must explicitly say `ASSETS_ONLY — NOT IN PRODUCT` and name the
   missing integration surface.
5. Push directly to `origin beta`; never force-push, reset, rewrite history,
   touch `main`, credentials, `site.madeforthisjob.com`, or port `4180`.
6. `codex-main` curates `UPDATE.md`, `STATE.md`, and `LOG.md`, but an agent may
   make the narrowly defined self-claim/completion edit to its own board row.
   A beta deployment happens only after the exact commit is tested.

## User-facing completion contract — mandatory

For every small user-facing change that has passed its focused check, the next
atomic action is beta activation — not a later batch release:

1. commit and push the exact tested SHA to `beta`;
2. mark the task `READY_FOR_BETA_DEPLOY` in `UPDATE.md`, including that SHA and
   the focused command/result;
3. the host-connected release owner activates that exact SHA at
   `https://beta.madeforthisjob.com` before starting unrelated product work;
4. run a narrow beta smoke check for the changed UI/API path and record PASS,
   FAIL, or BLOCKED with evidence in `updates/<agent-id>.md`, `STATE.md`, and
   `LOG.md`.

Remote agents that cannot operate the beta host stop at step 2; they do not
claim a deployment occurred. `codex-main` owns host activation and reports the
observable result. A failing smoke check becomes the next atomic task; never
hide it behind a broad release or continue as if it were delivered.

Every currently online agent must acknowledge the policy commit in its own
`updates/<agent-id>.md` before taking its next product-code task:
`Protocol ACK: <policy-commit-sha>`.

If there is no assignment, create or update only `updates/<agent-id>.md` with
a short finding; do not start speculative code.

## Local operational journal

Each agent also maintains an uncommitted local journal at
`.agent-local/<agent-id>.md`. The join command creates and syncs it to the
current beta board. Before a task and after each material decision, append a
concise operational rationale with `tools/agent-local-log.sh`: intent,
decision, risk, evidence, and next action. Compare its beta commit with
`UPDATE.md`, `STATE.md`, and `LOG.md` before resuming work.

The journal is not a public transcript and is never committed. Do not put
secrets, personal media, raw prompts, hidden model reasoning, or local paths
there. Shared Git reports contain verified facts plus one concise
rationale/decision line in `updates/<agent-id>.md`; the central board records
the resulting task state.

This repository is coordinated through GitHub. Conversation history is not
authority. Before any substantive action, every agent must:

1. Fetch `origin/integration/wardrobe-20260726`.
2. Read `OWNERS.md`, `STATE.md`, `TASKS.json`, and `LOG.md` from that exact
   integration commit.
3. Find exactly one active task whose `owner` and `branch` match the agent.
4. Read every `required_context` path from the task's pinned `base_sha`.
5. Run `node tools/coordination/validate-board.mjs`.

No matching task means read-only work. An expired lease means stop, preserve
the branch, and request a new lease. A task is not permission to change files
outside `allowed_paths`.

## Git and worktrees

- Never push to `main`.
- A non-orchestrator never pushes to `integration/wardrobe-20260726`.
- One task has one `lane/<task-id>/<agent-id>` branch and one isolated
  worktree. Never share a writable worktree.
- Start from the exact `base_sha` in `TASKS.json`; do not silently rebase.
- Do not merge another lane. The orchestrator serializes integration.
- Never force-push a handed-off or reviewed branch.
- Dirty work belonging to another agent is preserved, not cleaned up.

## Before changing a rule

Search the complete tree for every existing enforcement site: producer,
runtime validator, JSON schema, persistence layer, evaluator, release tool,
UI adapter, and tests. One requirement must have one owner. Call sites consume
that owner; they do not restate its constants or derive a second answer.

Known examples that must not recur:

- framing assessment had several call sites with different options;
- the avatar prompt required full length while another gate assumed half body;
- a model-invented crop rule contradicted the contract;
- editorial mode IDs and real `mode.slot` IDs diverged;
- metadata allowlisting silently removed a newly added field.

## Proof standard

- A bugfix test must fail against the pinned pre-change code. Record that
  command and failure in the handoff.
- After each implementation block, run an adversarial review whose explicit
  goal is to find a suppressed check, widened lock, hidden fallback, or
  rewritten evidence.
- Every handoff contains `weakened_checks`. A non-empty value blocks merge
  until Edwin explicitly approves the product change.
- Existing passing tests are regression guards, not proof of a new fix.
- No blur, stretch, padding, copied edge, or invented pixels may be introduced
  as a delivery fallback.
- Do not convert a one-preset exception into policy.
- Keep backgrounds (`std.*`) and photoshoots (`shoot.*`) as separate products.
- `ZEELY_RUNTIME_ROOT` is load-bearing. Verify the resolved root before
  concluding that persisted data is missing.
- Image aspect belongs in provider request configuration, not prompt prose.

The product-integration target ceiling is exactly the two known failures
recorded in `STATE.md`; a third failure blocks product integration. This is
not a claim that the current base already meets that ceiling. A task's focused
acceptance commands must pass independently.

## Stop and ask Edwin

Stop without implementing when work would:

- add pixels not present in the source photograph;
- widen any lock or weaken any gate;
- add a one-preset exception;
- incur paid generation not already authorized for the task;
- touch `site.madeforthisjob.com` or port `4180`;
- read, move, export, rotate, or otherwise operate on credentials.

Never put secrets, tokens, cookies, private keys, decrypted archives, raw
personal media, or local absolute user paths in Git, Issues, PRs, logs, or
handoffs.

## Handoff and communication

`TASKS.json` is the assignment channel. A task owner reports completion in
`.agents/handoffs/<task-id>.json` and opens a PR to
`integration/wardrobe-20260726`. Code discussion stays on that PR. Durable
architecture decisions are committed as ADRs.

## Queue listener and status reports

Status publishing is enabled only when an active task's `allowed_paths` grants
the exact artifact `.agents/status/<task-id>.json`. A wildcard or another
task's status artifact is invalid. Legacy active tasks without that exact grant
remain valid but silent until they are reissued; the artifact, when enabled,
is a sanitized operational signal, not a chat transcript and not a claim of
trust.

Before starting work, an assigned agent starts the read-only listener from its
own isolated worktree:

```bash
WARDROBE_AGENT_ID=<agent-id> node tools/coordination/watch-assignments.mjs --interval 20
```

The listener fetches only the canonical integration board and emits typed JSON
when the assignment changes. It does not check out code, make a claim, edit a
file, merge, deploy, run a model, or wake an unattended LLM. A persistent
agent runner must explicitly consume the event and decide whether to work.

After reading the task's pinned context, publish `STARTED`. Publish
`HEARTBEAT` after each meaningful checkpoint and at least every ten minutes
while work is active; `STARTED` or `HEARTBEAT` becomes `STATUS_STALE` after
fifteen minutes. Publish `BLOCKED` as soon as safe work cannot continue, and
`READY_FOR_REVIEW` only after the code commit, focused
proof, independent review, and final handoff are prepared. Use:

```bash
WARDROBE_AGENT_ID=<agent-id> node tools/coordination/publish-agent-status.mjs \
  --task <TASK-ID> --state <STARTED|HEARTBEAT|BLOCKED|READY_FOR_REVIEW> \
  --summary-code <SUMMARY_CODE> --next-action-code <NEXT_ACTION_CODE>
```

`BLOCKED` additionally requires `--blocker-code <BLOCKER_CODE>`. All three
fields are closed enums defined by `schemas/agent-status.schema.json`; the
watcher renders its human labels from checked-in mappings. There is no free
text field. Commit and push a status only to the task's own lane. The
orchestrator watches all reports without checking out or mutating those lanes:

```bash
node tools/coordination/watch-agent-reports.mjs --interval 20
```

The status channel is intentionally not a replacement for GitHub
authentication, branch protections, focused tests, an independent review, or
the final handoff.

Only `codex-main` may use the permanent `control/codex-main` branch. It is a
queue-administration route, not an implementation lane: every introduced
commit and the final diff may change only `OWNERS.md`, `LOG.md`, `STATE.md`,
and `TASKS.json`; the latter three are mandatory. Trusted base code validates
the candidate board and pinned contexts before merge. Product code, tests,
handoffs, workflows, and policy tools are forbidden on this route.

The handoff is the only file in the lane's final commit. It records the parent
commit as `tested_code_sha`, the lease generation, every acceptance check, and
an independent adversarial reviewer. No code may follow the handoff commit.
Acceptance commands are stored as argv arrays, never shell strings. CI command
shapes are a narrow allowlist (`node --test` with explicit test paths, the
board validator, exact `git diff --check`, or constrained `rg`). Watchers do
not execute `manual` or `paid` checks and never infer missing arguments.
Every PR runs both the candidate test tree and the trusted base test tree
against candidate source. Removing or weakening an existing test therefore
cannot erase the base assertion from the integration decision.
The ordinary read-only PR runner also executes every trusted-board `ci`
acceptance argv against `tested_code_sha`, records only exit codes and output
hashes, and reruns each declared pre-change failure against the pinned base
with the changed tests applied. A READY handoff without a focused test that
actually fails before the fix is rejected. The one-time control-plane
bootstrap is manually attested because its base predates this runner.

`agent-id` and `reviewer_id` are routing/evidence labels, not cryptographic
identities. GitHub authenticates the repository actor. Hostile-agent isolation
requires distinct GitHub actors or signing keys; with a shared credential,
`codex-main` remains the human-visible trust boundary and sole merger.

The orchestrator:

1. verifies scope, pre-change proof, focused tests, and adversarial review;
2. checks `weakened_checks`;
3. creates a trusted `INT-<number>` task for itself in `TASKS.json`, then
   branches `lane/INT-<number>/codex-main` from current integration;
4. applies the reviewed lane diff, then updates `OWNERS.md`, `LOG.md`,
   `STATE.md`, and `TASKS.json` in the same candidate commit; that integration
   branch must already exist as the exact trusted task branch in the base
   board, so it cannot self-authorize from its own PR;
5. PRs that candidate to integration and merges only after trusted-base CI;
6. closes the evidence lane PR with the candidate commit reference;
7. issues the next lease only after integration is green.

Use the read-only watcher when an agent needs a standing terminal process:

```bash
WARDROBE_AGENT_ID=<agent-id> node tools/coordination/watch-assignments.mjs
```

The watcher fetches and reads `TASKS.json`; it never checks out code, edits a
file, claims work, merges, deploys, or wakes an LLM by itself. A standing agent
runner may consume its typed JSON event.
