# Zeely — реєстр авторизацій для продовження роботи

Цей файл описує **всі авторизаційні залежності Zeely**, але не містить секретів. Він потрібен іншому агенту, щоб зрозуміти, що вже доступно на тому самому Mac, а що потрібно переавторизувати на іншому хості.

## Scope

Не експортувати весь macOS Keychain, Chrome profile, browser cookies, GitHub account token або account-level Cloudflare credential. Це виходить за межі Zeely та дає доступ до інших сервісів користувача.

Натомість encrypted project handoff містить рівно project-scoped material, необхідний для відновлення public Zeely runtime.

## Матриця авторизацій

| Залежність | Для чого | Як використовується | Передача між агентами |
|---|---|---|---|
| Zeely session secret | anonymous browser profile cookie verifier | Fastify runtime/private | у encrypted Zeely archive |
| Zeely demo PIN | optional gate, зараз вимкнений | Fastify runtime/private | у encrypted Zeely archive |
| Cloudflare named Tunnel credential | public HTTPS tunnel `zeely-madeforthisjob` | `cloudflared` LaunchAgent | у encrypted Zeely archive |
| Cloudflare account auth / `cert.pem` | DNS, route and dashboard administration | локальний Cloudflare user credential store | не переносити; на новому host авторизуватись окремо або передати project-scoped Cloudflare API token лише якщо це явно потрібно |
| Codex / ChatGPT authenticated session | GPT Image 2 generation і VLM QA via local Codex app-server | local `codex` executable + current user session | не експортувати session/cookies; continuation agent на цьому Mac використовує наявну session, на іншому host — owner входить заново |
| Higgsfield CLI auth | allowed fallback transport | `/Users/jarvis1/.local/bin/higgsfield` + its credential store | не експортувати account credentials; verify/re-auth on target host only if fallback route actually used |
| GitHub auth | backup/push private repo | `git` remote plus `gh`/SSH credential store | не переносити token; same Mac uses current auth, other host needs collaborator access and its own sign-in |

## Required preflight for a continuation agent

On the same authorized Mac, verify availability without printing secrets:

```bash
curl -sS https://www.madeforthisjob.com/api/health
command -v codex
command -v higgsfield
command -v cloudflared
git -C /Users/jarvis1/Documents/Codex/2026-07-19/mvp-zeely-format-html5-1-2 remote -v
```

For a different Mac, restore only the encrypted Zeely runtime archive, then ask the owner to authenticate Codex/ChatGPT, GitHub, Higgsfield (if needed), and Cloudflare admin separately. Do not attempt to transfer browser session cookies or entire OS credential stores.

## Project-secret archive

The portable encrypted archive contains only:

```text
runtime/private/demo-pin
runtime/private/session-secret
cloudflared/<project tunnel id>.json
AUTH_CONTINUITY_UA.md
```

The archive key is held in the macOS Keychain on the authorized production account; it is never committed or written next to the archive.
