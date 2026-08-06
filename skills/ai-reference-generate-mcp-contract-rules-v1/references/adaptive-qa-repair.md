# Adaptive QA and deterministic repair

## Contents

1. Separate acceptance from generation target
2. Preserve hard locks
3. Normalize defects
4. Detect stalls and systemic misses
5. Choose the repair mechanism
6. Bound attempts
7. Persist every attempt
8. Record weakened checks honestly

## 1. Separate acceptance from generation target

QA measures. The repair router decides. A failed provider run never changes the acceptance policy.

Declare four numeric layers per metric:

- `target`: generation aim; not an exact-equality gate.
- `preferred_band`: preset composition intent.
- `delivery_band`: widest product-approved interval that may ship.
- `measurement_epsilon`: one declared allowance for pixel/rounding uncertainty.

Apply epsilon once. Never accumulate or enlarge it across retries.

```text
PASS = every hard lock passes
       AND every measured value is inside its delivery band after one epsilon
```

Example only:

```text
target: 65%
tolerance: ±3 percentage points
measurement epsilon: ±1 percentage point
effective delivery interval: 61–69%
```

Do not confuse a percentage-point distance with a relative percentage.

Project-specific canon may define an asymmetric delivery band. For example, a preferred 76% subject scale can permit a wider 70–88% delivery band while still requiring full head and footwear. Record that policy explicitly; do not infer it from repeated failures. A repeated 65% frame against a 70% delivery minimum is a systemic miss, not acceptable drift.

## 2. Preserve hard locks

Never auto-weaken:

- identity;
- selected-item construction, colour, material, logo, and text;
- reference-performer leakage prevention;
- provenance and SHA bindings;
- anatomy;
- required head/footwear visibility;
- reference-role isolation.

Repairable without changing policy:

- subject scale and x/y placement;
- headroom and footwear-floor margin;
- crop where real source pixels exist;
- camera/framing;
- style/light only while already-passed identity/item locks remain unchanged.

## 3. Normalize defects

Persist for each failed attempt:

```json
{
  "gate": "FRAMING_AND_ANATOMY",
  "defect_code": "SUBJECT_TOO_SMALL",
  "direction": "increase_subject_scale",
  "observed": 65,
  "target": 76,
  "preferred_band": [70, 80],
  "delivery_band": [70, 88],
  "measurement_epsilon": 0,
  "distance_to_delivery_band_pp": 5,
  "candidate_sha256": "...",
  "input_manifest_sha256": "...",
  "model_internal_id": "...",
  "provider_model_id": "...",
  "prompt_sha256": "...",
  "attempt": 2,
  "cycle": 1
}
```

Distance is zero inside the delivery interval; otherwise it is the absolute percentage-point distance to the nearest boundary.

Defect signature:

```text
gate + defect_code + direction + preset_or_slot + protected_input_hashes
```

Never include free prose in the signature.

## 4. Detect stalls and systemic misses

```text
progress_pp = previous_distance_to_band - current_distance_to_band
```

Classify:

- `WITHIN_TOLERANCE`: distance is zero and hard locks pass.
- `FIRST_REPAIRABLE_MISS`: first small miss with a clear correction.
- `STALLED_SAME_MODEL`: same signature twice with progress under 1 percentage point.
- `CONTRACT_OR_BINDING_MISS`: same measured cluster across two models or repeated SHA/output despite repair.
- `MODEL_FALLBACK_REQUIRED`: changed repair mechanism still fails.
- `QA_EXHAUSTED`: bounded route is exhausted.

Mark stalled immediately if distance worsens or candidate SHA repeats. Never send an unchanged repair prompt a third time.

If a previously passed gate regresses, preserve the best earlier candidate and repair from it rather than continuing from the worse frame.

## 5. Choose the repair mechanism

Use this deterministic router:

### A. Infrastructure or unknown create outcome

Poll the exact persisted provider job when its ID is known. Never duplicate automatically. When an unbound job lacks provider-attested media hashes, quarantine it; caller-supplied local hashes are not provider evidence.

### B. Already inside delivery band

PASS with the declared tolerance/epsilon fields. Do not pay to “improve” a passing frame.

### C. Mechanical repair without invented pixels

- Too-small subject with sufficient real surrounding pixels: deterministic crop, then QA.
- Pure x/y displacement with sufficient source pixels: deterministic translation/crop, then QA.

Record the transform. Do not use blurred padding or stretched imagery.

### D. One small prompt-guided repair

Use exactly one same-model VLM-guided repair only when:

- the first miss is no more than 2 percentage points from the delivery boundary;
- the previous output moved in the correct direction;
- no hard gate regressed.

Lock passed gates. State observed value, required interval/delta, and the only permitted change.

### E. Deterministic guide/input-authority repair

Use immediately for a large miss, repeated signature, worsening result, or insufficient progress. Build a mechanical guide with exact target bbox/scale/headroom/floor margin.

- GPT Image repair: base geometry canvas first, approved master next, failed frame next.
- Gemini/Nano repair: use the versioned model-specific manifest; do not assume undocumented ordinal weighting.
- Failed frame controls only already-valid continuity, not geometry or identity.

This is the root correction for repeated ~65% scale: change the mechanism and input authority, not the acceptance gate.

### F. Model fallback

If the guide attempt retains the same stalled signature, switch model while preserving target, guide SHA, locks, manifest semantics, and art direction.

### G. Terminal result

Return `QA_EXHAUSTED` with the best candidate, full defect history, and operator action. Never silently deliver a hard-gate failure.

## 6. Bound attempts

Read the active job schema before choosing a budget. Do not add attempts silently.

V1 example with a three-paid-attempt schema:

```text
1 primary generation
2 same-model VLM repair OR mechanical-guide repair, selected by the router
3 model fallback with the persisted repair package
```

Maximum two attempts per model and two prompt-only attempts per normalized defect signature. A fourth quality fallback requires an explicit contract/schema version migration.

Mechanical crop or QA recheck without provider generation does not consume a paid generation attempt. Polling an existing job is not a new attempt.

For expensive video, default to initial plus one materially changed repair/fallback. A manual retry creates one new cycle only when input, reference, contract, cut sheet, or repair mechanism changed.

## 7. Persist every attempt

Each attempt owns an immutable directory:

```text
attempts/NNN/
  request-manifest.json
  prompt.txt
  provider-receipt.json
  candidate.*
  qa-receipt.json
  mechanical-guide.*   # when used by this destination attempt
```

Bind any guide to:

- destination attempt;
- source attempt and candidate SHA;
- guide SHA;
- transform;
- target metrics;
- relative path.

Write atomically and verify after reopen. On restart, validate hashes and resume the next unresolved checkpoint. Never reconstruct evidence from prose.

Best candidate order:

```text
fewest failed hard gates
→ shortest numeric distance to delivery
→ highest QA score
→ newest attempt
```

## 8. Record weakened checks honestly

Declared preset tolerances and measurement epsilon are canonical policy, so they do not populate `weakened_checks`.

Record as weakened:

- runtime threshold expansion;
- gate changed to advisory/off;
- skipped QA;
- one-preset exception;
- acceptance based only on user preference despite a hard-gate failure.

Include old/new value, scope, approver, reason, and expiry. Without explicit operator approval, any non-empty `weakened_checks` blocks release.
