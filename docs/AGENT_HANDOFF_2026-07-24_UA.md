# Zeely — handoff для наступного агента

**Створено:** 2026-07-24, Europe/Madrid
**Статус:** production доступний, але standard scene pipeline зараз має відому persistence-помилку після успішної генерації та перед фінальним QA. Не починати новий rewrite: спершу виправити й задеплоїти конкретний фікс нижче.

## 1. Що це за проєкт і де він лежить

- Локальний git root: `/Users/jarvis1/Documents/Codex/2026-07-19/mvp-zeely-format-html5-1-2`
- GitHub (private): `https://github.com/edwin0912-00/zeely-ai-engineering-test`
- Основна гілка локально й на origin: `main`, база `b12ecf53af8bf92e236c745f50ee41cf83ee7cd3`.
- Існують додаткові remote branches, їх **не можна** зливати без окремого review:
  - `origin/codex-experimental-worker-01` — `af4e0848…`
  - `origin/codex/imagegen-worker-test-20260722`
  - `origin/codex/video-motion-mvp-20260723`
- Поточний робочий каталог містить великий незакомічений набір реалізації beta: зміни tracked + нові `src/web/scene-*`, `web/public/scene-*`, schema, tests, tools, presets. Це не сміття — це актуальна робота, яку треба зберегти окремим backup commit/branch перед будь-яким merge/rebase.

## 2. Публічний production

| Surface | Address | Current state |
|---|---|---|
| Studio | `https://www.madeforthisjob.com` | Health відповідає `ready` |
| Backup studio | `https://beta.madeforthisjob.com` | резервний hostname |
| Operations monitor | `https://monitor.madeforthisjob.com` | live monitor |
| Health | `https://www.madeforthisjob.com/api/health` | JSON; на момент handoff: generation / semantic_qa / editorial_generation `available` |

Production запускається на Mac, а не на Cloudflare Workers:

- live root symlink: `/Users/jarvis1/.local/share/madeforthisjob/app`
- deploy state: `/Users/jarvis1/.local/share/madeforthisjob/.zeely-deploy/state/runtime`
- дані jobs/scenes: `$STATE/scenes/<scene-id>/scene.json`
- Fastify app: port `4173`; monitor: port `4174`
- Cloudflare named Tunnel: `zeely-madeforthisjob` → `127.0.0.1:4173/4174`
- LaunchAgents (KeepAlive=true):
  - `com.madeforthisjob.zeely`
  - `com.madeforthisjob.monitor`
  - `com.madeforthisjob.cloudflared`

Runbook: [`DEPLOYMENT_UA.md`](DEPLOYMENT_UA.md). Не комітити локальні credentials, `.env`, Keychain data, Cloudflare account credential або runtime state.

## 3. Що має вміти продукт зараз

1. Користувач у тому самому браузері має тимчасовий profile/draft: avatar → approved white-background look → додати нові речі до існуючого avatar, без повторного вибору avatar.
2. Файли draft і профіль мають переживати browser refresh (короткий TTL; не IP binding).
3. Референси речей приймаються, нормалізуються/перевіряються, конфлікти категорій пояснюються (напр., дві пари взуття → вибрати одну), а не приховуються за «помилкою».
4. Основний image pipeline має зберігати immutable receipts, локальні artifacts і live SSE/monitor events.
5. Після approved white look користувач обирає standard scene або **Art Fashion** / editorial shoot.
6. Scene hierarchy: `Profile → Avatar → Approved white look (master) → Standard scenes / Authorial shoot`. Master look не перегенеровувати при scene failure.
7. На UI показувати живий технічний graph і, де можливо, preview/mask/candidate, але не вигаданий progress. Будь-який progress має походити від state/event.

## 4. Моделі та правила маршрутизації

- Основний image model: **GPT Image 2** (через локальний Codex worker/app-server adapter).
- Nano Banana 2 / Pro — для специфічних допоміжних image tasks, як fallback за route; не вигадувати локальні моделі.
- Seedance 2 — final video; Runway не використовувати як model.
- Higgsfield доступний через MCP/CLI, але для scene primary шлях переключений на реальний GPT Image 2 worker; Higgsfield може бути fallback, якщо route явно дозволяє.
- Semantic / item QA: VLM adapter, strict JSON schema + JS contract validation.
- Privacy: не публікувати local paths, hostnames, user home dirs, prompts із приватними refs або credentials у public API/UI/log events.

