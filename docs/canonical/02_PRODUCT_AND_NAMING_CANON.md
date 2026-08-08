# 02 — продуктова модель, назви і межі блоків

## Основна обіцянка

Wardrobe перетворює фото людини та її речей на перевірений `master look`, а
потім дає незалежні продовження цього образу. Один approved look є спільним
джерелом для різних результатів; фон не потрібен для Fashion Shoot, а Fashion
Shoot не потрібен для фону.

```text
identity + garments
        ↓
approved avatar + approved master look
        ├── standard background scene
        ├── Create Universe / Fashion Shoot
        ├── Fashion Video
        └── Real-time Look
```

## User-facing block names

| Блок | Що означає | Не плутати з |
|---|---|---|
| **Profile.01–03** | фото профілю, збережені аватари/образи, вибір активного look | generation provider |
| **Look.01–06** | identity, речі, conditioned references, avatar, outfit, approved master look і QA | окремий background або стиль |
| **Background.01–02** | вибір standard preset і створення одного фонового кадру | editorial/fashion shoot |
| **Create Universe.01–04** | каталог style pack, reference sheets, hero/серія/contact sheet | простий фон |
| **Fashion Shoot** | серія named shots за style pack; кожен slot має власний pose/framing/reference contract | Fashion Video |
| **Fashion Video** | рухома гілка за approved look і versioned video style/cut sheet | відео після готової background scene |
| **Scene Video** | проста відеогілка від готової background scene: focus on item або posing | reference-driven Fashion Video |
| **Real-time Look** | жива камера/preview через FAL token route; зміна look — лише явною дією | збережене MP4 |
| **God View** | операторський/тестовий перегляд усіх збережених клієнтських образів | звичайний profile list |
| **Presentation** | cinematic main-site layer, яка пояснює pipeline і показує активні результати | engineering beta UI |

Числа — це стабільні робочі імена блоків, а не обіцянка, що в продукті існує
рівно 13 етапів. Внутрішні `mode-id`, `preset-id`, `slot` і `job_set_type`
залишаються технічними полями; у UI вони мають мати коротке людське пояснення.

## Master look rules

1. Людина, вибрані речі, волосся, взуття, аксесуари та approved evidence
   фіксуються у receipt.
2. Якщо користувач дав лише обличчя або лише капелюх, це не помилка само по
   собі: система може створити candidate з model-chosen basic outfit, але такий
   candidate стає master look лише після явного user approval і повного lock.
3. Деталі, яких немає на вході, не видаються за «точно збережені». У receipt
   вони позначені `inferred` або `unknown`.
4. Нові downstream-блоки споживають immutable approved look, а не ephemeral
   output попередньої спроби.

## Beta і main

* **Beta** — engineering surface: видимі ноди, стани, QA, provider status,
  structured errors і діагностичні підказки.
* **Main/canonical** — cinematic surface: ті самі backend contracts, але з
  presentation/mirror UI, телевізором/ноутбуком і меншою кількістю внутрішніх
  термінів.
* Їх не можна називати різними pipeline. Це дві подачі одного alpha source та
  одного runtime contract.
