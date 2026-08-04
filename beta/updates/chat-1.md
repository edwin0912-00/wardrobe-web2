Agent ID: codex-main
Block: 1
Branch: chat01/scene-delivery-light-integration-20260730

---

Task: provider-wait heartbeat for the core image route (`LOOK.04–06`).
Decision: a provider wait is not a lost client connection and does not authorize cancellation or a duplicate remote create. After 60 seconds, `RunService` now derives the active journaled Higgsfield wait into durable `run.json` evidence: private provider job id, attempt, start and minute-throttled elapsed time. The public run state exposes only WAITING/attempt/start/elapsed, never the remote job id. The existing progress surface receives an ordinary RUNNING SSE state and says that the provider is still processing; terminal content-QA rejection remains the existing explicit FAILED + retry path.
Code: READY_FOR_REVIEW — focused fake-clock journal/projection test PASS; Higgsfield provider suite PASS 32/32.
Beta: NOT_DEPLOYED.
Journey: NOT_RUN — no provider request was created for this repair.
weakened_checks: none. Existing journaled idempotency/resume checks remain strict; the repair neither cancels a pending job nor relaxes identity/item QA.
Integration prerequisite: integrate this branch atop current `origin/beta`; no shared-bootstrap wiring is required. Then activate that exact SHA and verify a controlled wait emits one persisted `provider_wait` heartbeat after 60 seconds and a terminal QA rejection remains retryable.
Task ID: BLOCK-1-STANDARD-SCENE-DELIVERY-QA
Base: eeff548723af3e66ccbcf0ffc189784534a70b4d
Rationale/decision: standard-scene 70–80% remains the generation target, while an intact full-body frame may deliver through an explicit <=88% composition tolerance instead of spending three provider attempts on scale alone.
Code: READY_FOR_REVIEW — exact scene_99d60… geometry is covered; an exhausted candidate rejected only by the old scale ceiling is re-QA'd in place without another image generation.
Beta: NOT_DEPLOYED.
Journey: NOT_RUN on beta; owner commit requires Chat00 integration and exact-SHA activation first.
Lighting: standard QA now records key, fill and environment integration separately; mild frontal fill is advisory, while a replacement studio key/pasted composite remains blocking.
Evidence: framing/schema suites 17/17 PASS; focused preserved-candidate + standard-lighting tests 2/2 PASS; schema generator check 3/3.
weakened_checks: OPERATOR_APPROVED_STANDARD_COMPOSITION_TOLERANCE — preferred target stays 70–80%; delivery extends only to 88%. Full head, full footwear, 8% headroom, 2% floor, anatomy, identity and item fidelity remain blocking.
Known limitation: environment-plate.webp and lighting-preview.webp are not promoted into generation authority because their checked-in candidate provenance still says MISSING_FROM_BUILTIN_IMAGE_TOOL; this change does not falsify or bypass that provenance.
Help request: Chat00 review/cherry-pick the exact owner commit, deploy that SHA, then re-QA the preserved scene candidate before any new paid generation.

---

Task ID: BLOCK-1-STANDARD-SCENE-HEADROOM-DELIVERY
Trigger: after the first atom was deployed, fresh re-QA of preserved scene_99d60… attempt 003 measured 76.6602% subject height and passed identity, items, scene, lighting, contact shadow, anatomy, full head and full footwear. Its sole refusal was 7.5684% clear space above hair against the 8% provider target.
Decision: keep 8% as the provider composition target; permit a standard delivery from 7.5% only when the full head is explicitly visible. The receipt records `clear_space_above_hair_delivery_tolerance_applied=true`. Below 7.5% remains blocking.
Code: READY_FOR_REVIEW — runtime owner, generated schemas and regression evidence updated.
Beta: NOT_DEPLOYED for this second atom.
Evidence: framing + schema suites 18/18 PASS; schema generator 3/3; node check and diff check PASS.
weakened_checks: OPERATOR_APPROVED_STANDARD_HEADROOM_MEASUREMENT_TOLERANCE — 8% target retained; delivery floor is 7.5% with full-head visibility. Cropped head, <7.5% headroom, footwear, floor, anatomy, identity and item fidelity remain blocking.
Help request: Chat00 cherry-pick only the new headroom atom atop deployed integration 6890a90…, deploy the exact integration SHA, then retry the same preserved scene with zero provider generation.

Repair before release: Chat00 correctly reproduced that the new derived headroom-tolerance field was absent from pre-field attempts 001–003 and the strict persisted-state comparison would quarantine them on restart. The compatibility set now recomputes only that missing derived value, while an explicitly supplied false/tampered value still fails closed.
Exact live-state proof: `validatePersistedSceneState()` successfully reopened scene_99d60… with status FAILED, exactly three attempts and the new field absent from all legacy attempt receipts.
Repair evidence: legacy+tamper regression 1/1 PASS; framing/schema 18/18 PASS; schema generator 3/3; node and diff checks PASS.

