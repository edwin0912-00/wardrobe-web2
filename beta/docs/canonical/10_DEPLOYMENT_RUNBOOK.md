# 10 — install, verify, deploy і rollback

## Clean install

У clean clone не повинно бути потрібних для роботи незакомічених файлів.
Секрети налаштовуються окремо на host:

```bash
git clone <repository>
cd <repository>
git switch alpha
npm ci
npm run verify:readme
```

`npm run verify:readme` має реально підняти Fastify surface, пройти browser
asset imports і перевірити `/api/health`, `/app.js`, `/scene-ui.js`; простого
пошуку рядків у коді недостатньо.

Без credentials local app запускається у чесному degraded mode: каталоги,
profile/history/UI доступні, а paid generation повертає structured
`GENERATION_UNAVAILABLE`. Це очікувана поведінка, не mock success.

## Pre-deploy checks

```bash
git status --short
git diff --check
node tools/validate-contracts.mjs
node tools/validate-canon.mjs
node --test test/providers/higgsfield-cli-provider.test.js \
  test/web/preflight.test.js test/web/scene-runtime.test.js
node --test test/video/*.test.js
```

До release перевірити, що `origin/alpha` містить очікуваний source SHA, а
`OWNERS.md`, `STATE.md`, `LOG.md`, `ops/RUNTIME.json` не суперечать один одному.
Повний `npm test` запускати, коли resource preflight дозволяє; якщо ні —
публікувати exact blocker, а не обходити його.

## Product artifact

Офіційний порядок для поточного runtime overlay:

```bash
node tools/build-product-release.mjs /absolute/new-release
node tools/verify-product-release.mjs /absolute/new-release
```

Перевірка має підтвердити manifest, allowlist, hashes, cache binding, privacy,
provider policy і відсутність небезпечних symlink/секретів.

## Official deployment

Використовується лише `tools/deploy-beta-release.mjs --apply` через release
owner. Реальні шляхи до runner/plist і HTTPS origin беруться з host ops config;
їх не вигадують у чаті. Типова форма:

```bash
node tools/deploy-beta-release.mjs --apply \
  --release /absolute/new-release \
  --runner /absolute/run-beta-daemon.sh \
  --beta-plist /absolute/com.madeforthisjob.beta.plist \
  --local-health-url http://127.0.0.1:4176/api/health \
  --external-health-url https://beta.madeforthisjob.com/api/health
```

Deploy guard зупиняє операцію, якщо є active work/run IDs. Не вбивати daemon
або сайт «для чистоти» без перевірки active transactions.

## Post-deploy evidence

```bash
curl -fsS https://beta.madeforthisjob.com/api/health
curl -fsS https://madeforthisjob.com/api/health
curl -fsS https://site.madeforthisjob.com/api/health
curl -fsS https://beta.madeforthisjob.com/api/scene-presets
curl -fsS https://beta.madeforthisjob.com/api/editorial-modes
```

Записати `source_sha`, `runtime_release_sha`, `cache_token`, UTC time, health
status і focused smoke result. Product UI перевірити як мінімум для: upload,
master look, один background route, один Fashion Shoot catalog route і video
capability/error route. Paid E2E запускати тільки з approved test input.

## Rollback

1. Визначити bad runtime release з health/monitor evidence.
2. Перевірити, що попередній release immutable і не має активного job conflict.
3. Застосувати офіційний recovery/deploy tool, не копіювати файли вручну.
4. Повторити local/external health і записати rollback pair у `LOG.md`.
5. Залишити невдалий artifact для audit; не переписувати історичний receipt.
