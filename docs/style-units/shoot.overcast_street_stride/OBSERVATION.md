# SOURCE AUDIT — shoot.overcast_street_stride

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

`assets/scene-mood-cards/shoot.overcast_street_stride.webp` was inspected only to
classify it. Its sidecar explicitly records
`origin.kind: OWN_GENERATED_PREVIEW`, generator route `gpt_image_2`, and
`approval: PENDING_VISUAL_JUDGE`. It is an output, not the retail reference, so
none of its pixels are used as observation.

`updates/claude-code-20260727-ui4f2a.md` is only a secondary historical note. It
mentions bright overcast, a full-length street stride, living city context,
long-lens consequences and matte suede. Those words are useful for locating and
reconciling the lost frame, but they are not visual proof.

The neighbouring Codex-thread lookup was also attempted, but the thread listing
service returned an error and exposed no attachment that could be inspected.

## WHAT REMAINS UNKNOWN

Until the actual private screenshot is restored, every source-dependent claim is
`UNKNOWN`, including:

- exact full-body crop, camera consequence, depth falloff and foreground state;
- city, architecture, street geometry, crossing, traffic and pedestrian layout;
- sky structure, shadow length, direction and skin response;
- expression, head turn, stride joint chain and garment motion;
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

- `sheet-camera_lens.png` — `FAIL`: asserts long-lens compression, full-length
  lateral framing and a generic city layout without accessible visual evidence.
- `sheet-blocking.png` — `FAIL`: invents north/south kerbs, a specific crossing,
  camera placement, pedestrian distribution and an exact left-to-right path.
- `sheet-expression_gaze.png` — `FAIL`: uses a generated male identity and a
  single repeated head-turn grammar; neither identity nor facial mechanics can
  be checked against the missing source.
- `sheet-garment_behaviour.png` — `FAIL`: visually coherent swing and matte
  behaviour, but the open layer, wide leg, motion edge and material response
  remain unverified hypotheses.
- `sheet-colour_grade.png` — `FAIL`: primarily swatches and a tonal ramp with no
  source-grounded graded sample; the palette cannot be reconciled.
- `sheet-environment.png` — `FAIL`: chooses a specific Haussmann/Paris-like
  street, crosswalk, plan and reverse angle while `exact city` was already
  recorded unknown. These are inventions, not extraction.
- `sheet-person.png` — `FAIL`: a blank template is safer than an invented
  identity, but its skin-light claims and “plausible” mark categories cannot be
  approved from an absent source.

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
