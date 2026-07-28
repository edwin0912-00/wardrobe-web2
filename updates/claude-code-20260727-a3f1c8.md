Agent ID: claude-code-20260727-a3f1c8
Protocol ACK: 036b20a
Task ID: none — outbound identity change on the operator's instruction. `src/providers/openrouter-client.js` is reserved by no row.
Commit tested: providers suite
Rationale/decision: The operator asked what our requests publish, after a past incident where the provider's support had to remove credentials and the site went down over information on OpenRouter. The answer is that the leak was ours, not theirs. `HTTP-Referer` and `X-Title` are the only voluntary fields in the request and OpenRouter publishes both in its app rankings. The defaults were hardcoded to the product's own name and domain, and `ZEELY_OPENROUTER_REFERER` was never set anywhere, so every single generation announced the product and the site. Nobody decided that; a default did.
Result: the outbound identity is now `https://app.adbraze.com` and `adbraze`, and the title became overridable by environment as the referer already was, so a deployment can change it without touching code. No occurrence of the old name or domain remains as an outbound value anywhere under src/. Providers suite 60 pass, 0 fail. For completeness, what a request unavoidably carries: the bearer token, the content type, the prompt text, and any reference images as base64 — those are inherent to generating. The name and the domain were not.
Evidence command: grep -n "referer =\|title =" src/providers/openrouter-client.js
Help request: a related decision that is not this agent's to take. `src/providers/provider-prompt-privacy.js` refuses a prompt containing the words `zeely` or `madeforthisjob`, to stop the product name leaking through the prompt channel. If the outbound brand is now adbraze, that word list is arguably stale in both directions — it still guards names we no longer publish, and it does not guard the one we do. The operator was told; no change was made here.
Next action: back to BETA-VIDEO-STAGE-001. The contract layer is in; the service layer now targets the real provider boundary, which is the logged-in codex CLI on the host rather than a job file, because `codex mcp list` shows magnific registered and awaiting login.

---
## 2026-07-28 — shot-list correction in the motion contract
Agent ID: claude-code-20260727-a3f1c8
Protocol ACK: 036b20a
Task ID: BETA-VIDEO-STAGE-001 (contract layer, correction)
Commit tested: test/contracts/motion-contract.test.js — 12 pass, 0 fail
Rationale/decision: The contract shipped in 09cd739 refused a shot list on Seedance (`SHOT_LIST_IGNORED_BY_MODEL`). That claim was never measured: the single multishot attempt died on a malformed call — the API answered `Undefined array key "prompt"` — so the model was never asked, and the catalogue declares multishot allowed (up to 6 shots of 1-12s). A call-shape defect is not a model limitation. Replaced the refusal with call-shape requirements: `SHOT_LIST_ABOVE_MODEL_CEILING`, `SHOT_LIST_WITHOUT_WHOLE_CLIP_PROMPT` (Seedance requires a whole-clip prompt alongside the list), `SHOT_LIST_DOES_NOT_SUM_TO_DURATION` (±1s). The schema gained `route.prompt` — without it the new rule could never be satisfied, since route is additionalProperties:false. Stale comments repeating the disproven claim corrected in both files.
Found, not caused: test/contracts/scene-production-packs.test.js is red again (1 pass / 4 fail) at HEAD with my changes stashed — a reference sha256 mismatch and "Published scene preset pack index is not available". It was green at 0577846 after the terracotta restore; last touch on the area is 7bca845 [agent:codex-main] "publish beta background catalog". Not mine to fix silently; flagged here.
Evidence command: node --test test/contracts/motion-contract.test.js
Next action: the motion service layer (motion-service.js, config/motion-modes.json, routes, tests) on the codex-CLI MCP boundary.
