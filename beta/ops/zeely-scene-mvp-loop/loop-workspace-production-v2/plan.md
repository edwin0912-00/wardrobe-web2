# Zeely Production Scene — execution plan v2

## Outcome

Replace the current hardcoded blocking `optional_scene` bonus with a complete,
independently persisted product layer:

```text
saved approved look
→ exact look receipt
→ selected versioned scene preset
→ SceneService job
→ candidate + nine blocking gates
→ persistent scene under the look
→ retry/delete/download
```

The same service becomes the execution primitive for the six-shot editorial
program. Mood cards remain design evidence only.

## Non-negotiable invariants

1. Avatar and approved look bytes are immutable inputs to scene work.
2. Scene or shot failure never changes an approved core run to `FAILED`.
3. Every request is bound to `profile_id`, `look_id`, exact look SHA-256,
   exact look QA receipt SHA-256, `preset_id` and preset version.
4. Provider input uses logical roles only; public state never exposes local
   filesystem paths, prompts, provider IDs or secrets.
5. Delivery is exact 4:5. Complete head and footwear are blocking for full-body
   slots.
6. Only the failed scene or shot may be retried.
7. `PASS` is per exact output hash. Aggregate counts cannot approve assets.
8. A release cannot contain `PENDING`, `SKIPPED`, moving model aliases or a
   provenance field with no backing artifact.

## Stage 0 — interface and ownership freeze

### SceneService

```text
initialize()
create({ profileId, lookId, presetId, idempotencyKey })
list({ profileId, lookId })
get({ profileId, sceneId })
events({ profileId, sceneId, afterEventId })
retry({ profileId, sceneId, defectCodes, idempotencyKey })
cancel({ profileId, sceneId })
approve({ profileId, sceneId, expectedOutputSha256 })
delete({ profileId, sceneId })
outputFile({ profileId, sceneId, disposition })
reconcile()
```

All mutating calls are profile-bound and idempotent. Cross-profile IDs return
`404`, not `403`, to avoid resource enumeration.

Create also accepts `expectedPresetVersion` and
`expectedReferencePackSha256`; a stale binding returns `409`. Retry does not
trust client defect text: the client supplies only the expected failed
`attempt_id` and candidate hash, while the service compiles repair constraints
from the authoritative last QA receipt.

### Approved look reference

`ProfileService.approvedLookReference(profileId, lookId)` returns:

```json
{
  "look_id": "uuid",
  "avatar_id": "uuid",
  "source_run_id": "uuid",
  "path": "<private transport only>",
  "sha256": "<avatar_outfit.png sha256>",
  "manifest": {
    "path": "<private transport only>",
    "sha256": "<run-manifest.json sha256>"
  },
  "qa_receipt": {
    "decision": "PASS",
    "output_sha256": "<must equal look sha256>"
  },
  "expires_at": "<fixed profile expiry>"
}
```

The resolver independently verifies profile ownership, active look, source run
`COMPLETED`, exact output bytes, manifest bytes, manifest output SHA and
`qa.outfit.decision === PASS`. SceneService copies the exact look and receipt
into its immutable job input snapshot before returning `202`.

Deleting or expiring a look with an active scene/shoot first tombstones and
cancels descendants, then queues all owned execution directories for
idempotent cleanup. Published descendants cascade. A late provider result for
a tombstoned job is recorded and discarded, never published.

### Authoritative persistence

- SceneService filesystem ledger is authoritative for execution: immutable
  input snapshot, atomic `state.json`, append-only `events.jsonl`, attempts,
  candidates, QA and output receipt.
- SQLite is the profile-owned authorization/library projection.
- Publication protocol:
  1. atomically write candidate and exact-hash QA receipt;
  2. atomically transition execution ledger to `APPROVED`;
  3. transactionally upsert the SQLite projection using `scene_id + output_sha`;
  4. on initialize, reconciliation adds a missing projection for an approved
     owned ledger or tombstones a projection whose ledger/output cannot verify.
- No SQLite row points at an unverified candidate; no approved ledger remains
  permanently invisible after reconciliation.

### Scene state and event contract

