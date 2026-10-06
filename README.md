# Wardrobe

Create a personal look from photos of a person and their clothes, then carry that approved look into backgrounds, fashion shoots, video, or a live camera session.

**Try Wardrobe:** [Main experience](https://site.madeforthisjob.com/) · [Studio](https://beta.madeforthisjob.com/)

![Ivory fabric from the Wardrobe cinematic opening](b/assets/readme-cover.jpg)

Wardrobe ships as one repository with two connected experiences: a cinematic main site and Studio. Both use the same engine, saved looks, and provider configuration.

## What you can do

- **Create a look:** Add a person photo and garment photos or descriptions to create and save an outfit look.
- **Continue a look:** Use an approved look with standard backgrounds or a Fashion Shoot.
- **Make a video:** Create a reference-based Fashion Video from a saved look.
- **Try Live:** Continue a saved look in a real-time camera session when the provider is configured.
- **Manage in Studio:** Work with profiles, saved looks, catalogs, and generation tools in the engineering interface.

Provider availability and output quality depend on the host's credentials, permissions, source references, and review. See [provider routing](docs/PROVIDER-ROUTING.md) for current routes and limits.

## Run locally

You need Git, Python 3.10 or newer, and Node.js 22 or newer. From a terminal:

```sh
git clone --filter=blob:none --single-branch --branch alpha https://github.com/edwin0912-00/wardrobe-web2.git
cd wardrobe-web2
./setup run
```

The setup command asks for private host and provider settings, then runs the whole-product verifier and starts both local experiences. It keeps configuration outside Git. The local UI can start without provider credentials, but any unconfigured generation feature remains unavailable. Stop the foreground processes with `Ctrl+C`.

Both servers print their actual loopback addresses (local URLs). Open those addresses in your browser; the default ports may already be occupied.

To check an existing private configuration without calling providers:

```sh
./setup --check
```

For a non-interactive evaluator run, use `./verify --run`. This installs the locked dependencies and media, runs the browser and two-process acceptance checks, then starts the product. Read [operator setup](docs/OPERATOR-SETUP.md) for configuration details and [the test system](docs/TEST-SYSTEM.md) for what each verification mode proves.

## Providers and private references

Image generation offers **Slow** and **Fast** per job. Slow uses the authorized Codex route first and a safe FAL Sunburst fallback; Fast sends directly to FAL Sunburst. Fashion Video uses FAL Seedance 2.0 or 2.5, semantic quality checks use OpenRouter, and Live uses FAL Lucy 2.5. These routes require host-side credentials and provider access. Keys and authorization stay out of the browser and repository. Codex image generation also needs the Codex CLI and an authorized dedicated profile. Video preparation and quality checks need FFmpeg and FFprobe on the host.

Fashion Video also needs the private original reference package that matches the checked-in manifest. A public clone does not include those originals. The complete per-route contract, setup fields, and privacy boundaries are in [provider routing](docs/PROVIDER-ROUTING.md) and the [video reference guide](docs/VIDEO-REFERENCE-PIPELINE.md).

## Repository map

- `b/`, root UI files — cinematic main experience.
- `beta/web/public/` — Studio interface.
- `beta/src/` — engine, conditioning, generation, shoots, video, Live, and QA.
- `adapters/` and `serve.py` — browser-to-engine bridge and media delivery.
- `docs/` — operator guides, provider contracts, architecture notes, and acceptance criteria.

The source repository does not include operator credentials, user uploads, generated media, databases, or private video references.

## For contributors

Use `alpha` as the current source line. Start with [the unified project and operations guide](docs/UNIFIED_PROJECT_MONOREPO_PLAN.md), then use the [documentation index](docs/README.md) to find focused guides. The canonical local acceptance command is:

```sh
./verify
```

A local PASS proves the checks listed in [the test-system guide](docs/TEST-SYSTEM.md); it does not prove paid provider quality or that a public deployment was updated. DNS, TLS, ingress, and persistent service management require separate host configuration. [Reviewer acceptance](docs/REVIEWER-ACCEPTANCE.md) explains the clean-checkout path.
