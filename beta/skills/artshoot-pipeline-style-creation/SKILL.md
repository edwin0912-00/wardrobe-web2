---
name: artshoot-pipeline-style-creation
description: >-
  Turn ONE real fashion photoshoot into a locked, reusable STYLE UNIT — a hash-bound set of
  reference sheets (person, environment, camera & lens, colour & grade, blocking) extracted from
  the actual frames, never invented. Use whenever a photoshoot, lookbook, editorial series or
  campaign is handed over as reference and its look must become selectable in a product ("pick
  one of five photoshoots"). Also use before generating any frame that claims to be "in the style
  of" a supplied shoot. This is the reverse of building a universe from a brief: here the universe
  already exists as photographs and must be read out of them.
---

# Shoot-Unit-Builder

**A photoshoot is ONE unit.** Location, mood, angles, colour, lens, light and posing are not
separate choices a user assembles — they were decided together by a photographer on a real day,
and they only look right together. So they are extracted together, approved together, and shipped
as one selectable thing.

This is the opposite of a background. A background is a place you stand in. A shoot unit is a
photographic authorship: the tilt of the camera, what the light does to skin, what is thrown out
of focus, how the body answers the lens. Losing that distinction produces stock photography with
extra steps.

Companions: `reference-sheet-builder` (sheet layout + house style + library anchors),
`create-universe` (sheet grammar, MASTER GAMMA gate, blocking rules, atmosphere),
`ai-media-preflight` (the gate order that sits above all of this).

## 0. THE ONE HARD RULE — extract, never invent

Every value on every sheet must be **observable in a named frame**. Write the frame it came from.

- Observable: "hard single source, roughly 30° above and 60° camera-left — read off the nose
  shadow falling to camera-right and the hard-edged cast shadow on the wall, frame 2"
- NOT observable, therefore forbidden: focal length in millimetres, aperture, film stock, the
  photographer's intent, the model's name, the brand of the garment
- Where a fact matters but cannot be read: write `UNKNOWN` and say what would settle it. A guessed
  number is worse than a blank, because everything downstream trusts the sheet.

Focal length is the classic trap. You cannot measure it, but you **can** measure its
consequences: how much the near limb enlarges, whether verticals converge, how compressed the
background is. Record the consequence, not a fabricated number.

**STOP** if you find yourself writing a value you cannot point at in a frame.

## 1. Rights and identity boundary

The supplied frames are **extraction-only**: they are read to produce original sheets, and they are
never attached to a generation and never reproduced. This mirrors the reference policy every
downstream pipeline already enforces (`external_images_are_extraction_only`).

The shoot's model is **not** part of the style. The style is the photography; the person who will
appear in the output is the product's own subject. So:

- The PERSON SHEET is a **template of what must be observed about whoever is photographed** — the
  facial geometry, ears, skin marks, how that skin takes this light. It is filled per subject.
- Never carry the reference model's identity, face, body or hair into a sheet. Recording "the light
  wraps the cheekbone and leaves a specular strip on the nose bridge" is style. Recording her
  jawline is identity theft.
- No brand marks, logos, readable text or recognisable architecture leaves the frames.

**STOP** if a sheet would let the reference model's face be reconstructed.

## 2. The five sheets of a shoot unit

One shoot yields exactly these seven, plus a master gamma. Fewer means the unit is incomplete; an
eighth means something belongs in one of the seven.

| Sheet | Locks | Aspect | Built with |
|---|---|---|---|
| **PERSON** | face geometry, ears, everything on the face, skin marks present and possible, skin tone, and how THAT skin behaves under THIS light | 2:3 | §3 |
| **EXPRESSION & GAZE** | gaze format, eyelid position, brow state, whether the cheekbones are engaged or at rest, mouth and jaw tension — the face's muscular state | 3:2 | §3a |
| **ENVIRONMENT** | where it is, surfaces, depth planes, what is behind and how far | 16:9 or 21:9 | `reference-sheet-builder/references/environment-{interior,exterior}.md` |
| **CAMERA & LENS** | camera height and tilt, perspective character, depth of field, flare, halation, grain, distortion | 16:9 | §4 |
| **COLOUR & GRADE** | the closed palette with hex and its exact count, contrast curve, split-tone, highlight and shadow behaviour | 16:9 | §5 |
| **GARMENT BEHAVIOUR** | what the cloth DOES — motion state, air interaction, drape, transparency under this light, edge quality, weight class | 3:2 | §4a |
| **BLOCKING & POSE** | body to camera, body to space, limb language, weight — mannequin plus top-down inset | 16:9, low/1k | `create-universe` §3a |

**MASTER GAMMA is a gate, not a panel.** One master palette per shoot, hex values read off the
frames. Every one of the seven sheets carries its own hex row derived from that master. A swatch
without a hex does not count. No hex row → the sheet is regenerated before approval.

**MOOD** is one written sentence plus one atmospheric hero crop taken from the approved sheets. It
is not a sheet, because once expression, light, colour and blocking are each locked, a mood that
still needs its own page has not been identified — it has been decorated.

## 3. PERSON SHEET template

The gap this fills: a character dossier describes a role — age, wardrobe, amplua. A person sheet
describes a **surface under a specific light**, which is what a generator actually needs to keep a
face alive and consistent in this shoot's conditions.

Required sections:

1. **FACE GEOMETRY** — skull and jaw shape, cheekbone height and projection, brow ridge, nose
   bridge/tip/nostril shape, philtrum, lip volume and corner direction, chin, hairline shape,
   neck-to-jaw transition. Continuous shapes are inferable across angles; record them.
2. **EARS** — set height relative to eye and nose line, protrusion, helix curl, lobe attached or
   free, piercings. Ears are the most-forgotten identity anchor and the fastest tell of a drift.
3. **EVERYTHING ON THE FACE** — brows (density, direction, gaps), lashes, eye colour and limbal
   ring, iris pattern, sclera tone, under-eye structure, glasses and their exact frame if worn.
4. **SKIN MARKS — PRESENT AND POSSIBLE** — moles, freckle fields and their density gradient,
   scars, texture (pore visibility, fine lines), asymmetries. Split this in two:
   *observed* (read off a frame) and *plausible* (consistent with the observed type but not
   visible, so a generator may render them without contradicting evidence). Never blur the two.
5. **SKIN TONE** — value range with hex, undertone, how it shifts between lit and shadowed side.
6. **HOW THIS SKIN TAKES THIS LIGHT** — the section that makes it a *shoot* sheet: specular
   behaviour (where highlights sit and how tight), subsurface warmth in transition zones, contrast
   of the shadow terminator, whether the light wraps or cuts, halation on the skin edge against
   the background, sweat/oil sheen. Read this off the frames of THIS shoot only.
7. **PROVENANCE** — which frames each section came from, and everything marked UNKNOWN.

Discrete surface facts (a mole, a piercing, a scar) must be **observed** — they cannot be
inferred. Continuous geometry (a jaw angle, a cheekbone) can be inferred across angles. Conflating
these two is what makes a person sheet either useless or dishonest.

## 4. CAMERA & LENS SHEET template

Record consequences, not equipment.

1. **CAMERA POSITION** — height relative to the subject (below knee / waist / chest / eye / above
   head), horizontal angle, and **roll**: is the horizon tilted, by roughly how much, which way.
   A Dutch angle is a decision, and it is the first thing lost in reproduction.
2. **PERSPECTIVE CHARACTER** — do verticals converge and how hard; how much the nearest body part
   enlarges relative to the far one; how compressed or separated the background reads. State the
   evidence.
3. **DEPTH OF FIELD** — what is sharp, what is not, where the plane of focus sits, how fast the
   falloff is, bokeh shape and its edge quality.
4. **FOREGROUND OCCLUSION** — whether something crosses the lens (a hand, fabric, a leaf, haze),
   how far out of focus it is, how much of the frame it eats. This is often the whole signature of
   an art frame and it is almost always dropped in reproduction.
5. **OPTICAL ARTEFACTS — THE UNIT'S CONSTANT, NOT A PER-FRAME CHOICE.** Flare (shape, direction,
   source), halation on highlights, bloom, soft blown highlights, chromatic fringing, vignette,
   grain size and distribution.
   These come from the glass and the stock, so they do not change between frames of one shoot.
   Separate what varies from what cannot:
   - **Varies per shot** — camera height, angle, roll, framing, depth of field, what is in focus.
     These are composition decisions a photographer makes shot to shot.
   - **Fixed for the whole unit** — the optical signature above. The lens does not become a
     different lens for frame four.
   Write the signature as a named, mandatory effect list with strengths, and apply it to EVERY
   frame the unit produces. A frame delivered without the unit's halation, bloom or grain is
   off-style even when its composition is perfect, and it will read as a different photographer.
   Where the unit's signature is *absence* — optically clean, no flare, no halation, fine grain —
   record that explicitly too, because "clean" is equally a lens decision and a frame that arrives
   glowing is just as wrong.
   **STOP** if the effect list is written as a suggestion rather than as a constant every frame
   carries.
