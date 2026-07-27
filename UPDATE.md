# Wardrobe update board

This is the only live coordination board for the current sprint.

The earlier detailed noticeboard is preserved at
[`docs/coordination/UPDATE_ARCHIVE_2026-07-27.md`](docs/coordination/UPDATE_ARCHIVE_2026-07-27.md).

## Branches and live test

- Safe baseline: `main` — agents never write here.
- Shared work: `beta` — every approved small change is committed and pushed
  here.
- Live test: `https://beta.madeforthisjob.com` — deploy the exact tested beta
  commit, then record its result below.

## Current verified state

- Beta is healthy (`ready`).
- Create Universe catalog exposes five locked `shoot.*` styles.
- Four styles are generation-ready. `shoot.terracotta_hardlight` remains
  visible but blocked by a real SHA-256 reference mismatch; do not bypass it.
- `iwas.madeforthisjob.com` is outside this sprint's deployment flow.
- Higgsfield is authenticated on the beta host. Magnific has no accepted API
  credential on the host yet; it is not an active beta provider.
- OpenRouter has a validated backup credential in the beta host secure store.
  It is not the active provider and its secret is never committed or reported.
- `BETA-POST-SHOOT-001` belongs to the external `codex-live-20260727`
  workstream. Its VIDEO/LIVE files are reserved; all other agents observe and
  do not duplicate or edit that implementation until its owner reports a
  tested handoff.

## Що робимо зараз — людською мовою

Повна карта: [`PIPELINE.md`](PIPELINE.md). Назва кроку нижче — точне місце в
продукті, а не вигаданий загальний лічильник.

1. **Профіль → аватар → обрати збережений образ → додати речі.** Уже live:
   якщо в аватара кілька образів, відкривається сітка вибору.
2. **Образ → Create Universe → обрати fashion shoot.** Два нові стилі мають
   референси й style sheets, але ще не додані до каталогу сайту. Це робота
   Antigravity.
3. **Генерація кадру.** Claude має додати Magnific лише як резервний API для
   генерації. Це не новий екран і не блокує нинішній Higgsfield route. Коду
   ще немає.
4. **Terracotta style.** Він видимий, але чесно заблокований: хеші шести
   reference-файлів не відповідають файлам. Обхідного увімкнення не буде.

## Active queue

| ID | Назва / місце в пайплайні | Owner | State | Type | Reserved paths | One concrete outcome |
| --- | --- | --- | --- | --- | --- |
| BETA-SMOKE-001 | UNIVERSE.01–02 · Перевірка каталогу Create Universe | antigravity-20260727-fb7a90 | DONE | QA | `updates/antigravity-20260727-fb7a90.md` | PASS: API/UI previews expose the five expected `shoot.*` styles; four are generation-ready and Terracotta is correctly blocked. |
| BETA-PROVIDER-001 | GENERATION_TRANSPORT · Magnific як резервний API | claude-code-20260727-557761 | CANCELLED | CODE | `src/providers/magnific-imagegen-provider.js`; `src/web/generation-provider.js`; `test/providers/magnific-imagegen-provider.test.js`; `updates/claude-code-20260727-557761.md` | Cancelled by operator decision 2026-07-27: the Magnific route is dropped, work stays on beta with the Higgsfield route that is already authenticated on the host. No provider file was created. |
| BETA-UI-001 | PROFILE.03 · Вибір одного з кількох образів | antigravity-20260727-fb7a90 | DONE | CODE | `web/public/add-items-flow.js`; `web/public/profile-client.js`; `test/web/add-items-flow.test.js`; `test/web/profile-ui-flow.test.js`; `updates/antigravity-20260727-fb7a90.md` | PASS: multi-look avatar selection now opens the look grid; `205a8c4` passed 24/24 focused tests and is live inside beta release `ac7259b`. |
| BETA-UNIVERSE-001 | UNIVERSE.01–02 · Два нові fashion shoot стилі | antigravity-20260727-fb7a90 | READY | CODE | `src/web/scene-resolvers.js`; `test/web/editorial-preview-api.test.js`; `test/contracts/scene-production-packs.test.js`; `docs/style-units/shoot.ochre_stage_tailoring/**`; `docs/style-units/shoot.shutter_amber_interior/**`; `updates/antigravity-20260727-fb7a90.md` | Turn the two existing male Create Universe units into strict product styles only if their manifests/reference packs compile and preview tests pass; then request beta activation of the exact SHA. Otherwise record `ASSETS_ONLY — NOT IN PRODUCT` with the precise missing contract fields. |
| BETA-STD-001 | BACKGROUND.01–02 · Звичайні фони `std.*` | antigravity-20260727-fb7a90 | READY | CODE | `assets/scene-presets/**`; `config/scene-presets.json`; `prompts/scene-presets/**`; `test/contracts/scene-preset-catalog.test.js`; `updates/antigravity-20260727-fb7a90.md` | Operator-directed (relayed by claude-code-20260727-557761). Кожен `std.*` пресет отримує environment plate і lighting preview, які читаються як знята локація, а не як фотофон: узгоджене напрямлене світло, контактна тінь під людиною, повітряна перспектива. Доказ — по одному кадру на пресет з тим самим затвердженим луком і записаним вердиктом; жодних нових пікселів у доставку та без послаблення framing-локів. |
| BETA-POST-SHOOT-001 | VIDEO.01–04 + LIVE.01–04 · Вибір Video або Lucy Live Camera після approved shoot | codex-live-20260727 | READY_FOR_BETA_DEPLOY | CODE | `config/post-shoot-pipeline.json`; `schemas/post-shoot-pipeline.schema.json`; `src/web/post-shoot-pipeline.js`; `src/web/post-shoot-routes.js`; `src/web/app.js`; `web/public/index.html`; `web/public/post-shoot-mvp.html`; `web/public/post-shoot-mvp.js`; `web/public/post-shoot-mvp.css`; `test/contracts/post-shoot-pipeline.test.js`; `test/web/post-shoot-routes.test.js`; `docs/LUCY_LIVE_MVP_UA.md`; `docs/VIDEO_LIVE_CANON_UA.md`; `PIPELINE.md`; `updates/codex-live-20260727.md` | `917e1ef`: schema-validated approved-shoot → Video/Lucy UI and guarded token boundary; focused tests 13/13 PASS, browser interaction/visual smoke PASS, provider calls 0. Activate this exact SHA on beta, then smoke `/post-shoot-mvp.html` and `/api/post-shoot/pipeline`; real Lucy remains disabled pending separate paid authorization. |

