# Wardrobe — AI wardrobe pipeline у кінематографічному HTML5-сайті

Wardrobe — це інсталяційна версія інтерактивного сайту, який поєднує:

- завантаження фотографії людини та референсів одягу;
- створення і збереження перевіреного master-образу;
- стандартні фони, Fashion Shoot, Fashion Video та Real-time Look;
- технічний live-прогрес із реальними станами pipeline;
- scroll-driven HTML5-подорож квартирою;
- результати на телевізорі й інтерактивне пояснення pipeline на екрані ноутбука.

Офіційна стабільна гілка — `main`. Зафіксовані версії доступні в
[GitHub Releases](https://github.com/edwin0912-00/wardrobe-web2/releases).

## Встановити й запустити однією командою

Потрібні Git і Python 3.10 або новіший. У Terminal виконайте:

```bash
git clone --depth 1 --branch main https://github.com/edwin0912-00/wardrobe-web2.git && cd wardrobe-web2 && ./scripts/install-local.sh --run
```

Після повідомлення про запуск відкрийте:

**[http://127.0.0.1:4173/b/](http://127.0.0.1:4173/b/)**

Зупинити локальний сервер: `Ctrl+C` у тому самому Terminal.

## Що робить команда встановлення

`scripts/install-local.sh` не встановлює приховані глобальні залежності. Він:

1. перевіряє Python і наявність усіх обов'язкових HTML, JavaScript, відео та calibration-файлів;
2. перевіряє синтаксис локального Python-сервера;
3. якщо встановлений Node.js — запускає focused-тести ноутбука та JavaScript;
4. з параметром `--run` запускає `scripts/run-local.sh`;
5. відкриває сайт через спеціальний локальний сервер із HTTP Range support.

HTTP Range потрібен для коректного покадрового scrubbing MP4. Через це проєкт не слід
запускати командою `python3 -m http.server` або простим подвійним кліком по HTML.

## Як працює продукт

```text
Фото людини + фото речей
        ↓
Перевірка і нормалізація вхідних матеріалів
        ↓
Створення аватара та master-образу
        ↓
Identity / framing / item-fidelity QA
        ↓
Збережений образ
        ├── Додати нові речі
        ├── Створити стандартний фон
        ├── Створити Fashion Shoot
        ├── Створити Fashion Video
        └── Відкрити Real-time Look
```

Сайт не підміняє backend намальованим прогресом. Інтерфейс читає фактичні серверні
стани, checkpoints, результати QA та recovery-дії. Після оновлення сторінки збережений
контекст відновлюється через server profile/draft state, якщо API engine доступний.

### Кінематографічний шар

Маршрут сайту працює так:

```text
тканина → квартира → дзеркало з продуктом → телевізор із результатами → ноутбук із pipeline deck
```

Основні відео прокручуються відповідно до scroll-position. Телевізор і ноутбук — це
калібровані поверхні всередині відеокадру, а не окремі fullscreen-вікна.

### Пояснення на ноутбуці

Фінальний ноутбук містить актуальну інтерактивну презентацію з 17 панелей:

- джерела даних і reference contracts;
- avatar/look pipeline;
- QA та recovery;
- стандартні сцени;
- Fashion Shoot, Fashion Video і Real-time Look;
- runtime, provider transport і release evidence.

Джерело презентації — [`b/pipeline-deck-v2.html`](b/pipeline-deck-v2.html). Воно
монтується same-origin у ShadowRoot, перевіряється за SHA-256 і обрізається точно до
площини ноутбука. Reverse scroll повертає користувача назад у квартиру.

Детальний контракт: [`docs/17-LAPTOP-PIPELINE-DECK.md`](docs/17-LAPTOP-PIPELINE-DECK.md).

## Два режими запуску

### 1. Локальна демонстрація без AI backend

Команда встановлення вище запускає:

- HTML5/JavaScript-інтерфейс;
- відео та scroll-scrubbing;
- дзеркала, TV/laptop surfaces;
- інтерактивну pipeline-презентацію.

Дії, які потребують генерації, чесно показують недоступність server/provider route.

### 2. Повний pipeline із backend

За замовчуванням frontend очікує API engine на:

```text
http://127.0.0.1:4176
```

Інший endpoint можна передати під час запуску:

```bash
WARDROBE_API_UPSTREAM=http://127.0.0.1:4176 ./scripts/run-local.sh
```

Власний порт сайту:

```bash
PORT=4311 WARDROBE_API_UPSTREAM=http://127.0.0.1:4176 ./scripts/run-local.sh
```

AI-провайдери, API-ключі, OAuth-сесії та runtime-користувацькі дані навмисно не входять
до публічного репозиторію. Вони підключаються на backend через дозволені environment,
CLI або MCP credential stores. Frontend спілкується з ними лише через same-origin API
gateway і не отримує секретів.

## Залежності

Обов'язкові:

- Git;
- Python 3.10+;
- сучасний Chrome, Safari, Edge або інший Chromium/WebKit-браузер.

Для розробки та повної перевірки:

- Node.js 22+;
- Bash або Zsh;
- macOS, Linux чи Windows через WSL.

Python package manager і `npm install` для базового запуску не потрібні.

## Запуск після першого встановлення

```bash
cd wardrobe-web2
./scripts/run-local.sh
```

Оновити локальну копію:

```bash
cd wardrobe-web2
git pull --ff-only origin main
./scripts/install-local.sh
```

## Перевірка

Повна локальна non-paid перевірка:

```bash
./scripts/site-preflight.sh
```

Focused-тест інтерактивного ноутбука:

```bash
node --test test/pipeline-deck.test.mjs test/laptop-placeholder.test.mjs test/client-window-wiring.test.mjs
```

Перевірка HTTP Range вручну:

```bash
curl -I -H 'Range: bytes=0-1023' http://127.0.0.1:4173/b/assets/seg1.mp4
```

Очікуваний статус — `206 Partial Content`.

## Основна структура

```text
b/                              cinematic site та laptop deck
b/assets/                       оптимізовані відео й візуальні assets
b/pipeline-deck-v2.html         актуальне пояснення всього pipeline
serve.py                        Range-сервер і same-origin API gateway
scripts/install-local.sh        перевірка та однокомандне встановлення
scripts/run-local.sh            локальний запуск
scripts/site-preflight.sh       повний non-paid test gate
test/                           контрактні й browser-facing тести
docs/                           архітектура, calibration і release contracts
```

## Якщо не запускається

Перевірте версію Python:

```bash
python3 --version
```

Якщо порт `4173` зайнятий:

```bash
PORT=4311 ./scripts/run-local.sh
```

Якщо сторінка відкрилась, але генерація недоступна — cinematic frontend працює,
але API engine на `4176` не запущений або не має авторизованого provider transport.

## Безпека

Не додавайте в Git:

- API-ключі та `.env`;
- OAuth/cookie/browser sessions;
- приватні фотографії користувачів;
- runtime uploads, receipts або generated media;
- локальні credential stores.

Customer-facing gateway не проксуює внутрішній God View. Публічна версія містить код,
документацію та дозволені demo-assets, але не provider credentials чи приватний runtime.
