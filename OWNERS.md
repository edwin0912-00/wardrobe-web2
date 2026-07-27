# Wardrobe ownership

## FAST MODE — current sprint

`beta` is the only shared working branch. `main` is read-only. The active
assignment in `UPDATE.md` decides who may write product code right now.
Agents report in their own `updates/<agent-id>.md`; only `codex-main` updates
the central board and verified state. The detailed lane rules below remain an
archive for prior work and do not govern new beta tasks.

This file defines write authority. Everyone may read the full repository.
Only the active task owner may write its assigned paths. `TASKS.json` narrows
these lanes for each lease; it may never broaden a forbidden boundary below.

## Permanent roles

- `codex-main` — orchestrator, integration reviewer, ledger owner, release
  coordinator. This is a persistent role, not a task.
- `edwin` — product authority for the stop conditions in `AGENTS.md`.
- task agents — isolated implementers or reviewers with no integration,
  release, credential, or deployment authority unless a task explicitly says
  otherwise.

## Control plane

Only `codex-main` may edit:

- `.gitattributes`
- `.gitmodules`
- `.gitignore`
- `AGENTS.md`
- `CLAUDE.md`
- `OWNERS.md`
- `LOG.md`
- `STATE.md`
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
