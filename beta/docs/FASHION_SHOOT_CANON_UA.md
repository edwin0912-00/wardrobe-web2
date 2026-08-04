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
The user-facing output cardinality is a separate product decision; it is
   not inferred from the style-build artifacts. The current operator decision
   fixes it at **five unique Fashion Shoot photographs**. The initial technical
   identity/look check is not one of those five photographs.

## Creative Universe is the style-build backend, not a user output

During creation of a Fashion Shoot style, Creative Universe extracts and
records the supplied shoot references: environment, lighting, camera,
composition, palette, pose language and negative constraints. Its internal
contact/reference sheets are a conditioning and QA artifact. They bind the
style unit so the selected style can be reproduced with an approved avatar.

They are **not** a contact sheet that the user must receive after generating a
Fashion Shoot. They do not define a required `hero → six-frame series` product
flow.

## Naming rule

`editorial`, `Create Universe`, `Art Fashion`, and `creative universe` are not
additional user-facing products. In UI and product copy they are **Fashion
Shoot**. Existing `editorial-*` filenames, routes and persisted identifiers are
compatibility internals; they are not renamed in a product-copy change because
they bind existing receipts, URLs and immutable event history.

## Why the Fashion Shoot client modules exist

- `editorial-state.js` keeps the persisted, validated resume state. It prevents
  reload from duplicating paid jobs and restores only the server-owned shoot.
- `editorial-shoot-ui.js` is an existing legacy prototype for a multi-frame
  editorial execution. It owns immutable Bible binding, SSE with polling
  fallback, hero gate, five-slot concurrency limit, isolated retry and gallery
  display. It is **not the approved Fashion Shoot product contract** until a
  separate decision explicitly chooses a multi-frame consumer output. That
  decision is now five user-facing frames after the internal check.
- `scene-ui.js` is only the chooser: it keeps **Background** and **Fashion
  Shoot** separate before handing the selected fashion unit to the shoot UI.

## Rejected comparison experiment

`comparison/fashion-shoot-single-frame-0ba63c1` preserves Antigravity commit
`0ba63c1` exactly. It maps `shoot.*`/`editorial.*` to a single `SceneService`
image and deletes the legacy multi-frame prototype. It is a comparison only:
it does not prove that its immutable style binding or user output is the right
Fashion Shoot implementation.
