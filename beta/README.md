# Wardrobe Studio and engine

This directory contains the Studio interface and the engine used by both Wardrobe experiences. The public product is installed from the repository root so the site, Studio, bridge, and engine stay on one source version.

## Start the complete product

From the repository root, install and start both experiences with:

```sh
./setup run
```

The setup flow configures local host settings and delegates to the root verifier and launcher. For a non-interactive acceptance run, use `./verify --run`. See the root [README](../README.md) and [operator setup guide](../docs/OPERATOR-SETUP.md).

## Engine areas

- `src/` — API, conditioning, image generation, backgrounds, shoots, video, Live sessions, and quality checks.
- `web/public/` — Studio interface.
- `config/`, `prompts/`, and `schemas/` — catalogs and generation contracts.

Current image routing is per job: Slow uses Codex first with FAL Sunburst as a safe fallback; Fast goes directly to FAL Sunburst. Fashion Video uses FAL Seedance 2.0 or 2.5, semantic QA uses OpenRouter, and Live uses FAL Lucy 2.5. See [provider routing](../docs/PROVIDER-ROUTING.md) for configuration and limits.

Paid or provider-backed features need credentials and account permissions on the host. Fashion Video also needs the private source-reference package matching its manifest. Neither credentials nor those original media files are included in a public clone. Setup does not provision DNS, TLS, a firewall, or a persistent service manager.

## Focused documentation

The root [documentation index](../docs/README.md) links to setup, provider, video-reference, architecture, and acceptance guides. The current source and operations contract is in [the unified project guide](../docs/UNIFIED_PROJECT_MONOREPO_PLAN.md).
