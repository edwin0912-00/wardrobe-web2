# Wardrobe operational handoff

## Current operating contract — 2026-10-03

`alpha` in `edwin0912-00/wardrobe-web2` is the only active source line and the
repository default. One source tree contains the cinematic website, Studio,
Node services and Codex worker adapter. Historical branches and the migration
plan below are provenance, not alternative startup instructions.

Read the current deployed product SHA from `/api/health` and the immutable
artifact's activation receipt. The earlier migration verification used
`9832c265776d2ee1d160af3d08a054a06572413d`; it is dated evidence, not the latest
release pointer. Product-code changes require a new verified artifact built
from the corresponding alpha commit. The shared board records activation.

The current routing contract is [PROVIDER-ROUTING.md](PROVIDER-ROUTING.md):
Slow (default): Codex → safe FAL Sunburst fallback; Fast: direct Sunburst for
images. Both sites expose the choice and each accepted job persists it.
Selectable FAL Seedance 2.0/2.5 remains available for video,
OpenRouter semantic QA and Lucy 2.5 Live. Model, endpoint, reference bindings
and known remote request IDs must survive retries and daemon restarts.

The reproducible masked-RGB/depth video experiment and pinned source/model
contracts are in [VIDEO-REFERENCE-PIPELINE.md](VIDEO-REFERENCE-PIPELINE.md).
New video prompts retain environment, lighting, color and optics; old jobs
retain their original prompt policy during recovery. The owner accepted one
successful Seedance 2.5 transport test and requested no further paid video
tests in this release. Read [DECISIONS.md](../DECISIONS.md) before changing
these choices. Use [OPERATOR-SETUP.md](OPERATOR-SETUP.md) for a fresh host's
private questionnaire and complete `./verify --run` installation.

### Source and persistent state

Paths below are relative to the deployment operator's home, not a clean
reviewer's install. Connection details and private receipts are kept in the
owner's local project audit, outside the public repository.

| Component | Location or owner |
|---|---|
| Active source checkout | `~/Wardrobe/product`, branch `alpha` |
| Engine source | `beta/src/`, Studio in `beta/web/public/` |
| Cinematic source | root, `b/`, `adapters/`, `serve.py` |
| Active engine artifact | read `app_root` in `~/.local/share/madeforthisjob-beta-launcher/run-beta-daemon.sh` |
| Persistent main artifact | `~/Library/Application Support/WardrobeRuntime` |
| Working databases, jobs, outputs | `~/.local/share/madeforthisjob/.zeely-beta-runtime` |
| Dedicated Codex authorization | `~/Wardrobe/private/codex-home` |
| Exact video reference originals and previews | `~/Wardrobe/private/video-references` |
| Other provider credentials | host-private store referenced by the engine launcher; never copy into Git |

Keep these concerns separate. A source checkout is not a database backup;
an engine artifact is not the editable source. Do not move or delete the
private runtime while updating code. Codex authorization was re-established
with ordinary OAuth in its dedicated profile. Do not redirect it to a generic
desktop account or to a disconnected volume.

### Running services and public surfaces

| LaunchAgent | Role | Loopback port |
|---|---|---|
| `com.madeforthisjob.web2` | cinematic site and same-origin API gateway | 4180 |
| `com.madeforthisjob.beta` | Studio and Node engine | 4176 |
| `com.madeforthisjob.monitor` | operations monitor | 4174 |
| `com.madeforthisjob.cloudflared` | public ingress tunnel | — |

Main: `https://site.madeforthisjob.com` (also apex and www).
Studio: `https://beta.madeforthisjob.com` (dev/live are aliases).
Monitor: `https://monitor.madeforthisjob.com`.
Other project presentation/watch services exist; inspect their own labels
before changing them. Do not equate an installed plist with a running process.

### Historical verification and provider receipt — 2026-10-01

The unified `./verify` local gate passed, including the real Chromium fixture
journey, persistence after reload, both processes and MP4 byte ranges. The
deployed surfaces returned ready and the same product SHA; main Range returned
206. All 12 video-reference files matched their manifest size and SHA-256;
the resolver accepted all four styles from internal storage.

One explicitly authorized real Codex transport test on this deployed Alpha
passed on 2026-10-01: controller `gpt-5.5`, built-in image generation, no
fallback, no personal input, one PNG, 1254×1254, 1,251,811 bytes, 44.451 seconds.
Output SHA-256:
`6d94f58883144e4a851ed58dcc49317446c433ba1675449a7015b077be55008d`.
This proves generation through the worker. It does not certify a full paid
avatar/look/Fashion Shoot/Fashion Video journey or model-quality QA.

