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
both sites offer per-job Slow/Fast image generation, Fashion Video selects FAL
Seedance 2.0/2.5, OpenRouter supplies semantic QA, and Live uses Lucy 2.5.
Provider output and deployment status require separate receipts; configuration
or fixture tests alone do not prove an external model works.

The 2026-10-01 candidate produced real Codex and Sunburst photos and a real
Lucy stream with a synthetic camera. Both Seedance versions rejected that
original reference set with FAL's content-policy error; those jobs remain
terminal. On 2026-10-03, a separate owner-authorized Seedance 2.5 request
(`01a102e0-a588-7452-9b9e-1ab7b6b02afd`) used the approved-look and garment-detail
images plus only reference-01's reviewed RGB derivative and synchronized
depth. It returned HTTP 200 with a 720×1280, 24 FPS MP4 lasting 14.042 seconds;
the observed balance reduction was $11.105316. Sampled review found a brief
gray oval mask remnant and a background person. This exact test does not reopen
the earlier rejected jobs or establish general person-reference access. No
follow-up paid test is claimed here. See [the video-reference pipeline](docs/VIDEO-REFERENCE-PIPELINE.md)
for reproduction and private-state boundaries.

The most recent deployed product snapshot documented here was verified on
2026-10-01 at commit `9832c265776d2ee1d160af3d08a054a06572413d`. A real call
through that deployed Alpha's `CodexAppServerClient` generated a 1254×1254 PNG
in 44.451 seconds, with no fallback and no personal input. This proves that
snapshot's Codex image transport, not the complete avatar → outfit → downstream
QA journey or activation of the 2026-10-03 source work.

## One command from a clean machine

Requirements: Git, Python 3.10+ and Node.js 22+ with npm. The command below
installs repository dependencies, locked media and Chromium. It does not install
the operating system or create provider accounts. macOS local acceptance was
verified; GitHub Actions runs the same local contract on Ubuntu 24.04.

Paid production generation also requires the Codex CLI executable with its
dedicated authorized profile, FFmpeg/FFprobe for video preparation and QA,
provider keys and the private video-reference originals described below.
`./verify` does not install those host tools or grant provider permissions.

```bash
git clone --filter=blob:none --single-branch --branch alpha https://github.com/edwin0912-00/wardrobe-web2.git && cd wardrobe-web2 && ./verify --run
```

For an operator install with a questionnaire, use `./setup run` instead of
`./verify --run` in that command. It asks for the current host label, domain,
private runtime and Codex profile, provider keys, video references and ports,
then delegates to the same whole-product verifier and launcher. Configuration
stays outside Git with private permissions; secret input is masked. On later
runs it reuses the saved settings. `./setup --check` checks local configuration
without spending provider credits. See [operator setup](docs/OPERATOR-SETUP.md)
for a separate `--config` path and the SSH-host workflow. DNS, TLS, accounts
and persistent service management remain explicit host responsibilities.

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

### Slow/Fast image generation

Both the cinematic site and Studio expose the same image-only choice for a new
job. **Slow** is the default: it uses the existing Codex-first route, falls
back to FAL Sunburst only for a known safe primary failure, and sends requests
with more than five required references directly to FAL without dropping any
reference. **Fast** sends the request directly to FAL GPT Image 2.5 Sunburst;
it never falls back to Codex. Both modes retain the existing reference and QA
contracts. The choice does not change Fashion Video or Live.

The APIs accept `image_generation_mode: "slow" | "fast"`; omission means
`slow`, while `null`, an unknown value, or another type returns HTTP 400 with
`IMAGE_GENERATION_MODE_INVALID`. The choice affects only the new request. Runs,
scenes and shoots persist their effective mode; shoot child scenes inherit it,
and retries or recovered jobs use that saved value. Replaying an idempotency
key with a different mode conflicts. Older records without a mode remain Slow
without being rewritten.

`GET /api/health` reports
`image_generation_modes: { slow: { available }, fast: { available } }`.
Unavailable modes are rejected with HTTP 503 and
`IMAGE_GENERATION_MODE_UNAVAILABLE`. Fast availability follows configured FAL
capability and does not require a healthy Codex worker; a shared hard runtime
fault can make both modes unavailable. There is no server-global speed toggle.

| Operator setting | Purpose | Required for |
|---|---|---|
| `CODEX_HOME` | dedicated Codex OAuth profile used by the actual worker | Slow image generation |
| `ZEELY_GENERATION_PROVIDER=codex-primary` | Codex first, capability-aware Sunburst fallback | Slow image generation |
| `FAL_KEY` | server-only FAL inference credential | Fast images, Slow fallback, Seedance and Lucy |
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
The separate face-mask/depth preparation and exact-request replay workflow is
documented in [VIDEO-REFERENCE-PIPELINE.md](docs/VIDEO-REFERENCE-PIPELINE.md).

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

## Historical SSD data

The owner-approved [SSD conservation](docs/SSD-CONSOLIDATION.md) preserved old code,
media and Git metadata in one private hash-bound archive collection before retiring
verified inactive copies. Canonical source, live runtime, provider state and original
video references remain in place. Do not reactivate an old release or delete the
archive merely because its bytes also occur in a current checkout.

## Verification evidence and known limitations

Earlier source-candidate receipts for `./verify quick` and canonical `./verify`
cover the then-current source; they do not verify or deploy the 2026-10-03
Slow/Fast changes. The canonical gate starts real Chromium and both product
processes, tests persistence/reload and validates the same-origin bridge and
media ranges. Run it on the integrated source before recording acceptance.

On that prior source, the full backend suite ran 1,196 cases: 1,183 passed and
thirteen legacy build cases were blocked by the unchanged host-resource guard
(about 21.64 GiB swap against a 1.25 GiB build limit). Eight stale fixture
failures were independently reproduced on the pre-change source and repaired
without relaxing product checks. These resource-blocked cases are not reported
as passing.

Earlier real-provider checks produced Codex and Sunburst photos, including a
nine-reference editorial detail request, and decoded Lucy WebRTC frames using
a synthetic camera. They do not certify every style or real-person try-on
quality. The 2026-10-01 Seedance jobs using the original person references
remain terminal; the separate 2026-10-03 derivative request described above
is a single test, not a general access grant. FAL separately documents ACR
approval for faces in its Seedance 2.0 US-hosting offer; applicability to
standard endpoints, Seedance 2.5 and this account remains unconfirmed.

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
