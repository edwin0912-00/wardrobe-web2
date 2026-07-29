# OBSERVATION LOG — shoot.skylight_haze

Verdict: **BLOCKED_SOURCE**. Extraction-only audit; no missing facts are filled by inference.

## SOURCE INVENTORY AND PROVENANCE

- `frame-01` available for inspection: `assets/scene-mood-cards/shoot.skylight_haze.webp`
  (`1024×1280`, SHA-256 `c9fc3bc9bf66494dd72cd906bda0761f38feb3da5ca8db68bf2a7b9b8eb0baf8`).
- Its sidecar identifies it as an `OWNER_SUPPLIED_STYLE_FRAME`, cover-cropped to 4:5 and
  re-encoded with no generation or retouch.
- The sidecar records the unavailable owner source as `928×1232`, SHA-256
  `381de785933225b0b977b218e542d53e500c6f6c063f95d87f01d1cff154d97c`.
- The original source bytes and any additional frames from the same shoot are not present in the
  workspace. Observations below are therefore limited to the provenance-bound cover crop.

## FRAME-LEVEL OBSERVATIONS

### Camera consequence, framing, focus, and foreground

The delivered frame is a very low-angle portrait crop. The face and upper torso are seen from
below; raised arms create diagonals above and beside the head. A near hand/forearm mass is strongly
defocused in the left foreground, while the other raised arm/sleeve occupies the right side. The
face/upper torso read sharper than the near hand and the washed background.

The consequence of a low camera and a very near foreground limb is observable. Focal length,
camera height, aperture, shutter, subject distance, numerical roll, and exact focus distance are
**UNKNOWN**. There is no trustworthy horizon or architectural vertical from which to measure roll.

### Pose and joint chain

Observable chain: torso faces generally toward camera; both shoulder chains travel upward into
raised arms; one near wrist/hand crosses the foreground depth plane. Exact elbow angles, whether
the hands meet, finger placement, lower-body position, support leg, and weight distribution are
**UNKNOWN** because of crop, blur, and occlusion.

### Environment, light, and materials

The background is a pale, bright, veiled field with soft diagonal forms. No roof grid, mullion,
wall junction, floor, foliage bed, room dimensions, material seam, or reverse angle is legible.
Calling the location a conservatory, atrium, greenhouse, or glass-roof room is not supported by
this crop.

Warm backlight wraps the silhouette and produces a strong veil/bloom-like wash. Edge glow and a
warm flare-like haze are visible in this frame. The physical light source, number of sources, haze
material, time of day, and whether the wash is optical, atmospheric, or post-produced are
**UNKNOWN**. Repeatability of this optical signature across a shoot cannot be established from one
frame.

The source garment appears dark, patterned/floral, light-transmitting in places, and soft enough to
fold around the raised arms. Its design, print colours, and the source person's skin, hair, eyes,
face, and body are reference inputs, not transferable style identity and not palette authority.

### Expression and grade

The face is calm and held rather than smiling; exact eye target and mouth state are partly obscured
by haze, crop resolution, and the viewing angle. A warm, pale, lifted presentation is observable,
with bright highlights allowed to wash out. Exact grading curve, grain, halation radius, channel
split, and a closed set of environment-only hex colours are **UNKNOWN**.

## RECONCILIATION

There is only one observed composition. It supports one low-angle, raised-arm, foreground-occluded
moment; it does not demonstrate a repeatable six-frame camera system, five additional poses, a
complete environment, or a fixed optical treatment across a series. Apparent diagonal background
forms are kept ambiguous rather than promoted to architecture.

## SEVEN-SHEET VISUAL AUDIT

| Sheet | Result | Evidence |
| --- | --- | --- |
| camera_lens | FAIL | Prints measurable roll, structural convergence, and focus instructions not recoverable from `frame-01`. |
| blocking | FAIL | Converts the partial raised-arm chain into symmetric hands meeting above the crown and adds unsupported body geometry. |
| expression_gaze | FAIL | A generated identity grid and exact facial prescriptions exceed what the veiled single face proves. |
| garment_behaviour | FAIL | Useful soft/transmitting behavior is mixed with an unsupported causal claim about subject-driven settling and timing. |
| colour_grade | FAIL | Prints invented version/date metadata and assigns colours to unverified interior, foliage, source garment, and source skin roles. |
| environment | FAIL | Fabricates a conservatory/atrium plan, glass structure, concrete, foliage, reverse angle, sound, and smell. |
| person | FAIL | Prefills a specific face, body, and skin instead of remaining a blank template for the approved product subject. |

All seven PNGs were visually inspected at full available resolution. Matching files and manifest
hashes do not cure these extraction failures.

## CANONICAL SHOT-COVERAGE GATE

| Canonical slot | Distinct source-frame support |
| --- | --- |
| clean_identity_hero | NONE |
| environmental_hero | NONE |
| sculptural_three_quarter | NONE |
| interference_frame | No separately labelled source; `frame-01` contains a foreground limb but supplies only this one composition. |
| material_or_accessory_detail | NONE |
| wide_campaign_coda | NONE |

Assigning the one observed composition to a slot would be a production decision, not a source
observation. Six unique `shot_directions` with camera consequence, joint chain, focus, foreground,
and provenance therefore cannot be written honestly. `runtime_style` is intentionally withheld.
Regeneration must not start until original same-shoot frames provide distinct, source-traceable
coverage.

