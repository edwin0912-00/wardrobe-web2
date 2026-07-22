# ZEELY — deterministic reference-conditioned image pipeline

Цей workspace реалізує обов’язкову частину тестового: для трьох користувачів послідовно створити впізнаваний photoreal avatar, а потім ту саму людину в новому outfit. Перед будь-яким model call сирі фото проходять окремий `Reference Conditioning` gate.

Він також містить working local web app для fresh inputs: користувач завантажує власне фото, текст образу та/або до п’яти довільних фото речей. Система класифікує гардероб, створює canonical references, запускає той самий immutable runner і повертає downloadable `avatar.png` та `avatar_outfit.png`.

## Запустити working web app

Передумови: Node.js 22+, авторизовані `higgsfield` і `codex` CLI. Startup preflight перевіряє обидва CLI та Higgsfield balance до відкриття сервера.

```bash
npm install
npm run app
```

Відкрити `http://127.0.0.1:4173`. Окремі OpenAI/Gemini API keys не потрібні: generation виконує Higgsfield CLI, а тимчасовий independent semantic judge — авторизований `codex exec` у `--ephemeral`, read-only, strict-schema режимі.

Для публічного demo увімкнути серверний PIN-gate. PIN та secret не зберігаються в репозиторії:

```bash
ZEELY_DEMO_PIN='your-6-to-12-digit-pin' \
ZEELY_SESSION_SECRET="$(openssl rand -hex 32)" \
npm run app
```

PIN-gate захищає HTML і всі `/api/*` routes, крім health check та login. Сесійна cookie має `HttpOnly`, `SameSite=Strict`, `Secure` і живе 30 днів; після п’яти неправильних спроб IP блокується на 15 хвилин. Лише для прямої локальної HTTP-перевірки додати `ZEELY_COOKIE_SECURE=false`; публічний tunnel має працювати з HTTPS і стандартним `Secure` режимом.

Fresh run створює:

```text
runtime/runs/<run-id>/
├── inputs/
├── conditioned/
│   ├── identity/reference-pack.json
│   └── garments/<item>/
├── job.json
├── outputs/
│   ├── avatar.png
│   ├── avatar_outfit.png
│   ├── art_director_scene.png  # optional bonus
│   └── run-manifest.json
└── run.json
```

HTTP surface: `POST /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/events`, `POST /api/runs/:id/retry`, `DELETE /api/runs/:id`.

## Локальний канон ТЗ

- [Source snapshot](spec/ZEELY_TASK_SOURCE_UA.md) — структурно нормалізована копія Notion без наших трактувань.
- [Normative canon](spec/ZEELY_CANON_UA.md) — `CORE`, `WIN`, `QA` та `ART` правила зі стабільними IDs.
- [Acceptance matrix](spec/acceptance.json) — machine-readable mapping `requirement → enforcement → evidence`.

`npm run verify:canon` блокує missing evidence для обов’язкових правил.

Core acceptance — це рівно шість файлів:

```text
output/001/avatar.png
output/001/avatar_outfit.png
output/002/avatar.png
output/002/avatar_outfit.png
output/003/avatar.png
output/003/avatar_outfit.png
```

Відео, Art Director mode і HTML5 swipe-подача не є обов’язковою частиною Notion-тесту. Вони залишені окремим extension після approval усіх still images.

## Центральний runtime-блок

Production unit — не Hermes, OpenClaw і не автономний агент. Це immutable `job.json`, який виконує детермінований state-machine runner:

```text
immutable job.json
→ validate paths, policy and hashes
→ condition references
→ conditioning QA/readiness gate
→ compile versioned prompt
→ fixed image-model route
→ technical QA + explicit semantic QA
→ exact local outputs + receipts + hashes
```

`job.json` описує inputs, prompts, output path, limits і fixed model route. Адміністративні права та provider credentials не зберігаються в JSON: їх отримує лише запущений process/provider adapter через environment або зовнішнє credential store. Це відокремлює декларативну інструкцію від права виконувати зовнішні виклики.

Runner має immutable input hashes, idempotency keys, content-addressed artifacts, append-only events, checkpoints і bounded retries. `--mock` та `--replay` тестують control flow; вони не є production generation.

