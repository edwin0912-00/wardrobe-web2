# OBSERVATION LOG — shoot.shutter_amber_interior

Three local source files were opened at original resolution before reviewing any sheet. All are
extraction-only. Reference identity, garment design, patterns, logos and item colours do not
transfer.

## Frame `male-01-shutter-orange.png`

Source receipt: 928×1232 RGB PNG; SHA-256
`1c01cb51b6a44fc48e178e39e6d5c1a40d4f32266df2e159e60d647887770ce8`.
This exact SHA is also the owner-supplied mood-card source receipt for this unit.

### Observable

- Environment: a dark warm wall crossed by many parallel diagonal light bands; a rough wooden
  ledge or furniture edge at frame-left; a rust-red seat or textile at the lower edge. The window or
  blind itself remains outside the crop.
- Camera consequence: close seated portrait from around face-to-chest height, looking slightly
  downward. The near forearm and hand enlarge strongly at the lower edge while the face remains the
  focus. Roll appears level, but no reliable horizon is visible.
- Focus: eyes and face are sharp; the near hand/forearm at the bottom is soft; wall bands remain
  readable but secondary.
- Foreground: the subject's extended near forearm and large soft hand cross the lower frame. No
  separate prop crosses the lens.
- Light: hard warm light from upper frame-left/front creates parallel diagonal bands on wall and
  body. Lit skin and fabric are hot amber; unlit zones fall to deep olive-brown. Band edges are
  crisp enough to remain a required light device.
- Expression: near-direct steady gaze, low upper lids, brows at rest, cheekbones not visibly
  lifted, mouth closed with level corners, jaw relaxed. Head tilts toward the raised arm and chin is
  near level.
- Pose joint chain: pelvis seated low; one knee rises toward the torso; the arm on that side bends
  overhead with the hand behind the crown; opposite shoulder drops forward, elbow extends toward
  camera, forearm crosses the lower frame and wrist relaxes; torso leans into the wall/ledge.
- Garment behaviour: still air. A light loose upper layer settles into small wrinkles and soft
  folds; the lower ribbed material bends into broad compressed arcs around the raised knee. Only
  weight, fold scale, opacity and stillness transfer; the visible pattern and silhouette do not.
- Optical evidence: warm high-contrast rendering with slight softening around the brightest bands,
  no obvious veiling flare and no chromatic fringing. Grain scale and whether the highlight
  softening is lens bloom or grade are `UNKNOWN`.

### Measured colour evidence, not yet an approved master gamma

Twelve-cluster source quantisation includes `#1D1B0C` deep field, `#5D200C` burnt shadow,
`#9A2908` saturated red-orange, `#D45912` amber accent, `#684F2C` dark warm neutral,
`#D0B38F` warm light and `#EFE2D2` brightest band. Skin, hair, eyes and approved item colours remain
exempt; a skin swatch may not be a palette member.

### Unknown

Whether real sun, a lamp or a gobo creates the bands; actual blind/window geometry; wall material;
camera height and distance; focal length; source size; grain and diffusion process.

## Frame `male-03.png`

Source receipt: 928×1232 RGB PNG; SHA-256
`47e8b33453bbc93700d35afd465af1abaadebccd41514e28c9fa3de3f071fd93`.

### Observable

- Environment: a ribbed/textured glazed window with dark mullions at frame-left; a rough deep sill
  or step; a plain dark wall at frame-right.
- Camera consequence: seated three-quarter view near chest/eye height. The torso and raised knee
  dominate while the face remains moderate in scale. Roll appears level from the window mullions.
- Focus: face and torso are sharpest; the braced near hand and lower-left haze are softer.
- Foreground and optics: a strong golden veiling haze/flared wash fills the lower-left and crosses
  the window edge. This is load-bearing and absent from `male-01-shutter-orange.png`.
- Light: hard warm sun enters from frame-left, forming broad window/mullion patches rather than the
  narrow repeated diagonal slats of the primary frame.
- Expression: gaze withheld toward frame-right, upper lids low, brows at rest, mouth slightly
  parted or closed is `UNKNOWN` at this scale, jaw relaxed.