## 5. Standard scene architecture

Файли:

- `src/web/scene-service.js` — durable scene state machine, retries, QA, receipts.
- `src/web/scene-contract.js` — strict contracts, normalizers, persisted state validation.
- `src/web/scene-runtime.js` — production wiring/adapters.
- `src/web/scene-adapters.js` — generator/evaluator adapters.
- `src/web/scene-routes.js` — API/SSE.
- `web/public/scene-ui.js`, `scene-state.js`, `scene.css` — picker/execution UI.
- `config/scene-presets.json`, `assets/scene-presets/` — versioned preset/reference packs.
- `spec/ZEELY_SCENE_CANON_UA.md` — product / quality canon.

Persistent scene input bindings must contain **exactly**:

```text
approved_look, preset, prompt, reference_pack
```

This was deliberately designed to make `POSTING_SCENE_REQUEST` immutable and auditable. Any change must update contract, service and test together; do not add random persisted keys.

Intended flow:

```text
APPROVED LOOK
→ select versioned scene preset
→ hash/receipt bind: approved_look + preset + prompt + reference_pack
→ GPT Image 2 generation (candidate saved locally)
→ dimensional/framing/identity/items/scene/light QA
→ PASS: immutable approved scene receipt + public safe output
→ FAIL: only scene stage can retry; white master remains untouched
```

Five standard scene families were planned as presets (not a single hardcoded `optional_scene`): city open shade, light studio, dramatic Rembrandt studio, modern interior, nature × architecture. Editorial/Art Fashion is separate and reference-led.

## 6. The current production failure — exact root cause

### Observed user symptom

User selects e.g. `Драматична студія — Рембрандт`; image is generated, then UI ends at `FAILED` / `Сцена не пройшла перевірку` / `GENERATION_EXHAUSTED` or later internal failure. The user correctly objects: this is not a meaningful visual-quality rejection and retry behaviour/UI wording is unclear.

### Current live scene states at handoff

```text
scene_c7f7adbc533d763b68356d4ad5e778949d77c5ff6c0a02d2
  FAILED / INTERNAL_ERROR / SCENE_INTERNAL_ERROR
  2026-07-24T17:35:27.935Z

two older scenes:
  FAILED / QA_INFRASTRUCTURE_FAILED
  2026-07-24T16:39:14.222Z
  2026-07-24T16:53:27.954Z
```

The latest scene successfully generated and wrote candidate image before failing. It has not failed image generation. Exact server error:

```text
Persisted scene attempt 1 QA must contain exactly:
decision, framing_evidence, gates, reviewer, score, summary
```

### Root cause confirmed in source

`SceneService.#evaluate()` writes an optional seventh key:

```js
item_fidelity_evidence: normalized.item_fidelity_evidence
```

at `src/web/scene-service.js` approximately lines `3393–3402`.

But `validatePersistedSceneState()` in `src/web/scene-contract.js` accepts exactly only these six final QA keys:

```text
decision, gates, score, summary, reviewer, framing_evidence
```

So a valid evaluator response containing per-item evidence makes our own persistence checkpoint throw. The outer catch maps this to `SCENE_INTERNAL_ERROR`. This is a self-inflicted contract mismatch, **not** a user input error, not an image-provider failure and not a visual QA fail.

Earlier schema error was separately fixed: the Codex provider rejected JSON schema `allOf` for `scene-item-fidelity-output.schema.json`. It was flattened, and a real `codex exec` proof subsequently returned valid item-fidelity JSON. Do not reintroduce `allOf`.

## 7. Work already prepared locally but not deployed

There is a local build candidate made before the newest failure:

```text
/Users/jarvis1/.local/share/madeforthisjob/.zeely-deploy/candidates/qa-auto-recovery-20260724-1740
digest: 81407cf86aa5cf3d42879989b44b123f0c4392f7eb238372fd6e4acb77cde5f4
```

Those uncommitted source changes add:

