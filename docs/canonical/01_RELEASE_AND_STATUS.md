# 01 — релізна лінія і перевірений статус

## Branch topology

```text
alpha  ── єдина поточна integration/version/deploy line
  ├── beta       frozen mirror для engineering surface
  └── canonical  frozen mirror для останнього інтегрованого source snapshot

main + alpha-0.01  historical checkpoints; не переписуються
```

`beta` і `canonical` не отримують незалежних функціональних комітів. Якщо
потрібне оновлення, воно спочатку входить в `alpha`, проходить release-owner
перевірку, а потім mirrors оновлюються одним fast-forward/merge кроком. Це
прибирає ситуацію «на сайті одна версія, у Git інша».

## Source versus deployed artifact

| Рівень | Значення останнього перевіреного зрізу |
|---|---|
| Branch snapshot до цього docs-коміту | `2170415eaf9a` |
| Live product release SHA | `b189afe7ddb4e9bdf8d1e541a69f0cf0ed4de491` |
| Live release directory | `release-b189afe-1786229063574` |
| Live cache token | `product-b189afe7-ddfef560140a` |
| Live state | `ready`; активних work/run IDs під час deploy не було |

Branch head може випереджати product artifact, коли зміна стосується тільки
тестів або документації. Це дозволено лише якщо release report явно пояснює
розбіжність. Для product code source SHA і health `release_sha` мають збігатися.

## Public verification

На останній перевірці всі три surface відповідали:

```text
GET /api/health                 200, status=ready
GET /api/scene-presets          200
GET /api/editorial-modes        200
GET /api/post-shoot/pipeline    200
```

Повторна перевірка після змін:

```bash
for host in \
  https://beta.madeforthisjob.com \
  https://madeforthisjob.com \
  https://site.madeforthisjob.com; do
  curl -fsS "$host/api/health" | jq '{status,runtime,release_sha,cache_token,generation,semantic_qa,editorial_generation}'
done
```

У звіті зберігати час, HTTP status, `release_sha`, `cache_token` і commit, з
яким вони порівнювалися. Не писати «задеплоєно» без цієї звʼязки.

## Перевірений кодовий стан

* `node tools/validate-contracts.mjs` — PASS: 41 schemas, 9 fixtures, 3 jobs.
* `node tools/validate-canon.mjs` — PASS: 43 rules, 34 blocking, 0 failures.
* Provider/generation/preflight/model focused tests — `12/12 PASS` на останній
  контрольній перевірці.
* Video route focused tests — `23/23 PASS`.
* Product release verifier — PASS для artifact `b189afe…`.
* Повний `npm test` не вважається зеленим: історично він упирався у resource
  preflight, deployment fixtures і scene/editorial drift. Це окремий борг, не
  можна приховувати його під focused PASS.

## Provider health policy

Поточний запуск daemon:

```text
image/scene: Codex Worker primary → guarded OpenRouter image fallback
VLM:        OpenRouter
video:      explicit OpenRouter video adapter
realtime:   FAL token route (Lucy), без image/video fallback ролі
Higgsfield: prohibited and not constructed in active web graph
```

Наявність historical Higgsfield files або receipts у Git не означає, що вони
активні. Активний runtime не має права їх імпортувати/створювати.
