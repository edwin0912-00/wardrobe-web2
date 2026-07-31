# Preflight 0.1 — calibrated TV and laptop surfaces

This atom adds **empty presentation infrastructure**. It does not wire beta,
deploy, create sample results, or invent the final laptop page. The selected
fabric world remains visually unchanged until a real result and a real
measurement are supplied.

## What exists now

```text
same journey clock (engine.js)
        │
        ├── TV: measured film-space rectangle → clipped TV aperture
        │       ├── verified 16:9 Fashion Video
        │       └── exactly five verified portrait Fashion Shoot images
        │
        └── laptop: existing measured frame rectangle → one supplied HTML DOM
                → later reversible frame-to-viewport handoff
```

`screen-surface-math.js` validates final-media calibration data. It rejects a
TV rectangle without `measuredFrom`, any frame that leaves the source picture,
or duplicate/non-monotonic timestamps. `screen-surfaces.js` is deliberately
headless about beta: it receives only final URLs and DOM nodes from the later
presentation integration.

## TV: no geometry, no surface

The current film has no approved TV measurements. Therefore the TV starts
`hidden` and cannot be shown merely by setting media. It needs a keyframed
calibration from the **final `seg2` master** first:

```js
window.wardrobeScreens.calibrateTv({
  leg: 1,
  measuredFrom: 'seg2-final.mp4 · frame audit YYYY-MM-DD',
  frames: [
    // Normalised to the source film, not browser-window percentages.
    { time: 3.20, x: 0.182, y: 0.296, width: 0.524, height: 0.292 },
    { time: 8.40, x: 0.207, y: 0.279, width: 0.566, height: 0.317 }
  ]
});
```

The values above are **schema examples only**, not measurements and must not be
copied into a release. A frame consists of the inner display aperture—never the
bezel. If the camera moves, measure enough keyframes for interpolation; the
module places the aperture inside `.film`, so it inherits the exact video
scale/parallax rather than fighting it from stage space.

Once real result URLs are available through `ZeelyClient`, the presentation
layer can select one mode at a time:

```js
// A completed wide Fashion Video only:
window.wardrobeScreens.showTvVideo({
  src: client.videoPlaybackUrl(video),
  poster: client.videoPosterUrl && client.videoPosterUrl(video),
  label: 'Фешн-відео'
});

// A completed Fashion Shoot only — exactly five actual result images:
window.wardrobeScreens.showTvShoot({
  label: 'Фотосесія',
  images: shots.slice(0, 5).map(function (shot) {
    return { src: client.editorialShotUrl(shot), alt: '' };
  })
});
```

The visual module uses `object-fit: contain` in both cases. Video stays 16:9
inside the clipped TV display; the five portraits become a single horizontal
contact strip, without crop or floating card. `showTvShoot` rejects fewer or
more than five images instead of filling the strip with fake placeholders.

## Laptop: one DOM, not an iframe

The old made-up pipeline bars were removed. The laptop is empty until the owner
supplies its HTML. The supplied node is *moved* into one persistent document
host, never copied or rendered inside an iframe:

```js
var suppliedPage = document.querySelector('[data-supplied-pipeline-page]');
window.wardrobeScreens.mountLaptopDocument(suppliedPage);
```

`engine.js` already has a measured laptop screen table. It now sends its
frame-space result as stage-pixel coordinates through the existing one-clock
write path:

```js
onSurfaceFrame(frame) {
  window.wardrobeScreens.updateJourney(frame);
}
```

The controller transforms the one DOM tree from the current laptop frame to
the viewport. It does not call `getBoundingClientRect()` while video is being
scrubbed. The future scroll director owns the actual handoff range and calls:

```js
window.wardrobeScreens.setLaptopHandoff(progress); // 0 = filmed frame, 1 = viewport
```

At `1`, the surface emits `wardrobe:laptop-scroll-owner` with
`{ owner: 'document' }`; reverse transition emits `owner: 'journey'`. This is
the seam where the station/scroll-director atom must switch input ownership.
The surface does not secretly intercept wheel/touch events, because that would
create a second scroll clock and break reverse travel.

## Required measurements and wiring before activation

1. **TV:** final-media inner-aperture keyframes, leg index, and source
   filename/hash in `measuredFrom`.
2. **Laptop:** re-verify the existing screen table if `seg4.mp4` changes, then
   measure the start/end of the camera-to-document handoff range. That range
   must be chosen from actual screen growth, not a fixed magic scroll number.
3. **HTML:** receive the owner-supplied pipeline DOM; mount it as-is. Do not
   invent replacement copy or use beta dashboard markup.
4. **Adapter/UI:** only completed, same-origin authorised asset URLs may enter
   TV. The left/right mirror UI selects media; the TV module only renders it.
5. **Scroll registry:** the pending three-station first-leg work must be done
   independently. It also needs to honour the `laptop-scroll-owner` transition
   when the final laptop handoff is wired.

## Checks in this atom

```bash
node --test test/screen-surface-math.test.mjs
node --test test/zeely-client.test.mjs
node --check screen-surfaces.js
git diff --check
```

No deployment check belongs here: this branch does not touch the static runtime
or `site.madeforthisjob.com`.
