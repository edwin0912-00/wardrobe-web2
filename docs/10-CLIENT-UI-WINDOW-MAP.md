# Client UI window map — fabric world

Owner direction, 2026-07-31: the client experience is quiet, cinematic and
non-technical. It never exposes provider/model names, implementation terms,
security vocabulary, price, or operational diagnostics. Jobs are expressed as
visible progress in the world, not as a dashboard.

This extends the selected fabric-world canon; it does not replace it.

## Global rules

- Camera travel is controlled frame-by-frame by scroll. UI never becomes a
  vertical gallery that competes with that camera.
- Every UI element has a physical owner: rails, left mirror, right mirror, TV
  or laptop. No generic full-screen product dashboard.
- Attention stops apply resistance before arrival and a stronger intentional
  gesture to leave. A completed result never auto-throws the viewer past the
  surface that owns it.
- A job has one visual language: a translucent monochrome orb on the relevant
  glass surface and one human sentence. No spinners, percentages, provider
  logos, model names or cost wording.
- `prefers-reduced-motion` preserves all content/state changes with a simple
  opacity transition; it must not depend on orb motion or inertia to be usable.

## The windows, in camera order

| # | Camera place / swipe state | Window that can open | Content and primary action | Exit / lock rule |
| --- | --- | --- | --- | --- |
| 0 | **Textile intro** | None, except minimal sound control | Fabric breathing in the room, wordmark, small “scroll to move” cue. | First real gesture starts allowed sound and enters the rails. No product controls. |
| 1 | **Empty rails — first attention stop** | `Person sheet`, appearing on the **left mirror** after the camera settles | One main portrait input, optional face-detail input, quiet preview/removal state; primary action: **«Далі»**. The right mirror is the waiting surface. | Holds forward travel while the draft is incomplete/uploading. An input error stays here with a clear replace/remove choice. |
| 2 | **Garment rail — second attention stop** | `Things sheet`, appearing on the **left mirror** after the camera settles | Add garments, compact thumbnail tray, optional short outfit note; primary action: **«Зібрати образ»**. The right mirror shows the orb while the look is prepared. | Generation opens the right mirror in a waiting state and holds travel. If a selection is needed, this left-mirror sheet remains the choice surface. |
| 3 | **Approach to two mirrors** | No new sheet | The left mirror becomes legible first; the right mirror wakes only once an actual look job exists. | Camera settles at the mirrors; no auto-advance when the look completes. |
| 4A | **Left mirror — choose** | `Looks`, `Backgrounds`, `Shoot styles`, `Video styles` sheets | This mirror asks and selects. Only one sheet is open at once; all options are visual tiles with a single clear action. | Back returns to the selected look, never to a blank dashboard. A choice that starts work retains the mirror station. |
| 4B | **Right mirror — show** | `Look`, `result`, `waiting orb`, `Live mirror` | This mirror shows the selected look, a scene, portrait video, shoot result, or live camera. A finished result replaces the orb in exactly the same aperture; its actions appear there too. It never asks the user to choose a style. | Closing detail returns to current look. Leaving Live immediately stops camera/session. |
| 4C | **Right mirror — wait** | `Orb state` (not a dialog) | Transparent black/white orb, its light and density changing with progress; one line such as “Збираємо образ”, “Шукаємо світло”, “Знімаємо рух”. | The station holds while a user decision or job is active. Failure becomes a calm “Спробувати ще раз” / “Повернутися” choice at the same surface. |
| 4D | **Right mirror — Live** | `Live threshold`, then `camera frame` | Before camera permission: a minimal threshold: **«Відкрити дзеркало»**, an optional server-provided duration and a close control. On explicit tap the camera image grows continuously from the right-mirror rectangle to the full viewport; return reverses the same path. During live: only the image, subtle countdown ring and **«Закрити»**. | Camera/session begins only after explicit tap. Close, timeout, or loss of focus ends it immediately and restores the right-mirror look/action state. |
| 5 | **Television — gallery, not a step** | `Screen gallery`, clipped inside the measured TV rectangle | Finished 16:9 Fashion Video plays as a TV image. A Fashion Shoot is a five-image vertical contact strip, all five portraits visible side-by-side inside the horizontal television. | Never blocks the journey. Selecting an item opens it inside the same TV screen; it never becomes a floating card. |
| 6 | **Laptop — final record** | `Pipeline HTML`, first clipped inside the measured laptop rectangle | The supplied HTML page is laptop content, rendered by the same site bundle. As the camera nears fullscreen, camera scroll hands off continuously to page scroll; at full screen, the page owns scroll completely. | Reverse scroll performs the exact inverse handoff back into the camera journey. No iframe, duplicate route, or disconnected second page. |

## Mirror action map

