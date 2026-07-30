# Wardrobe ownership

## SEVEN-BLOCK MODE — current sprint

The active ownership contract is
[`docs/coordination/BETA_BLOCKS_2026-07-29.md`](docs/coordination/BETA_BLOCKS_2026-07-29.md).
It supersedes the shared-`beta` write model below.

- Chat 00 / `beta-release-master` / `chat-00-master`: integration, exact beta
  versions, deploy, rollback and central release evidence only. No product code.
- Block 1 / `beta-block-1-core-look` / `codex-main`: input, extraction,
  avatar, clothing, master-look, profile backend, image/VLM providers and all
  core/background QA.
- Block 2 / `beta-block-2-profile-ui` / `chat-2`: profile/upload/progress/
  choice/explainer UI only.
- Block 3 / `beta-block-3-backgrounds` / `chat-3`: `std.*` packs and scene UI;
  no scene backend or QA.
- Block 4 / `beta-block-4-universe` / `chat-4`: `shoot.*` source packs,
  observations, sheets, manifests, catalog and integrity.
- Block 5 / `beta-block-5-fashion-shoot` / `chat-4`: Shoot Bible, hero, series,
  shoot QA/retry/persistence and shoot UI.
- Block 6 / `beta-block-6-fashion-video` / `chat-5`: generated video/motion
  transport, QA, persistence and dedicated UI.
- Block 7 / `beta-block-7-realtime-look` / `chat-7`: camera, consent, realtime,
  explicit capture and teardown.
- Block 0.8 / `beta-block-08-antigravity-qa` / `antigravity-qa`: read-only
  public-beta browser verification and QA reports only. It owns no product
  code and cannot approve its own product change.

Only `chat-00-master` owns integration-only files and may update `beta`, deploy
or edit the central ledgers. Chat 01 remains the Block 1 product owner.
Chat 06 (`chat-6`) owns only the separate MAIN_SITE product and may not join a
beta block. User-visible chat labels are not block numbers; exact thread IDs,
titles, agent IDs, block ownership and report paths are canonical in
[`docs/coordination/BETA_THREAD_OWNER_MAP.json`](docs/coordination/BETA_THREAD_OWNER_MAP.json).
`main` remains read-only.

## RETIRED FAST MODE — historical reference only

`beta` is the only shared working branch. `main` is read-only. The active
assignment in `UPDATE.md` decides who may write product code right now.
Agents report in their own `updates/<agent-id>.md`; only `chat-00-master` updates
the central board and verified state. The detailed lane rules below remain an
archive for prior work and do not govern new beta tasks.

This file defines write authority. Everyone may read the full repository.
Only the active task owner may write its assigned paths. `TASKS.json` narrows
these lanes for each lease; it may never broaden a forbidden boundary below.

## Permanent roles

- `chat-00-master` — integration reviewer, ledger owner, version and release
  coordinator. This is a persistent role, not a feature task.
- `codex-main` / Chat 01 — Block 1 product owner. It submits commits to Chat 00
  under the same handoff contract as every other block.
- `edwin` — product authority for the stop conditions in `AGENTS.md`.
- task agents — isolated implementers or reviewers with no integration,
  release, credential, or deployment authority unless a task explicitly says
  otherwise.

## Control plane

Only `chat-00-master` may edit:

- `.gitattributes`
- `.gitmodules`
- `.gitignore`
- `AGENTS.md`
- `CLAUDE.md`
- `OWNERS.md`
- `LOG.md`
- `STATE.md`
- `BLOCK_STATUS.md`
- `TASKS.json`
- `package.json`
- `package-lock.json`
- `.github/**`
- `.agents/README.md`
- `tools/coordination/**`
- `.agents/policies/**`
- `docs/coordination/**`
- `schemas/agent-*.schema.json`
- `test/governance/**`

Task owners may write only their own
`.agents/handoffs/<task-id>.json` and, when their active lease grants the exact
path, `.agents/status/<task-id>.json`. A task owner never receives a wildcard
status path, another task's report, or authority to edit `TASKS.json`.

## Lock groups

- `coordination` — the control-plane paths above.
- `scene-core` — scene contract, service, adapters, runtime schemas, release
  validator, and their tests. Treat these as one atomic rule surface.
- `editorial` — editorial shoot contract, Bible, service, schemas, UI, and
  tests.
- `providers-privacy` — providers, outbound redaction, provider privacy tests.
- `profile-runs` — profile, draft, run, upload, garment conditioning, and
  persistence.
- `public-ui` — `web/public/**` and UI/browser tests.
- `release-ops` — release/deploy/recovery tools and deployment documentation.
- `media-assets` — presets, references, prompts, rights/provenance, and release
  manifests.
- `core-pipeline` — avatar, garment conditioning, outfit generation, shared
  pipeline contracts, and their tests when a change spans those core stages.
- `video` — video and motion pipeline code, assets, tests, and receipts.

One active task may hold a lock group. If a change crosses groups, the
orchestrator creates one explicit combined task; agents do not negotiate an
informal overlap.

## Branch topology

```text
main
└── integration/wardrobe-20260726
    ├── control/codex-main           # queue ledgers only
    ├── lane/<task-id>/<agent-id>
    ├── lane/INT-<number>/codex-main # trusted integration task
    └── wip/<source>-<date>        # preservation only, never auto-merge
```

`main` is release-only. Integration is orchestrator-owned. A lane PR carries
implementation and evidence; the orchestrator applies it to an integration
candidate where code and the four ledgers become one commit. WIP branches
preserve evidence but are not candidates until assigned and reviewed.
`control/codex-main` may update only the four root ledgers through a PR whose
candidate task board is validated by trusted integration code.

## External boundary

`site.madeforthisjob.com` and port `4180` belong to another team. No Wardrobe
task may inspect, route, restart, deploy, or modify them. Credentials are never
part of repository ownership.

## Active assignment

The machine-readable active assignment is `TASKS.json`. If this prose and the
board disagree, stop: the orchestrator must repair both in one control-plane
commit before work resumes.

Every task report must state both its **Code** and **Beta/Journey** status using
`BLOCK_STATUS.md`. A local test, preview, catalog card, or provider-health
endpoint cannot be represented as a beta end-to-end result.
