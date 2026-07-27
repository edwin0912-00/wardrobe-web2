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

## Current verified state — reconciliation 2026-07-27

**One current source of truth:** shared branch `beta` is currently `ab310d3`;
the running product release was built from product commit `39442c4`.
`ce9142b` and `ab310d3` are coordination-only and were not deployed. Do not
call a change “live” merely because its row says `READY_FOR_BETA_DEPLOY`; it is
live only after it is an ancestor of the running product commit and a narrow
beta smoke is recorded here.

- Beta is healthy (`ready`). Narrow non-billable smoke: 20/20 focused tests,
  `/api/scene-presets` = 16, `/api/editorial-modes` = 9,
  `/post-shoot-mvp.html` = HTTP 200.
- The 16 standard-background cards and the picker fix `dbc2442` are included
  in `39442c4`. Browser visual smoke is still required; it is not replaced by
  an API result.
- Create Universe has five published `shoot.*` cards; four pass their existing
  integrity route. `shoot.terracotta_hardlight` remains visible but blocked by
  a real SHA-256 reference mismatch; do not bypass it. Two newer male units
  remain assets only until their strict manifest/reference packs compile.
- Lucy code is present in this live release: it requests an explicit 5-second
  `$0.20` consent before issuing a provider token. The safe request without
  consent returns HTTP 409 and makes no provider call. No consented/provider
  request was made in this reconciliation. Its UI currently exposes Live only,
  although the JSON contract says “Video or Live”; that mismatch is an active
  product task, not a completed feature.
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
| BETA-STD-001 | BACKGROUND.01–02 · Звичайні фони `std.*` | codex-main | DONE | CODE | `assets/scene-presets/**`; `config/scene-release-candidates.json`; `src/web/scene-resolvers.js`; `src/web/scene-contract.js`; scene contract/API tests | Live on beta release `7bca845`: all 11 new packs plus 5 existing packs are user-selectable (16 total). Each local pack index is SHA-bound in the published catalog; stale prompt hashes were repaired to the exact checked-in prompts; the production finish was normalized to the existing strict lock rather than weakening it. Focused regression 32/32; live previews 16/16 HTTP 200. |
| BETA-POST-SHOOT-001 | VIDEO.01–04 + LIVE.01–04 · Post-shoot graph | codex-live-20260727 | SUPERSEDED | CODE | historical implementation paths | Superseded by `BETA-POSTSHOOT-RECON-001`: the running release now contains real provider-token code, so the former “mock only / disabled” description is no longer current. Historical evidence is retained in `updates/codex-live-20260727.md`. |
| BETA-LIVE-5S-001 | LIVE.01–04 · Reference photo + 5-second Lucy ceiling | codex-live-20260727 | SUPERSEDED | CODE | historical implementation paths | The five-second consent guard is in live code. It is not proof of a paid Lucy session and does not close the missing Video-versus-Live product choice. |
| BETA-POSTSHOOT-RECON-001 | VIDEO.01–04 + LIVE.01–04 · Один чесний post-shoot екран | codex-live-20260727 | READY | CODE | `config/post-shoot-pipeline.json`; `src/web/post-shoot-pipeline.js`; `src/web/post-shoot-routes.js`; `web/public/post-shoot-mvp.html`; `web/public/post-shoot-mvp.js`; `web/public/post-shoot-mvp.css`; `test/contracts/post-shoot-pipeline.test.js`; `test/web/post-shoot-routes.test.js`; `docs/LUCY_LIVE_MVP_UA.md`; `updates/codex-live-20260727.md` | Make UI and graph agree: approved fashion shoot → explicit **Video** or **Live** choice. Keep local camera preview free, retain the 5-second/$0.20 consent gate, make no consented provider call, add/adjust focused tests, then request beta smoke of the exact commit. |
| BETA-GRAIN-002 | claude-code-20260727-a3f1c8 | DONE | CODE | none — closed without a code change | CLOSED, no code touched: grain at any strength or scale damages the subject's skin, which is the product. Grain disabled on beta; the crosshatch is cured by oversampling instead, which needs no grain and does not touch the face. |
| BETA-LOOKPANEL-001 | PROFILE.03 · Панель збереженого образу не просвічує й не накриває свій вміст | claude-code-20260727-ui4f2a | LIVE_CODE | CODE | `web/public/result.css`; `web/public/scene-cta.css`; `web/public/index.html`; `updates/claude-code-20260727-ui4f2a.md` | `6e9cc68` is an ancestor of live `39442c4`. Focused proof was 17/17; visual beta proof is grouped with `BETA-VISUAL-SMOKE-001`. |
| BETA-UNIVERSE-PREVIEW-001 | UNIVERSE.02 · Превʼю Art Fashion показує кадр зйомки, а не референс-шит | claude-code-20260727-ui4f2a | DONE | CODE | `assets/scene-mood-cards/shoot.*`; `src/web/scene-resolvers.js` (КОЛІЗІЯ); `updates/claude-code-20260727-ui4f2a.md` | ЗУПИНЕНО ДО РОЗВЕДЕННЯ КОЛІЗІЇ: `src/web/scene-resolvers.js` зарезервований активним BETA-UNIVERSE-001 (antigravity-20260727-fb7a90, READY). Пʼять мудкарт 1024x1280 webp зібрані з доставлених кадрів зйомок і проходять контракт превʼю, але без правки резолвера вони `ASSETS_ONLY — NOT IN PRODUCT`; бракує саме `editorialModePreview`, який для create_universe завжди віддає шит за `preview_role`. ЗАКРИТО: під'єднано в `dbc2442` (BETA-PICKER-001) після розведення колізії; асети більше не ASSETS_ONLY. |
| BETA-PICKER-001 | UNIVERSE.02 · Превʼю Art Fashion + правдиві числа у вкладках | claude-code-20260727-ui4f2a | LIVE_CODE | CODE | `src/web/scene-resolvers.js`; `web/public/index.html`; `web/public/scene-ui.js`; `test/web/editorial-preview-api.test.js`; `updates/claude-code-20260727-ui4f2a.md` | `dbc2442` is an ancestor of live `39442c4`; focused regression remains green. It needs one browser visual confirmation rather than another code change. |
| BETA-VISUAL-SMOKE-001 | PROFILE.03 + UNIVERSE.02 · Візуальна beta-перевірка live UI | claude-code-20260727-ui4f2a | READY | QA | `updates/claude-code-20260727-ui4f2a.md` only | On the actual beta URL, capture/inspect: saved-look panel opacity, 16 background cards, true tab counts, and Art Fashion cards showing mood cards rather than contact sheets. No product-code edit in this task; report PASS or the exact reproducible UI defect. |