6. **FRAME** — aspect, where the subject sits in it, headroom, how the crop cuts the body, and
   whether the cut is a deliberate composition or an accident of the frame edge.
7. **PROVENANCE** — frames, and UNKNOWNs.

## 3a. EXPRESSION & GAZE SHEET template

A mood is not a word, it is a set of muscles holding a position. Record the position, not the
adjective. "Confident" is unusable; "upper lids carried low, cheekbones at rest, mouth closed with
corners level" is reproducible.

1. **GAZE FORMAT** — where the eyes go relative to the lens: into it, past it, down through it,
   away from it, or withheld entirely (occluded by dark lenses, hair or a turn). Withheld is a
   legitimate and deliberate format — record it as such rather than as missing data.
2. **EYELIDS** — upper lid position on the iris (raised / neutral / low / heavy), whether it is
   symmetric, lower-lid tension, and how much sclera shows above and below the iris. Lid height is
   the single biggest carrier of editorial mood and the first thing a generator gets wrong.
3. **BROWS** — height relative to rest, inner-brow tension (the corrugator pull that reads as
   concern), arch position, asymmetry.
4. **CHEEKBONES / ZYGOMATIC** — engaged or at rest. This distinguishes a real smile from a held
   face. An engaged zygomatic lifts the cheek, narrows the eye and creases the lower lid; at rest
   the midface stays flat and the eye stays open. Never write "slight smile" without saying which.
