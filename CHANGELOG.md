# Wardrobe change history

This is the operational history of the unified `alpha` product. Git commits
carry the exact diffs and Lore decision trailers; this file explains their
effect on the complete product. Private inputs, receipts and keys stay off Git.

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

Evidence: real five-reference Codex output, real Sunburst fallback output,
real nine-reference editorial detail output and synthetic-camera Lucy WebRTC
transport passed. Canonical local acceptance passed. Full engine verification
had 1,183 passing cases and thirteen legacy build cases refused by the host
swap guard. Neither actual Seedance request produced video: both returned
`content_policy_violation` / `partner_validation_failed` for the supplied person
references. No alternate identity/model or blind resubmission was used.

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

- Confirm official FAL access for the supplied person references, including
  ACR eligibility and any supported workflow for standard endpoints and 2.5.
- Complete resource-blocked legacy build checks on a host satisfying the
  existing guard; do not mark those tests as passed or disable the guard.
- Add a reviewed portable installation/deployment questionnaire around the
  existing unified installer. Current production deploy tooling is macOS and
  host-specific; a generic VPS command has not been implemented yet.
- Keep the verified private legacy archive and its restore manifests. Protected
  provider state and Git/worktree dependencies remain at their original paths.
