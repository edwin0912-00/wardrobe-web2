const freezeNode = (node) => Object.freeze(node);
const freezeRow = (row) => Object.freeze({ ...row, nodes: Object.freeze(row.nodes.map(freezeNode)) });

export const PIPELINE_ROWS = Object.freeze([
  freezeRow({
    id: 'evidence',
    label: '01 / EVIDENCE NORMALIZATION',
    direction: 'forward',
    nodes: [
      {
        id: 'intake', title: 'Input Finalize', code: 'UPLOAD → QUEUED', detail: 'draft upload · decode · finalize',
        input: 'людина + додаткове фото + фото речей',
        operation: 'Draft upload → validate → immutable run copy on finalize',
        output: '15-min draft refs → run_id + immutable sources',
        gate: 'draft ≤18 MB · core ≤20 MB · ≥256×256',
      },
      {
        id: 'garment-passport', title: 'Картка речі', code: 'ITEM_FACTS', detail: 'тип · колір · матеріал · деталі',
        input: 'вихідні фото речей',
        operation: 'VLM визначає категорію й фіксує видимі тип, колір, матеріал/фактуру, візерунок, логотип/текст і конструкцію',
        output: 'структуровані картки речей',
        gate: 'ВИДИМЕ / НЕВІДОМЕ · впевненість ≥ .70 · блокери',
      },
      {
        id: 'garment-grouping', title: 'Групування ракурсів', code: 'VIEW_GROUPING', detail: 'та сама річ ≥ .90 · конфлікти категорій',
        input: 'картки речей + індекси фото',
        operation: 'Об’єднати ракурси тієї самої фізичної речі',
        output: 'групи ракурсів + категорії речей',
        gate: 'дві речі однієї категорії → вибір користувача',
      },
      {
        id: 'garment-canonical', title: 'Підготовка речі', code: 'ITEM_PREPARATION', detail: 'білий фон · фіксований маршрут моделей',
        input: 'групи ракурсів + видимі характеристики',
        operation: 'GPT Image 2 → Nano Banana 2 → Nano Banana Pro',
        output: 'еталонне зображення речі',
        gate: 'видимі характеристики збігаються · приховане не вигадується',
      },
      {
        id: 'garment-qa', title: 'Звірка речі з оригіналом', code: 'ITEM_QA', detail: 'форма · колір · матеріал · принт/логотип',
        input: 'вихідні фото + підготовлена річ',
        operation: 'Незалежний VLM звіряє тип, форму, колір, матеріал, фактуру, візерунок, логотип/текст і конструкцію',
        output: 'перевірене зображення на білому фоні + вирізаний об’єкт + QA-докази',
        gate: 'PASS → далі · RETRY → наступна модель · NEEDS_INPUT / REJECT → стоп',
      },
    ],
  }),
  freezeRow({
    id: 'control',
    label: '02 / IMMUTABLE CONTROL PLANE',
    direction: 'reverse',
    nodes: [
      {
        id: 'job-contract', title: 'Job Contract', code: 'CORE_PIPELINE · RECEIVED', detail: 'validated contract · SHA snapshot',
        input: 'identity/outfit packs + fixed policy',
        operation: 'Serialize job, resolve packs and snapshot SHA-256 inputs',
        output: 'immutable job + execution hash + RECEIVED checkpoint',
        gate: 'runtime contract + readable paths + fixed route',
      },
      {
        id: 'source-validation', title: 'Runtime Validation', code: 'VALIDATING', detail: 'contract · readable paths · fixed route',
        input: 'normalized job context + referenced files',
        operation: 'Re-check readable files and record the locked model route',
        output: 'validated runtime context',
        gate: 'reject unreadable input or policy mismatch',
      },
      {
        id: 'identity-binding', title: 'Identity Adapter', code: 'CONDITIONING_IDENTITY', detail: 'preconditioned passthrough · receipt',
        input: 'primary identity + verified pack summary',
        operation: 'Validate primary media and persist conditioning facts',
        output: 'conditioned identity artifact + facts receipt',
        gate: 'artifact required · idempotency receipt',
      },
      {
        id: 'outfit-binding', title: 'Outfit Adapter', code: 'CONDITIONING_OUTFIT', detail: 'image validation / text passthrough',
        input: 'text and/or raw outfit reference + verified pack summary',
        operation: 'Validate the reference or preserve text; journal facts',
        output: 'conditioned outfit artifact/facts',
        gate: 'image route requires a persisted artifact',
      },
      {
        id: 'reference-gate', title: 'Reference Gate', code: 'CONDITIONING_QA · READY', detail: 'PASS · bounded retry · stop',
        input: 'identity + outfit reference packs',
        operation: 'Independent conditioning QA and readiness decision',
        output: 'hash-bound approved references',
        gate: 'PASS / RETRY / NEEDS_INPUT / REJECT',
      },
    ],
  }),
  freezeRow({
    id: 'generation',
    label: '03 / GENERATE + VERIFY',
    direction: 'forward',
    nodes: [
      {
        id: 'avatar-candidate', title: 'Avatar Candidate', code: 'GENERATING_AVATAR', detail: 'generate or verified exact reuse',
        input: 'identity pack + compiled prompt',
        operation: 'Fixed model route, or exact approved-avatar import',
        output: 'base avatar candidate',
        gate: 'journaled generation OR SHA-256 + PASS receipt',
      },
      {
        id: 'avatar-qa', title: 'Avatar QA Router', code: 'AVATAR_QA · AVATAR_READY', detail: 'identity · framing · anatomy / reuse receipt',
        input: 'identity evidence + avatar candidate/receipt',
        operation: 'Semantic QA or verify hash-bound PASS receipt',
        output: 'approved immutable avatar',
        gate: 'PASS / RETRY / NEEDS_INPUT / REJECT',
      },
      {
        id: 'outfit-candidate', title: 'Outfit Candidate', code: 'GENERATING_OUTFIT', detail: 'approved avatar first · зафіксовані характеристики речей',
        input: 'approved avatar + identity pack + текст і/або підготовлені речі',
        operation: 'Generate full look through the fixed image route',
        output: 'outfit candidate',
        gate: 'avatar identity remains the primary reference',
      },
      {
        id: 'outfit-qa', title: 'Outfit QA Router', code: 'OUTFIT_QA · OUTFIT_READY', detail: 'identity · відповідність речей · anatomy/residue',
        input: 'approved avatar + вихідні фото речей + candidate',
        operation: 'Independent QA: identity is unchanged and clothing matches the approved text/reference evidence',
        output: 'approved full-look PNG',
        gate: 'PASS / RETRY / NEEDS_INPUT / REJECT',
      },
      {
        id: 'evidence-export', title: 'Evidence Export', code: 'EXPORTING → COMPLETED', detail: 'PNGs · manifest · hashes · QA',
        input: 'approved avatar, outfit and QA records',
        operation: 'Materialize approved artifacts and write the run manifest',
        output: 'PNG pair + run manifest',
        gate: 'all output hashes and evidence recorded',
      },
    ],
  }),
]);

