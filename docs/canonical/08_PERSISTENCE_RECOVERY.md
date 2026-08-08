# 08 — persistence, restart і recovery

## Runtime root

`ZEELY_RUNTIME_ROOT` — несучий параметр. Неправильний root виглядає як втрата
даних, хоча кадри можуть бути цілими. Перед будь-яким restart, cleanup або
перенесенням спершу друкується resolved root (без секретів) і перевіряються
наявні `runs`, `profiles`, `looks`, `scenes`, `shoots`, `videos`.

## Content-addressed storage

Збережені bytes і receipts мають SHA-256 та parent lineage. Saved look повинен
містити або надійно резолвити durable item evidence, незалежно від lifecycle
початкового run. Run cleanup не має видаляти evidence, на яке посилаються look,
scene, shoot або video.

```text
run attempt ──┐
              ├── immutable evidence/blob (content addressed)
approved look ┘            │
                            ├── background scene
                            ├── fashion shoot frames
                            └── fashion video delivery
```

## Restart/resume rules

1. Після кожного provider candidate зберігаються candidate bytes, model/profile,
   request SHA і QA verdict.
2. Restart продовжує з наступного незавершеного stage/slot; він не купує той
   самий prompt/reference повторно.
3. Provider job ID і idempotency record зберігаються до завершення polling.
4. Unknown submit outcome зупиняє автоматичний fallback і вимагає reconcile.
5. Approved siblings Fashion Shoot не перегенеровуються через failure іншого
   slot.

## Media retention

Оригінали, preview derivatives, delivery clips і receipts мають різні ролі.
Очистка кешу може прибрати derived cache, але не доведені user outputs або
lineage. Перед pruning перевіряються active release, active jobs і references.

## Deployment transaction safety

Офіційний deployer:

* будує immutable release directory;
* перевіряє allowlist, manifest, hashes і privacy;
* не стартує, якщо є active work/run IDs;
* atomically перемикає runner на новий release;
* health-checks локальний і зовнішній endpoint;
* зберігає попередній release для rollback.

Не можна «почистити SSD» видаленням runtime root, release, receipts або
credential store. Виносяться лише безпечні derived caches і старі releases,
які не є running/current і проходять retention policy.

## Recovery checklist

```text
1. stop only the affected process, not the whole host blindly
2. resolve ZEELY_RUNTIME_ROOT and active release
3. inspect active job/run IDs and provider journals
4. verify Git source SHA and ops/RUNTIME.json
5. restore missing files from content-addressed evidence or prior release
6. run focused contracts + health
7. reconcile provider jobs before any new paid submit
8. deploy atomically and record source SHA ↔ runtime release SHA
```

Секрети не «переносяться» через Git clone. Вони налаштовуються окремо на host,
з правами і перевіркою наявності без друку значення.

