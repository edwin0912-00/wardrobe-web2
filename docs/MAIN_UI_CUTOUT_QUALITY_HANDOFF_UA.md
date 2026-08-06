# Main UI: якісний foreground без фону

**Статус:** handoff для команди `site.madeforthisjob.com`; не реалізовано в
beta і не є зміною beta pipeline.

## Спостережений дефект

У main UI готовий образ виглядає як low-resolution preview, з якого вже в
браузері прибирають білий фон. Це дає зубчастий край, білий halo навколо
людини та втрачену фактуру тканини. Preview не може бути джерелом для
сегментації або alpha-mask.

## Обов'язковий порядок

```text
immutable approved master (оригінальні байти, повна роздільність)
→ один native-resolution alpha/cutout
→ зберегти immutable transparent foreground
→ тільки потім створити display preview / poster
→ UI компонує preview foreground поверх свого фону
```

Заборонено:

```text
preview WebP/JPEG
→ browser canvas / remove-white
→ foreground для результатного екрана
```

## Мінімальний контракт артефактів

| Роль | Вимога |
| --- | --- |
| `MASTER` | Точні approved image bytes, ніколи не preview URL. |
| `CUTOUT_NATIVE` | PNG/WebP з alpha з `MASTER` у native resolution; SHA та source SHA збережені. |
| `CUTOUT_PREVIEW` | Лише похідний display asset з `CUTOUT_NATIVE`; не втрачає alpha. |
| `CARD_PREVIEW` | Дозволений для списків/швидкого UI, але ніколи не input для mask/cutout. |

## Приймання

1. Відкрити готовий образ із темним UI-фоном та світлим одягом/взуттям.
2. Edge має походити з `CUTOUT_NATIVE`, без білого fringe або видимої
   пікселізації.
3. Network/receipt доводить: `CUTOUT_PREVIEW.source_sha256` дорівнює SHA
   `CUTOUT_NATIVE`, а не SHA preview/master thumbnail.
4. Після reload той самий saved look показує той самий foreground; UI не
   запускає нову сегментацію в browser.
5. Якщо `CUTOUT_NATIVE` відсутній, UI не підміняє його маскою з preview:
   показує approved master як є або контрольований loading/error state.

## Межа відповідальності

- Це виправляється в main UI/service (`site.madeforthisjob.com`), не в beta.
- Не змінювати image-generation QA, approved look чи beta media route, щоб
  компенсувати main display defect.
- Після реалізації потрібні desktop + mobile visual proof і один reload proof.