- `autoRecoverQaInfrastructureFailures` option to `SceneService` (production runtime turns it on).
- On `initialize()`, terminal `QA_INFRASTRUCTURE_FAILED` candidates in `QA_PENDING` are automatically retried as QA-only, preserving the generated candidate.
- Tests previously passed:

```bash
node --test --test-reporter=spec test/web/scene-service.test.js test/web/scene-runtime.test.js
# 35 passed at the time
```

That candidate was **not deployed**, because deploy correctly refused while a scene was active. It also does not yet cover the new `SCENE_INTERNAL_ERROR` code.

## 8. Precise next fix (do this first)

Preferred minimal safe patch: extend the persisted attempt QA contract to allow optional `item_fidelity_evidence`, and validate it using the already-existing `normalizeItemFidelityEvidence()` semantics. The public receipts already intentionally serialize this evidence in several locations (near lines 3604, 3630, 3674), so simply dropping it risks losing useful audit proof.

At minimum update all coupled logic:

1. `src/web/scene-contract.js`: final attempt `qa` key validation must permit base six keys plus optional `item_fidelity_evidence`; validate the value (bounded ordered array, no arbitrary object). Keep strictness: no arbitrary extra key.
2. `src/web/scene-service.js`: define a common helper/predicate for *candidate-preserving QA recovery*. It should cover:
   - `QA_INFRASTRUCTURE_FAILED`, and
   - the known `SCENE_INTERNAL_ERROR` only when latest attempt is `QA_PENDING` and has candidate.
3. Use the predicate both in `initialize()` auto recovery (around lines 1895) and `retryScene()` qa-only branch (around 4178). This means the newest scene re-runs only QA—no second expensive GPT Image generation.
4. Add a regression test that evaluator returns valid `item_fidelity_evidence`, checkpoint persists, scene can pass/fail visual QA normally, and never becomes `SCENE_INTERNAL_ERROR`.
5. UI: `web/public/scene-ui.js` must distinguish technical recovery from visual failure:
   - technical (`QA_INFRASTRUCTURE_FAILED` / qualifying `SCENE_INTERNAL_ERROR`): title e.g. `Відновлюємо технічну перевірку`; button `Повторити перевірку`.
   - true gate failure: `Сцена потребує доопрацювання`; button `Переробити сцену`.
   - never label an infrastructure/persist error as “не пройшла перевірку”.
6. Version client JS import/query if needed so mobile Safari does not retain stale UI code.

**Do not** automatically retry arbitrary `SCENE_INTERNAL_ERROR`: only recover the constrained shape above (candidate exists + `QA_PENDING` + the known persistence condition), otherwise hide a real integrity error.

## 9. Test and deploy sequence

Run narrow tests first:

```bash
node --test --test-reporter=spec \
  test/web/scene-service.test.js \
  test/web/scene-runtime.test.js \
  test/web/scene-adapters.test.js
```

Build/verify an immutable release outside the repo:

```bash
candidate=/Users/jarvis1/.local/share/madeforthisjob/.zeely-deploy/candidates/<unique-name>
node tools/build-product-release.mjs "$candidate"
node tools/verify-product-release.mjs "$candidate"
manifest_sha=$(shasum -a 256 "$candidate/ops/product-release-manifest.json" | awk '{print $1}')
content_digest=$(node -e "const m=require(process.argv[1]); process.stdout.write(m.content_digest_sha256)" "$candidate/ops/product-release-manifest.json")
```

Deploy only when no active/malformed runs; do **not** bypass this protection:

```bash
node tools/deploy-add-items-release.mjs --apply \
  --release "$candidate" \
  --live-root /Users/jarvis1/.local/share/madeforthisjob/app \
  --expected-digest "$content_digest" \
  --expected-manifest-sha256 "$manifest_sha" \
  --expected-base-commit b12ecf53af8bf92e236c745f50ee41cf83ee7cd3 \
  --web-plist /Users/jarvis1/Library/LaunchAgents/com.madeforthisjob.zeely.plist \
  --monitor-plist /Users/jarvis1/Library/LaunchAgents/com.madeforthisjob.monitor.plist \
  --tunnel-plist /Users/jarvis1/Library/LaunchAgents/com.madeforthisjob.cloudflared.plist \
  --external-health-url https://www.madeforthisjob.com/api/health
```