export const PIPELINE_NODES = Object.freeze(PIPELINE_ROWS.flatMap((row, rowIndex) => row.nodes.map((node, rowOffset) => Object.freeze({
  ...node,
  row: rowIndex,
  column: row.direction === 'reverse' ? 4 - rowOffset : rowOffset,
  rowId: row.id,
  rowLabel: row.label,
  rowDirection: row.direction,
}))));

export const PIPELINE_NODE_COUNT = PIPELINE_NODES.length;

const NODE_INDEX = Object.freeze(Object.fromEntries(PIPELINE_NODES.map((node, index) => [node.id, index])));
const progress = (percent, nodeId, title, label) => Object.freeze({ percent, nodeId, step: nodeId == null ? null : NODE_INDEX[nodeId], title, label });

const FALLBACK = progress(0, null, 'Невідомий стан сервера', 'UNMAPPED');

const DISPLAY_CHECKPOINT_CODES = Object.freeze({
  GARMENT_CONDITIONING: 'ITEM_FACTS',
  GARMENT_GROUPING: 'VIEW_GROUPING',
  GARMENT_GENERATING: 'ITEM_PREPARATION',
  GARMENT_QA: 'ITEM_QA',
});

export function checkpointDisplayCode(key) {
  return DISPLAY_CHECKPOINT_CODES[key] ?? String(key ?? 'CHECKPOINT_SYNC');
}