5. **MOUTH** — closed or parted and by how much, corner direction, lip tension, philtrum
   flattening, whether the jaw is dropped or the lips are simply apart.
6. **JAW AND NECK** — jaw relaxed or clenched, masseter visible, chin raised / level / dropped,
   neck extension or shortening, sternocleidomastoid engaged by a turn.
7. **HEAD ORIENTATION** — pan, tilt and roll of the head separately from the body, because the
   difference between them is most of the attitude.
8. **RANGE ACROSS THE SHOOT** — if several frames exist, how the face moves between them and what
   stays fixed. The fixed part is the unit's expression signature.
9. **PROVENANCE** — frames per section, and UNKNOWN where a lens, hair or shadow hides the answer.

## 4a. GARMENT BEHAVIOUR SHEET template

**What transfers is what the cloth DOES, never what the cloth IS.** The design — print, cut,
colour, brand — belongs to whoever made it and is not part of any style unit. The behaviour is
photography: it is how the shoot's air, light and motion act on fabric, and it is applied to the
product's own approved item.

**STOP** if a behaviour sheet describes a pattern, a logo, a silhouette or a specific colourway.
That is someone else's garment leaking into a style.

1. **MOTION STATE** — still, settling, caught mid-motion, or driven. If driven, by what: the
   subject's own movement, wind, or a fan off-frame.
2. **AIR INTERACTION** — does the cloth trail, balloon, lift, ripple, or hang dead. How far it
   departs from the body, and in which direction relative to the light.
3. **DRAPE AND WEIGHT CLASS** — how the fabric falls at rest: fluid and clinging, structured and
   holding its own shape, stiff, or heavy and plumb. Read from the fold radius: tight small folds
   read light, broad slow folds read heavy.
4. **TRANSPARENCY UNDER THIS LIGHT** — opaque, translucent, or fully sheer, and specifically what
   the shoot's light does to it: backlight through sheer cloth glows and reveals the layer beneath;
   the same cloth frontlit reads solid. This is a property of the light-and-cloth pair, not of the
   cloth alone.
5. **EDGE QUALITY** — crisp hem, fraying, fluttering edge, rolled, or dissolved by motion blur.
6. **SURFACE RESPONSE** — sheen, matte, specular threads, how the weave takes a highlight.
7. **HOW IT TRANSFERS** — one explicit line per behaviour saying how it applies to an arbitrary
   approved item. "A heavy knit hoodie in this unit does not balloon; it lifts at the hem and holds
   a broad slow fold" is transferable. "Sheer organza sleeves" is not.
8. **PROVENANCE** — frames, and UNKNOWNs.

## 5. COLOUR & GRADE SHEET — the palette is a HARD, COUNTED LOCK

