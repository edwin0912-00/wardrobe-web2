const PRESENTATIONS = new Set([
  'SOURCE_SCAN',
  'CANDIDATE_REVEAL',
  'MASK_REVEAL',
  'BEFORE_AFTER',
  'QA_SCAN',
  'OUTPUT',
]);

const TRUTH_STATES = new Set([
  'IMMUTABLE_INPUT',
  'GENERATED_CANDIDATE',
  'DETERMINISTIC_DERIVATIVE',
  'UNVERIFIED_CANDIDATE',
  'QA_IN_PROGRESS',
  'APPROVED_OUTPUT',
]);

const SUBJECT_KINDS = new Set(['PERSON', 'ITEM', 'LOOK']);
const LAYER_ROLES = new Set(['BASE', 'SOURCE', 'CANDIDATE', 'CUTOUT', 'BEFORE', 'AFTER']);
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PROVIDER_WAIT_STAGES = new Set([
  'GARMENT_GENERATING',
  'GENERATING_AVATAR',
  'AVATAR_RETRY',
  'GENERATING_OUTFIT',
  'OUTFIT_RETRY',
  'OPTIONAL_SCENE',
]);
const PRIVATE_TEXT = /(?:file:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\|\.zeely-run|runtime\/runs|artifacts\/sha256|compiled[_ -]?prompt|exact[_ -]?prompt)/i;
const OWNED_ASSET_URL = /^\/api\/runs\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/visual-assets\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const FRAME_INTERVAL = 1000 / 24;
const MASK_ALPHA_THRESHOLD = 12;
const MASK_CELL_COUNT = 24;
const MASK_MAX_EDGE = 512;
const MASK_MAX_PIXELS = 512 * 512;

const PRESENTATION_RULES = Object.freeze({
  SOURCE_SCAN: {
    truthStates: ['IMMUTABLE_INPUT'],
    requiredRoles: [['SOURCE', 'BASE']],
    allowedRoles: ['SOURCE', 'BASE'],
    maxLayers: 1,
  },
  CANDIDATE_REVEAL: {
    truthStates: ['GENERATED_CANDIDATE', 'UNVERIFIED_CANDIDATE', 'DETERMINISTIC_DERIVATIVE'],
    requiredRoles: [['CANDIDATE', 'AFTER', 'BASE']],
    allowedRoles: ['CANDIDATE', 'AFTER', 'BASE'],
    maxLayers: 1,
  },
  MASK_REVEAL: {
    truthStates: ['DETERMINISTIC_DERIVATIVE'],
    requiredRoles: [['BASE'], ['CUTOUT']],
    allowedRoles: ['BASE', 'CUTOUT'],
    maxLayers: 2,
  },
  BEFORE_AFTER: {
    truthStates: ['DETERMINISTIC_DERIVATIVE'],
    requiredRoles: [['BEFORE'], ['AFTER']],
    allowedRoles: ['BEFORE', 'AFTER'],
    maxLayers: 2,
  },
  QA_SCAN: {
    truthStates: ['QA_IN_PROGRESS'],
    requiredRoles: [['CANDIDATE', 'BASE']],
    allowedRoles: ['CANDIDATE', 'BASE'],
    maxLayers: 1,
  },
  OUTPUT: {
    truthStates: ['APPROVED_OUTPUT'],
    requiredRoles: [['AFTER', 'CANDIDATE', 'BASE', 'CUTOUT']],
    allowedRoles: ['AFTER', 'CANDIDATE', 'BASE', 'CUTOUT'],
    maxLayers: 1,
  },
});

export function safeCheckpointText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/\s+/g, ' ').trim().slice(0, 180);
  return text && !PRIVATE_TEXT.test(text) ? text : fallback;
}

export function isOwnedVisualAssetUrl(value) {
  return typeof value === 'string' && OWNED_ASSET_URL.test(value);
}

function ownedAssetId(value) {
  return typeof value === 'string' ? OWNED_ASSET_URL.exec(value)?.[1] ?? null : null;
}

export function isProviderWaitStage(value) {
  return PROVIDER_WAIT_STAGES.has(String(value ?? ''));
}

