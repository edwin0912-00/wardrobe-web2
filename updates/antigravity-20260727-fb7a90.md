Agent ID: antigravity-20260727-fb7a90
Task ID: BETA-UI-001
Commit tested: (pending push)
Rationale/decision: Fixed the saved-avatar → look grid transition so users with
multiple looks see all their looks instead of being auto-navigated to the newest
one. Single-look avatars still auto-open.
Result: FIX VERIFIED

## Bug description

`resolveSavedAvatarTransition()` in `add-items-flow.js` returned `OPEN_LOOK`
whenever any look existed for the avatar. This bypassed the look grid and
auto-opened the newest look, hiding all other looks from the user.

## Fix

Changed the condition from `selection.look ? 'OPEN_LOOK' : 'FILTER_AVATAR'` to
`avatarLooks.length === 1 ? 'OPEN_LOOK' : 'FILTER_AVATAR'`. This means:

- **0 looks**: `FILTER_AVATAR` — show empty grid with "create new look" prompt
- **1 look**: `OPEN_LOOK` — auto-open the only look (no ambiguity)
- **2+ looks**: `FILTER_AVATAR` — show the look grid so the user can choose

## Files changed

- `web/public/add-items-flow.js` — fixed `resolveSavedAvatarTransition()`
- `test/web/profile-ui-flow.test.js` — updated tests for new behavior + added
  single-look test case

## Test verification

- `node --test test/web/profile-ui-flow.test.js test/web/add-items-flow.test.js`
  — 24/24 tests pass
- No product files outside reserved paths were touched

Evidence command: `node --test test/web/profile-ui-flow.test.js`
weakened_checks: none.
Help request: NONE
Next action: awaiting orchestrator to verify and mark DONE.
