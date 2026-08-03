# Wardrobe — cinematic AI wardrobe experience

Wardrobe is a scroll-driven HTML5 experience that connects a cinematic apartment
journey to the real wardrobe-generation pipeline. A visitor moves from person and
garment input, through the approved master look, to backgrounds, Fashion Shoot,
Fashion Video, Real-time Look, a tracked television surface, and the final laptop
pipeline explanation.

The official release branch is `main`. Day-to-day integration happens on
`canonical-site-main` and reaches `main` only after the owner approves a release.

## Install and run with one command

The repository is private, so authenticate GitHub CLI once with `gh auth login`, then:

```bash
gh repo clone edwin0912-00/wardrobe-web2 -- --branch main --depth 1 && cd wardrobe-web2 && ./scripts/install-local.sh --run
```

Open [http://127.0.0.1:4173/b/](http://127.0.0.1:4173/b/).

The local server has no Python package dependencies. It includes HTTP Range support,
which is required for frame-accurate MP4 scrubbing and is intentionally not replaced by
`python3 -m http.server`.

## Requirements

- Git and an authenticated GitHub CLI (`gh`) to clone the private repository;
- Python 3.10 or newer to run the site and same-origin API gateway;
- Node.js 22 or newer only for development checks and the test suite;
- a modern Chromium, WebKit, or Safari browser;
- optional beta API engine on `http://127.0.0.1:4176` for real product actions.

Override the local ports when needed:

```bash
PORT=4311 WARDROBE_API_UPSTREAM=http://127.0.0.1:4176 ./scripts/run-local.sh
```

Without the beta engine, the cinematic site, media, tracked TV/laptop surfaces, and
pipeline presentation still run; provider-backed product actions remain honestly
unavailable.

## What is included

```text
fabric intro
→ scroll-scrubbed apartment
→ mirror input and saved-look interface
→ tracked TV result surface
→ tracked laptop surface
→ interactive 17-panel pipeline deck
```

The final laptop contains the versioned, first-party presentation at
[`b/pipeline-deck-v2.html`](b/pipeline-deck-v2.html). It is mounted same-origin into a
ShadowRoot, verified by SHA-256 before display, clipped to the calibrated laptop plane,
and owns scroll only at the terminal laptop stop. Reverse scroll returns control to the
cinematic camera without reloading the document.

See [`docs/17-LAPTOP-PIPELINE-DECK.md`](docs/17-LAPTOP-PIPELINE-DECK.md) for the exact
source lock and handoff contract.

## Development

Run the complete non-paid verification suite:

```bash
./scripts/site-preflight.sh
```

Run only the laptop presentation contract:

```bash
node --test test/pipeline-deck.test.mjs test/laptop-placeholder.test.mjs test/client-window-wiring.test.mjs
```

Project documentation starts at [`docs/README.md`](docs/README.md). Agent and release
rules are in [`AGENTS.md`](AGENTS.md), [`INTEGRATION-HANDOFF.md`](INTEGRATION-HANDOFF.md),
and [`COLLAB-BOARD.md`](COLLAB-BOARD.md).

## Security and credentials

No API keys, OAuth sessions, provider credentials, browser profiles, generated private
media, or runtime state belong in Git. Local credentials stay in the provider's approved
CLI/MCP store or environment. The customer-facing same-origin gateway explicitly refuses
the internal God View routes.