export function visualCheckpointKey(checkpoint) {
  if (!checkpoint) return null;
  return `${checkpoint.epoch}:${checkpoint.sequence}:${checkpoint.stage}`;
}

export function normalizeVisualCheckpoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema_version !== '1.0.0') return null;
  if (!Number.isSafeInteger(value.epoch) || value.epoch < 1) return null;
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) return null;
  if (typeof value.stage !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.stage)) return null;
  if (!value.subject || !SUBJECT_KINDS.has(value.subject.kind)) return null;
  if (!PRESENTATIONS.has(value.presentation) || !TRUTH_STATES.has(value.truth_state)) return null;
  const presentationRule = PRESENTATION_RULES[value.presentation];
  if (!presentationRule.truthStates.includes(value.truth_state)) return null;

  if (!Array.isArray(value.layers)
    || value.layers.length < 1
    || value.layers.length > presentationRule.maxLayers) return null;
  const layers = [];
  const assetIds = new Set();
  const layerRoles = new Set();
  for (const layer of value.layers) {
    if (!layer || typeof layer !== 'object') return null;
    if (!LAYER_ROLES.has(layer.role)
      || !presentationRule.allowedRoles.includes(layer.role)
      || layerRoles.has(layer.role)
      || !MEDIA_TYPES.has(layer.media_type)) return null;
    if (typeof layer.asset_id !== 'string'
      || !layer.asset_id
      || ownedAssetId(layer.url) !== layer.asset_id
      || assetIds.has(layer.asset_id)) {
      return null;
    }
    assetIds.add(layer.asset_id);
    layerRoles.add(layer.role);
    layers.push({
      role: layer.role,
      assetId: layer.asset_id,
      url: layer.url,
      mediaType: layer.media_type,
    });
  }

  const subjectIndex = Number.isSafeInteger(value.subject.index) && value.subject.index >= 1
    ? value.subject.index
    : null;
  const subjectTotal = Number.isSafeInteger(value.subject.total) && value.subject.total >= 1
    ? value.subject.total
    : null;
  if ((value.subject.index !== null && subjectIndex === null)
    || (value.subject.total !== null && subjectTotal === null)
    || (subjectIndex !== null && subjectTotal !== null && subjectIndex > subjectTotal)) {
    return null;
  }
  if (presentationRule.requiredRoles.some((alternatives) => !alternatives.some(
    (role) => layers.some((layer) => layer.role === role),
  ))) return null;

  const selectedPixels = Number.isSafeInteger(value.metrics?.selected_pixels) && value.metrics.selected_pixels >= 0
    ? value.metrics.selected_pixels
    : null;
  const totalPixels = Number.isSafeInteger(value.metrics?.total_pixels) && value.metrics.total_pixels >= 0
    ? value.metrics.total_pixels
    : null;
  if (selectedPixels !== null && totalPixels !== null && selectedPixels > totalPixels) return null;

  return Object.freeze({
    epoch: value.epoch,
    sequence: value.sequence,
    stage: value.stage.trim().slice(0, 80),
    subject: Object.freeze({ kind: value.subject.kind, index: subjectIndex, total: subjectTotal }),
    presentation: value.presentation,
    truthState: value.truth_state,
    title: safeCheckpointText(value.title, 'Контрольний кадр збережено'),
    status: safeCheckpointText(value.status, 'Показуємо останній підтверджений сервером кадр.'),
    layers: Object.freeze(layers),
    metrics: Object.freeze({ selectedPixels, totalPixels }),
  });
}

export function layerForRole(checkpoint, ...roles) {
  if (!checkpoint) return null;
  for (const role of roles) {
    const match = checkpoint.layers.find((layer) => layer.role === role);
    if (match) return match;
  }
  return null;
}

