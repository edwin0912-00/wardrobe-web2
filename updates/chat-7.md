# Chat 07 — Real-time Look action-hub atom

- Base: `5fab5b4095711821a5a256d4063a80d659d5478a`
- Branch: `atom/saved-look-hub-block7-20260730`
- Scope: Block 7 only; no Block 2, Video, release, deployment, or central-ledger edits.
- Decision: expose a small server launch/capability contract so the saved-look
  hub can open Real-time Look as one full-viewport surface instead of an iframe
  or nested scroll container.
- Saved-look reference: bound to the verified outfit-only
  `/api/profile/looks/:lookId/live-reference.png` route.
- Consent: privacy and the bounded paid session are separate explicit states.
  The server refuses a token when either state is absent.
- Camera: permission state is visible; denied/unavailable paths remain local.
  Camera preview requests video only and never audio.
- Teardown: camera tracks, WebRTC peer, provider connection, timers, and remote
  preview are stopped on explicit stop, privacy withdrawal, or page hide.
  Cost-consent withdrawal stops an active paid session.
- Capture: no `MediaRecorder`, screen capture, background recording, automatic
  upload, or automatic persistence exists in this atom.
- Pre-change proof: the focused tests failed with missing launch route, missing
  consent controls, and missing server privacy refusal.
- Focused proof: `node --test test/web/fal-realtime-token.test.js
  test/web/post-shoot-routes.test.js test/contracts/post-shoot-pipeline.test.js
  test/web/profile-ui-flow.test.js`.
- Code: READY_FOR_REVIEW.
- Beta: NOT_DEPLOYED.
- Journey: NOT_RUN — no real camera or paid provider call in this atom.
- weakened_checks: none.

## Adversarial security repair

- Review found that a syntactically valid `look_id` was not ownership proof.
- Capability resolution now creates/resolves the browser profile and returns the
  same `404 LOOK_NOT_FOUND` for a nonexistent or foreign saved look.
- The paid token mutation now enforces the existing same-origin request
  contract, requires the exact saved-look ID, resolves the active browser
  profile, and verifies ownership before the provider issuer can run.
- The browser sends its bound saved-look ID with the token request; an uploaded
  arbitrary reference or the public demo cannot authorize paid Live.
- `createWebApp` now registers profile routes first, then passes `profileApi`
  and `profiles` into the protected post-shoot routes.
- Pre-change proof: six focused assertions failed, including foreign-look
  capability, cross-site token request, missing/foreign token look, browser
  binding, and registration ordering.
- Security-focused proof plus integration guards: 31/31 PASS.
- weakened_checks: none.

## 2026-07-30 E-Live privacy and full-viewport handoff

- Code: READY_FOR_REVIEW — the containing Block 7 commit adds a dedicated
  pre-camera privacy gate, truthful provider-capability gating, a
  full-viewport saved-look transition, explicit close/Escape/pagehide
  teardown, return-focus recovery and focused E-Live assertions.
- Focused non-paid command:
  `node --test test/web/e-live-ui.test.js test/web/fal-realtime-token.test.js test/web/post-shoot-routes.test.js test/contracts/post-shoot-pipeline.test.js test/web/profile-ui-flow.test.js test/live/live-look-reference.test.js test/live/live-reference-routes.test.js`
- Result: 38/38 PASS. No camera, fal token or paid provider session was
  requested.
- Beta: NOT_DEPLOYED.
- Journey: NOT_RUN — a real granted-camera journey and paid Lucy remain
  separate operator-authorized checks; explicit Capture/Save persistence is
  still not implemented.
- Integration prerequisite: this branch is based on the older saved-look UI
  baseline (`9911edc`) while current `origin/beta` already contains the merged
  action hub and stronger capability contract. Port the E-Live privacy,
  close/return-focus and focused-test intent onto the current action hub; do
  not replace its `/api/post-shoot/realtime-look-capability` validation,
  explicit privacy/cost contract, camera permission state, selected-look token
  binding or AI-orb loading surfaces with the stale shared-file versions from
  this branch.
- Shared-path conflict: `web/public/app.js`, `web/public/index.html`,
  `web/public/add-items-flow.js` and `test/web/profile-ui-flow.test.js` overlap
  the saved-look action hub and require integration-owner reconciliation.
- weakened_checks: none in the Block 7 delta; preserving the stronger current
  beta checks above is mandatory for integration.
