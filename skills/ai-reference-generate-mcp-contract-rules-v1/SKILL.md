---
name: ai-reference-generate-mcp-contract-rules-v1
description: Design, implement, audit, or repair deterministic reference contracts for AI image and video generation over MCP, CLI, or API transports. Use for multimodal reference ordering, GPT Image or Gemini/Nano Banana image generation, Seedance/Higgsfield video generation, provider aliases, immutable manifests and receipts, prompt-to-input bindings, QA tolerances, repeated-failure routing, mechanical repair guides, retry/fallback policy, and reference leakage prevention.
---

# AI Reference Generate MCP Contract Rules V1

Treat the model as a fallible renderer. Make the contract, state machine, evidence, and QA deterministic.

## Load only the relevant reference

- Read [references/image-model-contracts.md](references/image-model-contracts.md) for image generation, image editing, reference ordering, model aliases, or image-provider limits.
- Read [references/video-model-contracts.md](references/video-model-contracts.md) for reference-bound video, Seedance, cut sheets, performer replacement, audio, or per-cut QA.
- Read [references/adaptive-qa-repair.md](references/adaptive-qa-repair.md) whenever a candidate fails QA, a defect repeats, thresholds are being changed, or a repair/fallback route is designed.
- Use [references/reference-contract.example.json](references/reference-contract.example.json) as the portable contract shape.

## Required workflow

1. **Discover the executable capability.** Query the installed MCP/CLI/API model schema and version without starting a paid job. Never invent unsupported parameters from memory.
2. **Separate semantic and transport identities.** Persist stable internal model IDs and semantic roles. Translate provider aliases only at the boundary.
3. **Normalize every input.** Verify bytes, MIME, dimensions, background requirements, path confinement, SHA-256, provenance, and allowed role before compilation.
4. **Assign one authority per reference.** Declare what each input may control and what it must never change. Refuse conflicting authorities before provider spend.
5. **Compile one immutable manifest.** Generate physical input order and all prompt labels from the same data structure. Number image, video, and audio namespaces independently when the provider does.
6. **Put geometry in request parameters.** Send aspect ratio, duration, quality, resolution, and other supported controls in the request body/CLI arguments; prose is explanatory, not transport authority.
7. **Compile the prompt from the manifest.** Never handwrite `Image 2`, `@Image 3`, or similar labels separately from the outbound arrays.
8. **Persist before spend.** Save attempt ID, request manifest, prompt SHA, input hashes, model route, and `SUBMITTING` state before the provider call. Persist the provider job ID immediately after acceptance.
9. **Verify after generation.** Rehash downloaded bytes, inspect technical media properties, run semantic QA against immutable evidence, persist the receipt, then reopen the stored result before delivery.
10. **Route failures by evidence.** QA measures; the repair controller chooses prompt repair, mechanical repair, model fallback, or terminal failure. Never let repeated failures silently tighten or weaken QA.

## Contract invariants

- Keep internal IDs, provider IDs, display labels, and implementation names separate.
- Keep the outbound ordered array authoritative; prompt order alone is not proof.
- Store `namespace + order + provider_label + role + SHA-256` for every reference.
- Store `allows` and `forbids` authority dimensions for every reference.
- Version any change to input order, role semantics, prompt bindings, limits, or repair strategy.
- Keep candidates, guides, QA evidence, and receipts immutable and attempt-scoped.
- Do not mutate historic receipts after alias or contract changes.
- Do not use blur, stretch, padding, or a source frame to disguise failed delivery.
- Do not call a provider again when create outcome is unknown. Poll the persisted job only when its ID and media binding are provider-verifiable; otherwise quarantine the attempt.
- Do not call a test PASS if it already passed before the change. A regression test must fail against the pre-change behavior.

## QA and repair summary

Use four distinct values per measured metric:

```text
generation target
preferred band
delivery band
measurement epsilon
```

The target guides generation and is not an exact-equality gate. PASS only when all hard locks pass and the measurement falls inside the declared delivery band after applying the single declared epsilon.

Escalate deterministically:

```text
inside delivery band
→ PASS

small first miss with measurable progress
→ one same-model VLM-guided repair

large miss, repeated signature, repeated SHA, or <1 percentage-point progress
→ mechanical guide / changed input authority

same defect after changed mechanism
→ model fallback

route exhausted
→ QA_EXHAUSTED with best candidate and exact evidence
```

Never send an unchanged repair prompt a third time. A systemic miss such as repeated 65% subject height against a 70% delivery minimum is a routing/input-authority problem, not a reason to tighten QA.

## Validate a portable contract

Run:

```bash
node scripts/validate-reference-contract.mjs references/reference-contract.example.json
```

The validator checks namespace numbering, provider labels, hashes, authority conflicts, prompt bindings, and key image/video topology rules. It does not contact a provider.

## Required handoff

Report:

- internal and provider model IDs;
- exact ordered references and manifest SHA;
- capability snapshot/version;
- prompt SHA and request parameters;
- attempt/retry lineage;
- measured QA values and decision;
- repair mechanism selected and why;
- `weakened_checks` (normally empty);
- code-test status, real-provider status, and deployment status separately.

Never report a real-provider PASS from mocks, schemas, or unit tests alone.
