# Canonical fabric-world identity lock

The selected experience is the direct `b/` journey, and its first room is the
approved **D** master. The letters `b/` and `D` describe different things:

- `b/` is the historical route for the selected fabric-world site;
- **D** is the selected `seg1.mp4` camera master inside that route.

The first room must show this sequence in one continuous 60fps shot:

```text
fabric handover → room assembles → objects appear → rails / clothes appear → two mirrors
```

It must not end on a bare wall, door or pillar. Those are the rejected A/B/C
and pre-D candidates.

`test/canonical-d-identity.test.mjs` is the deploy identity check. It pins the
approved local file by SHA-256 and byte size, verifies the dated cache key and
verifies that the old `?s1=` candidate switch cannot return. Run it together
with the other preflight checks:

```sh
node --test test/canonical-d-identity.test.mjs test/engine-stations.test.mjs test/zeely-client.test.mjs
```

If the owner explicitly selects a new first-room master in the future, do not
silently overwrite `b/assets/seg1.mp4`. In one reviewable commit:

1. replace the master and regenerate its motion table and seam validation;
2. set a new dated cache key in `b/index.html`;
3. update the SHA-256 and size in the identity test;
4. record the replacement rationale and verify the canonical domain before
   copying it to `WardrobeRuntime/`.

This makes the selected visual source reproducible while preserving the normal
preflight → reviewed main → canonical-domain deployment flow.
