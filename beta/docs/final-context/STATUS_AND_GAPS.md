# Verified status and remaining gaps

Snapshot time: **2026-08-09 00:26 Europe/Madrid**.

## Exact source and deployment state

- Engine source authority: `zeely-ai-engineering-test/beta` at
  `087ac63ee088d12de525443fe814825e235865a8`.
- Engine repository `main` is older at
  `320b1af085a59c10bc0cd087680294ea7cc486ea` and is not the source authority.
- Public engine release reported by both beta and cinematic domains:
  `ca7e2529f80da852523d5bb2601d26f9b5207fb3`.
- `origin/beta` is one documentation-only commit ahead of that live release.
- Cinematic repository source authority: `wardrobe-web2/main` at
  `b4f24a364fa318a47e59338bd6198299e2c8db15`.
- Historical `canonical-site-main` remains at
  `09115c64fae6fa6c01c47d963946e1ef8759183d`; current public `main` contains
  later integration/reviewer-install changes and is the branch to continue.

Live `GET /api/health` on both domains returned:

```json
{
  "status": "ready",
  "release_sha": "ca7e2529f80da852523d5bb2601d26f9b5207fb3",
  "generation": "available",
  "semantic_qa": "available",
  "editorial_generation": "available",
  "fashion_shoot_qa_mode": "review"
}
```

Live catalogs returned 16 standard-background presets and 18 Fashion Shoot mode
records, 17 marked generation-available. These are catalog/capability facts, not
proof that every choice completes a paid journey.

## Clean-worktree verification at this snapshot

Run from a fresh worktree at `origin/beta` after `npm ci`:

```text
project-canon JSON Schema                   PASS
npm run verify:canon                        PASS — 43 rules, 34 blocking
npm run verify:contracts                    PASS — 41 schemas, 9 fixtures, 3 jobs
README browser module/API surface test      PASS — 1/1
README real startup process                 FAIL — OPENROUTER_API_KEY required
npm run verify:output                       NEEDS_REVIEW — 001, 002, 003
```

The README startup failure is pre-existing product code, not caused by this
documentation pack. `src/web/start.js` currently constructs the OpenRouter image
provider and exits when no `OPENROUTER_API_KEY` is present, while README states
that the key is unnecessary for local startup. This is an active reproducibility
defect and must be repaired or documented honestly before evaluator delivery.

## Block status

| Block | Code | Deployed surface | E2E evidence | Honest verdict |
| --- | --- | --- | --- | --- |
| Input + conditioning | Implemented | Yes | Historical real run | Working; current exact-release fresh proof should be retained per release. |
| Avatar + outfit core | Implemented | Yes | Historical real run passed conditioning, Avatar QA and Outfit QA | Functionally working. Literal three-user package and current full-length product lane must be reported separately. |
| Profile + saved looks | Implemented | Yes | Historical save/reopen evidence | Working; 30-day browser profile is product behavior, God View is test-only. |
| Standard backgrounds | Implemented; 16 presets | Yes | At least one completed 9/9 scene proof exists historically | Catalog and engine work; do not claim every preset E2E without matrix results. |
| Fashion Shoot | Five-frame execution, persistence, progress and QA code exist | Yes; 18 records/17 available | No single current-snapshot statement proves all styles × five frames | Advanced but not globally certified. Creative QA is review/advisory in live health. |
| Fashion Video | Async job, persistence, retry, salvage, technical and semantic QA exist | Yes | Historical persisted clips and targeted suites exist | Executable, but each release still needs one real two-reference journey and explicit output artifact proof. |
| Background Video | Contract/product branch described | Partial/uncertain | No current full E2E proof | Not complete as a product. |
| Real-time Look | Local camera UI and Lucy/FAL contract exist | Surface exists | Paid generative camera E2E not proven in this snapshot | Partial; local preview and generative live must remain distinct. |
| Cinematic presentation | Implemented in separate public repo | Public site | Frontend/preflight evidence exists | Presentation layer only; not the engine submission. |
| Unified one-command project | Plan and public wrapper exist | Not a single canonical engine+two-UI repo | Browser asset graph passes, but current private-engine README startup fails without an OpenRouter key | Architecture consolidation and reproducible startup remain open. |

## Original test completion

The engineering system implements the functional core and substantially exceeds
the optional scope. The original submission nevertheless cannot be called a
clean 100% delivery until all of these are true together:

1. a clean clone follows README and loads every browser module/API bridge without
   a silent 404;
2. behavior-level tests prove UI → backend state, not only source strings;
3. three user pairs are hash-bound to the declared **literal half-body** task
   acceptance, or a clearly separate full-length product package is submitted;
4. `submission-manifest.json`, per-user QA reports and summary agree;
5. one exact-SHA public core journey is archived as current evidence;
6. error, retry, back, saved-history and result-next-action journeys are tested.

The Aug 4 audit marked the checked-in outputs `NEEDS_REVIEW` only because the
current product verifier expected full-length while their visual evidence used
the retired half-body product gate. That does **not** prove the images violate the
literal original half-body requirement. The correct fix is two explicit lanes,
not renaming receipts or weakening a gate.

## Main unresolved risks

1. **README startup regression.** The browser asset graph test passes, but the
   real process exits without `OPENROUTER_API_KEY` despite contrary README copy.
   Fix dependency injection/startup policy or update the documented requirement,
   then prove it in a clean clone.
2. **Two-repository release ambiguity.** The cinematic site and private engine
   can advance independently. A root release lock or unified monorepo is still
   needed to make one install/release statement reproducible.
3. **Source vs live drift.** Even documentation-only drift must be labelled; code
   commits require exact deployment receipts.
4. **Stale documentation.** Some older README/status text still names Higgsfield
   as the active image route, while current runtime policy is Codex primary and
   guarded OpenRouter fallback. Exact source code and health win.
5. **Full-suite historical debt.** Targeted suites are strong, but older reports
   recorded unrelated fixture failures. Never convert targeted PASS into a whole
   repository PASS claim.
6. **Fashion Shoot certification.** A catalog and five-frame scheduler are not an
   all-styles paid E2E matrix.
7. **Real-time privacy/cost proof.** Paid WebRTC requires explicit consent,
   bounded duration, short-lived credentials and a real device/browser smoke.
8. **Evaluator packaging.** The public cinematic repo and private engine must be
   presented as one intentionally composed delivery or as two explicitly linked
   modules. Ambiguity was costly.

## Next closure order

1. Re-run a clean-room install from the exact evaluator-facing repository.
2. Run behavior-level browser smoke for input → progress → result → retry/back →
   saved history after refresh.
3. Rebuild the literal three-user submission evidence without mixing the
   full-length product contract.
4. Bind cinematic frontend, beta frontend and engine SHAs in one release lock.
5. Run the smallest real paid matrix: one core journey, one background, one
   five-frame Fashion Shoot, one two-reference Fashion Video, one consented Live
   device smoke.
6. Only then publish a final acceptance report.