```text
QUEUED
→ VERIFYING_LOOK
→ BINDING_PRESET
→ GENERATING
→ NORMALIZING_4X5
→ QA
→ QA_PASSED
→ APPROVED

QA → NEEDS_RETRY → QUEUED
any nonterminal → CANCELING → CANCELED
bounded infrastructure/route exhaustion → FAILED
```

Each retry creates immutable `attempt_id = <scene_id>:<attempt_number>`.
Progress is monotonic within an attempt and may reset only with an explicit
new-attempt event. Every persisted event has increasing `event_id`, timestamp,
public phase, percent and redacted data. SSE supports `Last-Event-ID` or
`?after=` replay before live subscription. Reload and service restart therefore
recover from disk instead of inventing progress.

`QA_PASSED` stores a verified candidate but does not publish it in the profile
library. `approve(expectedOutputSha256)` is allowed only from `QA_PASSED` and
atomically transitions to `APPROVED` before the SQLite publication handoff.

### SceneProvider

```text
generateScene({
  operationId,
  model,
  providerAspectRatio,
  deliveryAspectRatio: "4:5",
  resolution,
  quality,
  prompt,
  references: [
    LOOK_MASTER,
    ENVIRONMENT_ANCHOR,
    LIGHTING_ANCHOR,
    COMPOSITION_ANCHOR,
    PALETTE_ANCHOR,
    optional POSE_ANCHOR
  ]
})
→ { image, providerJobId, modelId, modelVersion, requestReceipt }
```

The ordered scene roles are implemented in a scene-only adapter and never
change core avatar/outfit reference ordering. `NEGATIVE_REFERENCE` is compiled
as a bounded textual/spec authority unless the selected provider explicitly
supports an additional image.

### Model and 4:5 decision

The fixed scene route preserves the user-selected model order:

1. `gpt_image_2`: provider `3:4`, `2k`, `high`, with a prompt-level centered
   4:5 safe window and deterministic measured 4:5 crop/normalization.
2. `nano_banana_flash` (Nano Banana 2): native provider `4:5`, `2k`.
3. `nano_banana_2` (Nano Banana Pro): native provider `4:5`, `2k`.

The receipt stores requested model, exact provider model/version, provider
aspect ratio, delivery aspect ratio, resolution, quality, raw SHA, crop
coordinates, final SHA, provider job/request ID and attempt. GPT Image 2 is not
falsely described as native 4:5. A provider capability smoke check is required
before live use.

Work package A updates the canon wording accordingly: delivery is always exact
4:5; provider-native 4:5 is required when supported; GPT Image 2 uses the
approved deterministic `3:4 → 4:5` derivation and must pass post-crop framing
QA. “Exact provider 4:5” is removed as an impossible universal requirement.

### QA receipt contract

Every gate result binds:

```text
candidate_sha256
look_sha256
preset_id + preset_version
reference_pack_sha256
gate_id
evaluator + evaluator_version
rubric_or_prompt_sha256
decision
defect_codes[]
created_at
```

| Gate | Enforcer | Required evidence | Pass/failure route |
|---|---|---|---|
| MASTER_LOOK_LOCK | programmatic | copied look bytes + source receipt | exact SHA or reject job |
| REFERENCE_ROLE_ISOLATION | programmatic | typed ordered bindings | exact roles or reject preset |
| NEAR_COPY_AND_LEAKAGE | similarity + judge | sources/snapshots + candidate | threshold/judge PASS or reject preset |
| IDENTITY | VLM judge | look master + candidate | PASS or retry scene |
| ITEM_FIDELITY | VLM + OCR where applicable | item locks + look + candidate | all visible locks PASS or retry |
| SCENE_MATCH | VLM judge | SceneSpec + plate + candidate | checklist PASS or retry |
| LIGHT_AND_CONTACT_SHADOW | VLM judge | light preview/spec + candidate | physical integration PASS or retry |
| FRAMING_AND_ANATOMY | programmatic bbox + VLM | slot rules + candidate | thresholds and anatomy PASS or retry |
| PROVENANCE | programmatic | complete attempt/release receipt | exact schema PASS or hold release |

An aesthetic average can never override a blocking failure.

