# Zeely production scene brief

## Product hierarchy

```text
anonymous browser profile
└── avatar
    └── approved white-background look (immutable master)
        ├── standard production scenes
        └── editorial shoot projects
            ├── ShootBible
            └── six independent shots
```

An already approved avatar or look is never regenerated because a scene or
editorial shot fails.

## Standard launch layer

- Five scene families, with one explicitly selected launch winner per family.
- Every winner has an original empty `environment_plate`, a separate
  `lighting_preview`, a versioned reference pack and an auditable source/rights
  ledger.
- Runtime receives an exact saved-look receipt plus one exact preset version.
- Environment, light, camera and pose may change. Identity, body, hair, all
  approved items, visible construction, colors, graphics, logos and text are
  locked.
- Output is vertical 4:5 with complete head and footwear.

## Required standard families

1. City.
2. Light studio.
3. Dramatic studio.
4. Modern interior.
5. Nature × architecture.

## Production scene gates

1. Exact approved master-look hash and PASS receipt.
2. Reference-role isolation.
3. Near-copy and source leakage.
4. Identity fidelity.
5. Every approved item, construction detail, graphic, logo and text.
6. Exact selected scene.
7. Physically coherent light and contact shadow.
8. Framing and anatomy.
9. Complete provenance and approval.

Every gate is blocking. A retry replaces only the failed scene candidate.

## Editorial layer

The four Edwin visual systems remain separate from standard presets:

1. organic contrast;
2. urban monochrome;
3. institutional modernism;
4. luminous blue-white.

Each shoot first produces a structured ShootBible. The generated sequence is:

1. clean identity hero;
2. environmental hero;
3. sculptural three-quarter;
4. one interference frame;
5. material or accessory detail;
6. wide campaign coda.

The clean hero passes identity and item QA first. The other five shots may then
run with concurrency `2`. One failed shot is retried independently.

## Runtime requirements

- Separate persisted `SceneService`; no hardcoded bonus scene inside core.
- Idempotent create/retry, checkpoints, restart recovery and truthful events.
- Profile relations from exact look to scenes and shoot projects.
- API and UI for select/start/status/retry/cancel/approve/delete/download.
- Page reload does not lose an active job or completed result.
- Scene failures do not turn a completed avatar/look run into `FAILED`.
- Exact 4:5 delivery contract. Providers use native 4:5 when supported;
  GPT Image 2 uses an approved safe 3:4 source plus deterministic hash-bound
  4:5 crop and blocking post-crop framing QA.

## Proof standard

- Strict schemas and release validators.
- Full automated tests.
- Browser E2E on desktop and iPhone viewport.
- Per-asset and per-shot exact-hash visual matrices.
- No release claim based only on aggregate counts.
- No `PENDING`, `SKIPPED`, moving model alias or missing lineage in a final
  release receipt.
