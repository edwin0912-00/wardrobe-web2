# codex-live-20260727

Protocol ACK: 4472986

## BETA-POST-SHOOT-001 — STARTED

- Pipeline: `VIDEO.01–04`, `LIVE.01–04`.
- Intent: add a strict JSON-node post-shoot graph and a browser-visible MVP
  proving the approved shoot → Video or Lucy Live Camera choice.
- Safety: mock/local mode is the default; no fal credential is read, stored,
  logged, or sent, and no billable request is authorized.
- Decision: real Lucy mode requires a server-issued short-lived token plus an
  explicit cost acknowledgement for a bounded session.
- Scope correction: `src/web/app.js` and `web/public/index.html` are reserved
  so the new module has a real server registration and a visible product entry;
  the task is not being delivered as an unreachable backend/static asset.
- Canon correction: reserve `PIPELINE.md` and `docs/VIDEO_LIVE_CANON_UA.md`
  because their former “delayed only” statement contradicts the verified Lucy
  2.5 WebRTC capability. Status remains NOT_DELIVERED until paid live proof.
- Focused proof: schema/compiler tests, route authorization tests, and browser
  contract tests for entry → choice → process → result → next action.
- Help request: NONE.

## Implementation checkpoint

- Added a closed, schema-validated JSON graph for `ART_SHOOT.05 → CHOICE →
  VIDEO/LIVE`.
- Added the visible `/post-shoot-mvp.html` product draft and a home-page entry.
- Local camera preview is free; closing/page-hide stops every camera track.
- Lucy token route allowlists only `decart/lucy-2-5/realtime`, requires
  explicit `$0.04/sec` acknowledgement, caps the session at 60 seconds, and
  cannot call an issuer when approval is absent.
- Production token issuer/WebRTC create remains intentionally inactive.
- Focused tests: `13/13 PASS`; browser visual/interaction smoke PASS; console
  warnings/errors `0`; credential scan PASS.
- Billable/provider calls: `0`.
- weakened_checks: none.
