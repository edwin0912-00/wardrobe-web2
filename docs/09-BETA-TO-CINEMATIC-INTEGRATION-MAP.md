# Beta → cinematic site: integration map

Audited against `zeely-ai-engineering-test` `origin/beta` at `207194d`
(2026-07-31). This is a **contract and UI-placement map**, not a visual
replacement. The fabric-world source remains the approved presentation.

## The invariant

```text
madeforthisjob.com/*       any chosen presentation (today: fabric world)
madeforthisjob.com/api/*   the beta product engine, reverse-proxied same-origin
```

`adapters/zeely-client.mjs` is the only browser module that may know API
routes and backend status names. A presentation imports the client and renders
its own DOM. It never imports `web/public/app.js`, beta CSS, or beta's DOM
components.

This is what makes replacing the whole visual site possible: the domain and
the `/api` contract stay; the visual bundle can change independently.

## What was checked

The adapter covers every **customer product capability** currently exposed by
the beta API. Operational beta-only screens are intentionally excluded:

| Beta capability | Adapter operation(s) | Cinematic location / rule |
| --- | --- | --- |
| Profile and saved avatars/looks | `loadProfile`, `claimRun`, `saveRun`, delete methods, `avatarImageUrl`, `lookImageUrl` | Existing looks are selected in the left mirror; the active look renders only in the right mirror. |
| Upload a person and optional face detail | `loadDraft`, `updateDraft`, `uploadDraftFile`, `removeDraftFile`, `clearDraft` | Second logical stage: left mirror after the D camera settles. Do not request a full-body requirement; it is rejected canon. |
| Add garments and create a look | draft methods, `createRunFromDraft`, `createRunFromUploads`, `watchRun`, `selectGarments`, `retryRun` | Third logical stage: the same left mirror. A run that needs garment selection stays there; the right mirror carries the waiting orb. |
| Saved visual output | `runFileUrl`, `garmentPreviewUrl`, `visualAssetUrl` | Result becomes an eligible look only after the backend says it is ready; never use an input photo as a fake result. |
| Standard environment / background | presets, scene CRUD, `watchScene`, `sceneImageUrl` | Mirror action **«Змінити фон»**. Render its finished image in the right mirror. |
| Editorial Fashion Shoot | modes, shoot CRUD, Bible/contact-sheet, approvals, shot retry, `watchShoot`, shot URL | Mirror action **«Фотосесія»**. Approval is an attention state: camera travel remains locked until user decides. Finished images go to TV gallery. |
| Fashion Video | capability, style preview, create/load/finalize/delete, `watchVideo`, playback URL | Mirror action **«Фешн-відео»**. 9:16 stays in right mirror; 16:9 is shown in the TV gallery. Video uses polling because beta intentionally has no video SSE route. |
| Live Look | public pipeline, capability, `startLiveLook` | Mirror action **«Примірка»**. A calm explicit launch threshold opens camera only on tap; the server capability supplies any allowed duration internally. No provider, price, security or transport wording appears in the mirror. |

Not carried into the cinematic experience: beta PIN login, monitor/telemetry,
test pages, and engineering progress widgets. They are operational tooling,
not customer UI.

## Approved visual grammar — do not substitute beta UI

The visual source of truth is `LEVEL-DESIGN.md` + the selected fabric-world
implementation, not beta's dashboard.

- No people in cinematic footage; graphite / milk architecture and suspended
  ivory textile.
- One scroll-controlled, frame-accurate camera journey: textile → rails → two
  mirrors → television → laptop. It is not autoplay-first video and not a
  vertical list of images.
- Chrome stays minimal: wordmark, sound control, scroll cue. Product controls
  are translucent architectural objects that belong to the surface in the
  frame.
- Left mirror asks/chooses; right mirror shows the active result. Actions do
  not exist until an actual look exists.
- An attention stop has resistance and a deliberate exit gesture. It is not a
  fleeting card in raw scroll velocity.

## Exact window and state logic

