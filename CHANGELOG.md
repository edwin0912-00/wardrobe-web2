# Wardrobe change history

This is the operational history of the unified `alpha` product. Git commits
carry the exact diffs and Lore decision trailers; this file explains their
effect on the complete product. Private inputs, receipts and keys stay off Git.

## 2026-10-07 — controlled QA provider recovery

- Added a validated startup switch for automatic recovery of failed scene QA.
  Operators can change QA providers without replaying the historical backlog;
  new jobs and explicit retries keep all existing quality checks.
- Recorded the owner-approved temporary Codex QA configuration after the
  OpenRouter credit outage. Slow/Fast image routing remains unchanged.

## 2026-10-06 — installation and readable documentation

- Documented Google's Nano Banana 2.1 API identity, limits, pricing sources
  and migration requirements. Runtime integration and provider access remain
  pending; current image routes and historical receipts are unchanged.

- Fixed a fresh-install failure when the operator selected OpenRouter QA. The
  credential-free README startup check now isolates its provider settings and
  Codex profile instead of retaining a provider selection after clearing its key.
  Real configured startup retains the operator's selected providers.
- Added a subprocess regression with inherited provider settings. A new GitHub
  clone with configured credentials passed all eight local acceptance stages
  and started both interfaces. Paid generation was not repeated in that check.
- Reworked the product, engine, compatibility, and documentation-index READMEs
  around the product and installation. Agent instructions and historical
  operating details remain in their focused documents. The cover is the
  existing cinematic opening poster; no generated proof or performance claim
  was added.

## 2026-10-03 — per-job image speed and video evidence

Follow-up verification on October 4 repaired the historical ADD_ITEMS packager
for the unified repository: its three materialized quality references are now
checked against the original locked Git tree instead of being requested from
the current Git archive. Rebuilt overlays record and verify those byte
bindings. Cache rewriting accepts the current source tags and still requires
each exact target once. The full-product release route remains the current
production installer and deploy path.

- Added the private operator questionnaire (`./setup run`) around the existing
  full-product installation contract. Media downloads use isolated temporary
  files and bounded timeouts while retaining byte-count, SHA and archive-path
  checks. The installer does not provision infrastructure or provider accounts.
- The local launcher directly owns the engine process, so a completed smoke
  check or terminal shutdown no longer leaves an npm child listening behind it.
- Main deployments now package only the serving files and locked cinematic
  media, preserve a versioned rollback, and verify public static bytes and
  Range responses. Both deployment gates require the expected engine source
  SHA and cache identity. A ready response from an older process cannot mark
  the new release active.
- Both websites expose image-only Slow/Fast selection. Slow remains the default
  Codex-first path with its known-safe FAL Sunburst fallback and direct FAL
  routing above five required references; Fast routes directly to FAL Sunburst.
  Each new run, background scene and shoot persists its choice; shoot children,
  retries and recovery use that saved mode. Video and Live remain independent.
- Initiating APIs accept `image_generation_mode: "slow" | "fast"`; omission
  means Slow, invalid values return HTTP 400, and an unavailable mode returns
  HTTP 503. `/api/health` advertises separate Slow and Fast availability. A
  changed mode cannot replay under the same idempotency key, while old records
  without the field retain their Slow identity.
- A separate owner-authorized Seedance 2.5 request
  `01a102e0-a588-7452-9b9e-1ab7b6b02afd` used only the reference-01 RGB/depth
  video pair plus the approved-look and garment-detail images. It returned
  HTTP 200 and a 720×1280, 24 FPS, 14.042-second MP4; the observed account
  balance reduction was $11.105316. Sampled review found a brief gray oval mask
  remnant and a background person. The request is a specific transport result,
  not a polished delivery or blanket access grant. The earlier rejected jobs
  remain terminal. No further video request was made.
- Real image routing checks on the image-speed candidate passed with five
  ordered references: Slow selected Codex without fallback (48.774 seconds),
  and Fast selected the FAL Sunburst edit endpoint without calling Codex
  (46.541 seconds). These are transport receipts, not a general speed benchmark
  or a complete semantic-QA verdict. Images and detailed receipts stay private.
- See [provider routing](docs/PROVIDER-ROUTING.md) and the
  [video-reference pipeline](docs/VIDEO-REFERENCE-PIPELINE.md) for the
  contracts and private-state boundary. This entry does not assert source
  publication or service activation.

## 2026-10-02 — video durability and SSD conservation

