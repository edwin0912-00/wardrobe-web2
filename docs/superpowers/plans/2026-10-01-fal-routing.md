# Wardrobe FAL Routing Implementation Plan

> **For agentic workers:** Execute the owner-approved plan task-by-task with isolated native Luna worktrees and root verification.

**Goal:** Restore background/shoot generation and reference-bound video on both sites, with Codex → Sunburst and selectable Seedance 2.0/2.5.

**Architecture:** Reuse the image router, video service and existing FAL SDK. Persist provider/model/request identities and immutable reference bindings; keep OpenRouter semantic QA and Lucy Live.

**Tech Stack:** Node.js 22+, Fastify, native node:test, Sharp, FFmpeg, existing @fal-ai/client.

**Spec:** Owner-approved plan in this conversation, 2026-10-01.

## Global Constraints

- Codex first; >5 required images skip directly to FAL Sunburst, maximum 16.
- No fallback for invalid inputs or unknown submitted outcomes. No silent video model switching.
- Seedance 2.0 default; Seedance 2.5 explicitly selectable on both sites. Output default 720p.
- Server-only FAL key; all source hashes and ordered role bindings retained.
- Total paid validation cap $20, no top-ups. Preserve active runtime, OAuth account, source and media.
- SSD investigation produces a private report; no SSD deletion in this block.

## Task 1 — Images (isolated fal-images worktree)

- [ ] Add regressions for guide-first validated scenes, Codex failures, >5 image routing and unknown-outcome replay.
- [ ] Implement Sunburst provider using existing journal/receipt conventions, hash-checked storage uploads and per-instance FAL SDK.
- [ ] Wire the existing router and generation runtime without changing semantic QA.
- [ ] Run `node --test test/providers/*.test.js` and affected scene/web suites from beta.

## Task 2 — Videos (isolated fal-video worktree)

- [ ] Add regressions for model allowlist/default, immutable model on retry/resume, ordered image/video mappings, limits and partial upload failure.
- [ ] Add FAL queue adapter and preserve existing service/finalizer contracts and legacy job resumption.
- [ ] Add `video_model` selection to API, saved clips and both user interfaces.
- [ ] Run `node --test test/video/*.test.js` and affected UI suites from beta.

## Task 3 — Root integration and release

- [ ] Integrate reviewed worker diffs; wire FAL startup and Live pre-camera completeness feedback.
- [ ] Verify all scene/style catalog references and source hashes; retain blocked styles with clear causes.
- [ ] Run `./verify quick`, affected full node:test suites and `./verify full`; refresh release tree lock before committing.
- [ ] Run budgeted actual Codex/Sunburst/Seedance 2.0/2.5 checks and Live auth/media checks; show artifacts and receipts, explicitly record any unavailable checks.
- [ ] Commit with Lore trailers, push alpha, deploy matching site/engine SHA after active-work guard, verify public UI/API/media.
- [ ] Update README, agent handoff and shared board with actual evidence.

## Task 4 — SSD audit (independent read-only research)

- [ ] Compare copies/archives with canonical code, unique Git history and required media.
- [ ] Check process cwd/open handles/symlinks/hardlinks and avoid overlapping reclaim estimates.
- [ ] Produce private `SSD_CLEANUP_REVIEW_20261001.md` in the operator's audit directory with safe/preserve/unresolved targets and evidence; never publish private paths or client media.
