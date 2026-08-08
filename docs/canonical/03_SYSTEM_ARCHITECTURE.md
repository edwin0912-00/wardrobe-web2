# 03 — системна архітектура і межі відповідальності

## Runtime layers

```text
Browser / main presentation / beta engineering UI
                │ HTTP + SSE + media URLs
                ▼
src/web/start.js → app.js → route modules
                │
                ├── ProfileService / RunService / DraftService
                ├── SceneService / scene-runtime / scene adapters
                ├── EditorialShootService / Shoot Bible / contact sheet
                ├── VideoService / clip store / video QA
                ├── MotionService / Real-time Look token route
                ├── God View / monitor / test-audit routes
                └── presentation preview/media derivatives
                │
                ▼
Immutable run/job/receipt/artifact stores under ZEELY_RUNTIME_ROOT
                │
                ▼
Provider adapters: Codex image worker, OpenRouter image/video/VLM, FAL realtime
```

## Important source modules

| Concern | Canonical code |
|---|---|
| image runtime selection | `src/web/generation-provider.js` |
| Codex image worker | `src/providers/codex-app-server-client.js`, `codex-imagegen-provider.js` |
| OpenRouter image/VLM/video | `src/providers/openrouter-imagegen-provider.js`, `openrouter-vlm-evaluator.js`, `openrouter-video-provider.js` |
| core runner and state machine | `src/runner/*` |
| input conditioning | `src/conditioning/*`, `src/web/garment-conditioner.js` |
| scene contract and repair | `src/web/scene-contract.js`, `scene-repair-router.js`, `scene-service.js` |
| Fashion Shoot | `src/web/editorial-shoot-contract.js`, `editorial-shoot-service.js`, `editorial-scene-executor.js` |
| video contract and delivery | `src/web/video-contract.js`, `video-service.js`, `video-runtime.js`, `video-clip-qa.js` |
| profile/look persistence | `src/web/profile-service.js`, `approved-item-evidence.js`, `run-service.js` |
| upload and media derivatives | `src/web/heic-converter.js`, `presentation-preview.js`, `presentation-media.js` |
| monitoring and operator view | `src/monitor/*`, `src/web/god-view-*`, `test-audit-*` |

## Immutable unit of work

Усі зовнішні виклики привʼязані до immutable `job.json` або route-specific
request journal. У ньому фіксуються:

* input/reference SHA-256 та роль кожного input;
* canonical prompt SHA і version;
* ordered reference bindings;
* provider/model route та generation profile;
* idempotency key;
* output target, retry budget і policy version;
* append-only events, checkpoints і receipts.

Адміністративні credentials не входять у `job.json`, receipts або browser DTO.
Provider process читає їх з environment/host-private store.

## Event flow

```text
REQUESTED
  → CONDITIONING
  → READY / NEEDS_INPUT / INCOMPATIBLE
  → SUBMITTING
  → ACCEPTED (provider job id persisted)
  → POLLING
  → OUTPUT_STORED (bytes + SHA)
  → TECHNICAL_QA
  → SEMANTIC_QA
  → APPROVED / RETRYABLE_FAIL / EXHAUSTED
  → DELIVERED (private media URL + preview derivative)
```

Job id або idempotency record зберігається до polling. Якщо process падає після
submit, restart має resume/poll існуючий job, а не створювати дубль.

## Boundaries that must stay separate

* standard backgrounds (`std.*`) і Create Universe/Fashion Shoot (`shoot.*`)
  мають різні framing locks, style packs і QA scopes;
* Fashion Video reference є directing material, а provider MP4 — лише raw
  candidate; delivery clip збирається окремо;
* preview derivative — не evidence/original download;
* branch source, deployed release artifact і runtime state — різні рівні;
* model/VLM рішення не можуть підміняти deterministic contract validation.

## HTTP surface (representative)

```text
GET  /api/health
GET  /api/scene-presets
GET  /api/editorial-modes
POST /api/runs                 create avatar/outfit run
GET  /api/runs/:id             state and receipts
GET  /api/runs/:id/events      SSE/event polling
POST /api/runs/:id/retry
POST /api/profile/looks/:id/scenes
POST /api/profile/looks/:id/shoots
GET  /api/profile/looks/:id/video-styles
POST /api/profile/looks/:id/videos
GET  /api/post-shoot/pipeline
GET  /api/god-view/*           operator/test surface
```

Точний список маршрутів читається з route modules і public contract tests; цей
список не є дозволом додавати новий провайдер або нову платну дію.

