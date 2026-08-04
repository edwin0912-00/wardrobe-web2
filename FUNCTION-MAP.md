# WARDROBE — актуальна FUNCTION MAP

Цей файл описує не бажаний backlog, а фактичний контракт unified `main`.
Код UI живе в cinematic main, а довготривалий стан і генерації — у beta engine.

## 1. Центральний об’єкт

```text
input
  → conditioning
  → avatar
  → outfit transfer
  → QA
  → approved saved look
```

`approved saved look` — єдина точка розгалуження. Наступні продукти незалежні:

```text
approved saved look
├── standard background
├── Fashion Shoot / Create Universe
├── Fashion Video
└── Real-time Look
```

Standard background не є Fashion Shoot preset. Fashion Video не потребує
готового фону або фотосесії.

## 2. Функції, поверхні й реальні гейти

| Функція | Поверхня main | Backend authority | Гейт | Поточний стан |
|---|---|---|---|---|
| Фото людини | ліве дзеркало | draft/profile | валідне фото | працює |
| Речі: фото або готовий опис | ліве дзеркало | draft/run | людина + хоча б одна річ/назва | працює |
| Генерація master-look | праве дзеркало | run + QA receipt | provider доступний | працює |
| Structured error/retry | праве дзеркало | terminal backend state | named failure/next action | працює |
| Бібліотека `Образи` | дзеркало | browser profile | profile cookie | працює |
| Стандартні фони | дзеркало → TV | scene service | approved look | працює |
| Fashion Shoot | дзеркало → TV | editorial service | approved look + style pack | progressive frames працюють |
| Fashion Video | дзеркало → TV | video service | approved look + verified video style | transport/QA/retry працюють |
| Real-time Look | right-mirror camera plane | server capability | approved look + explicit camera action | capability-bound |
| Галерея готового | TV | saved deliveries | хоча б один delivered asset | працює |
| Pipeline deck | calibrated laptop | SHA-bound HTML | terminal camera station | працює |

## 3. Базові product-flow сценарії

### Помилка генерації

Має власну поверхню на правому дзеркалі. Вона показує authored copy, safe
structured code і конкретну recovery-дію. Відмова input повертає до input;
terminal generation failure відкриває retry; відсутній delivered asset ніколи
не будить TV.

### Повернення назад

- `Образи` відкриває бібліотеку з будь-якої активної product action;
- `До образу` повертає з результату або terminal error;
- reverse scroll повертає з TV/laptop у попередню кімнату;
- активний saved look не очищається під час переходу.

### Акаунт

Тестова версія не вимагає registration flow. Вона створює анонімний browser
profile з fixed expiry. Дані ізольовані за profile cookie; main не проксуює
внутрішній God View і не дозволяє читати чужі профілі.

### Історія

Після reload із profile API відновлюються saved looks, backgrounds,
Fashion Shoot frames і verified Fashion Videos. Частковий Shoot також
відновлюється та перепід’єднує event stream. Lightweight preview і original
download — різні маршрути.

## 4. Прогрес і recovery

Main читає реальні backend states через `cinematic-ui-bridge.mjs`:

```text
idle
→ uploading
→ running
→ waiting_for_approval | needs_input | recovering
→ completed | failed
```

SSE є основним transport. Після втрати SSE client робить bounded durable
reconciliation точного job; mobile watchdog відновлює terminal state, якщо
відкрите SSE-з’єднання пропустило останню подію. Це не декоративний progress.

## 5. Фізичні поверхні cinematic site

| Кімната | Поверхня | Вміст |
|---|---|---|
| Intro | textile plane | loading/progress першого входу |
| Mirror room | left mirror | person, items, saved-look library, choices |
| Mirror room | right mirror | orb, error, result, next actions, Live |
| TV room | calibrated TV | looks, backgrounds, progressive shoots, final video |
| Laptop room | calibrated laptop | interactive pipeline document |

Тільки mirror station є blocking attention point. TV — галерея, а не
обов’язковий крок генерації. Laptop scroll handoff активується після camera
settle й повертається назад тим самим gesture contract.

## 6. Поведінкові докази

`./scripts/install-local.sh` запускає:

- main behavior suite;
- real Python gateway із реальним upstream HTTP server;
- реальний beta Fastify process;
- HTTP checks main UI, beta UI, API bridge, catalogues і module graph;
- contracts/canon/provider/video/profile tests;
- MP4 Range check із фактичним `206`.

Критичний acceptance — це результат HTTP і state transition, а не наявність
назви функції в JavaScript.