export function visualizerCopy(checkpoint, { providerWaiting = false } = {}) {
  if (!checkpoint) {
    return {
      title: 'Очікуємо збережений кадр',
      status: providerWaiting
        ? 'Модель ще працює · покажемо результат одразу після збереження.'
        : 'Показуємо тільки зображення, які вже збережені сервером.',
    };
  }
  if (providerWaiting) {
    return {
      title: checkpoint.title,
      status: 'Останній збережений кадр · модель не передає незавершені пікселі.',
    };
  }
  if (checkpoint.presentation === 'QA_SCAN') {
    return {
      title: checkpoint.title,
      status: 'Пікселі не змінюються · виконується перевірка.',
    };
  }
  if (checkpoint.presentation === 'CANDIDATE_REVEAL') {
    return {
      title: checkpoint.title,
      status: `${checkpoint.status} · відтворення вже збереженого результату.`,
    };
  }
  if (checkpoint.presentation === 'MASK_REVEAL') {
    return {
      title: checkpoint.title,
      status: `${checkpoint.status} · зелена зона обчислена з прозорості вирізаного об’єкта.`,
    };
  }
  return { title: checkpoint.title, status: checkpoint.status };
}

export function formatPixelMetric(checkpoint) {
  const selected = checkpoint?.metrics?.selectedPixels;
  const total = checkpoint?.metrics?.totalPixels;
  if (!Number.isSafeInteger(selected) || !Number.isSafeInteger(total) || total <= 0 || selected > total) return '';
  return `${Math.round((selected / total) * 100)}% ФОНУ`;
}

export function formatMaskRevealMetric(selectedPixels, totalPixels, visualizedPercent) {
  if (!Number.isSafeInteger(selectedPixels)
    || !Number.isSafeInteger(totalPixels)
    || totalPixels <= 0
    || selectedPixels < 0
    || selectedPixels > totalPixels
    || !Number.isFinite(visualizedPercent)) return '';
  const visualized = Math.max(0, Math.min(100, Math.round(visualizedPercent)));
  return `${Math.round((selectedPixels / totalPixels) * 100)}% ФОНУ · ${visualized}% ВІЗУАЛІЗОВАНО`;
}

export function classifyBackgroundAlpha(data, {
  threshold = MASK_ALPHA_THRESHOLD,
  inPlace = false,
} = {}) {
  if (!(data instanceof Uint8ClampedArray) || data.length % 4 !== 0) {
    throw new TypeError('RGBA pixels must be a Uint8ClampedArray');
  }
  const mask = inPlace ? data : new Uint8ClampedArray(data.length);
  let selectedPixels = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const background = data[offset + 3] <= threshold;
    mask[offset] = 184;
    mask[offset + 1] = 255;
    mask[offset + 2] = 61;
    mask[offset + 3] = background ? 178 : 0;
    if (background) selectedPixels += 1;
  }
  return Object.freeze({
    pixels: mask,
    selectedPixels,
    totalPixels: data.length / 4,
  });
}

export function boundedMaskDimensions(width, height, {
  maxEdge = MASK_MAX_EDGE,
  maxPixels = MASK_MAX_PIXELS,
} = {}) {
  if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1) {
    return { width: 1, height: 1, scale: 0 };
  }
  const edgeScale = maxEdge / Math.max(width, height);
  const pixelScale = Math.sqrt(maxPixels / (width * height));
  const scale = Math.min(1, edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export function maskRevealCells(width, height, cellCount = MASK_CELL_COUNT) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) return [];
  const columns = Math.max(1, Math.min(cellCount, width));
  const rows = Math.max(1, Math.ceil(columns * (height / width)));
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = Math.floor(column * cellWidth);
    const y = Math.floor(row * cellHeight);
    const right = column === columns - 1 ? width : Math.floor((column + 1) * cellWidth);
    const bottom = row === rows - 1 ? height : Math.floor((row + 1) * cellHeight);
    return {
      x,
      y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y),
      rank: ((column * 37) + (row * 61) + ((column * row) * 17)) % (columns * rows),
    };
  }).sort((left, right) => left.rank - right.rank || left.y - right.y || left.x - right.x);
}

function easeOut(value) {
  return 1 - ((1 - Math.max(0, Math.min(1, value))) ** 3);
}

