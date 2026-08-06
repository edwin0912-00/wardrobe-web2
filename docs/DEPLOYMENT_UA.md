# Zeely beta — deployment runbook

## Публічні адреси

- `https://beta.madeforthisjob.com/api/health` — єдиний canonical external health target для release та recovery CLI.
- `https://monitor.madeforthisjob.com` — live operations monitor.

Release та recovery приймають лише точне значення `https://beta.madeforthisjob.com/api/health` для `--external-health-url`. Старі `www`, `iwas`, apex або довільні HTTPS URL не є fallback і мають бути відхилені до будь-якої зміни live state.

Studio hostnames проходять через Cloudflare named Tunnel `zeely-madeforthisjob` до `http://127.0.0.1:4173`; monitor hostname — до окремого `http://127.0.0.1:4174`. Зараз обидві surfaces тимчасово відкриті для тестування без PIN. Старі credentials залишені лише локально, тому захист можна повернути без ротації; secrets у Git не зберігаються.

## Runtime на macOS

| Компонент | LaunchAgent | KeepAlive |
|---|---|---|
| Fastify web app | `com.madeforthisjob.zeely` | так |
| Fastify live monitor | `com.madeforthisjob.monitor` | так |
| Cloudflare Tunnel | `com.madeforthisjob.cloudflared` | так |

Tunnel config: локальний шлях поза Git (`$ZEELY_TUNNEL_CONFIG`).

Перевірка стану:

```bash
launchctl print gui/$(id -u)/com.madeforthisjob.zeely
launchctl print gui/$(id -u)/com.madeforthisjob.monitor
launchctl print gui/$(id -u)/com.madeforthisjob.cloudflared
curl -I https://beta.madeforthisjob.com/api/health
```

Безпечний restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.madeforthisjob.zeely
launchctl kickstart -k gui/$(id -u)/com.madeforthisjob.monitor
launchctl kickstart -k gui/$(id -u)/com.madeforthisjob.cloudflared
```

Після logout/login LaunchAgents стартують автоматично. Наявні системні налаштування Mac відповідають за роботу без idle sleep; цей deployment їх не змінює. Mac усе одно потребує живлення та стабільного інтернету. Після logout або повного power-off сайт недоступний, доки користувач знову не ввійде в macOS.

## Завершити apex domain

У Cloudflare Dashboard → `madeforthisjob.com` → DNS → Records видалити старі `A`, `AAAA` або `CNAME` records з Name `@`/`madeforthisjob.com`. Не чіпати `www` та `beta`. Потім виконати:

```bash
cloudflared tunnel route dns zeely-madeforthisjob madeforthisjob.com
```

Після цього `https://madeforthisjob.com` має відкривати studio, а не Cloudflare 404.

## Backup boundary

Зашифрований `secrets/zeely-runtime-private.tar.gz.enc` містить PIN, session secret і project-scoped Tunnel credential. Ключ шифрування залишається у macOS Keychain. Account-level Cloudflare `cert.pem` у Git не потрапляє.

## Жорстка межа зберігання — не переносити runtime

Зовнішній SSD призначений **лише** для versioned release-збірок, резервних
копій, закритих reference media та архівованих завершених результатів. Він не
є runtime-диском beta.

Ніколи не переносити, не симлінкувати на зовнішній SSD і не чистити
автоматично:

- `node_modules`, Node runtime, `higgsfield`/`codex` CLI та їхні executable
  залежності;
- код активного release, LaunchAgent runner/plist і його stdout/stderr;
- `.env`, Keychain/credential paths, session secrets або будь-які runtime
  конфіги;
- активні `runs`, `scenes`, `video-clips`, SQLite/receipts та незавершені
  provider jobs.

Ці шляхи мають лишатися на внутрішньому SSD: beta повинна переживати restart
macOS навіть коли зовнішній диск відключений.

Можна переносити тільки за явним allowlist після завершення job і перевірки
відновлення: cache каталоги, локальні preview/derivative copies, immutable
release archives, резервні копії та media, які не потрібні запущеному job.
Перед будь-яким перенесенням перевірити, що шлях не читається LaunchAgent,
поточним release або active run. Секрети не потрапляють у Git або зовнішній
архів без окремого зашифрованого backup-процесу.