`scene-leakage-policy@1.0.0` uses source snapshots from the ledger. A candidate
is rejected automatically when any source has `dHash64` Hamming distance
`≤ 8/64` or SSIM `≥ 0.92`. Distances `9–16` or SSIM `0.80–0.92` require the
versioned VLM composition/landmark judge; the gate passes only when that judge
also passes. Missing snapshots, similarity infrastructure, OCR/VLM
infrastructure or an unparseable response produces `QA_INFRASTRUCTURE_FAILED`
and holds release—never `SKIPPED`. OCR applies whenever source locks or the
candidate contain observable text/logo regions; otherwise the receipt records
`not_applicable` with the rule that established applicability.

### HTTP/API contract

```text
GET    /api/scene-presets
GET    /api/profile/looks/:lookId/scenes
POST   /api/profile/looks/:lookId/scenes
GET    /api/profile/scenes/:sceneId
GET    /api/profile/scenes/:sceneId/events?after=<event_id>
POST   /api/profile/scenes/:sceneId/retry
POST   /api/profile/scenes/:sceneId/cancel
POST   /api/profile/scenes/:sceneId/approve
DELETE /api/profile/scenes/:sceneId
GET    /api/profile/scenes/:sceneId/image
GET    /api/profile/scenes/:sceneId/download
```

Create/retry requires an `Idempotency-Key`. Same key + same canonical request
replays; same key + different request returns `409`. Invalid preset/input is
`422`; missing or foreign ownership is `404`; invalid state is `409`;
accepted asynchronous work is `202`.

Editorial adds:

```text
POST /api/profile/looks/:lookId/shoots
GET  /api/profile/shoots/:shootId
GET  /api/profile/shoots/:shootId/events?after=<event_id>
GET  /api/profile/shoots/:shootId/shots
POST /api/profile/shoots/:shootId/bible/approve
POST /api/profile/shoots/:shootId/hero/approve
POST /api/profile/shoots/:shootId/shots/:slot/retry
POST /api/profile/shoots/:shootId/cancel
DELETE /api/profile/shoots/:shootId
GET  /api/profile/shoots/:shootId/shots/:slot/image
GET  /api/profile/shoots/:shootId/shots/:slot/download
```

Frontend clients mirror these endpoints and persist active IDs, not private
paths.

Shoot creation is `multipart/form-data` with 1–20 JPEG/PNG/WebP references,
each at most 18 MB, plus a JSON `reference_roles` partition and one
`mode_id`. Unknown MIME, decode failure, missing role coverage, duplicate
source hash, oversized input or foreign look returns `422`; idempotency and
ownership follow the standard scene rules.

### SQLite projection

```text
profiles
└── avatars
    └── looks
        ├── scenes(scene_id, execution_id, preset_id, preset_version,
        │          status, output_sha256, approved_at, expires_at)
        └── shoots(shoot_id, mode_id, bible_sha256, status, expires_at)
            └── shots(shot_id, slot, execution_id, status, output_sha256)
```

Foreign keys cascade from profile/look. Active execution cancellation and
artifact cleanup use a migrated typed cleanup queue:

```text
resource_kind: RUN | SCENE_EXECUTION | SHOOT_EXECUTION
resource_id
profile_id
attempts
next_attempt_at
```

ProfileService dispatches `RUN` to RunService and scene/shoot kinds to their
own idempotent deletion handlers. A path is never accepted from a client or
stored as the deletion authority.

### File ownership for parallel work

- Contract/release worker: `config/scene-presets.json`,
  `schemas/scene-*`, release validators and contract tests.
- SceneService worker: new service/pure modules and focused service tests only.
- Root integration: existing `profile-service.js`, `app.js`, provider adapter,
  public UI, migrations and cross-layer tests.
- Asset work: new `assets/scene-presets/**`, prompts and release receipts.

No worker edits another owner’s files without an explicit handoff.

## Privacy and visual-proof path

- Non-personal plates, lighting previews, code and redacted receipts may be
  reviewed by separate Codex reviewer/judge contexts.
- A real avatar-conditioned result is personal output. It is evaluated only by
  the already configured same-vendor Zeely VLM/current Codex session under the
  user’s explicit instruction to generate and self-check; it is never sent to
  Claude, Gemini or the external council.
- QA requests contain logical attachment roles and no local paths. QA creates
  no duplicate asset outside the scene job. The job/profile fixed expiry and
  deletion cascade also remove its QA-bound output.
