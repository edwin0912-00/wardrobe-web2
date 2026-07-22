# ZEELY — нормативний канон

Версія: `1.0.0`  
Upstream snapshot: `ZEELY_TASK_SOURCE_UA.md`  
Стан: обов’язковий локальний source of truth для implementation і review.

## 1. Пріоритет і значення правил

```text
NOTION_EXPLICIT > EXPLICIT_USER_DECISION > DERIVED_PRODUCTION_RULE > OPTIONAL_IDEA
```

- `MUST` — блокуюча вимога.
- `SHOULD` — виграшне або production-relevant покращення; відступ потребує пояснення.
- `MAY` — optional Art Director/демо-функція.
- Core вважається пройденим лише тоді, коли всі blocking `CORE-*` і `QA-*` мають evidence.
- Bonus не має права приховати або компенсувати core failure.
- Expected-output images є benchmark композиції та якості, але не identity evidence.
- Якщо письмова вимога суперечить виміряному benchmark, письмова вимога має пріоритет.

## 2. Вимоги для основи

### Input і користувацький контракт

- `CORE-IN-001 MUST`: engine приймає нове фото користувача без ручного редагування job JSON.
- `CORE-IN-002 MUST`: primary user photo може мати довільний фон і позу.
- `CORE-IN-003 MUST`: Outfit Transfer приймає текст, garment-reference або їх комбінацію.
- `CORE-IN-004 MUST`: додаткове identity-фото може покращувати evidence pack, але не є вимогою оригінального ТЗ.
- `CORE-IN-005 MUST`: invalid/corrupt/unsupported input завершується структурованим `NEEDS_INPUT`, а не model call.

### Avatar Generation

- `CORE-AVATAR-001 MUST`: вихід — впізнаваний photoreal avatar тієї самої людини.
- `CORE-AVATAR-002 MUST`: кадр фронтальний, нейтральний, півростовий від голови до пояса або стегон.
- `CORE-AVATAR-003 MUST`: обличчя повністю в кадрі без обрізання.
- `CORE-AVATAR-004 MUST`: background — exact `#FFFFFF` у класифікованій області фону.
- `CORE-AVATAR-005 MUST`: identity locks охоплюють видимі риси обличчя, волосся, тон шкіри та видиму статуру.
- `CORE-AVATAR-006 MUST`: невидимі у source властивості отримують `NOT_EVALUABLE`, а не фальшивий `PASS`.

### Outfit Transfer

- `CORE-OUTFIT-001 MUST`: outfit generation стартує лише з avatar-кандидата, що пройшов QA.
- `CORE-OUTFIT-002 MUST`: output містить ту саму людину; одяг є цільовою зміною.
- `CORE-OUTFIT-003 MUST`: text outfit відповідає типу, кольору, матеріалу й посадці з опису.
- `CORE-OUTFIT-004 MUST`: reference outfit відповідає всім спостережуваним критичним деталям source.
- `CORE-OUTFIT-005 MUST`: фінальний core outfit також має exact-white background.
- `CORE-OUTFIT-006 MUST`: старий одяг, фон і anatomy artifacts не протікають у результат.

### Automation і outputs

- `CORE-AUTO-001 MUST`: avatar і outfit виконуються послідовно одним runner.
- `CORE-AUTO-002 MUST`: одна команда запускає working flow.
- `CORE-AUTO-003 MUST`: кожен run має ізольовану структуровану директорію.
- `CORE-AUTO-004 MUST`: мінімальна здача містить `avatar.png` і `avatar_outfit.png` для трьох користувачів.
- `CORE-AUTO-005 MUST`: outputs супроводжуються compiled prompts, QA report і generation manifest.
- `CORE-AUTO-006 MUST`: README документує залежності, запуск, tools та input/output folders.
- `CORE-AUTO-007 MUST`: pipeline diagram і prompt-formation logic входять у submission.

## 3. QA — десять блокуючих критеріїв

- `QA-001`: exact `#FFFFFF`; без edge shadows, artifacts і gradients.
- `QA-002`: observable identity preservation.
- `QA-003`: neutral frontal half-body framing; full face visible.
- `QA-004`: soft, even, diffuse studio lighting.
- `QA-005`: neutral white balance and natural skin tone.
- `QA-006`: sharp eyes/hair/skin/fabric; no blur or plastic skin.
- `QA-007`: photographic realism.
- `QA-008`: garment type/color/texture/fit fidelity.
- `QA-009`: no anatomical defects.
- `QA-010`: no old-clothing residue or background bleed.