## Agent protocol

## Required agent messages — read this commit before work

- **codex-live-20260727:** start `BETA-POSTSHOOT-RECON-001`. Your earlier
  report is historical, not current runtime truth. Do not make a consented
  Lucy request or touch credentials. First commit `STARTED` plus your protocol
  ACK, then implement only the declared Video/Live reconciliation.
- **claude-code-20260727-ui4f2a:** run `BETA-VISUAL-SMOKE-001` against the
  actual beta URL. Do not rewrite picker code unless you can reproduce a
  defect; publish a concise PASS/failure report in your own update file.
- **antigravity-20260727-fb7a90:** continue `BETA-UNIVERSE-001`. The two male
  units are not product styles yet. Either compile them through the existing
  strict manifest/reference contract with focused tests, or report the exact
  missing fields as `ASSETS_ONLY — NOT IN PRODUCT`. No invented references,
  hashes, or generated pixels.
- **claude-code-20260727-557761:** no product edit is assigned. Reconcile your
  provider note to current beta only through a safe status check; do not add a
  key, alter credentials, or claim a provider works without evidence.

Every agent: fetch `beta`, add `Protocol ACK: ab310d3` in its own update, and
commit a `STARTED`/result line before changing product code. The owner reports
facts; `codex-main` records the resulting verified state here.

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
- 2026-07-27 — background catalog publication is READY_FOR_BETA_DEPLOY:
  operator-approved 11 new packs are added to the five legacy packs, preserving
  existing saved-scene references while exposing 16 selectable backgrounds.
  32 focused contract/API tests pass; no provider generation was invoked.
- 2026-07-27 — beta release `7bca845` is active and healthy: `/api/scene-presets`
  returns 16 backgrounds, every background preview is HTTP 200, and the
  post-shoot page/API regression smoke remains HTTP 200.
- 2026-07-27 — preview cache repair is READY_FOR_BETA_DEPLOY: all background
  and Create Universe preview URLs now include their exact asset SHA-256, so a
  browser receives a new URL after a visual update instead of reusing a stale
  one-year immutable cache entry. Focused route/resolver regression: 8/8 PASS.
- 2026-07-27 — beta release `34f727f` is active and healthy. Smoke: catalog
  returns SHA-versioned preview URLs; all 5 published background and all 9
  editorial/Create Universe previews return HTTP 200. No provider generation
  was invoked during this release check.
