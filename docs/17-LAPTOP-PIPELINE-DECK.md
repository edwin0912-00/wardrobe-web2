# Laptop pipeline deck — canonical main-site handoff

## Source lock

The laptop document is the owner-supplied first-party HTML at
`b/zeely-pipeline-clients.html`. It is versioned only as an explicit main-site
atom. Every document edit updates its bytes, SHA-256 and lock test in the same
commit; there is no runtime URL switch or untracked replacement:

- title: `wardrobe — Pipeline`
- 10 panels, desktop and portrait-browser interaction states
- bytes: `803177`
- SHA-256: `0aea43bd7f1cf6ac77b5db68521b3712dbae2de964ab57fd14f206818171389b`
- source: owner-supplied `zeely-pipeline-clients.html`

`test/pipeline-deck.test.mjs` is the byte and structure lock. If the deck changes,
update its SHA and byte count in the same reviewed commit; do not add a runtime URL
switch or silently replace the vendored file.

## Runtime architecture

`b/pipeline-deck.js` fetches `zeely-pipeline-clients.html` same-origin, verifies
the SHA-256, parses it, scopes its stylesheet, and mounts its body into a
`ShadowRoot`. Its inert JSON node contract remains in the tree; its interaction
script is evaluated with a narrow document facade bound to that root. This preserves
one interactive DOM tree without an iframe, cross-origin cookie problem, second route,
or duplicate page scroll owner.

The adapter is deliberately fail-closed:

1. fetch failure, unsupported `ShadowRoot`, malformed HTML, missing `#deck`, or SHA
   mismatch renders a quiet “Історія створення недоступна” state in the laptop tree;
2. the measured laptop remains hidden until the verified host is mounted;
3. no preview, alternate source, or white rectangle is used as a fallback.

## Scroll contract

The camera remains the owner until the final calibrated laptop frame at `14.145 s`.
At that exact terminal frame, `screen-surfaces.js` pins the same mounted laptop node to
its measured four-corner quad. Wheel, touch and keyboard movement then scroll only the
document vertically inside that physical screen. It cannot move the camera past the
laptop or make the presentation disappear. When the user reverses past document panel
0, the lock releases and the leftover movement returns to the cinematic camera. No
fullscreen, clone or reload occurs, so document and drawer state survive the transition.

## Surface and UI rules

- The laptop is a measured projective surface, never a generic card.
- The TV and laptop remain owned by `screen-surfaces.js`; the adapter only supplies
  the laptop document and the reversible handoff.
- The cinematic header, mirror controls, beta adapter, provider details, prices and
  internal status codes are outside this deck and must not be added to it.
- The source’s own section navigation, detail drawer, keyboard affordances and mobile
  layout remain intact inside the shadow tree.

## Verification before release

Run the static contract first:

```bash
node --check b/pipeline-deck.js
node --check screen-surfaces.js
node --test test/pipeline-deck.test.mjs test/laptop-placeholder.test.mjs test/client-window-wiring.test.mjs
./scripts/site-preflight.sh
```

Then smoke desktop Chromium and iPhone/WebKit at the live canonical domain:

- laptop hidden before the measured interval;
- deck appears inside the laptop aperture with no second white rectangle;
- terminal transition keeps the laptop visible while panel scroll responds to wheel/swipe/keys;
- drawer body still scrolls internally;
- reverse swipe at panel 0 returns to the camera and the same node is back in the laptop;
- reload starts from the loader and does not run browser segmentation or duplicate deck
  scripts;
- source hash, console errors and network failures remain zero.

Only `canonical-site-main` is deployable for this lane. Do not merge or deploy beta,
runtime or router changes as part of the laptop handoff.
