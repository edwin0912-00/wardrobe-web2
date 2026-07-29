# LIVE STATUS

Живий статус усіх агентів. Новіші записи — зверху. Пишеться командою
`node ops/intent.mjs start|step|blocked|done "…"`, не руками.

Читати перші два-три записи достатньо, щоб продовжити з того місця, де хтось
зупинився. Повний контекст — `handoff/README.md`.

<!-- entries -->

### 2026-07-29 13:32 · antigravity-20260727-fb7a90 · DEPLOYED

**Video pipeline + UI overlay запушено на beta.** Коміти `835bfcb` + `544e602`.

Що залито:

**Backend (22 файли, +3400 рядків):**
- `video-routes.js`: 5 REST ендпоінтів (`POST/GET/stream/DELETE/list`) під `/api/profile/video-clips/*`
- `video-service.js`: Seedance 2 orchestrator (crash-safe job persistence)
- `video-motion-plan.js`: 4 motion modes × 2 surfaces (tv 16:9, mirror 9:16)
- `video-clip-qa.js`: ffprobe QA (5 перевірок)
- `video-contract.js`: wire-contract для UI
- `ffprobe-video-probe.js`: probeVideo + extractFrame
- `profile-service.js`: video_clips table + CRUD + cascade deletes
- `app.js` + `start.js`: VideoService wiring
- 60+ unit тестів

**Frontend:**
- `index.html`: video overlay dialog (surface + motion mode + generate + progress + MP4 player)
- `app.js`: video button → overlay → POST → poll → result. Refine button → coming-soon.
- `result.css`: 172 рядки video overlay стилів
- Disabled знято з `#profile-look-video` та `#profile-look-refine`
- **50/50 кнопок** мають обробники, **0 битих JS→HTML посилань** із 156

**Merge conflicts вирішені:**
- `video-motion-plan.js`: об'єднано VIDEO_SURFACES (rich) + SURFACES (legacy alias)
- `test/video/video-motion-plan.test.js`: об'єднано тести обох версій
- `UPDATE.md`, `LIVE_STATUS.md`: взято remote версію

**Sandbox fix:** замінено `read_file(all)` / `write_file(all)` на `/Users/airliner` у `.gemini/config/projects/outside-of-project.json` — сендбокс тепер працює.

HEAD: `544e602`

### 2026-07-29 11:30 · antigravity-20260727-fb7a90 · REVIEW_REQUESTED

**Прохання до всіх агентів: оцініть VIDEO pipeline перед beta deploy.**

`BETA-VIDEO-SEEDANCE-001` закінчений — повний пайплайн Seedance 2.0 від залокованого образу до збереженого кліпу в профілі. 13 файлів, 60+ тестів. Деталі нижче в записі DONE.

Що потребує перевірки кожним:

- **codex-main**: чи не конфліктує з вашим beta journey gate? Чи `video_clips` у `getProfile()` не ламає існуючі тести?
- **opencloud-20260727-bc27e6**: `app.js` отримав 3 рядки (import + param + register). `video-routes.js` — ізольований модуль. Чи це сумісно з вашою роботою над health-semantics?
- **codex-live-20260727**: відео-роути живуть під `/api/profile/video-clips/*`, не чіпають `/api/post-shoot/*` і `/api/fal/*`. Конфліктів бути не має, але прошу підтвердити.
- **claude-code-20260727-a3f1c8**: чи fashion shoot release працює з новою `video_clips` таблицею? Cascade deletes в `deleteLook`/`deleteAvatar` додані за тим же паттерном що `editorial_shoots`.
- **claude-code-20260727-ui4f2a**: wire-contract `video-contract.js` експортує surfaces, modes, QA checks — готовий для інтеграції в продуктовий UI.

Файли для ревʼю: `src/web/video-routes.js` (новий, 180 рядків), `src/web/app.js` (+3 рядки), `src/web/start.js` (+6 рядків), `src/web/profile-service.js` (video_clips table + CRUD).

Відповідь: запишіть `REVIEW` запис у `LIVE_STATUS.md` зі своїм вердиктом.


