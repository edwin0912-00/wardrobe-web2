# Laptop pipeline deck — canonical main-site handoff

## Source lock

The laptop document is first-party versioned HTML at `b/pipeline-deck-v2.html`.
It began from the approved GitHub handoff and is now updated only as an explicit
main-site atom. Every document edit updates its bytes, SHA-256 and lock test in
the same commit; there is no runtime URL switch or untracked replacement:

- title: `Wardrobe — Pipeline v2 · 2026-08-01`
- 17 panels, desktop and portrait-browser interaction states
- bytes: `114569`
- SHA-256: `a6c5a0df0cec153465f15ae86ecd001da7aa4eb1661d357ef4196811217b996b`
- source: `https://github.com/edwin0912-00/wardrobe-beta-github-draft/blob/main/docs/zeely-pipeline-deck-v2.html`

`test/pipeline-deck.test.mjs` is the byte and structure lock. If the deck changes,
update its SHA and byte count in the same reviewed commit; do not add a runtime URL
switch or silently replace the vendored file.

## Runtime architecture

`b/pipeline-deck.js` fetches `pipeline-deck-v2.html` same-origin, verifies the
SHA-256, parses it, scopes its stylesheet, and mounts its body into a `ShadowRoot`.
The supplied inline interaction script is evaluated with a narrow document facade
bound to that root. This preserves one interactive DOM tree without an iframe,
cross-origin cookie problem, second route, or duplicate page scroll owner.

The adapter is deliberately fail-closed:

1. fetch failure, unsupported `ShadowRoot`, malformed HTML, missing `#deck`, or SHA
   mismatch renders a quiet “Історія створення недоступна” state in the laptop tree;
2. the measured laptop remains hidden until the verified host is mounted;
3. no preview, alternate source, or white rectangle is used as a fallback.

## Scroll contract

The camera remains the owner until the final calibrated laptop interval in
`b/screen-calibration.json` (`leg: 3`, 9–14 seconds). `screen-surfaces.js` projects
the same host onto the measured four-corner quad. At the terminal threshold the
adapter:

1. moves that same laptop node to `document.body`;
2. applies `.laptop-surface--fullscreen` and gives the deck its own 0→16 panel scroll;
3. captures wheel, touch and keyboard movement at the window boundary while allowing
   the deck’s detail drawer to scroll normally.

When the user reverses past panel 0, the adapter removes fullscreen, puts the node
back at its original sibling in the filmed laptop surface, and returns the leftover
delta to the cinematic camera. Moving back before the terminal camera interval also
hands control back automatically. No clone or reload occurs, so panel and drawer
state survives the transition.

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
- terminal transition reaches fullscreen and panel scroll responds to wheel/swipe/keys;
- drawer body still scrolls internally;
- reverse swipe at panel 0 returns to the camera and the same node is back in the laptop;
- reload starts from the loader and does not run browser segmentation or duplicate deck
  scripts;
- source hash, console errors and network failures remain zero.

Only `canonical-site-main` is deployable for this lane. Do not merge or deploy beta,
runtime or router changes as part of the laptop handoff.
