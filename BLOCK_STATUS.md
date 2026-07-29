# Wardrobe — verified block status

Updated: 2026-07-29. This is the short operational map for every agent.
Read it after `UPDATE.md` and before claiming a task.

## Status vocabulary

- **Code** — `TESTED` means a named local test passed on the recorded commit;
  `REPORTED` means an agent reported evidence that the orchestrator has not
  re-run; `MISSING` means no usable implementation.
- **Beta** — `LIVE_SURFACE` means the deployed beta endpoint/card exists;
  `NOT_DEPLOYED` means branch code is not on the beta host.
- **Journey** — only `E2E_PASS` means real beta input → provider/job → all QA
  gates → persisted result was observed. A catalog card, HTTP 200, unit test,
  or `generation: available` is not an E2E pass.

`CATALOG_ONLY` means that cards/API previews respond, but the user cannot yet
enter the product journey. `CONTRACT_ONLY` means metadata responds but no user
action or execution route is deployed. Neither is “live product”.

## Current manual beta audit — 2026-07-29

The current beta process on `127.0.0.1:4176` runs release `aa2dfd2`: the root
placeholder opens, `GET /api/editorial-modes` returns 14 modes and all 14
preview WebPs return `200`. The same public-beta checks now pass at
`beta.madeforthisjob.com` after two unrelated preview tunnels using the same
named tunnel were stopped.

Video is routed under the saved profile, not under `/api/video/*`:
`GET /api/profile/video-clips/:id` reaches the live handler and returns the
expected `CLIP_NOT_FOUND` for an unknown id. The UI opens the video control
from a saved look. A paid clip generation and clip QA have not run yet.
No paid generation, camera consent or personal-media upload was used in this
audit.

**First shared atom:** take one saved-look path through the public 01–04 UI,
then run one controlled video clip through provider and clip QA. Do not patch,
revive or copy any obsolete shell to make the old page appear healthy.

## Product structure — read this before taking a task

**Line boundary:** this map is for `beta-placeholder` only. The current Cloud
Code main-scroll source has not yet been identified by exact branch/commit;
until it is, no historic UI work may be labelled main-scroll or deployed here.

```text
PROFILE.01–03  save/select avatar and approved looks
  └─ LOOK.01–06  avatar + garments → approved white/master look
       ├─ LOOK.07          Improve look (proposed; not live)
       ├─ BACKGROUND.01–02 choose standard background → scene result
       │    └─ BACKGROUND_VIDEO.01–04 product-focus or posing video
       ├─ UNIVERSE.01–04 / ART_SHOOT.01–05
       │    choose one locked fashion-shoot universe → hero → six-frame series/contact sheet
       ├─ VIDEO.01–04      primary Fashion Video from the approved look
       └─ LIVE.01–04       consented Real-time Look; separate from generated video
```

`BACKGROUND.*` and `UNIVERSE/ART_SHOOT.*` are different products. A fashion
shoot’s place, light, camera, palette, pose system and references are one
locked unit; it is not a generic background selector. `VIDEO.*` starts from
the approved master look and does not require a shoot or background.

## Current block map

