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
        input: 'person + identity + garment files',
        operation: 'Draft upload → validate → immutable run copy on finalize',
        output: '15-min draft refs → run_id + immutable sources',
        gate: 'draft ≤18 MB · core ≤20 MB · ≥256×256',
      },
      {
        id: 'garment-passport', title: 'Garment Passport', code: 'GARMENT_CONDITIONING', detail: 'strict VLM JSON · observed only',
        input: 'raw garment views',
        operation: 'VLM classifies each item and extracts visible facts',
        output: 'typed garment passport',
        gate: 'OBSERVED / UNKNOWN · blockers',
      },
      {
        id: 'garment-grouping', title: 'Multi-view Group', code: 'GARMENT_GROUPING', detail: 'same-item ≥ .90 · slot conflicts',
        input: 'passport items + source indexes',
        operation: 'Group views of the same physical garment',
        output: 'reference sets + category slots',
        gate: 'duplicate slot → explicit user choice',
      },
      {
        id: 'garment-canonical', title: 'Canonical Garment', code: 'GARMENT_GENERATING', detail: 'white card · fixed model route',
        input: 'grouped views + observable locks',
        operation: 'GPT Image 2 → Nano Banana 2 → Nano Banana Pro',
        output: 'normalized reference-card candidate',
        gate: 'observable locks match · hidden details stay non-authoritative',
      },
      {
        id: 'garment-qa', title: 'Звірка речі з оригіналом', code: 'GARMENT_QA', detail: 'форма · колір · матеріал · принт/logo',
        input: 'вихідні фото речі + підготовлена white-card версія',
        operation: 'Незалежний VLM звіряє тип, форму, колір, матеріал, фактуру, патерн, logo/text і конструкцію',
        output: 'підтверджена white card + transparent cutout + QA evidence',
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
        id: 'outfit-candidate', title: 'Outfit Candidate', code: 'GENERATING_OUTFIT', detail: 'approved avatar first · garment locks',
        input: 'approved avatar + identity pack + text and/or garment pack',
        operation: 'Generate full look through the fixed image route',
        output: 'outfit candidate',
        gate: 'avatar identity remains the primary reference',
      },
      {
        id: 'outfit-qa', title: 'Outfit QA Router', code: 'OUTFIT_QA · OUTFIT_READY', detail: 'identity · garment · anatomy/residue',
        input: 'approved avatar + garment evidence + candidate',
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

const FALLBACK = progress(0, null, 'Невідомий server checkpoint', 'UNMAPPED');

export const PROGRESS_STATES = Object.freeze({
  RESUMING: progress(4, null, 'Відновлюємо активний run', 'CHECKPOINT SYNC'),
  PREPARING: progress(4, 'intake', 'Готуємо файли', 'PREPARE'),
  UPLOADING: progress(6, 'intake', 'Завантажуємо файли', 'UPLOAD'),
  UPLOADED: progress(10, 'intake', 'Input прийнято сервером', 'INPUT'),
  QUEUED: progress(10, 'intake', 'Immutable run створено', 'QUEUED'),
  GARMENT_CONDITIONING: progress(14, 'garment-passport', 'Створюємо garment passport', 'VLM EXTRACT'),
  GARMENT_GROUPING: progress(16, 'garment-grouping', 'Групуємо ракурси речей', 'MULTI-VIEW'),
  GARMENT_GENERATING: progress(20, 'garment-canonical', 'Створюємо canonical garment', 'CANONICALIZE'),
  GARMENT_QA: progress(24, 'garment-qa', 'Звіряємо річ з оригінальними фото', 'ЗВІРКА РЕЧІ'),
  CORE_PIPELINE: progress(28, 'job-contract', 'Запускаємо immutable core job', 'JOB CONTRACT'),
  RECEIVED: progress(30, 'job-contract', 'Core job прийнято', 'RECEIVED'),
  VALIDATING: progress(32, 'source-validation', 'Перевіряємо runtime contract і files', 'VALIDATE'),
  CONDITIONING_IDENTITY: progress(35, 'identity-binding', 'Валідуємо identity adapter', 'IDENTITY ADAPTER'),
  CONDITIONING_OUTFIT: progress(38, 'outfit-binding', 'Валідуємо outfit adapter', 'OUTFIT ADAPTER'),
  CONDITIONING_RETRY: progress(38, 'reference-gate', 'Повторно готуємо reference packs', 'REFERENCE RETRY'),
  CONDITIONING_QA: progress(42, 'reference-gate', 'Перевіряємо підготовлені references', 'REFERENCE QA'),
  REFERENCES_READY: progress(46, 'reference-gate', 'References затверджено', 'REFERENCES READY'),
  GENERATING_AVATAR: progress(55, 'avatar-candidate', 'Генеруємо base avatar', 'AVATAR GEN'),
  AVATAR_RETRY: progress(55, 'avatar-candidate', 'Повторно генеруємо avatar', 'AVATAR RETRY'),
  AVATAR_QA: progress(68, 'avatar-qa', 'Перевіряємо identity та якість', 'AVATAR QA'),
  AVATAR_READY: progress(72, 'avatar-qa', 'Base avatar затверджено', 'AVATAR READY'),
  GENERATING_OUTFIT: progress(82, 'outfit-candidate', 'Генеруємо повний образ', 'OUTFIT GEN'),
  OUTFIT_RETRY: progress(82, 'outfit-candidate', 'Повторно генеруємо outfit', 'OUTFIT RETRY'),
  OUTFIT_QA: progress(91, 'outfit-qa', 'Перевіряємо outfit та identity', 'OUTFIT QA'),
  OUTFIT_READY: progress(94, 'outfit-qa', 'Outfit затверджено', 'OUTFIT READY'),
  OPTIONAL_SCENE: progress(99, 'evidence-export', 'Готуємо опціональний editorial still', 'OPTIONAL STILL'),
  EXPORTING: progress(98, 'evidence-export', 'Експортуємо PNG і manifest', 'EXPORT'),
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