Colour count is what separates a photograph with a mood from a stock frame. A shoot that lives on
five colours stops being itself at eight, no matter how pretty the eighth is.

1. **DECLARE THE COUNT.** The palette is a CLOSED SET with an exact number, read off the frames.
   Write it as a number, e.g. `palette_size: 5`. Not "about five", not a range.
2. **EVERY ENTRY CARRIES A HEX AND A ROLE** — name, hex, and what it is for (deepest shadow, ground,
   key light, accent, brightest highlight). A swatch without a hex does not exist.
3. **NOTHING OUTSIDE THE SET MAY APPEAR.** Three exemptions, and only three:
   - the approved item's own colours, declared separately as `item_colours`, because the product's
     promise is that the item looks like itself;
   - human skin, hair and eyes, which belong to the subject and not to the palette;
   - the neutral value ramp between declared entries, since a gradient between two members is not
     a new colour.
   Anything else — a green plant in a warm-neutral unit, a blue sky in a terracotta unit, a stray
   saturated prop — is a FAIL, not a variation.
4. **STYLING COMPLETIONS OBEY THE SET.** When a frame needs a garment the approved look does not
   contain, its colour comes from the palette. This is where an eighth colour usually enters.
5. **GRADE BEHAVIOUR** — contrast curve shape, black level (crushed or lifted, with a value),
   highlight roll-off, split-tone direction, saturation relative to neutral.
6. **THE FAIL CONDITION IS COUNTABLE.** State it so a gate can run it: quantise the delivered frame,
   drop skin/hair/eyes and the declared item colours, and every remaining cluster above a stated
   area threshold must map to a palette member within a stated distance. Write both thresholds in
   the sheet so the check is reproducible rather than a matter of taste.

## 6. Method — one shoot at a time

1. **Look at every frame.** Actually read the images; do not work from a filename or a caption.
   Count them and say how many.
2. **Write the observation log first**, per frame, before any sheet: what is unambiguous, what is
   ambiguous, what is invisible. The sheets are then assembled from the log, so every value has a
   traceable origin.
3. **Reconcile across frames.** Where two frames disagree (different light, different lens), decide
   whether the shoot has one consistent look with variation, or whether you have been handed two
   shoots. Say which. Two shoots pretending to be one produce a style nobody can hit.
4. **Master gamma before the sheets** — pull the hex palette from the frames, because every sheet
   depends on it.
5. **Generate the five sheets** on a text-capable image model (labels must be legible; a photoreal
   model renders labels as mush). Blocking diagrams at low/1k; art sheets at medium/2k.
6. **Self-verify each sheet against §2 and its template** — sections all present, hex row present,
   no invented value, no reference-model identity. A missing section means regenerate, not "close
   enough".
7. **One approval per shoot**, presenting all five sheets together. The unit is what gets approved,
   because the unit is what ships.
8. **Bind the unit**: a manifest naming the shoot, listing each sheet with its sha256, the master
   gamma, the mood line, the source-frame ledger, and every UNKNOWN. Register anchors per the
   companion skill.

## 6. What makes a unit rejectable

- A value that cannot be pointed at in a frame.
- A sheet without its hex row from the master gamma.
- The reference model's identity anywhere in the output.
- A brand mark, readable text or recognisable building carried over.
- Camera roll, foreground occlusion or focus plane omitted — these are the style, and a unit
  without them is a background with a colour grade.
- "Five sheets" where one is a restatement of another.
- Frames from two different shoots merged into one unit.

## 6. ATTACHMENT ORDER — the first four slots decide the style

A model attends sharply to the first few attached references and progressively less after that. The
seven sheets are therefore **not equal at generation time**, and the order is not a preference — it
is what makes the difference between a frame in the style and a frame near it.

The rule that sets the order: **attach what text cannot carry; let text carry what it carries
exactly.**

| # | Attached | Why it must be an image |
|---|---|---|
| 1 | **CAMERA & LENS** | Nothing in prose reproduces a low tilted camera with a dissolved foreground mass. "Low angle, blurred foreground" is a category, not a frame. Camera height, roll, focus plane and the optical signature only survive as a picture. |
| 2 | **BLOCKING & POSE** | Pure geometry — body to lens, body to space, weight, the top-down plan. Described in words, the subject respawns somewhere else every shot. |
| 3 | **EXPRESSION & GAZE** | Lid height and an at-rest cheekbone are the whole mood, and they are exactly what a generator invents when it only reads adjectives. |
| 4 | **GARMENT BEHAVIOUR** | Cloth in air is motion. A still image of cloth caught at the same moment transfers what "billowing" never will. |