| Block | Code | Beta | Journey | Exact evidence / next atom |
| --- | --- | --- | --- | --- |
| `PROFILE.01–03` | TESTED | LIVE | E2E_PASS | Same public beta session as `922f8a25…`: explicit completed-run save returned 201 and profile then contained one persisted avatar and one persisted look with 30-day expiry. |
| `LOOK.01–06` | TESTED | LIVE | E2E_PASS | Public beta run `922f8a25…` completed: Conditioning, Avatar and Outfit QA each PASS; approved master/avatar-outfit output and immutable receipts were persisted. The resume repair was active through this journey. |
| `LOOK.07` Improve | MISSING | NOT_DEPLOYED | NOT_RUN | Product canon only; no generation or UI route may be claimed. |
| `BACKGROUND.01` picker | TESTED historical | CATALOG_ONLY | NOT_CURRENT | Beta returns 16 `std.*` cards/previews; public saved-look → picker click is still unproven. |
| `BACKGROUND.02` scene | TESTED (`f23ca9b`) | NOT_DEPLOYED | E2E_FAIL_LOCAL | Native 3:4 route tested; real GPT scene returned but failed strict item fidelity/framing. Next: repair only those failed gates, then run beta. |
| `BACKGROUND_VIDEO.01–04` | MISSING | NOT_DEPLOYED | NOT_RUN | Proposal only; must start from an approved background result. |
| `UNIVERSE.01–02` style picker/packs | TESTED historical | LIVE_SURFACE | NOT_CURRENT | API has 14 modes (12 available) and all previews respond; public saved-look → picker click is still unproven. |
| `UNIVERSE.03–04` hero/series/contact sheet | CODE_PARTIAL | LIVE_SURFACE | NOT_CURRENT | No current beta style → hero → six QA-passed frames → persisted contact-sheet proof. |
| `ART_SHOOT.01–05` | CODE_PARTIAL | LIVE_SURFACE | NOT_CURRENT | Same missing real execution proof as Universe; do not infer it from previews. |
| `VIDEO.01–04` Fashion Video | TESTED route surface (`544e602`) | LIVE_SURFACE | NOT_RUN | Video lives at `/api/profile/video-clips*`; unknown clip returns the expected `CLIP_NOT_FOUND`, and the saved-look UI has the control. Current implementation binds one approved-look reference only; the required second reference is not yet part of its immutable request/receipt. Next: add the two-reference contract, then one controlled clip → ffprobe/clip QA → saved result. |
| `LIVE.01–04` Real-time Look | TESTED historical | CONTRACT_ONLY | PAID_E2E_NOT_RUN | `/api/post-shoot/pipeline` describes Live, but user actions and execution routes are not on current beta. |
| Pipeline explainer | CODE_PARTIAL | ROOT UI BLOCKED | NOT_CURRENT | Technical nodes exist; current result-to-explainer journey still needs beta click smoke. |
| Generation transport | TESTED local | HEALTH_LIVE | PARTIAL | Beta health says generation/semantic QA available. Local GPT Image 2 actually returned a scene; availability is not a successful scene or shoot. |

## Required report shape

Every new task row and `updates/<agent-id>.md` must say, in plain Ukrainian:

```text
Pipeline step: LOOK.06 → VIDEO.01
Code: TESTED — command and commit.
Beta: NOT_DEPLOYED | LIVE_SURFACE — exact release/URL.
Journey: NOT_RUN | E2E_PASS | E2E_FAIL — exact beta run/receipt.
Next atom: one concrete action.
```

No agent may collapse these three statuses into the word “live”.

## Agent position

- **codex-main** — integration, exact deploy ledger, block evidence. Active:
  `BETA-FULL-JOURNEY-GATE-001`.
- **claude-code-20260727-a3f1c8** — style-unit release and motion-stage
  executor. Both remain code work until beta activation and journey proof.
- **antigravity-20260727-fb7a90** — Seedance video implementation is committed
  on `beta`; no live deployment evidence exists yet.
- **codex-video-fidelity-20260728** — full-look first-appearance locking is
  in progress; it protects video and shoot inputs, but does not prove either
  product journey.
- **opencloud-20260727-bc27e6** — health semantic correction is in progress.

## Release rule

1. Agent commits code with a focused test and adds a report.
2. `codex-main` records the commit as **Code** only.
3. Exact commit is deployed to `beta.madeforthisjob.com`.
4. A real beta journey runs through the relevant node/service and persists a
   result or exact failure receipt.
5. Only then the block becomes `E2E_PASS` (or an explicit `E2E_FAIL`).

`main` is the customer-site integration line. It receives a beta capability
only after steps 1–4 are evidenced. Beta remains the parallel engineering
product and does not disappear when main receives the new UI.
