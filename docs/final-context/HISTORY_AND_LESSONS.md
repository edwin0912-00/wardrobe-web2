# Compressed history and lessons

## Timeline

- **22 July 2026:** original task snapshot, normative acceptance IDs,
  conditioning pipeline, three fixture jobs, six core images, prompts, manifests
  and QA framework.
- **23–25 July:** immutable state-machine runner, provider journaling/resume,
  structured reference packs, web upload, real progress and persistence.
- **26–27 July:** explicit product shift to reusable full-length master looks;
  profile/add-items flow; QA unification; standard scenes and Fashion Shoot
  boundaries; Git-based multi-agent coordination.
- **28–30 July:** background catalog, Create Universe style packs, Fashion Shoot
  execution, video service, Real-time Look contracts, saved-look Action Hub and
  cinematic presentation work.
- **31 July–3 August:** five-frame Fashion Shoot, native 3:4 scene delivery,
  Fashion Video persistence/retry/salvage/audio/reference QA, privacy-safe
  previews and exact release tracking.
- **4 August:** formal audit exposed the literal half-body vs product full-length
  evidence mismatch and the split between public frontend packaging and private
  engine delivery.
- **After evaluator review:** browser-asset verification was strengthened and the
  public reviewer wrapper was expanded on `wardrobe-web2/main`. A 2026-08-09
  clean-worktree check still found the private engine process requires an
  undocumented OpenRouter key, so reproducible startup is not yet closed.
- **8–9 August:** current image policy recorded as Codex primary with guarded
  OpenRouter fallback; both public domains report the same healthy engine release.

## Evaluator feedback — what failed the case

The deployed online demo looked functional and used real paid generations, but
the evaluator followed README locally. A browser/backend bridge asset resolved at
the wrong path and returned 404. The error was swallowed, so the interface looked
alive while real backend state was absent.

Tests did not catch this because too many asserted that strings/import constructs
existed rather than proving the browser loaded the asset and received backend
state. Basic product recovery flows—generation error, return from result, account
and history—were less complete than the cinematic/bonus presentation.

Strong signals noted by the evaluator:

- careful API client terminal states;
- idempotent requests;
- recovery from lost SSE;
- large, ambitious implementation.

Weak signal that determined the outcome:

```text
README claim ≠ clean local behavior ≠ behavior-level test evidence
```

The reasonable inferred evaluator score was around **65%**: technically strong
but unreliable as a reviewer-installed delivery. That is an inference, not a
number supplied by the company.

## What was lost in prioritization

1. Core clean-room reproducibility should have preceded bonus UI, cinematic
   scroll, style expansion and media experiments.
2. One real browser E2E test was worth more than many source-string tests.
3. Error/retry/back/history/account flows should have been implemented before
   presentation polish.
4. The literal half-body acceptance and later full-length product acceptance
   should have become separate versioned lanes immediately.
5. The two repositories needed an explicit release/install composition before
   public delivery.
6. Dynamic status files accumulated historical truths without a compact current
   snapshot, forcing agents to re-read and occasionally misinterpret history.

## Repeated technical failure pattern

Most expensive defects shared one cause: the same rule was enforced in multiple
places and the copies drifted.

Examples:

- framing assessment called from several paths with different options;
- prompt required full-length while an older avatar gate expected half-body;
- persisted mode IDs did not match branches that validated receipts;
- metadata allowlists silently dropped new fields;
- asset cache tokens advanced in a parent module but not child imports;
- wrong `ZEELY_RUNTIME_ROOT` looked like deleted media;
- aspect ratio placed only in prose was ignored instead of being sent in the
  provider request body.

Default repair: find every enforcement site, establish one owner/contract,
generate dependent schemas, and prove that the new regression test fails on the
pre-fix commit. An adversarial review must explicitly report `weakened_checks`.

## Decisions that must survive agent turnover

- Background and Fashion Shoot are separate products.
- Create Universe sheets build/lock a style; users receive five fashion frames,
  not backend contact sheets.
- Native scene output is 3:4 (`1536×2048`); do not crop it to 4:5 merely because
  an older composition reference uses 4:5.
- Fashion Shoot may intentionally use closer editorial framing; do not globally
  impose standard-background full-body rules.
- Standard-background subject scale has a broader product band than the old
  74–78% experiment; exact current code/receipt is authority.
- Fashion Video and Real-time Look start from the saved master look, not from a
  completed Fashion Shoot.
- No fake progress, no mock video presented as generated, no silent provider
  substitution and no automatic duplicate after unknown outcome.
- Never expose internal machine/provider copy, local filesystem paths or project
  codenames in the customer UI or external provider metadata.
