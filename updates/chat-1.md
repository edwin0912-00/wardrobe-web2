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
