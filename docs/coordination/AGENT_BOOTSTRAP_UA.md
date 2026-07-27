# Wardrobe: стартовий пакет для агента

Цей файл — короткий, перевірюваний контекст для будь-якого нового агента.
Не замінює `AGENTS.md`, `OWNERS.md`, `TASKS.json`, `STATE.md` або `LOG.md`:
саме вони, прочитані з одного exact commit
`origin/integration/wardrobe-20260726`, є джерелом правди.

## 1. Безпечне підключення до GitHub

Кожен агент працює під окремим GitHub-акаунтом або окремим deploy-free SSH
ключем. Ніколи не передавати між агентами PAT, `GH_TOKEN`, браузерні cookies,
SSH private key чи локальний профіль.

1. Власник додає GitHub-акаунт як collaborator з роллю **Write**:
   <https://github.com/edwin0912-00/zeely-ai-engineering-test/settings/access>.
2. Агент авторизується на своєму комп'ютері через device flow:

   ```bash
   gh auth login --web --git-protocol ssh
   ```

   Код відкривається на <https://github.com/login/device>.
3. Додає лише свій public SSH key у
   <https://github.com/settings/keys>, потім перевіряє доступ:

   ```bash
   gh auth status
   git ls-remote git@github.com:edwin0912-00/zeely-ai-engineering-test.git HEAD
   ```

GitHub-акаунт робить дію аудитовною; `agent_id` у файлах — лише routing label,
не криптографічна ідентичність.

## 2. Один порядок старту

```bash
git clone git@github.com:edwin0912-00/zeely-ai-engineering-test.git wardrobe
cd wardrobe
git fetch origin --prune
git show origin/integration/wardrobe-20260726:AGENTS.md
git show origin/integration/wardrobe-20260726:OWNERS.md
git show origin/integration/wardrobe-20260726:STATE.md
git show origin/integration/wardrobe-20260726:TASKS.json
git show origin/integration/wardrobe-20260726:LOG.md
WARDROBE_AGENT_ID=<agent-id> node tools/coordination/watch-assignments.mjs --interval 20
```

Знайди рівно одну active задачу, де одночасно збігаються `owner`, `branch` і
непрострочений lease. Прочитай кожен `required_context` саме з її `base_sha`.
Відгалузь isolated worktree від цього SHA; не ребейзь тихо і не бери чужий
lock group. Якщо відповідної задачі немає — тільки read-only робота.

Після цього перевір `allowed_paths` своєї active task. Якщо там є рівно
`.agents/status/<TASK-ID>.json`, опублікуй `STARTED` так:

```bash
node tools/coordination/validate-board.mjs
WARDROBE_AGENT_ID=<agent-id> node tools/coordination/publish-agent-status.mjs \
  --task <TASK-ID> --state STARTED \
  --summary-code CONTEXT_READ \
  --next-action-code RUN_PRECHANGE_PROOF
git add .agents/status/<TASK-ID>.json
git commit -m 'status: <TASK-ID> started'
git push origin lane/<TASK-ID>/<agent-id>
```

Якщо exact status path відсутній, це legacy lease: не запускай publisher,
не створюй status-файл і не вважай помилку `STATUS_PATH_NOT_LEASED` blocker-ом.
Продовжуй лише в межах решти виданого lease та передай результат через handoff/PR.

У довгій роботі повторюй `HEARTBEAT` після фактичного checkpoint і щонайменше
раз на 10 хвилин. `STARTED` або `HEARTBEAT` старше 15 хвилин watcher позначить
як `STATUS_STALE`. Якщо не можна просунутися без порушення stop condition,
одразу опублікуй `BLOCKED` з `--blocker-code <BLOCKER_CODE>`. Статус має лише
закриті коди зі `schemas/agent-status.schema.json`, без будь-якого довільного
тексту; watcher рендерить перевірені людські label-и локально. Listener не запускає модель сам; він лише надійно
доставляє зміну черги до постійного agent runner.

## 3. Єдина дисципліна роботи

- Одна задача → один agent → одна гілка `lane/<TASK-ID>/<agent-id>` → один
  worktree.
- Перед зміною правила шукай усі його enforcement sites: producer, contract,
  schema, persistence, evaluator, release tool, UI adapter і tests. Один
  власник правила; решта викликає його.
- Новий regression test мусить падати на pinned pre-change code. Старий test,
  що проходив до зміни, — лише регресійний сторож.
- Після блоку роботи зроби adversarial review: шукай suppressed check,
  widened lock, прихований fallback, переописані докази або scope drift.
  `weakened_checks` у handoff мусить бути порожнім.
- Фінальний commit у lane містить лише
  `.agents/handoffs/<TASK-ID>.json`. Код, тести й status commits мають бути
  раніше. Потім PR тільки в `integration/wardrobe-20260726`.
- Не пуш у `main`; не пуш у integration; не деплой; не чіпай credentials,
  `site.madeforthisjob.com` або порт `4180`.

## 4. Що є окремими pipeline-ами

```text
PROFILE / AVATAR LIBRARY
  browser-bound profile → approved avatar → immutable white-background master
  → add-items lineage → approved look

STANDARD BACKGROUNDS (std.*)
  approved look + one selected standard environment
  → five ordinary photos with varied poses → normal scene QA

FASHION PHOTOSHOOT (shoot.*)
  approved look + one locked Create Universe style unit
  → Shoot Bible + contact sheet → six art-directed slots
  → identity/item/scene/style-faithfulness QA

VIDEO
  only after still-image/editorial contracts are stable
  → eligible reference bundle → Seedance 2.0 reference-based video → QA
```

