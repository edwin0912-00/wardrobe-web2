# ZEELY — persistence та live monitoring

## Наскрізна схема

```mermaid
flowchart LR
  A["Телефон / desktop browser"] --> B["HTML5 UI\nокремі file slots"]
  B --> C["IndexedDB\nлокальна draft Blob-копія"]
  B --> T["Anonymous temp draft\nHttpOnly browser ID · TTL 15 min"]
  B -->|"POST telemetry: metadata only"| D["Core Fastify :4173"]
  B -->|"один multipart на файл → temp draft"| D
  B -->|"JSON start з browser draft ID"| D
  D --> E["runtime/runs/<run-id>\nraw input + run.json"]
  D --> F["deterministic pipeline\nconditioning → models → QA"]
  D --> G["append-only events.jsonl"]
  F --> G
  H["Monitor Fastify :4174"] --> G
  S["Agent Supervisor\ncommentary · stalls · incidents"] --> G
  S --> H
  H -->|"health every 10 s"| D
  G -->|"SSE every 1 s"| I["monitor.madeforthisjob.com"]
  J["Cloudflare named Tunnel"] --> D
  J --> H
  K["macOS launchd KeepAlive"] --> D
  K --> H
  K --> J
```

## Що робить кожен ресурс

| Ресурс | Відповідальність | Що зберігає | Як видно failure |
|---|---|---|---|
| Browser file slots | Person, identity detail і garments не перезаписують один одного. Garment picker додає до попереднього selection. | `File` objects під час відкритої вкладки. | Preview і кількість файлів оновлюються після кожної дії. |
| Browser IndexedDB + upload preparation | Копіює оригінальні файли як Blob, text outfit і scene toggle після кожної зміни. Перед upload файли понад 18 MB або phone formats локально приводяться до JPEG ≤4096 px/≤18 MB. | Тільки на конкретному пристрої й origin `madeforthisjob.com`; consent не зберігається. | UI показує підготовку, потім фактичні uploaded MB/% через XHR. Кожен файл має окрему 10-minute аварійну межу. |
| Anonymous temp draft (`runtime/drafts`) | Після selection послідовно й один раз зберігає підготовлену server-side копію під випадковим browser ID з HttpOnly cookie. Submit чекає завершення цих upload, дозавантажує тільки відсутнє та створює run коротким JSON-запитом — без повторного multipart усіх фото. Якщо IndexedDB не відновилася, UI завантажує цю копію після reload. | Person, identity, до 5 garments і text/toggle; без consent та original filenames. Sliding TTL 15 хвилин. | Cleanup запускається щохвилини й фізично видаляє directory після TTL. Explicit new run також одразу очищує temp draft. |
| `boot-guard.js` | Підключається до module app і ловить ранній `error`, `unhandledrejection`, boot timeout. | Нічого, крім telemetry metadata. | Замість білого екрана показує видимий reload-card; draft при цьому не очищується. |
| Core Fastify `:4173` | Optional server PIN gate, static UI, multipart intake, run API, run SSE, client telemetry endpoint. | Run inputs/state у `runtime/runs`; telemetry — у спільний event log. | Кожен API response, server exception і факт повного отримання upload пишеться в журнал. |
| `RunService` / runner | Запускає checkpointed pipeline і публікує лише фактичні phase changes. | `run.json`, artifacts, receipts, QA evidence. | UI показує `UPLOAD`, доки сервер не створив run; потім реальні `1/8…8/8`, без таймера або synthetic percent. |
| Event store | Append-only операційна історія, доступна одночасно core та monitor process. | `runtime/monitor/events.jsonl`, permissions `0600`. | Пошкоджений одиничний рядок ігнорується під час tail; нові записи не перезаписують старі. |
| Monitor Fastify `:4174` | Читає tail, транслює SSE, перевіряє `:4173/api/health` кожні 10 секунд. | Тільки оперативний status у RAM; event history лишається у JSONL. | Dashboard окремо показує monitor health та core health; SSE сам reconnect-иться. |
| Agent Supervisor | Щосекунди читає persisted run events, пояснює кожну server phase у monitor, знаходить stalls, створює дедуплікований incident fingerprint і за нового failure запускає окремий Codex bug-hunt. | `runtime/supervisor/state.json`, sanitized incident JSON і agent result; ніколи не передає runtime images, drafts або secrets. | Один agent одночасно, максимум 3 спроби на fingerprint, 8 хв для garment stall і 25 хв для generation stall. Agent може залишити patch у чистому source workspace, але не commit/push/deploy/restart. |
| macOS LaunchAgents | Тримають core, monitor і tunnel трьома незалежними процесами. | launchd state/logs. | `KeepAlive` перезапускає process; stderr залишається у `runtime/logs`. |
| Cloudflare Tunnel | Публікує studio та monitor без inbound port/router configuration. | Project-scoped tunnel credential поза Git. | Cloudflare endpoint повертає 502/503, а monitor watchdog фіксує core down, якщо origin недоступний. |

## Реальний порядок подій одного запуску

1. `client.file_selected` — браузер прийняв selection; передається лише count/bytes.
2. `client.draft_saved` — IndexedDB commit завершився.
3. `http.response POST /api/draft/file/:slot 201` — окремий підготовлений файл повністю збережено в temp draft.
4. `client.submit` — користувач натиснув запуск; UI чекає чергу temp uploads і перевіряє комплектність.
5. `http.response POST /api/draft/run 202` і `client.submit_response` — сервер читає вже збережені файли, атомарно створює run і повертає `run_id`; повторного upload немає.
6. `run.phase` — persisted server phases; браузер отримує їх через run SSE.
7. `client.run_event` — підтверджує, що UI реально побачив phase.
8. `COMPLETED`, `NEEDS_INPUT` або `FAILED` — terminal truth із повідомленням, outputs/evidence або точним failure reason.

## Privacy boundary

Allowlist client telemetry приймає тип події, timestamp, випадковий session ID, run ID, status/stage, duration, кількість і сумарний byte size. Вона відкидає назви файлів, contents, image previews, outfit text, PIN, cookies та довільні поля. На час відкритого тестування dashboard доступний без PIN; серверний PIN gate збережений у коді й може бути повернений через runtime configuration.

## Публічні точки перевірки

- Studio: `https://www.madeforthisjob.com`
- Monitor: `https://monitor.madeforthisjob.com`
- Studio health: `https://www.madeforthisjob.com/api/health`
- Monitor health: `https://monitor.madeforthisjob.com/api/health`

Наразі UI та operational API відкриті без PIN. Health endpoints також public для uptime probing і не повертають secrets.
