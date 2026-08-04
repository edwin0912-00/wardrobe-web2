# ZEELY — Scene Canon v0.1

Статус: draft for visual approval.

## Головне рішення

Зовнішній кадр є лише role-limited source inspiration. Він не передається в production generation як джерело людини, одягу, брендів або точної архітектури. Release asset створюється окремо, отримує SHA-256, provenance і version.

```text
2+ licensed source inspirations
→ structural extraction
→ EnvironmentSpec
→ original mood card
→ human approval
→ empty environment plate + lighting preview
→ leakage / scene QA
→ versioned reference pack
→ scene generation from locked approved look
→ identity + items + scene + lighting + anatomy QA
→ approved scene
```

## Рівні asset-ів

1. `source_inspiration` — зовнішній кадр тільки для extraction.
2. `mood_card` — наша fashion-візуалізація напряму; може містити нейтральну тестову модель.
3. `environment_plate` — наш порожній простір без людей, тексту, логотипів і випадкових props.
4. `lighting_preview` — наш тест світла на нейтральній моделі; не має authority над identity чи одягом.
5. `production_scene` — approved look у вибраному просторі.

## Reference roles

- `look_master` — єдине джерело identity, тіла, волосся, одягу й продуктів.
- `environment_anchor` — тільки геометрія, матеріали й простір.
- `lighting_anchor` — напрямок, hardness, contrast, shadow shape і temperature.
- `composition_anchor` — camera height, lens, crop, vanishing lines і footprint людини.
- `palette_anchor` — тільки середовище і grade; не змінює skin tone або кольори речей.
- `negative_reference` — тільки те, чого не повинно бути.

## Global framing lock

```yaml
aspect_ratio: 4:5
camera_equivalent_default: 50mm
allowed_lens_range: 45-70mm
subject_height_target: 74-78%
subject_height_hard_range: 72-80%
measurement_basis: final 1024x1280 delivery
subject_bbox: topmost visible hair pixel → lowest visible footwear pixel
subject_height_formula: bbox_height_px / 1280 * 100
clear_space_above_hair_min: 8%
clear_space_below_footwear_min: 2%
vertical_error_max: 1.5deg
wide_angle: forbidden
head_crop: forbidden
foot_crop: forbidden
```

Для Edwin-карт діє той самий спосіб вимірювання, але діапазон залежить від visual system: `organic_contrast` 66–70%, `urban_monochrome` 62–70%, `institutional_modernism` 64–72%, `luminous_blue_white` 68–72%. Це прибирає неоднозначність між source canvas і фінальним 4:5 crop.

`Gloss` означає polished magazine grade, контрольований highlight roll-off, точний колір і чисту матеріальність. Це не HDR, не bloom і не smoothing шкіри.

## Launch map: 5 сімейств × 2 варіанти

| ID | UI name | Environment | Light / grade | Camera | Hard negatives |
|---|---|---|---|---|---|
| `std.city.early_morning_gloss` | Місто — ранковий глянець | Тиха нова європейська вулиця з limestone і одним vanishing point | cool dawn fill + вузький теплий side/back edge | 50 mm, eye level | люди, авто, бренди, текст, landmarks, мокрий pavement |
| `std.city.golden_hour_gloss` | Місто — золота година | Стримана stone arcade / street, відмінна від source geometry | low golden side/back sun + cool sky fill | 50 mm | orange/teal, cafe clutter, flare на face/product |
| `std.studio.peach_soft_gloss` | Студія — персиковий софт | dusty-peach seamless cyclorama | великий softbox 35–45°, weak front fill, floor bounce | 65 mm | neon/coral, props, visible paper edge, peach recolor одягу |
| `std.studio.white_window_honeycomb` | Студія — віконне соте світло | optical-white cyclorama | ранкове hard light через geometric lattice на стіну й частково обличчя + cool fill | 65 mm | pattern через очі/лого, prison bars, blown white |
| `std.studio.taupe_rembrandt_gloss` | Драматична студія — Рембрандт | dark taupe seamless | warm high key 45°, controlled fill, weak rim, cheek triangle | 65–70 mm | split light, blacked-out eye, smoke, theatre props |
| `std.studio.charcoal_dawn_rim` | Драматична студія — графітовий світанок | graphite curved wall | cool dawn side/top ambience + pale-gold rim/shaft | 65–70 mm | neon, sci-fi, dense fog, silhouette without item detail |
| `std.interior.gallery_morning_gloss` | Галерея — ранкове світло | off-white plaster, travertine/light oak, one large window | long soft early-morning side light | 50 mm, straight verticals | furniture clutter, artwork/text, blown windows |
| `std.interior.loft_golden_hour_gloss` | Лофт — золота година | controlled plaster/wood/stone loft | low golden beams + natural cool ambient fill | 50 mm | grime, pipes, boho props, orange cast on items |
| `std.nature_architecture.stone_terrace_morning` | Кам’яна тераса — ранкове світло | pale limestone, restrained dry grass, minimal sage | cool morning sky + warm side edge | 50 mm | park/forest/flowers, tourist cues, garden furniture |
| `std.nature_architecture.concrete_grass_golden_hour` | Бетон і трави — золота година | clean concrete/stone platform, ornamental dry grasses | low golden side/back light | 50 mm, low angle ≤5° | highway cues, wild meadow, strong flare, item occlusion |

