Agent ID: antigravity-20260727-fb7a90
Protocol ACK: 036b20a28f5a284b922b67fec5f008bebc06a5cb

---

## BETA-UNIVERSE-001 — UNIVERSE.01–02 · Два нові fashion shoot стилі

Task ID: BETA-UNIVERSE-001
State: STARTED → ASSETS_ONLY — NOT IN PRODUCT
Rationale/decision: Both male style units lack required contract components that
cannot be supplied without generating pixels (which is explicitly forbidden).
Result: ASSETS_ONLY — NOT IN PRODUCT

### Missing contract fields — `shoot.ochre_stage_tailoring`

| Required component | Status |
| --- | --- |
| `manifest.json` | ❌ Missing entirely |
| `sheet-environment.png` | ❌ Missing (listed in `sheets_pending`) |
| `sheet-colour_grade.png` | ❌ Missing (listed in `sheets_pending`) |
| `sheet-camera_lens.png` | ✅ Present (3,569,091 bytes) |
| `sheet-blocking.png` | ✅ Present (5,563,748 bytes) |
| `sheet-garment_behaviour.png` | ✅ Present (5,192,899 bytes) |
| `sheet-expression_gaze.png` | ✅ Present (4,491,180 bytes, not in required set) |
| `unit.json` schema | ⚠️ Draft format: has `sheets_present`/`sheets_pending` instead of standard `sheets` prompt object |
| `palette-strip.svg` | ⚠️ Non-standard: 840×180 vs required 1600×260 |
| Mood card preview | ✅ Present in `assets/scene-mood-cards/` (87,600 bytes webp) |

### Missing contract fields — `shoot.shutter_amber_interior`

| Required component | Status |
| --- | --- |
| `manifest.json` | ❌ Missing entirely |
| `sheet-environment.png` | ❌ Missing (listed in `sheets_pending`) |
| `sheet-colour_grade.png` | ❌ Missing (listed in `sheets_pending`) |
| `sheet-camera_lens.png` | ✅ Present (3,393,637 bytes) |
| `sheet-blocking.png` | ✅ Present (5,975,855 bytes) |
| `sheet-garment_behaviour.png` | ✅ Present (5,645,610 bytes) |
| `sheet-expression_gaze.png` | ✅ Present (4,138,527 bytes, not in required set) |
| `unit.json` schema | ⚠️ Draft format: has `sheets_present`/`sheets_pending` instead of standard `sheets` prompt object |
| `palette-strip.svg` | ⚠️ Non-standard: 840×180 vs required 1600×260 |
| Mood card preview | ✅ Present in `assets/scene-mood-cards/` (151,890 bytes webp) |

### Why they cannot compile

The resolver (`src/web/scene-resolvers.js`, line 710) requires exactly five
sheets per unit:

```javascript
const CREATE_UNIVERSE_REQUIRED_SHEETS = Object.freeze([
  'environment', 'colour_grade', 'camera_lens', 'garment_behaviour', 'blocking',
]);
```

Both units are missing `environment` and `colour_grade`. Without `manifest.json`,
the resolver catches the read error and marks the unit `BLOCKED_UNIT_MISSING`
(line 694–705). Even if a manifest were created from existing sheets, only 3 of
5 required sheets exist, so the unit would be `BLOCKED_INTEGRITY_MISMATCH`.

Generating the missing sheets would require creating new image pixels, which
violates the task stop condition: "No invented references, hashes, or generated
pixels."

### What exists and is valid

- Source reference photos in `source/` directories (2 frames for ochre, 3 for
  shutter_amber)
- 4 of 7 reference sheets each (camera_lens, blocking, expression_gaze,
  garment_behaviour)
- Draft `unit.json` with palette, source_frames, compatibility, and unknowns
- `palette-strip.svg` (non-standard dimensions)
- Mood card previews in `assets/scene-mood-cards/` with valid sidecars

### To make them product styles, the following is needed

1. Supply `sheet-environment.png` for both units (cannot be invented)
2. Supply `sheet-colour_grade.png` for both units (cannot be invented)
3. Create `manifest.json` with all sheet SHA-256 hashes and metadata
4. Upgrade `unit.json` to production schema with `sheets` prompt object
5. Register in `CREATE_UNIVERSE_MODE_META` in `src/web/scene-resolvers.js`

Evidence command: `node --test test/web/editorial-preview-api.test.js test/contracts/scene-production-packs.test.js`
weakened_checks: none.
Help request: NONE — the missing sheets are an asset/rights supply question,
not a code question. When the sheets are supplied, registration is mechanical.
Next action: awaiting owner to supply the two missing required sheets per unit.

---

## BETA-UI-001 — PROFILE.03 · Вибір одного з кількох образів (DONE)

Task ID: BETA-UI-001
Commit tested: 205a8c4
Result: FIX VERIFIED — live in beta release `ac7259b`.

### Bug description

`resolveSavedAvatarTransition()` in `add-items-flow.js` returned `OPEN_LOOK`
whenever any look existed for the avatar. This bypassed the look grid and
auto-opened the newest look, hiding all other looks from the user.

### Fix

Changed the condition from `selection.look ? 'OPEN_LOOK' : 'FILTER_AVATAR'` to
`avatarLooks.length === 1 ? 'OPEN_LOOK' : 'FILTER_AVATAR'`. This means:

- **0 looks**: `FILTER_AVATAR` — show empty grid with "create new look" prompt
- **1 look**: `OPEN_LOOK` — auto-open the only look (no ambiguity)
- **2+ looks**: `FILTER_AVATAR` — show the look grid so the user can choose

### Files changed

- `web/public/add-items-flow.js` — fixed `resolveSavedAvatarTransition()`
- `test/web/profile-ui-flow.test.js` — updated tests for new behavior + added
  single-look test case

### Test verification

- `node --test test/web/profile-ui-flow.test.js test/web/add-items-flow.test.js`
  — 24/24 tests pass
- No product files outside reserved paths were touched

Evidence command: `node --test test/web/profile-ui-flow.test.js`
weakened_checks: none.
Help request: NONE
