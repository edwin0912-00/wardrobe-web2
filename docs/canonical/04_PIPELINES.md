# 04 — канонічні пайплайни від input до delivery

## A. Profile → avatar → approved master look

```text
person photo(s) + optional garment photos/text
  → file/container/metadata validation
  → VLM extracts only visible facts (unknown stays UNKNOWN)
  → deterministic conditioning and white/reference derivatives
  → readiness: READY / REPAIRABLE / NEEDS_INPUT / INCOMPATIBLE
  → GPT Image 2 generation ladder
  → technical image QA
  → semantic identity/item/framing QA
  → immutable candidate + receipt
  → user selects/retries
  → approved avatar + approved master look
```

Коли користувач передає тільки людину і одну річ, це валідний мінімальний
look input. Коли передано лише капелюх, модель може запропонувати inferred basic
outfit, але downstream-блоки повинні показати, що одяг був model-chosen, поки
користувач явно не затвердив candidate.

## B. Standard Background

```text
approved master look
  → choose one std.* preset
  → resolve preset + reference pack + camera/framing lock
  → bind approved look evidence first
  → image/scene generation
  → scene technical + item + framing + light/shadow QA
  → save scene + preview derivative + original download
```

Фон змінює сцену/світло/камеру, а не approved identity/items. Background-only
create не має вимагати нової генерації garment dossier, якщо foreground
зберігається як immutable approved evidence.

## C. Create Universe / Fashion Shoot

Create Universe — це не одна фотосесія. Це каталог стилів, у якому кожен
`shoot.*` mode має versioned reference pack, observations, environment plate,
lighting preview і named shot slots. Fashion Shoot запускає обраний стиль,
а не стандартний фон.

```text
approved master look
  → choose shoot.* style
  → verify immutable style pack and all required sheets
  → compile Shoot Bible + slot-specific pose/camera/framing
  → create hero/reference anchor
  → launch customer frames (parallel slots where contract permits)
  → each frame: provider output → QA → retry only that slot
  → approved frames arrive progressively
  → contact sheet / saved shoot / preview + download
```

Стан одного кадру не повинен блокувати вже approved siblings. Якщо style pack
неповний, UI показує `BLOCKED_MISSING_SOURCE_PACK`, а не вдає, що стиль готовий.

## D. Fashion Video

```text
approved full look with durable top/bottom/footwear/accessory locks
  → choose versioned Fashion Video style
  → load original reference video as private directing input
  → load white-background approved person/look image
  → optional identity/face/hair reference with cleaned background
  → compile cut sheet: every cut, timing, pose, camera and visible-person rule
  → provider create/poll (never deliver source video)
  → persist raw provider MP4
  → technical QA (container, dimensions, duration, fps, audio policy)
  → per-cut semantic QA: no reference performer pixels, identity/items match
  → salvage/re-encode with approved reference audio only, if allowed
  → delivery MP4 + poster + private media URL + receipt
```

`Video 1` — reference-only directing material. `Image 1` — the only permitted
visible human wearing the approved full look. `Image 2` — optional face/hair
identity reference, not wardrobe/background authority. Every final frame must
be newly generated; source performer fragments are a blocking failure.

## E. Scene Video

Це окрема проста гілка після готового background scene:

* **Focus on item** — камера і motion підкреслюють конкретну річ;
* **Posing** — камера продає модель/образ як fashion presentation.

Вона не відкриває Fashion Video style registry і не повинна підміняти
reference-driven Fashion Video.

## F. Real-time Look

```text
approved look selected by user
  → browser requests short-lived FAL realtime token
  → camera permission/consent
  → live transform/preview
  → explicit stop/teardown
```

Зміна образу «на ходу» можлива лише через явну зміну active look і повторне
підтвердження camera session; вона не змінює збережений master look.

## G. Presentation journey

Main-site cinematic layer показує один user journey, а не генерує власні
результати: intro → input → master look → background/shoot/video/live actions
→ progressive media → final presentation/document. Документ має залишатися
в межах tracked screen до останнього presentation frame; це UI contract і не
впливає на backend QA.

