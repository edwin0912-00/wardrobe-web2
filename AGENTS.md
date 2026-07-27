# Wardrobe agent entrypoint

## FAST MODE — current sprint

This section overrides the historical lane/lease/PR process below.

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
sed -n '1,120p' STATE.md
```

`UPDATE.md` is the live task board. `TASKS.json`, `OWNERS.md` historical lane
rules, and old PRs are preserved evidence only; do not use them for a new task.

Fast rules:

1. Take only a task explicitly assigned to your agent in `UPDATE.md`.
2. One code task writes at a time. Other agents may research, reproduce, or QA
   in parallel, but do not edit product files until the board assigns them.
3. Before a push: `git pull --rebase origin beta`, run the task's check, then
   commit only the task files plus `updates/<agent-id>.md`.
4. Push directly to `origin beta`; never force-push, reset, rewrite history,
   touch `main`, credentials, `site.madeforthisjob.com`, or port `4180`.
5. The orchestrator copies verified results into `UPDATE.md`, `STATE.md`, and
   `LOG.md`. A beta deployment happens only after that exact commit is tested.

If there is no assignment, create or update only `updates/<agent-id>.md` with
a short finding; do not start speculative code.

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
