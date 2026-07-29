# Wardrobe beta — release master plus seven-block operating model

Effective: 2026-07-29.

This document is the shared work contract for Chat 00 and chats 1–7. `beta` is the tested
integration line and the only source that may be deployed to
`beta.madeforthisjob.com`. Product agents work only in their assigned block
branch. `main` remains the future customer-site line and is not changed by this
workflow.

## Branch topology

```text
beta
├── beta-release-master
├── beta-block-08-antigravity-qa
├── beta-block-1-core-look
├── beta-block-2-profile-ui
├── beta-block-3-backgrounds
├── beta-block-4-universe
├── beta-block-5-fashion-shoot
├── beta-block-6-fashion-video
└── beta-block-7-realtime-look
```

Only `chat-00-master` integrates a tested block commit into `beta`, builds the
exact release, activates it, and records public-beta evidence. Its complete
contract is `docs/coordination/blocks/00-release-master.md`. Block owners never
push directly to `beta` or `main` and never deploy.

`beta-block-08-antigravity-qa` is a permanent observer, not an eighth product
owner. It watches all seven branches, tests the exact deployed beta SHA in a
real browser, and publishes independent evidence. Its contract is
`docs/coordination/blocks/08-antigravity-qa.md`.

## Shared proof language

Every report contains all three fields:

- **Code** — exact commit and focused test.
- **Beta** — `NOT_DEPLOYED`, or the exact activated release and URL.
- **Journey** — `NOT_RUN`, `E2E_FAIL`, or `E2E_PASS` with the run, job or
  receipt that proves it.

Every report also contains `weakened_checks`. A non-empty value requires Edwin's
explicit approval before integration.

## Block 1 — inputs, avatar, clothing, master look and QA

- Branch: `beta-block-1-core-look`
- Owner: `codex-main` / chat 1. This is product ownership, not release authority.
- Pipeline: `LOOK.01–07`, backend persistence needed by `PROFILE.01–03`, and
  the complete QA contract used by `BACKGROUND.02`.

Input:

- one or more person/identity photographs;
- one or more clothing/accessory photographs;
- an optional approved saved avatar;
- explicit selection when two different items occupy one category.

Output:

- visibly extracted identity and item facts;
- immutable source bindings and hashes;
- approved avatar;
- approved clothing reference cards and deterministic cutouts;
- approved white/master look;
- immutable candidate, provider and QA receipts;
- saved avatar/look available to downstream blocks.

This block owns:

- upload/input validation and draft-to-run binding;
- visible-facts extraction and duplicate-item resolution;
- Nano Banana 2 → GPT Image 2 → Nano Banana Pro fast route;
- avatar, clothing and complete-look QA;
- restart/resume and provider idempotency;
- optional Improve Look contract;
- standard-background identity, item, framing, anatomy, light and contact-shadow
  QA, including precise rejection receipts.

The accepted surface-fidelity rule is narrow: weave, grain, gloss and
microtexture may be advisory when product identity is unchanged. Visible
silhouette, colour, logo/text, panel layout, distinctive geometry, missing
items or unauthorized additions remain blocking.

Block 1 reserved code:

- `src/conditioning/**`
- `src/runner/**`
- `src/providers/**` for image/VLM/privacy routes
- `src/web/run-service.js`
- `src/web/profile-service.js`
- `src/web/garment-*`
- `src/web/scene-contract.js`
- `src/web/scene-service.js`
- `src/web/scene-runtime.js`
- `src/web/scene-adapters.js`
- `src/web/scene-resolvers.js`
- `src/web/scene-routes.js`
- `src/web/*scene-evaluator*`
- corresponding conditioning, runner, garment, run, profile, scene and QA
  schemas/tests.

Block 3 owns scene packs and UI but may not change this backend or its QA.

Required journey proof:

```text
person + clothing inputs
→ visible-facts extraction
→ clothing reference candidate(s)
→ clothing QA
→ avatar candidate
→ identity/framing QA
→ master-look candidate
→ identity + item + anatomy + framing QA
→ persisted approved look
→ one standard background
→ background QA receipt
```

## Block 2 — profile, upload UX and navigation

- Branch: `beta-block-2-profile-ui`
- Owner: chat 2.
- Pipeline: user-facing `PROFILE.01–03`, `LOOK.01–06`, `CHOICE.01–02`, and
  the engineering pipeline explainer.

This block owns browser drafts, refresh recovery, saved avatars/looks, adding
new clothing to one existing avatar, duplicate choice UI, live node/progress
display, honest post-look actions and final pipeline titles/explanation.

It owns `web/public/index.*`, shared upload/profile/progress/choice UI and
browser tests. It does not change generation, persistence backend or QA.

Required journey proof: uploads remain attached to their own fields; refresh
restores the draft; a saved avatar opens; Add clothing does not request a new
avatar; progress reflects backend state; completed look opens honest next
actions.

## Block 3 — standard backgrounds and background-result UX

- Branch: `beta-block-3-backgrounds`
- Owner: chat 3.
- Pipeline: `BACKGROUND.01–02` and the `BACKGROUND_VIDEO.01–04` choice shell.

