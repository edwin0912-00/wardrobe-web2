# OBSERVATION LOG — shoot.grey_wall_gloss

## Current audit status — BLOCKED_SOURCE

`frame-01` is named in `unit.json`, but no source image bytes or source hash are present in this
unit directory or elsewhere in the checked-in source ledger. The public mood-card sidecar identifies
the available WebP as `OWN_GENERATED_PREVIEW`; it is not the extraction-only source frame and cannot
be used to verify the style. The audit therefore cannot independently point any style fact at source
pixels. No `runtime_style` may be certified and no paid sheet regeneration is allowed from this log.

What would settle the block: restore the exact extraction-only `frame-01` bytes plus a SHA-256
receipt, or provide the complete coherent source-shoot frame set and its ledger.

## Historical extract — UNVERIFIED, not current authority

The following text is preserved from the earlier observation pass so evidence is not silently
discarded. It must not be promoted into runtime facts until `frame-01` is restored and visually
re-checked.

- Camera: described as close, approximately eye-level and level-roll, with a head-to-hip crop
  against one close wall plane.
- Perspective: described as restrained, without visible convergence.
- Focus: described as the subject sharp and the wall readable mainly through a soft body shadow.
- Foreground: described as clear, with no lens-crossing object.
- Optics: described as clean and slightly warm, with fine grain and no flare or halation.
- Light: described as one broad soft source from front frame-left with a soft wall gradient.
- Expression: described as an over-shoulder near-profile, gaze down past the lens, low lids, brows
  at rest and relaxed jaw; mouth state `UNKNOWN` because hair obscures it.
- Material response: described as still, opaque, high-gloss material producing elongated
  high-contrast speculars while matte layers remain quiet. Any prior ribbed-hem or garment-silhouette
  wording is design-specific and is explicitly non-transferable.

## Master gamma audit

The prior four-colour set is not re-approved. Three entries are named after reference garments
(`deep burgundy`, `olive knit`, `light denim`) even though approved item colours are exempt and
reference garment colour/design must not become style authority. Only the warm-grey field could
potentially be an environment member, and even that remains unverified without `frame-01`.

## Existing sheet audit

All seven PNG files are present and their individual hashes and byte sizes match `manifest.json`;
the recorded `unit_sha256` also recomputes under the current labelled-sheet formula. Semantic QA
still fails:

- the environment sheet invents a reverse studio angle and equipment that cannot be established
  from a single missing frame;
- blocking prints an unsupported approximate 120-degree body rotation;
- expression labels the mouth both relaxed and `UNKNOWN`;
- garment behaviour depicts a specific bomber silhouette and ribbed hem rather than transferable
  cloth behaviour;
- person guidance assumes symmetry rather than preserving observed subject asymmetry.

Cryptographic consistency proves only that the same files remain present. It does not prove that
their contents were extracted honestly.

## Unknowns

- Every source-pixel claim until `frame-01` is restored.
- Source capture dimensions and SHA-256.
- Whether the wall is seamless paper, plaster, or another flat surface.
- Exact focus falloff, grain scale, optical cleanliness, light size and light distance.
- Any source-derived pose coverage beyond the single historical crop.
