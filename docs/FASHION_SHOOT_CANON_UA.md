# Fashion Shoot — canonical product boundary

User-facing product name: **Fashion Shoot**.

## Two intentionally different image products

1. **Background** — the owner selects one standard environment (`std.*`); the
   output is one independent background image. It is executed by `SceneService`.
   It must never acquire a shoot series, a contact sheet, or creative-style
   semantics by accident.
2. **Fashion Shoot** — the owner selects one locked visual unit (`shoot.*` or a
   legacy-compatible `editorial.*`). Its location, lighting, lens, grade,
   poses, framing and reference pack are one indivisible creative system.
   The output is a QA-gated hero followed by a six-frame series and contact
   sheet. It is executed by `EditorialShootService` through its scene executor.

## Naming rule

`editorial`, `Create Universe`, `Art Fashion`, and `creative universe` are not
additional user-facing products. In UI and product copy they are **Fashion
Shoot**. Existing `editorial-*` filenames, routes and persisted identifiers are
compatibility internals; they are not renamed in a product-copy change because
they bind existing receipts, URLs and immutable event history.

## Why the Fashion Shoot client modules exist

- `editorial-state.js` keeps the persisted, validated resume state. It prevents
  reload from duplicating paid jobs and restores only the server-owned shoot.
- `editorial-shoot-ui.js` owns Fashion Shoot state transitions: immutable Bible
  binding, SSE with polling fallback, hero gate, five-slot concurrency limit,
  isolated retry, cancel/delete and full-frame/contact-sheet display.
- `scene-ui.js` is only the chooser: it keeps **Background** and **Fashion
  Shoot** separate before handing the selected fashion unit to the shoot UI.

## Rejected comparison experiment

`comparison/fashion-shoot-single-frame-0ba63c1` preserves Antigravity commit
`0ba63c1` exactly. It maps `shoot.*`/`editorial.*` to a single `SceneService`
image and deletes the state/UI modules. It is useful only as a comparison; it
is not a beta product candidate because it removes the approved Fashion Shoot
contract (hero → series → contact sheet).