Second acceptance repair: the retry selector was still hardcoded to the historic `SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE` defect. It now permits QA-only reuse for any old framing-only refusal only when the current canonical framing assessment returns zero defects. Non-framing failures, multiple failed gates, malformed evidence and still-invalid framing remain fail-closed.
Evidence: old scale + old headroom preserved-candidate retries 2/2 PASS; persisted compatibility/tamper 1/1 PASS. The headroom regression keeps exactly three attempts, cycle 1, manual retries 0 and three generator calls, then completes after exactly one new evaluator call.

---

Task ID: BLOCK-1-STANDARD-SCENE-PRESENTATION-TOLERANCE
Operator decision: visual QA for standard fashion scenes was calibrated too close to ecommerce packshot QA. Keep strict targets, allow three percentage points of normal variance plus one final warning point.
Implementation: 8% headroom remains the provider target; intact standard deliveries pass from 4% when full-head visibility is true. Standard-background item QA treats minor simplification of small hardware, stitching, fasteners, closures and edge finishing as advisory when count/type, color/material family, silhouette, major construction, visible pattern and legible logo/text remain correct.
Hard blocks retained: wrong/missing item, category/count, identity, gross anatomy, major silhouette/material/color/construction, visible logo/text/pattern substitution, unauthorized additions, leakage and scene mismatch.
Retry: candidates refused only by old ITEM_FIDELITY/FRAMING delivery policy can receive one QA-only policy recheck; every other failed gate remains ineligible and no generation is opened.
Evidence: presentation policy + preserved retry focused 3/3 PASS; framing/schema 18/18 PASS; schema generator 3/3; syntax and diff checks PASS.
weakened_checks: OPERATOR_APPROVED_STANDARD_PRESENTATION_TOLERANCE — numeric delivery warning band is 4 percentage points; minor full-body hardware/finishing deviations are advisory. Hard identity/product/category/logo/text/anatomy gates remain blocking.
Compatibility repair: delivery-tolerance flags are current-policy conclusions, not raw visual observations. Persisted historic true/false values may drift across a policy release and are recomputed on read; canvas, bbox, measured percentages, full-head and full-footwear evidence remain strict. The exact quarantined scene_99d60… validates from its incident directory under this repair; raw bbox and visibility tamper regressions still fail closed.

---

Task ID: BLOCK-1-SCENE-PRIVACY-EXPORT-RECOVERY
Trigger: the preserved standard scene passed all eight evaluator gates under the approved presentation tolerance, then failed only while scanning the final production manifest for private material.
Implementation: a final-manifest privacy refusal now writes an immutable sanitized report containing the manifest hash and matched rule without reproducing the private value. A failed scene whose last immutable attempt is still `QA_PASS` may retry export only: no new attempt, generation, evaluator call, cycle or manual retry.
Safety: export-only recovery remains ineligible when any evaluator gate failed, the approved candidate is absent, or the error is not `PRIVACY_GATE_FAILED`. Bound inputs, candidate hash, provenance, privacy scan and output hashes are all rechecked.
Evidence: focused privacy regressions 2/2 PASS; the new regression proves two attempts remain two, generator calls remain two and evaluator calls remain two while the corrected manifest exports successfully. Full scene-service suite remains affected by the previously recorded fixture/policy drift outside this atom (26/49 PASS); no failing assertion was introduced or suppressed by this focused repair.
weakened_checks: none — this changes observability and restart point, not the privacy rules.
Follow-up diagnosis: the live report named `NO_ABSOLUTE_USER_PATHS`, but no persisted scene/attempt/prompt string contained an absolute path. The false positive was created by applying path regexes to the entire canonical one-line JSON serialization instead of to semantic string values. Final-manifest privacy now walks each JSON string independently and records an RFC 6901 pointer when a real value fails. A byte-for-byte copy of live `scene_99d60…` completed export under this scanner with attempts/candidate/QA unchanged; no locator or receipt field was rewritten.

---

Task ID: BLOCK-1-TEXT-ONLY-OUTFIT-INTERPRETATION
Decision: a text-only outfit request is a creative brief, not a photo-exact product dossier. It locks only the facts the user explicitly wrote. Details left open — for example exact jacket type, colour, hardware, material finish, construction, fit or logo — are an allowed AI interpretation, not a reason to demand a photo.
Implementation: outfit QA receives this authority in its prompt and has one narrow fallback for the evaluator's explicit `missing unspecified product facts` refusal. It cannot convert a positive contradiction of stated text, identity failure, anatomy/image defect, old-clothing residue or a photo-reference mismatch into PASS. Image-backed references remain strict. A successful result exposes `Уточнити образ`: it reopens a new draft with the same avatar and previous text, where the user can refine the text or add a reference photo. The prior saved look is never overwritten.
Code: READY_FOR_REVIEW on `beta-block-1-text-outfit-interpretation-20260730`.
Beta: NOT_DEPLOYED. No provider generation or existing look mutation was performed.
Evidence: Codex VLM evaluator focused suite PASS; profile navigation/continuation tests cover text carry-forward; JavaScript syntax and diff checks pending final run.
weakened_checks: none for image-backed outfits or explicit textual requirements; this is an evidence-source contract, not a global QA relaxation.