## Agent protocol

1. New agents run the one bootstrap command from `START_HERE.md`; existing
   clones run `bash tools/join-beta-agent.sh <agent-id> --watch`. Then read
   `AGENTS.md`, this file, and `STATE.md`.
2. Work only on your assigned row. If `codex-main` is unavailable, an online
   agent may self-claim one `unassigned` + `READY` row in a small board commit;
   never self-claim `WAITING`, `BLOCKED`, or `DONE`. Parallel code rows are
   normal when their Reserved paths do not overlap.
3. A task directly assigned by Edwin to an agent may be created by that agent:
   it adds one row with its owner, exact Reserved paths, and a testable outcome,
   then commits `STARTED` before product edits. A path collision becomes
   `PROPOSED`, not a second active edit.
4. Code agent: one focused change, one focused test, one commit, then push to
   `beta`. Include `updates/<agent-id>.md` in that same commit. After a
   passing focused test, mark the exact SHA `READY_FOR_BETA_DEPLOY`; beta
   activation and a narrow live smoke check are the immediate next atomic
   actions. A remote agent may not claim live activation it cannot perform.
5. Research/QA agent: do not modify product code. Write only
   `updates/<agent-id>.md`, commit, pull-rebase, push. A report may set
   `Help request: <what is needed>`; otherwise it writes `Help request: NONE`.
6. Do not overwrite this board. `codex-main` curates it; a self-claiming agent
   may change only its own row and then report the result.

Every agent commit subject starts `[agent:<agent-id>]`; this and the matching
`updates/<agent-id>.md` make ownership visible even with one shared GitHub
login.

Before an agent starts its next product-code task, it must fetch this commit
and add `Protocol ACK: <commit-sha>` to its own update. This is the required
Git-backed acknowledgement of the beta completion contract.

Each agent additionally keeps `.agent-local/<agent-id>.md` on its own Mac.
It records concise operational rationale (intent, decision, risk, evidence,
next action) and syncs against this board, `STATE.md`, and `LOG.md`. It is
intentionally local and never committed; shared reports contain only verified
facts.

## Latest events

- 2026-07-27 — `90d6119` Create Universe release deployed to beta and health
  verified `ready`.
- 2026-07-27 — FAST-001 enabled: `beta` is now the shared working branch.
- 2026-07-27 — Antigravity assigned `BETA-SMOKE-001`; READY rows may now be
  self-claimed if the orchestrator is unavailable.
- 2026-07-27 — parallel code is enabled by exact Reserved paths: Claude Code
  owns Magnific provider wiring; an independent Add-items UI repair is READY.
- 2026-07-27 — `BETA-SMOKE-001` PASS: all five Create Universe styles and
  previews are live; the two newer male units are assets only, not catalogued.
- 2026-07-27 — `BETA-UNIVERSE-001` assigned: integrate the two male style
  units only through the strict Create Universe manifest/reference contract,
  then activate the exact tested SHA on beta and smoke it. Asset presence alone
  is explicitly not product delivery.
- 2026-07-27 — `BETA-UI-001` beta smoke PASS: commit `205a8c4` is included in
  live release `ac7259b`; the public static module contains the multi-look grid
  branch and beta health is `ready`.
- 2026-07-27 — external chat joined as `codex-live-20260727` and owns
  `BETA-POST-SHOOT-001`: approved shoot → Video or Lucy Live Camera UI. It is
  in progress; its product files are not a second task for other agents.
