# OBSERVATION LOG — shoot.sky_dune_surreal

## AUDIT RESULT

`BLOCKED_SOURCE`.

One authentic owner-supplied derivative is available and was inspected, but it is
only one 4:5 frame. It cannot support the requested five unique shoot frames or
the six canonical runtime slots without inventing unseen poses, angles and
foreground applications. No `runtime_style` is written and no regeneration is
authorised.

## SOURCE LEDGER

### assets/scene-mood-cards/shoot.sky_dune_surreal.webp

- Inspected visually at its native delivery size, 1024x1280.
- Delivery sha256:
  `415d09e80eb31b4238b17001e85f57ef28a1cb1f3bf236b1e6a050a368cc0385`.
- `assets/scene-mood-cards/shoot.sky_dune_surreal.json` records
  `origin.kind: OWNER_SUPPLIED_STYLE_FRAME`.
- The sidecar says the asset is a cover crop and re-encode only, with no
  generation and no retouch, from a 1968x2464 source whose sha256 is
  `bc8331019e3e8a1de6043124e32f967c7eaae99e487bae50eda26cd83269bcaf`.
- The original 1968x2464 bytes and any neighbouring frames from the same shoot
  are not available on this host.

## FRAME-LEVEL OBSERVATION

### Composition and camera consequences

Portrait 4:5. One full-length standing person occupies most of the frame, with
both oversized shoes fully visible and only modest headroom. The person is near
centre but not geometrically dead-frontal: shoulders, head and facial plane carry
a slight three-quarter turn. The feet are close rather than shoulder-width apart.
No architecture supplies reliable vanishing lines. Body proportions do not show
obvious wide-angle limb enlargement, but focal length, physical camera height,
aperture and shutter remain `UNKNOWN`.

The sand ridge crosses the lower quarter of the frame. The figure, the ground at
the feet and the cloud forms are all legible. There is no object between the lens
and the person. Whether the apparent depth comes from capture, compositing or a
built backdrop is `UNKNOWN`.

### Pose joint chain

Upright, near-static stance. Hips and shoulders are quiet. Arms hang beside the
torso; one hand holds a large woven flower basket at thigh-to-knee height and the
other hangs open. Feet sit close with a small fore/aft offset. The head is held
upright with a slight pan rather than neutral dead-frontal alignment. Exact weight
distribution is not recoverable from the single view.

### Expression and gaze

Opaque dark lenses and knitted headwear hide eyes, eyelids and brows. Do not
infer them. The mouth is closed or almost closed, corners quiet, jaw relaxed.
The readable affect is reserved and deadpan. Exact eye direction is `UNKNOWN`;
only the slightly turned head plane is observed.

### Environment and materials

A clean blue-grey sky fills most of the frame. Discrete white cumulus clouds sit
behind the figure. A low, simple sand ridge with fine surface texture forms the
ground. No mountains, vegetation, buildings, road, reverse angle or distant
landscape are visible.

Observed surface classes include plush piled fleece, crisp woven cargo cloth,
coarse knit headwear and socks, opaque hard eyewear, plush oversized footwear, a
woven basket and densely packed fresh flowers. These are material behaviours,
not transferable garment design, brand or colourway.

### Light, contrast and skin response

The frame is directionally lit. Cast shadows on the sand and compact shadows
under clothing, eyewear and the basket have readable edges; the source does not
support the old claim “low contrast, no hard edge anywhere.” The visible skin
retains deep value and warm saturation, with compact highlights on lips and
forward facial planes and deeper shadow under the headwear. Exact sun elevation
and whether the lighting belongs to one physical capture remain `UNKNOWN`.

### Colour

The dominant environment is blue-grey sky, white cloud and warm sand. Cream
clothing and deep skin provide large value anchors. The frame also contains a
clearly vivid rainbow motif and a multicolour flower basket with saturated reds,
oranges, yellows, greens, blues and violets. Therefore the existing seven-colour
board statement “nothing in the frame is allowed to be vivid” is contradicted by
the inspected source. Skin is also listed as a palette member while the sheet
simultaneously calls skin exempt. The current closed palette is not reconciled.

### Optical signature

Clean and graphic. No visible flare, halation, bloom or strong vignette. Edges
are crisp without swirl or radial distortion. Fine texture is present, but the
single re-encoded derivative cannot prove a particular grain recipe. The only
safe fixed signature is the absence of flare, bloom, halation, vignette and
swirl.

## VISUAL AUDIT OF EXISTING SHEETS

All seven canonical sheets were opened and inspected at native resolution.

- `sheet-camera_lens.png` — `FAIL`: declares chest height, dead-frontal
  alignment, low knee-height horizon and generous headroom; those claims are not
  all supported by the frame.
- `sheet-blocking.png` — `FAIL`: feet apart, even weight, neutral head pan,
  unidentified object and veiled soft light contradict visible evidence.
- `sheet-expression_gaze.png` — `FAIL`: correctly preserves occluded eyes, but
  uses an unrelated light-skinned face and asserts neutral dead-frontal head
  orientation.
- `sheet-garment_behaviour.png` — `FAIL`: the plush pile behaviour is useful,
  but the board generalises it to the whole wardrobe and omits the visibly
  different woven, knitted, basket and flower materials.
- `sheet-colour_grade.png` — `FAIL`: its pastel-only/no-vivid rule is directly
  contradicted by the rainbow and flower basket; its low-contrast claim is not
  reconciled to the directional source.
- `sheet-environment.png` — `FAIL`: invents a plan, reverse angle, dune forms,
  scale, direction, sound and smell not present in the source.
- `sheet-person.png` — `FAIL`: depicts and annotates a different identity and
  skin response instead of leaving unobserved identity geometry unknown.

`sheet-environment-v2.png` is an eighth, non-canonical artifact and also fails:
it invents a 20-degree sun, compass direction, 50-metre scale, mountains, a shoe
close-up and terrain that are not visible in the source.

The rendered `palette-strip.svg` was inspected. Its declared hex swatches render,
but long role labels overlap and the palette itself is semantically unreconciled
to the vivid source elements.

## COVERAGE BLOCKER

The available source demonstrates one full-length hero only. It does not show a
clean identity close view, a distinct environmental hero, a separate sculptural
three-quarter, an optical-interference application, a material/accessory detail
or a wide campaign coda. Reusing this one composition six times would violate
the unique-frame requirement. Restore at least the neighbouring source/contact
frames from this shoot, then repeat observation before writing `runtime_style`
or generating any sheet.
