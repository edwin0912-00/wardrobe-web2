# Observation — `shoot.hardsun_street_monochrome`

## Source and method

All fifteen supplied source files were opened at original resolution and compared as a portfolio set. The collection is not one photoshoot: it mixes a rooftop fashion pair, a water beauty portrait, a site card, hard-sun street observations, architecture studies, an Eiffel Tower frame, an overcast architectural portrait and a street frame dominated by a third-party bus advertisement. The requested street subset was isolated before any runtime contract was considered.

No useful EXIF camera, lens or exposure fields are present. `frame-05.jpg` has a misleading extension: its actual container is PNG.

## Frame ledger

| Frame | SHA-256 | Type and size | Direct visual observation | Reconciliation |
| --- | --- | --- | --- | --- |
| `frame-01.jpg` | `8160830712aa6999d9614f88a8a457ec95c218fee47bdd837c7edf8c366323a2` | JPEG, 2048×1357 | Grainy landscape rooftop portrait of a short-haired person in a sheer patterned dress. Arms arc around the head; the city horizon is rolled and shallow. Light is soft/flat rather than hard street sun. | Exclude: rooftop pair. |
| `frame-02.jpg` | `a4190be86ea8950bf2532d189112d17c2af200aa6d26cdf1a802725c7add5739` | JPEG, 2048×1357 | Wide full-length view of the same rooftop person and dress, barefoot at a parapet with city skyline. Leveler framing and garment state connect it to frame 01 only. | Exclude: rooftop pair. |
| `frame-03.jpg` | `e336e72d7602fea6dd1e28026489f239c447987f7d53ec4873393dcba260c749` | JPEG, 1365×2048 | Tight horizontal face floating at a water line with wet pale hair and pearl-like facial adornments. Smooth water reflection doubles the face. Person, place, lighting and optical device differ from every street frame. | Exclude: water portrait. |
| `frame-04.jpg` | `5ac31c6add54e260ad8a4d428a66690601cdc616470228079b3147d1baccb6ea` | JPEG, 2048×1357 | Landscape head-and-shoulders street portrait of a person in round sunglasses, turned three-quarter away while looking back. Hard sun cuts the forehead, cheek and pale shoulder; background cars, buildings and pedestrians are shallow and strongly separated. | Retain as the only deliberate hard-sun street portrait. |
| `frame-05.jpg` | `677f8af2388ca3a66925f0a1a4071fcb8d61b7b64c0644f545c5aca372148172` | PNG, 2048×1092 | White graphic field with small rotated text `/ lines`; no photograph and no person. | Exclude: site card. |
| `frame-06.jpg` | `1ae8caaa55417c12d0728789ba5ad4ba0967fc72353fa6bc041b486af3dc90d3` | JPEG, 2048×1357 | Low hard-sun plaza action frame. An extreme near skateboarder crosses the upper/central foreground, the board blurs near the ground and multiple unrelated pedestrians fill the middle and rear planes. Sharp cast shadow sits on bright pavement. | Retain only as candidate street/action evidence; not a recurring fashion subject. |
| `frame-07.jpg` | `de7dac82c04657af68791ac8425b8a3640f7a404ea67b5ca9a6cf77e1b957246` | JPEG, 1820×1149 | Compressed, crowded sloped market street under hard daylight. Scores of unrelated people, awnings and readable shop context fill the frame; an out-of-focus head and hand dominate the lower foreground. | Retain only as candidate crowded-street environment evidence. |
| `frame-08.jpg` | `c143804311bcaedb44bd6c809d21a74d08f0c3a64070553e9baac2e4d297369b` | JPEG, 2048×1357 | Architecture-only diagonal facade with repeating horizontal/vertical panel grid. No person. | Exclude: architecture study. |
| `frame-09.jpg` | `31b4ac3796ecc5a0fcd9a53d787aae5290af022826fa58f77961c7c5b8755c71` | JPEG, 2048×1357 | Architecture-only facade with repeating deep window frames. No person. | Exclude: architecture study. |
| `frame-10.jpg` | `b1516318740d01691ff72b88beed5bf0f9bdfd6154e01c53de050860eb126b6d` | JPEG, 2048×1357 | Architecture-only oblique reflective wall with dark crossing braces. No person. | Exclude: architecture study. |
| `frame-11.jpg` | `7055a4b4c014e00b752660744b0e14e5d2b807f7c57c581d1beb561887fcf783` | JPEG, 2048×1357 | Shop-window reflection layers multiple unrelated pedestrians, interior darkness, a bright torso and readable French text. Reflection is the load-bearing optical fact; no single person or approved look anchors the image. | Retain only as candidate street-interference evidence. |
| `frame-12.jpg` | `615db062efd14722b64af0deb6f5f34ad2ea174e73292f1209f7396018c85943` | JPEG, 1357×2048 | Vertical night/late-light Eiffel Tower study with no person. High landmark specificity and different lighting. | Exclude: Eiffel/architecture. |
| `frame-13.jpg` | `cac4feb1faabbcc88470133f0f1bef7af74e31bfd71da5f604a3489438643d1e` | JPEG, 1357×2048 | Vertical full-length fashion portrait of a different person at a large ribbed/concrete institutional wall. Light is soft and overcast, garment volume is winter-heavy, and the environment is isolated rather than a hard-sun street. | Exclude: unrelated fashion portrait. |
| `frame-14.jpg` | `54f282729892afcaa7d6f2e9afb3ecf8c79b0ba0c38fedf748145e14b146b5dd` | JPEG, 2048×1357 | Camera points downward at unrelated pedestrians walking on bright pavement. Crops remove every face; legs, footwear and hard human/tree shadows make the composition. | Retain only as candidate street-shadow/lower-body evidence. |
| `frame-15.jpg` | `59c6d888a2ed2b3f8a4020b97bd24859ef4d204d53ed57933969c1cc9c801f47` | JPEG, 2048×1357 | Street view of a cyclist and buses, dominated by a large third-party fashion advertisement with a recognizable photographed person and readable `LONGCHAMP PARIS` brand. | Exclude: third-party identity, product and brand leakage. |

