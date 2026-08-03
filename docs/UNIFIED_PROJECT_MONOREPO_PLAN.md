# Unified Wardrobe project — recorded migration plan

Status: **owner-approved architecture proposal; not yet executed.**

This file records the intended future source of truth. It does not change the
current live sites, branches, deploy routes, runtime data, credentials, or
provider configuration.

## The problem it solves

Wardrobe currently has two independently versioned product systems:

1. The cinematic main-site repository, which renders the client-facing journey.
2. The beta repository, which contains both the beta site and the generation,
   QA, API, and media engine.

Independent branch histories make it too easy for a working change in one
system to be absent from a release or for the two systems to be paired without
a durable record. A root release state must therefore name both exact sources
and prove their compatibility.

## Verified source snapshot at the time of this record

| Product unit | Existing repository | Exact source branch / commit | Public role |
| --- | --- | --- | --- |
| Main site | `edwin0912-00/wardrobe-web2` | `canonical-site-main` at `0f13d1e3f07faa3c88799fcd063238e3c6cfd877` | `madeforthisjob.com` and `site.madeforthisjob.com`, both entering `/b/` |
| Beta site + engine | `edwin0912-00/zeely-ai-engineering-test` | `beta` at `3defc900c8603282510d480e26bb7823e53c18f1` | `beta.madeforthisjob.com` and the same-origin API consumed by the main site |

The beta health endpoint reported the exact `release_sha`
`3defc900c8603282510d480e26bb7823e53c18f1` when this plan was recorded.
The main-site source branch above is deliberately `canonical-site-main`, not
the older branch named `main` in its existing repository.

## Target repository shape

Create one new GitHub repository with one canonical `main` branch:

```text
wardrobe/
├── main-site/                 # complete current cinematic main-site source
├── beta/                      # complete current beta source, kept path-compatible
│   ├── web/public/            # beta site — an explicit user-facing deployable
│   ├── src/                   # beta engine / generation / QA / API
│   ├── tools/
│   └── docs/
├── ops/                       # deploy and runtime templates; never credentials
├── release/
│   ├── RELEASE.lock.json      # exact source SHA pair, URLs and compatibility proof
│   └── verify-release.mjs     # root verification of both systems together
├── AGENTS.md                  # entrypoint for every future agent
└── README.md
```

`beta/web/public` is explicitly the **beta site**. It must not be silently
called or treated as only an engine. The beta source remains one path-compatible
unit during the first import because the site and engine currently share
runtime paths, tests, static assets, and service assumptions.

## Deliberate decisions

- Use a new repository and one canonical `main` branch for the compatible
  whole-product state.
- Import both existing repositories with Git subtree provenance at their exact
  approved commits. Do not flatten them into untraceable copied files.
- Do **not** use submodules: a clone must contain the actual runnable source,
  not two independently moving pointers.
- Preserve the old repositories as immutable history and recovery sources.
- Do **not** physically split `beta/web/public` and `beta/src` in the first
  migration. A later, tested refactor may do that only after the unified
  release is reproducible.
- Do **not** duplicate live contracts into a new second source of truth.
  Initially, `RELEASE.lock.json` records the contract paths and SHA values;
  contract extraction may happen later with tests.
- Future work starts from this unified `main` on a short feature branch, then
  returns through a verified merge. `main` stays the complete compatible state.

## What the unified repository must include

- Main-site code, assets, measured screen calibration, laptop presentation,
  UI tests, and deploy scripts.
- Beta-site code (`beta/web/public`), beta engine (`beta/src`), API routes,
  providers, QA, migration/schema files, tools, tests, and static product
  assets.
- Create Universe style packs, reference sheets, manifests, hashes and all
  non-secret files required to validate them.
- Release verification, domain/deploy templates, health/smoke scripts, agent
  coordination rules, and recovery documentation.

## What must never enter Git

- API keys, authentication cookies, OAuth sessions, `.env` values, or runtime
  credentials.
- Client photos, generated client media, live profile databases, raw logs with
  personal data, and runtime cache/output directories.
- `node_modules`, build caches, swap data, or machine-specific application
  state.

Those belong in separately access-controlled runtime backups. The unified
repository contains schema, migration and recovery instructions, not private
customer material.

## Release lock requirements

`release/RELEASE.lock.json` must at minimum record:

```json
{
  "main_site": {
    "source_repository": "edwin0912-00/wardrobe-web2",
    "source_commit": "0f13d1e3f07faa3c88799fcd063238e3c6cfd877",
    "deploy_target": "madeforthisjob.com"
  },
  "beta_site": {
    "source_repository": "edwin0912-00/zeely-ai-engineering-test",
    "source_commit": "3defc900c8603282510d480e26bb7823e53c18f1",
    "source_path": "beta/web/public",
    "deploy_target": "beta.madeforthisjob.com"
  },
  "beta_engine": {
    "source_repository": "edwin0912-00/zeely-ai-engineering-test",
    "source_commit": "3defc900c8603282510d480e26bb7823e53c18f1",
    "source_path": "beta/src"
  }
}
```

The JSON is an example of the required fields, not a file to create until the
new repository exists. The final lock also records contract and asset hashes,
test evidence, and the release date.

## Safe migration sequence

1. Create the new repository without touching either live deploy.
2. Import the exact main-site and beta commits as two Git subtrees.
3. Add the root lock, operational templates, agent entrypoint and a combined
   verification script.
4. Run the existing main-site tests and beta tests from their preserved paths.
5. Verify the public main site, beta site and beta API against the locked SHA
   values. No deployment is part of the import.
6. Commit and tag the resulting single `main` as the first unified recovery
   point (for example `alpha-0.01`).
7. Only after owner approval, make the unified repository the release source
   for future coordinated changes.

## Acceptance criteria

The migration is complete only when a fresh clone of the new repository can:

1. identify the exact main-site, beta-site and beta-engine sources;
2. run their respective test suites from the imported paths;
3. verify shared contracts and product assets by hash;
4. explain both deploy targets without exposing secrets; and
5. restore the entire source-level product state from one branch/tag.

Until these are met, the current independent repositories and their existing
deploy paths remain authoritative and must not be removed or redirected.
