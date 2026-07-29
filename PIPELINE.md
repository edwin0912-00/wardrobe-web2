# Wardrobe pipeline — продуктова карта

Немає штучного «N етапів». Це не чекліст із вигаданим відсотком готовності.
Кожна задача посилається на named step нижче: наприклад, `LOOK.03` або
`SHOOT.02`. Статус означає тільки один із трьох фактів: `LIVE`, `CORE_ONLY`
або `NOT_DELIVERED`.

## Робочі блоки

Продуктова карта нижче не змінюється, але робота розділена на сім паралельних
гілок: Block 1 — core look/QA; Block 2 — profile/UI; Block 3 — backgrounds;
Block 4 — Creative Universe packs; Block 5 — Fashion Shoot; Block 6 —
generated video; Block 7 — Real-time Look. Точні межі:
[`docs/coordination/BETA_BLOCKS_2026-07-29.md`](docs/coordination/BETA_BLOCKS_2026-07-29.md).

Block 0.8 — це не продуктова стадія. Це постійний незалежний
Gemini/Antigravity QA-спостерігач, який після інтеграції проходить відповідний
user-flow на реальному beta-сайті та повертає доказовий verdict власнику
Block 1–7.

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
| `LOOK.07` | За бажанням натиснути «Покращити образ» перед вибором фону. | PROPOSED |

`CORE_ONLY` тут означає: код існує, але його повний теперішній шлях не був
окремо пройдений на current beta після останнього release.

### `LOOK.07` — запропоноване «Покращити образ»

Це окрема **неактивна** дія після approved master-образу і **до**
`BACKGROUND.01`. Її не можна підміняти перегенерацією образу або фоном.

- Фіксує незмінними: ідентичність людини, усі обрані користувачем речі,
  їхні колір, логотипи, матеріали й крій, а також master-образ як source.
- Дозволена зона: лише не обрані користувачем елементи образу; зачіска;
  делікатний макіяж у межі приблизно 15–20%; невелика природна корекція пози.
- Не дозволяє: додати нову річ/аксесуар, замінити чи приховати обрану річ,
  змінити тіло або обличчя, створити фон чи видати результат за master-образ.
- Результат зберігається як окремий refined candidate з чіткою дією:
  **залишити master**, **прийняти покращений образ** або **повторити тільки
  цей крок**. Лише прийнятий candidate може йти у фони чи fashion shoot.

Перед реалізацією потрібні: точний UI-прототип кнопки, машинний контракт
дозволених/заборонених змін, QA для locks та окремий тест на те, що жодна
обрана річ не змінилась. Це заплановано на наступну сесію; генерація або
зміна пікселів у межах цього запису не виконувалась.

## CHOICE — живі напрямки одного образу

Після approved master-look користувач бачить не випадкове меню, а один
виразний «universe» з п’яти action cards. Технічний `LIVE_WEBCAM` у UI
називається **Real-time Look**.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `CHOICE.01` | Обрати: Покращити образ / Додати фон / Фотозйомка / Fashion Video / Real-time Look. | PROPOSED |
| `CHOICE.02` | Побачити чесний статус, складність і спосіб запуску кожного напряму. | PROPOSED |

### Візуальний канон choice universe

Кожна картка має власний повільний світловий характер: тонкий spotlight
рухається орбітою, halo дихає, а focus/hover злегка підсилює світло. Це має
створювати відчуття «натисни мене», але не маскувати стан функції.

| Дія | Світловий характер | Складність / інтенсивність |
| --- | --- | --- |
| **Покращити образ** | м’який лайм/перлинно-зелений, локальна пульсація | 1 — делікатне уточнення candidate |
| **Додати фон** | теплий жовтий/amber, широкий сонячний прожектор | 2 — один кадр, одна сцена |
| **Фотозйомка** | холодний electric-blue, кілька повільних світлових шарів | 3 — style unit і серія кадрів |
| **Fashion Video** | глибокий червоний, кінетичний rim-light | 4 — async motion і video QA |
| **Real-time Look** | фіолетовий/ультрафіолетовий, найяскравіша контрольована орбіта | 5 — camera permission, privacy/cost consent і реальна сесія |

Інтенсивність означає **обсяг та вимоги режиму**, а не шанс результату,
готовність чи ціну. Недоступна дія не імітує активність: картка лишається
виразною, але має точний видимий статус і одну чесну наступну дію. Анімація
повільна, циклічна й не заважає читанню; для `prefers-reduced-motion` вона
стає статичним halo без обертання.

## BACKGROUND — стандартні фони

Це окремий продукт від fashion shoot: один master-образ, одна звичайна сцена,
варіації пози. Немає активної задачі в цьому блоці.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `BACKGROUND.01` | Обрати один стандартний фон. | NOT_DELIVERED |
| `BACKGROUND.02` | Згенерувати й перевірити кадр на фоні. | NOT_DELIVERED |

### BACKGROUND_VIDEO — просте відео з уже готового фону

