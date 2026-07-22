export const PIPELINE_NODE_COUNT = 7;

const FALLBACK = Object.freeze({ percent: 34, step: 2, title: 'Pipeline працює', label: 'LIVE' });

export const PROGRESS_STATES = Object.freeze({
  RESUMING: { percent: 4, step: 0, title: 'Відновлюємо активний run', label: 'RESUME' },
  PREPARING: { percent: 4, step: 0, title: 'Готуємо файли', label: 'PREPARE' },
  UPLOADING: { percent: 6, step: 0, title: 'Завантажуємо файли', label: 'UPLOAD' },
  UPLOADED: { percent: 10, step: 0, title: 'Input прийнято сервером', label: 'INPUT' },
  QUEUED: { percent: 10, step: 0, title: 'Immutable run створено', label: 'INPUT' },
  GARMENT_CONDITIONING: { percent: 14, step: 1, title: 'Готуємо garment references', label: 'REFERENCES' },
  GARMENT_GROUPING: { percent: 16, step: 1, title: 'Групуємо ракурси речей', label: 'REFERENCES' },
  GARMENT_GENERATING: { percent: 20, step: 1, title: 'Створюємо canonical garment', label: 'REFERENCES' },
  GARMENT_QA: { percent: 24, step: 1, title: 'Перевіряємо canonical garment', label: 'REFERENCES' },
  CORE_PIPELINE: { percent: 28, step: 1, title: 'Запускаємо immutable core job', label: 'REFERENCES' },
  RECEIVED: { percent: 30, step: 1, title: 'Core job прийнято', label: 'REFERENCES' },
  VALIDATING: { percent: 32, step: 1, title: 'Перевіряємо immutable inputs', label: 'REFERENCES' },
  CONDITIONING_IDENTITY: { percent: 35, step: 1, title: 'Готуємо identity reference', label: 'REFERENCES' },
  CONDITIONING_OUTFIT: { percent: 38, step: 1, title: 'Готуємо outfit references', label: 'REFERENCES' },
  CONDITIONING_RETRY: { percent: 38, step: 1, title: 'Повторно готуємо references', label: 'REFERENCES' },
  CONDITIONING_QA: { percent: 42, step: 2, title: 'Перевіряємо підготовлені references', label: 'REFERENCE QA' },
  REFERENCES_READY: { percent: 46, step: 2, title: 'References затверджено', label: 'REFERENCE QA' },
  GENERATING_AVATAR: { percent: 55, step: 3, title: 'Генеруємо base avatar', label: 'AVATAR' },
  AVATAR_RETRY: { percent: 55, step: 3, title: 'Повторно генеруємо avatar', label: 'AVATAR' },
  AVATAR_QA: { percent: 68, step: 4, title: 'Перевіряємо identity та якість', label: 'AVATAR QA' },
  AVATAR_READY: { percent: 72, step: 4, title: 'Base avatar затверджено', label: 'AVATAR QA' },
  GENERATING_OUTFIT: { percent: 82, step: 5, title: 'Генеруємо повний образ', label: 'OUTFIT' },
  OUTFIT_RETRY: { percent: 82, step: 5, title: 'Повторно генеруємо outfit', label: 'OUTFIT' },
  OUTFIT_QA: { percent: 91, step: 5, title: 'Перевіряємо outfit та identity', label: 'OUTFIT QA' },
  OUTFIT_READY: { percent: 94, step: 5, title: 'Outfit затверджено', label: 'OUTFIT QA' },
  OPTIONAL_SCENE: { percent: 96, step: 6, title: 'Готуємо опціональний editorial still', label: 'BONUS STILL' },
  EXPORTING: { percent: 98, step: 6, title: 'Експортуємо PNG і manifest', label: 'EXPORT' },
  COMPLETED: { percent: 100, step: 6, title: 'Результат готовий', label: 'READY' },
});

export function resolveProgressState(key, explicitPercent = null) {
  const base = PROGRESS_STATES[key] ?? FALLBACK;
  const percent = explicitPercent == null
    ? base.percent
    : Math.max(0, Math.min(100, Math.round(explicitPercent)));
  return { ...base, percent };
}

export function nodeState(nodeIndex, activeStep) {
  if (nodeIndex < activeStep) return 'done';
  if (nodeIndex === activeStep) return 'active';
  return 'pending';
}
