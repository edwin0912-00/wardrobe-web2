# Wardrobe / Zeely — сучасний канон проєкту

**Зріз:** 2026-08-09, Europe/Madrid  
**Назва пакета:** `docs/canonical`  
**Призначення:** одна точка входу для людини, нового агента, ревʼюера і release-owner.

Цей пакет описує не бажану майбутню систему, а поточний доведений стан плюс
чесно позначені прогалини. Він замінює пошук контексту по чатах. Старі файли
`docs/final-context/*`, `STATE.md`, `LOG.md` і `docs/coordination/*` залишаються
історичним журналом та доказами; їх не переписуємо заднім числом.

## Читати в такому порядку

1. [01_RELEASE_AND_STATUS.md](01_RELEASE_AND_STATUS.md) — яка гілка є головною,
   що реально задеплоєно і якими health-перевірками це доведено.
2. [02_PRODUCT_AND_NAMING_CANON.md](02_PRODUCT_AND_NAMING_CANON.md) — що будуємо,
   назви блоків і межі між ними.
3. [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md) — компоненти,
   контракти даних і проходження запиту.
4. [04_PIPELINES.md](04_PIPELINES.md) — повні user journeys від input до output.
5. [05_PROVIDER_TRANSPORT_POLICY.md](05_PROVIDER_TRANSPORT_POLICY.md) — активні
   провайдери, fallback, модельний ladder і заборонені маршрути.
6. [06_CONTRACTS_QA_RETRIES.md](06_CONTRACTS_QA_RETRIES.md) — незмінні
   references, QA, receipts, retry і семантика помилок.
7. [07_UI_AND_MEDIA_CANON.md](07_UI_AND_MEDIA_CANON.md) — beta/main UI,
   previews, downloads, God View, mobile/desktop та презентаційний екран.
8. [08_PERSISTENCE_RECOVERY.md](08_PERSISTENCE_RECOVERY.md) — runtime root,
   збережені образи, сцени, фотосесії, відео та відновлення після restart.
9. [09_AGENT_GOVERNANCE.md](09_AGENT_GOVERNANCE.md) — як агенти працюють,
   комітять, звітують і не розʼїжджаються по версіях.
10. [10_DEPLOYMENT_RUNBOOK.md](10_DEPLOYMENT_RUNBOOK.md) — перевірений
    install/build/verify/deploy/rollback порядок.
11. [11_OPEN_GAPS.md](11_OPEN_GAPS.md) — що ще не можна називати повністю
    готовим та який доказ потрібен далі.

## Чотири різні значення «працює»

| Термін | Що він доводить |
|---|---|
| **Є в коді** | модуль і його unit/contract tests існують у Git |
| **Доступно live** | маршрут/каталог відповідає через публічний HTTP health або API |
| **Пройшов E2E** | конкретний user journey реально виконаний від input до delivery |
| **Готово для клієнта** | E2E, persistence, UI delivery, error recovery і release traceability підтверджені разом |

Health `ready` сам по собі не є доказом платної генерації. Будь-який звіт
повинен вказувати, який саме із чотирьох рівнів підтверджений.

## Поточний source/runtime snapshot

* Поточна обʼєднана лінія — `alpha`. Вона є єдиною гілкою інтеграції,
  версійування і деплою.
* На момент зрізу всі три remote mirrors (`alpha`, `beta`, `canonical`)
  вказували на `2170415eaf9a`. Після цього документаційного коміту source SHA
  зміниться; у release-звіті завжди записується точний новий SHA.
* Поточний live product artifact окремо від branch head: release
  `b189afe7ddb4e9bdf8d1e541a69f0cf0ed4de491`, cache token
  `product-b189afe7-ddfef560140a`. Це навмисно: останній branch commit після
  нього містив лише тестову правку і не вимагав нового product artifact.
* Перевірені `https://beta.madeforthisjob.com/api/health`,
  `https://madeforthisjob.com/api/health` і
  `https://site.madeforthisjob.com/api/health` повертали `ready` та цей release
  SHA на момент останньої перевірки. Новий агент має повторити health після
  будь-якого деплою, а не довіряти цій фразі назавжди.
* `main` і tag `alpha-0.01` — історичні checkpoints. Їх не переписуємо і не
  використовуємо як поточну інтеграційну лінію.

## Правило безпеки контексту

У Git не зберігаються API keys, cookies, private URLs, user photos, provider
receipts із секретними полями або абсолютні шляхи до приватного сховища.
Секрети читаються лише runtime process із host-private credential store.
Документація описує назву змінної/роль і спосіб перевірки, але не значення.

## Як оновлювати цей пакет

1. Спершу прочитати `OWNERS.md`, `STATE.md`, `LOG.md` і цей README.
2. Перевірити source SHA, live `/api/health` і focused tests.
3. Описувати тільки те, що має доказ: commit, test output, route response,
   artifact digest або browser capture.
4. Якщо факт не перевірявся, писати `NOT_REVERIFIED`, а не «готово».
5. Оновлювати повʼязані канони в одному коміті; додавати рядок у `LOG.md` і
   змінювати `STATE.md` лише через release-owner.

