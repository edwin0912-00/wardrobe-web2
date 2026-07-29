# OBSERVATION LOG — shoot.window_gobo_warm

Verdict: **BLOCKED_SOURCE**. Extraction-only audit; no missing facts are filled by inference.

## SOURCE INVENTORY AND PROVENANCE

- `frame-01` available for inspection: `assets/scene-mood-cards/shoot.window_gobo_warm.webp`
  (`1024×1280`, SHA-256 `6e95433cf70ab2c81f35308ad7cbc429669ddfcdd35ab7ca8b60abb1f3b0aa88`).
- Its sidecar identifies it as an `OWNER_SUPPLIED_STYLE_FRAME`, cover-cropped to 4:5 and
  re-encoded with no generation or retouch.
- The sidecar records the unavailable owner source as `928×1232`, SHA-256
  `c305ccae7abb38bd9562e189a6ba7728bc29898c47551b4f66c1781c68eefe97`.
- The original source bytes and any additional frames from the same shoot are not present in the
  workspace. Observations below are therefore limited to the provenance-bound cover crop.

## FRAME-LEVEL OBSERVATIONS

### Camera consequence, framing, focus, and foreground

The portrait is framed from head to roughly upper/mid thigh. The torso is in a three-quarter
stance, the subject is close to a warm neutral wall, and a large rectilinear light/shadow pattern
occupies the wall. Perspective looks moderate and does not show obvious wide-angle stretching.
There is no separate foreground object crossing the subject.

The subject reads sharper than the largely textureless wall. Exact focal length, camera height,
aperture, shutter, subject-wall distance, focus distance, numerical roll, and depth-of-field
settings are **UNKNOWN**.

### Pose and joint chain

Observable chain: torso turned about three-quarter to camera; head returns toward camera; one
shoulder-elbow-wrist chain terminates with a hand at the hip; the opposite hand is also held at or
near the waist/hip region rather than hanging plumb. The crop hides feet and most lower-leg
geometry. Support leg, pelvis shift, precise hand anatomy, and weight distribution are **UNKNOWN**.

### Environment, light, and materials

One warm cream/greige wall plane and a broad rectangular grid-like light/shadow pattern are visible.
The pattern has relatively soft transitions in parts but the light remains directional and
sculpting on the subject. It is reasonable to call the visible result a window/gobo pattern; it is
not possible to tell whether the source is an actual window, a cutter/gobo, sunlight, a lamp, or
post-production.

No floor, ceiling, wall material, room plan, scale, compass direction, reverse angle, time of day,
sound, or smell is visible. Those remain **UNKNOWN**.

The dark gathered/sheering source garment shows folds and some light transmission. Its exact
design and colour do not transfer. Source skin, hair, eyes, face, body, piercings, and marks are not
style identity and are exempt from the style palette.

### Expression and grade

The gaze is direct or near-direct. Brows and jaw are controlled; the mouth appears slightly parted
rather than demonstrably closed. The image is warm and contrasty, with a neutral-warm wall and
dark subject mass. Optics look comparatively clean; strong flare is not visible. Exact bloom,
halation, grain, grading curve, lighting ratio, and a closed environment-only hex palette are
**UNKNOWN** from this single derivative.

## RECONCILIATION

The one frame supports one three-quarter, hands-at-waist pose against one patterned wall. It does
not establish five additional joint chains, alternate camera consequences, a reverse angle, or
whether a clean optical treatment remains fixed throughout the shoot. The off-frame room and the
physical source of the pattern remain unclaimed.

## SEVEN-SHEET VISUAL AUDIT

| Sheet | Result | Evidence |
| --- | --- | --- |
| camera_lens | FAIL | Converts moderate perspective into exact camera/DOF/optical prescriptions that `frame-01` cannot supply. |
| blocking | FAIL | Says the far arm hangs plumb and assigns a support side although the visible far hand is near the waist and the feet are cropped. |
| expression_gaze | FAIL | Prints a closed-mouth rule contradicted by the slightly parted mouth and embeds a generated identity. |
| garment_behaviour | FAIL | The fold/transmission notes are useful, but one source frame cannot establish repeatable behavior across six directed shots. |
| colour_grade | FAIL | Treats reference garment black and source skin as transferable palette entries despite their explicit exemptions. |
| environment | FAIL | Fabricates a scaled room plan, floor, plaster material, reverse angle, time of day, sound, and smell. |
| person | FAIL | Prefills anatomy, eye colour, piercings, marks, and skin tone instead of remaining a blank approved-subject template. |

All seven PNGs were visually inspected at full available resolution. Matching files and manifest
hashes do not cure these extraction failures.

## CANONICAL SHOT-COVERAGE GATE

| Canonical slot | Distinct source-frame support |
| --- | --- |
| clean_identity_hero | NONE |
| environmental_hero | No separately labelled source; `frame-01` shows one wall-pattern composition only. |
| sculptural_three_quarter | NONE |
| interference_frame | NONE |
| material_or_accessory_detail | NONE |
| wide_campaign_coda | NONE |

Assigning the observed wall portrait to a slot would be a production decision, not a source fact.
Six unique `shot_directions` with camera consequence, joint chain, focus, foreground, and provenance
cannot be written honestly. `runtime_style` is intentionally withheld. Regeneration must not start
until original same-shoot frames provide distinct, source-traceable coverage.