- Pose joint chain: pelvis seated on the ledge; one knee flexes high near the torso; same-side arm
  bends behind the head; opposite arm extends down with palm braced on the ledge; torso leans back
  into the corner; head pans toward frame-right.
- Garment behaviour: no air movement. A light loose upper layer collapses into large soft wrinkles;
  broad lower fabric pools around the bent knee. Design and colour do not transfer.

### Unknown

Whether the haze is in-camera flare, atmosphere or a foreground diffusion object; the floor and
room beyond the crop; exact light source and camera distance.

## Frame `male-05-armchair-dark.png`

Source receipt: 928×1232 RGB PNG; SHA-256
`992bd1665cb7c3ea92798f957349884ed1149b19168b7ff59e2efafa8becc741`.

### Observable

- Environment: a dark upholstered armchair on a wooden floor against an almost featureless dark
  wall. No window, blind, ledge or parallel light bands are visible.
- Camera consequence: wider seated portrait near chest height with restrained perspective; chair
  and crossed legs occupy the lower half, while the subject is smaller than in the other frames.
- Focus: subject and front chair structure are readable; the dark wall is smooth and secondary.
- Foreground: no lens-crossing object and no veiling wash.
- Light: one narrow hard warm spotlight from upper frame-right/front isolates hair, face, one hand,
  torso edge and crossed leg, while most of the room remains near black.
- Expression: gaze down past the near hand, upper lids low, brows at rest, mouth hidden by the hand,
  jaw state `UNKNOWN`.
- Pose joint chain: pelvis deep in the chair; one leg crosses over the other; near elbow bends and
  hand rises before the mouth; opposite arm extends along the chair/leg; shoulders round slightly
  forward; head tilts down.
- Garment behaviour: structured layers remain still and hold broad planar folds; no wind or
  trailing motion. Exact tailoring and colour do not transfer.
- Optical evidence: clean deep-black rendering with no visible flare or haze.

### Unknown

Source type and distance; wall material; room depth; mouth and jaw state; exact focus falloff.

## Cross-frame reconciliation — FAIL: three incompatible shoot systems

The primary frame is a close slatted-band amber portrait. `male-03.png` changes both environment and
fixed optical signature to a ribbed window with strong lower-left veiling haze.
`male-05-armchair-dark.png` changes again to an armchair/wood-floor room with a clean narrow
spotlight and no window bands. Camera distance, subject scale, foreground treatment and garment
behaviour also differ. A shared warm grade and seated body language are not sufficient to make one
photoshoot.

`male-01-shutter-orange.png` is the retained primary because its SHA is the registered mood-card
source and it alone matches the unit title. `male-03.png` and `male-05-armchair-dark.png` are
inspected but excluded; each requires frames from its own shoot before becoming a separate unit.

## Readiness — BLOCKED_SOURCE / NEEDS_SOURCE

After reconciliation, one coherent primary frame remains. It supplies one seated joint chain, one
camera setup and one lighting state. Six unique, source-derived shot directions cannot be written
without invention. Do not add `runtime_style`, regenerate sheets, or mark READY until more frames
from the exact `male-01-shutter-orange.png` shoot establish coverage and its fixed optical
signature.

## Existing sheets and master gamma

Seven PNGs exist and each individual file hash/byte size matches the old manifest. They are not
approvable:

- camera invents 24 mm / 85 mm focal lengths and a precise 15-degree angle, all forbidden because
  only perspective consequences are observable;
- blocking and environment merge the ledge, armchair and slatted-wall sources into one invented
  room and invent a reverse view;
- garment behaviour reproduces a specific printed shirt and silhouette instead of transferable
  cloth behaviour;
- palette includes `lit skin` even though human skin is exempt and mixes incompatible frame sets;
- camera omits a complete fixed optical signature and the environment sheet claims unseen
  architecture;
- the manifest uses the obsolete hashes-only `unit_sha256` formula and has no observation/runtime
  binding required by the current builder.

## Unknowns to preserve

All frame-specific unknowns above; whether more frames from the primary slatted-band shoot exist;
real six-slot coverage; whether primary highlight softness is lens bloom or grade; the source
device outside the crop.
