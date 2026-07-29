# OBSERVATION LOG — shoot.ochre_stage_tailoring

Two local source files were opened at original resolution before reviewing any sheet. Both are
extraction-only. Reference identity, garment design, logos and item colours do not transfer.

## Frame `male-02-chair-taupe.png`

Source receipt: 928×1232 RGB PNG; SHA-256
`50db8be51b4c538cb7f6f9b7d7433c3bef01eb95094f7fbe7f30359c7f93a65b`.

### Observable

- Environment: one close, plain warm-brown wall; a wooden bentwood chair; bright rounded
  rectangular light bands enter along the far frame-left edge. No floor-to-wall junction is visible.
- Camera consequence: low seated viewpoint aimed upward. The two near knees occupy much more frame
  area than the head; the legs and chair run out of the bottom edge. Roll appears level, but the wall
  supplies no reliable horizon.
- Focus: face, torso, hands and near knees are readable; the plain wall has no detail from which an
  exact focus falloff can be measured.
- Foreground: no separate object crosses the lens. The subject's knees form the near plane.
- Light: one hard warm source enters from frame-left and creates high-contrast patches across face,
  sleeves, hands and trousers. The bright wall bands have softened edges compared with the subject's
  smaller shadow transitions.
- Expression: gaze is withheld downward behind round dark lenses; brows appear at rest; mouth is
  closed; jaw appears relaxed. Head pans slightly away and tilts toward one shoulder, chin lowered.
- Pose joint chain: pelvis seated; thighs abducted to either side; both knees flexed; one hand rests
  over the curved chair back while the opposite forearm crosses the lap; shoulders lowered; torso
  leans slightly toward the chair hand.
- Garment behaviour: no air movement. Broad lower folds hang heavy and plumb over the knees; the
  upper layer forms smaller soft wrinkles at elbows and waist. These behaviours may transfer; the
  visible cut, pattern and colour may not.
- Optical evidence: warm, high-contrast and largely clean. No visible lens flare or chromatic
  fringing. Grain scale and halation are `UNKNOWN`.

### Unknown

Light source type and distance; what creates the wall pattern; surface and space outside the crop;
precise camera height; focus falloff; whether any optical diffusion was used.

## Frame `male-04.png`

Source receipt: 928×1232 RGB PNG; SHA-256
`f7e62f7b63793930a9b4c205e67910a4a778d9aaa338416572edc81f684fb96b`.
This exact SHA is also the owner-supplied mood-card source receipt for this unit.

### Observable

- Environment: a near-black deep-olive stage field with a pale floor strip. Several small
  rust-orange spheres sit on the floor; one very large, out-of-focus rust-orange sphere intrudes
  from the upper frame-right. No wall texture, chair, window or room architecture is visible.
- Camera consequence: very low upward view. The lower body reads larger than the head, and the
  standing figure lengthens vertically. Roll appears level from the floor edge. No focal length in
  millimetres is observable.
- Focus: the standing subject is sharp from face through footwear; the large upper sphere is
  deliberately far out of focus and the field behind remains smooth.
- Foreground: the large blurred sphere consumes the upper-right corner; a dark soft band touches the
  bottom edge. This occlusion is a load-bearing composition device, not a generic lens flare.
- Light: one hard warm source from high frame-right / side-back produces narrow hot edges on hair,
  face, shirt and trouser folds and a long crisp floor shadow running frame-left. The rest of the
  stage falls quickly into deep olive-black.
- Expression: eyes track the extended hand rather than the lens; upper lids low; brows at rest;
  mouth closed; cheekbones not visibly lifted; jaw relaxed. Head pans and tilts down toward the hand.
- Pose joint chain: support leg nearly straight; free knee flexed and crossing in front with the
  free foot resting lightly; pelvis shifts over the support leg; torso leans toward the extended
  arm; extended shoulder abducts, elbow remains nearly straight, wrist relaxes and fingers curl;
  opposite arm drops beside the torso; chin lowers toward the hand.
- Garment behaviour: no wind. Broad lower fabric holds large structured folds and moves as one
  weighted mass around the bent knee; the lighter upper layer makes smaller wrinkles; a separate
  layer hangs from the rear shoulder with gravity. Only weight, fold scale and stillness transfer.
- Optical evidence: clean warm rendering with restrained fine texture; no visible veiling flare,
  halation or chromatic fringing. The blurred sphere comes from depth separation, not an optical
  artefact.

### Measured colour evidence, not yet an approved master gamma

Twelve-cluster source quantisation includes `#191808` deep field, `#3D4226` olive field,
`#A45126` rust-orange accent, `#D46B31` hot amber accent, `#948C67` muted lit neutral and
`#E3CA9F` warm highlight. Approved item, skin, hair and eye colours remain exempt.

### Unknown

Whether the field is a cyclorama, curtain or open stage; sphere material and support method; exact
light source type/distance; exact focus distance; grain and diffusion process.

## Cross-frame reconciliation — FAIL: these are not one shoot unit

The frames disagree in every load-bearing dimension:

- close warm wall plus chair plus left-edge window/gobo versus deep-olive open stage plus spheres;
- low seated wide-knee portrait versus low standing balance with a blurred overhead foreground mass;
- hard frame-left patterned light versus hard frame-right side/back light;
- different subject presentation and different garment behaviour;
- no foreground optical device versus a large depth-blurred sphere.

They may share a broad warm family, but colour warmth is not proof of one photoshoot. Merging them
would create a style that no source frame contains. `male-04.png` is the only source consistent with
the registered title and the mood-card receipt, so it is the retained primary direction.
`male-02-chair-taupe.png` is inspected but excluded from this unit and needs its own coherent source
set if it becomes a separate style.

## Readiness — BLOCKED_SOURCE / NEEDS_SOURCE

After reconciliation, one coherent primary frame remains. It establishes one camera setup, one
joint-chain pose and one environment state, not six unique source-derived slot directions. Building
six different pose/camera instructions from it would require invention. Do not add `runtime_style`,
do not regenerate sheets, and do not mark READY until additional frames from the same
`male-04.png` photoshoot establish real coverage.

## Existing sheets and master gamma

Seven PNGs exist and each individual file hash/byte size matches the old manifest. They are not
approvable:

- camera and blocking merge the chair setup with the standing stage setup and omit a complete fixed
  optical signature;
- blocking reverses the observed light direction for `male-04.png`;
- garment behaviour copies pleated-trouser, jacket and shirt silhouettes instead of isolating
  transferable cloth behaviour;
- environment invents a plaster warehouse, window, spotlight pool and chair reverse angle;
- the six-colour palette mixes both incompatible frames and names reference cloth as palette roles;
- the manifest uses the obsolete hashes-only `unit_sha256` formula and has no observation/runtime
  binding required by the current builder.

## Unknowns to preserve

All frame-specific unknowns above; whether further frames from the `male-04.png` shoot exist; real
coverage poses and reverse views; any fixed optical effect beyond the clean evidence visible here.
