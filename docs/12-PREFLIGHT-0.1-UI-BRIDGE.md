# Preflight 0.1 — cinematic UI bridge

This atom connects the existing fabric-world UI to `ZeelyClient` without
turning the main site into the beta dashboard.

## What is live in code

- `adapters/cinematic-ui-bridge.mjs` probes same-origin `/api/health`, maps
  beta run states to the client mirror language, and creates/retries/selects a
  core look through `ZeelyClient`.
- `b/index.html` loads that bridge as an ES module and hands it to `ui.js`.
- `ui.js` keeps inputs and garment-choice questions in the left mirror; the
  right mirror owns the monochrome orb while a real run is active.
- A right-mirror image is only rendered from `run.outputs.avatar_outfit` after
  the API reports `COMPLETED`. A local input URL is never used as an output.

## Honest unavailable state

If `/api/health` is 404, unavailable, or not ready, the user may still move
through the film, but the submit action cannot create a look. The only copy is
the client-facing sentence:

```text
Ця частина простору ще готується
```

There are no fake percentages, local success timers, provider names, model
names, prices, security text, or diagnostics.

## Current intentional boundary

This atom wires the beta core run, including genuine garment-resolution
choices. Scene, shoot, video, TV surface, laptop surface, and Live remain
absent from the rendered action row until their catalog/approval contracts and
measured surfaces are wired. They must be added through the same bridge, never
as locally simulated controls. Live also stays absent until beta exposes its
server-owned 40-second capability.

## Checks

```bash
node --test test/zeely-client.test.mjs test/cinematic-ui-bridge.test.mjs
node --check ui.js
node --check adapters/cinematic-ui-bridge.mjs
git diff --check
```
