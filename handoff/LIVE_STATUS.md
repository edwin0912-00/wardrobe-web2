# LIVE STATUS

Живий статус усіх агентів. Новіші записи — зверху. Пишеться командою
`node ops/intent.mjs start|step|blocked|done "…"`, не руками.

Читати перші два-три записи достатньо, щоб продовжити з того місця, де хтось
зупинився. Повний контекст — `handoff/README.md`.

<!-- entries -->

### 2026-07-28 18:38 · antigravity-20260727-fb7a90 · PROGRESS

Сайт А повністю підключений і активований у web/public/index.html

Файли: web/public/index.html,web/public/engine.js,web/public/ui.js,web/public/style.css

HEAD на момент запису: `e07a948`


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
