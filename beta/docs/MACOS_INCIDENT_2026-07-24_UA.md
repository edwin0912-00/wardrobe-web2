# Інцидент macOS / Codex — 24 липня 2026

## Короткий висновок

Було два різні класи проблем, які не можна змішувати:

1. О 10:18:19 процес Codex усередині ChatGPT аварійно завершився через помилку
   синхронізації `os_unfair_lock`. Crash report прямо містить:
   `Unlock of an os_unfair_lock not owned by current thread`.
   Це програмний crash, а не доведений OOM-kill.
2. Паралельно Mac мав небезпечне фонове навантаження й історично повністю
   заповнений диск. У логах Zeely є `ENOSPC: no space left on device`, що
   пояснює попередній 404/падіння web-процесу.

Після інциденту машина перезавантажувалась о 15:12 та 15:49. Перед обома
перезапусками macOS створив `shutdown_stall` diagnostic report; останній
Cloudflare Tunnel отримав штатний `SIGTERM`, отже принаймні перезапуск
15:49 був керованим shutdown, а не падінням Tunnel.

## Перевірені ресурсні аномалії

- `Google Chrome Helper`: 2,15 ГБ записів за 287 секунд.
- `com.akella.hermes-update-retry-once`: 2,15 ГБ записів за 926 секунд;
  footprint Node зріс приблизно на 511 МБ.
- `ditto` у coalition Codex: 2,15 ГБ записів за 1138 секунд.
- одноразова SQLite maintenance: 2,15 ГБ записів за 58 секунд.
- чотири OpenClaw gateways разом із Hermes/OpenChrome займали сотні
  мегабайтів; один повторно піднятий gateway виріс до 844 МБ RSS.
- `com.jarvis.launchagent-identity-guard` кожні 60 секунд примусово виконував
  `launchctl enable/bootstrap/kickstart`, тому звичайний `bootout` не
  зупиняв стек.
- `ai.akella.browser-cdp` кожні 30 секунд повторно запускав окремий Chrome
  профіль на порту 18860.

## Виконані дії

- Відключено автозапуск фонових Hermes/OpenClaw gateways, updater-ів,
  identity guards, watchdog-ів і технічного CDP Chrome.
- Zeely web, Zeely live-monitor і Cloudflare Tunnel не зупинялись.
- Звичайний користувацький Chrome не закривався.
- Очищено лише відновлювані npm/pip кеші; історія Codex, runtime Zeely,
  профілі користувачів та rollback-версії не видалялись.
- Вільне місце після очищення: приблизно 58 ГіБ.
- Вільна RAM зросла з 34% до 62%; swap зменшився приблизно з 923 МБ
  до 473 МБ.
- Контрольне вікно понад 70 секунд пройдено без повторного запуску
  gateways або технічного Chrome.
- Health polling більше не створює дві Pino log-lines кожні 10 секунд.
- Помилка CLI preflight тепер переводить health у `degraded`, але не валить
  запуск web-процесу й не перетворює домен на 404.

## Постійний захист у Zeely

`tools/resource-preflight.mjs` тепер блокує важкі тести, збірку або деплой,
якщо не виконані пороги RAM, swap, 5-хвилинного load average, диска або
сумарного RSS відомих фонових агентних стеків.

Node test runner обмежено до concurrency 2. Це не може гарантувати, що
сторонній застосунок ніколи не матиме власного software crash, але не дає
нашому pipeline почати важку операцію в уже небезпечному стані.

Найбільше `.codex/sessions` роздувають inline результати image generation,
які дублюються у full-history forks. Для наступних image-heavy підзадач
застосовується ізольований контекст замість повного fork; чинна історія
сесій не редагувалась і не видалялась.
