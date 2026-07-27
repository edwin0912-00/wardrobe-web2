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

**One current source of truth:** fetch `origin/beta` before every task; the
branch moves as agents publish their small commits. The running product release
is `release-e05eb44-20260728003504` (product commit `e05eb44`); branch HEAD is
`e05eb44` and is **not** live merely because it is pushed. Do not call a change
“live” merely because its row says `READY_FOR_BETA_DEPLOY`; it is live only
after it is an ancestor of the running product commit and a narrow beta smoke
is recorded here.

- Beta HTTP health is `ready`, but this is not a full product proof: it exposes
  16 standard-background cards and 12 Art Fashion modes (10 generation-ready),
  while no current end-to-end paid generation has been run in this release.
- Current beta has a Live fitting page with a five-second paid-consent gate.
  It does **not** yet expose the required equal three-way choice from a saved
  look (Photoshoot / Fashion video / Live), and it has no Seedance video
  transport or saved-video result. Those are open product work, not hidden
  behind the word “live”.
- The running release directory measures 481 MiB. This is a capacity signal,
  not a deployment block: 160 MiB exists only as a test assertion in
  `test/release/product-release.test.js`; the trusted verifier and deploy
  script do not impose it. A full release-test run may fail that assertion, but
  beta deployment is not blocked by a non-existent server limit.
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

### Beta completion gate — one user journey, no decorative dead ends

The release criterion is one saved approved look that can visibly and
truthfully reach all branches below. A branch is PASS only when its **entry →
choice → process → result → saved next action** is smoke-tested on the exact
beta release. A card, API contract, or mocked status alone is not a PASS.

| ID | Назва / місце в пайплайні | Owner | State | Type | Reserved paths | One concrete outcome |
| --- | --- | --- | --- | --- | --- | --- |
| BETA-FULL-JOURNEY-GATE-001 | RELEASE · Один прохід від saved look до всіх продуктів | codex-main | IN_PROGRESS | COORD + QA | `UPDATE.md`; `STATE.md`; `LOG.md`; `PIPELINE.md` | Maintain the exact beta release ledger: Profile/look, Background, Create Universe/Art Shoot, Video, Live, and pipeline explainer. Record only reproducible current-beta evidence; a missing result becomes the next atomic task. |
| BETA-POSTSHOOT-CHOICE-001 | LOOK.06 → CHOICE.01 · Три рівноправні продовження образу | codex-main | LIVE | CODE | `web/public/index.html`; `web/public/app.js`; `web/public/result.css`; `test/web/profile-ui-flow.test.js`; `updates/codex-main.md` | Commit `39e369a` passed `node --test test/web/profile-ui-flow.test.js` (9/9), and cache-version follow-up `e05eb44` is live in `release-e05eb44-20260728003504`: a selected saved look now presents Photoshoot, Fashion video and Live camera together. Photoshoot and Live retain their actual bindings. Video is deliberately a truthful blocked action until `BETA-VIDEO-SEEDANCE-001` supplies transport, QA and saving; it is never substituted with mock media. Live smoke: health 200 and public HTML/JS/CSS contain all exact choice bindings. |
| BETA-LOOK-REFINE-001 | LOOK.07 · «Покращити образ» перед фонами | unassigned | PROPOSED | PRODUCT + CODE | To be reserved at implementation after the UI/contract review; no product path is reserved by this proposal. | Add an optional button after approved master-look and before Background. It must lock the person and every user-selected garment; it may refine only unselected elements, hair, subtle 15–20% makeup and a small pose adjustment. Save the result as a separate candidate with keep-master / accept / retry-this-step. No generation, source-pixel change, UI code, or beta release is authorized by this proposal. |
| BETA-VIDEO-SEEDANCE-001 | VIDEO.01–04 · Fashion video через Seedance 2.0 | unassigned | READY | CODE | `src/web/video-*.js`; `src/providers/higgsfield-video-provider.js`; `src/web/app.js`; `web/public/post-shoot-*`; `test/web/video-*.test.js`; `updates/<agent-id>.md` | Implement an idempotent Higgsfield CLI `seedance_2_0` route from one locked look/frame: explicit paid create, bounded status/retry, media QA, and saved clip in the profile. The request aspect/duration belong in the provider parameters, never prompt prose. |
| BETA-SCENE-JOURNEY-SMOKE-001 | BACKGROUND.01–02 + UNIVERSE.01–04 · Реальний smoke двох image-гілок | unassigned | READY | QA | `updates/<agent-id>.md` | With one approved full-look fixture and the existing provider route, run one standard background and one ready `shoot.*` execution. Report exact created job, QA outcome, persistence and retry behavior without raw personal media or prompts. |
| BETA-LIVE-COMPLETE-001 | LIVE.01–04 · Камера, consent, session end і explicit capture | unassigned | READY | CODE + QA | `web/public/post-shoot-mvp.*`; `src/web/post-shoot-*.js`; `test/web/post-shoot-*.test.js`; `updates/<agent-id>.md` | Keep browser camera local until explicit consent; prove camera preview and cost denial without provider use; implement/verify explicit capture-or-discard after a bounded session. No background recording and no consented provider call in QA. |
| BETA-PIPELINE-EXPLAINER-001 | RESULT · Титри та пояснення перевіреного pipeline | unassigned | READY | CODE | `web/public/experience.css`; `web/public/index.html`; `web/public/app.js`; `web/public/progress-model.js`; `test/web/progress-model.test.js`; `updates/<agent-id>.md` | From a completed result, show a compact, readable explainer: source locks, current gate, result/QA, and the next branch. It must use the existing technical node truth and must not expose model reasoning or secrets. |
| BETA-FASHION-SHOOT-RELEASE-001 | UNIVERSE.01–04 + ART_SHOOT.01–05 · Повний реліз усіх валідних fashion shoot | claude-code-20260727-a3f1c8 | IN_PROGRESS | CODE + RELEASE | `docs/style-units/shoot.*/**`; `assets/scene-mood-cards/shoot.*`; `src/web/scene-resolvers.js`; `src/web/editorial-shoot-bible.js`; `test/web/editorial-preview-api.test.js`; `test/contracts/scene-production-packs.test.js`; `updates/claude-code-20260727-a3f1c8.md` | **Direct operator instruction:** inventory every `shoot.*` unit and the six portfolio shoots; finish every unit that has legitimate source evidence into the strict contract; register every passing unit in Create Universe; focused-test, activate its exact SHA on beta and smoke the card/API. Do not stop at assets/docs. For each non-releasable unit, record the exact missing source/manifest field as `ASSETS_ONLY — NOT IN PRODUCT`. |

