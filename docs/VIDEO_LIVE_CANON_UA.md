# Video та Live Camera — чесний продуктовий канон

## Спільна основа

**Редакція 2026-07-27, рішення оператора.** Точка входу — не `ART_SHOOT.05`, а
**обраний образ**. Щойно в користувача є хоч один готовий master-look і він
натиснув саме на цей образ, з нього відкриваються три рівноправні напрями:

1. **Live** — примірка одягу з камерою.
2. **Photoshoot** — фотозйомка в обраному style unit.
3. **Fashion video** — відео зі стилем руху.

Порядок і взаємне розташування цих блоків ще можуть змінитися; зафіксована
саме точка входу. Затверджена фотозйомка більше не є передумовою для відео —
вона лишається одним із трьох виходів з образу, а не воротами до решти.

Попередня редакція цього абзацу вимагала, щоб обидва режими стартували лише
після `ART_SHOOT.05`, за наявності затвердженого кадру або contact sheet
(коміти `1319384`, `aac3ea5`, `4472986`, автор `codex-main`). Ця вимога знята
оператором і збережена тут лише як історія, щоб посилання на неї в інших
файлах читалися правильно.

Що лишається чинним незалежно від точки входу: жоден режим не приймає
випадкову фотографію речі як вихідний матеріал і не має права міняти identity,
look, бренди/читабельний текст чи стиль локації. Джерелом завжди є конкретний
обраний master-look, а не довільне зображення.

Дозволено змінювати тільки те, що явно обрано режимом: рух, тривалість,
камеру, gesture і кадрування в межах канону style unit.

## VIDEO — fashion motion

### Що це

Короткий fashion motion clip із затвердженої фотосесії. Це не «згенеруй будь
яке відео з людиною»: його джерело, look і art direction видно користувачу до
запуску.

### Video transport decision

Для fashion video обраний **Seedance 2** з reference-bound source кадром і
motion plan. Він є async генератором кліпу: не читає webcam stream і не
забезпечує live preview. Не позначати Seedance 2 активним на beta, доки його
окремий auth/API route не пройде точний test → beta activation → live smoke.

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

## LIVE CAMERA — local fallback і справжній generative-live candidate

### 1. Live Director — безкоштовний fallback

Це справді live browser camera experience без генерації нової людини в
кожному кадрі. Камера лишається локальною, а поверх preview показуються:

- рамка й дистанція до камери з обраного style unit;
- guide по позі/лінії плечей/напрямку погляду;
- guide світла: звідки має приходити key light, де потрібна тінь;
- обраний кадр фотосесії як discreet reference, а не заміна webcam image;
- індикатор camera on, privacy state і явна кнопка Capture.

Live Director не обіцяє, що користувач «в реальному часі одягнений» у
генерований look. Він допомагає зняти реальний матеріал у каноні фотосесії.

### 2. Lucy 2.5 Realtime — основний generative-live MVP

Decart Lucy 2.5 Realtime через fal.ai справді редагує webcam stream у
реальному часі. Це не delayed preview: browser відкриває camera, WebRTC
передає media peer-to-peer до Decart, а prompt і approved reference image
тримають locked look/style.

```text
approved ART_SHOOT.05
→ explicit Live webcam choice
→ local camera permission + preview
→ visible $0.04/sec consent + 60-sec hard limit
→ server-issued short-lived fal token
→ decart/lucy-2-5/realtime WebRTC session
→ transformed mirror stream
→ explicit Stop або Capture
```

Постійний `FAL_KEY` ніколи не потрапляє у browser. Без cost consent backend
не має права навіть викликати token issuer. На першому MVP максимум однієї
сесії — 60 секунд, тобто `$2.40`; paid smoke запускається тільки після
окремого попередження й дозволу Edwin.

### 3. Delayed Generative Camera Preview — fallback без live stream

Якщо Lucy/WebRTC недоступний, після явного Capture береться один кадр,
створюється **delayed generated
preview** із locked look/style. Це не real-time stream і не має називатися
«live try-on». UI прямо показує `Створюю preview`, source capture і результат
окремо. Користувач або зберігає цей результат, або відкидає його; потокове
надсилання всіх webcam кадрів не допускається.

## Звідки береться live: залізо, browser, server, provider

### A. Local Live Director — перша реалізація

```text
Камера iPhone / Mac / USB webcam
        ↓  (явний browser permission)
Safari / Chrome: MediaStream
        ↓
<video> preview + Canvas/WebGL guides + local pose landmarks
        ↓
екран користувача
```

- **Залізо:** фронтальна/основна камера iPhone, вбудована камера Mac або USB
  webcam. Воно належить користувачу; Zeely не має «своєї» камери.