- Video metadata now publishes atomically; immutable source/media/receipts publish without overwrite. File and parent-directory syncing protect completed writes; partial writes preserve the previous record and cannot poison an immutable target.
- A successful local FAL acknowledgement can restore the same request ID only when model, endpoint, prompt, source, motion and uploaded-reference receipts match the locked request. Unknown or mismatched acknowledgements remain quarantined; startup never creates another paid job.
- Recovered jobs restore their profile projection only with a bound owner/look or an existing authorized association. Playback and download serve exactly the bytes matching the persisted QA SHA-256, rejecting changed or unverified delivery files.
- Preserved historical source/media before removing 38 release trees and 787 historical paths. Git history, external worktree dependencies, auth/cache/conversation state and live data remain protected. See [SSD conservation](docs/SSD-CONSOLIDATION.md) for measured outcomes and verification limits.
- Seedance person-reference refusals remain terminal. No new provider generation or support message was sent, and no masking/cropping/depth transformation was used to circumvent them.

## 2026-10-01 — reference-preserving FAL routing candidate

- `9f40523`: added Codex → FAL GPT Image 2.5 Sunburst image routing. More than
  five mandatory references bypass Codex's limit without dropping attachments;
  Sunburst supports sixteen. Fixed guide-first approved-scene validation,
  preserved quality escalation, and added durable provider journals and guards
  against duplicate paid POSTs after ambiguous outcomes.
- The same change added FAL Seedance 2.0/2.5 selection to both sites, default
  2.0. Source hashes, ordered image/video roles, uploaded URL lineage, selected
  model, endpoint and request ID survive retries and recovery. Compatible
  technical video derivatives preserve original duration and cut sheets;
  15.16/15.12-second references require 2.5. Existing OpenRouter jobs remain
  wait/resume only; semantic QA remains explicitly configurable.
- Live remains Lucy 2.5. Incomplete approved looks cannot request a token or
  turn on the selected-look camera before reference validation. Fixed the race
  that restored the waiting overlay after remote WebRTC frames arrived.
- `f8b84e2`: refreshed source/tree locks for the candidate rather than widening
  verification exclusions.
- `1276e31`: turned actual FAL content-policy and result-validation refusals
  into terminal failures with safe user-facing reasons and disabled retry paths.
  Repaired stale fixture clocks, image evidence, privacy expectations and
  five-profile retry assumptions. Product smoke now checks the full published
  sixteen-background/eighteen-shoot catalog while retaining legacy preview
  aliases for existing links.
- `fba82ac`: aligned release locks after those fixes.

Evidence for the original-reference 2026-10-01 candidate: real five-reference
Codex output, real Sunburst fallback output, real nine-reference editorial
detail output and synthetic-camera Lucy WebRTC transport passed. Canonical
local acceptance passed. Full engine verification had 1,183 passing cases and
thirteen legacy build cases refused by the host swap guard. Neither original-
reference Seedance request produced video: both returned
`content_policy_violation` / `partner_validation_failed` for the supplied
person references. Those jobs remain terminal; no alternate identity/model or
blind resubmission was used.

## 2026-10-01 — unified operating map

- `a988c43`: documented one active source line, both website surfaces, the
  shared engine, private runtime and dedicated Codex profile. Updated README,
  agent entrypoint and collaboration handoff after a real Codex transport check.
- The earlier deployed product was `9832c265776d2ee1d160af3d08a054a06572413d`.
  Later source publication is separate from activation; inspect live health and
  the activation receipt for the current deployed SHA.

## Historical import and asset provenance

`release/RELEASE.lock.json` preserves the main-site and original engine source
commits, the two-parent import history and the current engine tree. Historical
`main`, `beta` and `canonical-site-main` branches remain provenance.
`release/MEDIA.lock.json` pins the immutable 624-file GitHub media package.
The approved cinematic D journey and its media/mobile guarantees were retained.

## Outstanding work

- Confirm official FAL access for unmodified person references, including ACR
  eligibility and any supported workflow for standard endpoints and 2.5. The
  separate accepted derivative request does not establish blanket access.
- Complete resource-blocked legacy build checks on a host satisfying the
  existing guard; do not mark those tests as passed or disable the guard.
- Add a reviewed portable installation/deployment questionnaire around the
  existing unified installer. Current production deploy tooling is macOS and
  host-specific; a generic VPS command has not been implemented yet.
- Keep the verified private legacy archive and its restore manifests. Protected
  provider state and Git/worktree dependencies remain at their original paths.
