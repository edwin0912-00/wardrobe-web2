# ZEELY Visual Canon

Статус: нормативний visual/interaction reference для Zeely presentation layer і progress UI.

Primary reference: [Thinking orbs — Jakub Antalik & Alex Brinza](https://orbs.jakubantalik.com/). Перевірено 2026-07-22 на desktop `1440×900` і mobile `390×844`. Пакет `thinking-orbs@0.1.1` має MIT license, але є React-only; поточна vanilla HTML5 beta використовує власний Canvas renderer із тим самим interaction vocabulary без React runtime.

## Що саме беремо

1. Активний AI-процес показується як жива система точок, а не generic spinner.
2. Візуальна форма має семантичний стан: `listening`, `searching`, `solving`, `working`, `composing`, `shaping`.
3. Orb живе в компактній pill-поверхні з великим радіусом, тонким inset-border, слабким внутрішнім світлом і високим контрастом.
4. Рух безперервний, спокійний, без різких flash/scale стрибків. Shape може трансформуватися, але центр і footprint залишаються стабільними.
5. Canvas поважає `prefers-reduced-motion`, зупиняється поза viewport/при hidden tab і обмежує DPR до `2`.
6. На mobile зберігаємо сенс і читабельність; не зменшуємо primary orb нижче `56px`, compact status може бути `20px`.

## Виміряні характеристики референсу

- Base background: `#070707`; surface: `rgba(217,217,217,.05)`; panel/code: `#121212`.
- Primary text: `#FBFBFB`; muted text: `rgba(251,251,251,.60)`.
- Large pill: `270×74px`; orb у ньому візуально `56×56px`; compact orb `20×20px`.
- Demo cards: desktop radius `30px`, gap `12px`; mobile radius `20px`, одна колонка.
- Primary renderer: seven `canvas` elements, 2D context, no WebGL/Three.js.
- Frame loop: `requestAnimationFrame`; canvas backing store uses `min(devicePixelRatio, 2)`.
- Accessibility: canvas має `role="img"` і state-specific `aria-label`; reduced-motion показує статичний кадр.

## ZEELY state mapping

| Pipeline stage | Orb state | Значення |
|---|---|---|
| Upload / receive input | `listening` | система приймає матеріал |
| Conditioning / extraction | `searching` | система знаходить докази identity, речей та environment |
| Avatar generation | `composing` | модель збирає базове зображення |
| QA / retries / outfit fidelity | `solving` | система перевіряє та виправляє |
| Optional Art Director scene | `working` | окремий creative pass |
| Export / package result | `shaping` | результат набуває фінальної форми |

## Де використовувати

- Core beta: progress pill, active timeline step, provider wait/retry.
- Final mirror scene: orb як restrained system-presence у дзеркальному UI, не як головний герой кадру.
- TV/video transition: короткий state morph лише під час переходу між approved still і video.
- Laptop/pipeline scene: compact orbs біля реальних job states.

## Де не використовувати

- Не накладати orb на generated avatar/outfit output.
- Не робити з orb декоративний background, який змагається з фото людини.
- Не копіювати повністю чорний demo-site як бренд Zeely: беремо motion grammar і material treatment, а палітра залишається Zeely.
- Не приховувати за анімацією реальні назви етапів, відсоток, error або `NEEDS_INPUT`.
- Не використовувати heavy Three.js для ефекту, який надійно працює у 2D Canvas.

## Acceptance checks

- Orb state змінюється лише від реального runner state.
- Progress percent і текст залишаються доступними без Canvas.
- При `prefers-reduced-motion: reduce` немає loop animation.
- Hidden/offscreen canvas не витрачає animation frames.
- Mobile не має horizontal overflow.
- Будь-який новий presentation component спочатку перевіряється на відповідність цьому файлу та `spec/ZEELY_CANON_UA.md`.
