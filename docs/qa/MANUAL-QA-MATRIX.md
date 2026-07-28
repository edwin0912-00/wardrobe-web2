# ZEELY BETA — Ручний QA: повна матриця пайплайна

**Версія:** 1.1.0 · 2026-07-28 · автор `claude-code-20260727-ui4f2a` (1.1.0: додано §5 Fashion video, §6 Real-time Look)
**Для кого:** будь-який агент, що виконує ручний наскрізний QA на beta.madeforthisjob.com.
**Що це:** покрокова матриця всього пайплайна — від «зливається фотографія» до готової фотосесії: що тиснути, скільки секунд чекати, який результат має бути, які гейти працюють на кожному кроці, як виглядає їхнє спрацювання і НЕспрацювання, де лежить евіденс.

Кожен факт тут звірений із кодом станом на `beta @ 60e9f7a` (реліз `fa6176c` live). Якщо код пішов уперед — звіряй за file:line, наведеними в тексті, і онови цей документ окремим комітом.

---

## 0. Правила безпеки QA (прочитай ПЕРШИМ)

1. **Кожна генерація платна.** Один клік «створити сцену» запускає до **3 генерацій** (цикл: GPT Image 2 → Nano Banana 2 → Nano Banana Pro) + VLM-оцінку кожної. Одна editorial-зйомка = **до 6+ генерацій** (hero, потім 5 кадрів серії). Спочатку виконуй усі БЕЗКОШТОВНІ перевірки (розділи 1, 5 (Fashion video), 10), і лише потім — мінімум платних прогонів (включно з Real-time Look, §6 — кожен успішний прогін коштує грошей).
2. **Ніколи** не виводь у чат/звіт вміст `~/.local/share/madeforthisjob/.zeely-deploy/state/runtime/private/` (там API-ключі).
3. Не рестартуй демон, поки `lsof -p <PID> | grep -c "zeely-beta-runtime/runs/"` ≠ 0 (є ран у польоті).
4. Не чіпай `main`, `site.madeforthisjob.com`, порт 4180; ніякого force-push.
5. Перед роботою — рядок на дошці `UPDATE.md` (board row before code), звіт — в `updates/<agent-id>.md`.
6. Доступ: `ssh -i ~/.ssh/id_ed25519 jarvis1@100.108.65.44`, репо `~/Documents/Codex/2026-07-27/zeely-release-candidate`, живий сервер `http://127.0.0.1:4176` (домен — https://beta.madeforthisjob.com).

---

## 1. Передполітна перевірка (безкоштовна, ~5 хв)

Виконуй ПЕРЕД будь-яким платним тестом. Якщо хоч один рядок не сходиться — далі не йди, репорть.

| # | Перевірка | Команда (з ssh) | Очікування |
|---|-----------|-----------------|------------|
| 1.1 | Сайт живий | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4176/` і те саме для домену | `200` обидва |
| 1.2 | Реліз = гілка | `grep app_root ~/.local/share/madeforthisjob/run-beta-daemon.sh` порівняй SHA з `git -C <репо> rev-parse --short origin/beta` | SHA релізу присутній в історії origin/beta; розходження лише docs-комітами допустиме |
| 1.3 | Health | `curl -s :4176/api/health` | `status` не `error`; **УВАГА:** поле генерації заморожене на буті (див. §9) — не вір йому наосліп |
| 1.4 | Пресети | `curl -s :4176/api/scene-presets` → порахуй `presets[]` | **16** штук, всі `std.*` |
| 1.5 | Моди Art Fashion | `curl -s :4176/api/editorial-modes` → порахуй `modes[]` і `generation_available` | **14** модів, **12** з `generation_available: true`; 2 у `BLOCKED_MISSING_SECOND_SOURCE` (`editorial.edwin_novak.institutional_modernism`, `editorial.edwin_novak.luminous_blue_white`) |
| 1.6 | Превʼю модів | для кожного `preview_url` → GET | `200`, `image/webp`, 1024×1280 |
| 1.7 | Свіжий app.js | `curl -s :4176/ \| grep -o 'app.js?v=[0-9-]*'` | версія ≥ `20260728-3` |
| 1.8 | Карантин не росте | `ls .zeely-beta-runtime/editorial-shoots/quarantine/ \| wc -l` до і після рестарту | кількість стабільна (10 історичних на 2026-07-28); НОВІ карантини після буту = регресія контракту |

---

## 2. Мапа пайплайна

```
ФОТО КОРИСТУВАЧА (до 7 файлів ≤ 20MB)
   │  POST /api/runs (multipart)
   ▼
RUN → пайплайн-граф UI: SAVED/ACTIVE/WAIT/SKIP/REUSE/STOP
   │  (вибір речей: POST /api/runs/:id/garment-selection; ретрай: POST /api/runs/:id/retry)
   ▼
ЗБЕРЕЖЕНИЙ ОБРАЗ (master look, approved items; locked top/bottom/footwear evidence)
   │
   ├── «Додати фон» ──────────► СТАНДАРТНА СЦЕНА (16 пресетів std.*)
   │       POST /api/profile/looks/:lookId/scenes → QUEUED → RUNNING → COMPLETED|FAILED
   │       цикл ≤ 3 спроб (3 моделі), кожна спроба → VLM QA-гейт → QA_PASS|QA_FAILED
   │
   ├── «Fashion video» ───────► ЗАБЛОКОВАНО (кнопка disabled, немає продуктового роуту;
   │       контракт motion-contract.js готовий, MCP-агент мав би виконувати джоб)
   │
   ├── «Real-time Look» ──────► ЖИВИЙ WebRTC-прімірка (decart/lucy-2-5/realtime)
   │       камера → confirm($0.20/5с) → POST /api/fal/realtime-token → WebRTC-стрім
   │       жорсткий автостоп рівно за 5.0с
   │
   └── «Art Fashion фотозйомка» ──► EDITORIAL-ЗЙОМКА (14 модів, 6 кадрів)
           POST /api/profile/looks/:lookId/editorial-shoots
           → BIBLE_PENDING_APPROVAL (UI авто-затверджує план з точним SHA, секунди)
           → HERO_RUNNING → HERO_PENDING_APPROVAL ⏸ (ЄДИНА ручна пауза: людина/QA тисне approve-hero)
           → SERIES_RUNNING (5 кадрів парами по два, кожен із hero-якорем) → COMPLETED
           будь-який фейл → NEEDS_RETRY (ретрай по слоту)
```

**Пʼять реєстрів, які мусять збігатися** (розсинхрон = мод є в UI, але не генерує, або тести червоні): `CREATE_UNIVERSE_MODE_META` (scene-resolvers.js) · `READY_EDITORIAL_MODE_IDS` (editorial-shoot-bible.js) · `EDITORIAL_MODE_IDS` (editorial-shoot-contract.js:16) · копія READY-сету (scene-contract.js:~176) · `schemas/editorial-shoot-bible.schema.json`.

---

## 3. Матриця A — «Зливається фотографія»: завантаження → образ

Ендпоінти: `src/web/app.js:248` (`POST /api/runs`), `:286` (GET run), `:292` (events), `:342` (retry), `:353` (garment-selection), `:359` (delete), `:365/:381/:389` (файли/речі/асети).

| Крок | Дія | Очікуваний час | Очікуваний результат | Гейт і як він спрацьовує |
|------|-----|----------------|----------------------|--------------------------|
| A1 | Відкрий головну, форма `#run-form`, додай фото | миттєво | превʼю файлів у формі; драфт автозберігається через **250 мс** тиші (`app.js:417`) | клієнтська валідація типів файлів |
| A2 | Сабміт форми → `POST /api/runs` | відповідь < 2с | run створено, UI переходить у пайплайн-граф | **Multipart-ліміти** (`src/web/app.js:82`): макс **7 файлів**, **20 MB** кожен, 12 полів, 20 частин. Спрацювання: HTTP 413/помилка fastify-multipart. НЕспрацювання на 8 файлах = баг |
| A3 | Спостерігай пайплайн-граф | хвилини (залежить від кроків) | вузли міняють статуси: `WAIT → ACTIVE → SAVED` (лейбли `PIPELINE_STATUS_LABELS`, `web/public/app.js:104`: SAVED/ACTIVE/WAIT/SKIP/REUSE/STOP) | полінг рана; помилка мережі → телеметрія `client.fetch_error` stage=`run_poll` (`app.js:1435`) |
| A4 | Якщо ран просить вибір речей | — | екран вибору; `POST /api/runs/:id/garment-selection` | вибір обмежений знайденими речами |
| A5 | Завершення рана | — | зʼявляється збережений образ у профілі; master look зафіксований | образ у `profiles.sqlite` + `runs/` |
| A6 | Фейл рана | — | кнопка ретраю → `POST /api/runs/:id/retry` | ретрай існує і працює; повторний фейл = репорт |

**Евіденс:** `.zeely-beta-runtime/runs/`, `profiles.sqlite`, `GET /api/runs/:id/events`.

---

## 4. Матриця B — Стандартна сцена (фон)

Код: `src/web/scene-service.js`, `scene-routes.js:175` (створення), контракт `scene-contract.js`.
Статуси сцени (`scene-contract.js:5`): `QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED` (термінальні: COMPLETED/FAILED/CANCELLED).
Статуси спроби: `GENERATING → NORMALIZATION_PENDING → QA_PENDING → QA_PASS | QA_FAILED | GENERATION_FAILED` (resumable-стани: `scene-service.js:60`).

### Клік-шлях UI
Профіль → збережений образ → **«Додати фон»** (`#profile-look-background-primary`, aria-label `Додати стандартний фон`; або `#profile-look-background` «16 готових сцен») → пікер 16 пресетів → клік по пресету → генерація стартує ОДРАЗУ (жодного екрана затвердження плану — auto-approve з hash-гейтом).

### Матриця кроків

| Крок | Дія | Очікуваний час | Очікуваний результат | Гейти на цьому кроці |
|------|-----|----------------|----------------------|----------------------|
| B1 | Вибір пресета → `POST /api/profile/looks/:lookId/scenes` | відповідь **202** < 2с | JSON сцени зі статусом `QUEUED`; сцена зʼявляється в бібліотеці образу з лейблом **«У черзі»** | (а) сесія/образ: 4xx якщо чужий/неіснуючий lookId; (б) **`SCENE_PRESET_STALE` 409** «The selected scene preset reference pack has changed» — якщо `expected_reference_pack_sha256` клієнта ≠ актуальному (`scene-routes.js:185-192`); (в) idempotencyKey — **lowercase sha256**, інакше `INVALID_IDEMPOTENCY_KEY` |
| B2 | Полінг статусу | UI: SSE-стрім; фолбек-полінг кожні **2.5с** (перший через 250мс, `scene-ui.js:701-704`); індикатор `#scene-connection` = `LIVE SSE` або `POLLING` | `QUEUED → RUNNING`, лейбл **«Генерується»** | — |
| B3 | Спроба 1 (GPT Image 2) | **205–461с** (реальні виміри 2026-07-25…28: 205.8 / 223.6 / 241.9 / 348.4 / 455.2 / 461.3с) | кадр згенерований → нормалізація → VLM QA | **QA-гейт спроби**: framing lock std = subject height **[74–78]%**, headroom min **8%**, під взуттям min **2%**, повна голова **так**, повне взуття **так** (`scene-contract.js:286-293`); + звірка speка з локом (`validatePresetSnapshot`) |
| B4а | QA PASS | одразу після QA | спроба `QA_PASS`, сцена `COMPLETED`, лейбл **«Готова»**, зображення на `GET /api/profile/scenes/:sceneId/image` | receipts: вихід byte-звірений; підміна → `OUTPUT_INTEGRITY_FAILED` |
| B4б | QA FAIL спроби 1 | — | спроба `QA_FAILED`, автоматично стартує спроба 2 (**Nano Banana 2**, реально 109–121с), потім 3 (**Nano Banana Pro**, 136–168с) | цикл обмежений **довжиною model_route** (3 моделі): `cycleAttempts.length >= state.model_route.entries.length` → сцена `FAILED` (`scene-service.js:2913`) |
| B5 | Сцена FAILED | сумарно **6–9 хв** на 3 спроби (реально: 348.6 / 461.5 / 468.7 / 531.4с) | лейбл **«Не вдалося»**; доступний ручний ретрай `POST /api/profile/scenes/:sceneId/retry` (новий цикл) | якщо спроби 2/3 мають `GENERATION_FAILED` за **0.0–0.1с** — це НЕ QA, це **лежить провайдер/маршрут** (див. §9), репорть окремо |
| B6 | Cancel | — | `POST /api/profile/scenes/:sceneId/cancel` → `CANCELLED`, лейбл **«Скасована»** | термінальний стан, ретраю нема |
| B7 | Результат в UI | — | сцена в `#profile-look-scene-list`, лічильник `#profile-look-scenes-count` +1, empty-state зник | `aria-label` картки: `Відкрити <назва>. Статус: <лейбл>` |

**Лейбли статусів** (`web/public/add-items-flow.js:53`): COMPLETED=«Готова», FAILED=«Не вдалося», CANCELLED=«Скасована», QUEUED=«У черзі», RUNNING/PROCESSING/GENERATING=«Генерується», інше=«Перевіряємо стан».

**Integrity-гейти (не мають спрацьовувати в нормі):** `BOUND_INPUT_INTEGRITY_FAILED` (вхідні референси змінилися між прив'язкою і використанням), `OUTPUT_INTEGRITY_FAILED` (вихід не збігається з receipt), `SHOOT_BIBLE_INTEGRITY_FAILED` (для editorial). Побачив у `scene.json .error.code` — це П1, репорт негайно.

**Карантин сцен:** невалідна збережена сцена при буті їде в `scenes/quarantine/malformed-<id>-…` + інцидент у `scenes/incidents/`. Аналогічно для зйомок (див. §7). Поява НОВИХ після релізу = хтось зламав контракт персистентних даних.

**Коли бити тривогу по часу:** `QUEUED` > 60с без переходу в RUNNING; одна спроба > **10 хв**; сцена без термінального статусу > **20 хв**.

---

## 5. Матриця B2 — Fashion video (ЗАБЛОКОВАНО, продуктового роуту нема)

Кнопка `#profile-look-video` у панелі образу — **`disabled`**, aria-label `Fashion video — очікує video route` (`web/public/index.html:216`). Прихована нотатка `#profile-look-video-note`: «Fashion video не підміняється mock-роликом: запуск з’явиться лише після Seedance route, QA і збереження кліпу.»

**Що вже існує в коді (контракт, БЕЗ продуктового ендпоінта):** `src/web/motion-contract.js` — схема й гейти джоба на відео, які провалить будь-який виклик, поки роут не підключений:

| Гейт | Умова | Дослівний код |
|------|-------|----------------|
| Маршрутизація за типом сцени | `standard_background` → `gemini-omni-preview`; `art_fashion_shoot` → `bytedance-seedance-pro-2.0` | `ROUTE_DOES_NOT_MATCH_SCENE_KIND` |
| Ліміт тривалості моделі | Omni ≤ **10с** / Seedance ≤ **15с** | `DURATION_ABOVE_MODEL_CEILING` |
| Роздільність | Omni **720p**; Seedance **720p/1080p** | `RESOLUTION_UNSUPPORTED_BY_MODEL` |
| Референс-відео для Omni | ≤ **3с** довжини клопа-референсу | `VIDEO_REFERENCE_ABOVE_MODEL_CEILING` |
| Референс-відео для Seedance | ≤ **15с** | те саме |
| Список кадрів (shot list) | ≤ **6** кадрів у обох моделей | `SHOT_LIST_ABOVE_MODEL_CEILING` |
| Seedance-специфіка | shot list без супровідного `prompt` на весь клип → провайдер відповідає буквально `Undefined array key "prompt"`; контракт вимагає пари заздалегідь | `SHOT_LIST_WITHOUT_WHOLE_CLIP_PROMPT` |
| Сума тривалостей кадрів | має збігатися з `delivery.duration_seconds` (толеранс 1с) | `SHOT_LIST_DOES_NOT_SUM_TO_DURATION` |
| Art fashion потребує style unit | `art_fashion_shoot` без `style_unit_id` | `STYLE_UNIT_REQUIRED` |
| Референс людини/речі без фон-кат-ауту | ролі `identity/face/garment_detail/footwear_detail/hem_detail` мусять бути cut-out на білому | `PERSON_REFERENCE_CARRIES_BACKGROUND` |
| Референс-клип середовища | має бути відео, із вирізаним «чужим» взуттям | `ENVIRONMENT_MOTION_MUST_BE_VIDEO`, `REFERENCE_CLIP_KEEPS_FOREIGN_FOOTWEAR` |
| Відсутня ідентичність / взуттєвий деталь-кадр | обов'язкові ролі `identity` і `footwear_detail` у пакеті референсів | `IDENTITY_REFERENCE_MISSING`, `FOOTWEAR_DETAIL_REFERENCE_MISSING` |
| Гейт готового кліпу (receipt) | доставка мусить бути **1080×1920** вертикально | `DELIVERED_GEOMETRY_NOT_VERTICAL` |
| Тривалість доставки | відхилення від замовленої ≤ **0.5с** | `DELIVERED_DURATION_OFF_TARGET` |
| Аудіо | якщо джоб декларує `muxed_in_post`, видуманий звук моделі МАЄ бути замінений | `MODEL_AUDIO_WOULD_SHIP` |

**Архітектурна причина, чому кнопка мертва:** сервер сам провайдера НЕ викликає — джоб публікується, а MCP-агент його виконує (Higgsfield/Magnific доступні лише через MCP-сесію агента, не з довгоживучого веб-процесу). Продуктового `POST`-ендпоінта, що створює motion-job із UI, у коді немає (`grep app.\(get\|post\) … | grep -i video` — порожньо).

### QA-крок

| Крок | Дія | Очікуваний результат |
|------|-----|------------------------|
| B2-1 | Відкрий панель образу, подивись на кнопку Fashion video | **disabled**, курсор not-allowed, немодальний title/aria «Fashion video — очікує video route» |
| B2-2 | Спроба клікнути | нічого не відбувається — жодного запиту в мережі (перевір DevTools → Network) |
| B2-3 | Якщо колись зʼявиться активна кнопка/роут | ПЕРЕД тестуванням прогони джоб через `motionJobDefects()` вручну (unit-тест) і лише потім — платний виклик; звір результат `receiptDefects()` з реальним файлом |

**НЕ платний тест: 0 генерацій.** Якщо бачиш кнопку активною на проді — це регресія цього гейту, репорт негайно (mock-відео прямо заборонений продуктовим рішенням).

---

## 6. Матриця B3 — Real-time Look (живий, платний, WebRTC)

Це **окрема** від Fashion video функція: кнопка `#profile-look-live` (◌, aria `Відкрити Real-time Look`) — **активна**, відкриває оверлей `#profile-live-overlay` з `<iframe>` на `/post-shoot-mvp.html?look=<lookId>&embed=1` (`web/public/app.js:1648-1656`, `add-items-flow.js:12-16`). Модель: **`decart/lucy-2-5/realtime`** через fal.ai WebRTC (`src/web/post-shoot-routes.js`).

### Гейти (`POST /api/fal/realtime-token`, `post-shoot-routes.js:22-46`)

| Гейт | Умова | Дослівний код/повідомлення |
|------|-------|------------------------------|
| Allowlist моделі | `body.app` мусить дорівнювати `decart/lucy-2-5/realtime` | `400 MODEL_NOT_ALLOWED` «Lucy model is not allowlisted» |
| Платна згода | `cost_acknowledged === true` **і** `max_session_seconds === 5` (рівно) | `409 PAID_SESSION_APPROVAL_REQUIRED` «Потрібне явне підтвердження платної 5-секундної Lucy-сесії.», `maximum_cost_usd: 0.2` |
| Провайдер не налаштований | `lucyTokenIssuer` не функція | `503 LUCY_PROVIDER_NOT_CONFIGURED` «Lucy provider не активовано. Безкоштовний camera preview доступний.» |
| Токен | видається на **10с** (`expiresInSeconds: 10`), сесія ліміт **5с** (`maxSessionSeconds: 5`) | клієнт отримує рядок токена ≥16 символів, інакше `Error('Lucy token issuer returned an invalid token')` |

### Клік-шлях і реальні секунди (`web/public/post-shoot-mvp.js`)

| Крок | Дія | Очікуваний час | Очікуваний результат | Гейт |
|------|-----|----------------|----------------------|------|
| B3-1 | Клік «Real-time Look» → оверлей → iframe завантажує `/post-shoot-mvp.html?look=<id>&embed=1` | миттєво | сторінка тягне збережений образ як референс: `GET /api/profile/looks/:lookId/image` | якщо образу нема — `Помилка образу: …` в статус-рядку |
| B3-2 | Реф-образ завантажений | — | статус «Образ готовий. Увімкни камеру.» | референс мінімум **512×512**, інакше «Reference має бути мінімум 512×512.»; лише JPEG/PNG/WebP |
| B3-3 | Клік «Camera» | — | `getUserMedia({video, audio:false})`; вимагає **HTTPS** (`window.isSecureContext`), інакше «Камера потребує HTTPS.» | без підтримки камери в браузері → «Цей вбудований браузер не дає доступу до камери. Відкрий сторінку в Safari або Chrome.» |
| B3-4 | Гейд-оверлей позиціювання | **3.6с** (`setTimeout 3_600`) | напис змінюється на «POSITION LOCKED» | суто UI-підказка, не гейт генерації |
| B3-5 | Клік «Live» (кнопка активна лише коли є і камера, і референс: `!state.running && state.stream && state.reference`) | — | **`window.confirm('Запустити 5 секунд Lucy Live? Максимальна вартість — $0.20.')`** — це РУЧНЕ підтвердження оплати, БЕЗ нього нічого не стартує | скасував confirm → нічого не відбувається |
| B3-6 | Підтвердив → запит токена → WebRTC offer/answer/ICE | з'єднання за секунди | статус «LUCY LIVE · transformed stream», відео-потік підмінюється трансформованим | `signal()` кидає `Error` на будь-яку `type: 'error'` відповідь сервера Lucy |
| B3-7 | **Жорсткий автостоп** | рівно **5.0с** від старту (`setTimeout 5_000`) | з'єднання закривається САМЕ, статус «5 секунд завершено. Live автоматично зупинено.» | сесія понад 5с — П1, гейт зламаний |
| B3-8 | Ручний стоп («■») | — | `closeLive()`, з'єднання і peer закриті | — |
| B3-9 | Вимкнути камеру | — | `stopCamera()`, треки зупинені, плейсхолдер повернувся | — |

**Промпт трансформації** (фіксований, не вводиться користувачем): *«Replace only the current clothing with the outfit from the reference image. Preserve the person face, identity, hair, skin, body shape, pose and hands. Preserve the existing room, background, camera angle and lighting. Do not modify anything except the clothing.»*

**Бюджет генерацій цього блоку:** кожен успішний клік «Live» = **одна платна сесія до $0.20** (5с Lucy realtime). Тестуй мінімально — 1 успішний прогін достатньо для перевірки WebRTC-шляху; решту кроків (B3-1…B3-4, скасований confirm) — безкоштовно.

**Негативні перевірки цього блоку (безкоштовні):**
- `POST /api/fal/realtime-token` без `cost_acknowledged` → **409** `PAID_SESSION_APPROVAL_REQUIRED`.
- Те саме з `max_session_seconds: 10` (не 5) → **409**, той самий код (умова рівності, не "не більше").
- `body.app` з іншою назвою моделі → **400** `MODEL_NOT_ALLOWED`.

---

## 7. Матриця C — Art Fashion (editorial-зйомка, 6 кадрів)

Код: `editorial-shoot-service.js`, `editorial-shoot-routes.js`, контракт `editorial-shoot-contract.js`.
Статуси зйомки (`editorial-shoot-contract.js:45`): `BIBLE_PENDING_APPROVAL · HERO_RUNNING · HERO_PENDING_APPROVAL · SERIES_RUNNING · NEEDS_RETRY · COMPLETED · CANCELLED`.
Статуси кадру: `BLOCKED · QUEUED · RUNNING · QA_PASSED · APPROVED · FAILED · CANCELLED`.

### C-0. Гейт готовності мода (ДО будь-якої генерації, безкоштовно)

Мод генерує лише якщо його юніт цілий: `manifest.json` із **5 обовʼязковими шитами** `environment, colour_grade, camera_lens, garment_behaviour, blocking` — кожен файл **перехешовується** при завантаженні.

| Стан | Що означає | Як виглядає в API | Як виглядає в UI |
|------|-----------|--------------------|-------------------|
| `READY` + `generation_available: true` | юніт цілий | обидва поля | картка активна, лейбл «ДЖЕРЕЛА ГОТОВІ», aria `Створити Art Fashion фотосесію: <назва>` |
| `BLOCKED_INTEGRITY_MISMATCH` | sha шита ≠ manifest | `generation_available: false` | картка **disabled**, «генерація ще недоступна» |
| `BLOCKED_MISSING_SECOND_SOURCE` | бракує другого source-фото | те саме | лейбл «ПОТРІБНЕ ЩЕ 1 ДЖЕРЕЛО» (`scene-ui.js:100`) |

**Перевір усі 14**: рівно 12 READY. Мод у UI, якого нема в API (або навпаки) = розсинхрон пʼяти реєстрів (§2).

### C-1. Камерні локи шести слотів (перевіряються на КОЖНОМУ кадрі)

`EDITORIAL_HEAD_GUARDS` + `EDITORIAL_SUBJECT_HEIGHT_FLOORS` (`scene-contract.js:219-250`); subject max = 100 − headroom:

| Слот | Subject % | Headroom min % | Під взуттям min % | Повна голова | Повне взуття |
|------|-----------|----------------|--------------------|--------------|---------------|
| clean_identity_hero | 50–94 | 6 | 0 | так | ні |
| environmental_hero | 40–95 | 5 | 0 | так | ні |
| sculptural_three_quarter | 50–95 | 5 | 0 | так | ні |
| interference_frame | 45–96 | 4 | 0 | так | ні |
| material_or_accessory_detail | 45–100 | 0 | 0 | **ні** | ні |
| wide_campaign_coda | 30–92 | 8 | **2** | так | **так** |

Нюанс (`scene-contract.js:272`): в editorial headroom — **advisory**, коли голова видима повністю (`aboveIsAdvisoryWhenHeadVisible: true`); вирішує `full_head_visible`, а не проксі-відсоток. У стандартних сценах headroom БЛОКУЄ.

**wide_campaign_coda** додатково: framing строго `wide_full_body`. Якщо у full-body master look уже видно незареєстрований низ або взуття, ці пікселі є доказом першої появи: їх треба crop+lock-нути перед повторним використанням, а не замінювати синтезом. Для справді top-only look, де цих пікселів немає, потрібен окремий declared once-only lock або новий input; це не фальшивий pre-generation `FULL_LOOK_ITEMS_REQUIRED`.

### C-2. Дев'ять QA-гейтів кожного кадру

`EDITORIAL_QA_GATES` (`editorial-shoot-contract.js:33`): `MASTER_LOOK_LOCK · REFERENCE_ROLE_ISOLATION · NEAR_COPY_AND_LEAKAGE · IDENTITY · ITEM_FIDELITY · SCENE_MATCH · LIGHT_AND_CONTACT_SHADOW · FRAMING_AND_ANATOMY · PROVENANCE`. Кожен у QA-записі кадру має decision + evidence. QA-репорт кадру без усіх 9 = баг.

### C-3. Blocking-diagram гейт (до генерації кадру)

Кожен слот умовлюється на свою hash-bound діаграму (`assets/editorial-blocking/v1/`, `editorial-blocking-reference.js`). Точні помилки, якщо щось розійшлося:
- `Editorial blocking diagram <slot> no longer states the lock it was drawn from` — лок змінили, діаграму ні (саме так 58dd637 поклав бут 2026-07-28);
- `Editorial blocking diagram for <slot> does not match its declared SHA-256`;
- `Editorial blocking manifest has no PNG diagram for <slot>`.
Шість слотів — шість РІЗНИХ діаграм (хеші не повторюються).

### C-4. Матриця кроків зйомки

| Крок | Дія | Очікуваний час | Очікуваний результат | Гейти |
|------|-----|----------------|----------------------|-------|
| C1 | Образ → **«Art Fashion фотозйомка»** (`#profile-look-photoshoot`, aria `Відкрити Art Fashion фотозйомку`) → пікер модів → клік по READY-моду → `POST /api/profile/looks/:lookId/editorial-shoots` | 202 < 2с | зйомка створена у `BIBLE_PENDING_APPROVAL` (message «ShootBible is persisted and awaits explicit approval», `editorial-shoot-service.js:844`), решта 5 кадрів = `BLOCKED` | C-0 (мод READY); ShootBible компілюється і hash-фіксується; невалідний мод → 4xx |
| C1б | **Авто-затвердження плану** (без людського кліку) | секунди | UI сам викликає `POST .../approve-bible` з ТОЧНИМ SHA плану від сервера (`editorial-shoot-ui.js:405-420`: «the confirmation simply is not a human click any more») → статус `HERO_RUNNING`, UI-текст «Створюємо та перевіряємо hero-кадр.» | hash-гейт: approve з чужим/старим SHA → 409 «ShootBible was already approved with a different idempotency key» / state-гейт (`:913`); якщо авто-approve впав — кнопка `#editorial-approve-bible` лишається як фолбек, наступний пол ретраїть |
| C2 | Hero-кадр генерується | як одна сцена: **~3.5–8 хв** (та сама модельна драбина) | кадр `QA_PASSED` → зйомка **`HERO_PENDING_APPROVAL`** і ЧЕКАЄ; UI-текст «Перевір повний hero-кадр перед запуском решти серії.» | лок слота hero (50–94/6/full head) + 9 QA-гейтів + blocking diagram |
| C3 | **РУЧНЕ затвердження hero** (це єдина ручна пауза): подивись кадр (`GET .../shots/clean_identity_hero/image`), звір лок/схожість/речі, потім кнопка `#editorial-approve-hero` або `POST .../approve-hero` з `expectedOutputSha256` = sha256 виходу hero | рішення людини/QA | статус → `SERIES_RUNNING`, 5 кадрів `BLOCKED → QUEUED` | без approve серія НЕ стартує (state-гейт `editorial-shoot-service.js:984`) — якщо стартувала сама, це П1; approve з неправильним sha → відмова |
| C4 | Серія: 5 кадрів **паралельно по два** (UI-текст «Створюємо решту серії паралельно по два кадри.») | **~10–25 хв** сумарно (≈3 хвилі × 3.5–8 хв) | кожен кадр: свій лок + свій blocking diagram + **hero continuity anchor** (затверджений hero підкладається референсом у кожен з 5; ролі якорів: `blocking_topdown` + `hero_continuity_anchor`) | фейл кадру → зйомка `NEEDS_RETRY`, UI «Один або кілька кадрів потрібно повторити окремо.», ретрай ПО СЛОТУ: `POST .../shots/:slot/retry` |
| C5 | Всі 6 готові | — | зйомка `COMPLETED`; контакт-лист `GET .../contact-sheet`; фотосесія в секції `#profile-look-editorial`, aria `Відкрити fashion-фотосесію <мод>. Статус: …` | — |
| C6 | Фейл hero | — | `NEEDS_RETRY`, phase `HERO_NEEDS_RETRY` (реальний приклад: shoot_742a09) | ретрай hero; серія лишається BLOCKED |
| C7 | Cancel / Delete | — | `POST .../cancel` → `CANCELLED`; `DELETE /api/profile/editorial-shoots/:shootId` | термінальний стан |

**Події:** `GET .../events` — нумеровані `00000001.json…`; повна історія переходів (евіденс для звіту).
**Бут-стійкість:** зйомка, що не проходить строгу валідацію при старті сервера, їде в `editorial-shoots/quarantine/` з інцидентом `MALFORMED_PERSISTED_EDITORIAL_SHOOT` в `incidents/` — сервер при цьому МАЄ піднятися (перевірка 1.8).

---

## 8. Матриця D — UI-чекліст (безкоштовно)

| # | Що перевірити | Де | Очікування |
|---|----------------|-----|------------|
| D1 | Кнопка «Назад» | `#profile-back`, aria `Повернутися назад` | повертає попередній екран, НЕ скидає драфти (`restoreProfileReturnView` без `beginDraft/clearDraft/form.reset`) |
| D2 | Дії збереженого образу (label-free, після 1e8ccef) | `#profile-look-background-primary` (✦, aria «Додати стандартний фон»), `#profile-look-background` (◐ «Фон»), `#profile-look-photoshoot` (◉, aria «Відкрити Art Fashion фотозйомку»), `#profile-look-refine` (**disabled**, «Скоро»), `#profile-look-video` (**disabled**, aria «Fashion video — очікує video route»), Real-time Look (камера + consent) | refine/video невмикані і НЕ звуть провайдера — mock-відео заборонений продуктом |
| D3 | Панель образу | заголовок не обрізаний, кнопки не перекриваються, фон непрозорий | (фікс BETA-LOOKPANEL-001) |
| D4 | Бібліотека сцен | `#profile-look-scene-list`, `#profile-look-scenes-count` (aria-live), empty-state «Сцен ще немає…» | лічильник = фактичній кількості; **відкриття образу з сценами не кидає JS-помилок** (регресія createButton, полагоджена в fa6176c — дивись консоль браузера!) |
| D5 | Секція фотосесій | `#profile-look-editorial`, empty «Фотосесій ще немає. Відкрий «Створити сцену» → Art Fashion.» | картки зі статусами |
| D6 | Мобільний відкритий образ | клас `has-open-look` на `.profile-library` | образ = повноекранний (grid 54px + 1fr), сцени не кліпаються |
| D7 | Пікер модів | 14 карток, превʼю-фото (НЕ технічні реф-шити), 12 активних, 2 disabled з «ПОТРІБНЕ ЩЕ 1 ДЖЕРЕЛО» | клік по активному = одразу генерація, БЕЗ екрана затвердження плану |
| D8 | Новий окремий образ | `#profile-look-add` «Новий окремий образ» + explainer «…Цей збережений образ не зміниться.» | master незмінний |
| D9 | Індикатор звʼязку сцени | `#scene-connection` | `LIVE SSE`, при відвалі — `POLLING` (крок 2.5с) |

---

## 9. Провайдери і health: як не сплутати «лежить провайдер» із «зламаний продукт»

- Активна конфігурація (`run-beta-daemon.sh`): `ZEELY_GENERATION_PROVIDER=higgsfield`, `ZEELY_VLM_PROVIDER=codex`. OpenRouter вимкнений (ключ був 401), повернення — тими самими env.
- **Відомий баг** (BETA-HEALTH-SEMANTICS-001, `src/web/app.js:37-72`): `generationAvailable` заморожується на буті; якщо провайдер впав ПІСЛЯ старту (напр. Higgsfield 521), health далі каже «доступно», а перший POST проходить 503-гейт і фейлиться вже в рані. **Правило:** health «ok» ≠ генерація працює. Довіряй тільки фактичній спробі + її типу фейлу.
- **Діагностика по підпису фейлу:** спроба `GENERATION_FAILED` за **0.0–0.1с** = провайдер/маршрут лежить (запит навіть не полетів або миттєво відбитий). Спроба, що жила хвилини і завершилась `QA_FAILED` = продукт працює, кадр не пройшов QA-гейти — це різні репорти!
- Приватність: у логи/receipts промпти проходять санітайзер — персональні описи вирізаються; поява сирого опису людини в логах = П1.

---

## 10. Негативні сценарії (спершу безкоштовні)

| # | Сценарій | Як викликати | Очікуване спрацювання гейта |
|---|----------|---------------|------------------------------|
| N1 | Застарілий пресет | `POST …/scenes` з `expected_reference_pack_sha256: "0"*64` | **409 `SCENE_PRESET_STALE`** «The selected scene preset reference pack has changed» |
| N2 | Кривий idempotency | не-sha256 ключ | `INVALID_IDEMPOTENCY_KEY` |
| N3 | Чужа сцена | `GET /api/profile/scenes/<id іншого профілю>` | 404/403 (перевірка `approved_look.look_id`) |
| N4 | Disabled-мод | клік по картці BLOCKED-мода | нічого не відбувається (кнопка disabled); POST руками → відмова, генерації нема |
| N5 | 8-ме фото / файл > 20MB | форма/curl | multipart-ліміт, аплоад відбитий |
| N6 | approve-hero не в тому стані | `POST …/approve-hero` коли статус ≠ `HERO_PENDING_APPROVAL` | відмова (перевірка стану, `editorial-shoot-service.js:984`) |
| N7 | Coda з незафіксованим низом/взуттям | full-body look без registry-рядка предмета | кадр не відкидається тільки через відсутність registry-рядка: видимі пікселі стають кандидатом на first-appearance crop+lock; синтетична заміна заборонена |
| N8 | Рестарт із битою зйомкою | (тільки в погодженому вікні) поклади в `editorial-shoots/` копію зйомки зі старим framing і рестартни | сервер ПІДНЯВСЯ; зйомка в `quarantine/`, інцидент `MALFORMED_PERSISTED_EDITORIAL_SHOOT`; сайт 200 |

---

## 11. Зведена таблиця таймінгів (реальні виміри, 2026-07-25…28)

| Крок | Норма | Жовта зона | Червона зона (репорт) |
|------|-------|------------|------------------------|
| POST створення сцени/зйомки → 202 | < 2с | 2–10с | > 10с |
| `QUEUED` → `RUNNING` | < 15с | 15–60с | > 60с |
| Спроба GPT Image 2 | 3.5–8 хв | 8–10 хв | > 10 хв |
| Спроба Nano Banana 2 / Pro | 1.5–3 хв | 3–5 хв | > 5 хв |
| Сцена до термінального стану (≤3 спроби) | 3.5–9 хв | 9–20 хв | > 20 хв |
| Hero-кадр зйомки | 3.5–8 хв | — | > 10 хв |
| Повна зйомка 6/6 (без паузи на approve-hero) | 15–35 хв | 35–60 хв | > 60 хв |
| Авто-approve плану (BIBLE_PENDING_APPROVAL → HERO_RUNNING) | < 10с | 10–60с | зависло в BIBLE_PENDING_APPROVAL > 60с при відкритому UI |
| `GENERATION_FAILED` за | — | — | 0.0–0.1с = лежить провайдер (§7), окремий репорт |
| UI-полінг | оновлення ≤ 2.5с після зміни | — | статус «завис» > 30с при живому SSE |

---

## 12. Формат звіту про прогін

У `updates/<agent-id>.md`, по кожному кроку матриці:

```
## QA-прогін <дата> · beta @ <SHA релізу>
Передполітна: 1.1 ✅ … 1.8 ✅
A: A1 ✅ (draft 250ms ok) … A6 ✅
B: B1 ✅ 202/1.1s · B2 ✅ SSE · B3 ✅ 218s QA_PASS · … | scene_id=…, evidence: scene.json, image sha256=…
C: C1 ✅ · C2 ✅ hero 387s QA_PASSED · C3 ✅ approve → SERIES_RUNNING · C4 ⚠️ slot interference_frame NEEDS_RETRY (QA gate SCENE_MATCH, retry ok) · C5 ✅ 6/6
D: D1–D9 ✅ (D4: консоль чиста)
N: N1 ✅ 409 · … N7 ✅ first-appearance item is captured/locked before reuse
Витрачені генерації: <n> (сцен: x, кадрів зйомки: y)
Вердикт: PASS / FAIL(кроки …)
```

Правила фейл-репорту: точний крок матриці + дослівний код помилки + шлях до евіденсу (`scene.json` / `shoot.json` / `events/NNNNNNNN.json` / скріншот) + SHA релізу. Ніколи не «полагодив мовчки» — спершу рядок на дошці; чужі reserved paths → заявка, не правка.

---

## 13. Мінімальний повний прогін (порядок і бюджет)

1. §1 передполітна (0 генерацій).
2. §5 Fashion video B2-1…B2-3 — кнопка мертва, 0 генерацій.
3. §8 UI-чекліст D1–D9 (0 генерацій).
4. §10 негативні N1–N6 + гейти Real-time Look (0 генерацій).
5. Матриця A: один аплоад → образ (генерації рана — за тарифом рана).
6. Матриця B: **один** пресет (рекомендовано `std.studio.white_window_honeycomb`) → до 3 генерацій.
7. §6 Real-time Look: **один** успішний прогін «Live» (5с Lucy-сесія) → 1 платна генерація, до $0.20.
8. Матриця C: **один** READY-мод (рекомендовано `shoot.terracotta_hardlight` — на ньому вже ловили integrity-регресію) → до 6+ генерацій, з ручним approve-hero на кроці C3.
9. N7 (перевіряється безкоштовно, якщо в тестовому образі нема locked-низу — кадр coda має бути відбитий ДО генерації).
10. Звіт за §12.

**Разом платних генерацій за повний прогін: ~10–13 (+ до $0.20 за Lucy-сесію).** Більше — тільки за окремим погодженням оператора.