### Safe change, stop and resume procedure

1. Read `AGENTS.md`, this handoff and the live board. Claim the exact files.
2. Inspect branch/status, launch-agent state, health/release SHA and actual
   active jobs. Read the real launchers; do not infer paths from old logs.
3. Use `./verify` for candidate acceptance. Paid generation needs explicit
   owner authorization and an agreed non-personal or approved input.
4. Build/verify the engine artifact with the tools in
   `beta/docs/canonical/10_DEPLOYMENT_RUNBOOK.md`. Activate through
   `beta/tools/deploy-beta-release.mjs`; its active-work guard must pass.
   Deploy main through `scripts/deploy-site.sh`, setting
   `WARDROBE_BETA_RUNNER` to that same configured engine runner. Main builds a
   scoped static artifact under the stable runtime's sibling `.releases`
   directory, requires the engine to serve the same source SHA, and preserves
   the previous tree/pointer. Failed health, static-byte or Range checks restore
   the previous runtime. The activation JSON records the exact artifact and
   rollback location. Preserve private runtime and the previous engine artifact.
5. Recheck public health, source/artifact correspondence, main↔API bridge,
   reference catalogs, media Range and browser behavior. Publish a redacted
   result and exact source SHA to the shared board.

On the deployment host, inspect only these services with:

```sh
for label in web2 beta monitor cloudflared; do
  launchctl print "gui/$(id -u)/com.madeforthisjob.$label"
done
```

Only when the owner explicitly requests a stop and active work is resolved:

```sh
for label in web2 beta monitor; do
  launchctl bootout "gui/$(id -u)/com.madeforthisjob.$label"
done
```

This leaves data and the shared tunnel intact. Resume the requested services:

```sh
for label in beta web2 monitor; do
  launchctl bootstrap "gui/$(id -u)" \
    "$HOME/Library/LaunchAgents/com.madeforthisjob.$label.plist"
done
```

Check whether a label is already loaded before bootstrap. Restart a loaded
label with `launchctl kickstart -k` only after the same active-work check.
Never use `killall node`, broad cache removal or a clone's test launcher to
control production. Never rerun dependency installation underneath an active
artifact without considering its dependency link.

### Storage and cleanup boundaries

The owner requested deletion of the consolidation backup and redundant local
Git bundles; working data and the original unique histories were retained.
Do not assume that backup exists for rollback. Check actual paths before every
destructive action and create a concrete recovery plan for a future deploy.

Old source/release copies also exist under general names such as `github`,
`slot-refs-group-*`, `Codex-offload/releases/beta-*` and `beta-live-40sec`.
Identify them by Git remote, package name, code markers and hashes. Name/age,
an archive label or apparent cache location is not proof of duplication.
Provider caches, Codex state, SQLite indexes, client outputs and source assets
must not be treated as disposable dependency caches. Storage counts require
realpath/hardlink checks before claiming reclaimable bytes.

## Historical migration record (not current operating instructions)

Status: **executed; unified public `alpha` is the current source of truth.**

The target described below now exists in this repository: cinematic source at
the root, engine and engineering UI under `beta/`, one root verifier and one
release lock. The old source branches and SHA table are retained below only as
migration provenance. They are not current operational instructions; use
`README.md`, `AGENTS.md` and `release/RELEASE.lock.json` for current commands.

This file records how the current source of truth was assembled. It does not
authorize changing live sites, runtime data, credentials, or provider
configuration.

## The problem it solves

Wardrobe currently has two independently versioned product systems:

1. The cinematic main-site repository, which renders the client-facing journey.
2. The beta repository, which contains both the beta site and the generation,
   QA, API, and media engine.

Independent branch histories make it too easy for a working change in one
system to be absent from a release or for the two systems to be paired without
a durable record. A root release state must therefore name both exact sources
and prove their compatibility.

## Verified source snapshot at the time of this record

| Product unit | Existing repository | Exact source branch / commit | Public role |
| --- | --- | --- | --- |
| Main site | `edwin0912-00/wardrobe-web2` | `canonical-site-main` at `0f13d1e3f07faa3c88799fcd063238e3c6cfd877` | `madeforthisjob.com` and `site.madeforthisjob.com`, both entering `/b/` |
| Beta site + engine | `edwin0912-00/zeely-ai-engineering-test` | `beta` at `3defc900c8603282510d480e26bb7823e53c18f1` | `beta.madeforthisjob.com` and the same-origin API consumed by the main site |

The beta health endpoint reported the exact `release_sha`
`3defc900c8603282510d480e26bb7823e53c18f1` when this plan was recorded.
The main-site source branch above is deliberately `canonical-site-main`, not
the older branch named `main` in its existing repository.