- A personal visual receipt records hashes, evaluator/model/rubric version and
  decision, not the user’s name or transport path.
- The external production judge reviews non-personal plates/previews plus the
  schema and exact hashes of personal QA receipts, not the personal pixels.
  A strict local receipt validator proves that the same-vendor QA saw the exact
  final candidate hash and all blocking gates; current-session visual
  inspection supplies the final local-only score.

## Work package A — contract and release truth

- Resolve the lens and top/bottom margin contradictions.
- Make the catalog schema enforce exact pipeline steps, gate IDs, locks,
  provenance fields, source counts, sensible ordered ranges and six unique
  editorial slots.
- Select exactly five launch presets and mark only those production-approved.
- Separate `visual_qa_status`, `launch_selection_status` and
  `production_release_status`.
- Add schemas for SceneSpec, scene job, reference pack, release manifest,
  per-asset QA receipt, ShootBible and editorial series.
- Add immutable asset revisions, exact derivation prompt lineage, stable model
  route/version and source/rights ledger.
- Build strict release and privacy validators that fail on every known
  contradiction.
- Winner authority is the current-session visual judge authorized by the user’s
  autonomous instruction. Selected launch IDs are:
  - `std.city.golden_hour_gloss`;
  - `std.studio.white_window_honeycomb`;
  - `std.studio.taupe_rembrandt_gloss`;
  - `std.interior.gallery_morning_gloss`;
  - `std.nature_architecture.concrete_grass_golden_hour`.
- The hash-bound selection receipt records actor type, rubric/prompt hash,
  candidate hashes, selected IDs, timestamp and decision. It is not mislabeled
  as human approval.
- Canon/schema step `HUMAN_APPROVAL` is migrated to
  `LAUNCH_SELECTION_APPROVAL` with `actor_type` enum
  `HUMAN | CURRENT_SESSION_JUDGE`; receipts may never label a judge as human.
- Every source ledger records URL, retrieval time, source snapshot SHA,
  author/rights holder when observable, license or limited-use basis, allowed
  role, attribution rule and derived-asset lineage. Regeneration is never used
  as proof of ownership.

Proof: contract tests, negative mutation tests, manifest schema validation and
strict release validator.

## Work package B — production preset assets

- Produce one original empty 4:5 environment plate and one lighting preview for
  each selected family winner.
- Package environment, lighting, composition, palette and negative authorities
  into versioned hash-bound reference packs.
- Preserve raw and final asset hashes plus every edit/reframe prompt.
- Write a per-hash visual matrix rather than one aggregate receipt.
- Verify near-copy/source leakage and rights/source provenance.

Proof: strict release validator plus original-resolution visual judge.

## Work package C — independent SceneService

- Add a service-owned persisted job directory and atomic JSON state.
- Implement create/get/retry/cancel/delete/output and restart reconciliation.
- Verify exact saved-look bytes and its PASS receipt before provider work.
- Compile a production prompt from SceneSpec; never reuse anonymous mood-card
  prompts.
- Pass explicit look, environment, light, composition and pose roles.
- Enforce 4:5 generation/delivery, stable model route and deterministic
  idempotency keys.
- Run nine named blocking gates and retain per-attempt evidence.
- Store a passed scene only after its exact hash has a PASS receipt.

Proof: integration tests covering success, reject→retry, exhausted route,
transport failure, crash-resume, duplicate create, authorization and delete.

## Work package D — profile graph, API and live UI

- Extend profile storage with scene projects, scene outputs, shoot projects and
  shots, all owned by one profile and attached to one look.
- Add a verified `approvedLookReference` method.
- Add routes for catalog, create/status/events/retry/cancel/delete/download.
- Add a result/library action “Створити сцену” without selecting an avatar
  again.
- Add preset selection, truthful pipeline progress, reload recovery and saved
  results on iPhone and desktop layouts.
- Keep existing approved look visible while scene work runs or fails.
- Browser proof uses desktop `1440×900` and iPhone 15 Pro `393×852` CSS pixels
  at DPR 3.
- Standard flow: existing look → scene selector → create → persisted progress →
  result → approve/retry/delete/download.
