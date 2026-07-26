# Merge analysis — `feature/wardrobe-editorial-mvp-20260726` × `codex-new-2026-07-26`

Source: Claude/CodeCode handoff written locally on 2026-07-26. Original
SHA-256:
`8f16faffcb1ea3c93589e186588e2e876a29a403047c14a6aebee50c3634f76d`.

This document preserves the semantic merge instructions. The original counted
13 unique Codex commits; `f891719` was pushed afterwards, so the current count
is 14. The reasoning below remains the handoff authority for its conflict set.

## Fork and integration worktree

Fork point: `d7f760f` (“Let a slot that waives clear space fill the canvas”).
Claude continued for six commits and Codex continued for fourteen. Eight files
were touched by both and six were expected to conflict.

An isolated integration worktree was prepared on
`integration/wardrobe-20260726`, based on the Claude branch. Its local absolute
path is deliberately omitted. The semantic merge has not started. The intended
merge source is `origin/codex-new-2026-07-26`.

The headline from Claude: this is almost never “pick one”. Both sides fixed the
same problems from opposite ends. Six of eight resolutions require combining
the changes.

## Conflict instructions

### 1. `schemas/scene-job.schema.json` — combine

Claude replaced hand-copied framing bands with
`{ "$ref": "#/$defs/framingLock" }`, so the schemas cannot drift from
`editorialFramingLock()`.

Codex added an `if/then` for `deterministic_headroom_shift`:

- `transform_version: zeely.headroom-shift.v1`;
- `vertical_shift_px`, `top_extension_px`, and `bottom_crop_px` capped at 6;
- `edge_extension_mode: "copy"`;
- a special carve-out for `std.studio.taupe_rembrandt_gloss`.

Keep the `$ref` and place any product-approved transform constraint beside it
in the same `allOf`. Do not inline framing bands again.

### 2. `schemas/scene-production-receipt.schema.json` — combine

Same resolution as the scene-job schema: retain the single framing-lock
definition and add only a product-approved transform rule.

### 3. `test/web/scene-adapters.test.js` imports — union

Keep all imports required by both sides:

- Claude:
  `CONTACT_SHADOW_CROP_WAIVER_REFUSED`,
  `EVALUATOR_FRAMING_DEFECTS`,
  `FRAMING_ANATOMY_DEFECTS`,
  `FRAMING_DEFECT_OUTSIDE_VOCABULARY`,
  `FRAMING_VISIBILITY_DEFECTS`,
  `assertFramingDefectVocabulary`,
  `validateEvaluatorPayload`.
- Codex: `CONTACT_SHADOW_WAIVER_NOT_ALLOWED`.

Confirm that every imported name exists in the merged adapter.

### 4. `src/web/scene-adapters.js` imports — union

Claude adds `contactPointInsideFrame`. Codex adds
`STANDARD_SCENE_SOURCE_STAGING` and `canonicalJsonBytes`. All are used.

### 5. `src/web/scene-adapters.js`, waiver enforcement — Claude evidence plus Codex policy

Claude replaced two literal phrase checks with observation-based enforcement.
The replacement enumerates the only two ways a contact point can be outside
the visible evidence: the crop ends above it, or a foreground element occludes
it. This prevents paraphrased waiver claims from bypassing the gate.

Codex adds `contactShadowWaiverPolicy(preset)`, a per-preset policy. Keep the
observation/vocabulary enforcement and thread the policy through it.

### 6. `src/web/scene-adapters.js`, longer validation branch — Claude side

Claude's branch is the superset. Preserve it.

### 7. `validateEvaluatorPayload` call sites — combine the signature

Claude needs delivery geometry:

```js
validateEvaluatorPayload(payload, delivery)
```

Codex needs the waiver policy:

```js
validateEvaluatorPayload(payload, waiverPolicy)
```

Use one options object:

```js
validateEvaluatorPayload(payload, { delivery, waiverPolicy })
```

Update all three call sites and the OpenRouter evaluator. This function is the
single choke point for waiver audit.

### 8. `src/web/scene-service.js`, short-headroom repair prompt — combine

Claude fires from the recorded defect alone, not from the declared preset
minimum. This matters because an editorial slot may measure below its minimum
while holding an explicit waiver. Claude's prompt records measured clearance,
minimum, missing points, and unused floor.

Codex carries canvas height, subject box, crop readiness, and transform
availability.

Keep Claude's recorded-defect gating and numeric phrasing. Add only the safe,
product-approved shift/crop awareness. Do not restore
`subjectTooSmall && headroomShort`; that condition misses the observed failure
mode fixed in `12b9264`.

### 9. `src/web/scene-service.js`, crop eligibility — Claude side unless contradicted by named evidence

Claude permits deterministic crop only when
`FRAMING_AND_ANATOMY` is the sole failed visual gate. Codex permits it whenever
framing appears among the failures.

Claude's cited incident is `scene_1cd6953f`, attempt 3, which failed framing
and `LIGHT_AND_CONTACT_SHADOW` (`MISSING_FACE_GOBO_PATTERN`). Spending a
geometric repair there could not produce an acceptable frame.

Use the stricter rule unless a specific measured case proves the permissive
rule is necessary.

### 10. `src/web/editorial-shoot-service.js` — Codex derivation, Claude incident rationale

Both sides fix execution addresses that were derived from look and Bible
alone. Shoot `24f54a3a` re-derived shoot `b1a8468c` scene IDs, and three slots
collided rather than failing on quality.

Use Codex's derivation from `shootId`, request fingerprint, and slot. Preserve
Claude's incident comment so later changes distinguish intentional
content-addressed reuse from execution-key collision.

## Product decision that cannot be made by an agent

`deterministic_headroom_shift` extends the top using copied edge rows and crops
the same amount at the bottom. It is bounded, versioned, receipt-bound, and
preset-scoped, but it adds pixels not present in the source. Edwin must decide
whether any such extension is acceptable.

The taupe preset also had an exemption from the 6 px cap. A per-preset
exception can quietly become policy and is not approved.

Measured headroom deficits were 2.3–2.7 percentage points, approximately
29–35 px on a 1280 px canvas. A 6 px shift closes only about 0.47 percentage
points, so it cannot converge the observed frames by itself.

Until Edwin decides, the integration resolution must not enable copied-edge
delivery or a taupe carve-out.

## Acceptance before integration

- Run `PATH=/opt/homebrew/bin:$PATH npm test` and report before/after counts.
  The temporary ceiling is the two exact failures in `STATE.md`.
- Retain and pass both sides' focused tests.
- Confirm zero `<<<<<<<`, `=======`, or `>>>>>>>` markers.
- Run `node --check` on every merged JavaScript file.
- Validate the three affected schemas with the project's AJV setup.
- Record each conflict resolution and rationale in the integration handoff.
- Push the integration branch and use a PR. Never push to `main`.
