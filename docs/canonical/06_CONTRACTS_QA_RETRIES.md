# 06 — контракти, QA, receipts і retry

## Contract layers

1. **Input contract** — file signature/container, MIME, size, dimensions,
   orientation, color space і readable bytes.
2. **Conditioning contract** — visible facts only, deterministic derivatives,
   parent SHA, operation and output SHA.
3. **Reference contract** — role, order, source attempt, pack/version and
   content hashes. Не можна підміняти `mode-id` полем `mode.slot`.
4. **Generation contract** — canonical internal model, profile, prompt SHA,
   idempotency key, output target and bounded retry.
5. **QA contract** — technical/semantic verdicts, measurements, evidence
   hashes, `weakened_checks` and explicit delivery decision.
6. **Persistence contract** — approved item evidence must survive run cleanup,
   restart and later scene/video consumers.

## Reference ordering

Для image/scene generation approved look evidence є першою authority. Для
repair-сцен failed candidate може зʼявитися лише у визначеній scene position.
Для Fashion Video порядок і ролі видимі в UI/receipt:

```text
Video 1 = private motion/editorial reference, never delivery
Image 1 = approved person + complete outfit, only visible human
Image 2 = optional face/hair identity reference, no clothing/background authority
style sheets = cut sheet / lighting / environment / pose authorities
```

Промпт допомагає моделі, але не замінює deterministic lock. SHA exact prompt,
ordered references і geometry targets записуються до submit.

## Image/scene QA

QA перевіряє не тільки рядок у prompt і не тільки наявність output PNG. Залежно
від блоку перевіряються:

* identity/face/body consistency;
* selected item shape, color, pattern, footwear and first appearance;
* subject framing and aspect ratio;
* background/style match, lighting and contact shadow;
* dimensions, MIME, bytes, crop and transparent/white-background rules;
* approved evidence binding and source lineage.

Framing lock є delivery tolerance, а не ліцензія змінювати предмет. Якщо модель
стабільно повертає неправильний framing, спершу змінюється generation guidance
або repair route; gate не послаблюється тихо. Задекларовані tolerance bands
зберігаються у versioned contract.

## Fashion Shoot QA

Кожен customer frame має окремий slot, pose reference, camera/framing target,
style sheets і immutable receipt. Retry стосується лише failed slot; approved
siblings не перегенеровуються. Якщо source pack неповний, це `BLOCKED_*`, а не
advisory success.

## Fashion Video QA

Технічна перевірка: MP4 bytes, dimensions, duration, FPS, readable stream,
audio policy і persistence/reopen. Semantic перевірка: кожен cut має повністю
згенерованого approved персонажа, немає reference performer pixels/слайсів,
item/identity locks тримаються, а source Video 1 не повертається як delivery.

`VIDEO_REFERENCE_QA_FAILED` — структурований reject. Для цього класу дозволено
до двох автоматичних reference-QA retries (`MAX_AUTOMATIC_REFERENCE_QA_RETRIES
= 2`), кожен з новим immutable attempt/receipt. Якщо provider явно відхилив
input до прийняття (`IP check not finished for input media`), окремий bounded
pre-submit retry може повторити create до двох разів. Після unknown outcome
автоматичний дубль заборонений.

## Error semantics

UI має показувати `code`, `stage`, `retryable`, `attempt`, `next_action` і
людський текст. Приклади:

```text
GENERATION_UNAVAILABLE
LOOK_ITEM_EVIDENCE_INVALID
MODEL_RESPONSE_MISMATCH
VIDEO_REFERENCE_QA_FAILED
INPUT_MEDIA_IP_CHECK_PENDING
QA_EXHAUSTED
```

Не перетворювати всі помилки на «зʼєднання перервалось». Це приховує справжню
причину і робить операторський дебаг неможливим.

## Evidence fields

Кожен завершений attempt має містити:

```text
attempt_id, parent_attempt_id, provider, model/profile,
request_sha, ordered_reference_shas, output_sha,
technical_qa, semantic_qa, retry_reason, weakened_checks,
created_at, persisted_at, delivery_status
```

`weakened_checks` завжди присутній: `[]` означає, що перевірку не послаблювали.
Відсутність поля — дефект receipt, не «нічого важливого».