## Target repository shape

Create one new GitHub repository with one canonical `main` branch:

```text
wardrobe/
├── main-site/                 # complete current cinematic main-site source
├── beta/                      # complete current beta source, kept path-compatible
│   ├── web/public/            # beta site — an explicit user-facing deployable
│   ├── src/                   # beta engine / generation / QA / API
│   ├── tools/
│   └── docs/
├── ops/                       # deploy and runtime templates; never credentials
├── release/
│   ├── RELEASE.lock.json      # exact source SHA pair, URLs and compatibility proof
│   └── verify-release.mjs     # root verification of both systems together
├── AGENTS.md                  # entrypoint for every future agent
└── README.md
```

`beta/web/public` is explicitly the **beta site**. It must not be silently
called or treated as only an engine. The beta source remains one path-compatible
unit during the first import because the site and engine currently share
runtime paths, tests, static assets, and service assumptions.

## Deliberate decisions

- Use a new repository and one canonical `main` branch for the compatible
  whole-product state.
- Import both existing repositories with Git subtree provenance at their exact
  approved commits. Do not flatten them into untraceable copied files.
- Do **not** use submodules: a clone must contain the actual runnable source,
  not two independently moving pointers.
- Preserve the old repositories as immutable history and recovery sources.
- Do **not** physically split `beta/web/public` and `beta/src` in the first
  migration. A later, tested refactor may do that only after the unified
  release is reproducible.
- Do **not** duplicate live contracts into a new second source of truth.
  Initially, `RELEASE.lock.json` records the contract paths and SHA values;
  contract extraction may happen later with tests.
- Future work starts from this unified `main` on a short feature branch, then
  returns through a verified merge. `main` stays the complete compatible state.

## What the unified repository must include

- Main-site code, assets, measured screen calibration, laptop presentation,
  UI tests, and deploy scripts.
- Beta-site code (`beta/web/public`), beta engine (`beta/src`), API routes,
  providers, QA, migration/schema files, tools, tests, and static product
  assets.
- Create Universe style packs, reference sheets, manifests, hashes and all
  non-secret files required to validate them.
- Release verification, domain/deploy templates, health/smoke scripts, agent
  coordination rules, and recovery documentation.

## What must never enter Git

- API keys, authentication cookies, OAuth sessions, `.env` values, or runtime
  credentials.
- Client photos, generated client media, live profile databases, raw logs with
  personal data, and runtime cache/output directories.
- `node_modules`, build caches, swap data, or machine-specific application
  state.

Those belong in separately access-controlled runtime backups. The unified
repository contains schema, migration and recovery instructions, not private
customer material.

## Release lock requirements

`release/RELEASE.lock.json` must at minimum record:

```json
{
  "main_site": {
    "source_repository": "edwin0912-00/wardrobe-web2",
    "source_commit": "0f13d1e3f07faa3c88799fcd063238e3c6cfd877",
    "deploy_target": "madeforthisjob.com"
  },
  "beta_site": {
    "source_repository": "edwin0912-00/zeely-ai-engineering-test",
    "source_commit": "3defc900c8603282510d480e26bb7823e53c18f1",
    "source_path": "beta/web/public",
    "deploy_target": "beta.madeforthisjob.com"
  },
  "beta_engine": {
    "source_repository": "edwin0912-00/zeely-ai-engineering-test",
    "source_commit": "3defc900c8603282510d480e26bb7823e53c18f1",
    "source_path": "beta/src"
  }
}
```

The JSON is an example of the required fields, not a file to create until the
new repository exists. The final lock also records contract and asset hashes,
test evidence, and the release date.

## Safe migration sequence

1. Create the new repository without touching either live deploy.
2. Import the exact main-site and beta commits as two Git subtrees.
3. Add the root lock, operational templates, agent entrypoint and a combined
   verification script.
4. Run the existing main-site tests and beta tests from their preserved paths.
5. Verify the public main site, beta site and beta API against the locked SHA
   values. No deployment is part of the import.
6. Commit and tag the resulting single `main` as the first unified recovery
   point (for example `alpha-0.01`).
7. Only after owner approval, make the unified repository the release source
   for future coordinated changes.

## Acceptance criteria

The migration is complete only when a fresh clone of the new repository can:

1. identify the exact main-site, beta-site and beta-engine sources;
2. run their respective test suites from the imported paths;
3. verify shared contracts and product assets by hash;
4. explain both deploy targets without exposing secrets; and
5. restore the entire source-level product state from one branch/tag.

Until these are met, the current independent repositories and their existing
deploy paths remain authoritative and must not be removed or redirected.
