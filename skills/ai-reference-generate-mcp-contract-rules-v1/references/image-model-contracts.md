# Image model reference contracts

## Contents

1. Identity and alias boundaries
2. Semantic reference roles
3. Model-aware order
4. Prompt compilation
5. Capabilities and budgets
6. Immutable receipts
7. Failure patterns

## 1. Identity and alias boundaries

Persist stable internal IDs. Translate aliases only in the provider adapter.

Current Zeely mapping is an implementation example, not a universal naming standard:

| Product label | Stable internal ID | Higgsfield CLI ID |
|---|---|---|
| GPT Image 2 | `gpt_image_2` | `gpt_image_2` |
| Nano Banana 2 / fast | `nano_banana_flash` | `nano_banana_flash` |
| Nano Banana Pro | `nano_banana_2` | `nano_banana_pro` |

Rules:

- Never rewrite historic jobs, receipts, hashes, or schemas merely because a provider alias changed.
- Normalize provider `job_type` and `job_set_type` back to the requested internal ID before persistence.
- Accept multiple provider model fields only when all present values normalize to the same requested route.
- Reject unknown or contradictory model fields before accepting output.
- Do not use a provider implementation-detail field such as `params.model` as the route authority unless its contract explicitly says so.
- Record internal ID, provider ID, provider version, and capability-snapshot hash separately.

## 2. Semantic reference roles

Use stable semantic roles. Each role declares allowed and forbidden influence.

| Role | May control | Must not control |
|---|---|---|
| `approved_master` | person, body, hair, locked outfit | scene, camera, framing unless explicitly chosen as base canvas |
| `geometry_guide` | canvas, bbox, scale, placement, headroom, floor margin | identity, garments, scene content, lighting |
| `failed_candidate` | already-valid scene content, light, grade, repair evidence | identity, garments, geometry when a guide exists |
| `item_reference` | visible construction, colour, material, pattern, hardware, logo/text | identity, body, scene, pose |
| `identity_face` | face and hair | clothes, body, scene; require a hash-verified clean background derivative |
| `environment_reference` | location, architecture, environmental light | person, clothes, body |
| `style_sheet` | its declared style dimension only | all other dimensions |

Refuse preflight when two references claim authority over the same locked dimension without an explicit precedence rule.

## 3. Model-aware order

The physical byte array is authoritative. Compile labels from it.

### GPT Image 2

Initial generation without a mechanical canvas:

```text
Image 1  approved_master
Image 2+ item_reference / environment / style by declared budget
```

Geometry repair when the guide is an actual edit canvas made from locked pixels:

```text
Image 1  geometry_guide       base edit canvas
Image 2  approved_master      identity and complete-look authority
Image 3  failed_candidate     continuity evidence only, when present
Image 4+ item_reference       forensic item authority
then     environment/style    deterministic priority order
```

OpenAI documents multi-image editing and recommends describing what comes from each input. Do not assume hidden weighting beyond documented behavior. If a mask is used, it applies to the first input image. The current Higgsfield GPT Image 2 capability exposes ordered image references, quality, and aspect ratio; do not send `input_fidelity` unless the discovered provider schema exposes it.

Official references:

- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide

### Gemini / Nano Banana routes

Google documents multi-image role addressing but does not promise a hidden first/second/third attention hierarchy. Use explicit roles and version any empirical order change.

Current stable scene contract:

```text
Image 1  approved_master
Image 2  geometry_guide, when present
Image 3  failed_candidate, when present after the guide
Image 4+ item_reference
then     environment/style by deterministic priority and model budget
```

Never allow a provider adapter to accept GPT-only guide-first order on a Gemini route merely because the higher-level compiler normally avoids it. Enforce the invariant again at the transport boundary.

Official reference:

- https://ai.google.dev/gemini-api/docs/image-generation

## 4. Prompt compilation

Generate role sentences from the final ordered manifest:

```text
Image 1 is GEOMETRY ONLY. Preserve its exact canvas and subject placement.
Image 2 is the APPROVED PERSON AND COMPLETE LOOK. Preserve identity and items.
Image 3 is the FAILED CANDIDATE. Reuse only valid scene/light continuity; ignore its framing.
Image 4 is ITEM DETAIL ONLY. Preserve visible construction, colour, logo and text.
```

Rules:

- Never hardcode an ordinal in a separate service.
- If an optional input is absent, renumber all later inputs from the actual array.
- State `LOCK`, `REPLACE`, and `IGNORE` dimensions explicitly.
- Include measured repair facts: observed value, target, delivery band, required direction/delta, and available canvas margin.
- Put aspect ratio, size, quality, and supported geometry controls in provider parameters, not only prose.
- A mechanical guide must encode measurable pixels/geometry; prose saying “make the subject smaller” is not a guide.

## 5. Capabilities and budgets

Before enabling a route, query the installed transport without spending credits, for example:

```bash
higgsfield model get gpt_image_2 --json
higgsfield model get nano_banana_flash --json
higgsfield model get nano_banana_pro --json
```

Snapshot:

- provider/CLI version;
- exact model ID;
- accepted parameters;
- image count and aggregate reference limits;
- accepted MIME/size/aspect values;
- response envelope fields;
- discovery timestamp and raw schema hash.

Do not copy one model's maximum reference count to all models. When mandatory references exceed the model budget, fail before spend or build a versioned deterministic atlas. Never silently drop a locked reference.

## 6. Immutable manifest and receipts

Persist before provider spend:

```json
{
  "manifest_version": "image-reference-manifest-vN",
  "internal_model_id": "nano_banana_2",
  "provider_model_id": "nano_banana_pro",
  "references": [
    {
      "namespace": "image",
      "order": 1,
      "provider_label": "Image 1",
      "semantic_role": "approved_master",
      "sha256": "...",
      "allows": ["identity", "locked_outfit"],
      "forbids": ["environment"]
    }
  ],
  "prompt_sha256": "...",
  "request_config": {"aspect_ratio": "3:4"},
  "attempt_id": "...",
  "parent_attempt_id": null
}
```

Completion receipt also binds:

- provider job ID and normalized returned model;
- output SHA-256 and technical media facts;
- QA measurements, gates, and verdict;
- exact repair-guide SHA/path/source attempt/transform;
- fallback reason and attempt lineage;
- dropped optional roles, if any.

Write every attempt under its own immutable directory. Never overwrite a candidate. A guide belongs to the destination attempt and must remain referenced by that attempt's receipt after restart.

## 7. Failure patterns

- Provider alias used as the historic internal ID or vice versa.
- Valid completed output rejected because alias normalization is incomplete.
- Prompt ordinal differs from physical media order.
- Failed candidate precedes the geometry authority and dominates scale.
- Raw identity photo leaks its original background.
- Aspect ratio appears only in prompt text.
- New receipt fields disappear through a metadata allowlist.
- Same prompt is paid for repeatedly despite a stable defect signature.
- Guide is written to another attempt directory or omitted from its receipt.
- Blur/stretch/padding disguises an invalid delivery.
- A pre-existing passing test is misreported as proof of a new repair.
