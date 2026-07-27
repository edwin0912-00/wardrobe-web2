# Zeely agent-coordination loop

Це bounded Looper-пакет для оркестратора. Він використовує лише checked-in
deterministic reporter: читає canonical GitHub board та sanitized status
artifacts, перевіряє їхній контракт і створює власний coordination report. Він
**не** запускає LLM, не будить і не імітує зовнішнього агента; не редагує
продукт; не пушить; не деплоїть; не працює з credentials, prompts або media.

Запуск у session:

```bash
python3 run-loop.py --spec loop.resolved.json
```

Спершу згенеруй `loop.resolved.json`, `LOOP.md` і `RUN_IN_SESSION.md` через
Looper compiler, потім прибери compiler-local source path:

```bash
node tools/coordination/sanitize-looper-resolved.mjs \
  --file ops/zeely-agent-coordination-loop/loop.resolved.json \
  --source ops/zeely-agent-coordination-loop/loop.yaml
```

Loop має жорсткі межі: максимум 12 ітерацій, 30 хвилин,
два однакові no-progress сигнали, 0.01 USD schema guard без права на paid
action. Якщо він бачить
`STATUS_NOT_PUBLISHED`, `STATUS_INVALID` або `AGENT_BRANCH_UNAVAILABLE`, це
не дозвіл втручатися в чужу гілку: він лише фіксує точний typed follow-up для
оркестратора.