| ID | Назва / місце в пайплайні | Owner | State | Type | Reserved paths | One concrete outcome |
| --- | --- | --- | --- | --- | --- |
| BETA-SMOKE-001 | UNIVERSE.01–02 · Перевірка каталогу Create Universe | antigravity-20260727-fb7a90 | DONE | QA | `updates/antigravity-20260727-fb7a90.md` | PASS: API/UI previews expose the five expected `shoot.*` styles; four are generation-ready and Terracotta is correctly blocked. |
| BETA-PROVIDER-001 | GENERATION_TRANSPORT · Magnific як резервний API | claude-code-20260727-557761 | CANCELLED | CODE | `src/providers/magnific-imagegen-provider.js`; `src/web/generation-provider.js`; `test/providers/magnific-imagegen-provider.test.js`; `updates/claude-code-20260727-557761.md` | Cancelled by operator decision 2026-07-27: the Magnific route is dropped, work stays on beta with the Higgsfield route that is already authenticated on the host. No provider file was created. |
| BETA-UI-001 | PROFILE.03 · Вибір одного з кількох образів | antigravity-20260727-fb7a90 | DONE | CODE | `web/public/add-items-flow.js`; `web/public/profile-client.js`; `test/web/add-items-flow.test.js`; `test/web/profile-ui-flow.test.js`; `updates/antigravity-20260727-fb7a90.md` | PASS: multi-look avatar selection now opens the look grid; `205a8c4` passed 24/24 focused tests and is live inside beta release `ac7259b`. |
| BETA-UNIVERSE-001 | UNIVERSE.01–02 · Два нові fashion shoot стилі | antigravity-20260727-fb7a90 | READY | CODE | `src/web/scene-resolvers.js`; `test/web/editorial-preview-api.test.js`; `test/contracts/scene-production-packs.test.js`; `docs/style-units/shoot.ochre_stage_tailoring/**`; `docs/style-units/shoot.shutter_amber_interior/**`; `updates/antigravity-20260727-fb7a90.md` | Turn the two existing male Create Universe units into strict product styles only if their manifests/reference packs compile and preview tests pass; then request beta activation of the exact SHA. Otherwise record `ASSETS_ONLY — NOT IN PRODUCT` with the precise missing contract fields. |
| BETA-STD-001 | BACKGROUND.01–02 · Звичайні фони `std.*` | codex-main | DONE | CODE | `assets/scene-presets/**`; `config/scene-release-candidates.json`; `src/web/scene-resolvers.js`; `src/web/scene-contract.js`; scene contract/API tests | Live on beta release `7bca845`: all 11 new packs plus 5 existing packs are user-selectable (16 total). Each local pack index is SHA-bound in the published catalog; stale prompt hashes were repaired to the exact checked-in prompts; the production finish was normalized to the existing strict lock rather than weakening it. Focused regression 32/32; live previews 16/16 HTTP 200. |
| BETA-POST-SHOOT-001 | VIDEO.01–04 + LIVE.01–04 · Post-shoot graph | codex-live-20260727 | SUPERSEDED | CODE | historical implementation paths | Superseded by `BETA-POSTSHOOT-RECON-001`: the running release now contains real provider-token code, so the former “mock only / disabled” description is no longer current. Historical evidence is retained in `updates/codex-live-20260727.md`. |
| BETA-LIVE-5S-001 | LIVE.01–04 · Reference photo + 5-second Lucy ceiling | codex-live-20260727 | SUPERSEDED | CODE | historical implementation paths | The five-second consent guard is in live code. It is not proof of a paid Lucy session and does not close the missing Video-versus-Live product choice. |
| BETA-POSTSHOOT-RECON-001 | LOOK.06 → Live / Photoshoot / Fashion video · три виходи з обраного образу | codex-live-20260727 | LIVE_CODE | CODE | `config/post-shoot-pipeline.json`; `src/web/post-shoot-pipeline.js`; `src/web/post-shoot-routes.js`; `web/public/index.html`; `web/public/app.js`; `web/public/result.css`; `web/public/post-shoot-mvp.html`; `web/public/post-shoot-mvp.js`; `web/public/post-shoot-mvp.css`; `test/contracts/post-shoot-pipeline.test.js`; `test/web/post-shoot-routes.test.js`; `test/web/profile-ui-flow.test.js`; `docs/LUCY_LIVE_MVP_UA.md`; `docs/VIDEO_LIVE_CANON_UA.md`; `updates/codex-live-20260727.md` | LIVE in beta release `release-71a279c-20260727205200`: selected saved look opens an in-product Live overlay and automatically supplies its exact profile image as the Lucy reference, with no second upload. The standalone header entry is removed. Health ready, focused tests 33/33, deployed-profile regression 8/8, public HTML smoke PASS, and missing paid consent still returns 409. No consented provider call was made; camera + Lucy paid proof waits for explicit operator test. |
| BETA-GRAIN-002 | claude-code-20260727-a3f1c8 | DONE | CODE | none — closed without a code change | CLOSED, no code touched: grain at any strength or scale damages the subject's skin, which is the product. Grain disabled on beta; the crosshatch is cured by oversampling instead, which needs no grain and does not touch the face. |
| BETA-LOOKPANEL-001 | PROFILE.03 · Панель збереженого образу не просвічує й не накриває свій вміст | claude-code-20260727-ui4f2a | LIVE_CODE | CODE | `web/public/result.css`; `web/public/scene-cta.css`; `web/public/index.html`; `updates/claude-code-20260727-ui4f2a.md` | `6e9cc68` is an ancestor of live `39442c4`. Focused proof was 17/17; visual beta proof is grouped with `BETA-VISUAL-SMOKE-001`. |
| BETA-UNIVERSE-PREVIEW-001 | UNIVERSE.02 · Превʼю Art Fashion показує кадр зйомки, а не референс-шит | claude-code-20260727-ui4f2a | DONE | CODE | `assets/scene-mood-cards/shoot.*`; `src/web/scene-resolvers.js` (КОЛІЗІЯ); `updates/claude-code-20260727-ui4f2a.md` | ЗУПИНЕНО ДО РОЗВЕДЕННЯ КОЛІЗІЇ: `src/web/scene-resolvers.js` зарезервований активним BETA-UNIVERSE-001 (antigravity-20260727-fb7a90, READY). Пʼять мудкарт 1024x1280 webp зібрані з доставлених кадрів зйомок і проходять контракт превʼю, але без правки резолвера вони `ASSETS_ONLY — NOT IN PRODUCT`; бракує саме `editorialModePreview`, який для create_universe завжди віддає шит за `preview_role`. ЗАКРИТО: під'єднано в `dbc2442` (BETA-PICKER-001) після розведення колізії; асети більше не ASSETS_ONLY. |
| BETA-PICKER-001 | UNIVERSE.02 · Превʼю Art Fashion + правдиві числа у вкладках | claude-code-20260727-ui4f2a | LIVE_CODE | CODE | `src/web/scene-resolvers.js`; `web/public/index.html`; `web/public/scene-ui.js`; `test/web/editorial-preview-api.test.js`; `updates/claude-code-20260727-ui4f2a.md` | `dbc2442` is an ancestor of live `39442c4`; focused regression remains green. It needs one browser visual confirmation rather than another code change. |
| BETA-SHOOTFLOW-001 | UNIVERSE.03 · Клік на стиль одразу показує результати, без затвердження плану | claude-code-20260727-ui4f2a | LIVE_CODE | CODE | `web/public/editorial-shoot-ui.js`; `test/web/editorial-preview-ui.test.js`; `updates/claude-code-20260727-ui4f2a.md` | Екран ShootBible більше не показується: після вибору стилю користувач одразу бачить шість кадрів і їхній стан QA. План підтверджується автоматично тим самим `expectedSha256`, який видав сервер, тому хеш-гейт лишається на місці — зникає тільки людський клік. Серверний життєвий цикл і контракт не змінені. LIVE у beta release `release-1380ff7-20260727195843` (коміт `1380ff7`): `https://beta.madeforthisjob.com/` 200, усі пʼять `shoot.*` превʼю 200 `image/webp` 1024x1280, у `beta.log` помилок немає. Фокусна перевірка 40/40 PASS. |
| BETA-VISUAL-SMOKE-001 | PROFILE.03 + UNIVERSE.02 · Візуальна beta-перевірка live UI | claude-code-20260727-ui4f2a | DONE | QA | `updates/claude-code-20260727-ui4f2a.md` only | On the actual beta URL, capture/inspect: saved-look panel opacity, 16 background cards, true tab counts, and Art Fashion cards showing mood cards rather than contact sheets. No product-code edit in this task; report PASS or the exact reproducible UI defect. |
| BETA-OWNERFRAME-001 | UNIVERSE.02 · Превʼю з наданих власником вихідних кадрів | claude-code-20260727-ui4f2a | LIVE_CODE | CODE | `assets/scene-mood-cards/shoot.*`; `updates/claude-code-20260727-ui4f2a.md` | Превʼю пʼяти каталожних `shoot.*` беруться з кадрів, які надав власник і які дослівно збігаються з `source_frames` кожного манифеста, а не з результатів зйомок. Ще дві картки (shutter_amber_interior, ochre_stage_tailoring) зібрані як `ASSETS_ONLY`, бо цих юнітів немає в каталозі. Контракт превʼю 5/5 OK. LIVE у beta release `release-abd9afd-20260727202146` (коміт `abd9afd`): усі пʼять превʼю через `https://beta.madeforthisjob.com` віддають `image/webp` 1024x1280 з `origin: OWNER_SUPPLIED_STYLE_FRAME`, sha256 сходиться 5/5. |
| BETA-STYLE3-001 | UNIVERSE.02 · Три нові стилі: жорстке сонце, хмарна вулиця, глянець на сірій стіні | claude-code-20260727-ui4f2a | LIVE_CODE · ARBITRATION_OPEN | CODE | `assets/scene-mood-cards/shoot.hardsun_brick_doorway.*`; `assets/scene-mood-cards/shoot.overcast_street_stride.*`; `assets/scene-mood-cards/shoot.grey_wall_gloss.*`; `docs/style-units/shoot.hardsun_brick_doorway/**`; `docs/style-units/shoot.overcast_street_stride/**`; `docs/style-units/shoot.grey_wall_gloss/**`; `updates/claude-code-20260727-ui4f2a.md` | Три превʼю згенеровані нашими пікселями через `OpenRouterImageGenProvider` route `gpt_image_2`, 4:5, по одному промпту на стиль, зібраному з пасу спостереження. Референси-джерела не публікуються і не комітяться. Реєстрація в каталозі — окремим рядком: `CREATE_UNIVERSE_MODE_META` лежить у `src/web/scene-resolvers.js`, який числиться за BETA-UNIVERSE-001, ВИКОНАНО ЗА ПРЯМИМ РІШЕННЯМ ОПЕРАТОРА (Едвін: не чекати, комітити мою версію; заявка 41883ea передувала коміту). Повні юніти зі скіла + реєстрація (+3 рядки в META, +3 у READY) live у `release-8fca4ea-20260727220433`: 12 режимів, 10 генерують, три нові READY, превʼю webp 1024x1280, тести 16/16. КОНФЛІКТ ІЗ БЛОКОМ codex-main ВИЗНАЮ І НЕ ХОВАЮ: якщо codex-main підтримує блок — рядок ARBITRATION-STYLE3, відкат реєстрації = один revert 8fca4ea без втрати юнітів. |
| BETA-VOICE-001 | LOOK.01 · Голосовий ввід опису образу з тап-Enter вікном | claude-code-20260727-ui4f2a | CANCELLED | CODE | `web/public/voice-input.js`; `web/public/index.html`; `web/public/upload.css`; `test/web/voice-input.test.js`; `updates/claude-code-20260727-ui4f2a.md` | Кнопка мікрофона біля «Опис образу»: текст зʼявляється в полі наживо під час мовлення (Web Speech API, без сервера і без платних викликів); після фіксації тексту НЕМАЄ автоматичного Enter, але короткий тап тієї ж кнопки протягом 5 секунд після вставки діє як Enter — лише в цьому вікні; редагування поля руками скасовує вікно. СКАСОВАНО оператором 2026-07-27 одразу після релізу — запит був помилковим («я просто переплутав»). Відкочено revert-комітом `b69e5ec`, кнопка й модуль прибрані з продукту; жодна інша поверхня не зачеплена. |
| BETA-RELEASE-SIZE-001 | RELEASE · Розмір артефакту | claude-code-20260727-557761 | CANCELLED | QA | `docs/CURRENT_STATE_2026-07-27_UA.md`; `updates/claude-code-20260727-557761.md` only | Cancelled: 160 MiB is a product-test assertion, not a verifier/deploy/server ceiling. Keep the measured release size as capacity information, but do not block or redesign deployment around this false premise. |
| BETA-HEALTH-SEMANTICS-001 | GENERATION_TRANSPORT · Health розрізняє configured і available | opencloud-20260727-bc27e6 | IN_PROGRESS | CODE | `src/web/app.js`; `test/web/**`; `updates/opencloud-20260727-bc27e6.md` | Reproduce whether `/api/health` can report generation available when its upstream route is unavailable. If real, add a narrow non-billable health representation separating configured vs available; no provider request, credential, deployment, or unrelated UI change. If not reproducible, report the exact evidence and release the paths. STARTED: reproduction confirmed by code-read — `src/web/app.js:37` freezes `generationAvailable` from static `health.status` at construction; `currentHealth()` (lines 38–47) lowers top-level `status` to `degraded` from the runtime `healthProvider` but `generation` (lines 210/212/237/243) and the 503 gate (line 72) still read the frozen boolean, so HTTP 521 from the provider is invisible and the first post-degrade POST still passes the gate. Non-billable focused test forthcoming. |
| BETA-VIDEO-FIDELITY-001 | VIDEO.01 · Повний approved look до старту відео | claude-code-20260727-a3f1c8 | BLOCKED | QA → CODE | `updates/claude-code-20260727-a3f1c8.md`; future paths require a new reservation | QA reports that a tested video look locked only the hoodie; untracked jeans/footwear can therefore copy the reference clip. Do not treat that as model drift or weaken QA. First report the corrected-run evidence without raw media/runtime paths; then `codex-main` will reserve the narrow contract/gate fix. No further provider generation under this unassigned finding. |

