# Wardrobe — executable AI wardrobe product

`alpha` is the public evaluator branch and contains the complete runnable
product in one Git graph:

```text
wardrobe-web2/
├── b/          cinematic main site
├── adapters/   browser ↔ API bridge
├── serve.py    same-origin gateway and MP4 Range server
└── beta/       engine, engineering UI, contracts, providers and QA
```

No second repository or manually rewritten backend URL is required.

## Complete product, not a partial frontend

| Component | Source | Installed by the unified command |
|---|---|---|
| Cinematic D journey, mirror flows, TV and laptop surfaces | root, `b/`, `ui.js`, `screen-surfaces.js` | yes |
| Studio interface and saved-profile workflows | `beta/web/public/` | yes |
| Node engine, conditioning, generation, scene/shoot/video services | `beta/src/` | yes |
| Codex worker adapter, FAL transports and semantic QA adapters | `beta/src/providers/` | yes, authorization configured separately |
| Same-origin browser/API bridge and media Range server | `adapters/`, `serve.py` | yes |
| Catalogs, prompts, schemas and style-unit materials | `beta/config/`, `beta/prompts/`, `beta/schemas/`, locked media | yes |
| Operations monitor code and release/recovery tooling | `beta/src/monitor/`, `beta/tools/`, `scripts/` | source included; persistent services require host configuration |

The public repository is the complete code product. Required evaluator/media
assets are installed from the immutable GitHub release in
`release/MEDIA.lock.json`: 624 files, 780,008,960 bytes, SHA-256 checked before
extraction. They are not replaced with an unrelated demo or manually downloaded
folder. This includes the cinematic media and the locked engine acceptance
assets.

Provider secrets, Codex authorization, customer databases, uploaded photos,
generated output and the private original Fashion Video references are separate
operator-owned state. A Git clone does not contain them. A full source install
must not be described as a restored customer deployment or a guarantee that
every external provider has granted content permissions.

## Current operations and agent entrypoint

Read [the operational handoff](docs/UNIFIED_PROJECT_MONOREPO_PLAN.md) before
changing, restarting, stopping or cleaning the deployed project. It is the
current map of source, services, private runtime and recovery boundaries.
`AGENTS.md` is the agent entrypoint; `COLLAB-BOARD.md` links the shared live
coordination board. Older release snapshots in `beta/docs/` remain history.

The provider contract is documented in [PROVIDER-ROUTING.md](docs/PROVIDER-ROUTING.md):
Codex-first photos with FAL Sunburst fallback, selectable FAL Seedance 2.0/2.5
for reference-bound videos, OpenRouter semantic QA, and Lucy 2.5 Live.
Provider output and deployment status require separate receipts; configuration
or fixture tests alone do not prove an external model works.

Candidate validation on 2026-10-01 produced real Codex and Sunburst photos and
a real Lucy stream with a synthetic camera. Both Seedance versions rejected
the test references with FAL's content-policy error; no video output was
generated. See the provider contract for the terminal refusal and retry policy.
The candidate is not a declaration of a successfully deployed video pipeline.

The active sites and engine were verified on 2026-10-01 at product commit
`9832c265776d2ee1d160af3d08a054a06572413d`. A real call through that deployed
Alpha's `CodexAppServerClient` generated a 1254×1254 PNG in 44.451 seconds,
with no fallback and no personal input. This proves the Codex image transport;
it does not claim a complete avatar → outfit → downstream QA journey. Private
request IDs, receipts and generated media remain outside Git.

## One command from a clean machine

Requirements: Git, Python 3.10+ and Node.js 22+ with npm. The command below
installs repository dependencies, locked media and Chromium. It does not install
the operating system or create provider accounts. macOS local acceptance was
verified; GitHub Actions runs the same local contract on Ubuntu 24.04.

```bash
git clone --filter=blob:none --single-branch --branch alpha https://github.com/edwin0912-00/wardrobe-web2.git && cd wardrobe-web2 && ./verify --run
```

`./verify` is the only evaluator contract. It installs locked dependencies,
retrieves and SHA-verifies the immutable demo-media bundle, installs the pinned
Chromium, executes the behavioral acceptance gate and writes a JSON receipt.
Only after PASS does `--run` start both product processes and print their actual
loopback addresses. Stop them with `Ctrl+C`.

Default local addresses are the main journey on `http://127.0.0.1:4173/b/`
and Studio on `http://127.0.0.1:4176/`. If ports are occupied, the launcher
selects free ports and prints them. The main site's `/api` requests are routed
to that engine automatically. Both share the selected runtime root, which is
outside the checkout. Read the actual printed addresses rather than assuming
a stale port.

For an existing checkout, preserve its runtime and local changes, then update
with a fast-forward and re-run the same contract:

```bash
git switch alpha
git pull --ff-only origin alpha
./verify --run
```