The `--expected-digest` value must equal `content_digest_sha256` from the release manifest. Do not invent CLI arguments or bypass the verifier.

After deploy:

```bash
curl -sS https://www.madeforthisjob.com/api/health
launchctl print gui/$(id -u)/com.madeforthisjob.zeely
```

Then confirm server initialization auto-resumes only the preserved candidate QA. Watch `monitor.madeforthisjob.com` and scene SSE, not an invented timer.

## 10. Monitoring and incident behavior

- Live monitor should be treated as observer, not as an authorization to mutate production autonomously.
- There is an active read-only sub-agent in this Codex session called `live_scene_monitor` / “Луна”. It has been asked to observe current scene state and report immediately. A new agent should recreate equivalent monitoring if it cannot inherit that process.
- Server logs are typically under live runtime `runtime/logs/web.stdout.log` and `web.stderr.log`; prior command looked at a non-current `web.log`, which may be empty.
- On a real failure: capture `scene.json`, latest attempt, candidate existence, error code, and timestamps before retry/deploy. Do not tell the user it is merely “QA failed” without evidence.

## 11. Important UX requirements from the user

- Mobile iPhone 16:10 vertical workflow must fit one screen wherever possible; no forced swipe to reach the next core action.
- First screen fades into the active next screen rather than a vertical swipe stack.
- Pipeline graph is technical/evaluator-facing: multi-row nodes, active green, passed green, pending grey, explanatory checkpoint info. It must reflect server state.
- AI animation must be large, subtle, slow pulse, with true upload/progress slider under it—not button-sized decorative animation.
- The blank visual area in live graph should show actual generated intermediate: segmentation/mask/normalization/candidate when available; never fake “pixel-by-pixel” work.
- Existing avatar must be selectable/clickable; `Додати речі` must go directly to that avatar’s add-items flow. It must not redirect to new-avatar creation.
- Once an approved look exists, product needs UI to keep/add garments to the chosen avatar and save more looks. Browser-only profile is acceptable for now; user asked for persistence around 30 days (previously 15 minutes was also considered; do not silently choose a short TTL).
- Remove developer-facing “реальний upload” type copy from UI. Upload progress is expected to be real by definition.
- No PIN currently: test surfaces should be accessible without PIN until user explicitly restores it.
- Avoid English/internal terminology in user UI. “Garment passport / Garment fidelity” was rejected; use clear Ukrainian such as `Картка речі`, `Відповідність речі оригіналу`.

## 12. Scene / editorial product direction already agreed

### Standard scenes

Need versioned, owned/generative reference packs. Reference roles:

1. `environment_anchor`
2. `lighting_anchor`
3. `composition_anchor`
4. `palette_anchor`
5. `negative_reference`

Common framing lock: vertical 4:5, full body, head/shoes fully in frame, subject 74–78% frame height, 50 mm-like perspective, no random bags/jewellery/extra garments, hands separated from body.

Do not treat standard studio as one style. Ideas explicitly approved for mood packs include:

- peach/light studio;
- white studio with early-morning/golden-hour sun rays and window blind/honeycomb pattern on face/wall;
- dramatic Rembrandt studio (triangle of light on shadow cheek);
- early-morning or golden-hour editorial exterior;
- regenerate environment references into owned glossy fashion plates before public preset use.

### Art Fashion / editorial

This is a separate “Фотосесія за моїми референсами” flow. User inputs unsorted refs; extraction makes a `Shoot Bible` before spending generation: locations, light, pose, limbs/gaze, camera, crop, composition, palette, grade, interaction/props. Hero is validated first; remaining frames concurrency 2; retry only bad frame.

The initial canonical slots: full-body hero; static 3/4; walking/dynamic; sitting/architectural; detail accessory; wide campaign frame. Exact style should derive from licensed/owned user reference material (e.g. Edwin Novak photo department) rather than copying external editorial images.

## 13. Repository safety and backup

At handoff the current worktree is intentionally dirty: roughly 8k insertions in tracked code and substantial untracked source/tests/config. It is more than a cosmetic branch.