## Candidate street subset

The only plausible requested subset is:

`frame-04.jpg frame-06.jpg frame-07.jpg frame-11.jpg frame-14.jpg`

It does share monochrome rendering, visible grain/scan texture, hard daylight in most frames, deep blacks and bright pavement or white fields. It does **not** prove one fashion shoot:

- there is no recurring person, garment, approved item, location or continuous blocking system;
- `frame-04.jpg` is the only deliberate portrait and the only clean face;
- `frame-06.jpg`, `frame-07.jpg` and `frame-14.jpg` are candid public-space observations of unrelated people;
- `frame-11.jpg` is a shop-window reflection with readable text and no stable subject;
- framing ranges from shallow portrait to near-field action, compressed market crowd, reflected layers and a downward feet/shadow crop;
- no retained frame provides a connected fashion material/accessory detail;
- no retained frame provides a sculptural three-quarter fashion pose;
- no retained frame proves a clean wide campaign coda with one approved person and look.

## Six-slot fail-closed audit

| Canonical slot | Real retained evidence | Verdict |
| --- | --- | --- |
| `clean_identity_hero` | `frame-04.jpg` has a readable face, but sunglasses hide the eyes and the crop does not prove a complete look. | Partial only. |
| `environmental_hero` | `frame-06.jpg` or `frame-07.jpg` establishes hard-sun public space but neither centers a recurring approved fashion subject. | Partial only. |
| `sculptural_three_quarter` | No retained source frame. `frame-13.jpg` would supply a pose but is a different overcast architectural shoot and is excluded. | Missing. |
| `interference_frame` | `frame-11.jpg` proves a reflective-glass device but not a controlled approved person or protected identity/item evidence. | Partial only. |
| `material_or_accessory_detail` | No retained connected hand/material fashion detail exists. | Missing. |
| `wide_campaign_coda` | Crowded street frames exist, but no single recurring full fashion subject and look anchors them. | Missing. |

The set therefore cannot support six unique source-derived camera/pose/focus/foreground directions. Creating a complete `runtime_style` or seven sheet prompts would require inventing missing poses, item behavior, expression continuity and environment continuity. The correct unit state is `BLOCKED_SOURCE`.

## Candidate gamma measurement

The five retained candidate street files were appended, reduced to eight percent, converted to grey and quantized with ImageMagick. Four recurring levels remained:

- `#181818` — deepest street black;
- `#5D5D5D` — shadow grey;
- `#A3A3A3` — film mid grey;
- `#E2E2E2` — sun paper.

This is a candidate measured grayscale gamma, not approval of a Creative Universe. Skin, hair, eyes and approved item colours would remain exempt in a future complete unit.

## Required additional source

Provide original frames from one intentional hard-sun monochrome street fashion shoot with the same person and look across:

1. clean visible-face identity coverage;
2. environmental full figure;
3. sculptural three-quarter;
4. one real controlled foreground/reflection interference frame;
5. connected hand and approved material/accessory detail;
6. wide campaign coda.

Until then there are no honest seven sheet images to bind, no fixed optical signature across six directions and no unit-level approval.
