# Wardrobe alpha — один репозиторій, одна установка

Гілка `alpha` містить обидві частини продукту в одному Git-графі:

```text
wardrobe-web2/
├── b/                         cinematic main site
├── adapters/                  browser ↔ API bridge
├── serve.py                   same-origin site/gateway
├── beta/                      complete beta engine and engineering UI
├── release/RELEASE.lock.json  exact source commits and runtime contract
└── scripts/
    ├── install-alpha.sh       install + tests + real HTTP integration check
    ├── run-alpha.sh           starts engine and site together
    └── verify-alpha.mjs       provenance and contract verifier
```

## Встановити й запустити

Потрібні Git, Python 3.10+ і Node.js 22+:

```bash
git clone --branch alpha https://github.com/edwin0912-00/wardrobe-web2.git && cd wardrobe-web2 && ./scripts/install-alpha.sh --run
```

Інсталятор не просто перевіряє наявність рядків у коді. Він:

1. підтверджує, що Git-історія містить точний live main і точний live beta;
2. підтверджує, що `beta/` byte-for-byte відповідає зафіксованому Git tree;
3. не дозволяє непомітно змінити cinematic main поза явним alpha overlay;
4. встановлює locked npm dependencies через `npm ci`;
5. запускає поведінкові тести main, beta startup, contracts, providers і video;
6. реально піднімає обидва процеси та перевіряє beta UI, main UI, API bridge,
   editorial catalog, pipeline presentation і MP4 HTTP Range.

Успішне завершення означає, що локально відкриваються (якщо стандартний порт
вже зайнятий, runner безпечно вибере наступний вільний і надрукує точну адресу):

- main site: `http://127.0.0.1:4173/b/`;
- beta engineering UI: `http://127.0.0.1:4176/`;
- API через main: `http://127.0.0.1:4173/api/health`.

## Що навмисно не входить у Git

Приватні авторизації Higgsfield/Codex, API keys і user runtime не можна
публікувати в репозиторії. Без них обидва сайти та API запускаються, а health
чесно показує degraded provider state. Для реальної платної генерації на
конкретному комп’ютері мають окремо проходити:

```bash
higgsfield account status --json
codex login status
```

Це єдина зовнішня передумова. Код, reference packs, медіа, UI, bridge,
контракти, схеми та тести зберігаються в `alpha`.

## Додаткова повна перевірка

```bash
node scripts/verify-alpha.mjs --full
```

Вона додає повний beta test suite до обов’язкової інсталяційної перевірки.
