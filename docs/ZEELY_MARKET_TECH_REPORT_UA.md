# ZEELY: ринок, надійний image/video pipeline і 3 варіанти реалізації

**Deep research + production blueprint**  
Версія: 1.0 · 19 липня 2026 · Europe/Madrid  
Статус: decision-ready  
Scope: cloud-only image/video models; Higgsfield MCP наявний, але не є єдиною залежністю

> **Архівний market survey, не runtime specification.** У цьому документі навмисно перелічені конкуренти й альтернативи, зокрема Hermes, Runway та direct-provider IDs. Після повторного читання тестового фінальне виконання зафіксоване окремо в `README.md`, `docs/ZEELY_EXECUTION_PLAN_UA.md` і `config/model-policy.json`: детермінований JSON runner без агентів, GPT Image 2 → Nano Banana 2 → Nano Banana Pro через Higgsfield, video route вимкнений. У разі суперечності execution-документи мають пріоритет.

> Коротка відповідь: Zeely не виграє ще одним “магічним промптом” або однією моделлю. Виграшна система — **asset-first, still-first, provider-agnostic production protocol**: людина, продукт/одяг і середовище мають окремі типізовані контракти; агент планує, детермінований graph виконує; кожен дорогий крок проходить blocking QA; провайдер можна замінити без зміни product contract.

---

## 0. Рішення на ранок

### Що обрати

**Рекомендація: Варіант 2 — API-native dual-provider production.**

Він дає найкращий баланс швидкості, якості й надійності:

- Hermes залишається conversation/planning layer, але не керує станом “зі своєї пам’яті”.
- JSON Schema + state machine є єдиним source of truth.
- Higgsfield MCP — creative adapter і R&D surface, а не single point of failure.
- Draft image: Nano Banana 2 / FLUX.2; final image: GPT Image 2 / FLUX.2 Max / Nano Banana Pro залежно від defect.
- Draft video: Gemini Omni Flash Preview; controlled video: Kling 3 Pro / Runway Gen-4.5; hero або first/last-frame: Veo 3.1 / Luma Ray.
- Кожний output одразу зберігається у власний object storage разом із model ID, version, seed, prompt hash, input hashes і QA evidence.

### Три варіанти одним екраном

| | Варіант 1 — Higgsfield-first MVP | Варіант 2 — API-native production | Варіант 3 — Best-of-N studio |
|---|---|---|---|
| Для чого | ефектне демо і тест пайплайна | production MVP Zeely | premium/hero campaigns |
| Час до першого working path | 5–8 engineering days | 18–28 engineering days | 45–70 engineering days |
| Control plane | Hermes + thin JSON runner | Hermes + versioned DAG/state machine | той самий DAG + experiment/evaluation layer |
| Image | Higgsfield MCP; NB2 fallback | NB2/FLUX draft; GPT Image 2/FLUX/NB Pro final | 2–3 providers × N candidates |
| Video | Higgsfield MCP; fal.ai Kling fallback | Omni draft; Kling/Runway default; Veo/Luma fallback | Veo/Runway/Kling/Luma best-of-N |
| Human gate | перед фінальним video | після still, перед hero render, перед export | art director на look/shot/final |
| Lock-in | високий | низький | низький |
| Reliability target | 85–90% jobs complete | 97% jobs complete без engineer | 99% completion із human recovery |
| Орієнтовний generation spend / 15–18 s accepted pack¹ | $5–20 + Higgsfield credits | $10–35 | $40–150 |
| Ризик | MCP/tool contract і ручна відтворюваність | потрібен нормальний backend | дорожче й повільніше |

¹ Не quote: API generation only, до storage/egress/LLM QA/engineering; включено типовий candidate/retry multiplier. Актуальну ціну завжди рахує router до запуску job.

### Рішення, які не можна відкладати

