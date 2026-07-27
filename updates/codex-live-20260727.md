# codex-live-20260727

Protocol ACK: 29045a9

## BETA-POSTSHOOT-RECON-001 — RESUMED 2026-07-27

- Operator decision: integrate Lucy at the selected saved master-look, not on
  the standalone upload test site.
- Exact product flow: selected look → in-product Live surface → same-origin
  saved-look image becomes the Lucy reference automatically → camera → separate
  paid consent.
- Implementation and QA will not make a consented or billable provider call.

## BETA-POSTSHOOT-RECON-001 — IMPLEMENTATION PASS

- The selected saved look now exposes `Приміряти Live`.
- Live opens as a same-site overlay, not the standalone upload test flow.
- The exact saved-look image is fetched through the authenticated profile image
  route and converted into Lucy's reference input automatically.
- Closing the overlay destroys the iframe, which triggers the existing
  `pagehide` camera-track cleanup.
- Focused proof: 33/33 PASS across profile flow, add-items regression,
  post-shoot routes, and JSON graph contract; local HTTP entrypoints return 200.
- Paid proof: NOT RUN. No consented token/provider request was made.
- State: READY_FOR_BETA_DEPLOY; exact SHA will be recorded after commit.

## BETA ACTIVATION

- Product commit: `71a279c`.
- Active beta release: `release-71a279c-20260727205200`.
- `https://beta.madeforthisjob.com/api/health`: `ready`.
- Public HTML smoke confirms the selected-look Live action, overlay, current
  cache tokens, and removal of the standalone test-site header entry.
- Safe token smoke without paid consent remains HTTP 409.
- Beta log after restart has no startup/runtime error.
- Paid Lucy/camera proof remains intentionally not run.

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

## READY_FOR_BETA_DEPLOY

- Exact product commit: `942c9e8`.
- Activation requested for that exact SHA.
- Paid Lucy/WebRTC smoke remains excluded until Edwin explicitly authorizes
  the stated five-second duration and maximum `$0.20` cost.

## READY_FOR_BETA_DEPLOY

- Exact product commit: `917e1ef`.
- Activation requested for that exact SHA.
- Narrow beta smoke: `/post-shoot-mvp.html` renders both choices and
  `/api/post-shoot/pipeline` returns the validated graph.
- Real Lucy/WebRTC smoke is explicitly excluded until Edwin approves a stated
  duration and maximum cost.

## BETA-LIVE-5S-001 — STARTED

- Target: `live.madeforthisjob.com`.
- Add one local reference-photo upload and a five-second hard ceiling.
- Maximum stated provider cost: `$0.20`.
- Provider credential activation and billable smoke remain excluded.

## BETA-LIVE-5S-001 — IMPLEMENTED

- Added JPEG/PNG/WebP reference-photo selection with browser-side 512×512
  validation and object-URL cleanup; the image remains local in draft mode.
- Tightened the JSON contract, compiler assertion, API authorization route,
  UI consent copy, and token-issuer request to exactly five seconds.
- The server refuses any other duration before provider access and reports a
  maximum session cost of `$0.20`.
- Focused tests: `14/14 PASS`; JavaScript syntax and diff checks PASS;
  credential-fragment scan PASS.
- Billable/provider calls: `0`.
- weakened_checks: none.
