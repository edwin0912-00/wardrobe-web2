# 11 — відкриті прогалини і наступні докази

Це не список бажань. Тут лише те, що не можна чесно назвати 100% доведеним на
зрізі 2026-08-09.

## Release/process gaps

* Source branch head і live product artifact можуть розходитись після test-only
  або docs-only commit. Потрібен release report з explicit explanation; для
  product code розбіжність недопустима.
* `main` та `alpha-0.01` залишилися історичними. Перенесення alpha у canonical
  production потребує окремого approved release decision, не force-push.
* Старі секції `STATE.md` містять історичні provider/catalog statements. Вони
  не мають переважати цим snapshot, але їх варто поступово маркувати датою.

## Verification gaps

* Повний `npm test` не має поточного one-line PASS; resource preflight і старі
  fixture/schema failures треба або виправити, або розкласти на verified
  historical failures.
* Повний платний E2E ланцюг avatar → look → background → Fashion Shoot →
  Fashion Video → delivery не запускався в цьому docs-коміті. Focused tests і
  health не замінюють його.
* Browser E2E mobile/desktop для progressive shoot frames, media library,
  presentation scroll, sound policy і God View потрібно повторити на поточному
  runtime release.

## Capability gaps

* FAL має camera/token роль, але не є доведеним image/video fallback adapter.
* OpenRouter video route не гарантує reference-video-driven Fashion Video на
  кожному провайдерському capability profile; unsupported input має показувати
  structured capability error, а не fake result.
* Не всі historical `shoot.*` style packs мають однакову комплектність. Catalog
  має відрізняти `READY`, `BLOCKED_MISSING_SOURCE_PACK` і legacy/video-only, не
  показувати їх однаково «готовими».

## Product gaps to close next

1. Довести durable saved scenes/shoots/videos у media library після restart.
2. Довести progressive Fashion Shoot delivery: approved slot одразу видно і
   доступний для download.
3. Довести video retry/structured error path для provider pre-submit IP check і
   semantic reference-leak QA.
4. Провести independent browser QA з боку Antigravity без права self-approve.
5. Додати інтеграційний тест, який піднімає чистий README install і проходить
   реальний UI ↔ backend bridge без 404.

## Reporting rule

Кожен gap закривається лише через три докази:

```text
source commit + focused/contract test
  + live route or browser evidence
  + persistence/release traceability evidence
```

До цього в `STATE.md` пишеться `NOT_REVERIFIED` або конкретний blocker, а не
«майже готово».

