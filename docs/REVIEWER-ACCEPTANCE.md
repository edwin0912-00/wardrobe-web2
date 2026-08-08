# Reviewer acceptance — від README до фактичної поведінки

Цей документ закриває три дефекти першої здачі: локальний bridge повертав 404,
цей збій був непомітним, а зелена suite могла спиратися на перевірку тексту в
коді замість поведінки продукту. Джерелом правди тут є observable result у
Chromium і реальному HTTP gateway. Regex/source-тести залишаються лише
регресійними guardrails.

## Один підтримуваний локальний шлях

```bash
git clone --filter=blob:none --depth 8 --single-branch --branch alpha \
  https://github.com/edwin0912-00/wardrobe-web2.git \
  && cd wardrobe-web2 \
  && ./scripts/install-local.sh --run
```

Інсталятор матеріалізує pinned media bundle, перевіряє його SHA-256, ставить
locked dependencies, запускає acceptance і лише після цього відкриває два
процеси. Канонічна local URL — `http://127.0.0.1:4173/`; engineering beta —
`http://127.0.0.1:4176/`.

## Acceptance matrix

| Критичний ризик | Виконуваний доказ | Observable result |
| --- | --- | --- |
| Неправильний шлях bridge | Python gateway віддає `/adapters/zeely-client.mjs` і `/adapters/cinematic-ui-bridge.mjs`; Chromium імпортує той самий module graph | HTTP `200`, JS content type, `window.WardrobeCinematicBridge.state().availability === "ready"`, backend `releaseSha` |
| Bridge module повернув 404 | Browser E2E примусово повертає `404` лише для `cinematic-ui-bridge.mjs` | Видимий `[role="alert"]`, `data-bridge="unavailable"`, `simulated === false`, нуль `POST /api/runs`, safe telemetry code `module-load` |
| UI виглядає активним без backend | Main читає фактичний profile/job state з same-origin `/api/*` | Generation controls не можуть створити run до `availability=ready`; fake timer/result відсутні |
| Тести перевіряють лише рядки | `scripts/browser-core-e2e.mjs` запускає Chromium, Fastify engine і Python gateway | Два core runs, чотири output downloads, structured input error, два saved looks, reload recovery |
| Немає error/back/account/history | Той самий browser journey проводить backend error через page-owned bridge у реальний DOM і натискає recovery/back controls | Видимий authored error, `REPLACE_INPUT`, повернення до активного look, анонімний profile cookie, історія після reload |

## Команди й межі доказу

```bash
./scripts/install-local.sh
node scripts/browser-core-e2e.mjs
npm run self-check
```

`browser-core-e2e` є поведінковим authority для local UI ↔ bridge ↔ backend.
`self-check` оркеструє blocking checks і пише машинний JSON-звіт. Статичні
тести hash/markup/API shape ловлять небажану зміну контракту, але самі по собі
не є доказом працездатності.

Deterministic fixture доводить маршрути, state transitions, recovery і
доставку файлів без витрати credits. Він не видається за доказ фотореалізму.
Якість платної генерації оцінюється окремими QA receipts і прикладами
`output/001..003`.

## Core-first порядок

1. Один відтворюваний core pipeline: фото → avatar → outfit transfer → QA →
   structured output.
2. Помилка й recovery: retry, replace input, повернення до активного look.
3. Анонімний browser profile та історія після reload.
4. Лише після blocking core acceptance — backgrounds, Fashion Shoot, Fashion
   Video, Real-time Look і cinematic presentation.

Будь-яка майбутня зміна README, bridge path або startup topology приймається
лише тоді, коли цей browser gate проходить без `weakened_checks`.
