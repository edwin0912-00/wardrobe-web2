# Chat 04 — cross-block lighting and terminal-QA handoff

Date: 2026-07-30  
Product line: `beta-placeholder`  
Pipeline: `BACKGROUND.01–02` with shared Block 1 scene QA and Block 2 settings UI.

## Verified finding

A real `std.city.amber_alley_cobblestone` run exhausted all three image routes
even though identity, item fidelity, scene match, light/contact shadow and
anatomy passed on every candidate. The only terminal defect was deterministic
framing:

- attempt 1: subject `85.5957%`, head clearance `7.8125%`;
- attempt 2: subject `86.7676%`, head clearance `8.0078%`;
- attempt 3: subject `86.0352%`, head clearance `8.0078%`;
- current preferred lock: subject `70–80%`, head clearance at least `8%`.

The first candidate was explicitly accepted by the product owner as
customer-satisfactory. The product owner also explicitly authorized the
requested framing-policy change. Existing immutable receipts must not be
rewritten.

The visible lighting issue is separate: the subject retains a neutral
camera-axis studio fill while the environment uses warm hard backlight. The
current `LIGHT_AND_CONTACT_SHADOW` gate passes because it verifies the rear key
and grounded shadow but does not reject residual studio-softbox illumination.
The current lighting-preview asset also omits the neutral test subject required
by its own prompt, so it does not demonstrate how environment light should
fall across face, skin and clothing.

## Owner request

### Block 1 — scene runtime and QA

Please issue one generic scene-core atom, not a preset exception:

1. Keep `70–80%` as the preferred framing target.
2. Add a product-approved hard-safe terminal band of `65–87%` only when the
   complete head and footwear are visible and every semantic/anatomy gate
   passes.
3. Continue attempting measured framing repair inside the retry budget.
4. If repair exhausts inside the hard-safe band, deliver the best immutable
   candidate with an advisory instead of terminal `QA_EXHAUSTED`.
5. Add a lighting-coherence verdict that rejects an independent neutral
   camera-axis softbox when it contradicts the declared environment key,
   temperature and contrast.
6. Preserve exact identity and item locks; no padding, blur, stretch, copied
   edge, synthetic crop expansion or rewritten evidence.

This atom has `weakened_checks` because the terminal framing acceptance band is
wider. Product-owner approval is recorded above; integration still requires a
focused pre-change failure and adversarial review.

### Block 3 — immutable standard-background pack

Please version the affected pack rather than rewriting v1:

1. State that master-image background, exposure, shadows and studio lighting
   have zero scene authority.
2. Set environment lighting authority to full strength.
3. Express ambient/front fill as at most `30%` of the environment key
   (approximately `-1.7 EV`) and prohibit an independent camera-axis softbox.
4. Keep face and item detail readable through physically plausible sky/stone
   bounce, not studio relighting.
5. Replace the lighting preview only through the approved asset/provenance
   workflow. No paid regeneration is authorized by this report.

### Block 2 — user setting

Please add one honest beta-placeholder setting:

- label: `Вплив вихідного світла`;
- range: `0–40%`;
- default: `30%`;
- helper text: `Наскільки зберігати освітлення master-образу. Environment
  залишається головним джерелом світла.`;
- persist the value in the browser draft/profile settings and send it through
  an explicit typed request field;
- do not make the UI imply that identity or item fidelity is being reduced.

The backend must validate and clamp the typed value. The UI must not invent a
client-only control that the runtime ignores.

## Status

- Code: `NOT_IMPLEMENTED — ownership handoff only`
- Beta: `NOT_DEPLOYED`
- Journey: `E2E_FAIL — three valid candidates terminated on framing`
- Blocker: implementation crosses Block 1 scene-core, Block 3 media-assets and
  Block 2 public-ui ownership; Chat 04 owns none of those paths.
- weakened_checks: `terminal framing acceptance expands from preferred
  70–80% to hard-safe 65–87% under strict full-head/full-footwear and
  all-semantic-gates-pass conditions; explicitly approved by product owner`

---

## Block 4 mood-card recovery

The complete source-unit/catalog recovery is already content-equivalent in
current `beta`: across the 158 paths touched by the preserved four-commit
sequence, 144 exact blobs already match `beta`. The only genuinely absent
approved content is seven WebP/JSON mood-card pairs:

- `shoot.grey_studio_stride`
- `shoot.hardsun_brick_doorway`
- `shoot.ochre_stage_tailoring`
- `shoot.sky_dune_surreal`
- `shoot.skylight_haze`
- `shoot.terracotta_hardlight`
- `shoot.window_gobo_warm`

This Block 4 atom restores only those 14 exact files. Every JSON sidecar binds
the current unit contract, unit manifest, runtime style, palette authority,
provider receipt and exact WebP SHA-256. It does not recover the 105-file WIP
snapshot, rewrite a style unit, modify Fashion Shoot execution or regenerate
media.

- Code: `PASS — this Block 4 commit; node --test
  test/web/create-universe-units.test.js
  test/web/create-universe-runtime-style.test.js
  test/release/product-release.test.js (5/5)`
- Beta: `NOT_DEPLOYED`
- Journey: `NOT_RUN — immutable catalog asset atom`
- weakened_checks: `none`

---

## Prior slot-pose and subject-light worktree evidence

Pipeline: `UNIVERSE.03–04` → `ART_SHOOT.01–05`.

Code: TESTED — branch `beta-chat-04-shoot-back-pose-lighting`; generic static
blocking diagrams are no longer provider pose references for `shoot.*`, every
compiled shot carries `subject_lighting`, and `shoot.shutter_amber_interior`
binds a distinct slatted-light interaction for each slot. `shoot.terracotta_hardlight`
keeps head/body rotation in its sculptural slot pose, not in the unit-wide
expression signature.

Focused checks: `node --test test/web/editorial-shot-anchors.test.js`;
`node --test test/web/create-universe-units.test.js`;
`node --test --test-name-pattern='Create Universe generation omits'
test/web/scene-adapters.test.js`; resolver compilation probes for Shutter and
Terracotta; all passed. `test/web/editorial-activation-backend.test.js` was
stopped after it did not terminate in that worktree; the direct resolver probes
cover the modified compiler paths.

Beta: NOT_DEPLOYED. Journey: NOT_RUN. weakened_checks: none.
