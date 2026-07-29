# Restart guard: beta після перезапуску macOS

`tools/zeely-boot-guard.sh` запускається через
`com.madeforthisjob.restart-guard` одразу після user-login та далі кожні 60
хвилин. Це не генератор і не deployment agent.

## Що перевіряється

1. launchd-сервіс beta завантажений;
2. canonical Cloudflare tunnel завантажений (guard його не перезапускає);
3. `run-beta-daemon.sh` існує, а його exact `app_root` існує;
4. локальний `/api/health` beta відповідає `ready`;
5. публічний `https://beta.madeforthisjob.com/api/health` відповідає `ready`;
6. `higgsfield account status --json` завершується успішно за 15 секунд;
7. на системному диску лишається хоча б 512 MiB.

Якщо локальний beta health не проходить, guard робить тільки безпечний
`launchctl kickstart` саме для `com.madeforthisjob.beta` і повторює local
health. Він не створює tunnel, не запускає генерацію, не друкує auth-output і
не записує ключі.

Лог: `~/.local/share/madeforthisjob/.zeely-beta-runtime/restart-guard.log`.
Кожен рядок містить `OK` або `WARN`; останній рядок запуску — `SUMMARY`.
