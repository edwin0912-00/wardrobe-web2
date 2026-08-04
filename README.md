# Wardrobe — інсталяційний AI wardrobe pipeline

Цей репозиторій містить **обидві частини робочого продукту** в одній гілці:

```text
wardrobe-web2/
├── b/          кінематографічний main-сайт
├── adapters/   browser ↔ API bridge
├── serve.py    same-origin gateway і MP4 Range server
└── beta/       engine, engineering UI, contracts, providers і QA
```

Default branch `main` є самодостатньою інсталяційною версією. Backend не треба
клонувати з іншого репозиторію або вручну підставляти за іншою адресою.

## Встановити й запустити однією командою

Потрібні Git, Python 3.10+ і Node.js 22+:

```bash
git clone --branch main https://github.com/edwin0912-00/wardrobe-web2.git \
  && cd wardrobe-web2 \
  && ./scripts/install-local.sh --run
```

Runner обирає вільні loopback-порти, якщо стандартні вже зайняті, і друкує
фактичні адреси. Зазвичай це:

- main-сайт: `http://127.0.0.1:4173/b/`;
- engineering beta: `http://127.0.0.1:4176/`;
- backend через main: `http://127.0.0.1:4173/api/health`.

Зупинка — `Ctrl+C` у тому самому Terminal.

## Що інсталятор перевіряє насправді

`install-local.sh` не обмежується пошуком рядків у файлах. Перед запуском він:

1. встановлює locked backend dependencies через `npm ci`;
2. запускає поведінкові тести main, API gateway, browser client, recovery та
   збереженої бібліотеки;
3. перевіряє backend contracts і canon;
4. запускає main і beta як два реальні процеси;
5. робить HTTP-запити до main UI, beta UI, `/api/health`, каталогів і bridge
   modules;
6. перевіряє, що MP4 Range повертає `206`, а не повний файл;
7. завершується помилкою, якщо main не бачить backend або module graph не
   завантажується.

Тому зелений install gate означає не «в коді є слово bridge», а фактичний
same-origin маршрут:

```text
browser → main /api/* gateway → beta engine → profile/job state
```

## Поведінка без provider-авторизації

Код, UI, API, профіль, каталоги, contracts і тести запускаються без секретів.
Реальна платна генерація потребує окремої локальної авторизації провайдера:

```bash
higgsfield account status --json
codex login status
```

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

## Безпека

У Git не входять API keys, OAuth/browser sessions, user runtime, uploads,
receipts, generated media або deployment credentials. Provider credentials
залишаються в системних credential stores конкретного комп’ютера.
