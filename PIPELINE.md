# Wardrobe pipeline — продуктова карта

Немає штучного «N етапів». Це не чекліст із вигаданим відсотком готовності.
Кожна задача посилається на named step нижче: наприклад, `LOOK.03` або
`SHOOT.02`. Статус означає тільки один із трьох фактів: `LIVE`, `CORE_ONLY`
або `NOT_DELIVERED`.

## PROFILE — збережений користувач у браузері

| Step | Для користувача | Стан |
| --- | --- | --- |
| `PROFILE.01` | Browser-bound профіль/сесія. | LIVE |
| `PROFILE.02` | Зберегти й відкрити аватари та образи. | LIVE |
| `PROFILE.03` | Обрати конкретний образ аватара перед «Додати речі». | LIVE |

## LOOK — від людини й речей до білого master-образу

| Step | Для користувача | Стан |
| --- | --- | --- |
| `LOOK.01` | Завантажити фото людини. | CORE_ONLY |
| `LOOK.02` | Створити й затвердити аватар. | CORE_ONLY |
| `LOOK.03` | Завантажити референси речей без втрати прив’язки. | CORE_ONLY |
| `LOOK.04` | Вибрати одну річ із дубліката/двох пар та підготувати строгі картки речей. | CORE_ONLY |
| `LOOK.05` | Створити білий master-образ. | CORE_ONLY |
| `LOOK.06` | QA master-образу й незмінне збереження. | CORE_ONLY |

`CORE_ONLY` тут означає: код існує, але його повний теперішній шлях не був
окремо пройдений на current beta після останнього release.

## BACKGROUND — стандартні фони

Це окремий продукт від fashion shoot: один master-образ, одна звичайна сцена,
варіації пози. Немає активної задачі в цьому блоці.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `BACKGROUND.01` | Обрати один стандартний фон. | NOT_DELIVERED |
| `BACKGROUND.02` | Згенерувати й перевірити кадр на фоні. | NOT_DELIVERED |

## CREATE_UNIVERSE — fashion shoot як locked art direction

| Step | Для користувача | Стан |
| --- | --- | --- |
| `UNIVERSE.01` | Побачити та обрати цілісний fashion-shoot style unit. | LIVE частково: 5 стилів видно, 4 доступні для запуску. |
| `UNIVERSE.02` | Прив’язати до образу versioned reference pack: environment, light, camera, palette, blocking. | LIVE частково: 4 valid packs; Terracotta має SHA mismatch; 2 нові male styles ще assets-only. |
| `UNIVERSE.03` | Створити hero frame за locked look + locked style. | NOT_DELIVERED як актуальний beta proof. |
| `UNIVERSE.04` | QA hero, створити решту серії, QA, contact sheet і збереження. | NOT_DELIVERED як актуальний beta proof. |

## GENERATION_TRANSPORT — невидимий технічний шар

Це не користувацький етап. Він підтримує `LOOK.05`, `BACKGROUND.02` і
`UNIVERSE.03`.

- Higgsfield: активний current transport на beta.
- Magnific: резервний API transport, Claude ще не здав реалізацію.
- OpenRouter: резервний transport; credential зберігається тільки поза Git.

## Поточні задачі простими словами

- **Вибір образу в профілі** — `PROFILE.03`, завершено й live.
- **Додати два нові fashion shoot styles у сайт** — `UNIVERSE.01–02`: зробити
  з уже наявних референсів валідні packs і показати їх у Create Universe.
- **Magnific як резервний генератор** — `GENERATION_TRANSPORT`: це не
  користувацька фіча й не заміна Create Universe.
- **Terracotta** — `UNIVERSE.02`: блокер даних, не дозвіл вимкнути integrity
  check.

## Що означає статус

`LIVE` = точний commit активований на beta, вузький live smoke пройдено.
`CORE_ONLY` = код існує, але current beta journey не підтверджено.
`NOT_DELIVERED` = не треба називати це готовою функцією.
