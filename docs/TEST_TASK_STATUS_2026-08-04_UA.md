# Zeely / Wardrobe — аудит виконання тестового

Дата перевірки: 2026-08-04.

Audited product source: `7129c5c9f0c8c45cab12bf747e833af1e8a37815`.

Later audit-only Git commits descend from that product source and do not change
the deployed runtime bytes.

Public beta health: `ready`, `release_sha = 7129c5c9f0c8c45cab12bf747e833af1e8a37815`.

Нормативні джерела: `spec/ZEELY_TASK_SOURCE_UA.md`, `spec/ZEELY_CANON_UA.md`.

## Короткий verdict

**Тестове реалізоване функціонально, але ще не закрите як формально прийнята
здача.** Мінімальні outputs, engine, web surface, prompts, manifests і схема
існують. Реальний публічний avatar → outfit run проходив усі core QA gates.
Водночас актуальний штатний `npm run verify:output` повертає `NEEDS_REVIEW` для
всіх трьох checked-in користувачів. До виправлення цієї розбіжності не можна
чесно писати «ТЗ виконано на 100%».

## Матриця оригінального ТЗ

| Вимога | Фактичний стан | Verdict |
| --- | --- | --- |
| Прийняти нове фото людини з довільним фоном/позою | Web intake, conditioning, immutable run і реальний paid core journey існують. | **Виконано функціонально** |
| Створити впізнаваний avatar на білому фоні | Technical exact-white QA та semantic identity QA реалізовані; реальний core run мав Avatar QA PASS. | **Виконано функціонально** |
| Переодягнути через текст або reference image | Обидва контракти, prompts, fixtures і live runner існують; reference і text cases є серед `001–003`. | **Виконано функціонально** |
| Послідовно запустити avatar → outfit одним engine | Immutable `job.json` + deterministic state machine + checkpoints + bounded retries. | **Виконано** |
| Зберігати кожен run у структуровану папку | `runtime/runs/<id>/inputs, conditioned, outputs, receipts, manifests`; checked-in evidence у `output/001..003`. | **Виконано** |
| Надати 3 користувачів × avatar + outfit | Шість PNG фізично присутні та hash-bound у manifests. | **Присутні, але acceptance не закритий** |
| README із залежностями, запуском та tools | README і runnable commands є в engine repo. | **Виконано, потребує фінальної синхронізації provider/status copy** |
| Pipeline diagram | `docs/pipeline.mmd`, `docs/ZEELY_TEST_PIPELINE_SCHEME_UA.md`, machine plan. | **Виконано** |
| Фінальні prompts / логіка формування | Versioned templates та compiled prompts лежать біля кожного output. | **Виконано** |
| Fresh input без ручного редагування JSON | Web app створює job із uploads; checked-in JSON не редагується користувачем. | **Виконано функціонально; потрібен current-SHA повторний E2E proof** |

## QA — що саме не закрито

На чистому fetched `origin/beta` виконано:

```text
npm run verify:contracts → PASS, 41 schemas, 9 fixtures, 3 jobs
npm run verify:canon     → PASS, 43 rules, 34 blocking
npm run verify:output    → NEEDS_REVIEW, subjects 001/002/003
```

Причина однакова для шести core images: `reviews/visual-review.json` містить
історичний gate `frontal_half_body_composition`, тоді як чинний канон і verifier
вимагають `frontal_full_length_composition`. Тому exact-white, identity,
lighting, white balance, detail, photorealism, outfit fidelity, anatomy і
residue checks мають PASS, але framing лишається `missing_visual_review`.

Додаткова evidence-помилка: `output/submission-manifest.json` досі записує
`qa_status: PASS`, хоча його власний `output/qa-summary.json` і три
`qa-report.json` повертають `NEEDS_REVIEW`. Submission manifest не можна
використовувати як доказ до його детермінованого rebuild із поточних reports.

### Важлива історія framing-вимоги

Оригінальний Notion snapshot вимагав half-body. Після явного продуктового
рішення 2026-07-26/27 канон було змінено на full-length від маківки до підошов.
Старі три submission outputs і visual review не були чесно перегенеровані та
перерев'язані до нового gate. Правильне закриття — нові full-length artifacts
або явне повернення submission contract до literal Notion half-body. Не можна
просто перейменувати старий review або послабити verifier.

