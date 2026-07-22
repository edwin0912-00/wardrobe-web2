# Zeely beta — deployment runbook

## Публічні адреси

- `https://www.madeforthisjob.com` — активний production hostname.
- `https://beta.madeforthisjob.com` — активний резервний hostname.
- `https://madeforthisjob.com` — очікує заміни старого parking DNS-запису на Tunnel route.

Обидва активні hostname проходять через Cloudflare named Tunnel `zeely-madeforthisjob` до `http://127.0.0.1:4173`. Вхід захищений серверним PIN; PIN не зберігається у відкритому вигляді в Git.

## Runtime на macOS

| Компонент | LaunchAgent | KeepAlive |
|---|---|---|
| Fastify web app | `com.madeforthisjob.zeely` | так |
| Cloudflare Tunnel | `com.madeforthisjob.cloudflared` | так |

Tunnel config: `/Users/jarvis1/.cloudflared/config.yml`.

Перевірка стану:

```bash
launchctl print gui/$(id -u)/com.madeforthisjob.zeely
launchctl print gui/$(id -u)/com.madeforthisjob.cloudflared
curl -I https://beta.madeforthisjob.com/api/health
```

Безпечний restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.madeforthisjob.zeely
launchctl kickstart -k gui/$(id -u)/com.madeforthisjob.cloudflared
```

Після logout/login LaunchAgents стартують автоматично. Наявні системні налаштування Mac відповідають за роботу без idle sleep; цей deployment їх не змінює. Mac усе одно потребує живлення та стабільного інтернету. Після logout або повного power-off сайт недоступний, доки користувач знову не ввійде в macOS.

## Завершити apex domain

У Cloudflare Dashboard → `madeforthisjob.com` → DNS → Records видалити старі `A`, `AAAA` або `CNAME` records з Name `@`/`madeforthisjob.com`. Не чіпати `www` та `beta`. Потім виконати:

```bash
cloudflared tunnel route dns zeely-madeforthisjob madeforthisjob.com
```

Після цього `https://madeforthisjob.com` має повертати PIN-login, а не Cloudflare 404.

## Backup boundary

Зашифрований `secrets/zeely-runtime-private.tar.gz.enc` містить PIN, session secret і project-scoped Tunnel credential. Ключ шифрування залишається у macOS Keychain. Account-level Cloudflare `cert.pem` у Git не потрапляє.
