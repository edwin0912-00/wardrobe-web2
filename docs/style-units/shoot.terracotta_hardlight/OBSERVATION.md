# OBSERVATION LOG — shoot.terracotta_hardlight

Verdict: **BLOCKED_SOURCE**. Extraction-only audit; no missing facts are filled by inference.

## SOURCE INVENTORY AND PROVENANCE

- `frame-01` available for inspection:
  `assets/scene-mood-cards/shoot.terracotta_hardlight.webp`
  (`1024×1280`, SHA-256 `76fe58c9fbf4bcc6fa034ca1e0594ea0f8d80a40b96774f911bcaeb800f5fe81`).
- Its sidecar identifies it as an `OWNER_SUPPLIED_STYLE_FRAME`, cover-cropped to 4:5 and
  re-encoded with no generation or retouch.
- The sidecar records the unavailable owner source as `928×1232`, SHA-256
  `78738c995301c5a99de33a1a7e0a757665ce22c4fb321b61d42a6fffced7e127`.
- The original source bytes and any additional frames from the same shoot are not present in the
  workspace. Observations below are therefore limited to the provenance-bound cover crop.

## FRAME-LEVEL OBSERVATIONS

### Camera consequence, framing, focus, and foreground

The subject is seen from a back-three-quarter orientation while turning the head toward camera.
A light cloth crosses and billows through the foreground/right side, while moving hair breaks the
outline. The face is readable and the lower body is cropped away. The foreground cloth creates
layering and partial body occlusion.

The visible perspective is not conspicuously wide or distorted. Exact focal length, camera height,
subject distance, aperture, shutter, numerical roll, and focus distance are **UNKNOWN**. A crisp
captured cloth edge does not prove a particular shutter value.

### Pose and joint chain

Observable chain: torso rotated away; neck and head rotate back toward camera; shoulders are
partially concealed by the light cloth; hair and cloth are displaced in the captured instant.
Elbows, wrists, hands, pelvis, knees, ankles, support leg, and weight distribution are **UNKNOWN**.
The cause of motion—subject turn, thrown cloth, wind, assistant action, or a combination—is also
**UNKNOWN**.

### Environment, light, and materials

The background reads predominantly as very dark warm brown/charcoal with saturated orange
geometric bands or fields at the upper sides and lower area. Hard directional illumination and
graphic light/shadow separation are observable. Whether the orange geometry is projected light,
sunlight through an opening, a painted surface, a set panel, or post-production is **UNKNOWN**.

No floor, wall seam, door, vase, room plan, scale, compass direction, reverse angle, surface
chemistry, sound, smell, or exterior context is visible. “Terracotta plaster wall” is a possible
reading, not an observed material fact.

The light cloth is thin, soft, and displaced through the foreground; it belongs to the source
styling and does not authorize copying its exact design. Source skin, hair, eyes, face, and body are
not transferable style identity and are exempt from the style palette.

### Expression and grade

The head turns toward camera and the gaze appears near-direct/direct. The expression is intent and
unsmiling in the captured instant. A warm, high-contrast grade with saturated orange against deep
warm shadow is visible. Exact lighting ratio, source count, grade curve, grain, halation, bloom,
and environment-only closed hex palette are **UNKNOWN** from this derivative alone.

## RECONCILIATION

Only one captured turn is available. It can establish one combination of back-three-quarter body,
head return, hard graphic light, and cloth interference. It cannot establish six distinct poses,
repeatable camera positions, or a complete physical set. Graphic orange shapes remain described as
shapes rather than promoted to plaster, architecture, or sunlight.

## SEVEN-SHEET VISUAL AUDIT

| Sheet | Result | Evidence |
| --- | --- | --- |
| camera_lens | FAIL | Adds exact camera placement and set elements such as floor, wall, door, and vase not visible in `frame-01`. |
| blocking | FAIL | Invents symmetric raised arms, hand positions, feet, and weight distribution hidden by cloth/crop. |
| expression_gaze | FAIL | Near-direct gaze is useful, but the board embeds a generated identity and facial specificity beyond the source. |
| garment_behaviour | FAIL | Cloth displacement is observed; the asserted subject-turn/throw cause and timing are not. |
| colour_grade | FAIL | Mixes source skin and source cloth into the style palette, is internally vague about palette count, and lacks a source-only environment basis for several roles. |
| environment | FAIL | Fabricates a scaled plan, floor, plaster texture, reverse angle, traffic, sound, smell, and other off-frame context. |
| person | FAIL | Prefills a face and speculative age, lifestyle, anatomy, and skin information instead of a blank approved-subject template. |

All seven PNGs were visually inspected at full available resolution. Matching files and manifest
hashes do not cure these extraction failures.

## CANONICAL SHOT-COVERAGE GATE

| Canonical slot | Distinct source-frame support |
| --- | --- |
| clean_identity_hero | NONE |
| environmental_hero | NONE |
| sculptural_three_quarter | NONE |
| interference_frame | No separately labelled source; `frame-01` contains cloth interference but supplies only this one composition. |
| material_or_accessory_detail | NONE |
| wide_campaign_coda | NONE |

Assigning the observed turn to a named slot would be a production decision, not a source fact. Six
unique `shot_directions` with camera consequence, joint chain, focus, foreground, and provenance
cannot be written honestly. `runtime_style` is intentionally withheld. Regeneration must not start
until original same-shoot frames provide distinct, source-traceable coverage.

