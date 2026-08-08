# 12 — стиснений журнал логічних оновлень

Це короткий operational view поверх append-only `LOG.md` і `updates/*.md`.
Один рядок означає одну логічну зміну системи, а не кожен технічний коміт.
Повний forensic trail не видалений: точні SHA, проміжні failures і agent
handoffs залишаються у вихідних журналах.

## Current logic rows

| Дата | Область | Логічне оновлення | Поточний наслідок | Evidence/state |
|---|---|---|---|---|
| 2026-07-26–27 | Coordination | Введено OWNERS/LOG/STATE, lane ownership, agent IDs, live board і handoff files | агенти працюють у своїх paths і звітують через Git | historical coordination entries; superseded branch model |
| 2026-07-27 | Product map | Розділено master look, backgrounds, Create Universe/Fashion Shoot, Fashion Video і Real-time Look | downstream-гілки незалежні від одного approved look | `PIPELINE-MAP`, `VIDEO-LIVE-CANON` |
| 2026-07-28 | Post-look UI | Зафіксовано action hub, Light Stage, refine/background/shoot/video/live actions | product naming не залежить від внутрішніх task IDs | `CHOICE.01–02`, `LIGHT-STAGE.01` |
| 2026-07-29 | Runtime safety | Додано active-work deploy guard, restart/resume, immutable candidate checkpoints | restart не має повторно купувати той самий job; deploy не перебиває active run | restart/deploy guard tests and releases |
| 2026-07-29 | Standard scenes | Опубліковано 16 `std.*` backgrounds; delivery зафіксовано як native 3:4 | background є окремим блоком із власним framing/QA | scene catalog and contract evidence |
| 2026-07-29–30 | Upload/profile | Додано drag-and-drop, HEIC fallback, multi-look selection і durable saved-look evidence | picker/drop мають один contract; saved look переживає lifecycle | upload/profile focused tests |
| 2026-07-30–08-01 | Create Universe | Style pack став versioned набором sources, observations, sheets і slot-specific references | incomplete/legacy packs не повинні виглядати як READY | style manifests and contract verifier |
| 2026-07-29–08-03 | Fashion Shoot | Пʼять named slots запускаються паралельно; retry лише failed slot; approved frames приходять прогресивно | UI має показувати 0–5, preview і download кожного готового кадру | service/route tests; live paid browser journey needs re-verification |
| 2026-07-30–08-03 | Fashion Video | Reference video став private directing authority; white master, cut sheet, per-cut QA, bounded retries і delivery assembly | source performer/source footage не може потрапити у delivery; provider audio замінюється або прибирається | video contract/tests; full current paid E2E not reverified |
| 2026-07-30 | Realtime | Real-time Look відокремлено від saved MP4 і привʼязано до explicit camera/token session | FAL/Lucy має лише realtime роль | route/security tests; paid/live camera E2E not reverified |
| 2026-08-02 | Image policy | Нові image attempts переведено на GPT Image 2 ladder: low/1k repairs → medium/2k → high/4k | Nano Banana IDs залишились тільки для resume старих receipts | `src/runner/model-policy.js` tests |
| 2026-08-03–04 | Delivery | Додано preview derivatives, saved scene/shoot/video library, structured failure codes і real README bridge smoke | UI має брати lightweight preview; download — original; errors не маскуються як connection failure | focused delivery/README tests |
| 2026-08-06 | Provider removal | Higgsfield прибрано з active runtime graph | historical adapters/receipts audit-only; re-enable заборонено без нового рішення | provider construction tests and policy |
| 2026-08-08 | Provider primary | Image/scene primary став Codex Worker; OpenRouter — guarded pre-submit fallback, VLM і explicit video adapter | unknown submit outcome не створює другий paid request | provider/preflight focused PASS |
| 2026-08-09 | Release topology | Створено єдину `alpha` integration/version/deploy line; `beta` і `canonical` — mirrors | нові зміни не розʼїжджаються по трьох release branches | remote refs synchronized |
| 2026-08-09 | Canon | Додано `docs/canonical/*` як актуальну source/runtime-aware точку входу | старі LOG/updates — forensic evidence, не current status | canonical link/secret/diff checks PASS |
| 2026-08-09 | Storage hygiene | Прибрано три clean detached temp worktrees, stale worktree metadata і старий Playwright revision; текстові runtime logs архівовано на зовнішній SSD і active files обнулено | runtime media, SQLite, receipts, current release, Codex sessions і current docs worktree не чіпались | filesystem/health verification після cleanup |

## Current ownership rows

| Логічний блок | Owner/report | Поточне джерело істини |
|---|---|---|
| Integration/deploy | chat-00-master | `OWNERS.md`, `STATE.md`, `LOG.md`, `ops/RUNTIME.json` |
| Core look/image/background QA | codex-main / Chat 01 | `updates/codex-main.md`, Block 1 tests |
| Profile/upload UI | Chat 02 | `updates/chat-2.md` |
| Standard background catalog/UI | Chat 03 | `updates/chat-3.md` |
| Create Universe packs | Chat 04 | `updates/chat-04.md`, `updates/chat-4.md` |
| Fashion Shoot | Block 5 / Chat 04 | editorial service/contracts + Chat 04 reports |
| Fashion Video | Chat 05 | `updates/chat-5.md`, video tests/receipts |
| Main cinematic site | Chat 06 | `updates/chat-6.md` + alpha-integrated source |
| Real-time Look | Chat 07 | `updates/chat-7.md` |
| Independent browser QA | Antigravity / handoff QA | `updates/antigravity-qa.md`, `updates/handoff-cloud-code-qa.md` |

## Rule for new rows

Кожне нове інтегроване рішення додає один рядок:

```text
date | logical area | what changed | user/runtime effect | exact evidence/state
```

Не копіювати сюди raw reasoning, довгі stack traces або всю історію retry. Вони
залишаються в agent report/receipt. Якщо рядок суперечить current code/live
evidence, він оновлюється новим рядком, а старий не видаляється.
