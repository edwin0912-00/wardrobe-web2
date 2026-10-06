# Wardrobe provider routing

Nano Banana 2.1 is an owner-requested image-model update. Its verified Google
ID is `gemini-nano-banana-2.1`; provider access and runtime integration are
pending. See the [model contract and migration requirements](NANO-BANANA-2.1.md).
The active routes below have not yet changed.

## Images

Slow is the default image mode. It uses the authenticated Codex worker first,
then FAL `openai/gpt-image-2.5/sunburst/edit` on a known safe primary failure.
Requests with more than five required image references skip Codex and go
directly to Sunburst, which supports sixteen. Never drop a required reference
to fit a transport. Logical legacy image route names do not identify the
actual model; use the provider receipt and routing metadata.

Sunburst preserves the existing low/1k → medium/2k → high/4k escalation
profile. Its physical maximum is 3840 pixels on the long edge; the logical
4k profile uses that limit and records the actual dimensions. Never describe
it as a native 4096-pixel output.

Malformed input, missing or changed references, journal conflicts and unknown
submitted outcomes never trigger another paid submission. A persisted remote
request must be resumed rather than created again. OpenRouter remains the
semantic QA provider; it is not the default image fallback.

## Slow/Fast image generation

Both the cinematic site and Studio expose the same choice for new image jobs.
The preference applies to the next request only; each accepted job persists its
effective mode so a later toggle cannot change queued, running or recovered
work. The selector is image-only and does not change Fashion Video or Live.

- **Slow (default)** uses the existing Codex-first path, with FAL Sunburst as
  its known-safe fallback. More than five required references bypass Codex and
  go directly to Sunburst, preserving all references.
- **Fast** sends directly to FAL Sunburst. It never tries Codex as a fallback.

The initiating image APIs accept `image_generation_mode: "slow" | "fast"`:
`POST /api/runs` (multipart), `/api/draft/run`, background-scene creation and
editorial-shoot creation. Omission means `slow`. `null`, other types and
unknown strings are rejected with HTTP 400 and
`IMAGE_GENERATION_MODE_INVALID` before a job is created. The mode is stored on
runs, scenes and shoots. Shoot child scenes inherit their parent's stored
mode. Retries, approvals and recovery use the owned persisted mode rather than
a newly selected browser preference. Replaying an idempotency key with a
different mode conflicts; pre-mode records without the field retain their
Slow identity and are treated as Slow without rewriting their state or
manifests.

`GET /api/health` reports per-mode capability as
`image_generation_modes: { slow: { available: boolean }, fast: { available: boolean } }`.
If a requested mode is unavailable, its generation trigger returns HTTP 503
with `IMAGE_GENERATION_MODE_UNAVAILABLE`; Fast never silently falls back to
Codex. A configured FAL route can keep Fast available when Codex preflight
fails. A shared hard runtime fault can make both modes unavailable.

## Fashion Video

Both sites select Seedance 2.0 (default) or Seedance 2.5. Creation accepts
`video_model: "seedance-2.0" | "seedance-2.5"`; omission means 2.0, unknown
values are rejected. A change affects the next clip only. Persisted clips,
retries and recovered jobs retain their selected model and endpoint.

New jobs use FAL `bytedance/seedance-2.0/reference-to-video` or
`bytedance/seedance-2.5/reference-to-video`. For 2.5, task is `reference`.
Existing recorded OpenRouter jobs may still be resumed; new jobs are not
silently redirected to that provider.

The approved master is `@Image1`, subsequent images retain their declared
appearance roles, and `@Video1` supplies camera, movement, timing, environment,
lighting, color and optical direction. The video transport normalizes reference
labels without stripping those scene roles from new prompts. Source
hashes are checked before upload. Server-side FAL storage URLs and prompt
labels come from the same ordered list. Upload failure must stop before
queue submission. Private reference URLs and request receipts stay off Git.

New clips pin `scene-direction-v2` in their immutable request binding and
provider input receipt. Older clips without a prompt-policy marker retain
their exact `motion-only-v1` wire transformation during acknowledgement
recovery. A policy mismatch quarantines recovery; it never authorizes another
paid create.