Technical QA і semantic QA є різними gates. Технічний PASS не створює semantic PASS. Новий output не може повторно використати semantic review, прив’язаний до іншого hash.

## 4. Вимоги для виграшного тестового

### Reference Conditioning

- `WIN-COND-001 SHOULD`: raw image спочатку стає generation-ready evidence pack.
- `WIN-COND-002 SHOULD`: extraction розрізняє `OBSERVED`, `UNKNOWN` і `NOT_EVALUABLE`.
- `WIN-COND-003 SHOULD`: readiness route використовує `READY`, `REPAIRABLE`, `NEEDS_INPUT`, `INCOMPATIBLE`.
- `WIN-COND-004 SHOULD`: кожен derivative має parent hash, operation і output hash.
- `WIN-COND-005 SHOULD`: model-generated hypothesis ніколи не стає identity або garment lock.

### Arbitrary garment intake

- `WIN-GARMENT-001 SHOULD`: engine приймає до п’яти довільних garment-фото.
- `WIN-GARMENT-002 SHOULD`: кожен asset класифікується як `outerwear`, `top`, `bottom`, `one_piece`, `footwear`, `headwear`, `bag` або `accessory`.
- `WIN-GARMENT-003 SHOULD`: картка речі містить видимі тип, колір, матеріал, візерунок, текст/логотип, конструктивні деталі та впевненість.
- `WIN-GARMENT-004 SHOULD`: canonicalization видаляє person, hanger і environment, але не змінює спостережувані характеристики речі.
- `WIN-GARMENT-005 SHOULD`: canonical white card і transparent cutout зберігаються окремо.
- `WIN-GARMENT-006 SHOULD`: raw-versus-canonical fidelity QA блокує altered logo/text/color/shape/material.
- `WIN-GARMENT-007 SHOULD`: неповністю видиму або надто низькоякісну річ не можна видавати за exact reference.
- `WIN-GARMENT-008 SHOULD`: approved garments передаються як окремі ordered refs із category binding.
- `WIN-GARMENT-009 SHOULD`: `one_piece` конфліктує з `top + bottom`; кілька речей одного slot потребують explicit selection.

### Reliability і evidence

- `WIN-REL-001 SHOULD`: model route фіксований: GPT Image 2 → Nano Banana 2 → Nano Banana Pro.
- `WIN-REL-002 SHOULD`: retries bounded і defect-specific.
- `WIN-REL-003 SHOULD`: job/input/output hashes, provider IDs, exact parameters і prompts зберігаються.
- `WIN-REL-004 SHOULD`: restart продовжує recorded remote job замість повторного create.
- `WIN-REL-005 SHOULD`: web UI показує progress, blocking reason, QA і downloads.
- `WIN-REL-006 SHOULD`: evaluator може запустити fresh input через ту саму surface, що й fixtures.
- `WIN-REL-007 SHOULD`: automatic semantic judge має strict schema, timeout і fail-closed behavior.

## 5. Art Director Mode та ідеї Еда

- `ART-001 MAY`: approved white outfit still стає source для memorable editorial scene.
- `ART-002 MUST_IF_ENABLED`: bonus не запускається до core outfit PASS/hash approval.
- `ART-003 MAY`: триглавна історія — wardrobe із двома mirrors → TV fashion shoot → laptop із pipeline і «Дякую».
- `ART-004 MAY`: swipe/scroll детерміновано керує `video.currentTime`.
- `ART-005 SHOULD_IF_ENABLED`: UI copy залишається DOM overlay, не baked video text.
- `ART-006 SHOULD_IF_ENABLED`: reduced-motion/poster fallback зберігає доступ до результатів.
- `ART-007 SHOULD_IF_ENABLED`: art output окремо перевіряє identity, outfit і scene intent.

## 6. Working-core definition of done

Evaluator запускає одну команду, відкриває web app, додає нове user photo та text/garment reference, бачить conditioning і generation progress та завантажує два нові core PNG. Жоден етап не потребує редагування checked-in JSON. Кожен PASS має hash-bound QA evidence. Fixtures `001–003` залишаються regression proof, а не єдиним можливим input.