function mediaRect(image, width, height, fit = 'cover') {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const frameRatio = width / height;
  const contain = fit === 'contain';
  const useWidth = contain ? imageRatio > frameRatio : imageRatio < frameRatio;
  const drawWidth = useWidth ? width : height * imageRatio;
  const drawHeight = useWidth ? width / imageRatio : height;
  return {
    x: (width - drawWidth) / 2,
    y: (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function drawImage(ctx, image, width, height, fit = 'cover', alpha = 1) {
  const rect = mediaRect(image, width, height, fit);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
  return rect;
}

function drawBackdrop(ctx, image, width, height) {
  drawImage(ctx, image, width, height, 'cover', 0.3);
  ctx.save();
  ctx.fillStyle = 'rgba(8, 13, 11, .48)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function makeAlphaMask(image) {
  const dimensions = boundedMaskDimensions(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let pixels;
  try {
    pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  const classified = classifyBackgroundAlpha(pixels.data, { inPlace: true });
  context.putImageData(pixels, 0, 0);
  const revealCanvas = document.createElement('canvas');
  revealCanvas.width = canvas.width;
  revealCanvas.height = canvas.height;
  const revealContext = revealCanvas.getContext('2d');
  if (!revealContext) return null;
  return {
    canvas,
    revealCanvas,
    revealContext,
    revealedCellCount: 0,
    selectedPixels: classified.selectedPixels,
    totalPixels: classified.totalPixels,
    cells: maskRevealCells(canvas.width, canvas.height),
  };
}

export function createLiveVisualizer(root, dependencies = {}) {
  if (!root) return {
    update() {},
    setActive() {},
    destroy() {},
    checkpointKey: () => null,
  };

  const canvas = root.querySelector('#live-visualizer-canvas');
  const title = root.querySelector('#live-visualizer-title');
  const status = root.querySelector('#live-visualizer-status');
  const announcement = root.querySelector('#live-visualizer-announcement');
  const metric = root.querySelector('#live-visualizer-metric');
  if (!canvas || !title || !status || !announcement || !metric) throw new Error('Live visualizer DOM is incomplete');

  const context = canvas.getContext('2d');
  const requestFrame = dependencies.requestAnimationFrame ?? globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame = dependencies.cancelAnimationFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis);
  const now = dependencies.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const media = dependencies.matchMedia ?? globalThis.matchMedia?.bind(globalThis);
  const reducedMotion = Boolean(media?.('(prefers-reduced-motion: reduce)').matches);
  const imageCache = new Map();
  const maskCache = new Map();
  const failedLoadAttempts = new Map();
  let checkpoint = null;
  let checkpointKey = null;
  let loaded = new Map();
  let frameHandle = null;
  let lastFrameAt = 0;
  let startedAt = now();
  let active = true;
  let providerWaiting = false;
  let loadToken = 0;
  let loadInFlight = false;
  let destroyed = false;

  function loadImage(layer) {
    if (!layer) return Promise.resolve(null);
    if (!imageCache.has(layer.assetId)) {
      const record = { image: new Image(), settled: false, promise: null, cancel: null };
      record.image.decoding = 'async';
      record.promise = new Promise((resolve, reject) => {
        record.cancel = () => {
          if (record.settled) return;
          record.settled = true;
          record.image.onload = null;
          record.image.onerror = null;
          record.image.src = '';
          reject(new Error('VISUAL_ASSET_LOAD_CANCELLED'));
        };
        record.image.onload = () => {
          record.settled = true;
          record.image.onload = null;
          record.image.onerror = null;
          resolve(record.image);
        };
        record.image.onerror = () => {
          record.settled = true;
          record.image.onload = null;
          record.image.onerror = null;
          imageCache.delete(layer.assetId);
          reject(new Error('VISUAL_ASSET_LOAD_FAILED'));
        };
      });
      record.image.src = layer.url;
      imageCache.set(layer.assetId, record);
    }
    return imageCache.get(layer.assetId).promise;
  }

  function cancelStaleImageLoads(keepAssetIds = new Set()) {
    for (const [assetId, record] of imageCache) {
      if (keepAssetIds.has(assetId)) continue;
      if (!record.settled) record.cancel?.();
      else record.image.src = '';
      imageCache.delete(assetId);
    }
    for (const assetId of maskCache.keys()) {
      if (!keepAssetIds.has(assetId)) maskCache.delete(assetId);
    }
    for (const assetId of failedLoadAttempts.keys()) {
      if (!keepAssetIds.has(assetId)) failedLoadAttempts.delete(assetId);
    }
  }

  function resizeCanvas() {
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: bounds.width, height: bounds.height };
  }

  function imageFor(...roles) {
    const layer = layerForRole(checkpoint, ...roles);
    return layer ? loaded.get(layer.assetId) ?? null : null;
  }

  function background(width, height) {
    if (!context) return;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#111914');
    gradient.addColorStop(0.58, '#18241d');
    gradient.addColorStop(1, '#0b100d');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(184, 255, 61, .055)';
    context.lineWidth = 1;
    for (let x = 0; x < width; x += 12) {
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 12) {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(width, y + 0.5);
      context.stroke();
    }
  }

  function scanLine(width, height, progress) {
    if (!context) return;
    const y = Math.round(progress * height);
    const gradient = context.createLinearGradient(0, y - 12, 0, y + 4);
    gradient.addColorStop(0, 'rgba(184,255,61,0)');
    gradient.addColorStop(1, 'rgba(184,255,61,.22)');
    context.fillStyle = gradient;
    context.fillRect(0, Math.max(0, y - 12), width, 16);
    context.fillStyle = 'rgba(207,255,128,.82)';
    context.fillRect(0, Math.min(height - 1, y), width, 1);
  }

  function drawFrame(timestamp = now()) {
    if (!context || destroyed) return false;
    const { width, height } = resizeCanvas();
    context.clearRect(0, 0, width, height);
    background(width, height);
    if (!checkpoint) return false;

    const elapsed = Math.max(0, timestamp - startedAt);
    const staticFrame = reducedMotion || providerWaiting;
    const rawProgress = staticFrame ? 1 : Math.min(1, elapsed / 2200);
    const progress = easeOut(rawProgress);
    const fit = checkpoint.subject.kind === 'ITEM' ? 'contain' : 'cover';

    if (checkpoint.presentation === 'SOURCE_SCAN') {
      const source = imageFor('SOURCE', 'BASE');
      if (source) {
        drawBackdrop(context, source, width, height);
        drawImage(context, source, width, height, fit);
        if (!staticFrame) scanLine(width, height, (elapsed % 2800) / 2800);
      }
      return Boolean(source) && !staticFrame;
    }

    if (checkpoint.presentation === 'CANDIDATE_REVEAL') {
      const candidate = imageFor('CANDIDATE', 'AFTER', 'BASE');
      if (candidate) {
        const rect = mediaRect(candidate, width, height, fit);
        context.save();
        context.beginPath();
        context.rect(rect.x, rect.y, rect.width, rect.height * progress);
        context.clip();
        drawImage(context, candidate, width, height, fit);
        context.restore();
        scanLine(width, height, Math.min(0.995, progress));
      }
      return Boolean(candidate) && !staticFrame && rawProgress < 1;
    }

    if (checkpoint.presentation === 'MASK_REVEAL') {
      const base = imageFor('BASE');
      const cutoutLayer = layerForRole(checkpoint, 'CUTOUT');
      const cutout = cutoutLayer ? loaded.get(cutoutLayer.assetId) : null;
      if (base) {
        drawBackdrop(context, base, width, height);
        drawImage(context, base, width, height, fit);
      }
      if (cutout) {
        if (!maskCache.has(cutoutLayer.assetId)) maskCache.set(cutoutLayer.assetId, makeAlphaMask(cutout));
        const mask = maskCache.get(cutoutLayer.assetId);
        if (mask) {
          const rect = mediaRect(cutout, width, height, 'contain');
          const visibleCellCount = Math.max(1, Math.ceil(mask.cells.length * progress));
          if (visibleCellCount < mask.revealedCellCount) {
            mask.revealContext.clearRect(0, 0, mask.revealCanvas.width, mask.revealCanvas.height);
            mask.revealedCellCount = 0;
          }
          for (let index = mask.revealedCellCount; index < visibleCellCount; index += 1) {
            const cell = mask.cells[index];
            mask.revealContext.drawImage(
              mask.canvas,
              cell.x,
              cell.y,
              cell.width,
              cell.height,
              cell.x,
              cell.y,
              cell.width,
              cell.height,
            );
          }
          mask.revealedCellCount = visibleCellCount;
          context.save();
          context.imageSmoothingEnabled = false;
          context.drawImage(mask.revealCanvas, rect.x, rect.y, rect.width, rect.height);
          context.restore();
          const selectedPixels = checkpoint.metrics.selectedPixels ?? mask.selectedPixels;
          const totalPixels = checkpoint.metrics.totalPixels ?? mask.totalPixels;
          if (Number.isSafeInteger(selectedPixels) && Number.isSafeInteger(totalPixels) && totalPixels > 0) {
            const visualized = Math.round((visibleCellCount / mask.cells.length) * 100);
            metric.textContent = formatMaskRevealMetric(selectedPixels, totalPixels, visualized);
            metric.hidden = false;
          }
        }
      }
      return Boolean(cutout) && !staticFrame && rawProgress < 1;
    }

    if (checkpoint.presentation === 'BEFORE_AFTER') {
      const before = imageFor('BEFORE', 'BASE');
      const after = imageFor('AFTER', 'CANDIDATE');
      if (before && after) {
        drawBackdrop(context, before, width, height);
        drawImage(context, before, width, height, fit);
        const split = staticFrame ? 0.5 : 0.12 + (progress * 0.43);
        context.save();
        context.beginPath();
        context.rect(0, 0, width * split, height);
        context.clip();
        drawImage(context, after, width, height, fit);
        context.restore();
        context.fillStyle = '#d7ff91';
        context.fillRect(Math.round(width * split), 0, 1, height);
        context.font = '700 8px ui-monospace, monospace';
        context.fillStyle = 'rgba(255,255,255,.86)';
        context.fillText('ПІСЛЯ', 10, height - 10);
        context.textAlign = 'right';
        context.fillText('ДО', width - 10, height - 10);
        context.textAlign = 'left';
      }
      return Boolean(before && after) && !staticFrame && rawProgress < 1;
    }

    if (checkpoint.presentation === 'QA_SCAN') {
      const candidate = imageFor('CANDIDATE', 'BASE');
      if (candidate) {
        drawBackdrop(context, candidate, width, height);
        drawImage(context, candidate, width, height, fit);
        if (!staticFrame) scanLine(width, height, (elapsed % 3200) / 3200);
      }
      return Boolean(candidate) && !staticFrame;
    }

    if (checkpoint.presentation === 'OUTPUT') {
      const output = imageFor('AFTER', 'CANDIDATE', 'BASE', 'CUTOUT');
      if (output) {
        drawBackdrop(context, output, width, height);
        drawImage(context, output, width, height, fit);
      }
    }
    return false;
  }

  function stopLoop() {
    if (frameHandle != null && cancelFrame) cancelFrame(frameHandle);
    frameHandle = null;
  }

  function schedule() {
    if (destroyed || !active || document.hidden || reducedMotion || providerWaiting || frameHandle != null || !requestFrame) return;
    frameHandle = requestFrame(tick);
  }

  function tick(timestamp) {
    frameHandle = null;
    if (destroyed || !active || document.hidden) return;
    if (timestamp - lastFrameAt < FRAME_INTERVAL) {
      schedule();
      return;
    }
    lastFrameAt = timestamp;
    if (drawFrame(timestamp)) schedule();
  }

  async function loadCheckpointImages(nextCheckpoint, token) {
    loadInFlight = true;
    root.dataset.assetState = 'LOADING';
    const entries = await Promise.all(nextCheckpoint.layers.map(async (layer) => {
      try {
        return [layer.assetId, await loadImage(layer), null];
      } catch {
        return [layer.assetId, null, 'LOAD_FAILED'];
      }
    }));
    if (destroyed || token !== loadToken) return;
    loadInFlight = false;
    loaded = new Map(entries.filter((entry) => entry[1]).map(([assetId, image]) => [assetId, image]));
    for (const [assetId, image] of entries) {
      if (image) failedLoadAttempts.delete(assetId);
      else failedLoadAttempts.set(assetId, (failedLoadAttempts.get(assetId) ?? 0) + 1);
    }
    applyCopy(checkpoint, { providerWaiting });
    drawFrame();
    applyAssetLoadState();
    schedule();
  }

  function missingLayers() {
    return checkpoint?.layers.filter((layer) => !loaded.has(layer.assetId)) ?? [];
  }

  function applyAssetLoadState() {
    if (loadInFlight && missingLayers().length) {
      root.dataset.assetState = 'LOADING';
      return;
    }
    const failed = missingLayers().filter((layer) => (failedLoadAttempts.get(layer.assetId) ?? 0) > 0);
    if (!failed.length) {
      root.dataset.assetState = checkpoint ? 'READY' : 'IDLE';
      return;
    }
    const canRetry = failed.some((layer) => failedLoadAttempts.get(layer.assetId) === 1);
    root.dataset.assetState = canRetry ? 'RETRY_PENDING' : 'UNAVAILABLE';
    const copy = canRetry
      ? 'Кадр тимчасово недоступний · повторимо завантаження під час наступної синхронізації.'
      : 'Кадр не завантажився після повторної спроби · основний процес продовжується.';
    status.textContent = copy;
    announcement.textContent = copy;
  }

  function applyCopy(nextCheckpoint, options) {
    const copy = visualizerCopy(nextCheckpoint, options);
    title.textContent = copy.title;
    status.textContent = copy.status;
    const pixelMetric = formatPixelMetric(nextCheckpoint);
    metric.textContent = pixelMetric;
    metric.hidden = !pixelMetric;
  }

  function update(value, options = {}) {
    const nextCheckpoint = normalizeVisualCheckpoint(value);
    const nextKey = visualCheckpointKey(nextCheckpoint);
    const nextProviderWaiting = Boolean(options.providerWaiting);
    const stageChanged = nextKey !== checkpointKey;
    providerWaiting = nextProviderWaiting;
    root.dataset.presentation = nextCheckpoint?.presentation ?? 'IDLE';
    root.dataset.truthState = nextCheckpoint?.truthState ?? 'UNKNOWN';
    root.dataset.providerWaiting = String(providerWaiting);

    if (stageChanged) {
      checkpoint = nextCheckpoint;
      checkpointKey = nextKey;
      root.dataset.assetState = nextCheckpoint ? 'LOADING' : 'IDLE';
      startedAt = now();
      loaded = new Map();
      loadToken += 1;
      loadInFlight = false;
      cancelStaleImageLoads(new Set(nextCheckpoint?.layers.map((layer) => layer.assetId) ?? []));
      announcement.textContent = visualizerCopy(nextCheckpoint, { providerWaiting }).title;
      applyCopy(nextCheckpoint, { providerWaiting });
      stopLoop();
      drawFrame();
      if (nextCheckpoint) loadCheckpointImages(nextCheckpoint, loadToken);
      return;
    }

    applyCopy(checkpoint, { providerWaiting });
    applyAssetLoadState();
    stopLoop();
    drawFrame();
    schedule();
    const canRetry = missingLayers().some(
      (layer) => failedLoadAttempts.get(layer.assetId) === 1,
    );
    if (checkpoint && !loadInFlight && canRetry) {
      loadCheckpointImages(checkpoint, loadToken);
    }
  }

  function setActive(value) {
    active = Boolean(value);
    if (!active) stopLoop();
    else {
      drawFrame();
      schedule();
    }
  }

  function onVisibilityChange() {
    if (document.hidden) stopLoop();
    else if (active) {
      startedAt = now();
      drawFrame();
      schedule();
    }
  }

  const Resize = dependencies.ResizeObserver ?? globalThis.ResizeObserver;
  const resizeObserver = Resize ? new Resize(() => drawFrame()) : null;
  resizeObserver?.observe(canvas);
  document.addEventListener('visibilitychange', onVisibilityChange);
  drawFrame();

  return {
    update,
    setActive,
    checkpointKey: () => checkpointKey,
    destroy() {
      destroyed = true;
      stopLoop();
      resizeObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelStaleImageLoads();
      imageCache.clear();
      maskCache.clear();
    },
  };
}