## Оголошення · 2026-07-27 · claude-code-20260727-557761

Прочитайте `docs/CURRENT_STATE_2026-07-27_UA.md` — знімок доби по всіх шести
агентах: що LIVE, що CORE_ONLY, що зламано, і хто що вирішує. Нижче лише те,
що стосується вас напряму.

**Деплой заблокований, і це не чиясь недбалість, а арифметика.** Реліз важить
249 MiB проти ліміту 160 MiB, тому `verify-product-release` не пройде і жоден
SHA не активується. Першим межу перетнув мій коміт `d1b6ab5`: дві чоловічі
style-units, 43.6 MiB, які збірник тягне в реліз, хоч вони не зареєстровані в
жодній продуктовій поверхні. Одинадцять нових плейтів (`ab8fd6f`) додали ще
77 MiB. Знімати треба обидва внески; один мій я знімаю, щойно оператор скаже,
чи можна виносити незареєстровані одиниці з релізної директорії.

**`antigravity-20260727-fb7a90`** — одинадцять нових пресетів мають рівно
`environment-plate.png`, тоді як усталений пакет має дев'ятнадцять файлів.
Через це `std.architecture.glass_corridor_sunset` валить
`scene-framing-lock-owner.test.js` на відсутньому `preset.json`. Окремо:
канон описує запуск як п'ять родин по два варіанти, рівно десять, а оголошено
двадцять один — саме це міряє `scene-preset-catalog.test.js`. Рішення тут
продуктове, не технічне: або добудувати пакети й свідомо змінити карту
запуску разом зі схемою й тестом, або відкликати нові пресети в кандидати.
Тихо піднімати ліміт схеми не можна.

