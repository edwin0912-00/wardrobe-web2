# SOURCE AUDIT — shoot.hardsun_brick_doorway

## AUDIT RESULT

`BLOCKED_SOURCE`.

The historical private retail reference is not available as image bytes on this
host. A generated preview and generated specification sheets cannot be promoted
to source evidence. Consequently no frame-level observation, no six-slot
`runtime_style` and no paid regeneration are permitted.

## SOURCE LEDGER

### frame-01 [BLOCKED_SOURCE]

`unit.json` historically named one supplied portrait frame, but it did not record
a path, source sha256, dimensions or attachment identifier. Searches across the
repository, host-side project archives and historical workspaces found no
resolvable source image.

`assets/scene-mood-cards/shoot.hardsun_brick_doorway.webp` was inspected only to
classify it. Its sidecar explicitly records
`origin.kind: OWN_GENERATED_PREVIEW`, generator route `gpt_image_2`, and
`approval: PENDING_VISUAL_JUDGE`. It is an output, not the retail reference, so
none of its pixels are used as observation.

`updates/claude-code-20260727-ui4f2a.md` is a secondary historical note, not a
visual source. It says the reference face was in shade while the standing collar
and one shoulder were in the direct beam. That conflicts with the old
`OBSERVATION.md`, generated mood card and person sheet, all of which put direct
hard sun on the face. The conflict cannot be resolved without the source bytes.

The neighbouring Codex-thread lookup was also attempted, but the thread listing
service returned an error and exposed no attachment that could be inspected.

## WHAT REMAINS UNKNOWN

Until the actual private screenshot is restored, every source-dependent claim is
`UNKNOWN`, including:

- exact subject crop, camera consequence, depth falloff and foreground state;
- location geometry, doorway depth, brick pattern, street and crosswalk layout;
- sun direction, elevation, face-to-key relation, bounce and shadow placement;
- expression, pose joint chain and garment motion;
- transferable material response and the closed environment palette;
- fixed optical signature;
- every alternate composition needed for five unique frames and all six
  canonical runtime slots.

Historical prose may be used later as a locator or reconciliation note, never as
a substitute for looking at the frame.

## VISUAL AUDIT OF EXISTING SHEETS

All seven canonical PNGs were opened and inspected at native resolution. Their
file hashes and byte sizes match the legacy manifest, but that proves integrity,
not provenance or correctness.

- `sheet-camera_lens.png` — `FAIL`: prints an invented 135 cm camera height and
  turns a single historical crop into a fixed camera rule without accessible
  evidence.
- `sheet-blocking.png` — `FAIL`: asserts exact feet, pockets, sun vector and
  subject distance; its top-down mannequin bows the head while the front-view
  text says chin level.
- `sheet-expression_gaze.png` — `FAIL`: supplies a generated identity under
  frontal hard light. The secondary note says the source face was in shade, so
  the light/expression demonstration is specifically unreconciled.
- `sheet-garment_behaviour.png` — `FAIL`: the heavy smooth surface and
  self-supporting collar may be useful hypotheses, but the board reproduces one
  high-collar silhouette and cannot be approved without the source.
- `sheet-colour_grade.png` — `FAIL`: it is primarily a swatch/ramp board with no
  source-grounded graded plate; palette and roll-off remain unverified.
- `sheet-environment.png` — `FAIL`: invents a complete industrial facade,
  reverse view through the doorway and street geometry that one missing frame
  cannot substantiate.
- `sheet-person.png` — `FAIL`: its unit-specific section places compact direct
  highlights on the face, contradicting the secondary note that the face was in
  shade.

The rendered `palette-strip.svg` was visually checked and its six hex swatches
render. Its palette authority hash matches the legacy manifest, but the palette
cannot be semantically approved without the source.

## MANIFEST AND GATE

The legacy manifest lists exactly seven PNGs and all declared sheet hashes,
sizes, palette hash and assembled `unit_sha256` match the current files. It does
not contain an observation-log hash or a `runtime_style_sha256`, and its
`source_frames` entry points only to unresolvable prose.

The current `build-unit.mjs --dry-run` correctly refuses this unit because
`runtime_style` is absent. That failure is intentional fail-closed behaviour.
Restore the real reference plus enough neighbouring shoot frames to prove five
unique compositions, then repeat the observation pass before any regeneration.
