# Nano Banana 2.1

Verified on October 6, 2026. Google documents the stable image model
`gemini-nano-banana-2.1`. Wardrobe integration is pending; the running image
routes remain Codex and FAL Sunburst.

## Verified API contract

| Property | Nano Banana 2.1 |
| --- | --- |
| Provider model ID | `gemini-nano-banana-2.1` |
| Documented transport | Google Gemini API; current examples use `POST /v1beta/interactions` |
| Reference images | Up to 14; published guidance describes up to 4 characters and 10 objects |
| Image output | 1K, 2K, 4K; default 1K |
| Thinking | `minimal`, `medium` (default), `high` |
| Live video | Not supported by this image model |

Sources: [Google model card](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1)
and [image generation guide](https://ai.google.dev/gemini-api/docs/image-generation).

Google's Standard image-output equivalents are **$0.0336 at 1K**, **$0.0504 at
2K**, and **$0.0756 at 4K**. Input and text/thinking tokens are additional, so
these are not full per-job estimates. There is no free API tier for this model.
See [current pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Provider availability

Google publishes the exact 2.1 model. The inspected FAL catalog documents
[`fal-ai/nano-banana-2/edit`](https://fal.ai/models/fal-ai/nano-banana-2/edit/api)
as **Nano Banana 2**; no exact 2.1 endpoint or schema was verified. The public
[OpenRouter model catalog](https://openrouter.ai/api/v1/models) also did not
list the exact 2.1 model during this check. Recheck these catalogs before
activation; a catalog search is a dated observation, not a permanent
availability claim.

The reviewed Wardrobe operator configuration has FAL and OpenRouter
credentials, but no Google image API credential. A direct Google adapter and
its credential/setup support have not yet been implemented. Adding a Google
key to the existing configuration alone will not activate this model.

## Integration requirements

- Choose its role in the image controls. The proposed placement is Fast,
  with Codex remaining Slow; this choice is awaiting the owner. An additional
  model choice or replacement of all new-image routes has different UI and
  persistence requirements.
- Persist the effective provider and model on every new run, scene and shoot.
  Retries and recovery must retain that identity. Existing Fast jobs belong
  to Sunburst and must not resume against Google just because a default changed.
- Preserve ordered role bindings and file hashes. Reject an incompatible
  request before submission; never discard required references to meet the
  fourteen-image limit. Any alternate route must be explicitly defined.
- Keep the approved look, garment details and composition guide distinct in
  prompts. Validate Google's request/response schema and normalize successful
  output through the existing media and QA contracts.
- Treat an ambiguous submitted outcome as unknown. Reuse a known interaction
  ID when supported; never create another paid generation simply because a
  connection timed out.
- Keep credentials server-side and add masked verification/setup support.
  Preserve OpenRouter semantic QA and the separate Seedance and Lucy routes.
- Test payloads, reference limits, provider identity, failure handling and old
  job recovery. Activation needs an authorized, budgeted real output with a
  provider receipt; mocked tests do not establish account/model access.

## Code and documentation map

| Area | Relevant files |
| --- | --- |
| Transport and image-mode routing | `beta/src/providers/`, `beta/src/web/generation-provider.js` |
| Model identity and policy | `beta/src/runner/model-policy.js`, `beta/config/model-policy.json` |
| Persisted runs, scenes and shoots | `beta/src/runner/`, `beta/src/web/` |
| Both website controls and client requests | `b/`, `adapters/`, `beta/web/public/` |
| Private operator setup | `scripts/operator-setup.py`, `docs/OPERATOR-SETUP.md` |
| Public route descriptions | `README.md`, `docs/PROVIDER-ROUTING.md` |
| Agent entry and history | `AGENTS.md`, `DECISIONS.md`, `CHANGELOG.md` |

Historical aliases retain their meaning: `nano_banana_flash` identifies Nano
Banana 2, while `nano_banana_2` identifies Nano Banana Pro. They are persisted
identifiers, not version numbers to replace globally. Old receipts, successful
test evidence and changelog entries must keep their original model names.