Do not use a shallow `--depth` clone: acceptance checks the imported source
ancestry and release lock. Do not run only `npm install` or only the `beta/`
start command and call that installation of the whole product.

The same `./verify` command runs in GitHub Actions. CI does not reconstruct the
steps in YAML, so local and hosted acceptance cannot silently diverge.

## One active release line

`alpha` is the only branch used for new integration, installation and release
source. It owns both the cinematic site and the engine subtree shown above.
Historical `beta`, `canonical-site-main` and `main` refs remain audit history;
new fixes are not developed or assembled from them. Deploy tooling may build
separate site and engine processes, but both artifacts must come from the same
verified `alpha` commit.

Keep one active source checkout. Backup retention is an explicit owner choice;
the owner requested removal of the consolidation backup on 2026-10-01.
Historical clones and archives are not automatically disposable: first prove
that their unique history, uncommitted code, inputs and outputs are retained,
and that no process, worktree, symlink or deployment uses them. Runtime data,
provider state and old branches must not be discarded based on names or age.

## What PASS proves

- committed source ancestry, contracts, canon and focused provider/video code;
- a real Chromium journey through text and image inputs, result delivery,
  structured failure recovery, saved looks and reload;
- main and beta running as two real processes through the same-origin bridge;
- the bridge fails visibly when its module is unavailable instead of leaving a
  fake-working interface;
- MP4 byte ranges return `206`;
- every stage writes its exact command, duration and log to
  `artifacts/test-system/`.

This gate never starts paid generation. Visual/model quality needs separate
approved QA receipts; a deterministic fixture is not presented as model proof.

## Verification modes

```bash
./verify quick   # locked media + source + main behavior; no browser/processes
./verify         # canonical clean local acceptance
./verify full    # canonical acceptance + complete engine suite
./verify live    # read-only deployed main/beta parity in Chromium
./verify all     # full local + deployed checks; collect independent failures
```

`npm test` and the other `npm run test:*` scripts are aliases for these same
entrypoints. The detailed executable contract and receipt schema live in
[`docs/TEST-SYSTEM.md`](docs/TEST-SYSTEM.md); reviewer criteria and observable
evidence live in [`docs/REVIEWER-ACCEPTANCE.md`](docs/REVIEWER-ACCEPTANCE.md).

## Open a local build on a phone

Never send a loopback URL to a phone or remote reviewer. With the local product
already running, publish and verify a temporary HTTPS preview with:

```bash
npm run share -- --port 4173 --background --json
```

Use only the verified HTTPS URL from the JSON receipt. Stop that tunnel with
`npm run share -- --stop`. Provider order, health checks and state-file behavior
are documented in
[`docs/PUBLIC_PREVIEW_TUNNEL_UA.md`](docs/PUBLIC_PREVIEW_TUNNEL_UA.md).

## Product journey

```text
Person photo + 1–5 garment photos/descriptions
        ↓
Conditioning → avatar/look generation → QA
        ↓
Approved saved look
        ├── Standard background
        ├── Fashion Shoot
        ├── Fashion Video
        └── Real-time Look
```

Each continuation reads the same approved saved look and is independent of the
other continuations. The current capability map is
[`FUNCTION-MAP.md`](FUNCTION-MAP.md).

## Provider authorization

The code, UI, API, profile, catalogues and evaluator gate run without secrets.
Real paid generation requires host-local provider authorization. Credentials,
browser sessions, user runtime, uploads, receipts and generated media are never
stored in the public repository.

Primary image transport is the locally authorized Codex route, with FAL
Sunburst fallback. `FAL_KEY` also enables reference-bound Seedance 2.0/2.5
video and Lucy Live; keep it in the host-private credential store. OpenRouter
supplies semantic QA and can resume its existing recorded video jobs.
Higgsfield is not an allowed production route in this deliverable.

| Operator setting | Purpose | Required for |
|---|---|---|
| `CODEX_HOME` | dedicated Codex OAuth profile used by the actual worker | primary image generation |
| `ZEELY_GENERATION_PROVIDER=codex-primary` | Codex first, capability-aware Sunburst fallback | approved default image route |
| `FAL_KEY` | server-only FAL inference credential | Sunburst, Seedance and Lucy |
| `ZEELY_VLM_PROVIDER=openrouter` + `OPENROUTER_API_KEY` | explicit OpenRouter QA selection | the current production QA route |
| `ZEELY_VIDEO_REFERENCE_ROOT` | private folder matching the video-reference manifest | original motion clips and their previews |
| `WARDROBE_ALPHA_RUNTIME_ROOT` | local launcher's durable state/log directory | predictable local state location |
| `ZEELY_RUNTIME_ROOT` | engine state root for a persistent service | databases, jobs, scenes and outputs |
| `ZEELY_PUBLIC_HTTPS_ORIGIN` | public engine origin for legacy asset delivery/resumption | deployments using that bridge |
| `ZEELY_SESSION_SECRET` | host-private session secret | configured session/PIN protection |

