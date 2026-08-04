# FIX REPORT

## Root cause

`src/web/garment-passport.js:3` previously equated repeated garment category with multiple garments. It had no representation for several photos of the same exact physical garment, so the valid two-view shirt input became `DUPLICATE_SLOT` before canonicalization.

## Fix

`schemas/garment-passport.schema.json:1` and `src/providers/codex-vlm-evaluator.js:57` add a strict full `reference_sets` partition with evidence and a 0.90 confidence floor for multi-view grouping. `src/web/garment-passport.js:7` normalizes each verified set into one garment. `src/web/garment-conditioner.js:29` sends every ordered view to one canonicalization and QA pass while preserving all source hashes. `src/monitor/agent-supervisor.js:1` adds persisted commentary, stall detection, incident deduplication, and bounded Codex bug-hunt dispatch.

## Before

The live run stopped after 15.66 seconds in `GARMENT_CONDITIONING` with two `top` items and `DUPLICATE_SLOT`; no provider generation occurred.

## After

Regression tests require two verified views to produce one garment, one generator call, two QA evidence bindings, and complete provenance. Two distinct singleton tops still produce `DUPLICATE_SLOT`. Full-suite evidence is recorded in `run-log.md` after execution.