## Standard source authorities

Stock sources are extraction inputs, not final deliverables:

- City: `https://www.pexels.com/photo/empty-european-street-with-classic-architecture-33276833/`, `https://www.pexels.com/photo/empty-urban-street-with-traditional-architecture-36673650/`
- Light studio: `https://www.pexels.com/photo/woman-in-pink-cardigan-7506932/`, `https://www.pexels.com/photo/a-woman-in-red-long-sleeve-dress-14001742/`
- Dramatic studio: `https://unsplash.com/photos/a-woman-is-posing-for-a-picture-in-a-dark-room-_d0Uv9sIEmY`, `https://www.pexels.com/photo/stylish-woman-in-dramatic-studio-lighting-32497260/`
- Interior: `https://www.pexels.com/photo/minimalist-empty-modern-interior-with-high-windows-30699852/`, `https://www.pexels.com/photo/interior-of-an-empty-industrial-room-18132317/`
- Nature × architecture: `https://www.pexels.com/photo/scenic-garden-pathway-at-sunset-35133173/`, `https://www.pexels.com/photo/man-taking-a-picture-of-ornamental-grass-under-an-elevated-road-17191701/`

Technical authorities:

- Rembrandt light: `https://www.profoto.com/us/en/still-photography/tips-tricks/how-to-create-rembrandt-light`
- Fashion framing/light: `https://www.canon.co.nz/get-inspired/fashion-photography-101-essential-tips`
- Environmental portraiture: `https://www.nikonusa.com/p/environmental-portraiture-featuring-joey-terrill/18483/overview`

## Edwin editorial namespace

Standard presets never silently inherit this program.

| ID | Visual system | Sources |
|---|---|---|
| `editorial.edwin_novak.organic_contrast` | deep green/off-white/mustard; foliage, water, dappled or low backlight | `/alaska`, `/kraybag` |
| `editorial.edwin_novak.urban_monochrome` | rooftop/concrete/facade grids; B&W, grain, negative space | `/bw`, `/naked` |
| `editorial.edwin_novak.institutional_modernism` | olive/cream/black; symmetry, repeated modules, ceremonial stillness | `/zayn` |
| `editorial.edwin_novak.luminous_blue_white` | blue sky, white translucent textile, grass/flowers, warm hard sun | `/liza` |

Editorial shot sequence:

```text
clean identity hero
→ environmental hero
→ sculptural 3/4
→ one interference frame
→ material/accessory detail
→ wide campaign coda
```

Exactly one optical device is allowed in an experimental frame: mirror/reflection, translucent textile, foreground vegetation, hard shadow geometry, partial architectural occlusion, or water. Clean hero uses none.

## Hard QA gates

1. Approved white look hash is immutable; retries run only at scene stage.
2. External subjects have zero identity/body/outfit authority.
3. All approved items are present; visible construction, colors, logos and text remain faithful.
4. Required scene checklist is complete and forbidden objects count is zero.
5. Light direction, contact shadow and environment scale are physically coherent.
6. Full-body slots contain complete head and footwear; no anatomy defects.
7. Honeycomb pattern cannot cover eyes or critical product/logo zones.
8. No readable invented text, brands or near-copy of a source composition.
9. Every released asset records SHA-256, prompt, model, model version, source ledger and approval.
10. Aesthetic score cannot override identity or item-fidelity failure.

## Studio expansion queue

After launch validation:

- pearl-grey skylight with soft cool dawn;
- warm-ivory cyclorama with one hard sun stripe;
- pale-blue studio with clean north-light gradient;
- butter-yellow set with restrained direct-flash gloss;
- translucent linen window with moving early-morning shadow;
- mirror-steel floor with soft peach overhead light.

These are new preset versions, not free-form prompt additions.