1. Затвердити `ORG_PRESERVE` і `DIFF_REPLACE` як executable environment policies, а не текст у промпті.
2. Зробити approved still обов’язковим gate перед image-to-video.
3. Не давати Hermes змінювати locked facts, thresholds, budget або provider allowlist.
4. Вести model lifecycle registry: preview/GA/deprecated/shutdown date, feature tests і fallback.
5. Не починати новий production на Sora 2: модель уже deprecated; відеомаршрут OpenAI треба вважати legacy, не fallback для нового сервісу. [OpenAI model catalog](https://developers.openai.com/api/docs/models)

---

## 1. Що саме будуємо

### Product outcome

З довільного user input треба контрольовано отримати:

1. впізнавану людину / avatar;
2. ту саму людину з указаним продуктом або одягом;
3. потрібне середовище за однією з двох політик;
4. approved key visual;
5. короткі контрольовані video shots;
6. фінальний HTML5 experience, де swipe/scroll прив’язаний до video timeline;
7. повну lineage: що, ким, з яких refs, якою моделлю і чому було прийнято.

### 1.1 Test-task acceptance baseline

Базова задача Zeely вимагає:

- arbitrary user photo → recognizable, photorealistic half-body avatar;
- exact white `#FFFFFF` background;
- same person + new outfit from text or clothing reference;
- щонайменше 3 users;
- local structured outputs, prompts, README і pipeline diagram;
- identity, anatomy, light/color/detail, outfit fidelity та background bleed входять у review.

Цей доклад не замінює ці deliverables відео-демо: він розширює їх до production image/video system. [Zeely AI Engineer test task](https://app.notion.com/p/Zeely-Test-Task-for-AI-Engineer-Image-Video-Generation-33bcef9155c980189a4def1cd74e1e6c)

### Два режими композиції

| Policy | Human | Product/річ | Environment | Типова задача |
|---|---|---|---|---|
| `ORG_PRESERVE` | preserve | add/replace under locks | preserve layout, light intent and key objects | same person + new look у тому самому світі |
| `DIFF_REPLACE` | preserve | preserve target SKU/річ | replace with approved target environment | same person + product у новій campaign scene |

### Основна одиниця системи

Не “prompt”, а **Look Package**:

```text
LookPackage
├── HumanAsset[]
├── ProductAsset[] / GarmentAsset[]
├── EnvironmentAsset[]
├── StyleAsset[]
├── locked_facts[]
├── allowed_changes[]
├── approved_still
├── ShotPlan[]
└── QAProfile
```

Кожна генерація є лише attempt конкретної версії Look Package. Це прибирає головну причину drift: неявні refs і переписані промпти.

---

## 2. Як ринок реально це робить

### Вісім повторюваних патернів

1. **Asset-first, не prompt-first.** Спочатку створюють/затверджують character, product, location, props; потім пишуть shotlist і запускають video.
2. **Still-first.** Product + actor спочатку зводять у контрольований combined image; video лише анімує затверджений кадр.
3. **Identity і product fidelity — різні задачі.** Digital twin добре тримає обличчя, але не гарантує SKU; inpainting/composite добре тримає SKU, але не рух.
4. **Короткі shots замість одного довгого generation.** 3–10 секунд, окремий QA і монтаж.
5. **Graph і agent — різні шари.** Agent готує plan, graph забезпечує repeatability, retry, approvals і lineage.
6. **Human approval стоїть перед дорогим downstream.** Вибір still/keyframe дешевший за повтор 20 секунд відео.
7. **Variants fan out від approved base.** Змінюється один hook/CTA/look, а не перебудовується вся кампанія.
8. **Власне storage є обов’язковим.** Provider URLs часто живуть від 10 хвилин до кількох днів.

### Головна ринкова правда

Жоден досліджений vendor публічно не гарантує одночасно:

```text
same human
+ exact product/garment geometry, logo, text and color
+ requested environment policy
+ correct anatomy and contact
+ stable long motion
```

Кожен оптимізує одну частину: digital twin, talking head, product still, VTO або короткий cinematic clip. Тому production reliability виникає **між моделями** — у contracts, QA, repair і routing.

---

## 3. Карта прямих конкурентів

Позначення: `Vendor claim` — твердження виробника; `Inference` — наш висновок із задокументованого workflow, не гарантія.

### 3.1 Найближчі до задачі Zeely

| Конкурент | Як починає | Як тримає human/product/environment | Automation і QA | Що варто забрати | Де gap |
|---|---|---|---|---|---|
| **Higgsfield** | product/brief → character sheet + product sheet + location/props → shotlist → animation | named/locked assets; Soul/Cast; product refs; asset-first | MCP/CLI, video analyzer, history; approval переважно ручний | asset bible, named refs, shot discipline, creative agent UX | у публічних docs не знайдено self-serve REST із idempotency, signed webhook, pinning, SLA і strict QA contract |
| **Creatify** | URL/brief → research → strategy → scripts → casting → videos/variants; або AdFlow nodes | Smart Assets, avatar/product nodes, model swap, branch | Agent + replayable node DAG; заявлений vision QA; REST async/webhooks | URL ingestion, modular AdFlow, intervention at every stage | thresholds/judge prompts не відкриті; Agent/UI/API feature parity не гарантована |
| **Arcads** | product upload → scene image → Talking Actor або B-roll | auto-detected product, actor/clone, product showcase, start/end frames | node workflows, reuse, batch; public product/video API | fast UGC batching, actors × languages, still-to-talking-video | exact SKU в cinematic video не гарантовано; публічних semantic gates немає |
| **HeyGen** | product + avatar → **4 combined stills** → select → script/motion → Avatar IV | reusable Digital Twin/Looks; selected still anchors product | manual still gate; API for avatars/videos | надзвичайно правильний still approval pattern | optimized for handheld/small products; Product Placement REST не публічний |
| **Pencil** | typed workflow canvas: text/context/attachment/work | brand refs/templates/attachments, not a fixed avatar pipeline | `Scores → If/Else → Approval → Export`; lineage/expiry | найкраща governance model: typed pins, approvals, branching, lineage | image/video models не мають direct access до всієї brand library; self-serve REST не знайдено |
| **AdCreative.ai** | product image → isolate/tag → style preset → inpainting → six outputs | mask/composite + preset/color context | async status/webhook; creative scoring claim | deterministic product stills, safe margins, ad formats | не вирішує same person + річ + video continuity |
| **Captions/Mirage** | product URL → review metadata/script → actor → UGC video | selected creator/AI Twin + media/B-roll | public AI Ads API submit/poll, variants | turnkey URL-to-UGC and real API | human/product/environment не мають independent typed locks |
| **Zeely today** | product + image + optional reference → concept/avatar/model → start image → video | correct start-image-first UI | manual regenerate/review | правильна UX послідовність уже є | немає public job contract, visible lineage, model lifecycle registry і hard QA gates |

Джерела: [Higgsfield asset-first](https://higgsfield.ai/academy/how-to-use/how-to-make-ultra-realistic-ai-ads), [Higgsfield MCP](https://higgsfield.ai/mcp), [Creatify Agent](https://creatify.ai/blog/introducing-creatify-agent-the-first-creative-agent-designed-to-prevent-hallucinations), [Creatify AdFlow](https://creatify.ai/blog/introducing-adflow-the-node-based-ad-builder-built-for-production-scale), [Arcads Workflows](https://intercom.help/arcads/en/articles/15393713-what-is-the-workflow-feature), [HeyGen Product Placement](https://help.heygen.com/en/articles/12704854-product-placement-combine-a-product-with-an-avatar-in-a-video), [Pencil nodes](https://help.trypencil.com/en/articles/14667773-what-are-workflow-nodes-and-how-do-i-connect-them), [AdCreative Product Photoshoot API](https://api-docs.adcreative.ai/docs/features/product-photoshoot-api), [Captions AI Ads API](https://captions.ai/help/api-reference/ai-ads), [Zeely Video Ad](https://help.zeely.ai/en/articles/15326044-how-to-create-video-ad).

### 3.2 Avatar/presenter competitors

| Vendor | Сильна зона | Asset model | Чому не універсальний Zeely engine |
|---|---|---|---|
| **Synthesia** | business/training presenter, template + brand kit | reusable personal avatar; scene media; customizable outfit | product — media layer, не exact locked SKU; не cinematic VTO pipeline |
| **Tavus** | API-first digital replica, scripted/realtime | trained Replica + Persona + background | product/річ не є typed references |
| **D-ID** | talking portrait і realtime agents | presenter/source image | не full-body fashion/product/environment system |
| **HeyGen** | digital twin, Looks, product placement | one identity → up to 500 looks; consent reused for same identity | сильний presenter, але не universal product compositor |
| **Captions/Mirage** | UGC actor + audio/video | AI Twin/creator + script/media | finished-video abstraction приховує fidelity control |

Джерела: [Synthesia overview](https://help.synthesia.io/en/articles/9994493-what-is-synthesia), [Synthesia Brand Kit](https://help.synthesia.io/en/articles/9046610-how-do-i-use-a-synthesia-brand-kit), [Tavus API](https://docs.tavus.io/api-reference/overview), [D-ID quickstart](https://docs.d-id.com/docs/quickstart), [HeyGen Looks](https://help.heygen.com/en/articles/9964694-avatar-looks-explained), [Mirage API](https://captions.ai/help/api-reference/api).

### 3.3 Creative/model platforms, з яких конкуренти складають pipelines

| Platform | Production primitive | API maturity | Fit для Zeely |
|---|---|---|---|
| **Runway** | Product Ad/UGC/Swap recipes; multi-ref; Workflows; own + third-party models | REST/SDK, workflow API, official MCP, versioned recipes | найкращий ready-made API abstraction для швидкого product video |
| **Luma** | Master References, Boards, keyframes, video edit/reframe, Ray | async REST; pay-as-you-go/provisioned | strong alternate motion/editor, cheap draft-to-premium ladder |
| **Google** | Nano Banana image; Omni conversational video; Veo controlled video | Gemini API + Vertex AI | primary direct-cloud lane; треба registry через preview/stable ID churn |
| **BFL FLUX** | multi-ref image edit, JSON prompts, HEX control, pose, VTO | direct REST, pinned/preview IDs | strongest photo/VTO primitive before video |
| **Adobe Firefly** | Precise/Adaptive Composite, masks, harmonization, custom subject/style models | enterprise APIs | exact product still and enterprise governance; motion secondary |
| **Kling** | Elements/subject binding, motion control, native audio | enterprise/API via partners and brokers | strong identity/product-aware motion, but own QA required |
| **Ideogram** | Character Reference, Magic Fill, typography | public image API | useful still specialist, no video, face/hair-oriented identity |
| **Recraft** | brand palette, mockups, vector/raster, custom style | public API | design/brand layer, not identity/video engine |

Джерела: [Runway Product Ad](https://docs.dev.runwayml.com/recipes/product-ad/), [Runway models](https://docs.dev.runwayml.com/guides/models/), [Luma Agents API](https://docs.agents.lumalabs.ai/), [Google Omni](https://ai.google.dev/gemini-api/docs/omni), [FLUX.2 editing](https://docs.bfl.ai/flux_2/flux2_image_editing), [Adobe Composite API](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/object-composite/), [Kling 3.0 guide](https://app.klingai.com/cn/quickstart/klingai-video-3-model-user-guide), [Ideogram API](https://developer.ideogram.ai/), [Recraft API](https://www.recraft.ai/docs/api-reference/endpoints).

### 3.4 Конкурентний висновок

Найкраще з ринку треба зібрати в один protocol:

- від Higgsfield — asset bible і creative workflow;
- від HeyGen/Zeely — mandatory combined/start still;
- від Pencil — typed graph, scores, blocking approval і lineage;
- від Runway — replaceable API nodes і product-oriented recipes;
- від Adobe/AdCreative — masks/composite для SKU;
- від BFL — multi-reference/VTO;
- від Kling/Veo/Luma — короткий image-to-video з control refs;
- від Creatify — URL ingestion, agent visibility і campaign variants.

**Moat Zeely:** не “наша модель краща”, а “будь-яка модель стає керованою, observable і replaceable”.

---

## 4. Cloud image API: що використовувати і коли

### 4.1 Виправлення назв і параметрів

У первинній нотатці змішані model families і quality controls. Правильний contract:

| Назва | Реальний model ID / family | Quality control | Resolution control | Production роль |
|---|---|---|---|---|
| **GPT Image 2** | `gpt-image-2`, pinned `gpt-image-2-2026-04-21` | `low / medium / high / auto` | flexible 1K/2K/до 4K dimensions | identity-sensitive edit, precise final still |
| **Nano Banana 2** | `gemini-3.1-flash-image` | немає `low/high`; є thinking/iteration controls | 0.5K / 1K / 2K / 4K | high-volume multi-reference draft/default |
| **Nano Banana Pro** | `gemini-3-pro-image` | professional model, не “NB2 Pro” | 1K / 2K / 4K | complex brand/product/text composition |
| **Nano Banana 2 Lite** | `gemini-3.1-flash-lite-image` | efficiency lane | 1K | preflight visualizations/cheap concepts |
| **FLUX.2** | `klein / pro / max / flex` | model + steps/guidance у Flex | до 4 MP | specialist для речей/product/pose/multi-ref |

Джерела: [GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2), [OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation), [Nano Banana 2](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image), [Google image generation](https://ai.google.dev/gemini-api/docs/image-generation), [FLUX.2 prompting](https://docs.bfl.ai/guides/prompting_guide_flux2).

### 4.2 Image model matrix

Ціна — орієнтир станом на дату звіту, без input tokens/storage/egress; перед production call router читає актуальний price registry.

| API/model | References і control | Output | Орієнтовна ціна | Найкращий use case | Не використовувати як |
|---|---|---|---:|---|---|
| **Gemini 3.1 Flash Image / NB2** | up to 10 object refs + 4 character refs in documented detailed mode; conversational editing | 0.5K/1K/2K/4K; SynthID | $0.045 / $0.067 / $0.101 / $0.151 | default draft, environment replace, multi-object combine | єдиний judge власного output |
| **Gemini 3 Pro Image / NB Pro** | premium multi-ref; documented limits vary by role/surface, so contract-test exact mix | 1K/2K/4K; SynthID | ≈$0.134 1K/2K; ≈$0.24 4K | hero still, typography, difficult product | cheap iteration lane |
| **GPT Image 2** | all image inputs automatically high-fidelity; multi-image edit/mask; versioned snapshot | flexible sizes; `low/medium/high`; no transparent output | square ≈$0.006/$0.053/$0.211 | identity-sensitive edit, targeted repair, final | bulk blind fan-out at high quality |
| **FLUX.2 Pro** | up to 8 API refs within input/output pixel budget; JSON prompts; HEX; pose | up to 4 MP | T2I from $0.03; edit from $0.045 | outfit/product/reference composition | video engine |
| **FLUX.2 Max** | same family, highest precision | up to 4 MP | from $0.07 | final still after draft pass | first-pass cheap generation |
| **FLUX VTO** | person + refs речей, clothing-specific | image | contract-dependent | outfit transfer and fabric/logo structure | physical fit guarantee |
| **FASHN Try-On Max** | person/product/face specialist; clothes, shoes, hats, jewelry, bags | 1K/2K/4K | roughly $0.075–$0.375 by mode | independent fashion try-on lane | general-image fallback without VTO benchmark |
| **Runway Gen-4 Image/Turbo** | character/object/style refs in Runway ecosystem | tiered | API credit-based | environment/style exploration and recipe compatibility | exact SKU without external QA |
| **Luma Uni-1** | up to 9 refs in Agents API | 2K | ≈$0.0404 base; refs add small increment | alternate style/reference candidate | identity source of truth |
| **Adobe Composite** | mask + exact subject composite/harmonization | image | enterprise | exact product anchor, deterministic compositing | final motion |
| **Ideogram** | Character Reference, Magic Fill, text strength | image | plan/API dependent | face/hair continuity and typography | full-body product video |

Pricing sources: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation), [BFL pricing](https://docs.bfl.ai/quick_start/pricing), [FASHN API](https://docs.fashn.ai/api-reference), [Luma Agents pricing](https://docs.agents.lumalabs.ai/guides/pricing/).

### 4.3 Image router, який я рекомендую

```text
IF task = cheap_concept
  → Nano Banana 2 Lite, 1K

ELSE IF task = multi_reference OR environment_replace
  → Nano Banana 2, 1K
  → escalate 2K only after semantic PASS

ELSE IF task = outfit_transfer
  → FLUX VTO or FLUX.2 Pro
  → fallback GPT Image 2 medium targeted edit

ELSE IF task = identity_sensitive_edit
  → GPT Image 2 medium with pinned snapshot
  → fallback FLUX.2 Max / Nano Banana Pro

ELSE IF task = logo_text_brand_hero
  → Nano Banana Pro or FLUX.2 Flex/Max

IF semantic PASS AND export needs 4K
  → high-res regenerate/upscale from approved candidate
```

Правило: **resolution не є quality fix**. 4K не виправляє неправильне обличчя, SKU або рукав; лише дорожче деталізує дефект.

---

## 5. Cloud video API: alternatives to Higgsfield

### 5.1 Current video matrix

| API/model | Control surface | Typical output | Орієнтир ціни | Роль у Zeely | Критичний нюанс |
|---|---|---|---:|---|---|
| **Gemini Omni Flash Preview** | text/image/reference-to-video, conversational edit | 3–10 s, 720p, 24 fps, audio | ≈$0.10/s | cheap/default draft, quick correction | preview; no first/last interpolation, extension, provisioned throughput; multi-video refs unsupported |
| **Veo 3.1 / Fast / Lite** | text/I2V; first+last frames, extension and up to 3 subject refs on supported variants; native audio | 4/6/8 s; 720/1080/4K with mode constraints | Gemini API: Standard ≈$0.40/s 720/1080, Fast ≈$0.10–0.12/s, Lite ≈$0.05–0.08/s; 4K higher | controlled transitions, hero, native audio | Flow UI ≠ Gemini API ≠ Vertex feature surface; use exact ID per surface |
| **Runway Gen-4.5** | text/I2V, strong camera choreography | 2–10 s | 12 credits/s = $0.12/s | production general motion | input/output URLs ephemeral; identity/SKU still need external gates |
| **Runway Gen-4 Turbo** | I2V | 5/10 s, 720p | 5 credits/s = $0.05/s | cheap motion proof | lower ceiling than Gen-4.5 |
| **Kling 3 Pro** | image-to-video, Elements, element binding, native audio/motion control | up to 15 s depending endpoint | fal ≈$0.112/s no audio; $0.168/s audio | default human/product-aware motion | partner/API surface varies; consistency is capability, not guarantee |
| **Seedance 2.0 / BytePlus ModelArk** | up to 9 image, 3 video and 3 audio refs; first/last, edit/extend, native audio | endpoint/token-dependent; up to 4K on supported route | direct token billing; fal fast ≈$0.242/s at 720p audio | complex action/story, alternate model family | restrictions on arbitrary real-face external refs require contract test |
| **Luma Ray 3.2** | keyframes, I2V/V2V, reframe, HDR/EXR | 5/10 s; up to 1080p | 720p $0.30/5s; 1080p $1.20/5s | keyframe/edit/reframe fallback | shared PAYG has no latency SLA; 10 s pricing nonlinear |
| **Higgsfield MCP** | agent tools, 30+ models, Soul/Cast/Elements, analyzer/history | model-dependent | account/credit-dependent | creative console, break-glass route | public MCP is not the same as documented production REST contract |
| **fal.ai broker** | one queue/SDK/webhook contract across Veo/Kling/Seedance/etc. | model-dependent | transparent per model | fastest API alternative and model router | adds intermediary, terms and dependency |
| **Replicate broker** | generic async predictions, polling/SSE, signed webhooks | model-dependent | model/hardware-dependent | experimental/emergency provider | API files removed after ~1 h by default; persist immediately |
| **MiniMax Hailuo 2.3/Fast** | T2V/I2V, first frame | 6/10 s; 768p, selected 1080p | roughly $0.19–$0.56/clip | cheap independent tertiary motion fallback | less control than Kling/Veo/Runway |

Sources: [Gemini Omni](https://ai.google.dev/gemini-api/docs/omni), [Gemini Veo](https://ai.google.dev/gemini-api/docs/veo), [Veo on Vertex](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate), [Runway pricing](https://docs.dev.runwayml.com/guides/pricing/), [Runway Gen-4.5](https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5), [Kling 3 via fal](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video), [BytePlus Seedance](https://docs.byteplus.com/en/docs/modelark/1520757), [MiniMax pricing](https://platform.minimax.io/docs/guides/pricing-paygo), [fal video overview](https://fal.ai/explore/image-to-video-apis), [Luma pricing](https://docs.agents.lumalabs.ai/guides/pricing/), [Higgsfield MCP](https://higgsfield.ai/mcp), [Replicate webhooks/storage](https://replicate.com/docs/topics/webhooks).

### 5.1.1 Gateway ≠ disaster recovery

`Veo direct → Runway-hosted Veo` або `GPT Image direct → broker-hosted GPT Image` спрощує integration, але **не дає незалежного model fallback**. Якщо upstream lab, safety policy або model version має incident, wrapper часто успадковує його.

Незалежні пари мають бути з різних лабораторій:

- general image: OpenAI → Google → BFL;
- fashion try-on: FASHN specialist → окремо benchmarked FLUX VTO → general image лише manual fallback;
- no-audio motion: Runway → Kling → MiniMax;
- native-audio motion: Google Veo → Kling → Seedance;
- talking avatar: HeyGen → Tavus → Synthesia enterprise.

### 5.2 Provider access layers

| Layer | Що підключити | Перевага | Ризик | Рекомендація |
|---|---|---|---|---|
| Agent-facing | Higgsfield MCP | дуже швидкий creative breadth | tool/schema/underlying route можуть змінюватися | залишити, але обгорнути adapter-ом |
| Direct primary | Google Gemini/Vertex + Runway Dev | documented APIs, own billing, clearer lifecycle | дві інтеграції | **production default** |
| Direct image specialist | OpenAI Images + BFL | pinned GPT snapshot + strong VTO/multi-ref | ще два DPAs/keys | увімкнути за task class |
| Direct motion specialist | Luma | keyframes/V2V/reframe/HDR | ще один vendor | premium fallback |
| Multi-model broker | fal.ai | one SDK/queue/webhook, fast switch Kling/Seedance/Veo | intermediary pricing/privacy/availability | найкращий швидкий API fallback |
| Emergency/experiments | Replicate | широкий catalog, version schemas, signed webhooks | model provenance/retention/quality vary | не ставити primary |

### 5.3 Video router

```text
draft_motion / <$1 target
  → Gemini Omni Flash Preview
  → fallback Runway Gen-4 Turbo

identity_or_product_critical_motion
  → Kling 3 Pro with Elements/binding
  → fallback Runway Gen-4.5

complex_camera_choreography
  → Runway Gen-4.5
  → fallback Seedance 2.0

first_last_frame_transition / extension / native_audio_hero
  → Veo 3.1 exact supported endpoint
  → fallback Luma Ray keyframes

video_edit_or_reframe
  → Luma Ray / Runway Aleph 2 / Omni conversational edit

both direct routes unhealthy
  → Higgsfield MCP break-glass OR fal.ai broker
  → mandatory human approval
```

### 5.4 Чому Sora 2 не входить у нову схему

OpenAI позначає Sora 2 як deprecated/legacy; для нового production його не можна вважати довгостроковим video fallback. За актуальним повідомленням API discontinuation заплановано на **24 вересня 2026 року**. [OpenAI Sora discontinuation](https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation)

### 5.5 Якщо потрібен talking-human, а не cinematic generation

Це окрема capability lane; не треба змушувати cinematic model імітувати довгий presenter video.

| Primary | Independent fallback | Best fit | Не вирішує |
|---|---|---|---|
| **HeyGen Avatar IV / Digital Twin API** | **Tavus Replica API** | consented talking presenter, script/audio, localization | exact interaction речі/product у cinematic world |
| **Synthesia API** | HeyGen/Tavus | enterprise templates, learning/business video, governance | fashion/product VTO |
| **Captions/Mirage API** | HeyGen | UGC-style creator ad and audio-driven actor | typed human/product/environment locks |

Sources: [HeyGen developers](https://developers.heygen.com/), [Tavus video API](https://docs.tavus.io/api-reference/video-request/create-video), [Synthesia API](https://docs.synthesia.io/reference/introduction), [Captions AI Ads API](https://captions.ai/help/api-reference/ai-ads).

---

## 6. Model lifecycle registry: обов’язкова частина системи

“Latest” alias без registry — прихований production incident.

| Model/endpoint | Стан 19.07.2026 | Дія |
|---|---|---|
| `gpt-image-2-2026-04-21` | pinned snapshot | дозволити primary/fallback |
| `gemini-3.1-flash-image` | current image workhorse | version test щотижня; batch lane окремо |
| `gemini-3-pro-image` | premium image family | contract test refs/resolution до release |
| `gemini-omni-flash-preview` | preview | cheap lane; завжди мати GA fallback |
| Gemini API `veo-3.1-*-generate-preview` | current preview surface | contract test; keep independent fallback |
| Vertex `veo-3.1-...-001` | versioned production surface where available | pin exact current ID; do not assume Gemini/Flow parity |
| Veo 2 / 3.0 legacy IDs | deprecated/shutdown | remove from allowlist; Veo 3.1 only |
| Sora 2 / Pro | deprecated; API discontinuation 24.09.2026 | заборонити для нових workflows |
| Imagen 4 legacy endpoints | shutdown 17.08.2026 | мігрувати на Nano Banana family |
| GPT Image 1.5 | legacy/deprecated relative to GPT Image 2 | new adapter тільки GPT Image 2 |
| Runway Gen-3 Alpha Turbo / Gen-4 Aleph | shutdown 30.07.2026 | Gen-4 Turbo / Gen-4.5 / Aleph 2 |
| `flux-2-pro-preview` | moving preview | experiments only |
| `flux-2-pro` / Max pinned endpoint | stable/pinned behavior | production |

Sources: [Google Gemini changelog](https://ai.google.dev/gemini-api/docs/changelog), [Google image guide](https://ai.google.dev/gemini-api/docs/image-generation), [Vertex release notes](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes), [Runway lifecycle/pricing](https://docs.dev.runwayml.com/guides/pricing/), [BFL release notes](https://docs.bfl.ai/release-notes).

Мінімальні поля registry:

```json
{
  "provider": "google",
  "alias": "video_fast_default",
  "model_id": "gemini-omni-flash-preview",
  "lifecycle": "preview",
  "enabled": true,
  "allowed_data_classes": ["P0", "P1_CONSENTED"],
  "capabilities": ["t2v", "i2v", "edit", "audio"],
  "known_limits": ["720p", "no_first_last", "no_extension"],
  "fallback_alias": "video_general_ga",
  "contract_tested_at": "2026-07-19T00:00:00Z",
  "sunset_at": null
}
```

---

## 7. Надійна архітектура: agent plans, graph executes

### 7.1 Чого не робити

```text
User → Hermes → вільний prompt → model → “на око норм” → video
```

Ця схема не має відтворюваного стану, typed refs, budget guard, defect-specific retry, approval gate або lineage. Вона годиться для single-shot exploration, не для production.

### 7.2 Цільова схема

```text
User / Reviewer
       │
       ▼
Hermes conversation + planning
       │ produces validated JSON only
       ▼
Job API + Schema Registry + Policy Engine
       │
       ▼
Durable State Machine / DAG
       │
       ├── Intake & Preflight
       ├── Cloud VLM Extraction
       ├── Asset Lock
       ├── Image Router → Provider adapters
       ├── Image QA → Approval
       ├── Shot Planner
       ├── Video Router → Provider adapters
       ├── Video QA → Approval
       └── Composer / HTML5 Export
                    │
                    ▼
       Object Storage + Postgres + events.jsonl
```

Hermes має право:

- пояснити задачу;
- запросити відсутній blocking input;
- сформувати `AssetManifest`, `ScenePlan` і prompt proposal;
- викликати allowlisted `create_job`, `get_job`, `approve`, `cancel`;
- пояснити QA defect і запропонований repair.

Hermes **не має права**:

- напряму викликати provider повз adapter;
- змінювати approved asset hash;
- переписувати `locked_facts`;
- послаблювати QA threshold;
- піднімати budget/max attempts;
- вмикати provider/model поза allowlist;
- робити auto-publish;
- трактувати timeout як failure і дублювати paid call без lookup за provider job ID.

### 7.3 State machine

```text
RECEIVED
  → PREFLIGHTED
  → EXTRACTED
  → ASSETS_LOCKED
  → PLANNED
  → IMAGE_GENERATING
  → IMAGE_QA
  → IMAGE_APPROVAL_REQUIRED
  → IMAGE_APPROVED
  → VIDEO_GENERATING
  → VIDEO_QA
  → VIDEO_APPROVAL_REQUIRED
  → PACKAGED
  → DONE
```

Side states:

```text
NEEDS_INPUT
NEEDS_REVIEW
RETRYABLE_FAILURE
TERMINAL_FAILURE
CANCELLED
```

Hard invariants:

1. `IMAGE_GENERATING` неможливий без schema-valid locked assets.
2. `VIDEO_GENERATING` неможливий без `approved_still_sha256`.
3. Attempt ніколи не переписується; нова спроба = новий `attempt_id`.
4. Один logical attempt має один idempotency key.
5. Blocking QA failure не може бути компенсований високим aesthetic score.
6. Provider result зберігається у власний storage до переходу далі.
7. Після budget hard limit дозволений лише review/cancel, не generation.

---

## 8. Intake і strict extraction

### 8.1 Input contract

Усі inputs діляться на typed assets:

| Type | Що це | Мінімальні refs | Що lock-имо |
|---|---|---:|---|
| `HUMAN` | людина/identity | 1 usable; бажано face + half/full body | face geometry, hair, body proportions, distinctive features |
| `PRODUCT` | purse, bottle, device, SKU | 1; бажано front + 3/4 + detail | silhouette, proportions, logo, text, color, material, hardware |
| `GARMENT` | shirt/dress/jacket/shoes | front; бажано back/detail | structure, sleeve/neckline/length, print, seams, logo, material |
| `ENVIRONMENT` | existing або target scene | 1 plate/reference | layout/key objects або лише visual intent залежно policy |
| `STYLE` | mood/color/art direction | 1–4 | palette, lighting/camera treatment; ніколи не identity |
| `POSE/MOTION` | structural/motion guide | optional | pose/action only |
| `LOGO` | master brand mark | vector/transparent raster | exact geometry/color/text |

### 8.2 Preflight status

Кожний asset отримує:

- `PASS` — можна використовувати;
- `REPAIRABLE` — можна rotate/crop/color-normalize/rematte без semantic invention;
- `REJECT` — потрібен інший input.

Стартові, не універсальні thresholds для MVP:

| Check | PASS guideline | REPAIRABLE | REJECT |
|---|---:|---:|---:|
| Person short edge | ≥1024 px | 768–1023 | <768 або decode fail |
| Visible face crop | ≥256×256 px | 160–255 | <160 / severe occlusion |
| Коротша сторона product/речі | ≥1024 px | 768–1023 | <768 |
| Target object coverage | ≥25% frame | 12–25% | <12% |
| Видимість речі | full front, key structure visible | minor crop/occlusion | key structure hidden |
| Blur/exposure | no critical-detail loss | locally repairable | logo/face/texture unreadable |

Ці числа — calibration starting point. Після benchmark вони мають стати task-specific thresholds, а не “вічною правдою”.

### 8.3 Extraction rule: observed, user-provided, unknown

Cloud VLM не має права “дописувати” невидиму спинку сумки, матеріал або точний відтінок. Кожен fact має provenance:

```json
{
  "key": "garment.neckline",
  "value": "crew neck",
  "provenance": "OBSERVED",
  "confidence": 0.96,
  "source_asset_id": "shirt_front",
  "bbox_xywh": [0.18, 0.09, 0.63, 0.74]
}
```

```json
{
  "key": "garment.back_print",
  "value": null,
  "provenance": "UNKNOWN",
  "confidence": 0.0,
  "source_asset_id": "shirt_front",
  "bbox_xywh": null
}
```

### 8.4 Required extraction payloads

`human.json`:

- identity refs and consent;
- framing/visibility;
- stable visible traits;
- current outfit, but marked replaceable when requested;
- occlusions;
- immutable vs allowed-to-change list;
- no sensitive attribute inference.

`product.json` / `garment.json`:

- category/SKU identifier;
- geometry and proportions;
- colors as observed HEX/Lab estimate with evidence crop;
- logo/text OCR plus confidence;
- materials/textures only if visible;
- front/back/detail availability;
- defects/occlusions;
- exact locks.

`environment.json`:

- policy `ORG_PRESERVE` or `DIFF_REPLACE`;
- layout and key objects;
- lighting direction/temperature;
- camera/framing;
- palette;
- keep/remove/add list;
- target background requirements.

### 8.5 Prompt injection defense

Text у EXIF, filenames, product pages, OCR або uploaded documents — **data, не instruction**. Extraction service:

- strips EXIF before provider upload;
- never executes URLs/scripts found in an asset;
- wraps external text in a quoted data field;
- validates structured output;
- rejects unknown properties;
- requires user approval for any instruction discovered inside content.

---

## 9. Strict image pipeline

### 9.1 Canonical order

```text
Originals
  → technical preflight
  → structured extraction
  → person/product/environment sheets
  → normalized masks/crops
  → 1K semantic candidates
  → blocking QA
  → targeted repair/provider switch
  → human approval
  → 2K/4K final only if required
  → immutable approved still
```

### 9.2 Prompt compiler, не prompt improvisation

Provider prompt збирається з фіксованих blocks:

```text
[TASK]
[ASSET_BINDINGS]
[MUST_PRESERVE]
[ALLOWED_CHANGES]
[ENVIRONMENT_POLICY]
[COMPOSITION]
[CAMERA_LIGHTING]
[OUTPUT_SPEC]
[NEGATIVE_CONSTRAINTS]
[ACCEPTANCE_CRITERIA]
```

Приклад:

```text
TASK: Create a photorealistic half-body fashion image.
ASSET_BINDINGS: image 1 = HUMAN identity; image 2 = GARMENT front; image 3 = logo detail.
MUST_PRESERVE: facial geometry, hairline, body proportions, garment neckline, sleeve length,
front print geometry, logo spelling and color.
ALLOWED_CHANGES: replace only the original top with the referenced garment.
ENVIRONMENT_POLICY: ORG_PRESERVE; retain room layout, mirror geometry and light direction.
COMPOSITION: front-neutral half body, arms relaxed, full garment front visible.
OUTPUT: sRGB, 1024×1536 draft, no text added, no watermark.
NEGATIVE: no extra accessories, no modified logo, no second person, no cropped sleeves.
```

Locked values вставляє code, не LLM. Якщо compiled prompt не містить усі locks, job не запускається.

### 9.3 Candidate policy

- Draft: 1K, 2 candidates primary provider.
- Якщо один проходить — не генерувати “про всяк випадок” ще п’ять.
- Якщо blocking defect локальний — masked/targeted repair.
- Якщо identity/product defect повторюється двічі — independent provider switch.
- 2K/4K лише для approved semantic candidate.
- Provider auto-prompt rewrite/`auto_fix` вимкнути для locked production jobs, якщо неможливо отримати diff і затвердити rewrite.

### 9.4 White-background avatar task

Для canonical avatar:

- RGB output, не “майже біла студія”;
- exact target `#FFFFFF` outside subject mask;
- soft even light і neutral white balance;
- one person, front-neutral, half body;
- no clothing/background bleed;
- edge matting перевіряється окремо від aesthetics.

Якщо model дає off-white, краще зробити deterministic/cloud segmentation + composite на `#FFFFFF`, ніж витрачати video-grade model retry.

---

## 10. Strict video pipeline

### 10.1 Still-first є hard gate

Video ніколи не “виправляє” незатверджене зображення. Він лише множить помилку по кадрах.

```text
approved still
  → one-shot motion contract
  → 4–6 s draft
  → temporal QA
  → repair/switch
  → approved clip
  → deterministic edit/composition
```

### 10.2 One shot = one main action + one camera intent

Погано:

> Person walks, turns, opens laptop, changes outfit, camera circles, room becomes studio, product flies in.

Добре:

> 5 s. Subject makes one slow half-turn while keeping the front of the clothing item visible. Camera performs a subtle 10% push-in. No cut. Preserve face, clothing-item logo, mirror geometry and lighting.

### 10.3 Continuity pack для кожного shot

- approved first frame hash;
- optional approved last frame hash;
- human/product/environment bindings;
- one motion reference if needed;
- camera/framing/lens description;
- action with timing beats;
- `must_preserve`;
- negative constraints;
- duration/fps/aspect/audio;
- QA profile.

### 10.4 Shot strategy для MVP narrative

| Chapter | Time | Visual | Generation/control | DOM layer |
|---|---:|---|---|---|
| 1. Wardrobe/mirrors | 0–6 s | шафа, два дзеркала, UI, input/result in mirrors | approved still + subtle I2V; mirror result as separate layer where practical | controls, labels, before/after |
| 2. Vogue-like shoot on TV | 6–15 s | та сама людина у fashion shoot, transition into TV | 2 short approved clips; controlled transition/first-last frames | no baked text |
| 3. Laptop/pipeline | 15–28 s | camera enters laptop; pipeline/credits scroll; “дякую” | pre-rendered transition + deterministic screen surface | titles, explanation, credits, CTA |

Не генерувати весь 28-second journey одним prompt. Три approved segments + deterministic transition/edit дають кращу continuity і repairability.

---

## 11. QA: blocking gates, а не один beauty score

### 11.1 Quality dimensions

| Gate | Image | Video | Blocking? |
|---|---|---|---|
| Technical | decode, dimensions, colorspace, background, file hash | codec, duration, fps, black/frozen frames, audio stream | так |
| Identity | face/hair/body visible traits vs refs | sampled-frame identity drift | так |
| Product/SKU | geometry, logo, OCR, color, material, scale | persistence, interaction/contact, logo/text stability | так |
| Річ | neckline, sleeves, length, print, seams, drape | temporal structure, no morph/flicker | так |
| Environment | ORG preserve or DIFF replace compliance | background continuity and unwanted mutations | так |
| Anatomy | hands, limbs, face, contact | hand/object artifacts and body continuity | так |
| Prompt compliance | pose/framing/action | timing/camera/no unwanted cut | так/за profile |
| Aesthetics | lighting, realism, composition | motion quality, cinematography | ranking, не override |
| Safety/rights | consent, prohibited content, brand policy | same | так |

### 11.2 No aggregate-score loophole

Неправильно:

```text
identity 0.55 + aesthetics 0.98 → average 0.77 → PASS
```

Правильно:

```text
identity < blocking threshold → FAIL
product < blocking threshold → FAIL
all blocking gates PASS → rank by aesthetics/cost/latency
```

### 11.3 Judges

MVP без локальних моделей:

1. deterministic media checks локально;
2. primary cloud VLM structured rubric;
3. independent cloud VLM або human для critical disagreement;
4. human approval before video and export.

Model не повинен бути єдиним judge власної генерації. Google output оцінює не лише Google judge; OpenAI output — не лише OpenAI judge.

### 11.4 Evidence, а не просто verdict

Кожен failure зберігає:

- reference crop;
- output crop;
- mask/diff;
- OCR text;
- video timecode/frame;
- judge/model/version;
- rule/threshold;
- proposed router action.

Приклад:

```json
{
  "name": "LOGO_TEXT",
  "blocking": true,
  "score": 0.62,
  "threshold": 0.92,
  "pass": false,
  "reason": "Second character changed from E to F at 00:03.12",
  "router_action": "REDUCE_MOTION",
  "evidence": ["qa/frame_0075.png", "qa/logo_crop_0075.png"]
}
```

### 11.5 Initial acceptance profiles

| Profile | Candidate count | QA | Human gate | Use |
|---|---:|---|---|---|
| `DRAFT` | 1–2 | technical + coarse semantic | optional | concepts/motion proof |
| `STANDARD` | 2 primary + conditional fallback | all blocking gates + evidence | before video/export | routine ads |
| `HERO` | multi-provider conditional tournament | two judges + specialist OCR/color + temporal | art director | launch/TV/hero |

Thresholds треба калібрувати на labeled benchmark. До цього будь-яке `0.90` — робоча policy, не наукова гарантія.

---

## 12. Retry, repair і provider switching

### 12.1 Transport retry ≠ semantic retry

Transport errors:

- `429`, timeout, transient `5xx`;
- до 3 retries;
- exponential backoff + jitter;
- same logical attempt/idempotency key;
- lookup existing provider job before повторною оплатою.

Semantic errors:

- wrong face, logo, clothing item, background, hands, motion;
- кожний новий generation = new attempt;
- максимум 2 attempts per provider;
- той самий blocking defect двічі → switch independent model family;
- safety rejection не перефразовується автоматично.

### 12.2 Earliest-defect repair

| Defect | Repair | Не робити |
|---|---|---|
| input blurry/occluded | request better input | 6 random generations |
| mask/background edge | rematte/composite | switch cinematic video model |
| face drift | stronger original refs / identity-specialist provider | only add more adjectives |
| локальна деталь речі | masked edit/VTO route | full scene regeneration first |
| logo/text | targeted edit/composite; reduce motion | upscale defect |
| environment only | environment edit preserving approved subject | regenerate identity |
| hand/product contact | simpler pose/action; shorter clip | increase resolution |
| temporal drift | reduce motion, bind element, shorter shot, switch model | longer prompt with more actions |
| provider outage | circuit breaker + independent lab | same upstream through another gateway |

### 12.3 Budget policy

- estimate cost before queueing;
- reserve budget atomically;
- soft alert at 70%;
- hard stop at 100%;
- max semantic candidates per asset;
- max provider switches;
- failed-charge policy recorded per provider;
- “best effort” never overrides customer budget.

---

## 13. Storage, lineage й observability

### 13.1 Canonical local/object-storage layout

```text
runs/<job_id>/
├── job.json
├── 00_input/
│   ├── original/
│   └── consent/
├── 01_preflight/
├── 02_extraction/
│   ├── human.json
│   ├── product.json
│   └── environment.json
├── 03_assets_locked/
├── 04_attempts/<attempt_id>/
│   ├── request.json
│   ├── response.json
│   ├── output.png|mp4
│   └── qa.json
├── 05_approved/
├── 06_master/
├── 07_web/
└── events.jsonl
```

### 13.2 Per-attempt provenance

Зберігати:

- provider, model ID, concrete version/snapshot;
- adapter version;
- provider job ID;
- input asset SHA-256;
- compiled prompt and prompt SHA-256;
- seed, якщо підтримується;
- всі parameters;
- estimated/actual cost;
- queue/runtime timestamps;
- output SHA-256;
- QA judge/version/evidence;
- reviewer identity and decision;
- route reason and fallback chain.

Replay означає відтворюваний **process**, не гарантію identical pixels. Багато generative APIs недетерміновані навіть із seed.

### 13.3 Provider URL TTL

Результат треба скачати одразу:

- BFL signed URL може жити близько 10 хвилин;
- Runway output — обмежений час, документація вимагає власне збереження;
- Replicate API files за замовчуванням прибираються приблизно через годину;
- інші vendors теж не є asset archive.

### 13.4 Minimum dashboards

- job completion rate;
- first-pass image/video rate;
- pass rate by task/model/version;
- defect taxonomy;
- semantic attempts per accepted asset;
- cost per accepted image/second/job;
- queue and wall-clock latency p50/p95;
- provider error/429/safety rate;
- human review rate and review time;
- fallback rate;
- model lifecycle alerts.

---

## 14. Hermes: мінімум із strict rules of work

Hermes підходить як conversational planner/tool user: має skills, delegation і security controls. Але “розумний агент” не замінює workflow engine. [Hermes docs](https://hermes-agent.nousresearch.com/docs/), [Hermes security](https://hermes-agent.nousresearch.com/docs/user-guide/security/), [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

### 14.1 Production configuration principles

- containerized execution;
- safe write root тільки в `runs/<job_id>`;
- `skills.write_approval: true`;
- new/changed skills require human approval;
- credential filtering;
- allowlisted tools and domains;
- separate dev/stage/prod keys;
- no raw secrets in prompts/logs;
- agent can emit only schema-valid tool payloads;
- provider adapters validate again server-side.

### 14.2 Locked Zeely skill rules

```text
1. Never infer invisible product facts; use UNKNOWN.
2. Never change an approved asset or locked fact.
3. Never call video generation without approved_still_sha256.
4. Never lower QA thresholds or raise budget.
5. Never retry safety rejection automatically.
6. Never use an unapproved provider for P1 likeness data.
7. Never treat a gateway wrapper as independent model redundancy.
8. Never auto-publish.
9. Always persist provider output before advancing state.
10. Always explain blocking defect with evidence and next action.
```

---

## 15. Три варіанти реалізації

## 15.1 Варіант 1 — Higgsfield-first Fast MVP

### Коли обирати

Потрібен сильний working demo за 5–8 engineering days, а Higgsfield MCP уже авторизований. Це demo architecture з правильними seams, не фінальний control plane.

### Схема

```text
User / reviewer
      │
      ▼
Hermes + locked Zeely skill
      │ validated JSON
      ▼
Thin Orchestrator
FastAPI + Pydantic + SQLite
      │
      ├── primary image/video → Higgsfield MCP
      ├── image API fallback → Gemini NB2 / OpenAI / BFL
      └── video API fallback → fal.ai Kling / Runway
                         │
                         ▼
                 runs/<job_id>/
                         │
             deterministic checks + cloud VLM
                         │
                   human approval
                         │
                 FFmpeg + HTML5 pack
```

### Exact stack

- Hermes: brief, extraction request, scene plan, status, approval UX.
- Higgsfield MCP: Soul/Cast/Elements, image/video exploration, analyzer/history.
- Direct image fallback: `gemini-3.1-flash-image`; secondary `gpt-image-2` or `flux-2-pro`.
- Video fallback: fal.ai `kling-video/v3/pro/image-to-video`; cheap draft `gemini-omni-flash-preview` or Runway Gen-4 Turbo.
- State: SQLite + append-only `events.jsonl`.
- Files: local encrypted workspace for demo; S3/R2-compatible storage optional.
- QA: deterministic checks + one cloud VLM + mandatory reviewer.
- Packaging: FFmpeg + static HTML/CSS/JS.

### Retry policy

- 3 transport retries for `429/5xx/timeout`.
- 1 semantic retry same model.
- repeated same defect → direct API fallback, not another vague MCP prompt.
- max 2 providers per asset.
- safety rejection → review.
- hard budget in `job.json`.

### Scope

- 3 people;
- avatar + one outfit result for each;
- one hero person in the full 3-chapter experience;
- ORG mandatory, one DIFF showcase;
- 3 clips × 4–6 s;
- HTML5 swipe/scroll timeline;
- run report with requests, attempts, QA and cost.

### Estimate

| Metric | Estimate |
|---|---|
| Engineering | 5–8 days |
| Calendar | 1–1.5 weeks |
| Generation cost / accepted 15–18 s demo | $5–20 + Higgsfield credits |
| E2E run latency | 10–30 min |
| Quality ceiling | 3.5/5 |
| Semantic reliability | 3/5 |
| Lock-in | high |

### Main failure modes

- MCP tool schema/behavior змінюється;
- underlying model при auto-routing невідомий;
- result URL/task ID губиться;
- direct fallback дає інший visual language;
- один judge пропускає identity/SKU drift;
- iOS scrub поганий через довгий GOP/неправильний preload.

### Definition of done

- process restart не губить job;
- duplicate webhook/poll не створює duplicate paid call;
- failed Higgsfield route реально переходить на independent API;
- video не запускається без approval hash;
- reviewer може побачити refs, prompt, model, attempts і defect evidence.

---

## 15.2 Варіант 2 — API-native dual-provider production — рекомендований

### Коли обирати

Потрібен beta/production pipeline, який не залежить від Higgsfield і переживає provider/model churn. Найкращий баланс для Zeely зараз.

### Схема

```text
Hermes UI / Zeely UI
       │
       ▼
Job Gateway
       │
Schema Registry + Policy + Budget
       │
       ▼
Temporal Cloud / durable workflow
       │
       ├── Google adapter
       │   NB2 / NB Pro / Omni / Veo
       │
       ├── Runway adapter
       │   Gen-4 Image / Gen-4 Turbo / Gen-4.5
       │
       ├── specialist image adapters
       │   OpenAI GPT Image 2 / BFL / FASHN
       │
       └── specialist video adapter
           Kling direct or fal.ai
                 │
                 ▼
        Postgres + encrypted object storage
                 │
      cross-provider QA + Review UI
                 │
          FFmpeg + HTML5 exporter
```

### Primary routes

Image:

- default multi-ref/environment: Nano Banana 2, 1K;
- identity-sensitive edit: GPT Image 2 medium, pinned snapshot;
- речі/VTO: FLUX VTO or FASHN; fallback GPT Image 2/FLUX.2 Pro after benchmark;
- brand/text/hero: Nano Banana Pro or FLUX.2 Max/Flex;
- 2K/4K only after semantic pass.

Video:

- cheap draft: Gemini Omni Flash Preview;
- general final motion: Runway Gen-4.5;
- human/product-aware motion: Kling 3 Elements;
- first/last transition or native-audio hero: Veo 3.1;
- reframe/keyframe/video edit fallback: Luma when enabled;
- Higgsfield MCP: `break_glass`, never silent automatic route.

### Durable workflow specifics

- Temporal activity wraps each provider call.
- `GenerationLedger` reserves idempotency key and budget before API call.
- Activity timeout does not immediately retry; first resolves provider job status.
- Outbox pattern emits webhook/events exactly once logically.
- Provider adapters normalize `submit / status / cancel / result / delete`.
- Every adapter exposes `capabilities()`, `priceEstimate()` and `health()`.
- Model IDs resolve through lifecycle registry, not hardcoded UI strings.
- Storage download is part of activity success; remote URL alone is not success.

### Security/privacy

- paid API tiers and contractual no-training terms;
- P1 likeness routing allowlist;
- signed URLs ≤15 min;
- provider uploads deleted after download/retention policy;
- originals encrypted at rest;
- no face images in general logs/analytics;
- explicit consent and revocation workflow;
- no sensitive attribute inference;
- human approval before external export/publish.

### Scope

- 3–10 people in batch;
- ORG and DIFF;
- avatar + 2 outfit/product variants;
- review UI with evidence and route history;
- pause/resume across deploy/restart;
- live fallback test;
- 9:16 HTML5 experience and MP4 master;
- cost/latency/quality dashboard.

### Estimate

| Metric | Estimate |
|---|---|
| Engineering | 18–28 days |
| Calendar, 1 senior | 3–5 weeks |
| Calendar, backend/AI + frontend | 2–3 weeks |
| Generation cost / accepted 15–18 s job | $10–35 |
| E2E run latency | 15–45 min |
| Quality | 4/5 |
| Semantic reliability after calibration | 4/5 |
| Lock-in | low/medium |

### Main failure modes

- style mismatch між independent models;
- preview endpoint deprecation;
- moderation mismatch for valid consented likeness;
- judges disagree;
- workflow retry duplicates paid call if ledger is wrong;
- regional restriction removes a route;
- 4K escalation wastes money without semantic improvement;
- third-party model inside a gateway fails with same upstream incident.

### Definition of done

- ≥97% jobs reach terminal state without engineer intervention;
- no orphan provider jobs;
- provider outage produces circuit-breaker fallback;
- 100% accepted outputs have lineage and QA evidence;
- first-pass and accepted-cost metrics visible by model version;
- consent revocation deletes all scoped artifacts with audit proof.

---

## 15.3 Варіант 3 — Premium Best-of-N Quality Router

### Коли обирати

Після benchmark на 30–50 consented cases, якщо quality ceiling Варіанта 2 не закриває hero campaigns. Не починати з цього: без власних labels router лише дорого множить випадковість.

### Схема

```text
Hermes / Art Director UI
          │
          ▼
Policy + Consent + Budget Engine
          │
          ▼
Benchmark-aware Capability Router
  ┌───────┼────────┬────────┬────────┐
  ▼       ▼        ▼        ▼        ▼
OpenAI  Google   BFL/FASHN Runway  Kling/Luma/HF
  └───────┴────────┴────────┴────────┘
                     │
                     ▼
              Candidate Ledger
                     │
 deterministic QA + two VLMs + specialist checks
                     │
                     ▼
             Pareto Selector
 identity / SKU / environment / motion / cost / latency
                     │
              Art Director Gate
                     │
        master + variants + localization
```

### Candidate tournament

1. Router ranks providers per `task_class`, not globally.
2. Usually 2 labs × 2 candidates; hard limit 6 semantic candidates.
3. Technical/blocking failures are removed before aesthetics.
4. Winners lie on a Pareto frontier; beauty cannot compensate identity/SKU failure.
5. Reviewer sees why a candidate won and all defeated alternatives.
6. 2K/4K/video fan-out begins only after approved still/style/shotlist.
7. Accepted/rejected labels update benchmark registry only after review.

### Data-aware routing

- `P0`: non-sensitive product/environment;
- `P1`: consented adult likeness;
- `P2`: minors/sensitive/legal-hold — restricted/manual policy;
- quality tournament never fans P1/P2 data to every vendor by default;
- each provider has DPA/no-training/region/retention fields in registry.

### Scope

- benchmark 30–50 ORG/DIFF cases;
- 3–5 campaign styles;
- multiple outfits/SKUs;
- Art Director comparison UI;
- provider scorecard;
- 1K draft → 2K/4K masters;
- 1080p master + 9:16/16:9/1:1 variants;
- localization and DOM captions;
- cost/latency/pass-rate dashboard;
- privacy deletion and provider failover demos.

### Estimate

| Metric | Estimate |
|---|---|
| Engineering | 45–70 days |
| Calendar, 2–3 engineers | 6–10 weeks |
| Generation cost / accepted 15–18 s job | $40–150 |
| E2E latency | 45–120 min |
| Quality ceiling | 4.8/5 |
| Semantic reliability after calibration | 4.5/5 |
| Lock-in | low |
| Operational complexity | high |

### Main failure modes

- benchmark overfit;
- correlated judges miss the same defect;
- cost grows faster than quality;
- cross-model style discontinuity;
- privacy surface expands with each vendor;
- router selects spectacular over faithful;
- preview alias drifts;
- rate limits block tournament;
- insufficient labels make ranking noise.

### Go/no-go condition

Add Best-of-N only if measured uplift justifies it:

```text
Δ accepted quality or first-pass rate
> added generation cost + review cost + latency cost
```

---

## 15.4 Decision matrix

| Criterion | V1 Higgsfield-first | V2 API-native | V3 Premium router |
|---|---:|---:|---:|
| Best use | test/demo | beta/production | hero/creative platform |
| Engineering | 5–8 d | 18–28 d | 45–70 d |
| Provider resilience | low | high | very high |
| Reproducible graph | basic | full | full + benchmark |
| Semantic QA | one VLM + human | cross-provider + human | ensemble + specialist + art director |
| Cost multiplier | 1× | 1.5–2.5× | 4–8× |
| Quality ceiling | 3.5/5 | 4/5 | 4.8/5 |
| Lock-in | high | low/medium | low |
| Recommendation | build as demo shell | **choose now** | add after evidence |

---

## 16. HTML5 swipe/scroll, прив’язаний до video time

### 16.1 Delivery architecture

Один silent scrub master відповідає за camera/world transition. Інтерфейс, назви, pipeline explanation і “дякую” залишаються DOM overlays — їх можна локалізувати, виправити і зробити доступними без нового render.

```text
native scroll / touch / wheel
          │
          ▼
normalized progress 0…1
          │
          ▼
timeline.json
progress → target video time + overlay state
          │
          ▼
requestAnimationFrame easing
          │
          ▼
video.currentTime
          │
          ▼
requestVideoFrameCallback
sync DOM overlays with presented frame
```

### 16.2 Chapters

`timeline.json`:

```json
{
  "duration": 28.0,
  "chapters": [
    { "id": "mirrors", "scroll": [0.00, 0.24], "video": [0.0, 6.0] },
    { "id": "tv-shoot", "scroll": [0.24, 0.62], "video": [6.0, 15.0] },
    { "id": "laptop", "scroll": [0.62, 1.00], "video": [15.0, 28.0] }
  ],
  "overlays": [
    { "id": "mirror-ui", "show": [0.6, 5.8] },
    { "id": "pipeline-titles", "show": [17.0, 26.8] },
    { "id": "thanks", "show": [26.0, 28.0] }
  ]
}
```

### 16.3 Interaction rules

- Native page scroll is the primary input; swipe maps naturally to scroll.
- Touch/wheel events change `targetProgress`, not video directly.
- RAF eases current progress toward target to avoid seek jitter.
- Chapter boundaries can snap softly after input ends.
- Do not use `timeupdate` as the main frame clock; it is too sparse for scrub synchronization.
- Use `requestVideoFrameCallback()` when supported; RAF fallback otherwise.
- `playsinline muted preload="auto"`; tap-to-start fallback for iOS.
- First interaction primes playback, then pauses and scrubs.
- `prefers-reduced-motion` switches to posters/crossfades and keyboard/next controls.
- Keyboard arrows/PageUp/PageDown and visible chapter navigation remain available.

References: [MDN `currentTime`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime), [MDN `requestVideoFrameCallback`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

### 16.4 Encoding profile for smooth seek

- H.264 MP4 primary; WebM optional;
- constant 24 fps;
- short GOP around 6–12 frames after device testing;
- frequent keyframes at chapter boundaries;
- `-movflags +faststart`;
- 720p mobile-first scrub master; separate 1080p linear playback asset if needed;
- poster per chapter;
- no baked UI text;
- asset cache with hashed filenames;
- range requests/CDN enabled.

Trade-off: shorter GOP increases file size, but gives much better random seeking. Test actual iPhone Safari and low-end Android; desktop Chrome alone is not acceptance.

### 16.5 Fail-safe experience

If video cannot autoplay/seek:

1. show chapter poster;
2. keep all copy/UI usable;
3. offer “tap to start”;
4. fall back to discrete next/previous scene;
5. never block access to results or pipeline explanation.

---

## 17. Benchmark і economics

### 17.1 Спочатку benchmark, потім “quality router”

Мінімальний evaluation set:

| Dimension | Coverage |
|---|---|
| Humans | 30–50 consented adults; lighting/skin tone/hair/glasses variety |
| Input quality | clean, mediocre, repairable, reject cases |
| Речі | T-shirt, shirt, jacket, dress, patterned/logotyped items |
| Products | bag, bottle, cosmetics, small device, reflective/transparent item |
| Environment | ORG preserve + DIFF replace; simple and cluttered scenes |
| Motion | static, turn, walk, hand-product contact, camera push/pan |
| Formats | 9:16 primary; 16:9 and 1:1 subset |

Не використовувати production customer faces у broad provider tournament без окремої згоди.

### 17.2 Labeling rubric

Кожний output отримує окремі labels:

- identity: pass/minor/major;
- product geometry;
- logo/text;
- color/material;
- структура речі;
- environment policy;
- anatomy/contact;
- temporal stability;
- aesthetic/art direction;
- final ship/no-ship;
- defect evidence and repair type.

### 17.3 Core KPIs

| KPI | MVP target | Production target |
|---|---:|---:|
| Job terminal-state rate | ≥95% | ≥99% |
| First-pass accepted still | measure baseline | ≥60–70% by supported task class |
| First-pass accepted clip | measure baseline | ≥45–60% by shot class |
| Jobs needing engineer | <10% | <3% |
| Orphan paid jobs | 0 | 0 |
| Accepted output with full lineage | 100% | 100% |
| Review-before-video compliance | 100% | 100% |
| Budget overshoot | 0 | 0 |
| Consent/deletion SLA success | 100% | 100% |

Quality targets must be reported per task class. Один global “92% quality” приховує, що talking head може бути 95%, а річ+logo+walk — 30%.

### 17.4 Unit economics formula

```text
accepted_job_cost =
  Σ successful_generation_calls
  + charged_failed_calls
  + VLM_QA
  + storage_and_egress
  + human_review_minutes × loaded_rate
```

Не рахуйте лише ціну winner. Якщо для одного accepted clip було 5 paid candidates, усі 5 входять у COGS.

### 17.5 Example cost envelope

Для 3 clips × 5 s:

- Runway Gen-4.5 raw one-pass: 15 s × $0.12 ≈ $1.80;
- Kling 3 Pro no audio raw one-pass через fal: 15 s × $0.112 ≈ $1.68;
- Veo Fast raw one-pass: roughly $0.10–$0.12/s ≈ $1.50–$1.80;
- accepted cost стає вищим через candidates, semantic retries, stills, QA і review.

Тому Варіант 2 `$10–35` за accepted pack — не ціна одного render, а operational envelope. Ціни змінюються; це planning estimate, не commercial quote.

---

## 18. План запуску

### 18.1 Перші 5–8 engineering days: Variant 1

| Day | Deliverable |
|---:|---|
| 1 | ADR, schemas, folder structure, consent/preflight, provider interface |
| 2 | Higgsfield MCP adapter + direct image fallback + attempt ledger |
| 3 | strict extraction, prompt compiler, image generation, technical QA |
| 4 | cloud VLM rubric, approval gate, video adapter/fallback |
| 5 | temporal QA, FFmpeg master, HTML5 timeline |
| 6 | 3-user batch, failure injection, cost/latency report |
| 7–8 | visual polish, mobile QA, README/demo capture, contingency |

### 18.2 Production hardening: Variant 2

**Phase A — control plane, 4–6 days**

- Postgres schema;
- durable workflow;
- idempotency/budget ledger;
- schema registry;
- encrypted object storage;
- event/audit model.

**Phase B — providers, 5–8 days**

- Google adapter;
- Runway adapter;
- OpenAI/BFL/FASHN image specialist adapters;
- Kling/fal video specialist;
- health/circuit breaker;
- lifecycle registry and contract tests.

**Phase C — QA/review, 5–8 days**

- deterministic checks;
- cross-provider VLM QA;
- evidence extraction;
- review UI;
- defect-aware router;
- consent/deletion workflow.

**Phase D — delivery/benchmark, 4–6 days**

- HTML5 packager;
- mobile/browser QA;
- 30-case benchmark subset;
- dashboards and alerts;
- runbook/provider outage drill.

### 18.3 P0 backlog

1. Asset/scene/job/QA schemas.
2. Consent and deletion.
3. State machine and immutable attempt ledger.
4. Higgsfield adapter + one independent image and video API.
5. Approved-still gate.
6. Technical + identity/product/environment QA.
7. Budget/idempotency/circuit breaker.
8. Own storage and lineage.
9. 3-user required test deliverables.
10. HTML5 3-chapter demo.

### 18.4 P1 backlog

- specialist VTO route;
- cross-provider judges;
- review UI evidence overlays;
- model lifecycle automation;
- provider benchmark registry;
- multi-format reframe/localization;
- enterprise DPA/region policies;
- C2PA/provenance handling;
- best-of-N only after labels.

---

## 19. Ризики й controls

| Risk | Probability | Impact | Control |
|---|---|---|---|
| identity drift | high | high | canonical refs, independent QA, human gate, shorter shots |
| exact SKU/logo drift | high | high | isolation/mask, multi-view refs, OCR/color gates, composite/VTO |
| environment mutation | medium | high | executable ORG/DIFF policy, environment plate, evidence diff |
| temporal morphing | high | high | approved still, one action, shorter clips, Elements/provider switch |
| provider outage/rate limit | medium | high | circuit breaker, independent lab fallback, durable queue |
| gateway/upstream correlated failure | medium | high | track upstream lab, not only API host |
| model deprecation | high | medium/high | lifecycle registry, contract tests, sunset alert, aliases resolved to IDs |
| hidden cost explosion | medium | high | pre-reservation, candidate limits, cost per accepted output |
| prompt injection | medium | high | external content as data, schema validation, tool allowlist |
| privacy/likeness misuse | low/medium | critical | explicit consent, data-class routing, encryption, deletion, no auto-publish |
| judge false pass | medium | high | independent judge/human, evidence, blocking gates |
| style mismatch after fallback | medium | medium | approved style header, post-grade, use fallback per shot carefully |
| mobile scrub failure | medium | medium | short GOP, posters, native scroll, device matrix, reduced-motion fallback |

### Privacy guardrails

- Use only consented likeness and commercial rights evidence.
- Do not infer ethnicity, health, gender identity or exact age.
- Handle minors and sensitive requests through a separate legal/manual route.
- Do not store face embeddings unless explicitly justified and approved.
- Provider terms, regions, training use and retention must be recorded in registry.
- Revocation must delete originals, derived identity assets, provider files and scoped outputs.
- Preserve invisible provenance watermarks/metadata when required; do not build stripping as a feature.

---

## 20. Final recommendation

### Architecture decision

Прийняти **Variant 2** як target architecture, але доставити його через практичну послідовність:

1. За 5–8 днів зібрати Variant 1 із правильними interfaces і schemas.
2. Не розмазувати Higgsfield MCP calls по codebase; один `HiggsfieldAdapter`.
3. Відразу додати independent `ImageProvider` і `VideoProvider` fallback.
4. Перенести state у durable graph/ledger до beta.
5. Зібрати 30–50 labeled cases і виміряти defect/pass/cost.
6. Лише на доказах додати Variant 3.

### Мінімальний production provider set

```text
Image
  primary general: Google Nano Banana 2
  identity/final: OpenAI GPT Image 2 pinned
  product/VTO specialist: BFL FLUX / FASHN

Video
  cheap draft: Google Omni Flash Preview
  general final: Runway Gen-4.5
  human/product motion: Kling 3
  first/last or hero audio: Veo 3.1
  tertiary independent fallback: MiniMax/Luma by task

Agent/creative
  Hermes + Higgsfield MCP adapter

Talking presenter, if separate product lane
  HeyGen → Tavus
```

### Одна фраза для CTO

> Назовні — сильний Hermes-agent experience. Під капотом — strict JSON, durable state machine, immutable approved assets, independent provider routes, blocking QA і повна lineage. Саме protocol, а не одна модель, робить Zeely надійним.

---

## 21. Методологія і обмеження

- Audit виконано 19.07.2026.
- Використані переважно official product/help/API/pricing/lifecycle sources.
- Vendor claims не трактуються як independent benchmark.
- “Не знайдено public API/feature” не означає, що enterprise/private API не існує; це означає, що його не можна закладати без commercial verification.
- Ціни — planning snapshots, не quote; currency/tax/region/volume/failed-call rules можуть відрізнятися.
- Feature parity між web UI, MCP, direct API і gateway-hosted model не припускається.
- Перед контрактом потрібні live API contract tests, DPA/retention review і benchmark на Zeely data.

Ключові індекси документації: [Higgsfield MCP](https://higgsfield.ai/mcp), [Runway API](https://docs.dev.runwayml.com/api/), [Gemini image](https://ai.google.dev/gemini-api/docs/image-generation), [Gemini video](https://ai.google.dev/gemini-api/docs/omni), [OpenAI GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2), [BFL FLUX.2](https://docs.bfl.ai/flux_2/flux2_overview), [Luma Agents API](https://docs.agents.lumalabs.ai/), [fal.ai model API](https://fal.ai/docs/model-api-reference), [Replicate HTTP API](https://replicate.com/docs/reference/http/), [Hermes](https://hermes-agent.nousresearch.com/docs/).
