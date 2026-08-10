# Wardrobe — інсталяційний AI wardrobe pipeline

Цей репозиторій містить **обидві частини робочого продукту** в одній гілці:

```text
wardrobe-web2/
├── b/          кінематографічний main-сайт
├── adapters/   browser ↔ API bridge
├── serve.py    same-origin gateway і MP4 Range server
└── beta/       engine, engineering UI, contracts, providers і QA
```

Гілка `alpha` є поточною evaluator-кандидаткою. Після приймання вона може бути
fast-forward перенесена в `main`; до цього `main` не видається за новішу версію.
Backend не треба
клонувати з іншого репозиторію або вручну підставляти за іншою адресою.

## Встановити й запустити однією командою

Потрібні Git, Python 3.10+ і Node.js 22+:

```bash
git clone --filter=blob:none --depth 8 --single-branch --branch alpha https://github.com/edwin0912-00/wardrobe-web2.git \
  && cd wardrobe-web2 \
  && ./scripts/install-local.sh --run
```

Важкі demo-media не дублюються в Git tree. Інсталятор завантажує один pinned
GitHub Release bundle, перевіряє його SHA-256, розмір, file count і дозволені
шляхи, а вже потім запускає тести. Runner обирає вільні loopback-порти, якщо
стандартні вже зайняті, і друкує фактичні адреси. Канонічні локальні адреси:

- main-сайт: `http://127.0.0.1:4173/`;
- engineering beta: `http://127.0.0.1:4176/`;
- backend через main: `http://127.0.0.1:4173/api/health`.

Зупинка — `Ctrl+C` у тому самому Terminal.

## Що інсталятор перевіряє насправді

`install-local.sh` не обмежується пошуком рядків у файлах. Перед запуском він:

1. встановлює locked evaluator і backend dependencies через `npm ci`;
2. встановлює pinned Chromium і запускає справжній browser E2E через
   Playwright: page-owned bridge, два core runs (text outfit і reference
   outfit), чотири outputs, structured input error у реальному DOM, повернення
   до образу, бібліотеку та recovery після reload;
3. перевіряє backend contracts і canon;
4. запускає main і beta як два реальні процеси;
5. робить HTTP-запити до main UI, beta UI, `/api/health`, каталогів і bridge
   modules;
6. перевіряє, що MP4 Range повертає `206`, а не повний файл;
7. завершується помилкою, якщо main не бачить backend або module graph не
   завантажується.
8. окремо примушує bridge module повернути `404` і вимагає видимий
   `role="alert"`, нуль `POST /api/runs` та safe telemetry code `module-load`.

Тому зелений install gate означає не «в коді є слово bridge», а фактичний
same-origin маршрут:

```text
browser → main /api/* gateway → beta engine → profile/job state
```

## Одна тестова команда

Після встановлення канонічна перевірка запускається так:

```bash
npm test
```

Вона послідовно перевіряє locked source і контракти, відкриває справжній
Chromium, проходить два look journey, запускає main і beta як два окремі
процеси та перевіряє same-origin API і MP4 Range. На кожен запуск створюються
JSON receipt і окремі логи в `artifacts/test-system/`; перший реальний FAIL
зупиняє прогін і називає конкретний лог.

Додаткові режими:

```bash
npm run test:quick   # швидкий source + main gate
npm run test:full    # також повний backend suite
npm run test:live    # read-only перевірка публічних доменів і bridge у Chromium
npm run test:all     # повний local + live із повним списком незалежних помилок
```

Повний контракт системи описаний у
[`docs/TEST-SYSTEM.md`](docs/TEST-SYSTEM.md).

Повна відповідність критеріям першої ревізії — у
[`docs/REVIEWER-ACCEPTANCE.md`](docs/REVIEWER-ACCEPTANCE.md). Там кожна вимога
прив’язана до команди й observable result, а не до наявності рядка в коді.

## Поведінка без provider-авторизації

Код, UI, API, профіль, каталоги, contracts і тести запускаються без секретів.
Реальна платна генерація потребує окремої локальної авторизації провайдера:

Primary image transport — локально авторизований Codex. OpenRouter може бути
доданий як optional image fallback і наразі потрібен для реального video route:

