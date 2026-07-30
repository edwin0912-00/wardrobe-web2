Agent ID: codex-main
Block: 1
Branch: chat01/scene-delivery-light-integration-20260730
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
