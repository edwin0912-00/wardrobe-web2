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

## CREATE_UNIVERSE — вибір locked art direction

| Step | Для користувача | Стан |
| --- | --- | --- |
| `UNIVERSE.01` | Побачити та обрати цілісний fashion-shoot style unit. | LIVE частково: 5 стилів видно, 4 доступні для запуску. |
| `UNIVERSE.02` | Прив’язати до образу versioned reference pack: environment, light, camera, palette, blocking. | LIVE частково: 4 valid packs; Terracotta має SHA mismatch; 2 нові male styles ще assets-only. |
| `UNIVERSE.03` | Створити hero frame за locked look + locked style. | NOT_DELIVERED як актуальний beta proof. |
| `UNIVERSE.04` | QA hero, створити решту серії, QA, contact sheet і збереження. | NOT_DELIVERED як актуальний beta proof. |

## ART_SHOOT — реалізація обраної fashion-фотосесії

Це окремий продукт після Create Universe. `UNIVERSE` відповідає на питання
«який style unit обрано», а `ART_SHOOT` — «як користувач отримує готову
фотосесію». Зйомка завжди тримає один approved master-look і один locked
style unit; локація, світло, оптика, композиція й пози не є окремими
перемикачами.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `ART_SHOOT.01` | Відкрити обраний style unit на master-образі та побачити Shoot Bible: кадри, пози, світло, локацію й camera language. | NOT_DELIVERED |
| `ART_SHOOT.02` | Запустити hero frame — перший контрольний кадр зйомки. | NOT_DELIVERED |
| `ART_SHOOT.03` | Побачити live progress: який кадр створюється, які locks/reference packs застосовані, який QA gate виконується. | NOT_DELIVERED |
| `ART_SHOOT.04` | Після hero QA згенерувати решту кадрів серії та повторювати тільки невдалий кадр. | NOT_DELIVERED |
| `ART_SHOOT.05` | Отримати contact sheet, окремі кадри, їх статути QA та збережену фотосесію в профілі. | NOT_DELIVERED |

## VIDEO — motion із затвердженої fashion-фотосесії

Video ніколи не стартує з випадкового аватара чи референсу одягу. Його source
— конкретний approved кадр або approved shoot із `ART_SHOOT.05`; style,
персонаж, образ і сцена вже зафіксовані.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `VIDEO.01` | Вибрати один готовий кадр/фотосесію як source motion. | NOT_DELIVERED |
| `VIDEO.02` | Обрати короткий motion plan: рух камери, рух людини, тривалість і loop/non-loop. | NOT_DELIVERED |
| `VIDEO.03` | Побачити live generation і per-frame/identity/style QA. | NOT_DELIVERED |
| `VIDEO.04` | Отримати збережений motion clip поруч із source shoot. | NOT_DELIVERED |

Детальний motion canon, locks, QA і UI: [VIDEO_LIVE_CANON_UA.md](docs/VIDEO_LIVE_CANON_UA.md).

## LIVE_WEBCAM — альтернатива або наступний режим після video

Це не прихована заміна video. На одному approved shoot користувач обирає
окремо **«Зробити відео»** або **«Live camera»**. Live режим використовує
явний дозвіл камери та показує лише поточну сесію; він не створює прихованого
архіву webcam-кадрів.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `LIVE.01` | Явно обрати Live camera для конкретного approved shoot. | NOT_DELIVERED |
| `LIVE.02` | Дати browser permission, побачити preview та чіткий стан камери. | NOT_DELIVERED |
| `LIVE.03` | Працювати з live overlay/experience, прив’язаним до locked style й look. | NOT_DELIVERED |
| `LIVE.04` | За явною дією зберегти лише обраний результат або завершити сесію без збереження. | NOT_DELIVERED |

Перший live продукт — Local Live Director; delayed generative preview є
окремим наступним режимом. Деталі: [VIDEO_LIVE_CANON_UA.md](docs/VIDEO_LIVE_CANON_UA.md).

## GENERATION_TRANSPORT — невидимий технічний шар

Це не користувацький етап. Він підтримує `LOOK.05`, `BACKGROUND.02`,
`ART_SHOOT.02–04` і `VIDEO.03`.

- Higgsfield: активний current transport на beta.
- Magnific: резервний API transport, Claude ще не здав реалізацію.
- OpenRouter: перевірений резервний transport; credential зберігається тільки
  в захищеному host store, ніколи не в Git, звітах чи prompts.

## Поточні задачі простими словами

- **Вибір образу в профілі** — `PROFILE.03`, завершено й live.
- **Додати два нові fashion shoot styles у сайт** — `UNIVERSE.01–02`: зробити
  з уже наявних референсів валідні packs і показати їх у Create Universe.
- **Magnific як резервний генератор** — `GENERATION_TRANSPORT`: це не
  користувацька фіча й не заміна Create Universe.
- **Terracotta** — `UNIVERSE.02`: блокер даних, не дозвіл вимкнути integrity
  check.

## Як кожен pipeline стає частиною сайту

Кожний новий продуктовый блок складається в UI як Lego, а не як прихований
backend endpoint. До `LIVE` він має мати всі п’ять частин:

1. **Entry card** — звідки користувач запускає блок і який approved source
   він використовує.
2. **Choice UI** — лише дозволені для цього блоку опції; для art shoot це
   style unit, для video motion plan, для live явний consent.
3. **Process UI** — live progress, поточний крок, видимий reference/lock/QA
   контекст без внутрішніх секретів або model reasoning.
4. **Result UI** — готові assets, статус QA, помилка з конкретною дією retry
   тільки поточного етапу.
5. **Persistence + next action** — де результат лежить у профілі та що можна
   зробити далі: додати речі, зробити shoot, video або live session.

Кожен user-visible task у `UPDATE.md` мусить назвати свій named step,
додати ці UI-частини до acceptance check, а після commit пройти exact beta
activation і вузький live smoke саме для entry → process → result.

## Що означає статус

`LIVE` = точний commit активований на beta, вузький live smoke пройдено.
`CORE_ONLY` = код існує, але current beta journey не підтверджено.
`NOT_DELIVERED` = не треба називати це готовою функцією.