Повна схема: [docs/pipeline.mmd](docs/pipeline.mmd). Машиночитаний план: [plans/zeely-test.pipeline.json](plans/zeely-test.pipeline.json).

## Те, чого бракувало в першій інтерпретації ТЗ

Raw reference не можна одразу передавати моделі. Він спочатку має стати generation-ready evidence pack:

1. Перевірка файла, metadata, SHA-256, orientation, sRGB, resolution, clipping і detail risk.
2. Структуроване extraction лише спостережуваних фактів; невидиме позначається `UNKNOWN`, а не домислюється.
3. Deterministic derivatives: capped normalization, face/person crops, garment cutout і white reference card.
4. Lineage для кожного derivative: parent hash, operation, output hash.
5. Readiness route: `READY`, `REPAIRABLE`, `NEEDS_INPUT` або `INCOMPATIBLE`.
6. Лише `READY` pack отримує ordered generation bindings.

Реалізація знаходиться в [src/conditioning](src/conditioning), запуск dataset pass — [tools/condition-dataset.mjs](tools/condition-dataset.mjs), результати — [artifacts/conditioning](artifacts/conditioning).

## Реальні рішення по наданих references

| Asset | Strict production | Test lane | Використання |
|---|---|---|---|
| `input1.webp` | `NEEDS_INPUT` — full body proportions не видимі | `READY`, body build `NOT_EVALUABLE` | core user `001` |
| `input2.jpg` | `NEEDS_INPUT` — видно face/shoulders | `READY`, body build `NOT_EVALUABLE` | core user `002` |
| `input3.webp` | `NEEDS_INPUT` — видно face/shoulders | `READY`, body build `NOT_EVALUABLE` | core user `003` |
| `input4.jpg` | `READY` | `READY` | robustness/spare; не потрібен для minimum submission |
| Green hoodie | `READY` | `READY` | reference outfit для `001` |
| Black sneaker | `INCOMPATIBLE` | `INCOMPATIBLE` | footwear не видно в required half-body crop |
| Brown hat, 197×256 | `NEEDS_INPUT` | `NEEDS_INPUT` | resolution недостатня для exact fine-detail fidelity |

Strict production і test compatibility не можна змішувати. У production, якщо необхідне збереження тілобудови, users `001–003` мають зупинитися з `NEEDS_INPUT`. Для виконання саме наданого тесту вони проходять compatibility lane, але QA записує body build як `NOT_EVALUABLE` і результат не має права стверджувати, що невидимі пропорції збережено.

## Core jobs

| Job | Identity | Outfit |
|---|---|---|
| [`001`](jobs/001.json) | conditioned `input1.webp` | conditioned green hoodie reference with exact visible graphic locks |
| [`002`](jobs/002.json) | conditioned `input2.jpg` | text: cobalt-blue blazer + plain white crew-neck top |
| [`003`](jobs/003.json) | conditioned `input3.webp` | text: dark chocolate-brown suede overshirt + plain black T-shirt |

Hat і sneaker не призначені core jobs. Повний inventory, hashes, readiness і assignments збережено в [dataset.manifest.json](inputs/zeely-test/dataset.manifest.json).

## Правило benchmark vs written requirement

`quality-references/output1.png` — `output3.png` є benchmark лише для framing, lighting, finish і detail. Вони:

- не є identity references;
- не визначають body або outfit;
- не передаються generation model за замовчуванням;
- не мають права змінити точний background requirement.

Виміряний фон benchmark приблизно `#F6F6F4`, але письмове ТЗ вимагає точний `#FFFFFF`. Пріоритет однозначний: `WRITTEN_TASK_RULE > SOURCE_EVIDENCE > BENCHMARK_MEASUREMENT > DEFAULT`. Machine-readable resolution збережено в [quality-target.json](artifacts/conditioning/quality-target.json).

## Зафіксований image model route

| Attempt | Model | Higgsfield `job_set_type` | Role |
|---|---|---|---|
| 1 | GPT Image 2 | `gpt_image_2` | primary |
| 2 | Nano Banana 2 | `nano_banana_flash` | fallback |
| 3 | Nano Banana Pro | `nano_banana_2` | quality fallback |

Моделі поза allowlist відхиляються до provider call. Runway не використовується. Video model routing у core policy вимкнено.