The remaining three travel as **structured text**, and are better off for it:

| Sheet | Carried as | Why text wins |
|---|---|---|
| **COLOUR & GRADE** | the hex set, the declared `palette_size`, and the grade rules in the prompt | Hex is exact. A swatch panel in an image is an approximation of a number we already have, and its labels bleed into the frame. |
| **ENVIRONMENT** | the compiled facts | The environment is invented per frame by design — attaching a plate tells the model to reconstruct a preview, which contradicts the originality rule and trips the near-copy gate. |
| **PERSON** | the approved look master, which is the product's own subject | Identity never comes from the style unit. The person sheet is the template for reading the product's subject, not a face to copy. |

**Deprioritised in the attachment order is not deprioritised as a rule.** The palette stays a hard
counted lock with a countable fail condition (§5). It moves down the queue precisely because it is
the one property that loses nothing in translation — and moving it down buys an image slot for
geometry, which loses everything.

Budget reality: a generation already carries the approved look and the item cutouts, and an
editorial series adds the hero continuity anchor. So there are rarely more than three or four free
image slots. That is exactly why the order above is fixed and why anything below position four must
be able to survive as text.

## 6a. Automation — the gate, made runnable

Prose gates get skipped under pressure. `scripts/build-unit.mjs` is the same rules as code: it
refuses a unit **before** spending a single generation, then builds all seven sheets and binds them.

```bash
OPENROUTER_API_KEY=$(cat <keyfile>) node scripts/build-unit.mjs <unit-dir>
```

`<unit-dir>/unit.json` declares the unit: `unit_id`, `palette` with hex and role per entry,
`palette_size` as a number, `source_frames`, `unknowns`, and a prompt per sheet. Output is
`sheet-<id>.png` ×7 plus `manifest.json` carrying a sha256 per sheet and one `unit_sha256` over all
of them, so a later frame cannot claim this unit while a sheet has been swapped underneath it.

**What it refuses, before any call:**

| STOP | Why it exists |
|---|---|
| fewer or more than the seven sheets | an eighth sheet means something belongs inside another; a missing one means the unit is not a unit |
| a palette entry without `#RRGGBB` | a swatch without a hex does not exist, and the palette is what carries the mood |
| `palette_size` absent or disagreeing with the palette | the count is the lock; "about five" is not a lock |
| a sheet prompt naming no palette hex | the master-gamma gate — every sheet carries its own hex row from the master |
| a thin sheet prompt | a thin prompt produces a decorative sheet that passes inspection and locks nothing |
| no `source_frames` | provenance is the whole difference between extraction and invention |
| no `unknowns` array, even empty | an absent list means nobody looked for what the photographs cannot show |

It also requests the aspect in the API call rather than in prose, because both routed image models
ignore a prose aspect and return a square, which then has to be faked back into shape.

**The script cannot judge taste, and does not pretend to.** It never marks a unit approved. It
prints `NOT APPROVED` and stops, because sections present is a different question from sections
correct: only §6 step 6 read by a pair of eyes catches a lettered fact that no frame contains.

## 6b. Rules earned from the first unit

Four defects survived the first build of `shoot.skylight_haze`. Each is now a rule, because each
would otherwise recur on every unit forever.

### RULE 1 — a generative model may never be asked to reproduce an exact value it was handed

Measured on the first colour sheet: the printed hex was correct and the painted swatch was not.
Median of a 21×21 patch at each swatch centre against its declared value —

| declared | painted | distance |
|---|---|---|
| `#EAF0F2` | `#E6EEEF` | 5 |
| `#EFE0CE` | `#EEDAC0` | 15 |
| `#E8B79A` | `#DEA786` | 27 |
| `#C98A78` | `#BE7C67` | 25 |
| `#6F7355` | `#5E5F45` | 31 |
| `#3B4630` | `#0A0E0F` | 81 |

The model prints the string faithfully and paints something darker and more saturated. This is not a
prompt failure and regenerating does not fix it.

**TRIGGER** — any sheet element whose value is already known exactly: a palette swatch, a hex, a
measured percentage, a scale bar, a numeric table.
**CHECK** — is that element being *drawn by the model* or *rendered deterministically*?
**STOP** — if the model is drawing it. Render it locally instead and treat the rendered artefact as
the authority. `scripts/build-unit.mjs` emits `palette-strip.svg` with the exact declared values for
this reason; the swatch row on the generated sheet is a human-readable approximation and nothing may
sample colour from it.

