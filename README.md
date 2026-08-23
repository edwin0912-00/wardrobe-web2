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

## One command from a clean machine

Requirements: Git, Python 3.10+ and Node.js 22+.

```bash
git clone --filter=blob:none --single-branch --branch alpha https://github.com/edwin0912-00/wardrobe-web2.git && cd wardrobe-web2 && ./verify --run
```

`./verify` is the only evaluator contract. It installs locked dependencies,
retrieves and SHA-verifies the immutable demo-media bundle, installs the pinned
Chromium, executes the behavioral acceptance gate and writes a JSON receipt.
Only after PASS does `--run` start both product processes and print their actual
loopback addresses. Stop them with `Ctrl+C`.

The same `./verify` command runs in GitHub Actions. CI does not reconstruct the
steps in YAML, so local and hosted acceptance cannot silently diverge.

## One active release line

`alpha` is the only branch used for new integration, installation and release
source. It owns both the cinematic site and the engine subtree shown above.
Historical `beta`, `canonical-site-main` and `main` refs remain audit history;
new fixes are not developed or assembled from them. Deploy tooling may build
separate site and engine processes, but both artifacts must come from the same
verified `alpha` commit.

The storage policy is equally small: one active checkout and one verified,
credential-free backup archive. Temporary clones, test installs, caches and old
release directories are disposable after their commits and unique uncommitted
files have been proven present in Git or in that single backup.

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

Primary image transport is the locally authorized Codex route. OpenRouter is an
optional image/video fallback configured only through a local environment
variable or credential store. Higgsfield is not an allowed production route in
this deliverable.

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