```bash
export OPENROUTER_API_KEY='set-locally-never-commit'
```

Higgsfield не входить у дозволений production route цього deliverable. Magnific
не є необхідною залежністю core pipeline.

Якщо її немає, health чесно показує недоступний generation transport. UI не
імітує прогрес і не вигадує результат.

## Основний user journey

```text
Фото людини + 1–5 фото/описів речей
        ↓
Conditioning → avatar/look generation → QA
        ↓
Approved saved look
        ├── стандартний фон
        ├── Fashion Shoot
        ├── Fashion Video
        └── Real-time Look
```

Кожна гілка читає той самий збережений look, але не залежить від результатів
іншої гілки. Фони не є Fashion Shoot presets.

## Базові продуктові сценарії

### Помилка генерації

Backend повертає structured `code`, `failure_code`, `reason_code` і
`next_action`. Main показує авторський безпечний текст, фактичний код і доступну
дію: повторити, замінити input або повернутися до образу. Raw provider output,
URL, stack trace і model reasoning користувачу не показуються.

### Повернення назад

`Образи` повертає до бібліотеки збережених look’ів. `До образу` повертає з
terminal error/result до активного look. Reverse scroll із TV/laptop повертає
користувача в попередню кімнату.

### Профіль і акаунт

Для тестової версії використовується анонімний browser profile з fixed expiry,
а не email/password registration. Cookie зв’язує лише цього браузерного
користувача з його avatar/look records. Інші профілі main gateway не віддає.

### Історія створених матеріалів

Після reload bridge відновлює:

- avatars і approved looks;
- стандартні фони;
- частково або повністю готові Fashion Shoots;
- перевірені Fashion Videos.

Прев’ю використовують server-side lightweight derivatives; завантаження
повертає оригінальні байти.

## Перевірка окремо від інсталятора

Повний non-paid acceptance gate:

```bash
./scripts/install-local.sh
```

Окремий self-check без перевстановлення залежностей:

```bash
npm run self-check
```

Безпечне автоматичне відновлення лише інструментів (`npm ci` і Chromium), без
зміни QA, receipts, outputs або credentials:

```bash
npm run self-check:repair
```

Self-check доводить orchestration та поведінку браузера на deterministic fixture.
Він чесно **не** видає це за aesthetic/model-quality proof і не витрачає credits.

### Три різні рівні доказу

| Рівень | Що він доводить | Authority |
| --- | --- | --- |
| Local integration | bridge modules завантажились, main бачить engine | real HTTP startup + Chromium |
| Product behavior | core runs, error/recovery, back, profile/history після reload | `scripts/browser-core-e2e.mjs` |
| Model quality | identity, білий фон, outfit fidelity, anatomy | QA receipts + приклади `output/001..003`; не deterministic fixture |

Тільки main поведінкові тести:

```bash
./scripts/site-preflight.sh
```

Повна beta suite додатково:

```bash
node scripts/verify-alpha.mjs --full
```

Ручна HTTP-перевірка після запуску:

```bash
curl -fsS http://127.0.0.1:4173/api/health
curl -I -H 'Range: bytes=0-1023' http://127.0.0.1:4173/b/assets/seg1.mp4
```

## Важливі файли

- `adapters/zeely-client.mjs` — API client, idempotency, SSE recovery;
- `adapters/cinematic-ui-bridge.mjs` — presentation-neutral product state;
- `serve.py` — static media, Range і same-origin `/api` gateway;
- `beta/src/web/start.js` — backend entrypoint;
- `FUNCTION-MAP.md` — актуальна карта функцій і UI-поверхонь;
- `release/RELEASE.lock.json` — provenance обох частин;
- `scripts/run-alpha.sh` — спільний runtime;
- `scripts/verify-alpha.mjs` — source і behavior verifier.
- `scripts/browser-core-e2e.mjs` — browser-level core acceptance;
- `scripts/self-check.mjs` — окремий deterministic evaluator і safe repair gate.

## Безпека

У Git не входять API keys, OAuth/browser sessions, user runtime, uploads,
receipts, generated media або deployment credentials. Provider credentials
залишаються в системних credential stores конкретного комп’ютера.