Before editing or switching branches:

```bash
git status --short
git diff --check
git switch -c backup/zeely-handoff-2026-07-24
```

Commit source/docs/tests/config/assets/presets deliberately. Do **not** blanket `git add -A` without inspecting:

- exclude `.codex/` (session-local metadata), runtime state, logs, temp candidates;
- never commit secrets/credentials/Keychain/cloudflared account credentials;
- `output/` is large (~91 MB); commit only if its changed artifacts are intended canonical fixtures, otherwise leave out and record the reason.

Run a secret scan before push. If the user explicitly asks to retain private project secrets in private Git, still do not commit credentials here without checking current platform/security policy; prefer encrypted backup already described in `DEPLOYMENT_UA.md`.

## 14. Files that explain the wider project

- [`ZEELY_EXECUTION_PLAN_UA.md`](ZEELY_EXECUTION_PLAN_UA.md) — original execution plan.
- [`ZEELY_TEST_PIPELINE_SCHEME_UA.md`](ZEELY_TEST_PIPELINE_SCHEME_UA.md) — test pipeline.
- [`ZEELY_MARKET_TECH_REPORT_UA.md`](ZEELY_MARKET_TECH_REPORT_UA.md) — market/competitor research.
- [`LIVE_MONITORING_UA.md`](LIVE_MONITORING_UA.md) — monitor approach.
- [`MACOS_INCIDENT_2026-07-24_UA.md`](MACOS_INCIDENT_2026-07-24_UA.md) — prior host incident notes.
- [`spec/ZEELY_SCENE_CANON_UA.md`](../spec/ZEELY_SCENE_CANON_UA.md) — scene quality/product canon.

## 15. Handoff success criterion

The immediate completion criterion is not “the app is up.” It is:

1. User opens an already-approved look.
2. Selects a standard scene.
3. Server persists exactly the four approved bindings.
4. GPT Image 2 generates candidate once.
5. QA completes and either produces an approved scene or a truthful actionable visual-gate failure.
6. A transient QA/persistence failure reuses the candidate and says exactly what is being retried; it does not call it a creative/visual rejection and does not require user to start over.
7. Live UI/SSE/monitor reflect that actual state.

When this is demonstrably working on mobile, proceed to the controlled standard-scene packs and then editorial shoot, not before.

## 16. Encrypted secrets handoff (local only; never Git)

An encrypted continuation archive is stored locally at:

```text
secrets/zeely-agent-handoff-2026-07-24.tar.gz.enc
SHA-256: 354d518bb95271693f5fe43b448d460fe0e79db7f1bb59380d5c0d8dcc1d1caa
```

It contains only the project-scoped recovery material: runtime demo PIN, runtime session secret, and the named Cloudflare Tunnel credential JSON. It intentionally excludes account-wide GitHub, ChatGPT/Codex, browser and Cloudflare account credentials.

The complete project authorization boundary and target-host re-authentication procedure is documented in [`ZEELY_AUTH_CONTINUITY_UA.md`](ZEELY_AUTH_CONTINUITY_UA.md); the same non-secret registry is also inside the encrypted archive.

The decryption key is **not** in the repository or alongside the archive. On this same authorized macOS user account it is in Keychain as:

```text
service: com.madeforthisjob.zeely.agent-handoff-20260724
account: current macOS username
```

An authorized continuation agent on this Mac can decrypt to a freshly-created temporary directory with:

```bash
handoff_key=$(security find-generic-password \
  -a "$(id -un)" \
  -s "com.madeforthisjob.zeely.agent-handoff-20260724" \
  -w)
export ZEELY_AGENT_HANDOFF_KEY="$handoff_key"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass env:ZEELY_AGENT_HANDOFF_KEY \
  -in secrets/zeely-agent-handoff-2026-07-24.tar.gz.enc \
  | tar -xzf - -C "$(mktemp -d)"
unset ZEELY_AGENT_HANDOFF_KEY handoff_key
```

Do not print the decrypted values, commit them, or extract them into the repository. The archive is intentionally local-excluded from Git; pass the encrypted file and the Keychain-access instruction through separate authorized channels when moving to another host.
