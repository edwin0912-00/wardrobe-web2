# Task and product canon

## 1. Literal test task

The required feature is an automated **AI Avatar Generator**:

```text
arbitrary user photo
→ recognizable photoreal avatar on #FFFFFF
→ same avatar + text outfit or garment-reference image
→ same person in the requested outfit
→ structured output directory
```

Required delivery:

- one runnable script/workflow and README with dependencies, startup and tools;
- at least three users, each with `avatar.png` and `avatar_outfit.png`;
- a short pipeline diagram and final prompts/prompt-formation logic;
- structured per-user output folders;
- no manual editing of checked-in JSON for a fresh user journey.

Literal quality requirements:

- exact white `#FFFFFF` background without edge shadows, gradients or bleed;
- recognizable face, hair, skin tone and observable build;
- neutral frontal **half-body** framing from head to waist/hips, face uncut;
- soft diffuse light, neutral white balance and natural skin;
- sharp photographic eyes, hair, skin and fabric without AI plasticity;
- outfit fidelity for type, colour, texture and fit;
- no anatomy defects, old-clothing residue or background leakage.

Art Director Mode is optional and may be a photo series or video. It cannot
compensate for a core failure.

## 2. Later product contract

The product deliberately expanded beyond the test:

- the reusable master look is **full-length**, top of hair to soles, because
  backgrounds, Fashion Shoot and motion require visible body/footwear continuity;
- profiles keep avatars and looks for 30 days without requiring an account;
- a saved look is the stable hub for backgrounds, Fashion Shoot, Fashion Video
  and Real-time Look;
- arbitrary garment photos are conditioned into evidence packs before generation;
- generation, technical QA, semantic QA, persistence and recovery are explicit
  pipeline stages.

This full-length requirement is a later operator/product decision. It must never
be attributed to the literal Notion task. Historical half-body submission images
can satisfy the original framing requirement while failing the current product
full-length verifier; those are different acceptance lanes.

## 3. Naming and product boundaries

- User-facing name: **Wardrobe**. Historical Zeely identifiers may remain in
  internal filenames, receipts and code where renaming would break provenance.
- **Background** (`std.*`) is one ordinary generated photograph in a selected
  environment. It is not a fashion shoot.
- **Fashion Shoot** (`shoot.*`; legacy internal `editorial.*`) is one locked
  photographic system: location, mood, camera, lens, light, grade, pose language,
  framing and reference pack. The product output is five unique photographs.
- **Create Universe** is the backend/style-authoring process that creates the
  immutable Fashion Shoot style pack and its reference sheets. It is not an
  additional user-facing output stage.
- **Fashion Video** starts directly from an approved saved master look. It does
  not require a background or Fashion Shoot.
- **Background Video** starts from an approved background frame and has two
  simpler intentions: product/garment focus or model posing.
- **Real-time Look** is the camera product. A local camera preview and a paid
  generative WebRTC session must be labelled differently and require explicit
  consent.

## 4. Image model policy

Stable internal route names:

1. GPT Image 2 — `gpt_image_2`, primary.
2. Nano Banana 2 — `nano_banana_flash`, bounded fallback.
3. Nano Banana Pro — `nano_banana_2`, final quality fallback.

Current provider mapping in source:

- `gpt_image_2` → `openai/gpt-5.4-image-2`;
- `nano_banana_flash` → `google/gemini-3.1-flash-image`;
- `nano_banana_2` → `google/gemini-3-pro-image`.

Higgsfield CLI historically used `nano_banana_pro` as its external alias for
internal `nano_banana_2`. Runway is not allowed. A transport must not change the
model intent, reference order, acceptance contract or receipts.

As of this snapshot, new image/scene generation uses the isolated Codex image
worker first and a guarded OpenRouter adapter only for safe retryable failures
before a provider submission is confirmed. Higgsfield remains historical audit
evidence and is prohibited by current runtime policy.

## 5. Video and live canon

- Art/Fashion video primary: Seedance 2 with a locked look and explicit
  reference/motion authority. Internal and transport identifiers vary by adapter;
  exact request receipts are authoritative.
- Ordinary background video route: Gemini Omni family when executable and
  contract-tested; never silently substitute it for Fashion Video.
- Real-time generative candidate: `decart/lucy-2-5/realtime` over fal.ai WebRTC.
- Local Live Director: browser `getUserMedia` plus local guides; no hidden upload
  and no claim of generative try-on.

Two-reference Fashion Video intent:

```text
reference 1 = approved full-length master look
reference 2 = verified motion/style reference
```

Provider availability and a tested request contract are required before a UI
may advertise execution.

## 6. Non-negotiable engineering rules

- The core is an immutable job/state machine, not an autonomous conversational
  agent.
- Inputs, outputs, prompts, provider job IDs and QA verdicts are hash-bound.
- `UNKNOWN` and `NOT_EVALUABLE` are valid; never invent invisible facts.
- A provider outcome marked unknown must not be duplicated automatically.
- Retry only the failed stage/shot, with bounded attempts.
- Never repair delivery with blur padding, stretching or invented pixels.
- Do not weaken a global gate to save one preset or one mode.
- Reusable content-addressed artifacts are a feature; execution-key collision
  between different jobs is a defect.
- `ZEELY_RUNTIME_ROOT` is data authority. A wrong root can look like data loss.
- Original/master private assets are `private, no-store`; previews are bounded
  derivatives with their own cache policy.
- Every visible error must have authored user copy and an actionable recovery;
  raw provider reasoning, stack traces and private paths never reach the UI.
