# Image speed selection and video preservation

The owner requested Slow/Fast image generation on both websites and preservation of the successful video workflow, then expanded the objective to reconcile source, GitHub, the deployment host and redundant Wardrobe storage. The requested labels and provider mapping are the design authorization; routine implementation and validation continue without another permission round.

## Behavior

Both cinematic and Studio surfaces expose the same image-only choice:

- **Slow**: existing Codex-first image router, including its safe FAL fallback and direct FAL route for more than five mandatory references.
- **Fast**: direct FAL GPT Image 2.5 Sunburst, preserving every required reference and existing semantic QA. Fast never falls back to Codex.

Slow remains the default. A browser preference can survive reload, but the selection applies only to new requests. Queued, running and recovered work uses its persisted selection. The choice covers avatar/look creation, garment conditioning, backgrounds and photoshoots. Video model selection and Live remain separate.

All initiating image endpoints accept `image_generation_mode: "slow" | "fast"`. Omission means Slow for backward compatibility; null, unknown strings and other types are rejected before work is created. Each run, scene and shoot persists the mode. Child scenes inherit the shoot's mode. Idempotency rejects a changed selection under the same key, while old records without the field retain their original Slow fingerprint and recovery behavior.

Provider dispatch is per request. The shared runtime must never be mutated when a user toggles the control. Fast remains usable when the Codex worker is unhealthy if FAL is configured; absent FAL produces a clear unavailable capability/error. Existing malformed-input and unknown-paid-outcome guards remain unchanged. Receipts identify requested mode and actual provider.

## Integration

Reuse the existing `ImageGenerationRouter`, FAL adapter, request serializers, persisted job records, and UI selector styling. Add a small shared mode normalizer under `beta/src/providers/` and pass the persisted value through existing generation contexts. Do not create a second worker pool or provider-key store.

The preferred design is per-job routing through the existing router. A server-global toggle is rejected because concurrent users and resumed jobs could silently change providers. Reconstructing the whole runtime per request is rejected because it duplicates worker lifecycle and health handling.

## Video preservation

Keep the verified workflow reproducible: hash-bound originals, OpenCV face masks with reviewed corrections, true relative depth, ordered reference bindings, explicit prompt authority, server-side FAL upload, one durable submission, and result/cost receipts. Preserve the original node's environment, lighting, color and optics roles in the recorded video recipe. The successful Seedance 2.5 experiment used two image and two video references, returned HTTP 200, and incurred an observed $11.105316 balance reduction.

Record that success separately from remaining visual defects and production integration. Store portable processing/replay code and public documentation in Git; keep private media, credentials and upload URLs outside Git. No further paid video test is authorized by this delivery block. Preserve the current named video models and known remote jobs.

## Release and cleanup

The integration line is `alpha`. Root reviews all changes, runs the unified acceptance contract, publishes source, builds immutable main/engine artifacts from the same SHA, activates with active-work checks and rollback, and verifies both public surfaces. Update README, provider instructions, changelog and board with exact source/deployment states.

Cleanup is limited to proven redundant Wardrobe paths after new source/media and required history are preserved. Recheck processes, open files, symlinks/hardlinks and active artifact dependencies immediately before deletion. Preserve unrelated projects, private authentication, working databases, required media and unique legacy history. Report exact removed paths and measured reclaimed space.

## Acceptance

Slow and Fast dispatch to their intended transports in core, background and shoot flows; old clients default to Slow. Both UIs send the field and remain accessible on desktop/mobile. A toggle during an active job cannot change it. Invalid modes fail before generation. Restart/retry retains selection and does not duplicate paid requests. Missing FAL is visible, and an unavailable Codex worker does not block configured Fast. GitHub, canonical source and deployed product hashes are reconciled; cleanup has evidence and a post-state receipt.