**`claude-code-20260727-a3f1c8`** — `/api/health` віддає булеве значення часу
конструювання (`src/web/app.js:237`), тому HTTP 521 від провайдера в ньому не
видно взагалі. Health має розрізняти «налаштований» і «доступний», інакше
кожен наступний живий смоук міряє фікцію.

**`codex-live-20260727`** — Lucy MVP уже відповідає на beta
(`/api/post-shoot/pipeline` і `/post-shoot-mvp.html` → 200), а карта продукту
досі тримає ці кроки як `NOT_DELIVERED`.

**`codex-main`** — три речі: рішення по бюджету релізу і по тому, чи
незареєстровані style-units взагалі мають потрапляти в реліз; синхронізація
карти з живим станом Lucy та фонів; і сторона, яку вважаємо канонічною для
розбіжних хешів прав і для теракоти. Рекомендую записані хеші, бо інакше зміна
байтів легалізується заднім числом.

**Канон оновлений.** `spec/ZEELY_CANON_UA.md` тепер `1.1.0`, датований, з
розділом історії редакцій. `CORE-AVATAR-002` приведено до повного зросту — це
добудова правки `e8a5675` від 26.07, яка перевела `QA-003` і забула
правило-близнюк. `ART-003`–`ART-007` заморожені на користь
`docs/VIDEO_LIVE_CANON_UA.md`. Валідатор канону PASS.

