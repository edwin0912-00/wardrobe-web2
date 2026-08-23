# 07 — UI, media delivery і user journey

## Дві подачі одного runtime

**Beta engineering UI** показує provider status, ноди, structured errors,
attempt/retry, receipts і QA.
**Main cinematic UI** показує той самий state через mirror/TV/laptop,
presentation scroll, активний master look і готові media.

Main не має вигадувати успішний результат, якщо beta/runtime має failure.
Навпаки, beta не повинна вимагати cinematic presentation для того, щоб API
маршрут працював.

## Media rules

* Original/evidence файл зберігається для download і audit.
* UI preview — окремий derivative (для зображень — lightweight WebP/preview
  route; для відео — poster/stream derivative), а не resize оригіналу після
  вирізання фону.
* Якщо треба прибрати білий фон, спочатку робиться cutout на повній якості,
  потім з нього будуються preview derivatives. Інакше край стає піксельним.
* Кнопка **Завантажити** повинна віддавати original/private delivery, не
  preview. Preview може бути у бібліотеці та на телевізорі.
* HEIC/HEIF приймається через browser decode або server fallback з перевіркою
  JPEG/PNG bytes після конвертації; просте перейменування розширення не є
  конвертацією.
* Drag-and-drop і file picker мають вести в один upload contract.

## Saved media library

Після перезавантаження користувач повинен бачити в active look:

* approved avatar/master look;
* збережені standard scenes/backgrounds;
* Fashion Shoot, з кадрами, які приходять поступово;
* Fashion Video з poster, play, download і copy-link action;
* статус кожного job/slot, а не нескінченний orb.

Матеріал зберігається за look/run/scene/shoot/video IDs. Ephemeral provider
paths не можуть бути єдиним джерелом для library.

## Progressive Fashion Shoot UI

Після старту пʼяти слотів UI показує 5 named cards і progress 0–5. Кожен слот
має `queued / generating / QA / approved / retry / failed`. Щойно один кадр
approved, він одразу зʼявляється справа в result/library; інші не блокують його.
Retry запускає лише failed slot.

## Main presentation / scroll

Presentation — це tracked sequence, не вільна сторінка поверх відео:

```text
scene/intro → mirror interaction → laptop document → final document frame
```

* На desktop документ залишається в екрані ноутбука до останнього трекованого
  presentation frame; не переходить випадково в fullscreen.
* На mobile має бути одна scroll axis і один handoff з основного scroll до
  document scroll; не допускаються nested scroll, teleport, jitter або зникнення
  файла до кінця.
* Кнопка **HOW** використовує той самий native scroll controller, що й swipe,
  і приводить до laptop/document anchor з короткою інерційною доводкою.
* `14.145`/інші frame numbers є конкретними timeline locks лише якщо вони
  записані в актуальному presentation contract; старий frame number не можна
  переносити в нову відеоверсію без перевірки.

## Audio

Autoplay зі звуком залежить від browser policy. На mobile звук вмикається після
першої дозволеної user gesture або явного persisted preference; UI не повинен
брехливо показувати «звук увімкнено», якщо браузер його заблокував. Плавний
fade-in/out і mute state є частиною presentation state.

## God View

God View — прихований операторський маршрут для тестової групи, який показує
всі saved looks/avatars усіх клієнтів, їхні сцени, shoots і videos зі статусом
та preview. Це не просто health/status page і не список одного активного look.
Доступ обмежується серверним auth/policy; повні user media не потрапляють у
публічний unauthenticated route.
