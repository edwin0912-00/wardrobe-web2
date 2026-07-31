# Main-site adapter

`adapters/zeely-client.mjs` is the presentation-neutral browser client for the
Wardrobe product engine. It is intentionally not imported by the current
cinematic runtime yet: the incoming Claude Code visual source remains the
visual source of truth, and wiring is a separate reviewed change.

## Boundary

```text
any active site bundle
        │
        └── createZeelyClient({ apiBase: '/api' })
                         │
              same-origin /api/* contract
                         │
                   Zeely beta engine
```

No hostname, DOM node, CSS class, scroll position, localStorage key, or
provider credential is part of the client. A site may use it from the apex
domain, a future replacement site, or a test origin by injecting `apiBase`.

For production, the active visual site and the API must remain same-origin:

```text
madeforthisjob.com/*      active presentation bundle
madeforthisjob.com/api/*  reverse proxy to the Zeely Fastify engine
```

This preserves the beta engine's host-only `__Host-` profile cookie,
`SameSite=Strict` mutation rule, SSE credentials, and private media policy.
Do not call `beta.madeforthisjob.com/api` from a different visual hostname.

## API surface

The adapter maps the currently public beta routes for:

- profile and saved looks;
- server draft, multipart uploads, core runs and garment choices;
- `std.*` scenes/backgrounds;
- editorial Fashion Shoot, Bible and hero approvals;
- Fashion Video capability, creation, finalization and playback URL;
- Live Look capability, public pipeline description and scoped realtime token;
- SSE for core runs, scenes and editorial shoots, with bounded durable-status
  reconciliation when a browser drops or misses a terminal event. Fashion Video
  remains polling-only because the current video contract deliberately exposes
  no SSE route. `NEEDS_RETRY` is treated as a terminal backend decision so the
  presentation can show recovery instead of leaving an attention orb running.

For server-draft finalization the adapter creates a UUID v4 (the backend uses
that UUID as the persisted run id). Header idempotency keys for scenes and
shoots are generated separately. A host that lacks `crypto.randomUUID()` must
inject `createFinalizationKey`; this avoids silently submitting a key the API
will reject.

It emits a normalized phase (`idle`, `uploading`, `running`, `needs_input`,
`waiting_for_approval`, `recovering`, `completed`, `failed`) so an attention
station may decide whether scrolling is released without re-implementing
backend status vocabulary.

On startup the bridge reads `/api/profile` and restores the newest saved look as
the command context. `useSavedLook(lookId)` switches that context when the
presentation selects another card. This is server-backed: the cinematic UI does
not persist generated images or profile state in `localStorage`, so a browser
reload keeps the same “Мої образи” library through beta's `__Host-zeely_profile`
cookie. Profile records retain beta's private same-origin image URLs and are
never replaced with uploaded local photos.

## Wiring later

The cinematic entrypoint will do only this:

```js
import { createZeelyClient } from '/adapters/zeely-client.mjs';

const zeely = createZeelyClient({ apiBase: '/api' });
zeely.subscribe((state) => mirrorUi.render(state));
```

The scroll engine remains responsible only for camera time and station locks.
It never creates jobs directly. The adapter is responsible only for product
commands, server state and events.

`startLiveLook()` requires explicit `privacyConsent`, `costAcknowledged`, and
the server's Live capability. It forwards the enabled app and allowed duration
only when that capability provides them; there is no client-side 15- or
40-second default. It obtains a short-lived realtime token; it does not request
camera permission, initiate WebRTC or record media. Those remain visible UI
actions in the selected mirror surface.

## Check

```bash
node --test test/zeely-client.test.mjs
```