The left mirror shows only actions valid for the selected completed look:

| Action | left mirror opens | right mirror shows | destination |
| --- | --- | --- | --- |
| **Змінити фон** | visual scene presets | orb → final scene | scene remains in right mirror |
| **Фотосесія** | visual shoot styles | orb → contact-sheet/selected frame | finished frames enter TV gallery |
| **Фешн-відео** | three verified style tiles | orb → portrait clip or completion | 9:16 stays in mirror; 16:9 enters TV |
| **Примірка** | minimal live threshold | camera/live frame | ends back at current look |

## Orb: waiting without technical language

The orb is a faint transparent sphere reflected inside the *right* mirror. It
uses black, white and the existing milk/graphite light only.

| Product state | Orb behaviour | Client copy |
| --- | --- | --- |
| Uploading | Fine grains gather inward | «Приймаємо матеріали» |
| Running look | Textile-like filament slowly wraps the centre | «Збираємо образ» |
| Needs a choice | Orb stops with one illuminated seam | «Оберіть речі» |
| Scene / shoot | Wider, slower halo; one frame fades in at the edge | «Шукаємо світло» / «Створюємо кадр» |
| Video | A thin horizontal scan moves through the orb | «Знімаємо рух» |
| Live connecting | Orb resolves into the camera frame aperture | «Відкриваємо дзеркало» |
| Failed | Orb disperses once, then rests | «Не вдалося завершити» + retry/back |

Do not fake numerical progress. The orb may advance only between known state
transitions. On slow work it breathes rather than pretending to be 83% done.

## Screen-surface modules

The TV and laptop are not containers placed over the movie. Each is a measured
rectangle in the source video and gets a dedicated surface module:

- `TvScreenSurface`: clips all contents to the measured bezel/screen mask.
  Fashion Video uses `object-fit: contain` inside that mask. Fashion Shoot uses
  a five-column portrait contact strip with fixed gutters and no cropped faces.
  Selecting media changes the content inside the same mask, never the camera
  layer around it.
- `LaptopScreenSurface`: mounts the supplied HTML as the screen itself—one DOM
  tree, no iframe. It begins transform/mask-bound to laptop geometry. Across a
  short approach range, its transform resolves to viewport coordinates and the
  scroll owner changes from film time to document progress. The mapping must be
  reversible so an upward swipe re-enters the exact camera frame.

Both modules wait for final frame measurement before code is wired. They use
one geometry source each; no duplicated CSS guesses or independently animated
overlays.

## 40-second Live direction — implementation boundary

The desired client experience is **up to 40 seconds**, with no model, price or
technical copy. This is a product requirement, not yet a shipped fact.

The audited beta revision currently enforces a 15-second session and verifies
that limit server-side. The cinematic site must not claim 40 seconds or send a
hard-coded 40 until a beta-owned task changes the server contract, its tests,
and the capability response together. Once beta reports the allowed duration,
the cinematic UI reads that capability and renders only neutral copy:

```text
«до 40 секунд»
```

The underlying acknowledgement remains an explicit tap, but no price or
provider vocabulary is shown to the client.

## Design review outcome (Dembrandt stages 3–5)

- **Layout:** this is a narrative spatial journey, not a dashboard. TV is a
  gallery and laptop a timeline; mirrors are master/detail by physical role.
- **Interaction:** a sheet always opens from the surface that owns the object;
  one primary action per surface; no nested generic modals.
- **Motion:** arrival has anticipation/resistance, results dissolve from the
  orb, and departures require intent. UI transitions use opacity/transform,
  not layout animation.

## Brainstorm: upgrades worth testing after the core wiring

1. **Material memory.** A selected garment leaves a faint thread in the orb;
   when the finished look appears, that thread resolves into the garment’s
   silhouette. It makes waiting feel causally connected without showing a
   progress dashboard.
2. **Mirror focus.** On a left-mirror choice, the right mirror softens by a
   few percent; when a result arrives, focus swaps. This communicates
   choose → see without a tutorial.
3. **TV wake.** When a widescreen result finishes, the TV emits one restrained
   reflection pulse. It invites a scroll forward but never hijacks the camera.
4. **Laptop residue.** Each completed action adds a single thin line to the
   laptop timeline in the background. The finale feels earned, while the
   laptop remains read-only.
5. **No-result honesty.** If a capability is unavailable, keep its action
   absent rather than displaying disabled technical copy. The current look
   remains useful and the environment stays calm.

## Integration prerequisites

The UI map can be wired only after: (1) beta publishes the 40-second Live
contract, (2) the cinematic engine has the three independent first-leg
stations, (3) final rail/TV/laptop surface rectangles are measured, and (4)
the active domain proxies `/api/*` same-origin to beta.