The manifest hex is the sole colour authority. This is also why colour sits at position 5 of the
attachment order (§6): had the colour sheet been attached as one of the first four images, every
frame in the unit would have run 31 units dark and nothing would have reported it.

### RULE 2 — a sheet may not carry metadata nobody supplied

The first colour sheet printed `V1.0` and `DATE 25.05.20`. Both invented, on a board whose entire
premise is that no value is invented. Harmless here, indistinguishable from a real revision later.

**TRIGGER** — writing any sheet prompt.
**CHECK** — does the prompt explicitly forbid version numbers, dates, board codes, client names,
photographer credits, frame counts and file names that were not supplied?
**STOP** — no explicit negative, no generation. And on self-verify, read the rendered sheet for
invented metadata; a sheet carrying a fabricated revision is regenerated, because a canon that
lies about its own provenance cannot be audited.

### RULE 3 — two panels claiming different viewpoints must be verifiably different

The first environment board's "REVERSE ANGLE" is very nearly the hero angle again. The sheet
therefore claims coverage it does not have, and a generator asked to extend the world gets one view
told to it twice.

**TRIGGER** — any sheet with two or more panels naming distinct viewpoints, states or moments.
**CHECK** — state the required difference numerically in the prompt (a reverse angle is at least
120° from the hero; a second state differs in a named, visible way), then confirm on the rendered
sheet that the difference is actually there.
**STOP** — panels that read the same. Coverage claimed and not delivered is worse than a board with
one honest panel, because only the first kind gets trusted.

### RULE 4 — a pose is a chain of joints, never a name

The first blocking sketch reads as hands-behind-head. The prompt said "both arms raised overhead,
elbows out", which is a label with several valid readings, and the model picked one.

**TRIGGER** — describing any pose, in a blocking sketch or a prompt.
**CHECK** — is the limb chain given as joints and directions — where the upper arm points, where the
elbow bends and toward what, where the wrist sits relative to a landmark, which way the palm faces —
or is it a named pose?
**STOP** — a named pose with no joint chain. "Arms raised" is a category; "upper arm vertical beside
the ear, forearm angled up and outward, wrist above the crown, palms forward" is a position. The same
applies to the head: pan, tilt and roll separately, never "looking up".

### RULE 5 — a whole-frame property is applied, never requested

Camera roll was written into the prompt, into the blocking diagram and into the camera board. The
model returned a level horizon every time. Asked three ways, ignored three times.

Roll is not a thing the subject does; it is a thing the camera is. Same family as aspect ratio and
delivery size: a geometric property of the whole frame, already known exactly, and therefore not
something to ask a generative model for.

**TRIGGER** — the unit declares any whole-frame geometry: roll, aspect, delivered size, a mirror.
**CHECK** — is it being asked for in a prompt, or applied deterministically after generation?
**STOP** — if it is in the prompt. Move it to `scripts/apply-frame-geometry.mjs`.

The generation prompt's only job here is to **leave margin**: say explicitly that no limb, hand or the
crown of the head may touch a frame edge, because the rotation eats the corners and the crop that
removes them must not cost a hand. Generate square or wider, rotate, crop to the delivery aspect.
Every pixel delivered is then the provider's own, turned — nothing invented, nothing padded.

### RULE 6 — one large face beats a grid of six for transferring an expression

The expression sheet was attached as an image and the expression still did not transfer: the model
returned open eyes, raised brows and a half smile against a sheet that says low lids, brows at rest
and cheekbones at rest.

The sheet is right; the delivery was wrong. Six head-and-shoulders panels on one board leave each face
a few hundred pixels tall, which is not enough to carry eyelid height — the single most load-bearing
detail of an editorial expression. Cropping ONE panel to a large single face and attaching that fixed
it in one attempt.

**TRIGGER** — attaching expression to a generation.
**CHECK** — is the reference one large face, or a grid?
**STOP** — a grid. Crop the panel that matches the frame's intended expression and attach that.

The grid remains correct as the approval artefact and as the record of the shoot's range. It is the
wrong shape for a reference. This is the same clean-anchor-versus-dense-board split the companion
skill found for identity, arriving from the other direction: for *identity* the multi-view board won,
for a *single expression* the large single crop wins.