`std.*` і `shoot.*` — різні продукти. Background — вибір середовища для
звичайних фотографій. Photoshoot — нероздільна одиниця: локація, атмосфера,
світло, оптика, grade, пози, framing і reference pack. Ніколи не підміняти
photoshoot stock-перемикачем фону й не повертати `EDITORIAL_BASE_PRESETS`.

### Full-body contract

- Core avatar, immutable white master і standard scenes мають бути
  **full-length**: голова й взуття повністю в кадрі; standard scene uses its
  dedicated framing contract.
- Editorial/photoshoot **не має глобальної full-body вимоги**. Кожен slot
  має свій доказовий crop contract. Не вигадувати правило «3/4 забороняє
  стопи» чи навпаки; оцінювати лише observable crop.

## 5. Канон маршрутів моделей

Назви нижче мають різні рівні. `route_key` — стабільний внутрішній ключ
pipeline; provider ID — зовнішній і не може непомітно змінюватися в adapter.

| Scope | Internal `route_key` | Display | Approved provider model / snapshot |
|---|---|---|---|
| Основний still-image | `gpt_image_2` | GPT Image 2 | `gpt-image-2`, snapshot `gpt-image-2-2026-04-21` |
| Fallback still-image | `nano_banana_flash` | Nano Banana 2 | `gemini-3.1-flash-image` |
| Quality fallback | `nano_banana_2` | Nano Banana Pro | `gemini-3-pro-image` |
| Основне reference-video | `dreamina-seedance-2-0-260128` | Dreamina Seedance 2.0 | `dreamina-seedance-2-0-260128` |
| Draft/edit only | `gemini_omni_flash_preview` | Gemini Omni Flash Preview | `gemini-omni-flash-preview` |

Runway не є дозволеним model route. Current OpenRouter adapter must not claim
that an unrelated `openai/gpt-5.4-image-2` transport is GPT Image 2; that
mapping requires a separate provider-contract task or a fail-closed disable.
Model policy is a common rule surface: route key, contract, receipt,
idempotency, safe metadata allowlist, provider adapter and tests move together.

Seedance 2.0 is reference-based, but a human reference may travel only through
a Reference Eligibility Gate: authority/consent, source provenance, allowed
provider route and exact reference class must all pass. If any is missing,
fail closed; do not substitute another model or reference.

## 6. Fashion-shoot / Create Universe contract

`STYLE-001` builds reusable **style units**, not a generated campaign and not
a hidden generic preset. One unit contains only verified, role-specific facts:

```text
Create Universe style unit
├── identity: style-unit id, version, rights/provenance, hashes
├── location/environment anchors
├── lighting + grade anchors
├── optics/composition anchors
├── pose/blocking anchors per frame slot
├── negative constraints
├── UNKNOWN facts kept explicitly UNKNOWN
└── Shoot Bible compilation rules
```

The Fashion Shoot service later binds exactly one approved look and one locked
style unit. It generates/approves hero first, then independent slots, exposes a
private immutable contact-sheet manifest only after completion, and reruns only
the failed slot. User-supplied source reference packs must not be silently
published, copied, or marked approved without rights and hash evidence.

Key surfaces:

- style unit: `skills/artshoot-pipeline-style-creation/**`,
  `docs/style-units/**`, `test/style-units/**`;
- contact-sheet: `src/web/editorial-contact-sheet.js`,
  `src/web/editorial-shoot-routes.js`;
- editorial contract/service/Bible: `src/web/editorial-shoot-*.js`,
  `schemas/editorial-*.schema.json`;
- standard scenes: `spec/ZEELY_SCENE_CANON_UA.md`,
  `src/web/scene-*.js`, `schemas/scene-*.schema.json`,
  `assets/scene-presets/**`, `prompts/scenes/**`.

## 7. Operational sources and current priorities

| Vector | Canonical surface | Current owner from board |
|---|---|---|
| Standard-scene headroom | `scene-core` | `WARD-002` / `claude-code-dev` |
| Style-unit evidence | `media-assets` | `STYLE-001` / `codecod` |
| Saved avatar + add-items lineage | `profile-runs` | `PROFILE-001` / `opencode` |
| Live sanitized monitor | `core-pipeline` | `MONITOR-001` / `antigravity` |
| Private contact-sheet manifest | `editorial` | `SITE-002` / `codex-contact-sheet` |
| Agent queue + reports | `coordination` | `CTRL-002` / `codex-main` |

Read `TASKS.json` rather than trusting this table for live state. The
orchestrator is the only merger and verifies scope, pre-change proof, focused
tests, base compatibility, adversarial review, and `weakened_checks` before
issuing an integration task.

## 8. Source references for naming and provider behavior

- OpenAI GPT Image 2: <https://developers.openai.com/api/docs/models/gpt-image-2>
- Google image-generation model names: <https://ai.google.dev/gemini-api/docs/image-generation>
- Dreamina / Seedance model route: <https://docs.byteplus.com/en/docs/modelark/1520757>
- Seedance reference-video request behavior: <https://docs.byteplus.com/en/docs/ModelArk/2291680>

External documentation informs identifiers; the checked-in contract and test
must still prove the actual adapter mapping before a route is enabled.