[Higgsfield CLI adapter](src/providers/higgsfield-cli-provider.js) виконує exact argv без shell, перевіряє allowlist/options/references, чекає bounded time, валідовує response і завантажує тільки allowlisted HTTPS PNG. Exact sample outputs створені через authenticated official Higgsfield CLI `0.1.33`. MCP або direct API можуть бути transport-equivalent adapters до того самого runner contract, але поточний runnable live adapter — CLI. Adapter навмисно не підміняє semantic QA: без переданого production QA evaluator він повертає `NEEDS_INPUT`, а не автоматичний `PASS`.

## QA

Approval потребує двох незалежних рівнів:

- deterministic technical QA: PNG, dimensions/color space, exact border-connected `#FFFFFF`, відсутність off-white/gradient background у класифікованій background region;
- explicit semantic QA: identity, observable hair/skin/body evidence, pose/crop, lighting, white balance, detail, photorealism, outfit fidelity, anatomy, old-clothing residue та edge bleed.

White normalizer змінює лише near-white pixels, які 4-connected шляхом доходять до border. Він не робить global threshold і не є заміною visual/semantic review.

Поточний submission index: [output/submission-manifest.json](output/submission-manifest.json). Machine reports: [output/qa-summary.json](output/qa-summary.json) і `output/001..003/qa-report.json`. Explicit semantic evidence: [reviews/visual-review.json](reviews/visual-review.json). Візуальне порівняння source → avatar → outfit: [output/contact-sheet.png](output/contact-sheet.png).

## Відтворити перевірки

```bash
npm install
npm run condition
npm run verify
```

Для окремої output-only перевірки:

```bash
npm run verify:output
```

Окремий integration gate запускає саме три checked-in immutable jobs із реальними packs у тимчасових output-директоріях, але з explicit mock transport — він перевіряє orchestration, а не якість моделі:

```bash
npm run test:integration
```

Live runner викликається лише з explicit adapter:

```bash
node src/cli.js \
  --job jobs/001.json \
  --provider-module <module-that-configures-higgsfield-cli-and-qa.js>
```

Configured module має створити `HiggsfieldCliProvider` і передати production `qaEvaluator`. Якщо завантажити base adapter без evaluator, він навмисно завершить conditioning gate як `NEEDS_INPUT`. Не запускайте `--mock` на submission output directories.

Live adapter за замовчуванням працює двофазно: `create → atomic journal → wait → download`. Provider job journal зберігається у `<run-work-directory>/provider-jobs/<idempotency-key>.json`; після restart той самий remote job продовжується через `wait` без повторного `create`. Legacy one-shot дозволений лише явною опцією `generationMode: 'oneshot'`. Залишається лише невелике неминуче вікно між отриманням remote create response і першим atomic write.

## Структура evidence і implementation

- [docs/ZEELY_EXECUTION_PLAN_UA.md](docs/ZEELY_EXECUTION_PLAN_UA.md) — точний execution plan і трактування ТЗ.
- [plans/zeely-test.pipeline.json](plans/zeely-test.pipeline.json) — machine-readable sequence, jobs, routes і acceptance.
- [schemas](schemas) — strict contracts для source assets, extraction, conditioning, lineage, ready packs, provider attempts і QA; [pipeline-job.schema.json](schemas/pipeline-job.schema.json) окремо валідовує central runner instance.
- [prompts](prompts) — versioned avatar/outfit/repair templates; exact compiled prompts зберігаються біля кожного output.
- [src/runner](src/runner) — deterministic state machine, hashes, idempotency, events, checkpoints та export.
- [src/providers](src/providers) — live Higgsfield CLI, mock і replay adapters.
- [src/qa](src/qa) — exact-white normalization та technical output checks.
- [docs/ZEELY_MARKET_TECH_REPORT_UA.md](docs/ZEELY_MARKET_TECH_REPORT_UA.md) — market research; це не runtime allowlist.

## Optional presentation extension

Після image approval можна окремо зробити: шафа з двома дзеркалами → TV з тією самою людиною на fashion shoot → laptop із pipeline/credits/«Дякую», де swipe/scroll детерміновано керує `video.currentTime`. Цей extension не змінює acceptance core test і не має права генерувати відео з неапрувленого still.