Це **не** первинне Fashion Video і не продовження editorial photoshoot.
З’являється лише після approved результату `BACKGROUND.02`. Його джерело —
один збережений кадр на фоні; навіть з reference-пакетом цей режим лишається
простішим за fashion shoot і не успадковує його art direction.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `BACKGROUND_VIDEO.01` | Відкрити збережений кадр на фоні й обрати ціль ролика. | PROPOSED |
| `BACKGROUND_VIDEO.02` | Обрати тільки один напрям: **Фокус на речі** або **Позування**. | PROPOSED |
| `BACKGROUND_VIDEO.03` | Створити та перевірити короткий простий кліп з цього кадру. | PROPOSED |
| `BACKGROUND_VIDEO.04` | Зберегти кліп поруч із конкретним фоновим кадром. | PROPOSED |

- **Фокус на речі** — product-напрям: один предмет (наприклад, худі або
  джинси), його матеріал, посадка, деталь або рух тканини. Він не має
  перетворюватися на випадкову fashion-позу.
- **Позування** — model-напрям: людина продає себе в образі через просту
  позу, погляд, один крок або короткий рух. Він не має підмінятися предметним
  close-up.

В обох варіантах людина, approved look і сам фон locked. Режим не додає
новий одяг, аксесуари, іншу локацію чи editorial style unit.

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

## VIDEO — первинне Fashion Video з master-образу

Fashion Video — одна з окремих кнопок одразу після створення approved
master-образу, нарівні з **Додати фон** і **Створити фотозйомку**. Воно не
залежить від editorial photoshoot чи фонів. Video ніколи не стартує з
випадкового аватара або референсу одягу: його source — конкретний обраний
approved master-look. Персонаж і образ фіксуються до старту; фотозйомка або
фон можуть бути лише окремими продуктами, а не передумовою цього відео.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `VIDEO.01` | Натиснути «Fashion Video» на збереженому master-образі. | NOT_DELIVERED |
| `VIDEO.02` | Обрати короткий motion plan: рух камери, рух людини, тривалість і loop/non-loop. | NOT_DELIVERED |
| `VIDEO.03` | Побачити live generation і per-frame/identity/style QA. | NOT_DELIVERED |
| `VIDEO.04` | Отримати збережений motion clip поруч із source master-образом. | NOT_DELIVERED |

Детальний motion canon, locks, QA і UI: [VIDEO_LIVE_CANON_UA.md](docs/VIDEO_LIVE_CANON_UA.md).

## LIVE_WEBCAM — альтернатива або наступний режим після video

Це не прихована заміна video. На одному обраному approved master-look
користувач має чотири рівноправні продовження: **Додати фон**,
**Photoshoot**, **Fashion Video** або **Real-time Look**. Live режим використовує явний дозвіл камери
та показує лише поточну сесію; він не створює прихованого архіву webcam-кадрів.

| Step | Для користувача | Стан |
| --- | --- | --- |
| `LIVE.01` | Явно обрати Real-time Look для конкретного approved master-образу. | NOT_DELIVERED |
| `LIVE.02` | Дати browser permission, побачити preview та чіткий стан камери. | NOT_DELIVERED |
| `LIVE.03` | Працювати з live overlay/experience, прив’язаним до locked style й look. | NOT_DELIVERED |
| `LIVE.04` | За явною дією зберегти лише обраний результат або завершити сесію без збереження. | NOT_DELIVERED |

Безкоштовний fallback — Local Live Director. Основний generative-live кандидат
для MVP — Decart Lucy 2.5 Realtime через fal.ai: browser webcam → WebRTC →
prompt/reference-bound transformed stream. Він коштує `$0.04/сек`, тому
вимагає видимого cost consent, hard timeout і server-issued short-lived token.
Цей route залишається `NOT_DELIVERED`, доки exact paid smoke не буде окремо
схвалений, виконаний і зафіксований. Деталі:
[VIDEO_LIVE_CANON_UA.md](docs/VIDEO_LIVE_CANON_UA.md) і
[LUCY_LIVE_MVP_UA.md](docs/LUCY_LIVE_MVP_UA.md).

## GENERATION_TRANSPORT — невидимий технічний шар

Це не користувацький етап. Він підтримує `LOOK.05`, `BACKGROUND.02`,
`ART_SHOOT.02–04` і `VIDEO.03`.

- Higgsfield: активний current transport на beta.
- Magnific: резервний API transport, Claude ще не здав реалізацію.
- OpenRouter: перевірений резервний transport; credential зберігається тільки
  в захищеному host store, ніколи не в Git, звітах чи prompts.
- Seedance 2: обраний async transport для `VIDEO.03`; не є live-camera
  transport і ще не позначений active на beta без окремої перевірки.
- Decart Lucy 2.5 Realtime через fal.ai: WebRTC transport для `LIVE.03`;
  provider candidate, не active beta route без окремого платного smoke.

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
   зробити далі: покращити образ, додати фон, зробити shoot, video або
   Real-time Look session.

Кожен user-visible task у `UPDATE.md` мусить назвати свій named step,
додати ці UI-частини до acceptance check, а після commit пройти exact beta
activation і вузький live smoke саме для entry → process → result.

## Що означає статус

`LIVE` = точний commit активований на beta, вузький live smoke пройдено.
`CORE_ONLY` = код існує, але current beta journey не підтверджено.
`NOT_DELIVERED` = не треба називати це готовою функцією.
