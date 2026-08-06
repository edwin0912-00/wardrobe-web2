# Video model reference contracts

## Contents

1. Authority split
2. Seedance namespaces and bindings
3. Inputs and cut sheet
4. Reference-performer isolation
5. Pre-generation compiler and post-generation verifier
6. Repair and audio
7. Persistence and recovery

## 1. Authority split

Keep these authorities separate:

1. `approved_white_master`: visible person, body, hair, and complete approved outfit.
2. `identity_face`: face and hair detail only.
3. `garment_detail`: exact visible item construction and appearance only.
4. `motion_reference`: cuts, timing, action, pose, camera, environment, light, grade, and transitions.
5. `creative_universe`: only the declared visual/style dimensions.
6. Prompt: explains bindings; it cannot override immutable locks.

Refuse preflight when references conflict. Never ask the model to decide which person, garment, or background wins.

## 2. Seedance namespaces and bindings

Seedance/Higgsfield uses independent video, image, and audio namespaces. Compile labels from the exact outbound arrays:

```text
@Video 1  motion_reference

@Image 1  approved_white_master
@Image 2  optional identity_face
@Image 3  optional garment_detail when identity_face exists

@Audio 1  optional locked reference audio
```

If `identity_face` is absent, `garment_detail` becomes `@Image 2`. Never hardcode the label independently from the array.

The directing video remains provider input. It is not delivery media. `@Video 1` and `@Image 1` do not share one global index.

Official references:

- https://seed.bytedance.com/en/blog/seedance-2-0-official-launch
- https://higgsfield.ai/blog/generating-with-seedance-2-0

Do not combine reference-bound multi-cut mode with `start_image`/`end_image` unless the discovered provider contract explicitly supports that topology. Treat start/end interpolation as a separate operation contract.

## 3. Inputs and cut sheet

Required:

- original style video as private `motion_reference`;
- exact approved master-look with verified white background;
- complete identity/outfit receipt and SHA binding.

Optional:

- `identity_face` only after background cleaning, hash verification, and white-background QA;
- `garment_detail` only as a verified evidence card;
- Creative Universe sheets or a versioned deterministic atlas.

Never send the raw user portrait with its original background as an appearance reference.

Analyze the reference before provider spend. Persist a contiguous cut sheet. Each cut records:

```text
start_ms / end_ms
transition
person_present
action and pose
camera movement
framing and lens
environment
lighting and grade
props and environmental text
replacement rule
negative constraints
```

The cut sheet must cover the accepted reference duration without gaps or overlaps. Compile each interval into the provider prompt. One global prose paragraph is not a substitute.

If a person is visible in a cut, render only the approved person. If no person is visible, add no person.

## 4. Reference-performer isolation

Forbid every delivery path by which reference pixels may survive:

- direct source frames or freeze frames;
- picture-in-picture;
- monitors, reflections, posters, or background people;
- motion-blurred face/body/hair/clothes/silhouette;
- unregenerated transition frames;
- mixed source and approved performer.

The output must be newly generated. The reference video controls direction, not pixels licensed for delivery.

## 5. Pre-generation compiler and post-generation verifier

Pre-generation compiler:

- extracts cut/timecode facts;
- assigns reference authorities;
- builds dynamic `@Video/@Image/@Audio` bindings;
- compiles exact person-replacement and negative rules per cut;
- validates limits and hashes before spend.

Post-generation QA remains mandatory, but acts only as verifier:

- sample start, middle, end, and every cut boundary;
- verify cut coverage and timing;
- verify identity and complete outfit on every subject cut;
- detect reference-performer pixels or fragments;
- verify camera, pose, environment, light, grade, and transitions against the immutable cut contract;
- persist per-cut measurements and verdicts.

QA after generation does not invent a new art direction. It proves whether the output followed the already-compiled contract.

## 6. Repair and audio

If one cut fails:

- keep only independently generated PASS spans;
- regenerate the failing span when the provider and immutable EDL support safe partial repair;
- rebuild from the EDL;
- never fill a failed span with source-reference footage.

If safe local repair is unsupported, rerun the whole clip once with materially changed cut-specific constraints or a fallback model. Do not rerun unchanged prose.

Provider audio is not a semantic video failure:

1. demux and discard provider audio;
2. after visual QA, mux hash-locked permitted reference audio, or deliver silent video;
3. persist source audio SHA, operations, and final audio SHA.

## 7. Persistence and recovery

Persist `SUBMITTING` and the full immutable request binding before create. Persist provider job ID immediately after acceptance. Browser/UI timeout never means provider failure.

On restart:

- resume polling a persisted provider job ID;
- rehash locked local inputs and output;
- never issue an automatic duplicate for an unknown create outcome;
- never attach an unbound job based only on matching prompt/aspect/duration;
- require provider-attested input media binding before recovering an ambiguous paid job;
- quarantine when the provider envelope cannot prove the media hashes.

Deliver only after download, rehash, technical QA, semantic QA, persistence, and successful reopen.

Persist in every receipt:

- canonical and provider model IDs;
- job/job-set ID;
- every ordered reference with namespace, label, role, SHA, MIME, and authority;
- capability snapshot;
- prompt/cut-sheet/style-manifest hashes;
- provider output and final output hashes;
- EDL/post-processing/audio operations;
- per-cut QA;
- retry lineage and final verdict.

Hard blockers are never advisory: wrong master SHA, unclean identity background, incomplete outfit, reference-performer leakage, source video delivered as output, contradictory route, or invalid cut coverage.
