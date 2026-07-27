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
2. UI показує `$0.04/сек`, hard limit 60 секунд і maximum `$2.40`.
3. Без checkbox cost consent backend повертає
   `PAID_SESSION_APPROVAL_REQUIRED` до будь-якого provider access.
4. Backend приймає лише `decart/lucy-2-5/realtime` і видає короткоживучий
   token через injected `lucyTokenIssuer`.
5. Production client використовує `fal.realtime.connect`, reference image
   approved look і locked prompt. Постійний `FAL_KEY` ніколи не передається
   браузеру.
6. Stop, timeout, page hide або WebRTC disconnect зупиняють camera tracks і
   provider session. Фоновий запис не створюється.

## Стан цього MVP

- JSON graph/schema/compiler: реалізовано.
- Product entry і browser draft: реалізовано на `/post-shoot-mvp.html`.
- Camera preview: локальний, безкоштовний.
- Video: dry-run JSON job, без provider create.
- Lucy token boundary: реалізовано й test-injected; production issuer не
  активований.
- Реальний Lucy/WebRTC create: навмисно не запускався і не тестувався,
  оскільки це платно та потребує окремого дозволу.