| Contract | Seedance 2.0 | Seedance 2.5 |
|---|---|---|
| Images | up to 9 | up to 30 |
| Videos | up to 3 | up to 10 |
| All reference files | up to 12 | up to 50 |
| Video reference duration | total 2–15 seconds | each 1.8–30.2 seconds; total at most 30.2 |
| Video input bytes | total below 50 MB | each at most 200 MB |
| Output duration | 4–15 seconds | 4–30 seconds |
| Product output default | 720p | 720p |

Model-specific format, geometry and frame-rate validation runs before a paid
submission. A compatible technical derivative retains original timing and
source lineage. The 15.16-second and 15.12-second motion references require
2.5: do not trim or speed up their locked cut sheets to fit 2.0.

## Live and private configuration

Live remains `decart/lucy-2-5/realtime`. A saved look requires verified upper
garment or one-piece, lower garment or one-piece, and footwear. Incomplete
looks show a reason before camera access and cannot obtain a provider token.
Outerwear is not automatically promoted to an upper-garment authority.

`FAL_KEY` is server-only and supplies images, video and short-lived Live
tokens. Codex uses its dedicated OAuth profile; OpenRouter QA uses its
existing private key. Never place credentials in client JavaScript, release
artifacts, commits or board comments.

## Acceptance and operations

Run `./verify full` for committed-source, browser, runtime and backend checks.
These checks do not prove paid provider output. Validate actual models
separately, retaining artifacts, hashes, request IDs and costs in the private
audit. The owner approved a total USD 20 paid validation ceiling without
top-ups. If a required model is unavailable, report the exact failure; do not
replace it silently.

Inspect the engine launcher's current artifact and active work before any
restart. Preserve runtime databases, Codex authorization and original media.
SSD cleanup is a separate reviewed block after content and liveness checks.

Official contracts:

- [Sunburst editing](https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/api)
- [Seedance 2.0 reference video](https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/api)
- [Seedance 2.5 reference video](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api)
- [Lucy realtime](https://fal.ai/models/decart/lucy-2-5/realtime/api)

## Actual validation — 2026-10-01

Codex produced a five-reference scene without fallback. Sunburst produced a
five-reference scene after a controlled pre-submit primary failure and a
nine-reference editorial detail frame after skipping Codex's reference limit.
Lucy delivered decoded 1280×720 WebRTC frames with a synthetic camera; this
proves transport, not real-person try-on quality. Private artifacts and request
receipts remain outside the repository.

Both named Seedance endpoints accepted queued requests but rejected the
approved photo/video test set with HTTP 422, `content_policy_violation` and
`partner_validation_failed`, citing possible real-person likeness or private
information. No video output was generated. This is an input-policy rejection,
not proof of an expired key or a broken upload. Do not advertise these inputs
as verified working or substitute another model/source. The product records
the refusal as terminal, exposes a safe reason and disables retries for that
parent. Generic 400/422 result validation is also terminal; transport failures
with a known request ID can resume polling that same job.

[FAL error semantics](https://fal.ai/docs/documentation/model-apis/errors)
mark content-policy violations as non-retryable. The original test set remains
rejected historical evidence. The authorized derivative experiment below is a
separate request with its own inputs and receipt.

## Authorized derivative test — 2026-10-03

A separate owner-authorized Seedance 2.5 request
`01a102e0-a588-7452-9b9e-1ab7b6b02afd` used the approved-look and garment-detail
images plus only reference-01's reviewed face-masked RGB derivative and its
synchronized relative-depth video. FAL returned HTTP 200 and a 720×1280,
24 FPS MP4 lasting 14.042 seconds. All original source hashes remained
unchanged. This confirms that exact request only; it does not turn earlier
rejected jobs into retryable ones, grant blanket person-reference access or
certify every future input.

The observed account-balance reduction was $11.105316. The estimate charged
13.24 seconds of RGB input, 13.24 seconds of depth input and 14 requested
output seconds. Sampled review found a brief gray oval mask remnant and a
background person. This was a transport success with visible defects, not a
polished deliverable. Earlier original-reference rejections remain terminal;
no new provider request was run for this documentation update. Reproduction
steps and private-state boundaries are documented in
[`VIDEO-REFERENCE-PIPELINE.md`](VIDEO-REFERENCE-PIPELINE.md).