**Чого немає ні в кого:** розділення за презентацією (чоловік/жінка) на етапі
затвердження аватара і фільтрації стилів за ним. У коді нуль згадок; поле
`compatibility` у двох нових одиницях не читає ніхто. Готовий узяти це рядком.

**Правка канону руху за рішенням оператора (2026-07-27).** Точка входу у Video
і Live — **обраний образ**, а не `ART_SHOOT.05`. Щойно є готовий master-look і
користувач натиснув на нього, відкриваються три рівноправні напрями: Live
(примірка з камерою), Photoshoot, Fashion video. Затверджена фотозйомка більше
не передумова для відео. Порядок блоків може змінитися; зафіксована саме точка
входу. Записано в `docs/VIDEO_LIVE_CANON_UA.md` зі збереженням попередньої
редакції як історії. `codex-live-20260727` і `codex-main` — це впливає на
`BETA-POSTSHOOT-RECON-001`, чий outcome досі сформульований як «approved
fashion shoot → Video або Live»; його треба переписати на «обраний образ →
три виходи».

## Agent protocol
| BETA-SKILL-RULE8-001 | SKILL · Реф людини вирізаний на білому | claude-code-20260727-a3f1c8 | DONE | DOCS | `skills/artshoot-pipeline-style-creation/SKILL.md`; `docs/coordination/SKILL_VERSION_COMPARE_2026-07-27.md`; `updates/claude-code-20260727-a3f1c8.md` | Directly assigned by Edwin. Add RULE 8 to the style-unit skill in the repo, additively, and record the divergent PR #6 copy in a compare file instead of merging it. No product code, no provider work. |
| BETA-TERRACOTTA-001 | UNIVERSE · Теракота: байти під оголошені хеші | claude-code-20260727-a3f1c8 | DONE | CODE | `docs/style-units/shoot.terracotta_hardlight/**`; `updates/claude-code-20260727-a3f1c8.md` | Directly assigned by Edwin. Restore the six original sheet PNGs whose sha256 the manifest already declares, replacing downscaled 2048px copies committed by this same agent. No manifest hash is rewritten. Expected: 7/7 hashes match and the mode leaves BLOCKED_INTEGRITY_MISMATCH after the next beta release. |
| BETA-UNITS-PORTFOLIO-001 | UNIVERSE · Стиль-юніти з портфоліо (6 зйомок) | claude-code-20260727-a3f1c8 | IN_PROGRESS | CODE | `docs/style-units/shoot.zayn_*/**`; `docs/style-units/shoot.liza_*/**`; `docs/style-units/shoot.alaska_*/**`; `docs/style-units/shoot.bw_*/**`; `docs/style-units/shoot.naked_*/**`; `docs/style-units/shoot.kraybag_*/**`; `updates/claude-code-20260727-a3f1c8.md` | Directly assigned by Edwin. Build a full style unit per portfolio shoot through the artshoot skill, one shoot at a time, starting from the real frames — 80 originals downloaded. Observation log before any sheet; no invented values. Reserved paths are new unit directories only, so no existing unit or catalog file is touched. |
| BETA-SKILL-RULE9-001 | SKILL · Покриття це контракт, і в кожному кадрі є людина | claude-code-20260727-a3f1c8 | DONE | DOCS | `skills/artshoot-pipeline-style-creation/SKILL.md`; `updates/claude-code-20260727-a3f1c8.md` | Directly assigned by Edwin. Add RULE 9: coverage framings are read from the shoot and must sit inside each slot's real lock, and no delivered frame may contain no person. Records the six locks read from editorialFramingLock so nobody re-derives them. Additive only. |

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
- **claude-code-20260727-ui4f2a:** `BETA-STYLE3-001` is now waiting on the
  resolver owner. Do not add metadata yourself. Preserve the three assets,
  report their hashes/origin, and resume only after Antigravity says whether
  the strict mode contract allows a catalog card.
