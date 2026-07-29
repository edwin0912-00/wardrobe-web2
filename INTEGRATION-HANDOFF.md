# WARDROBE — Integration handoff for the incoming design source of truth

This document is a surgical integration note, not a replacement design brief.
When the incoming Claude Code commit arrives, **that commit is the visual and
structural source of truth**. Preserve its design decisions. Apply only the
mobile/runtime guarantees below where they still map to its architecture.

## 1. Selected visual direction — do not lose it

The selected site is the fabric-world implementation currently served from
`b/` in this repository. It was labelled “C” during review to distinguish it
from two rejected candidates; the path name `b/` is historical only.

The approved image is:

- an environment without people;
- a soft ivory textile suspended in a graphite / milk architectural world;
- one continuous camera journey: fabric → empty room / sofa → mirrors → TV →
  laptop;
- scroll controls video time frame-by-frame. It is not a vertical gallery of
  stills and it is not autoplay-first product video;
- extremely restrained chrome: WARDROBE wordmark, small sound control, scroll
  cue, and UI that belongs on the mirror surface;
- no generic landing-page dashboard, no human avatar as a hero, no old “A”
  spatial-gallery fallback.

The current root redirect deliberately opens `b/` directly. Do not restore a
runtime “choose A / B” page. The design source may use a different route or
application shell; retain the **direct entry into the selected fabric world**,
not the literal redirect implementation.

## 2. Commits that form the mobile/runtime patch set

These commits sit on top of `a26aaad` and should be treated as a small patch
series to inspect, not blindly cherry-pick:

| commit | guarantee |
| --- | --- |
| `607e3c8` | fabric world is the direct entry; first visible clip is not held behind room-one media; audio intent is audible after a user gesture |
| `e33ae69` | iPhone has a visible fabric poster while its video compositor is not ready; native MP4 delivery is selected for iOS rather than the desktop Blob path |
| `278d32d` | iOS first frame is primed before the poster is removed; `loadeddata` alone is not accepted as visual readiness |
| this commit | documents the decision, failure modes, and integration test plan |

The implementation points in the current source are:

- `index.html` — direct entry to the selected journey;
- `b/index.html` — loader list, audio intent, iOS native-video branch, first
  frame priming;
- `style.css` — visible poster behind the pending intro video;
- `b/assets/intro-poster.jpg` — first visible textile frame.

## 3. Why each patch exists

### A. Do not block the first video behind later media

The old critical set fetched score + intro + first room before opening. On a
phone it was about 21.9 MB and made the first interaction read as a hung black
screen. The selected behaviour is:

```text
critical: score track 1 + fabric intro
background: room one and every later room
seam: resist / hold honestly if the next clip is not ready
```

If the incoming design has a different loader, preserve the policy rather than
the array names: **the first visual clip must be the only visual media allowed
to block entry.**

### B. iOS must not use the desktop Blob-video path by default

Chrome decoded fetched MP4 Blob URLs correctly. On the tested iPhone the same
video element reported readiness while painting a black compositor layer. The
working route is:

```text
desktop: fetched Blob URL for instant seeking
iOS/iPadOS: native same-origin MP4 URL with Range support
```

Keep `muted`, `playsinline`, H.264/yuv420p, faststart, and a valid video MIME
type. If the incoming implementation has a media abstraction, put this choice
inside that abstraction — never duplicate independent scroll clocks.

### C. A poster is a safety surface, not decoration

`loadeddata` was insufficient on Safari: it can fire before a painted video
frame exists. Keep a poster visible until `seeked`, `timeupdate`, or an
equivalent confirmed rendered frame. Prime the muted native video at a tiny
non-zero time when metadata arrives, then pause it. If priming fails, retain
the poster rather than exposing black.

When the incoming first clip changes, regenerate the poster from **its own
first meaningful frame**. Do not carry `intro-poster.jpg` into unrelated art.

### D. Audio must start on the first real interaction

Browsers can reject audible autoplay. The previous path unlocked Web Audio on
the first swipe but left the mixer muted, so it looked as if music did not
exist. The required contract is:

```text
load: audio may remain policy-gated
first touch / pointer / wheel: resume AudioContext, begin active track, mute=false
later: explicit sound button controls mute
```

The incoming design may choose a different sound control, but a first gesture
must not silently unlock a zero-gain mixer.

## 4. Deployment / runtime lessons

1. Use only `https://site.madeforthisjob.com` as the review URL. Do not give
   ad-hoc `chatgpt.site`, Quick Tunnel, or random preview links to the owner.
2. The old shared named tunnel had connectors with different ingress configs;
   Cloudflare therefore returned intermittent 404s. Never attach a temporary
   preview to a shared production tunnel.
3. `/tmp` is not a deployment location. The system cleaned the temporary
   runtime and the canonical host silently fell back to the old service.
4. The current selected runtime is copied to
   `~/Library/Application Support/WardrobeRuntime/` and served on loopback
   port 4180. `site.madeforthisjob.com` already routes to that port through the
   existing Cloudflare Tunnel configuration.
5. After merging incoming source, copy the exact selected build/runtime to the
   persistent service location, restart only the `site` origin, then verify:
   root → selected journey; poster → HTTP 200 image/jpeg; MP4 → HTTP 206
   video/mp4. Do not restart unrelated subdomain services.

## 5. Safe merge procedure when the incoming commit arrives

1. Fetch / check out the incoming Claude Code commit as the new baseline.
2. Compare its entry route, media loader, scroll director, video component,
   sound activation, and mobile CSS against this document.
3. Preserve its layout, typography, camera choreography, component structure,
   and design tokens unless a patch below is required for mobile correctness.
4. Re-implement only these semantic patches in its native architecture:
   - direct entry into fabric world;
   - first-video-first loading policy;
   - iOS native MP4 source route;
   - poster until an actually painted frame;
   - audio audible after first interaction.
5. Do not transplant current `b/index.html`, `engine.js`, or `style.css`
   wholesale. That would overwrite the incoming design source of truth.
6. Commit the integration separately with a message that names the incoming
   baseline and the mobile compatibility guarantees.
7. Deploy only after device QA below passes.

## 6. Required acceptance checks

Desktop is not enough. Run these on the canonical domain:

- iPhone portrait 390×844: initial state shows fabric/poster, never a black
  video rectangle;
- first swipe changes the camera/video frame visibly;
- first swipe also starts audible score (subject to physical device volume and
  silent-mode policy); sound control can later mute/unmute;
- slow network: first textile appears before later room media; if a later clip
  is unavailable, the journey holds at its seam rather than showing empty/black;
- desktop: native/Blob choice does not reintroduce low-FPS still swapping;
- reverse scroll crosses the same video frames backward cleanly;
- root URL lands in the selected fabric world, without A/B selection;
- no console errors except an intentionally unresolved non-product asset such
  as a favicon (add a favicon before final release).

## 7. Things explicitly rejected

- spatial-gallery “A” as the main site;
- the older human-avatar dark WARDROBE release as the main site;
- random deployment URLs instead of the canonical subdomain;
- an all-media blocking loader;
- black stage as a video fallback;
- audio that is technically unlocked but still muted;
- merging an incoming design commit by overwriting it with this older runtime.