- Editorial flow: existing look → upload/assign references → ShootBible preview
  → approve bible → generate/approve hero → five-shot progress/gallery →
  per-shot retry.
- Cancel is visible for active work. All required actions remain in the active
  viewport at desktop and named iPhone viewport.

Proof: API/profile/UI tests and browser E2E with reload.

## Work package E — six-shot editorial production

- Extract user/editorial references into a typed ShootBible.
- Produce one SceneSpec per required shot slot.
- Generate and approve clean hero first.
- Fan out the remaining five shots with concurrency exactly two.
- Retry one failed shot without touching the look or sibling shots.
- Store a series manifest, per-shot receipts and gallery/contact sheet.
- Source references are copied into a private immutable shoot snapshot with
  hash, role, rights basis and profile expiry. They never enter reviewer egress.
- ShootBible is schema-validated and explicitly approved before generation.
- `clean_identity_hero` is a transaction barrier: no other slot is queued until
  its exact-hash PASS and approval.
- The scheduler persists a queue and lease and proves observed
  `max_in_flight === 2`. Restart requeues expired leases without duplicate
  provider operations.
- Full-body framing gates apply to hero/environmental/wide slots. The detail
  slot instead enforces its declared crop, exact material/item evidence and
  identity only when the face is intended to be visible.

Proof: editorial orchestration tests and six-hash visual/consistency judge.

## Delivery sequence

1. Contract/schema/validator repairs.
2. SceneService core with fake deterministic provider and strict tests.
3. Profile/API integration.
4. UI and reload E2E.
5. Five selected production asset packs.
6. One real saved-look standard scene through the complete service.
7. ShootBible and six-shot orchestration.
8. One real six-shot editorial run.
9. Full deterministic, privacy, visual, architecture and browser gates.

Legacy `generate_scene` is deprecated explicitly. New core requests with
`generate_scene=true` return a deterministic `422 LEGACY_SCENE_DISABLED` and a
public next-action code; false/missing continues normally. `#generateScene` is
removed from core execution so provider failure cannot enter the core catch.
Historical `art_director_scene.png` remains read-only downloadable for old runs
until their profile expiry.

## Requirement-to-proof matrix

| Requirement | Authoritative artifact/check |
|---|---|
| Exact catalog and release structure | schema mutation tests + `validate-scene-release --strict` |
| Five selected winners and rights | hash-bound launch approval + source ledgers |
| Plates/light/reference packs | exact per-asset manifests + per-hash visual matrices |
| 4:5 route | provider capability test + raw/crop/final receipt |
| Core independence | test: legacy true rejected; scene failure leaves completed look hashes unchanged |
| Exact look binding | service tests for ownership, run state, QA and tampered bytes/manifest |
| Idempotency/retry | duplicate/mismatch/retry tests with provider-call counts |
| Crash recovery | tests at submit, download, QA, ledger approval and SQLite publication boundaries |
| Event replay/reload | persisted cursor/SSE tests + browser reload E2E |
| Authorization | cross-profile create/read/download/delete all return 404 |
| TTL/cascade | running/completed/partial scene and shoot deletion tests |
| Nine gates | gate-matrix unit tests plus exact-hash receipts |
| Standard UI | automated desktop + iPhone viewport flow |
| ShootBible | schema/API/UI approval tests |
| Hero barrier/concurrency | scheduler test proves zero pre-hero starts and max in-flight two |
| One-shot retry | sibling hashes and provider-call counts unchanged |
| Personal visual QA | same-vendor redacted-path exact-hash receipt |
| Privacy | strict repository/receipt/EXIF/path/token scan |
| Final completion | release-evidence manifest maps every row above to passing current evidence |

Executable focused commands are also delivery gates:

```text
node --test test/web/scene-events-restart.test.js
node --test test/web/scene-browser-e2e.test.js
node --test test/web/editorial-shoot-service.test.js
node --test test/web/scene-retention.test.js
node --test test/providers/scene-provider-capabilities.test.js
node tools/validate-personal-scene-receipts.mjs --strict
```

## Stop rule

Do not publish a completion claim while any explicit requirement is missing,
unverified or supported only by a narrower check. Record every failed gate and
continue with the smallest stage-local repair.
