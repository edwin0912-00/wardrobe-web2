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