- **Хто відкриває камеру:** браузер через `navigator.mediaDevices.getUserMedia`.
  Це працює тільки в HTTPS secure context і тільки після browser permission.
- **Що робить live:** `<video>` показує локальний `MediaStream`; Canvas/WebGL
  малює framing, світло, pose guide і target composition поверх нього.
- **Хто дає pose/тіло:** `@mediapipe/tasks-vision` Pose Landmarker локально в
  web app. Він повертає landmarks; це не identity engine і не генератор одягу.
  Відеодетекцію треба виконувати у Web Worker, бо sync виклик на main thread
  блокує UI.
- **Що робить наш сервер:** віддає public style-guide metadata й короткоживучу
  session state. Він не отримує MediaStream і не зберігає webcam video.
- **Що роблять Higgsfield / OpenRouter / Magnific:** нічого в цьому local live
  режимі. Вони не є webcam transport і не відповідають за camera preview.

Це єдиний режим, який чесно можна назвати **live** у першому релізі: camera
preview та guides справді оновлюються на девайсі користувача.

### B. Delayed Generative Preview — другий рівень

```text
Local Live Director
        ↓  (лише явний Capture)
один JPEG/HEIC кадр
        ↓
Zeely beta API → current image provider
        ↓
згенерований preview → QA → Save / Discard
```

Тут current provider — той, що активний у beta на момент запиту (зараз
Higgsfield; OpenRouter — validated fallback). Це асинхронна генерація, тому в
UI статус тільки `Створюю preview`, ніколи не `Live`. Камера далі лишається
локальною; на сервер йде один конкретний capture, а не stream.

### C. Коли реально потрібен WebRTC/LiveKit

WebRTC/LiveKit не потрібні для Local Live Director. Вони потрібні тільки якщо
з’являється хоча б одна з цих можливостей:

- віддалений art director або інший користувач бачить camera stream;
- stream має дійти до server-side real-time processor;
- потрібні кімнати, multi-device, remote audio або запис стріму.

Тоді LiveKit може бути transport layer: він публікує/передає camera track,
керує короткоживучими room tokens, permission і індикаторами capture. Він не
є image/video model і не створює fashion look. Для MVP не підключати його:
це додає відправку медіа поза девайс, TURN/SFU інфраструктуру, session security
та інший privacy contract.

### Мінімальний hardware/performance canon

- Пріоритет — iPhone Safari та desktop Chrome/Safari з камерою; microphone не
  просимо, якщо він не потрібен конкретному режиму.
- Просимо тільки `video`; стартуємо з адаптивних constraints, не вимагаємо
  4K/60 fps, які можуть бути недоступні на конкретній камері.
- Якщо pose inference не встигає, знижуємо частоту guide update, а не quality
  camera preview і не перекидаємо відео на server без consent.
- При denial/no camera/track ended UI не падає: показує конкретну дію
  `Дозволити камеру`, `Обрати іншу камеру` або `Повернутися до фотосесії`.

## Privacy canon для webcam

1. Camera permission запитується тільки після натискання «Live camera».
2. Local preview за замовчуванням залишається в браузері. Lucy media передається
   тільки після окремого generative-live consent через заявлений WebRTC route.
3. Немає прихованого recording, upload чи background capture.
4. Для delayed fallback відправка одного кадру можлива тільки через явний
   Capture. Для Lucy дозволяється лише bounded live session з видимим таймером
   і Stop; прихований background stream заборонений.
5. Користувач бачить Stop camera; при закритті режиму stream припиняється.
6. Зберігається лише результат, який користувач явно натиснув «Зберегти».

## UI contract

### Video

`Approved shoot → обрати source frame → motion mode → live progress → QA →
clip у профілі`.

### Live Camera

`Approved shoot → Live camera consent → local preview → cost consent →
bounded Lucy WebRTC stream → Stop/Capture → explicit Save`.

Будь-який стан помилки називає конкретну дію: повторити clip, обрати інший
source frame, перевірити camera permission або закрити live session. Він не
має скидати approved shoot чи look.

## Первинні технічні джерела

- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
  — модель camera source, MediaStream і MediaStreamTrack.
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
  — HTTPS, permission і camera errors у browser.
- [Google MediaPipe Pose Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
  — browser pose landmarks, video inference і вимога винести sync detection з
  main thread у worker.
- [LiveKit camera and microphone documentation](https://docs.livekit.io/transport/media/publish/)
  — transport camera tracks і permission/recording indicators для випадку,
  коли з’явиться віддалений real-time media transport.