## Code, beta і journey — це різні факти

- **Git code:** audited product bytes are at
  `7129c5c9f0c8c45cab12bf747e833af1e8a37815`; subsequent commits in this
  audit add documentation only.
- **Public beta:** health `ready`, generation `available`, semantic QA
  `available`, 16 background presets і 18 fashion/editorial mode records.
- **Release lineage:** health і explicit fetched `origin/beta` називають один
  точний product SHA `7129c5c9f0c8c45cab12bf747e833af1e8a37815`. Попередня локальна
  розбіжність була stale remote-tracking ref, а не втрачений release commit;
  наступний Git commit є documentation-only і не потребує runtime activation.
- **Історичний real proof:** paid avatar → outfit journey проходив
  conditioning, Avatar QA і Outfit QA з persisted result. Це доводить
  працездатність core, але не замінює current-release proof.

Health `ready`, каталог або unit tests не дорівнюють E2E PASS.

## Додаткові блоки поза обов'язковим ТЗ

| Блок | Стан на момент аудиту |
| --- | --- |
| Browser profile / saved looks | Реалізовано й історично E2E PASS. |
| Standard backgrounds | 16 cards live; каталог доведений, але не кожен preset має current-release paid E2E. |
| Create Universe / Fashion Shoot | 18 mode records у live catalog; code і progressive UI значно розвиненіші за ТЗ, але повний current-release five-frame journey не доведений цим аудитом. |
| Fashion Video | Route, persistence, retries, reference locks і QA реалізовані; історичний real persisted PASS існує, current public release lineage збігається з Git. |
| Real-time Look | Контракт і UI існують; paid generative webcam E2E не доведений. |
| Cinematic HTML5 site | Окремий public repo `wardrobe-web2`, installable main, 135/135 preflight; це presentation layer, не заміна image-engine submission. |

## Історія ключових змін

1. **22 липня:** локальна копія Notion ТЗ, нормативний канон, conditioning,
   три fixture jobs, шість core PNG, prompts, manifests і QA framework.
2. **23–25 липня:** immutable runner, async provider journaling/resume,
   structured reference packs, web uploads, SSE progress і persistence.
3. **26–27 липня:** full-length product decision, QA unification, scenes,
   Create Universe/Fashion Shoot contracts та Git-based multi-agent control.
4. **28–30 липня:** 16 backgrounds, expanded style catalog, profile recovery,
   Add-items flow, HEIC/drag-drop, server-backed saved looks і beta releases.
5. **31 липня – 3 серпня:** Fashion Video persistence/retry/audio/fidelity,
   Fashion Shoot five-frame UI and reference bindings, GPT Image 2 ladder,
   Real-time Look contracts та cinematic TV/laptop presentation.
6. **4 серпня:** strict audit встановив stale three-user framing evidence;
   explicit beta fetch одночасно підтвердив точний Git ↔ public-beta SHA.

Повна append-only технічна історія збережена у `LOG.md`; operational blocks —
у `STATE.md`, `UPDATE.md`, `BLOCK_STATUS.md` і `PIPELINE.md`.

## Що потрібно для чесного 100%

1. Вибрати чинний acceptance: explicit full-length decision має перевагу над
   старим half-body fixture contract.
2. Перегенерувати або надати три full-length avatar/outfit pairs, провести
   новий hash-bound semantic review і отримати `npm run verify:output = PASS`.
3. Детерміновано перебудувати `submission-manifest.json`; прибрати суперечність
   `manifest PASS` проти `qa-summary NEEDS_REVIEW`.
4. На exact SHA пройти fresh public input → conditioning → avatar →
   outfit → downloads і зберегти run/receipt як current E2E evidence.
5. Підготувати один evaluator-facing package/repository. Public cinematic
   frontend зараз не містить generation engine, а engine repo не є публічною
   інсталяційною здачею.

Після цих п'яти пунктів мінімальне ТЗ можна позначити `COMPLETE`. Backgrounds,
Fashion Shoot, Video, Real-time Look і cinematic apartment залишаються bonus /
product expansion та не повинні приховувати core acceptance.
