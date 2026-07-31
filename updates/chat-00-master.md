# Chat 00 Master

## 2026-07-31 · beta current-sync audit

The safe release cut at `e7d175c77a1efd2b5552f83d027b259fe19c975b` was the
starting point for this sync, not an empty/old beta: it already contains the reconciled image aliases, HEIC/drop
upload path, 16 backgrounds, current Create Universe/Fashion Shoot catalog and
progress, God View, saved-look actions, and the current Fashion Video runtime
with hash-bound reference/audio/semantic QA. Several agent branches still say
`NOT_DEPLOYED` because they were written against an older baseline; merging
those trees wholesale would remove newer beta code. This was checked with
direct file diffs and patch-equivalence before integration.

The current compatible missing atom is now ported as `d5b6d05` from
`beta-block-1-needs-input-recovery-20260731`: headwear-only/incomplete outfit
`NEEDS_INPUT` is actionable in the UI and hides the retry that would resubmit
the same insufficient input. Focused `visible-copy` and profile-flow tests
pass; no QA gate was weakened. Candidate branch:
`integration/beta-current-sync-20260731`. The candidate was activated through
the official beta deploy script; public health and shell smoke returned PASS.
The exact active SHA is always taken from `/api/health.release_sha`, and the
release owner must keep it equal to the pushed beta head.

Explicitly held for separate current-beta ports: stale video-preview-resume
tree, legacy Live 40-second contract, and late video-salvage commits whose
patches overlap the already newer e7 video QA implementation. They are not
discarded; each needs a focused compatibility test before activation.

Agent ID: `chat-00-master`
Branch: `beta-release-master`
Role: permanent beta integration, version, deploy and rollback owner.

## 2026-08-01 · current-beta safe UI integration

The deployed source before this candidate is beta `7f7c271` (public health
confirmed). From `chat03/fashion-video-preview-delivery-20260731` I ported only
three current-beta-compatible UI atoms: completed results no longer auto-open
the technical execution graph, duplicate-item `NEEDS_INPUT` explains that one
item must be selected, and the UI displays the authoritative `/api/health`
release marker. The older branch was **not** merged wholesale: its video-route
rewrite removes current white-master, cut-sheet and persisted-finalization
guards, so that part remains held for a separate review.

Code: TESTED — focused web/video suites `201/201 PASS`,
`npm run verify:contracts PASS`, `npm run verify:canon PASS`, `git diff --check PASS`.
Beta: READY_FOR_BETA_DEPLOY — candidate based on `7f7c271`; public activation
must use the final pushed SHA.
Journey: NOT_RUN — no paid generation or browser journey was started by this
source integration.
weakened_checks: none.

## 2026-08-01 · Fashion Shoot structured-reference bound integration

Integrated the verified Claude handoff `dc67de6c860e7eb4da3cdf8a95b21a5835f3b49c`
on top of the current beta `7f7c271`. The live Fashion Shoot failure was before
provider submission: compiled `spatial_cues`, materials, palette, protected
regions and other facts exceeded the strict 240-character structured-reference
schema, so every slot exhausted retries with only a generic executor error.
`referenceAsset()` now bounds every fact at the single construction point and
truncates near the limit on a word boundary. A catalogue-wide regression walks
every runnable style, every slot and every JSON reference against the exact
production schema.

Code: TESTED — structured-reference + editorial/Create Universe suite `67/67`
PASS; `npm run verify:contracts` PASS; `npm run verify:canon` PASS; source
branch itself reported the pre-change bound test listing 90 oversized facts.
Beta: READY_FOR_BETA_DEPLOY — candidate SHA must be activated exactly after
push; no provider generation was spent.
Journey: NOT_RUN — release activation and public browser Fashion Shoot smoke
remain the next step.
weakened_checks: none; the strict schema remains enforced and only the
producer-side representation is bounded.

## 2026-07-31 · final activation

The beta head is now `2334c9d30bb387396bdb74945c347a194d2d19d3` (also pushed to
`origin/beta`). The official release is `beta-2334c9d`; its cache token is
`product-2334c9d3-4cd6bc4e2687`. Public health, editorial catalog, feature
markers, and the selected pipeline suite are green against this exact SHA.

The only code change after `d426384` is the E-Live preview repair: a local or
saved-look preview uses a revocable object URL instead of a canvas export. This
keeps presentation separate from camera/WebRTC and makes the existing
no-hidden-recording assertion truthful without weakening it.

Evidence: `245/245` selected tests PASS; strict product-release verification
PASS; public health 5/5 PASS; editorial catalog 19 total / 17 generation-ready
/ 15 `shoot.*`; live incomplete-look copy smoke PASS. `weakened_checks: none`.

## 2026-07-30

State: ACTIVE

Created the narrow release-master contract. Product blocks submit exact tested
SHAs; Chat 00 integrates and deploys them but writes no feature code. The
release checklist, handoff schema, stop rules and rollback evidence are defined
in `docs/coordination/blocks/00-release-master.md`.

Latest beta:

- code: `afa34d8fcc92026824e20fb98c7e5e9532a772a4`
- cache: `product-afa34d8f-8b3076d910e9`
- health: ready
- durable saved-look lifecycle: PASS on the previously failing look
- background catalog: 16; Fashion Shoot catalog: 19, generation-ready: 17
- LaunchAgent web and tunnel: running after internal control-path recovery
- weakened_checks: none

## 2026-07-31 · Safe beta release cut

- Preserved the actually running beta source as immutable remote branch
  `release/backup-beta-live-20260731-e04f04d` at `e04f04d` before changing
  `beta`. The remote `beta` ref was still `fc3c8b2` even though public health
  reported `e04f04d`; this was a source-of-truth drift, not a reason to
  rebuild or overwrite the live runtime.
- The release cut contains that verified live chain plus the clean Block 1
  provider-wait heartbeat (`f509263`). It records a minute-throttled public
  wait state without exposing provider identifiers or creating a duplicate job.
- Focused release evidence: provider, video and Fashion Shoot suites plus the
  heartbeat contract; strict contract validation. The pre-existing core
  `run-service` suite still has nine unrelated failing fixtures on both the
  `e04f04d` baseline and this cut, so it is not represented as green.
- Explicitly held outside this cut: Chat 01 drag/drop+HEIC,
  Chat 02 profile reports, Chat 04 mood/pose/slot-reference branches,
  Chat 05 legacy video branch, Chat 07 legacy Real-time Look branch,
  saved-look-action-hub, beta-site Chat 03, video-preview-resume, and
  video-capability/style branches. Each conflicts with the current release
  surface or is based on an older shared UI/video contract and must be ported
  and tested as its own atom; none was silently discarded or merged.
