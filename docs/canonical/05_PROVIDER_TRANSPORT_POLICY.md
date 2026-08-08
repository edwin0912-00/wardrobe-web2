# 05 — провайдери, моделі і transport policy

## Active policy

| Роль | Поточний транспорт | Стан |
|---|---|---|
| Image/avatar/outfit/standard scene | Codex Worker (`codex-primary`) | primary |
| Image/scene fallback | OpenRouter image adapter | guarded fallback |
| Semantic VLM QA | OpenRouter VLM | configured |
| Fashion Video | OpenRouter video adapter | explicit route, requires capability and HTTPS source resolver |
| Real-time Look | FAL token route (Lucy) | camera-only role |
| Higgsfield | none | prohibited, not constructed |

## Image model policy

Canonical internal IDs are stable even when a provider uses another name. New
image work uses the GPT Image 2 ladder:

| Attempt | Internal profile | Purpose |
|---:|---|---|
| 1 | `gpt_image_2.low_1k.initial` | fastest first candidate, low/1k |
| 2 | `gpt_image_2.low_1k.qa_repair_1` | first deterministic repair |
| 3 | `gpt_image_2.low_1k.qa_repair_2` | second repair, not a third identical prompt |
| 4 | `gpt_image_2.medium_2k.escalation` | quality escalation |
| 5 | `gpt_image_2.high_4k.final` | final quality escalation |

`nano_banana_flash` and `nano_banana_2` remain allowlisted only so old journals
and receipts can resume. They are not the starting route for new work. The
persisted `job_set_type` is the internal canonical ID; a provider-specific alias
must be normalized by its adapter and never leaked into unrelated contracts.

## Fallback safety

OpenRouter fallback is allowed only for a retryable pre-submit transport failure
where no provider job could have been billed. It is forbidden after:

* unknown submit outcome;
* persisted provider job ID;
* idempotency/journal conflict;
* malformed or contract-invalid input;
* semantic/technical QA failure that needs a repair, not a new transport.

This prevents double-paid generation and prevents a fallback from hiding a
contract bug.

## Video policy

The active video adapter is OpenRouter's explicit video endpoint. It may accept
only the currently supported input shape; a reference-video-driven Fashion
Video request must fail with a structured capability error if that transport
cannot preserve the cut sheet. Never silently turn a Fashion Video request into
a still image, a slideshow, or a source-video delivery.

Provider audio is not automatically trusted. Delivery audio is either the
locked approved reference audio or intentional silence, according to the video
contract. A provider-added track alone is not a reason to discard an otherwise
valid clip; it must be removed or replaced during delivery assembly and recorded
in the receipt.

## Higgsfield prohibition

The active web graph must not import, construct, probe, or submit to Higgsfield.
Historical adapters and receipts remain for audit/resume reading only. A request
to re-enable Higgsfield requires a new explicit architecture decision and a
reviewed provider contract; no agent may do it as a quick fallback.

## Credentials

The daemon loads private provider credentials from the host's private store. Git
contains only provider names, environment variable names and capability rules.
Never paste an API key into `STATE.md`, `LOG.md`, `UPDATE.md`, a receipt,
browser bundle or an agent handoff.

