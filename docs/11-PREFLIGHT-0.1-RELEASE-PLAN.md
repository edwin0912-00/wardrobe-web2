# Preflight 0.1 — controlled path to the canonical site

## Branch and promotion rule

```text
preflight/0.1  →  reviewed merge into main  →  exact main SHA copied to WardrobeRuntime/  →  site.madeforthisjob.com
```

`site.madeforthisjob.com` is the persistent test runtime for the selected
fabric-world main site. It is never a second source tree: deployment copies the
exact reviewed `main` SHA after preflight. No direct edits in
`WardrobeRuntime/` are a substitute for a commit.

## Approved Preflight 0.1 interaction contract

1. **Intro:** textile only, then scroll-controlled journey.
2. **Person stop:** after the camera settles, the person sheet fades into the
   **left mirror**. The right mirror owns the monochrome transparent orb while
   an upload/run is active.
3. **Things stop:** the things sheet fades into the **same left mirror**. The
   right mirror continues to own waiting and then result output.
4. **Look stop:** left mirror chooses an action; right mirror replaces the orb
   with the result in the same aperture, then exposes only valid next actions.
5. **Live:** starts from the right mirror, expands from its measured rectangle
   to fullscreen, and reverses to that exact rectangle on close. Client copy is
   neutral; it excludes provider/model, price, technical and security language.
6. **TV:** one calibrated clipped surface. Fashion Video is 16:9 within it;
   Fashion Shoot is five vertical images in a horizontal contact strip within
   it. Nothing floats in front of the television.
7. **Laptop:** one supplied HTML DOM tree begins inside the calibrated laptop
   screen. Scroll transfers continuously from camera progress to document
   progress as the screen becomes fullscreen, and transfers back on reverse.

## Verified blockers — do not paper over them

At preflight creation, both local port 4180 and canonical
`site.madeforthisjob.com` return `404` for `/api/health`. The current static
runtime has no same-origin beta gateway. Therefore attaching `ZeelyClient` to
the public UI today would create controls that fail on first use.

The current video code has a measured laptop rectangle, but no TV rectangle.
It also has one station latch per leg, while Preflight 0.1 requires three
independently latched attention stops in leg 0.

The current beta Live route is server-capped at 15 seconds. The approved
40-second direction requires its own beta lane: server validation, capability
payload, token route, tests and release must move together. The main-site must
read the allowed duration; it must not claim 40 seconds beforehand.

## Implementation order

### P0 — beta/gateway contracts (must land before live wiring)

- Beta publishes a versioned/verified same-origin API contract and a Live
  capability containing the allowed duration.
- Active-domain gateway forwards `/api/*` to beta with host-only cookie, SSE,
  Range media and same-origin mutation semantics preserved.
- Canonical smoke: `/api/health` is `200` from the active domain.

### P1 — cinematic geometry and scroll ownership

- Add a station registry for `person`, `things`, `mirrors`; each owns entry,
  exit, resistance and gate predicate.
- Measure all final-frame rectangles for left mirror, right mirror, TV and
  laptop. Store them in one surface registry, not scattered CSS percentages.
- Build `TvScreenSurface` and `LaptopScreenSurface` from those measurements.

### P2 — client UI wiring

- Replace simulated timers/local results in `ui.js` with `ZeelyClient` state.
- Left mirror renders inputs/choices only. Right mirror renders orb/result/live
  only. It never displays a beta dashboard or backend status vocabulary.
- Add the reversible mirror-to-fullscreen Live transition and camera cleanup.
- Mount the supplied laptop HTML only when it is received; no invented final
  copy replaces it.

### P3 — release preflight

- Adapter tests plus beta contract tests pass at the pinned compatible SHAs.
- Desktop and iPhone check: textile first frame, responsive frame scrubbing,
  three attention locks, no black handover, sound after real gesture, orb and
  result placement, TV mask, laptop scroll handoff, Live cleanup.
- Only then merge `preflight/0.1` into `main` and copy that exact SHA to the
  persistent runtime.

## Deploy protocol

1. Confirm the candidate `main` SHA and clean worktree.
2. Run the P3 checks at that SHA.
3. Copy the exact `main` tree to
   `~/Library/Application Support/WardrobeRuntime/`, excluding `.git` only.
4. Verify both loopback `:4180` and the canonical domain return identical
   asset hashes and a working `/api/health`.
5. Record SHA, deployment timestamp and smoke result in the release handoff.

No deployment occurs on a failed preflight simply because a branch exists.