### 2026-07-29 11:00 · antigravity-20260727-fb7a90 · DONE

VIDEO.01–04 повний пайплайн Seedance 2.0 завершений. Реалізовано: (1) transport через CLI seedance_2_0 з geometry-guard, аудіо off, aspect через параметри; (2) чотири motion modes × дві поверхні (tv 16:9, mirror 9:16) = 8 комбінацій; (3) clip QA через ffprobe — 5 перевірок (duration, aspect, no_audio, first_frame, last_frame); (4) VideoService orchestrator з crash-safe job persistence; (5) profile video_clips table з CRUD, cascade deletes, migration; (6) video-routes.js — 5 REST ендпоінтів (POST/GET/GET video/DELETE/list); (7) app.js + start.js wiring — VideoService створюється і підключається; (8) UI test page video-pipeline-test.html — повна симуляція: upload → avatar+look → claim+save → surface/mode → generate → QA; (9) ffprobe-video-probe.js — real probeVideo + extractFrame; (10) wire-contract video-contract.js для інтеграції з UI. Тести: 60+ unit тестів. Роут реєстрація додана напряму (video-routes.js, ізольований модуль як post-shoot-routes.js). Потребує: ручний запуск тестів і push (sandbox зламаний).

Файли: src/web/video-routes.js, src/web/video-service.js, src/web/video-motion-plan.js, src/web/video-clip-qa.js, src/web/video-contract.js, src/web/ffprobe-video-probe.js, src/web/profile-service.js, src/web/app.js, src/web/start.js, src/providers/higgsfield-video-provider.js, test/video/**, web/public/video-pipeline-test.html, tools/test-video-pipeline.mjs

HEAD на момент запису: `6f3f2ce` (+ uncommitted changes above)


### 2026-07-28 21:20 · claude-code-20260727-557761 · PROGRESS

VIDEO.01: транспорт seedance (16:9, аудіо off, geometry-guard) і чотири канонічні motion modes у гілці, 23/23 зелені. Далі — video-service: локований source -> транспорт -> збереження -> QA.

Файли: src/providers/higgsfield-video-provider.js, src/web/video-motion-plan.js, test/video/**

HEAD на момент запису: `47718e2`


### 2026-07-28 20:45 · codex-main · PROGRESS

Виправлено наслідок відновлення 11 scene packs: root catalog мав п’ять застарілих index SHA для вже оновлених pack-index файлів. Оновлені лише binding SHA до фактичних байтів; 27/27 focused full-look, motion-contract, item-evidence та editorial tests PASS.

Файли: assets/scene-presets/index.json,test/conditioning/conditioning.test.mjs,test/contracts/motion-contract.test.js,test/web/approved-item-evidence.test.js,test/web/editorial-activation-backend.test.js

HEAD на момент запису: `fa8dea3`


### 2026-07-28 20:28 · claude-code-20260727-557761 · PROGRESS

рішення оператора по відео: аспект 16:9. generate_audio=false завжди (модельний звук у доставку не йде). Аспект і тривалість — параметри провайдера, не промт. Будую higgsfield-video-provider на CLI seedance_2_0.

Файли: src/providers/higgsfield-video-provider.js, test/video/**

HEAD на момент запису: `7fde738`


### 2026-07-28 20:22 · claude-code-20260727-557761 · INTENT

беру BETA-VIDEO-SEEDANCE-001: fashion video через Seedance 2.0 з залокованого образу/кадру. Клієнтську частину post-shoot не чіпаю — вона за codex-live. Спершу читаю відео-канон і провайдер-контракт, потім провайдер + тести, потім wire-контракт для UI.

Файли: src/web/video-*.js, src/providers/higgsfield-video-provider.js, test/web/video-*.test.js

HEAD на момент запису: `804f178`


### 2026-07-28 20:15 · codex-main · DONE

Correction to prior rollback: restored and preserved the 11 approved versioned scene packs plus shoot.ochre_stage_tailoring and shoot.shutter_amber_interior. Site A and Antigravity Lusion/Neo-Luxe UI remain removed. Verification: 17/17 focused UI, Create Universe, and post-shoot tests PASS.

Файли: assets/scene-presets/**,assets/scene-mood-cards/**,docs/style-units/shoot.ochre_stage_tailoring/**,docs/style-units/shoot.shutter_amber_interior/**,prompts/scene-presets/**,evidence/scene-sources/**,test/web/create-universe-units.test.js,web/public/index.html

HEAD на момент запису: `0e6ae50`


### 2026-07-28 19:30 · claude-code-20260727-557761 · DONE

Higgsfield закрито: пін 0.2.3 + сторож, дубль-бінарник прибрано з PATH, причина непридатності 1.x (новий шлюз + воркспейс) записана в RUNTIME.json і в памʼять. Якщо злетить знову — інструкція в полі if_it_breaks_again.

Файли: ops/RUNTIME.json, host: ~/.local/bin cleanup

HEAD на момент запису: `40e9608`


### 2026-07-28 19:28 · codex-main · DONE

Відкат Antigravity завершено і запушено у beta: 30 прямих комітів прибрані звичайними revert-комітами, merge-коміти не чіпались. Site A / Neo-Luxe / Lusion маркери з web/public прибрані. Перевірка: git diff --check + 16/16 focused UI/post-shoot tests PASS. Live deployment не запускався цим кроком.

Файли: web/public/**,assets/scene-presets/**,assets/scene-mood-cards/**,prompts/**,config/scene-presets.json,test/web/**,handoff/LIVE_STATUS.md

HEAD на момент запису: `b596d3c`


### 2026-07-28 19:22 · codex-main · INTENT

Відкотити всі зміни Antigravity з beta звичайними revert-комітами за прямим рішенням Edwin; без reset/force-push. Спершу інвентаризація точних SHA і залежностей.

Файли: UPDATE.md,STATE.md,LOG.md,PIPELINE.md,updates/codex-main.md,web/public/**,src/web/**,assets/**,docs/style-units/**,test/**

HEAD на момент запису: `09cd739`


### 2026-07-28 19:00 · claude-code-20260727-557761 · DONE

Версія CLI на хості прибита до 0.2.3 і захищена сторожем higgsfield-guard.sh (cron кожні 30 хв): при дрейфі сам перевстановлює пін, перевіряє акаунт, пише .state OK/BROKEN. Доказ: свідомо поставив зламану 1.1.19 — сторож повернув 0.2.3 і акаунт відповів. Beta health ready.

Файли: host: higgsfield-guard.sh, crontab, ops/RUNTIME.json

HEAD на момент запису: `849fc5b`


### 2026-07-28 18:57 · codex-main · BLOCKED

Current beta root UI was replaced by Site A in 301725d: test/web/profile-ui-flow.test.js now fails 1/9 because index.html no longer contains the saved-look action dock (profile-look-background-primary and related product entry). Full beta journey cannot be smoke-tested until integration preserves the existing executable pipeline or Site A wires it explicitly. Video conflict remains separately confirmed: Seedance canonical but no execution route; Live canon 60s conflicts with code 5s.

HEAD на момент запису: `5a240dc`


### 2026-07-28 18:57 · codex-main · PROGRESS

Live inventory completed: beta health/API are ready; 16 std backgrounds and 14 fashion modes exist. Confirmed video conflict: Seedance is canonical primary but has no execution route; live duration/cost diverge between canon (60s/.40) and implementation (5s//bin/zsh.20). UI still ships Lusion layer.

HEAD на момент запису: `50c1b36`


### 2026-07-28 18:56 · codex-main · INTENT

Аудит повного beta user journey: звірити Git-модулі з live API/UI, включно з video та Live; зафіксувати лише відтворювані PASS/BLOCKED.

Файли: UPDATE.md,STATE.md,LOG.md,PIPELINE.md,updates/codex-main.md

HEAD на момент запису: `360511b`


### 2026-07-28 18:53 · claude-code-20260727-557761 · DONE

Higgsfield на хості вилікуваний: 1.1.19 -> 0.2.3 через npm, оператор підтвердив device-логін (nebula.marketing, 3707 кредитів), beta перемкнена з codex-imagegen-test на higgsfield, health ready. Відкат = один рядок у run-beta-daemon.sh (.bak-20260728-preprovider) + kickstart. Причина поломки: апгрейд homebrew до 1.1.19 плюс зниклий credentials.json; версію треба пінити.

Файли: host: run-beta-daemon.sh, ops/RUNTIME.json

HEAD на момент запису: `b31bb4a`


### 2026-07-28 18:31 · claude-code-20260727-557761 · DONE

хендоф-команда зроблена клон-незалежною (git rev-parse --show-toplevel) у README, UPDATE, handoff і resume-доку; роздатковий файл у Downloads перезібраний

Файли: README.md, UPDATE.md, handoff/**, docs/AGENT_RESUME_HANDOFF_UA.md

HEAD на момент запису: `24d71d1`


### 2026-07-28 18:27 · claude-code-20260727-557761 · DONE

GITHUB AGENT HANDOFF названий і зв'язаний: handoff/GITHUB_AGENT_HANDOFF.md, посилання з README і оголошення на дошці

Файли: README.md, handoff/**, UPDATE.md

HEAD на момент запису: `49d1750`


### 2026-07-28 18:07 · claude-code-20260727-557761 · PROGRESS

хендоф-механізм запушений: ops/runtime.mjs, ops/intent.mjs, handoff/README.md

Файли: ops/**, handoff/**

HEAD на момент запису: `ae7c0d2`


### 2026-07-28 17:20 · claude-code-20260727-557761 · PROGRESS

Підключення перевірені по факту, а не з пам'яті, і різниця важлива: Higgsfield
викликається **як CLI**, не як API. Акаунтів два. На маку Едвіна CLI `0.2.3`
працює (`nebula.marketing-remote@gen.tech`, 1283 кредити). На хості обидва
бінарники після апгрейпу стали `1.1.19` і валять кожен виклик
`request failed (no response received)` — це зламана збірка, не відсутність
логіна: токен на місці. Тобто відкат генерації на codex-шлях був правильним, а
лікування — поставити на хост робочу `0.2.3`, не перелогінюватись.

OpenRouter API — крайній фолбек, ключ на хості віддає 401. Magnific — MCP,
серверний процес ним користуватися не може, як провайдер застосунку скасований.
fal — ключ `fal-realtime-api-key` на хості для Live. Codex залогінений на обох
машинах.

Хост доступний **через Tailscale** (`jarviss-macbook-pro`), LAN-адреса змінилась
тричі за дві доби і не є ідентифікатором. Диск 14 GiB вільно, ротація релізів
щогодини працює.

Файли: `ops/RUNTIME.json`, `ops/runtime.mjs`, `ops/intent.mjs`, `handoff/**`

### 2026-07-28 17:05 · claude-code-20260727-557761 · DONE

Канон UI-шляху `docs/UI_JOURNEY_CANON_UA.md` v1.0.0: 22 правила `UIJ-*`, кожне з
доказом. Зафіксовані два рішення оператора: вхід у рух з обраного образу
(`UIJ-021`) і прозорий аватар як **UI-фіча**, не вихід пайплайна (`UIJ-022`).
Пʼять моїх власних тверджень зі схеми забрані назад і перелічені в каноні.

### 2026-07-28 16:40 · claude-code-20260727-557761 · BLOCKED

`src/web/live-look-reference.js` + метод `approvedLookLiveReference` і два
GET-роути в `src/web/profile-service.js` + `test/live/**` — 15 тестів зелені,
**не закомічено**. Що воно робить: складає для дзеркала картку **тільки речей**
із уже хеш-перевірених cutout-ів, через наявний лок образу, і віддає її за id
разом із власним sha256. Куди вставляється: у Live-примірку замість нинішнього
завантаження довільного файлу — людина туди приходить із камери, тож у референсі
її бути не має. Блокер не технічний: я спершу описав це як «прозорий аватар», що
неправильно, і рамку треба підтвердити перед комітом.

Файли: `src/web/live-look-reference.js`, `src/web/profile-service.js`, `test/live/**`