| Place | Opens | Closes / next state |
| --- | --- | --- |
| Intro textile | No form | Scroll enters rails. Desktop loader includes the immediate selected-D handoff; iOS mounts D natively before reveal. TV/laptop media remains background work. |
| Empty/clothing rails | No form; the selected D assembly remains unobstructed | Scroll continues to the measured mirrors. |
| Left mirror | Person sheet → garment sheet → look chooser, background preset chooser, Fashion Shoot mode chooser, Fashion Video style chooser | Each logical stage fades in after the mirror stop. Selection stays in the same mirror—never a generic dashboard modal. |
| Right mirror | Pending state, finished look, scene image, shoot image/contact sheet, portrait video, or Live camera | Results can be dismissed back to the active look without losing selection. Live always stops the camera/WebRTC on exit. |
| TV | 16:9 finished shoot/video gallery | Selecting an item can return focus to its right-mirror detail; TV is not a pipeline gate. |
| Laptop | Live read-only timeline: selected look, source/selection, generated scene/shoot/video receipts and final explanation | End of journey; no duplicate mutating controls. |

### Scroll permissions

The adapter gives a normalized phase. The scroll director owns movement and
uses it as follows:

```text
idle / completed / failed      station may release after the user exits it
uploading / running            resist and hold; show progress in its surface
needs_input                    hold until an explicit selection is submitted
waiting_for_approval           hold until approve / cancel / back
recovering                     hold and offer retry
```

`failed` never silently advances. It exposes a retry, delete, or return action
at the same physical place.

## Mechanical integration sequence

1. Deploy one same-origin gateway for the current visual site and `/api`.
   Do not point the browser from one subdomain at another beta API host: beta
   deliberately enforces host-only cookies, same-origin mutation checks,
   protected media and credentialed SSE.
2. Import `ZeelyClient` at the cinematic composition root. Subscribe once;
   translate its normalized snapshot into a small presentation state store.
3. Replace only the simulated methods in `ui.js` with adapter commands. Keep
   CSS, typography, surfaces and scroll choreography owned by the cinematic
   site.
4. Use the **surface registry** in the scroll director: `leftMirror`,
   `rightMirror`, `tv`, `laptop`. Each entry owns
   video-frame coordinates, permitted capability, and attention-lock policy.
5. Keep one physical mirror station for the active D site. Person → garments
   → look are logical UI states inside that station; the engineʼs multi-station
   API remains available if a future master adds separately measured surfaces.
6. Bind TV/laptop only through `b/screen-calibration.json` on the final D
   media. TV is a measured aperture; laptop is a four-corner quad, so do not
   approximate it with a rectangle from another generation.
7. Run the contract smoke below against the same deployed beta revision, then
   run device QA on the canonical domain.

## Readiness result and remaining hard blockers

The API mapping is ready after this audit; Live Look's explicit acknowledgement
payload was added to the adapter as a result. It is **not truthful** to say
the whole cinematic site can be auto-wired today, because these presentation
pieces are intentionally still outstanding:

1. `ui.js` currently contains demo/local state and does not import the
   adapter.
2. The calibrated TV/laptop controller is wired; real TV media still comes
   from beta results, and the supplied laptop HTML plus reversible terminal
   scroll handoff remain outstanding.
3. The production gateway that maps active-domain `/api/*` to the beta engine
   needs a release-owner configuration and end-to-end authentication check.

These are bounded integration tasks, not a reason to change beta UI or to
redesign the fabric world.

## Contract smoke gate before connecting any visual UI

Run these after beta is deployed, from an authenticated same-origin browser
session. Do not use production personal images for a smoke.

- `health()` succeeds through `/api/health`.
- Profile/draft create, reload and clear preserve the same session.
- A test run can be watched via SSE and reaches a terminal normalized phase.
- A saved look lists its scene presets, scenes, editorial modes/shoots and
  video capability through the adapter without cross-origin/CORS errors.
- Scene and editorial updates arrive via SSE; video reaches terminal state via
  polling.
- Live capability returns its consent/cost requirements; a token request made
  without both acknowledgements gets the expected `409` rather than opening a
  session.
- Protected image/video URLs return only on the active same-origin session.

The static adapter tests are run with:

```bash
node --test test/zeely-client.test.mjs
```
