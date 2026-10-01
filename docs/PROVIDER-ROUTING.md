# Wardrobe provider routing

## Images

The default `codex-primary` mode uses the authenticated Codex worker first,
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
appearance roles, and `@Video1` supplies camera, movement and timing. Source
hashes are checked before upload. Server-side FAL storage URLs and prompt
labels come from the same ordered list. Upload failure must stop before
queue submission. Private reference URLs and request receipts stay off Git.

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
