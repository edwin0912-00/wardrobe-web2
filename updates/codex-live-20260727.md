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
- Focused proof: schema/compiler tests, route authorization tests, and browser
  contract tests for entry → choice → process → result → next action.
- Help request: NONE.
