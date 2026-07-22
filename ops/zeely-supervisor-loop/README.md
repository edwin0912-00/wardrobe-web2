# ZEELY live supervisor loop

Цей Looper-пакет задає безпечну межу для одного production incident: sanitized JSON і код можна читати; runtime images, drafts, secrets і credentials не можна відкривати або передавати. Agent може підготувати patch і тести, але commit/push/deploy виконуються лише після незалежної перевірки основним процесом.

Поточний restart prompt: `RUN_IN_SESSION.md`. Advanced runner: `run-loop.py`.
