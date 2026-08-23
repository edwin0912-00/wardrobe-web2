# Мобільне посилання на локальний preview

Щоб не відправляти користувачу `localhost`, запускай з кореня workspace:

```bash
npm run share -- --port 4173
```

У будь-якому іншому workspace на цьому Mac доступна та сама команда через
глобальний wrapper:

```bash
/Users/jarvis1/.local/bin/codex-share-preview --port 4173 --background --json
```

Команда не друкує URL, доки не перевірить його через HTTPS. Порядок fallback-ів:

1. уже налаштований `ZEELY_PUBLIC_URL`, `ZEELY_PREVIEW_URL` або `ZEELY_EXTERNAL_URL`;
2. Cloudflare Quick Tunnel (`cloudflared`);
3. `ngrok`;
4. `npx localtunnel`;
5. `localhost.run` через SSH;
6. `zrok public share`.

Перший успішний спосіб, який повернув URL і пройшов `GET /api/health`, одразу
друкується. Якщо `/api/health` не існує у довільному preview-сервері, команда
перевіряє `/` і явно позначає це як fallback у receipt. Для Zeely краще не
використовувати `--no-health-check`.

## Варіанти

```bash
# Інший порт або health endpoint
npm run share -- --port 3000 --health-path /

# Запустити тунель у фоні; receipt зберігається поза Git
npm run share -- --background

# JSON для іншої workspace-команди
npm run share -- --json --background

# Зупинити останній background tunnel
npm run share -- --stop
```

Для першого запуску достатньо мати авторизований/встановлений будь-який один
провайдер. `cloudflared` рекомендований як перший варіант; `ngrok` і `zrok`
можуть вимагати власну авторизацію. Команда не записує токени в Git і не
виводить їх у receipt.

State-файл з PID і URL лежить у `${TMPDIR:-/tmp}/zeely-public-preview.json`,
має mode `0600` і видаляється після Ctrl-C або `--stop`.