Use a private configuration file outside the repository with mode `0600` and
load it into the service environment. Never paste keys into Markdown, Git,
shell history, client JavaScript or public logs. Existing authorization must be
probed from the exact worker binary/profile before starting another login.
For Codex, a login alone does not prove this product's required namespace/image
capabilities or pinned controller are available.

`beta/config/video-reference-packs/fashion-cool-style-v1.json` pins the exact
original clips, playback derivatives and previews by filename, size and hash.
Supply the matching private package and verify it with the runtime resolver;
the main media bundle does not restore those operator-owned originals. Missing
or altered media must produce a clear unavailable state, not substituted clips.

Standard background and Fashion Shoot materials resolve sixteen backgrounds
and eighteen public shoot modes, seventeen generation-ready by materials. The
older luminous-blue-white mode remains blocked for missing second-source
evidence. Readiness by materials is separate from actual provider output QA.

## Persistent deployment

Foreground local startup and public persistent hosting are distinct operations.
For hosting, configure the target server, two service origins, private state,
authorization, video-reference package and HTTPS ingress. Main and Studio
must come from the same verified `alpha` SHA. Keep Node/Python origins on
loopback behind the configured ingress.

The existing production runbook supports the current macOS launchd host:

1. Read [the operational handoff](docs/UNIFIED_PROJECT_MONOREPO_PLAN.md),
   [provider contracts](docs/PROVIDER-ROUTING.md) and the shared board.
2. Inspect current source/artifact SHAs, actual launchers and active jobs.
3. Run `./verify`; record full-gate limitations separately.
4. Build and verify the engine with `beta/tools/build-product-release.mjs`
   and `beta/tools/verify-product-release.mjs`.
5. Activate through `beta/tools/deploy-beta-release.mjs` only after its
   active-work checks pass; retain the previous immutable artifact for rollback.
6. Deploy the matching cinematic source through `scripts/deploy-site.sh`.
7. Verify both HTTPS surfaces, release SHA, catalogs, browser modules and MP4
   `206` byte ranges. Health alone is not a paid-generation receipt.

`scripts/deploy-site.sh` is currently specific to the existing production host,
runtime path and domains. It is not a generic VPS installer. Do not run it on
an arbitrary machine or silently reuse the current Cloudflare tunnel for a new
deployment. A portable installation questionnaire is a separate addition under
design; no nonexistent wizard command is advertised here.

## Verification evidence and known limitations

The source candidate's `./verify quick` and canonical `./verify` local
acceptance passed. The latter starts real Chromium and both product processes,
tests persistence/reload and validates the same-origin bridge and media ranges.

The full backend suite ran 1,196 cases: 1,183 passed and thirteen legacy build
cases were blocked by the unchanged host-resource guard (about 21.64 GiB swap
against a 1.25 GiB build limit). Eight stale fixture failures were independently
reproduced on the pre-change source and repaired without relaxing product
checks. These resource-blocked cases are not reported as passing.

Real-provider checks produced Codex and Sunburst photos, including a complete
nine-reference editorial detail request, and decoded Lucy WebRTC frames using
a synthetic camera. They do not certify every style or real-person try-on
quality. Both actual Seedance versions rejected the supplied person references
with terminal content-policy errors. FAL separately documents ACR approval for
faces in its Seedance 2.0 US-hosting offer; applicability to standard endpoints,
Seedance 2.5 and this account remains unconfirmed.

## Source synchronization and change history

GitHub `alpha` is the complete published source line. Verify source parity with:

```bash
git fetch origin alpha
git status --short
git rev-parse HEAD origin/alpha
git diff --exit-code HEAD origin/alpha
```

A clean status, identical commit IDs and an empty diff prove the tracked source
matches. Private runtime and installed media are checked independently by their
own manifests; they are not supposed to be committed. A pushed source revision
does not imply the live services were restarted or their provider access changed.

Read [CHANGELOG.md](CHANGELOG.md) for the implementation history and remaining
release blockers. The shared board records current source versus deployed SHA,
verification receipts, ownership and explicit operational boundaries.

## Runtime ownership

- `./verify --run` — verified combined local start;
- `scripts/run-alpha.sh` — underlying combined runtime;
- `adapters/cinematic-ui-bridge.mjs` — product-state bridge;
- `serve.py` — static media, Range and same-origin API gateway;
- `beta/src/web/start.js` — engine entrypoint;
- `release/RELEASE.lock.json` — exact source provenance.

GitHub Actions runs clean-clone acceptance on every pull request and push to
`alpha`. A scheduled or manually selected `live` mode checks the deployed
mirrors without mutating them. Receipts, logs and browser evidence remain
downloadable as workflow artifacts even when a check fails.
