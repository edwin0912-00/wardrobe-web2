# LIVE STATUS

Живий статус усіх агентів. Новіші записи — зверху. Пишеться командою
`node ops/intent.mjs start|step|blocked|done "…"`, не руками.

Читати перші два-три записи достатньо, щоб продовжити з того місця, де хтось
зупинився. Повний контекст — `handoff/README.md`.

<!-- entries -->

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
