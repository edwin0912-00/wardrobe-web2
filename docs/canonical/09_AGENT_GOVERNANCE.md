# 09 — агентська координація і правила змін

## First read

Кожен агент перед дією читає:

```text
AGENTS.md
OWNERS.md
STATE.md
LOG.md
ops/RUNTIME.json
docs/canonical/README.md
docs/canonical/01_RELEASE_AND_STATUS.md
```

Потім робить `git fetch --all --prune` і звіряє свою гілку з `origin/alpha`.
Документація є спільною памʼяттю, але не дозволом обходити owner boundaries.

## Ownership

* `chat-00-master` — єдиний release/integration owner: `alpha`, mirrors,
  deploy, rollback, `OWNERS.md`, `STATE.md`, `LOG.md`, `TASKS.json` і reports.
* Block 1 / `codex-main` — input conditioning, avatar/look, image/VLM,
  background contracts і core QA.
* Block 2 — profile/upload/progress/choice UI.
* Block 3 — standard backgrounds і scene UI.
* Block 4 — Create Universe style packs, sheets, manifests і catalog.
* Block 5 — Fashion Shoot executor, slots, QA, retry, persistence і UI.
* Block 6 — Fashion Video transport, cut sheet, QA, persistence і UI.
* Block 7 — Real-time Look camera/token/session lifecycle.
* Block 0.8 — Antigravity read-only public beta browser QA.
* Chat 06 — separate main-site/presentation product; не редагує engine blocks.

Остаточна thread/agent mapping —
`docs/coordination/BETA_THREAD_OWNER_MAP.json`. Цей список не замінює owner
reservation у `TASKS.json`.

## Branch and commit protocol

```text
agent branch → focused tests → agent report → release-owner review
           → alpha integration → full/contract verification → deploy report
```

Не пушити напряму в `main`. Не робити silent cherry-pick лише частини merge,
якщо PR містить залежні commits. Не комітити код іншого lane, щоб «швидше
зійшлося». Якщо у робочому дереві є чужі зміни — зупинитися, зафіксувати
конфлікт у report і працювати в clean worktree.

## Mandatory report fields

```text
agent / block / branch
source SHA
files changed
focused tests + exact result
full-suite result or explicit NOT_RUN/blocker
runtime/deploy status
paid generation: RUN / NOT_RUN
weakened_checks: [] or exact list
next owner/action
```

«Tests pass» без числа і команди не є evidence. «Not deployed» означає, що
зміна лишилася на agent branch; release-owner вирішує, чи вона входить в
product artifact.

## Communication files

* `updates/<agent-id>.md` — думка, контекст, findings і handoff конкретного
  агента.
* `LOG.md` — один рядок на кожну інтегровану зміну: що, навіщо, доказ.
* `STATE.md` — тільки поточний verified state, blockers і evidence.
* `TASKS.json` / coordination board — owner, state, paths і next action.

Ніхто не використовує чат як єдину памʼять. Чат може містити рішення, але воно
стає canonical лише після запису в Git з точним commit/evidence.

## Stop conditions

Без явного product-owner рішення агент не може:

* додавати відсутні пікселі/людей/фон або послаблювати QA gate;
* запускати нову paid generation поза дозволеним тестом;
* вмикати Higgsfield або переносити credentials;
* змінювати runtime root, release cleanup або deploy guard;
* змішувати beta engineering UI з main presentation code.

