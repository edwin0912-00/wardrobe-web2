# Chat 02 — saved-look action hub

Date: 2026-07-30
Base: `5fab5b4095711821a5a256d4063a80d659d5478a`

## Result

- Replaced the long saved-look guide and three nested briefs with one compact
  action dock: Background, Improve, Fashion Shoot, Fashion Video and Real-time
  Look.
- Primary labels wrap instead of clipping or ellipsizing.
- Opening a saved look no longer forces `scrollIntoView`.
- Fashion Video is fail-closed and reads the profile-owned
  `/api/profile/looks/:lookId/video-capability` contract. It enables only when
  the approved master, verified style reference and verified motion reference
  are all true.
- Real-time Look is fail-closed and reads
  `/api/post-shoot/realtime-look-capability`. It accepts only the same-origin,
  full-viewport, non-nested, no-internal-scroll launch contract with explicit
  privacy/cost/camera requirements, then navigates in `_self`.
- Removed the saved-look Live iframe. Video and Live presentation surfaces are
  full viewport; Video has no nested internal scroll.

## Evidence

- `node --test test/web/profile-navigation.test.js test/web/profile-ui-flow.test.js`
  — 19/19 PASS.
- Broader profile/UI suite — 48/48 PASS before the final capability-only
  wiring; the focused suite remained 19/19 after it.
- WebKit at 1440×900: the saved-look action dock is fully visible in one
  viewport. Video surface measured `clientHeight=900`, `scrollHeight=900`,
  `overflow=hidden`, `maxHeight=none`, `borderRadius=0`.

Code: PASS on this branch.
Beta: NOT_DEPLOYED.
Journey: NOT_RUN on public beta until Block 6 and Block 7 capability commits
and this Block 2 commit are integrated together.
weakened_checks: none.