State the muscle positions as negatives too, because the model's prior is a pleasant face: not
lifted, not arched, no cheek lift, no crease under the lower lid, corners never turned up.

### RULE 7 — optical degradation is a tool limit, not a prompt problem

Veiling flare, halation and bloom were moved to the first paragraph, named as the subject of the
exposure, and closed with "if the frame looks clean and crisp, it is wrong". The result improved and
still fell short: bloom and halation arrived, the heavy veiling wash over the upper third did not.

A photoreal model is trained toward a clean, well-exposed frame. Asking it to degrade its own output
works partially and stops. Do not spend attempts hoping for the rest.

**TRIGGER** — the unit's optical signature is load-bearing rather than incidental.
**CHECK** — did the delivered frame actually carry it? Measure, do not eyeball: local contrast in the
region the wash should occupy, against the same region of an unflared frame.
**STOP** — if it did not. Finish the signature in post as a declared, recorded step, exactly as roll
is. A signature that only sometimes arrives is not a signature.

Record which half came from the model and which from post. A frame whose look was half applied
afterwards is honest; a frame that claims the camera did it is not.

### RULE 8 — a person reference carries a person and nothing else: cut out, on white

Measured 2026-07-27 on the video block. A fifteen-second reel was generated from someone else's
reference video with our own avatar, and half the shots relocated to a garden with a swimming pool
that appears in no prompt and in no video reference. The refpack held six references: the reference
video, four cut-outs on white, and one delivered scene frame of our avatar standing in that garden.
That single frame was the only thing in the entire pack carrying a full environment, and it was
enough to split the film between two locations.

This is not a new principle. The codebase already has a `REFERENCE_ROLE_ISOLATION` gate, and an
identity reference that also carries a location is exactly a role violation — it is two references
wearing one file. The generator cannot be told which half to read.

**TRIGGER** — any reference whose role is identity, body, garment or expression.
**CHECK** — open it. Is there a background? Is there ground, sky, furniture, foliage, a wall, a
recognisable interior, a reflection, a cast shadow falling on a visible surface?
**STOP** — if yes. Cut the subject out onto flat white before it goes in the pack. Two acceptable
sources: a matted look sheet, or a crop tight enough that no environment survives inside the frame.

The environment gets its own reference with its own role, and the two must never travel in one image.
Where the target environment is deliberately the anchor's own — a continuity anchor inside a single
shoot, at the same location — that is an environment reference doing its job, not an exception to
this rule; label it as such and do not also call it the identity reference.

A close relative, same day and same cause: what a reference does not resolve, it cannot hold. Our
avatar's shoes occupied about 150 soft pixels in a full-length frame while the reference video showed
a stranger's sandal at 700 sharp pixels, and one shot came back with the stranger's bare leg and
sandal. Full length is necessary and not sufficient. Every close shot the delivery may ask for needs
its own detail reference at that scale — footwear, hem, cuff, fabric — and the honest source is a
real crop of the approved item, never a prettier one the model invented.

## 6d. Where this sits in the product

A shoot unit is not a background and must not be built on one. Concretely: a style whose identity
is a `std.*` background preset plus a description is a background with extra words — that mistake
shipped once already, and it is what made five "styles" read as stock.

- **Backgrounds** are their own block: pick a place, stand in it, get several angles.
- **Shoot units** are their own block: pick a photoshoot, and location, mood, angles, colour, lens,
  cloth behaviour and expression arrive together because they were decided together.
The two blocks share the generator and the approved look. They share nothing else.

## 7. Self-test — maintenance harness, not runtime instructions

Update this table in the same edit as any rule change, or it drifts. A rule passes only if,
executed honestly, it would have stopped the failure.

| # | Failure that actually happened | Caught by | How |
|---|---|---|---|
| 1 | Five "styles" turned out to be five stock backgrounds with descriptions; each editorial mode was literally built on a `std.*` background preset, so style and place were the same field | §0, §2 | A shoot unit is extracted from real frames and carries camera, colour, blocking and person sheets; a background carries none of them |
| 2 | A mode's "style" was expressed as `environment` + `lighting` + `palette` — i.e. as a place — so picking a style picked a location | §2 | Camera & lens and blocking are separate mandatory sheets; a unit missing them is rejectable |
| 3 | Location boards shipped with material swatches but no hex, thinning the palette canon silently | §2 master gamma gate | Hex row on every sheet or regenerate |
| 4 | Blocking diagrams were lettered "BODY 3/4 TO LENS" for slots whose spec declares no body rotation — an invented fact that read as canon | §0 | Every value names the frame it was observed in; unobservable means UNKNOWN |
| 5 | A person sheet demanded forensic certainty for facts a photo cannot show, so it returned NEEDS_INPUT on a perfectly good portrait | §3 | Continuous geometry is inferable; only discrete surface facts must be observed, and the two are recorded separately |
| 6 | A generator reproduced a subject's pose and place but lost the low angle and the blurred foreground hand — the two things that made the frame art | §4 items 1 and 4 | Camera roll and foreground occlusion are mandatory fields |

