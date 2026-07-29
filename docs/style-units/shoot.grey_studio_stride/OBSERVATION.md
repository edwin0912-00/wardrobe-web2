# OBSERVATION LOG — shoot.grey_studio_stride

Verdict: **BLOCKED_SOURCE**. Extraction-only audit; no missing facts are filled by inference.

## SOURCE INVENTORY AND PROVENANCE

- `frame-01` available for inspection: `assets/scene-mood-cards/shoot.grey_studio_stride.webp`
  (`1024×1280`, SHA-256 `ad430351be38c72291ac2f9df721ce67d46ca9cc19828de9bf64362e09a6820f`).
- Its sidecar identifies it as an `OWNER_SUPPLIED_STYLE_FRAME`, cover-cropped to 4:5 and
  re-encoded with no generation or retouch.
- The sidecar records the unavailable owner source as `1968×2464`, SHA-256
  `dc75b31d1dca85cec9f54807d6f014a387c243b37e6f459e38c1f9b88967ed8d`.
- The original source bytes and any additional frames from the same shoot are not present in the
  workspace. Observations below are therefore limited to the provenance-bound cover crop.

## FRAME-LEVEL OBSERVATIONS

### Camera consequence, framing, focus, and foreground

The subject is full length and seen in profile/near-profile, moving toward frame right. Body
proportions are not conspicuously stretched. The grey background, dark floor, footwear, and a band
of dried reeds along the backdrop base are visible. The reeds sit behind the subject; they do not
visibly cross or hide the feet. There is no observed foreground occluder.

Subject and garments read crisp in the captured stride. This proves a crisp result, not a numerical
shutter value. Exact focal length, camera height, subject distance, aperture, shutter, focus
distance, grain source, and numerical roll are **UNKNOWN**.

### Pose and joint chain

Observable chain: head lowered with gaze down; torso close to side-on; arms carry a small flat
object/clutch near the body; one leg advances while the other trails in a captured stride; heels
remain inside frame. Exact foot phase, which heel bears weight at the instant, pelvis rotation,
elbow angles behind the carried object, and a repeatable walking cadence are **UNKNOWN**.

### Environment, light, and materials

A smooth mid-grey background with a soft value gradient, a near-black matte/granular-looking floor,
and dry tan reeds along the base are visible. The backdrop construction, true width, seam position,
floor coating, floor reflectance, reed depth, studio dimensions, and reverse angle are **UNKNOWN**.

Lighting is directional from image/camera-left and models the subject with meaningful light-shadow
separation. The source does not support “broad frontal low contrast” as a fixed description.
Number, size, height, distance, and type of lights are **UNKNOWN**.

The source outfit contains an ivory voluminous upper garment and patterned wide lower garment.
The upper material holds broad volume and folds; the lower material moves with the stride. Exact
design, print family, item colours, and accessories do not transfer. Source skin, hair, eyes, face,
and body are not transferable style identity and are exempt from the palette.

### Expression and grade

The face is closer to three-quarter profile than a perfectly flat profile. The gaze is down and the
expression is neutral/contained in this instant. One frame cannot justify a rule of “no eye contact
ever.” The overall grade is restrained and studio-neutral, with warm dry reeds and a dark floor.
Exact colour curve, grain, halation, bloom, contrast ratio, and environment-only closed hex palette
are **UNKNOWN**.

## RECONCILIATION

Only one stride instant is available. It supports one full-length movement frame but not a
six-direction series, five additional joint chains, alternate camera positions, or proof that
camera and optical consequences stay fixed. Reeds remain a background-base element and are not
promoted to foreground interference.

## SEVEN-SHEET VISUAL AUDIT

| Sheet | Result | Evidence |
| --- | --- | --- |
| camera_lens | FAIL | Places reeds in foreground occlusion and adds camera height, depth-of-field, and grain prescriptions not proven by `frame-01`. |
| blocking | FAIL | Useful stride geometry is mixed with an unsupported broad-frontal/low-contrast light claim and uncertain exact foot phase. |
| expression_gaze | FAIL | Treats the view as full profile and one downward glance as a permanent “no eye contact” series rule. |
| garment_behaviour | FAIL | Refers to a source print family and asserts a fast shutter, leaking design and inventing equipment metadata. |
| colour_grade | FAIL | Includes reference garment ivory/khaki and source-model skin as transferable palette entries instead of exemptions. |
| environment | FAIL | Fabricates plan scale, north, a separate backdrop light, reverse angle, floor reflectance, sound, and smell; its broad-soft low-contrast light contradicts the visible modelling. |
| person | FAIL | Prefills a specific face and skin palette and even lists “plausible” unobserved skin traits instead of a blank approved-subject template. |

All seven PNGs were visually inspected at full available resolution. Matching files and manifest
hashes do not cure these extraction failures.

## CANONICAL SHOT-COVERAGE GATE

| Canonical slot | Distinct source-frame support |
| --- | --- |
| clean_identity_hero | NONE |
| environmental_hero | NONE |
| sculptural_three_quarter | NONE |
| interference_frame | NONE |
| material_or_accessory_detail | NONE |
| wide_campaign_coda | No separately labelled source; `frame-01` contains one full-length stride only. |

Assigning the observed stride to a slot would be a production decision, not a source fact. Six
unique `shot_directions` with camera consequence, joint chain, focus, foreground, and provenance
cannot be written honestly. `runtime_style` is intentionally withheld. Regeneration must not start
until original same-shoot frames provide distinct, source-traceable coverage.