This block owns all sixteen `std.*` packs, provenance/hashes, the scene picker,
scene result/retry/save UI, and the two background-video choices. It owns
standard scene assets/config and `web/public/scene-*`. It does not change
`src/web/scene-*`; Block 1 owns execution and QA.

Required journey proof: sixteen cards open; one selected preset binds the exact
pack; saved look → provider → Block 1 QA → persisted scene passes publicly;
then the controlled sixteen-preset matrix records each terminal outcome.

## Block 4 — Creative Universe style construction

- Branch: `beta-block-4-universe`
- Owner: chat 4.
- Pipeline: `UNIVERSE.01–02`.

This block owns source-photo observations, environment/light/camera/palette/
blocking/garment-behaviour sheets, manifests, hashes, rights/provenance,
catalog and previews under `docs/style-units/**` and
`skills/artshoot-pipeline-style-creation/**`.

It does not change Fashion Shoot execution. A style is selectable only when its
own immutable pack compiles. A `std.*` background is never its style authority.

Required journey proof: every published style passes manifest/reference
integrity; selection persists the exact style version and hashes.

## Block 5 — Fashion Shoot execution

- Branch: `beta-block-5-fashion-shoot`
- Owner: chat 5.
- Pipeline: `UNIVERSE.03–04` and `ART_SHOOT.01–05`.

This block owns Shoot Bible compilation, hero generation, identity/item/style
QA, five visible customer frames, independent frame retry, persistence and
internal reference/contact evidence under `src/web/editorial-*`,
`schemas/editorial-*`, `web/public/editorial-*` and related tests.

It consumes Block 4 packs without rewriting them. Internal sheets are evidence,
not an invented sixth customer frame.

Required journey proof: approved look + one exact style → hero → strict QA →
five unique persisted customer frames; one failed frame retries without
regenerating passed siblings.

## Block 6 — generated Fashion Video

- Branch: `beta-block-6-fashion-video`
- Owner: chat 6.
- Pipeline: `VIDEO.01–04` and backend execution for
  `BACKGROUND_VIDEO.01–04`.

This block owns immutable references/motion plans, Seedance/provider transport,
ffprobe and cross-frame identity/item QA, video routes and saved clips under
`src/web/{video,motion}-*`, `src/providers/*video*`, video/motion configs,
schemas, tests and dedicated UI modules.

Required journey proof: real approved source → provider job → real MP4 receipt
and job ID → dimensions/duration/FPS/audio QA → identity/item QA → persisted
clip that reopens from profile.

## Block 7 — Real-time Look

- Branch: `beta-block-7-realtime-look`
- Owner: chat 7.
- Pipeline: `LIVE.01–04`.

This block owns camera permission, privacy/cost consent, real live preview,
reference-bound overlay, explicit capture/save and complete teardown under
`src/web/live-*`, `web/public/live-*`, `test/live/**` and live contracts.

Required journey proof: denied permission is handled; granted permission opens
the actual camera; ending without save persists nothing; only explicit capture
saves an artifact; no personal media leaves the browser before consent.

## Integration-only paths

These are changed only by `chat-00-master` while integrating an accepted handoff:

- `src/web/app.js`
- `src/web/start.js`
- shared server bootstrap and release tools
- `package.json` / lockfile
- `AGENTS.md`, `OWNERS.md`, `UPDATE.md`, `BLOCK_STATUS.md`, `STATE.md`,
  `LOG.md`

A block owner that needs one of these files supplies the exact minimal wiring
diff in its report; it does not edit the shared file.

## Block 0.8 — independent Antigravity QA

- Branch: `beta-block-08-antigravity-qa`
- Owner: `antigravity-qa`, running Gemini/Antigravity.
- Pipeline: observes every Block 1–7 journey after integration.

It owns only `updates/antigravity-qa.md`,
`docs/qa-reports/antigravity/**`, and local ignored evidence. It starts at the
visible public UI, records screenshots plus console/network evidence, refreshes
at persistence boundaries, and binds every verdict to the exact code and
deployed SHAs. It never edits product code or deploys.

Its bounded goal-loop is compiled under
`ops/loops/antigravity-beta-qa/`. The Git watcher may run continuously, but
each browser campaign stops on PASS, the first confirmed defect, two stalled
iterations, or 45 minutes.

## Agent cycle

1. Fetch `origin/beta`, all seven product refs and the Block 0.8 QA ref.
2. Read this document plus the assigned block handoff.
3. Work only in the assigned branch and paths.
4. Commit code + focused test + `updates/chat-<N>.md`.
5. Push only the assigned block branch.
6. Report commit, changed paths, Code/Beta/Journey, blocker and next atom.
7. `chat-00-master` reviews, integrates one atomic change into `beta`, deploys the
   exact SHA and records the public journey.

No branch may hide failing checks, rewrite immutable evidence, commit secrets
or personal media, use paid generation without authorization, or touch
`site.madeforthisjob.com` / port `4180`.