### RULE 9 — coverage is a contract, and every frame in it has a person in it

Two errors on 2026-07-27, both caught by the operator rather than by a gate, both from generating a
shoot without reading what the product actually asks for.

**First error: one framing repeated six times — mine, by hand, not the pipeline's.** Six styles were
generated outside the product and every single frame was the same shot: full length, centred, camera at
chest height, only the wallpaper changing. That is not a shoot, it is six pieces of wallpaper. Cause:
the delivery lock ("full body, both shoes, clear headroom") was written into every hand-authored prompt,
which flattened the camera character out of six shoots that each had their own.

Checked afterwards, and worth recording because the assumption was wrong: **the product does not have
this defect.** Its per-slot prompt already carries a distinct focal length (50/50/65/55/85/35), a
distinct camera height, its own angle sentence, its own pose sentence, and the subject-height band read
straight from that slot's lock. Only the crop token is shared across five slots, and a comment at the
site explains why — `full_length` made the generator invent a lower garment and shoes the approved look
never contained, ITEM_FIDELITY correctly refused to verify invented items, and the first slot became
unpassable and blocked the rest. So the flattening there is a documented workaround for a real gate
conflict, not laziness, and it is removable only once footwear is a locked item.

The lesson is therefore the opposite of the first instinct: when a hand run and the pipeline disagree
about coverage, check which one is wrong before "fixing" the pipeline. Framing is read from the shoot —
a monumental low angle up a ribbed wall, a low angle through converging trunks, a rooftop wide, a bag
detail — and the pipeline is already asking for that per slot.

**Second error: a detail frame with no human in it — also mine, and also already covered upstream.**
The product's detail slot declares `head: false`. That means *the head need not be visible*. It does not
mean the person is absent. A crop of cloth with no body is a product shot, and this product sells a
person wearing the item. The pipeline already asks for exactly that: the slot's pose directive reads
"detail-led crop with anatomically plausible hand or body context". The flat lay happened because the
prompt was hand-authored and that directive was simply not carried over. The framing lock alone would
not have caught it — no slot requires a visible body part — so when authoring a detail frame outside the
bible, keep a wrist, a neckline, a hand or a shoulder in it and say which one.

**The six slots and their real locks**, read from `editorialFramingLock` on 2026-07-27 rather than
assumed. `subject` is the subject's share of frame height in per cent; `above` is the minimum headroom.

| slot | subject | above | head | footwear |
|---|---|---|---|---|
| `clean_identity_hero` | 50–94 | 6 | required | not required |
| `environmental_hero` | 40–95 | 5 | required | not required |
| `sculptural_three_quarter` | 50–95 | 5 | required | not required |
| `interference_frame` | 45–96 | 4 | required | not required |
| `material_or_accessory_detail` | 45–100 | 0 | **not required** | not required |
| `wide_campaign_coda` | 30–92 | 8 | required | not required |

Consequences worth stating, because each one bit:

- **There is no tight face close-up slot.** Five slots need the head visible AND the subject between
  40 and 96 per cent; a collarbone-up crop is effectively 100 and would be rejected. A beautiful face
  frame is not deliverable coverage, however good it looks.
- **`wide_campaign_coda` bottoms out at 30 per cent.** A figure smaller than that fails, so "tiny
  figure in a vast room" has a floor.
- **Footwear is `false` in every one of the six.** Nothing in the coverage contract ever requires shoes
  to be shown, which is exactly how a video generation borrowed a stranger's sandal — see RULE 8.

**TRIGGER** — generating a coverage set, or writing a prompt per slot.
**CHECK** — name the slot, quote its lock, and say where the framing came from in the source shoot.
For the detail slot, name which piece of the body is in frame.
**STOP** — if two slots would deliver the same composition, or if any frame contains no person, or if
the intended framing is not inside its slot's subject range.