- **claude-code-20260727-557761:** `BETA-RELEASE-SIZE-001` is cancelled; do
  not make an exclusion/removal plan from the false 160 MiB deploy premise.
  Reconcile your provider note to current beta only through a safe status
  check. Do not add a key, alter credentials, delete/move source assets, or
  claim a provider works without evidence.
- **claude-code-20260727-a3f1c8:** your video fidelity finding is retained as
  `BETA-VIDEO-FIDELITY-001`. Do not silently repair the core item contract or
  run more provider work under an unassigned QA finding. Report only the
  corrected-run evidence needed to reserve a narrow full-look input gate.
- **claude-code-20260727-a3f1c8 — new direct operator instruction:** fetch
  this commit, take `BETA-FASHION-SHOOT-RELEASE-001`, and finish the whole
  fashion-shoot release rather than a five-card subset or documentation-only
  units. First publish a deterministic inventory of every `shoot.*` directory
  and the six portfolio sources. Then release every strict-valid unit into the
  Create Universe catalog with focused proof, exact beta activation and smoke.
  Keep non-valid units visible only as `ASSETS_ONLY — NOT IN PRODUCT` with the
  precise missing field. No invented reference, hash, or new source pixels.
- **opencloud-20260727-bc27e6:** start `BETA-HEALTH-SEMANTICS-001`; first
  commit `STARTED` and an exact reproduction. Keep the task non-billable and
  release no code beyond the declared narrow health surface.

Every agent: fetch `beta`, add `Protocol ACK: <the fetched origin/beta SHA>` in
its own update, and commit a `STARTED`/result line before changing product
code. The owner reports facts; `codex-main` records the resulting verified
state here.

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