export const PROGRESS_STATES = Object.freeze({
  RESUMING: progress(4, null, 'Відновлюємо активний запуск', 'CHECKPOINT SYNC'),
  PREPARING: progress(4, 'intake', 'Готуємо файли', 'PREPARE'),
  UPLOADING: progress(6, 'intake', 'Завантажуємо файли', 'UPLOAD'),
  UPLOADED: progress(10, 'intake', 'Файли прийнято сервером', 'INPUT'),
  QUEUED: progress(10, 'intake', 'Запуск створено й зафіксовано', 'QUEUED'),
  GARMENT_CONDITIONING: progress(14, 'garment-passport', 'Фіксуємо характеристики речей', 'VLM · КАРТКА РЕЧІ'),
  GARMENT_GROUPING: progress(16, 'garment-grouping', 'Групуємо ракурси речей', 'ГРУПУВАННЯ РАКУРСІВ'),
  GARMENT_GENERATING: progress(20, 'garment-canonical', 'Готуємо еталонне зображення речі', 'ПІДГОТОВКА РЕЧІ'),
  GARMENT_QA: progress(24, 'garment-qa', 'Звіряємо річ з оригінальними фото', 'ЗВІРКА РЕЧІ'),
  CORE_PIPELINE: progress(28, 'job-contract', 'Запускаємо ядро генерації', 'JOB CONTRACT'),
  RECEIVED: progress(30, 'job-contract', 'Ядро прийняло задачу', 'RECEIVED'),
  VALIDATING: progress(32, 'source-validation', 'Перевіряємо контракт і файли', 'VALIDATE'),
  CONDITIONING_IDENTITY: progress(35, 'identity-binding', 'Перевіряємо матеріали людини', 'IDENTITY ADAPTER'),
  CONDITIONING_OUTFIT: progress(38, 'outfit-binding', 'Перевіряємо матеріали образу', 'OUTFIT ADAPTER'),
  CONDITIONING_RETRY: progress(38, 'reference-gate', 'Повторно готуємо пакети матеріалів', 'REFERENCE RETRY'),
  CONDITIONING_QA: progress(42, 'reference-gate', 'Перевіряємо підготовлені матеріали', 'REFERENCE QA'),
  REFERENCES_READY: progress(46, 'reference-gate', 'Матеріали затверджено', 'REFERENCES READY'),
  GENERATING_AVATAR: progress(55, 'avatar-candidate', 'Генеруємо базовий аватар', 'AVATAR GEN'),
  AVATAR_RETRY: progress(55, 'avatar-candidate', 'Повторно генеруємо аватар', 'AVATAR RETRY'),
  AVATAR_QA: progress(68, 'avatar-qa', 'Перевіряємо схожість і якість', 'AVATAR QA'),
  AVATAR_READY: progress(72, 'avatar-qa', 'Базовий аватар затверджено', 'AVATAR READY'),
  GENERATING_OUTFIT: progress(82, 'outfit-candidate', 'Генеруємо повний образ', 'OUTFIT GEN'),
  OUTFIT_RETRY: progress(82, 'outfit-candidate', 'Повторно генеруємо образ', 'OUTFIT RETRY'),
  OUTFIT_QA: progress(91, 'outfit-qa', 'Перевіряємо образ і схожість', 'OUTFIT QA'),
  OUTFIT_READY: progress(94, 'outfit-qa', 'Образ затверджено', 'OUTFIT READY'),
  OPTIONAL_SCENE: progress(99, 'evidence-export', 'Готуємо додатковий редакційний кадр', 'OPTIONAL STILL'),
  EXPORTING: progress(98, 'evidence-export', 'Експортуємо PNG і маніфест', 'EXPORT'),
  COMPLETED: progress(100, 'evidence-export', 'Результат готовий', 'READY'),
});

export function resolveProgressState(key, explicitPercent = null) {
  const base = PROGRESS_STATES[key] ?? FALLBACK;
  const percent = explicitPercent == null
    ? base.percent
    : Math.max(0, Math.min(100, Math.round(explicitPercent)));
  return { ...base, key: PROGRESS_STATES[key] ? key : String(key ?? 'UNMAPPED'), percent };
}

export function nodeState(nodeIndex, activeStep, route = {}, completed = false) {
  const garmentSkipped = route.garment_images_supplied === false && nodeIndex >= 1 && nodeIndex <= 4;
  if (garmentSkipped) return 'skipped';
  if (activeStep == null) return 'pending';
  if (route.avatar_reuse === true && nodeIndex === 10 && (completed || nodeIndex < activeStep)) return 'reused';
  if (completed) return 'done';
  if (nodeIndex === activeStep) return 'active';
  if (nodeIndex > activeStep) return 'pending';
  return 'done';
}
