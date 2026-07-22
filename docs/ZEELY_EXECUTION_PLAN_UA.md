# ZEELY — execution plan після повторного читання ТЗ

## 1. Що саме є тестовим

Джерела:

- [Оригінальне тестове](https://righteous-spoon-d6a.notion.site/Zeely-Test-Task-for-AI-Engineer-Image-Video-Generation-33bcef9155c980189a4def1cd74e1e6c)
- [Фото користувачів](https://drive.google.com/drive/folders/1eTOYLosmDc1AUaBM5eRY1N4dHHqnAnBh)
- [Expected outputs](https://drive.google.com/drive/folders/19j04t4Pq604UJqW48s0ELGrBPxpMix9g)
- [Outfit references](https://drive.google.com/drive/folders/1l-X0-VIiCdPG4IJ0soI156mu5-dDbCH2)

Обов’язковий результат для кожного з мінімум трьох користувачів:

1. З довільного user photo створити впізнаваний photoreal studio avatar.
2. Поза нейтральна і фронтальна, framing — half-body від голови до пояса або верхньої частини стегон.
3. Фон — точний `#FFFFFF`.
4. З approved avatar створити ту саму людину в новому outfit, заданому текстом або image reference.
5. Avatar step і outfit step запускаються автоматично та послідовно.
6. Зберегти `avatar.png` і `avatar_outfit.png` у папці кожного user.
7. Передати reproducible code, prompts, tools/dependencies, folder structure, diagram і README.

Art Director/photo-video демонстрація є optional. HTML5 swipe-сайт не є acceptance criterion цього core test.

## 2. Що було пропущено в першому плані

Головний пропуск — між «користувач завантажив reference» і «model call» має бути повноцінний `Reference Conditioning` process. Поганий, низькороздільний, невдало обрізаний або несумісний reference не можна виправити лише сильнішим prompt.

Також були пропущені або недостатньо жорстко розведені:

- structured extraction спостережуваних фактів, evidence та `UNKNOWN`;
- deterministic normalization і спеціальні derivatives для identity/product;
- readiness router до generation, а не після невдалого output;
- відмінність між strict production і test-compatibility lane;
- правило, що synthetic/generated hypothesis ніколи не стає identity lock або зафіксованою характеристикою речі;
- пріоритет письмової вимоги `#FFFFFF` над пікселями expected-output benchmark;
- несумісність sneaker з half-body framing;
- недостатня resolution hat reference для exact detail;
- explicit semantic QA як blocking gate, окремо від deterministic pixel QA;
- exact prompt, input ordering, hashes, provider receipt і decision evidence для кожного attempt.

## 3. Дві коректні реалізації

### Простий метод, достатній для тесту

```text
provided assets
→ deterministic conditioning script
→ manual review of READY packs
→ GPT Image 2 avatar
→ blocking QA
→ GPT Image 2 outfit edit
→ exact-white normalization
→ blocking QA
→ six required files
```

Це працює для одноразового submission, якщо exact prompts, selected refs, outputs і QA записані локально.

### Production-relevant метод, реалізований тут

```text
immutable job.json
→ deterministic state-machine runner
→ immutable hashes + idempotency + append-only events
→ reference conditioning/readiness gate
→ explicit provider adapter
→ fixed model router
→ technical QA + explicit semantic QA
→ bounded retry or terminal state
→ content-addressed artifacts + exact outputs + run manifest
```

Runtime не залежить від Hermes, OpenClaw або автономних агентів. Агент може допомогти під час development/research, але не приймає production execution decisions.

## 4. Центральний instance

Найменша центральна одиниця — immutable `job.json`. Він декларативно визначає:

- identity reference або готовий identity reference pack;
- outfit mode та text/reference evidence;
- versioned prompt templates;
- quality references і правила їх використання;
- fixed model route і bounded attempts;
- output directory;
- immutable identifiers, hashes та limits.

Сам JSON не має адміністративних прав. Права має process, який його виконує. Provider key/login читається process/provider adapter із environment або зовнішнього credential store і ніколи не записується в job, prompt, event log чи run manifest.

Це дає контрольований ланцюг:

```text
declarative instruction ≠ execution authority ≠ provider implementation
```

Один job можна повторити, порівняти або відхилити без прихованого free-form planning.

## 5. Ролі source evidence

### Identity source

Є authority лише для того, що реально видно: facial geometry, очі, ніс, рот, jaw, hair, facial hair, skin, glasses, tattoo, upper-body cues. Якщо повні пропорції тіла поза кадром, вони не витягуються, не вгадуються і не стають lock.

### Conditioned identity pack

Містить normalized full source, face-detail crop, person-context crop, observed facts, unknowns, risks, readiness і SHA-256 lineage. Саме ordered bindings із цього pack передаються image model.

### Approved avatar

Після QA є authority для pose, crop, camera, scale, lighting і background у наступному outfit edit. Original conditioned identity evidence також повторно передається, щоб зменшити identity drift.

### Outfit source

Є authority лише для видимих характеристик речі: category, construction, material/color, layers, print/logo placement та fit. Після conditioning model отримує не випадковий raw screenshot, а cutout/reference card або точний text specification.

### Expected-output images

Це benchmark для framing, lighting, photoreal finish і detail. Вони не є identity/style source, не визначають outfit і за замовчуванням не передаються model. Вони містять інших людей, тому пряме використання створює identity leakage risk.

## 6. Reference Conditioning

### Загальний порядок

```text
raw immutable asset
→ metadata + SHA-256 + EXIF/orientation + sRGB
→ technical assessment
→ observed-fact extraction + explicit unknowns
→ deterministic derivatives
→ derivative lineage
→ conditioning QA
→ READY / REPAIRABLE / NEEDS_INPUT / INCOMPATIBLE
→ ordered generation-ready bindings
```

### Technical assessment

Перевіряються readable format, dimensions, color space, orientation, clipping, luminance range, edge/detail signal, subject coverage і потрібний upscale factor. Upscale capped: він може зробити формат придатним для model input, але не створює відсутньої fine-detail evidence.

### Human derivatives

- auto-oriented sRGB normalized image;
- explicit face crop;
- explicit person/context crop;
- observed identity facts із provenance `OBSERVED`;
- unknown body fields із provenance `UNKNOWN`;
- readiness окремо для strict production і test lane.

### Похідні матеріали речі

- normalized product image;
- alpha-preserving cutout, якщо source alpha існує;
- explicit bbox crop, якщо pixel segmentation немає, із відповідним warning;
- exact-white reference card;
- observed structure/graphic locks речі;
- compatibility із target framing;
- readiness і generation bindings лише після pass.

Відтворюваний pass: [`tools/condition-dataset.mjs`](../tools/condition-dataset.mjs). Contracts: [`schemas`](../schemas). Готові packs: [`artifacts/conditioning`](../artifacts/conditioning).

## 7. Реальні readiness decisions

### Identity

| Input | Evidence | Strict production | Test compatibility |
|---|---|---|---|
| `input1.webp`, 364×594 | face + partial upper body | `NEEDS_INPUT` | `READY`; full body build `NOT_EVALUABLE` |
| `input2.jpg`, 460×612 | face + shoulders | `NEEDS_INPUT` | `READY`; body build `NOT_EVALUABLE` |
| `input3.webp`, 640×749 | face + shoulders | `NEEDS_INPUT` | `READY`; body build `NOT_EVALUABLE` |
| `input4.jpg`, 2988×5312 | full body visible | `READY` | `READY`; robustness/spare input |

Strict production має запросити додатковий reference для users `001–003`, якщо бізнес-вимога каже «зберегти тілобудову». Тестова lane продовжує обов’язкові три jobs, але не має права записувати body preservation як `PASS`: правильний стан — `NOT_EVALUABLE`.

### Outfit references

| Reference | Decision | Причина |
|---|---|---|
| Green hoodie, 888×1328, source alpha | `READY` | structure, graphic і sufficient technical evidence доступні; створені cutout + white card |
| Black sneaker, 437×437 | `INCOMPATIBLE` | footwear поза required half-body frame; потрібен окремий full-body job |
| Brown hat, 197×256 | `NEEDS_INPUT` | fine band/material detail не можна надійно встановити після required 4× upscale; потрібен кращий source |

Це не оцінка того, чи «модель може щось намалювати». Це оцінка того, чи output можна чесно перевірити проти evidence.

## 8. Core job mapping

| Job | Conditioned identity | Outfit mode | Outfit |
|---|---|---|---|
| `001` | `artifacts/conditioning/humans/001/*` | reference image | conditioned green hoodie cutout + reference card |
| `002` | `artifacts/conditioning/humans/002/*` | text | cobalt-blue single-breasted blazer + opaque white crew-neck top |
| `003` | `artifacts/conditioning/humans/003/*` | text | dark chocolate-brown suede overshirt + opaque black crew-neck T-shirt |

`input4.jpg` залишається robustness/spare input. Sneaker і hat збережені в dataset для демонстрації правильного routing, але не обходять свої terminal conditioning decisions.

Точні assignments: [`dataset.manifest.json`](../inputs/zeely-test/dataset.manifest.json). Machine sequence: [`zeely-test.pipeline.json`](../plans/zeely-test.pipeline.json).

## 9. Written rule має перевагу над benchmark pixels

Corner measurement expected-output images дає приблизно `#F6F6F4`. Текстова вимога каже exact pure white `#FFFFFF`.

```text
WRITTEN_TASK_RULE
> OBSERVED_SOURCE_EVIDENCE
> QUALITY_BENCHMARK_MEASUREMENT
> DEFAULT
```

Тому final target — RGB `(255,255,255)`. Benchmark використовується для композиції та photo finish, але не для exact background color. Conflict і provenance записані в [`quality-target.json`](../artifacts/conditioning/quality-target.json).

## 10. Fixed image model route

| Attempt | Model | Higgsfield selector | Роль |
|---|---|---|---|
| 1 | GPT Image 2 | `gpt_image_2` | primary для avatar і outfit |
| 2 | Nano Banana 2 | `nano_banana_flash` | fallback після blocking fail/retryable provider error |
| 3 | Nano Banana Pro | `nano_banana_2` | final quality fallback |

Після третьої невдачі job завершується `FAILED` або explicit review state; він не підключає четверту модель і не знижує QA thresholds. Runway відсутній. Video route у core вимкнений.

Transport реалізовано як explicit provider boundary. [`higgsfield-cli-provider.js`](../src/providers/higgsfield-cli-provider.js) має allowlist, safe `execFile` without shell, bounded waits, trusted download hosts, PNG validation і provenance metadata. Exact sample outputs створені authenticated official Higgsfield CLI `0.1.33`. MCP або direct API можна додати як transport-equivalent adapter із тим самим contract, але поточний runnable live route — CLI.

Adapter не робить вигляд, що semantic QA уже автоматизовано: без explicit `qaEvaluator` він повертає `NEEDS_INPUT`. `mock` і `replay` adapters існують тільки для deterministic runner tests.

## 11. Exact execution sequence

```text
RECEIVED
→ VALIDATING
→ CONDITIONING_IDENTITY
→ CONDITIONING_OUTFIT
→ CONDITIONING_QA
→ REFERENCES_READY
→ GENERATING_AVATAR
→ AVATAR_QA
→ AVATAR_READY
→ GENERATING_OUTFIT
→ OUTFIT_QA
→ OUTFIT_READY
→ EXPORTING
→ COMPLETED
```

Terminal alternatives: `NEEDS_INPUT` або `FAILED`. Retry transitions bounded; checkpoint, immutable execution hash, receipt та idempotency key не дають непомітно виконати інший job під тим самим run.

Повна flowchart: [`pipeline.mmd`](pipeline.mmd).

## 12. Prompt binding

Runner не просить агента вигадати prompt. Він компілює versioned templates:

- [`avatar.txt`](../prompts/avatar.txt)
- [`outfit-reference.txt`](../prompts/outfit-reference.txt)
- [`outfit-text.txt`](../prompts/outfit-text.txt)
- [`repair.txt`](../prompts/repair.txt)

Compiled artifact має явно називати роль кожного input у правильному порядку. Для outfit step input 1 — approved avatar; conditioned identity evidence повторюється; reference outfit отримує authority лише для характеристик речі. Exact compiled prompt і hash зберігаються біля run evidence.

Prompt не може зробити `UNKNOWN` фактом. Для users `001–003` допустимо зберігати observable upper-body cues, але не заявляти точне збереження невидимих full-body proportions.

## 13. Blocking output QA

1. Background exact `#FFFFFF`, без gradient, shadow, halo, artifacts або edge contamination.
2. Recognizable face, hair, natural skin та всі інші observable identity attributes відповідають source; unobservable body build — `NOT_EVALUABLE`.
3. Neutral frontal pose; half-body head-to-waist/upper-hips; face і hair не обрізані.
4. Soft, even, diffused studio lighting; без harsh shadows, blown highlights або crushed shadows.
5. Neutral white balance; natural skin; white background.
6. Sharp eyes, hair, skin і fabric; без blur або plastic smoothing.
7. Photoreal studio photograph, не render/illustration.
8. Outfit відповідає text/conditioned reference за type, layers, color, material, structure, graphics і fit.
9. Немає extra/fused fingers, duplicated anatomy, face asymmetry або deformed ears.
10. Немає remnants старого outfit, double collars, background leakage або протікання деталей речі.

Deterministic verifier перевіряє technical properties. White normalizer змінює лише near-white background pixels, доступні 4-connected шляхом від border; global threshold заборонений, щоб не знищити eyes, teeth, highlights або графіку на речі.

Identity, outfit fidelity, anatomy, lighting і photorealism потребують explicit semantic evidence. Наявність PNG або результат normalizer сама по собі не означає `PASS`.

## 14. Required artifacts і provenance

```text
output/
  001/
    avatar.png
    avatar_outfit.png
    prompts/
    qa-report.json
    run-manifest.json
  002/
    ...
  003/
    ...
  qa-summary.json
```

Для production run також потрібні:

- immutable job hash і execution hash;
- exact input hashes та ordered roles;
- exact compiled prompt + hash кожного attempt;
- model name, Higgsfield `job_set_type`, provider job ID і generation settings;
- candidate hash, normalized final hash і lineage;
- append-only events/receipts/checkpoint;
- technical QA report та explicit semantic decision/evidence.

## 15. Запуск і verification loop

```bash
npm install
npm run condition
npm run verify
```

Production invocation завжди вказує adapter явно:

```bash
node src/cli.js \
  --job <immutable-job.json> \
  --provider-module <module-that-configures-higgsfield-cli-and-qa.js>
```

Provider module має явно інстанціювати `HiggsfieldCliProvider` із production `qaEvaluator`. Base adapter без evaluator fail-closed повертає `NEEDS_INPUT`; він не може сам собі видати semantic `PASS`.

Default transport flow: `create → atomic provider journal → wait → download`. Journal лежить у `<run-work-directory>/provider-jobs/<idempotency-key>.json` і містить request hash, Higgsfield job ID, події `CREATED / WAIT_STARTED / COMPLETED / OUTPUT_DOWNLOADED` та output hash. Resume читає job ID і не виконує другий `create`. `generationMode: 'oneshot'` — тільки явний legacy-режим. Неминучим лишається вузьке crash-вікно між remote create response та першим локальним atomic write.

Closed loop:

```text
condition
→ conditioning QA
→ generate
→ normalize
→ technical QA
→ semantic QA
→ PASS: export
→ RETRYABLE: next allowlisted attempt
→ NEEDS_INPUT/INCOMPATIBLE: stop and report exact missing evidence
→ route exhausted: fail or explicit review; never silently lower the bar
```

## 16. Optional HTML5/video presentation

Лише після approval core stills можна окремо реалізувати:

1. Шафа з рівно двома дзеркалами; UI, approved avatar/outfit і результат у дзеркалі.
2. Перехід у TV, де та сама approved person бере участь у fashion-editorial shoot.
3. Перехід у laptop із pipeline, exact prompts, credits і фінальним «Дякую».

Swipe/scroll progress може детерміновано керувати `video.currentTime`. Цей extension не входить до core runner/model policy, не замінює required six images і не стартує з unapproved still.
