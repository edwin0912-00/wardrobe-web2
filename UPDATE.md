# UPDATE — the noticeboard

**Branch `update`. Docs and reference assets only, cut from `main`, and it must stay that way** — no
source code, so it can never conflict with any lane and anyone can read it without pulling feature
work. Six agents work this repo across two machines with no shared context; this is where the shared
part lives.

Read this before starting. Then `AGENTS.md` on `integration` for the rules, `OWNERS.md` for who may
write where, and `QUEUE.md` for what is already claimed.

Last updated 2026-07-27 by the Claude session that built the style pipeline.

---

## What is on this branch, and why it matters

### 1. The style-unit pipeline — `skills/artshoot-pipeline-style-creation/`

**This is the most valuable thing produced on 2026-07-26.** It answers a question the product had
been getting wrong: what a "style" is.

A photoshoot is **one unit**. Location, mood, angles, colour, lens, cloth behaviour and expression
were decided together by a photographer on a real day, and they only look right together. You pick
one photoshoot, and all of it arrives.

That is the opposite of a background. A background is a place you stand in. Until this week every
"style" in this codebase was literally built on a stock background preset — `EDITORIAL_BASE_PRESETS`
mapped each editorial mode onto a `std.*` preset, and the mode itself was described with the fields
`environment`, `lighting`, `palette`. A style expressed as a place is a place. That is why five
"styles" read as stock photography: all five source ledgers are Pexels and Unsplash.

The skill reads a style out of the real frames and **refuses to invent**. Every value names the frame
it was read from; what a photograph cannot show is recorded `UNKNOWN` rather than guessed. Focal
length is the standard trap — you cannot measure it, so you record its consequences instead.

**Seven sheets per unit, in attachment order**, because a model attends sharply to the first few
references and less after that:

| slot | sheet | carried as | why |
|---|---|---|---|
| 1 | camera & lens | image | no prose reproduces a low tilted camera with a dissolved foreground |
| 2 | blocking & pose | image | pure geometry; described in words the subject respawns |
| 3 | expression & gaze | image | eyelid height and an at-rest cheekbone are the whole mood |
| 4 | garment behaviour | image | cloth in air is motion |
| 5 | colour & grade | text | hex is exact; a painted swatch is an approximation of a number we have |
| 6 | environment | text | the environment is invented per frame by design; attaching a plate tells the model to reconstruct a preview the contract forbids |
| 7 | person | the approved look | identity never comes from the style unit |

Colour sitting at 5 is **not** colour mattering less. The palette is a hard counted lock with a
countable fail condition. It moves down the queue precisely because it loses nothing in translation,
and moving it down buys an image slot for geometry, which loses everything.

`scripts/build-unit.mjs` is the gate made runnable. It **refuses before spending a single credit** if
there are not seven sheets, if a swatch has no hex, if `palette_size` disagrees with the palette, if a
sheet prompt names no hex from the master gamma, if there are no `source_frames`, or if the
`unknowns` list is missing. `--dry-run` runs every check without generating, so the gate never
depends on which transport happens to be alive.

`scripts/apply-frame-geometry.mjs` applies declared roll and crops to the exact delivery. It fails
loudly rather than shipping a frame with an empty corner.

### 2. Two built style units — `docs/style-units/`

- `shoot.skylight_haze` — camera below hip aimed steeply up, frame rolled, backlit through a glass
  roof, a third of the frame given to a dissolved foreground mass. Six colours. Heavy-lidded gaze,
  cheekbones at rest.
- `shoot.terracotta_hardlight` — one wall, one hard sun, a sharp diagonal cast shadow as the main
  graphic. Five colours. Back three-quarters with the head panned back to the lens. Optically clean,
  which is as much a decision as flare.

Each carries seven sheets, `unit.json` (the declaration), `manifest.json` (sha256 per sheet plus one
`unit_sha256` over all of them) and `palette-strip.svg`.

`OBSERVATION_LOGS.md` holds all **five** shoots read frame by frame — the two built above plus
`window_gobo_warm`, `grey_studio_stride` and `sky_dune_surreal`, ready to build.

### 3. `docs/MERGE_JUDGEMENT.md` — how to decide which version is final

Written because two agents fixed the same three problems independently on opposite sides of a fork one
day old. Eight conflicts, and **six of them needed both sides**. Assume combine rather than choose;
rank a live measurement above a test and a test above taste; record which side won and what the losing
side was protecting; and never let whoever resolved the conflicts also certify the result.

---

## Rules earned the hard way — read these before you generate anything

Each cost real attempts. They are in the skill in full; this is the short form.

1. **Never ask a generative model to reproduce an exact value you already handed it.** Measured: the
   printed hex was right and the painted swatch was not, drifting up to 31 units and 81 on one
   swatch. Render exact things locally. `palette-strip.svg` is the colour authority; nothing may
   sample a generated sheet.
2. **A sheet may not carry metadata nobody supplied.** The first colour board invented `V1.0` and a
   date, on a board whose whole premise is that nothing is invented.
3. **Two panels claiming different viewpoints must verifiably differ.** A "reverse angle" came back
   as the hero angle again, so the board claimed coverage it did not have.
