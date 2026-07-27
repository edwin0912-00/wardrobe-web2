# Video та Live Camera — чесний продуктовий канон

## Спільна основа

Обидва режими починаються лише після `ART_SHOOT.05`: є конкретний approved
master-look, обраний style unit і хоча б один затверджений кадр або contact
sheet. Вони не приймають випадкову фотографію речі як вихідний матеріал і не
мають права міняти identity, look, бренди/читабельний текст чи стиль локації.

Дозволено змінювати тільки те, що явно обрано режимом: рух, тривалість,
камеру, gesture і кадрування в межах канону style unit.

## VIDEO — fashion motion

### Що це

Короткий fashion motion clip із затвердженої фотосесії. Це не «згенеруй будь
яке відео з людиною»: його джерело, look і art direction видно користувачу до
запуску.

### П’ять канонічних motion modes

1. **Editorial micro-moment** — 4–6 секунд: дихання, погляд, легкий рух рук,
   тканини й волосся; камера майже нерухома. Найнадійніший перший режим.
2. **Camera drift** — 5–7 секунд: дуже повільний push-in, pull-out або бокове
   ковзання; людина зберігає позу. Працює для портретних і detail кадрів.
3. **Walk / stride** — 5–8 секунд: один контрольований крок у повний зріст.
   Доступний лише коли взуття й ноги видно у source кадрі.
4. **Garment gesture** — 4–6 секунд: одна дія, яка показує річ: поправити
   комір, повернутись на 3/4, рух рукава, сумка в руці. Не додає нових речей.
5. **Campaign transition** — два вже approved кадри однієї фотосесії,
   акуратний перехід між ними. Це не morph між різними образами.

### Непорушні locks

- identity, волосся, силует і master-look;
- усі затверджені речі, їхні колір, матеріал і місце на тілі;
- style unit: світло, оптика, палітра, локація та допустимий framing;
- aspect ratio, якщо він є частиною output contract.

### QA і delivery

Кожен clip проходить: identity continuity, garment fidelity, anatomy/hands,
framing, scene/style match і відсутність випадкових props/text. Якщо не
пройшов один clip — повторюється тільки він. Loop називається loop лише після
перевірки стику першого й останнього кадру. У профілі clip лежить поруч зі
своїм source shoot і показує source frame, motion mode, версію style unit та
QA status.

## LIVE CAMERA — два чесні режими, не один фальшивий

### 1. Live Director — перший рекомендований продукт

Це справді live browser camera experience без генерації нової людини в
кожному кадрі. Камера лишається локальною, а поверх preview показуються:

- рамка й дистанція до камери з обраного style unit;
- guide по позі/лінії плечей/напрямку погляду;
- guide світла: звідки має приходити key light, де потрібна тінь;
- обраний кадр фотосесії як discreet reference, а не заміна webcam image;
- індикатор camera on, privacy state і явна кнопка Capture.

Live Director не обіцяє, що користувач «в реальному часі одягнений» у
генерований look. Він допомагає зняти реальний матеріал у каноні фотосесії.

### 2. Generative Camera Preview — наступний, окремо позначений режим

Після явного Capture береться один кадр, створюється **delayed generated
preview** із locked look/style. Це не real-time stream і не має називатися
«live try-on». UI прямо показує `Створюю preview`, source capture і результат
окремо. Користувач або зберігає цей результат, або відкидає його; потокове
надсилання всіх webcam кадрів не допускається.

## Privacy canon для webcam

1. Camera permission запитується тільки після натискання «Live camera».
2. Preview за замовчуванням залишається в браузері й не пишеться на сервер.
3. Немає прихованого recording, upload чи background capture.
4. Відправка одного кадру можлива тільки через явний Capture і окремий стан
   «Надіслати на створення preview».
5. Користувач бачить Stop camera; при закритті режиму stream припиняється.
6. Зберігається лише результат, який користувач явно натиснув «Зберегти».

## UI contract

### Video

`Approved shoot → обрати source frame → motion mode → live progress → QA →
clip у профілі`.

### Live Director

`Approved shoot → Live camera consent → local preview + guides → Capture або
Stop → (опційно) delayed generated preview → explicit Save`.

Будь-який стан помилки називає конкретну дію: повторити clip, обрати інший
source frame, перевірити camera permission або закрити live session. Він не
має скидати approved shoot чи look.
