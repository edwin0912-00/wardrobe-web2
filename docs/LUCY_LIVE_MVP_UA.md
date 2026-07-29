# Lucy 2.5 Live Camera — MVP contract

## Місце в продукті

Єдина точка входу — approved `ART_SHOOT.05`. Користувач бачить дві наступні
дії: `Зробити відео` або `Live webcam`. Обидва режими зберігають identity,
outfit і style unit source shoot.

Конфігурація є виконуваним JSON graph:
`config/post-shoot-pipeline.json`, валідований
`schemas/post-shoot-pipeline.schema.json`. Невідомий node, незамкнений
transition або Lucy mode без ціни/timeout блокує запуск сервера.

## Безпечний Lucy flow

1. Browser запускає локальний camera preview через `getUserMedia`.
2. UI показує `$0.04/сек`, hard limit 15 секунд і maximum `$0.60`.
3. Без checkbox cost consent backend повертає
   `PAID_SESSION_APPROVAL_REQUIRED` до будь-якого provider access.
4. Перед start користувач завантажує JPEG/PNG/WebP reference мінімум
   512×512; файл залишається локальним до явного Lucy start.
5. Backend приймає лише `decart/lucy-2-5/realtime` і видає короткоживучий
   token через injected `lucyTokenIssuer`.
6. Production client використовує `fal.realtime.connect`, reference image
   approved look і locked prompt. Постійний `FAL_KEY` ніколи не передається
   браузеру.
7. Stop, timeout, page hide або WebRTC disconnect зупиняють camera tracks і
   provider session. Фоновий запис не створюється.

## Стан цього MVP

- JSON graph/schema/compiler: реалізовано.
- Product entry і browser draft: реалізовано на `/post-shoot-mvp.html`.
- Camera preview: локальний, безкоштовний.
- Video: dry-run JSON job, без provider create.
- Lucy token boundary: реалізовано, протестовано й активовано server-side;
  довгоживучий `FAL_KEY` не потрапляє у browser.
- Реальний Lucy/WebRTC flow перевірено вручну 2026-07-29 на
  `https://live.madeforthisjob.com/live`: camera stream підключається, Lucy
  повертає transformed live stream, а hard stop завершує сесію через 15 секунд.

## Заморожений working block

Це канонічна реалізація MVP. До інтеграції в фінальний UI не змінювати її
signaling, token flow або session guards окремими «спрощеннями». Переносити
блоком такі частини:

- `config/post-shoot-pipeline.json` і schema/compiler;
- `src/web/post-shoot-routes.js`;
- `src/web/fal-realtime-token.js`;
- `web/public/post-shoot-mvp.js`;
- bundled `web/public/vendor/fal-client.js`;
- тести `test/web/fal-realtime-token.test.js` і
  `test/web/post-shoot-routes.test.js`.

Критичний auth-контракт:

1. Browser підключається до повного endpoint
   `decart/lucy-2-5/realtime`.
2. Backend allowlist перевіряє саме цей повний endpoint.
3. Запит `POST https://rest.fal.ai/tokens/` мусить містити
   `allowed_apps: ["lucy-2-5"]`. fal тимчасові JWT scope-ить до alias моделі,
   а не до повного owner/path.
4. Якщо покласти в `allowed_apps` значення
   `decart/lucy-2-5/realtime`, token endpoint поверне `200`, але Lucy закриє
   WebSocket помилкою `Forbidden`.

Перевірені попередні відмови:

- `undefined is not an object (evaluating 'fal.realtime')` — неправильне
  підключення browser client;
- камера вмикається, але transformed stream не з'являється — signaling не
  обробляв усі Lucy message variants;
- `Error closing the connection: Forbidden` — неправильний
  `allowed_apps` у short-lived JWT.

Ці інваріанти захищаються regression tests. Будь-яка майбутня інтеграція
повинна змінювати лише product input (обраний look/reference), placement і
presentation UI, не auth/WebRTC ядро.