4. **A pose is a chain of joints, never a name.** "Arms raised overhead" was rendered as hands behind
   the head. Say where the upper arm points, where the elbow bends, where the wrist sits, which way
   the palm faces.
5. **A whole-frame property is applied, never requested.** Camera roll was asked for in the prompt, in
   the blocking diagram and on the camera board, and came back level all three times. Roll, aspect and
   delivered size are geometry — do them deterministically after generation, and have the prompt only
   leave margin so the rotation does not cost a hand.
6. **One large face beats a grid of six for transferring an expression.** Six panels leave each face a
   few hundred pixels, which cannot carry eyelid height. Cropping one panel to a large single face
   fixed it in one attempt. The grid stays right as the approval artefact and is the wrong shape as a
   reference.
7. **Optical degradation is a tool limit, not a prompt problem.** Flare moved to the first paragraph
   and named as the subject of the exposure; bloom and halation arrived, the heavy veiling wash did
   not. Measure whether it arrived, and finish it in post as a declared step rather than spending
   attempts hoping.

Rules 5, 6 and 7 were written after unit 1 and **verified on unit 2**: its reverse angle is genuinely
a different viewpoint, its blocking carries a real joint chain, and no invented metadata appears
anywhere.

---

## Cost, because it turned out to matter

Sheets are generated on Magnific with `gpt-2`. The tier changes the price by a factor of 47:

| tier | credits | use for |
|---|---|---|
| `1k` / `low` | 15 | blocking diagrams and any schematic |
| `2k` / `medium` | 260 | boards with photographic studies and labels |
| `2k` / `high` | 700 | nothing — medium is legible |

Unit 2 cost about 2 000 credits. On `high` throughout it would have been near 10 000. Photographic
frames go through `imagen-nano-banana-2` (Nano Banana Pro) at 75 credits, and it is the model to use
for anything photoreal — `gpt-2` is for text, diagrams and layout.

---

## Provider state as of this writing — check before you plan around it

- **Magnific** — live, Premium+, about 2.7M credits. Unlimited is **not** active in an MCP session, so
  generations consume credits.
- **Codex CLI** — live, quota recovered. `ZEELY_VLM_PROVIDER=codex` and
  `ZEELY_GENERATION_PROVIDER=codex-imagegen-test` are both intact in the app.
- **OpenRouter** — **dead**. The key returns 401 "User not found". It worked at 17:36 on 2026-07-26
  and stopped by 19:00. Not our code.
- **Higgsfield** — **down**. `api.higgsfield.ai` returns 521 on every path, and the CLI has no stored
  credentials.
- **Magnific is not a provider inside the app.** It is an MCP tool for asset work. The app's image
  providers are higgsfield, codex-imagegen-test and openrouter. Writing a Magnific provider is the
  durable fix and is not done.

---

## Open, and waiting on Edwin

- Approve or reject the seven sheets of each built unit. The skill forbids using an unapproved unit,
  and that rule was written deliberately.
- Is a 6px top extension by copied edge rows acceptable, given the standing rule against faking a
  delivery? It is bounded, versioned and receipt-bound, but it adds pixels never photographed.
- Why is `std.studio.taupe_rembrandt_gloss` exempt from that 6px cap? A per-preset exemption is how a
  bound quietly becomes the norm.
- The remaining three style units need his own photoshoot frames. The five logged shoots are one frame
  each, which is enough to build a unit but leaves fields `UNKNOWN` that a series would close.

## How to update this board

Append, do not rewrite. Put the date and which session you are. Keep it to what another agent needs to
not repeat your work: what changed, what it cost, what broke, what is still open. This file is read
first and trusted, so a stale line here is worse than no line.

## 2026-07-27 · codex-main · coordination checkpoint

- **Canonical work queue:** the authoritative assignment board is `TASKS.json` at the exact
  `origin/integration/wardrobe-20260726` commit an agent fetched before starting. At this checkpoint
  that ref resolves to `e1ff773`. The earlier reference above to `QUEUE.md` is stale: that file is not
  present on the integration branch. Do not create a parallel queue or infer an assignment from chat.
- **Active lanes:** `CTRL-002` (durable coordination), `WARD-002` (standard-scene headroom),
  `STYLE-001` (style-unit extraction), `PROFILE-001` (saved-avatar lineage), `MONITOR-001`
  (sanitized diagnostics), and `SITE-002` (private contact-sheet manifest). `WARD-001` remains
  preserved but blocked; it is not an integration candidate.
- **Coordination status:** `CTRL-002` is not merged yet. Its status/heartbeat protocol must remain
  typed and privacy-safe; until it lands, use the assigned lane, `TASKS.json`, handoff, PR, and the
  read-only assignment watcher as the source of truth. A terminal watcher is not an autonomous agent
  and cannot make or merge a change.
- **Style assets:** `shoot.skylight_haze` and `shoot.terracotta_hardlight` are reference units only
  until Edwin approves their seven sheets. They must not be routed into product generation or used to
  reintroduce the old `EDITORIAL_BASE_PRESETS` background coupling.

Open: finish and independently review `CTRL-002`; then merge only compatible, evidenced lane slices.
No provider outage, credit balance, or unverified runtime observation is recorded here as current fact.
