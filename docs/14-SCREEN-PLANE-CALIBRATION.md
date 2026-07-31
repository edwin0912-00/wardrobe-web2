# Screen-plane calibration preflight

The selected D world contains two screen surfaces with different geometry:

- TV in `seg2.mp4`: an almost axis-aligned 16:9 plane. It needs measured
  content-aperture rectangles, not bezel rectangles.
- laptop in `seg4.mp4`: a perspective quadrilateral. A rectangular overlay is
  visibly wrong: it crosses the laptop chin and keyboard.

`screen-surface-math.js` is intentionally only a pure, tested preparation
layer. It accepts a named measurement source and four ordered display corners
(`tl → tr → br → bl`) inside the 1920×1080 video frame, rejects invented or
crossed shapes, interpolates frames, and derives the CSS projective transform.
It does not mount a surface, fetch media or change scroll ownership.

The old rectangular laptop placeholder is hidden in `b/index.html`. It may not
return until all four conditions are true:

1. final four-corner measurements for the current `seg4.mp4` have been
   committed;
2. the owner has supplied the real pipeline HTML DOM;
3. one DOM tree can move from the calibrated laptop quad to the viewport and
   back, with explicit reversible scroll ownership;
4. desktop and iPhone preflight prove the transition does not add a second
   decoder or reduce frame cadence.

This is not a missing-content fallback. It prevents a false content plane from
being shown before a truthful one exists.
