# Wardrobe change history

This is the operational history of the unified `alpha` product. Git commits
carry the exact diffs and Lore decision trailers; this file explains their
effect on the complete product. Private inputs, receipts and keys stay off Git.

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
- Keep SSD cleanup separate: useful differing media/history remain, and the
  audit did not prove a whole target safe to delete.
