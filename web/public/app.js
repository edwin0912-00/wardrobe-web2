import { createThinkingOrb } from './thinking-orb.js?v=20260722-10';
import { presentationImageUrl } from './presentation-media.js?v=20260731-1';
import { UploadSelectionStore } from './upload-state.js?v=20260722-8';
import { clearDraft, loadDraft, requestPersistentStorage, saveDraft } from './draft-store.js?v=20260722-10';
import { fileSummary, telemetry } from './telemetry.js?v=20260722-8';
import { createImagePreviewBlob, prepareImageFile } from './image-upload.js?v=20260731-1';
import { bindImageDropZone } from './drop-upload.js?v=20260729-1';
import { clearDefinitivelyRejectedRunState, clearServerDraft, createRunFromServerDraft, loadServerDraft, removeServerDraftFile, updateServerDraftMetadata, uploadDraftFile } from './server-draft.js?v=20260723-13';
import {
  draftBindingsFromManifest,
  draftRefsFromBindings,
  finalizationFileManifest,
  reconcileDraftFileBindings,
  sha256Blob,
} from './draft-file-contract.js?v=20260723-1';
import { PIPELINE_NODE_COUNT, PIPELINE_NODES, checkpointDisplayCode, nodeState, resolveProgressState } from './progress-model.js?v=20260722-7';
import { createLiveVisualizer, isProviderWaitStage } from './live-visualizer.js?v=20260724-1';
import { fetchRunWithRetry, RunNotFoundError } from './run-resume.js?v=20260722-3';
import { claimProfileRun, deleteAnonymousProfile, deleteProfileLook, listProfileLookEditorialShoots, loadProfile, saveProfileRun } from './profile-client.js?v=20260724-5';
import { needsInputPresentation, neutralizeItemTerms } from './visible-copy.js?v=20260731-2';
import { createSceneUi } from './scene-ui.js?v=20260731-3';
import {
  addItemsScreenState,
  clearAddItemsSelection,
  continueAddItemsFromSelection,
  createSceneActionLabel,
  executeSavedAvatarTransition,
  finalizeConsumedRunState,
  formatLookCount,
  idOfAvatar,
  idOfLook,
  lineageFromStorage,
  latestLookForAvatar,
  looksForAvatar,
  looksForProfile,
  resolveAddItemsSelection,
  resolveProfileLookSelection,
  resolveResultAddItemsSelection,
  resolveSavedAvatarTransition,
  resolveStoredAddItemsLineage,
  restoreProfileReturnState,
  restoreAddItemsSelection,
  saveCompletedProfileRun,
  scenesForLook,
  scenePresetLabel,
  sceneStatusLabel,
  storeAddItemsLineage,
  storeAddItemsSelection,
} from './add-items-flow.js?v=20260727-2';

const form = document.querySelector('#run-form');
const submit = document.querySelector('#submit-button');
const formError = document.querySelector('#form-error');
const draftStatus = document.querySelector('#draft-status');
const statusChip = document.querySelector('#status-chip');
const empty = document.querySelector('#empty-state');
const progress = document.querySelector('#progress-view');
const resultView = document.querySelector('#result-view');
const profileView = document.querySelector('#profile-view');
const sceneView = document.querySelector('#scene-view');
const failure = document.querySelector('#failure-view');
const studioShell = document.querySelector('#studio-shell');
const resultPanelTitle = document.querySelector('#result-panel-title');
const thinkingOrb = createThinkingOrb(document.querySelector('#progress-orb-canvas'));
const fashionVideoCapabilityOrb = createThinkingOrb(document.querySelector('#profile-video-orb'), 'searching');
const realtimeLookCapabilityOrb = createThinkingOrb(document.querySelector('#profile-live-orb'), 'searching');
const videoThinkingOrb = createThinkingOrb(document.querySelector('#video-thinking-orb'), 'searching');
const liveVisualizer = createLiveVisualizer(document.querySelector('#pipeline-live-visualizer'));
// This screen must not live below a transformed workflow panel: `position:
// fixed` would then be clipped as a window inside a window. Keep the Fashion
// Video task as a single direct-body, full-viewport screen.
const fashionVideoOverlay = document.querySelector('#video-overlay');
document.body.append(fashionVideoOverlay);
const uploads = new UploadSelectionStore({ maxGarments: 5 });
let previewUrls = [];
let previewRenderEpoch = 0;
let activeRun = null;
let eventSource = null;
let saveTimer = null;
let transitionTimer = null;
let serverDraftRefs = { person: null, identity: null, garments: [] };
let serverDraftBindings = { person: null, identity: null, garments: [] };
let serverDraftLineage = { source_avatar_id: null, source_look_id: null };
let serverDraftLoaded = false;
let serverDraftResetRequired = false;
let serverSyncQueue = Promise.resolve();
let draftMutationQueue = Promise.resolve();
let submitting = false;
let resumeTimer = null;
let sseRecovering = false;
let renderedProgressFloor = 0;
let currentProfile = null;
let currentResultAvatarId = null;
let currentResultLookId = null;
let currentResultRunId = null;
let profileLoadPromise = null;
let sceneUi = null;
const profileSavePromises = new Map();
const preparedDraftFiles = new WeakMap();
let profileAvatarPage = 0;
let profileLookPage = 0;
let currentViewName = 'empty';
let profileReturnState = { view: 'empty', workflowActive: false };
let profileReturnFocus = null;
let selectedProfileAvatarId = null;
let selectedProfileLookId = null;
let selectedProfileLookSelection = null;
let selectedProfileLook = null;
let profileEditorialRequestVersion = 0;
let fashionVideoCapabilityRequestVersion = 0;
let fashionVideoCapability = null;
let realtimeLookCapabilityRequestVersion = 0;
let realtimeLookCapability = null;
let videoGenerationBusy = false;
let failedFashionVideoClipId = null;
let failedFashionVideoRetryKey = null;

const ACTIVE_RUN_KEY = 'zeely_active_run_id';
const PENDING_FINALIZATION_KEY = 'zeely_pending_finalization_id';
const DRAFT_RESET_PENDING_KEY = 'zeely_draft_reset_pending';
const LIVE_RETURN_FOCUS_KEY = 'zeely_live_return_focus';
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'NEEDS_INPUT']);
const PIPELINE_STATUS_LABELS = Object.freeze({
  done: 'SAVED', active: 'ACTIVE', pending: 'WAIT', skipped: 'SKIP', reused: 'REUSE', stopped: 'STOP',
});

function humanizeVisibleText(value) {
  return neutralizeItemTerms(String(value ?? '')
    .replace(/visible garment mismatch/gi, 'невідповідність видимих характеристик речі')
    .replace(/garment mismatch/gi, 'невідповідність речі'));
}

function initializePipelineGraph() {
  const graph = document.querySelector('#pipeline-nodes');
  const fragment = document.createDocumentFragment();
  for (const [index, node] of PIPELINE_NODES.entries()) {
    const item = document.createElement('li');
    item.className = 'pipeline-node pending';
    item.dataset.step = String(index);
    item.dataset.nodeId = node.id;

    if (index % 5 === 0) {
      const phase = document.createElement('span');
      phase.className = `phase-label${node.rowDirection === 'reverse' ? ' reverse' : ''}`;
      phase.textContent = node.rowDirection === 'reverse' ? `← ${node.rowLabel}` : `${node.rowLabel} →`;
      item.append(phase);
    }

    const card = document.createElement('div');
    card.className = 'node-card';
    const head = document.createElement('div');
    head.className = 'node-head';
    const mark = document.createElement('span');
    mark.className = 'node-mark';
    mark.setAttribute('aria-hidden', 'true');
    const number = document.createElement('b');
    number.textContent = String(index + 1).padStart(2, '0');
    const check = document.createElement('i');
    check.textContent = '✓';
    const skipped = document.createElement('em');
    skipped.textContent = '—';
    const reused = document.createElement('u');
    reused.textContent = '↺';
    mark.append(number, check, skipped, reused);
    const stateLabel = document.createElement('span');
    stateLabel.className = 'node-status-label';
    stateLabel.textContent = PIPELINE_STATUS_LABELS.pending;
    head.append(mark, stateLabel);

    const title = document.createElement('strong');
    title.textContent = node.title;
    const code = document.createElement('code');
    code.textContent = node.code;
    const detail = document.createElement('small');
    detail.textContent = node.detail;
    const accessibleState = document.createElement('span');
    accessibleState.className = 'sr-only node-state-sr';
    accessibleState.textContent = 'Pending';
    card.append(head, title, code, detail, accessibleState);
    item.append(card);
    fragment.append(item);
  }
  graph.replaceChildren(fragment);
}

initializePipelineGraph();

function movePipelineBoard(destination = 'progress') {
  const board = document.querySelector('.pipeline-board');
  const hosts = {
    progress: document.querySelector('#pipeline-board-slot'),
    completed: document.querySelector('#completed-pipeline-host'),
    failure: document.querySelector('#failure-pipeline-host'),
  };
  const host = hosts[destination];
  if (host && board.parentElement !== host) host.append(board);
  liveVisualizer.setActive(destination === 'progress');
}

function isTerminal(run) {
  return TERMINAL_STATUSES.has(run?.status);
}

function createFinalizationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function queueServerSync(task, { propagate = false } = {}) {
  const operation = serverSyncQueue.then(task);
  serverSyncQueue = operation.catch((error) => {
    draftStatus.textContent = 'Чернетку збережено лише на цьому пристрої';
    draftStatus.className = 'draft-status failed';
    telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'server_sync' });
    return null;
  });
  return propagate ? operation : serverSyncQueue;
}

function queueDraftMutation(task, stage) {
  const operation = draftMutationQueue.then(task);
  draftMutationQueue = operation.catch((error) => {
    formError.textContent = humanizeVisibleText(error.message);
    telemetry('client.error', { message: error.message.slice(0, 500), stage });
    return null;
  });
  return draftMutationQueue;
}

function setServerDraftBindings(bindings) {
  serverDraftBindings = bindings;
  serverDraftRefs = draftRefsFromBindings(bindings);
}

async function resetServerDraftIfNeeded() {
  if (!serverDraftResetRequired && localStorage.getItem(DRAFT_RESET_PENDING_KEY) === null) return;
  await clearServerDraft();
  setServerDraftBindings({ person: null, identity: null, garments: [] });
  serverDraftLineage = { source_avatar_id: null, source_look_id: null };
  serverDraftLoaded = false;
  serverDraftResetRequired = false;
  localStorage.removeItem(DRAFT_RESET_PENDING_KEY);
}

async function preparedDraftFile(file) {
  if (!preparedDraftFiles.has(file)) {
    preparedDraftFiles.set(file, (async () => {
      const prepared = await prepareImageFile(file);
      if (prepared.changed) telemetry('client.file_prepared', {
        original_bytes: prepared.originalBytes,
        prepared_bytes: prepared.preparedBytes,
        stage: 'draft_backup',
      });
      return {
        file: prepared.file,
        sourceName: file.name,
        sha256: await sha256Blob(prepared.file),
        size: prepared.file.size,
        mimetype: prepared.file.type,
      };
    })());
  }
  return preparedDraftFiles.get(file);
}

async function selectedDraftFiles(sourceAvatarId) {
  const selection = {
    person: uploads.person,
    identity: uploads.identityDetail,
    garments: [...uploads.garments],
  };
  const [person, identity, garments] = await Promise.all([
    sourceAvatarId || !selection.person ? null : preparedDraftFile(selection.person),
    sourceAvatarId || !selection.identity ? null : preparedDraftFile(selection.identity),
    Promise.all(selection.garments.map(preparedDraftFile)),
  ]);
  return { person, identity, garments };
}

async function uploadPreparedDraftFile(slot, desired) {
  draftStatus.textContent = 'Зберігаємо чернетку на 15 хвилин…';
  const descriptor = await uploadDraftFile(slot, desired.file, { onProgress: (loaded, total) => {
    if (!submitting || total <= 0) return;
    const uploadPercentage = Math.min(100, Math.round((loaded / total) * 100));
    const pipelinePercentage = 4 + Math.round(uploadPercentage * 0.06);
    renderProgress(
      { ...resolveProgressState('UPLOADING', pipelinePercentage), countLabel: `Файл ${uploadPercentage}%` },
      `${desired.sourceName} · завантажено ${uploadPercentage}% · ${Math.ceil(loaded / 1024 / 1024)} з ${Math.ceil(total / 1024 / 1024)} MB`,
    );
  } });
  draftStatus.textContent = 'Чернетку збережено на 15 хвилин';
  draftStatus.className = 'draft-status saved';
  return descriptor;
}

async function reconcileServerDraftFiles({ sourceAvatarId }) {
  await resetServerDraftIfNeeded();
  const current = await loadServerDraft({ includeFiles: false });
  setServerDraftBindings(current.bindings);
  serverDraftLineage = {
    source_avatar_id: current.manifest.source_avatar_id ?? null,
    source_look_id: current.manifest.source_look_id ?? null,
  };
  serverDraftLoaded = true;
  const desired = await selectedDraftFiles(sourceAvatarId);
  const reconciled = await reconcileDraftFileBindings({
    desired,
    current: current.bindings,
    upload: uploadPreparedDraftFile,
    remove: removeServerDraftFile,
  });
  setServerDraftBindings(reconciled);
  return reconciled;
}

async function ensureServerDraftComplete() {
  const { sourceAvatarId, sourceLookId } = lineageFromStorage(localStorage);
  const reconciled = await queueServerSync(
    () => reconcileServerDraftFiles({ sourceAvatarId }),
    { propagate: true },
  );
  const confirmedManifest = await updateServerDraftMetadata({
    outfitText: form.elements.outfit_text.value,
    generateScene: false,
    sourceAvatarId,
    sourceLookId,
  });
  serverDraftLineage = {
    source_avatar_id: sourceAvatarId,
    source_look_id: sourceLookId,
  };
  const confirmed = draftBindingsFromManifest(confirmedManifest);
  if (JSON.stringify(finalizationFileManifest(confirmed))
    !== JSON.stringify(finalizationFileManifest(reconciled))) {
    throw new Error('Файли чернетки змінилися під час перевірки');
  }
  setServerDraftBindings(confirmed);

  if (!sourceAvatarId && !serverDraftRefs.person) throw new Error('Фото людини не збережено на сервері');
  if (!sourceAvatarId && uploads.identityDetail && !serverDraftRefs.identity) throw new Error('Додаткове фото людини не збережено на сервері');
  if (serverDraftRefs.garments.length !== uploads.garments.length) throw new Error('Не всі фото речей збережено на сервері');
  return confirmed;
}

function fileLabel(input, count, filename = '') {
  const label = document.querySelector(`[data-for="${input.id}"]`);
  if (!label) return;
  if (input.id === 'garment-images') label.textContent = count ? `${count} з 5 файлів` : 'Додати гардероб';
  else label.textContent = filename || 'Обрати файл';
}

function previewItem(file, onRemove, renderEpoch) {
  const item = document.createElement('article');
  item.className = 'selected-file';
  const image = document.createElement('img');
  image.alt = file.name;
  image.setAttribute('aria-busy', 'true');
  // A preview is an asynchronous, local WebP derivative. The selected File
  // remains the source that is uploaded and hashed; the UI never swaps it.
  void createImagePreviewBlob(file).then((preview) => {
    const url = URL.createObjectURL(preview);
    if (renderEpoch !== previewRenderEpoch || !item.isConnected) {
      URL.revokeObjectURL(url);
      return;
    }
    previewUrls.push(url);
    image.src = url;
    image.removeAttribute('aria-busy');
  }).catch(() => {
    // Fallback only for a browser without an image bitmap/canvas decoder.
    // It preserves usability; normal browsers always receive the light copy.
    const url = URL.createObjectURL(file);
    if (renderEpoch !== previewRenderEpoch || !item.isConnected) {
      URL.revokeObjectURL(url);
      return;
    }
    previewUrls.push(url);
    image.src = url;
    image.removeAttribute('aria-busy');
  });
  const name = document.createElement('span');
  name.textContent = file.name;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-file';
  remove.setAttribute('aria-label', `Видалити ${file.name}`);
  remove.textContent = '×';
  remove.addEventListener('click', onRemove);
  item.append(image, name, remove);
  return item;
}

function renderUploads() {
  const renderEpoch = ++previewRenderEpoch;
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  const personPreview = document.querySelector('#person-preview');
  const identityPreview = document.querySelector('#identity-preview');
  const garmentPreview = document.querySelector('#garment-preview');
  personPreview.replaceChildren();
  identityPreview.replaceChildren();
  garmentPreview.replaceChildren();

  if (uploads.person) personPreview.append(previewItem(uploads.person, () => {
    queueDraftMutation(() => removeFile('person'), 'remove_person');
  }, renderEpoch));
  if (uploads.identityDetail) identityPreview.append(previewItem(uploads.identityDetail, () => {
    queueDraftMutation(() => removeFile('identity'), 'remove_identity');
  }, renderEpoch));
  uploads.garments.forEach((file, index) => garmentPreview.append(previewItem(file, () => {
    queueDraftMutation(() => removeFile('garment', index), 'remove_item');
  }, renderEpoch)));

  fileLabel(document.querySelector('#person-photo'), uploads.person ? 1 : 0, uploads.person?.name);
  fileLabel(document.querySelector('#identity-detail'), uploads.identityDetail ? 1 : 0, uploads.identityDetail?.name);
  fileLabel(document.querySelector('#garment-images'), uploads.garments.length);
  document.querySelectorAll('.upload-card').forEach((card) => {
    const input = card.querySelector('input[type=file]');
    const selected = input.id === 'person-photo' ? uploads.person : input.id === 'identity-detail' ? uploads.identityDetail : uploads.garments.length;
    card.classList.toggle('has-file', Boolean(selected));
  });
}

async function persistDraft(reason = 'change') {
  window.clearTimeout(saveTimer);
  draftStatus.textContent = 'Зберігаємо локальну чернетку…';
  try {
    await saveDraft({
      ...uploads,
      outfitText: form.elements.outfit_text.value,
      generateScene: false,
    });
    draftStatus.textContent = 'Чернетку збережено на цьому пристрої';
    draftStatus.className = 'draft-status saved';
    telemetry('client.draft_saved', { ...fileSummary(uploads), stage: reason });
    const { sourceAvatarId, sourceLookId } = lineageFromStorage(localStorage);
    queueServerSync(() => updateServerDraftMetadata({
      outfitText: form.elements.outfit_text.value,
      generateScene: false,
      sourceAvatarId,
      sourceLookId,
    }));
  } catch (error) {
    draftStatus.textContent = 'Не вдалося зберегти локальну чернетку';
    draftStatus.className = 'draft-status failed';
    telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: reason });
  }
}

function scheduleDraftSave(reason) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistDraft(reason), 250);
}

async function removeFile(kind, index) {
  if (kind === 'person') uploads.setPerson(null);
  else if (kind === 'identity') uploads.setIdentityDetail(null);
  else uploads.removeGarment(index);
  renderUploads();
  telemetry('client.file_removed', { ...fileSummary(uploads), stage: kind });
  await persistDraft(`remove_${kind}`);
  const { sourceAvatarId } = lineageFromStorage(localStorage);
  await queueServerSync(
    () => reconcileServerDraftFiles({ sourceAvatarId }),
    { propagate: true },
  );
}

async function handleSelected(kind, files) {
  try {
    draftStatus.textContent = files.some((file) => /\.(?:heic|heif)$/i.test(file.name)
      || ['image/heic', 'image/heif'].includes(file.type))
      ? 'Конвертуємо HEIC на цьому пристрої…'
      : 'Готуємо фото…';
    const preparedFiles = await Promise.all(files.map(async (file) => {
      const prepared = await prepareImageFile(file);
      if (prepared.changed) telemetry('client.file_prepared', {
        original_bytes: prepared.originalBytes,
        prepared_bytes: prepared.preparedBytes,
        stage: `select_${kind}`,
      });
      return prepared.file;
    }));
    if (kind === 'person') uploads.setPerson(preparedFiles[0]);
    else if (kind === 'identity') uploads.setIdentityDetail(preparedFiles[0]);
    else {
      uploads.addGarments(preparedFiles);
    }
    formError.textContent = '';
    renderUploads();
    telemetry('client.file_selected', { ...fileSummary(uploads), stage: kind });
    requestPersistentStorage().catch(() => false);
    await persistDraft(`select_${kind}`);
    const { sourceAvatarId } = lineageFromStorage(localStorage);
    await queueServerSync(
      () => reconcileServerDraftFiles({ sourceAvatarId }),
      { propagate: true },
    );
  } catch (error) {
    formError.textContent = humanizeVisibleText(error.message);
    telemetry('client.error', { message: error.message.slice(0, 500), stage: `select_${kind}` });
  }
}

function queueSelectedFiles(kind, files, stage) {
  if (!files.length) return;
  queueDraftMutation(() => handleSelected(kind, files), stage);
}

document.querySelector('#person-photo').addEventListener('change', (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  queueSelectedFiles('person', files, 'select_person');
});
document.querySelector('#identity-detail').addEventListener('change', (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  queueSelectedFiles('identity', files, 'select_identity');
});
document.querySelector('#garment-images').addEventListener('change', (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  queueSelectedFiles('garment', files, 'select_item');
});

for (const [selector, kind, stage] of [
  ['#person-photo', 'person', 'select_person'],
  ['#identity-detail', 'identity', 'select_identity'],
  ['#garment-images', 'garment', 'select_item'],
]) {
  const input = document.querySelector(selector);
  bindImageDropZone(input.closest('.upload-card'), {
    input,
    onFiles: (files) => queueSelectedFiles(kind, files, stage),
    onError: (error) => {
      formError.textContent = humanizeVisibleText(error.message);
      telemetry('client.error', {
        message: error.message.slice(0, 500),
        stage: `${stage}_drop`,
      });
    },
  });
}
form.elements.outfit_text.addEventListener('input', () => scheduleDraftSave('outfit_text'));

function setWorkflowActive(active, { reveal = true } = {}) {
  if (reveal) document.documentElement.classList.remove('workflow-pending');
  document.body.classList.toggle('workflow-active', active);
  document.body.classList.toggle(
    'add-items-active',
    !active && form.dataset.mode === 'add-items',
  );
  studioShell.dataset.screen = active ? 'pipeline' : 'input';
}

function setView(name) {
  if (name === 'progress') movePipelineBoard('progress');
  const views = { empty, progress, result: resultView, profile: profileView, scene: sceneView, failure };
  currentViewName = name;
  document.body.classList.toggle('scene-active', name === 'scene');
  document.querySelector('.result-panel').dataset.view = name;
  for (const [viewName, element] of Object.entries(views)) {
    const selected = viewName === name;
    element.classList.toggle('hidden', !selected);
    element.classList.remove('view-enter');
    if (selected) requestAnimationFrame(() => element.classList.add('view-enter'));
  }
}

function renderProgress(state, message, { terminalStatus = null } = {}) {
  const requested = state?.percent == null ? resolveProgressState(state?.key) : state;
  const normalized = { ...requested, percent: Math.max(renderedProgressFloor, requested.percent) };
  renderedProgressFloor = normalized.percent;
  const activeNode = normalized.step == null ? null : PIPELINE_NODES[normalized.step];
  const route = activeRun?.execution_route ?? {};
  document.querySelector('.pipeline-board').dataset.terminal = terminalStatus ?? '';
  document.querySelector('#progress-stage').textContent = `${normalized.percent}%`;
  document.querySelector('#progress-count').textContent = normalized.countLabel
    || (activeNode ? `NODE ${String(normalized.step + 1).padStart(2, '0')}/${PIPELINE_NODE_COUNT} · ${normalized.label}` : normalized.label);
  document.querySelector('#progress-title').textContent = normalized.title;
  document.querySelector('#progress-message').textContent = humanizeVisibleText(message || 'Очікуємо підтвердження сервера…');
  const progressTrack = document.querySelector('#progress-track');
  progressTrack.setAttribute('aria-valuenow', String(normalized.percent));
  progressTrack.setAttribute('aria-valuetext', activeNode
    ? `${normalized.percent}%, ${checkpointDisplayCode(normalized.key)}, checkpoint ${normalized.step + 1} of ${PIPELINE_NODE_COUNT}`
    : `${normalized.percent}%, ${normalized.label}`);
  document.querySelector('#progress-bar').style.width = `${normalized.percent}%`;
  const orbState = normalized.step == null || normalized.step === 0
    ? 'listening'
    : normalized.step <= 4 ? 'searching'
      : normalized.step <= 9 ? 'shaping'
        : normalized.step <= 10 ? 'composing' : 'solving';
  thinkingOrb.setState(orbState);
  document.querySelectorAll('#pipeline-nodes li').forEach((item, index) => {
    const baseStatus = nodeState(index, normalized.step, route, normalized.key === 'COMPLETED');
    const status = terminalStatus && baseStatus === 'active' ? 'stopped' : baseStatus;
    item.classList.remove('active', 'done', 'pending', 'skipped', 'reused', 'stopped');
    item.classList.add(status);
    const statusLabel = PIPELINE_STATUS_LABELS[status];
    item.querySelector('.node-status-label').textContent = statusLabel;
    item.querySelector('.node-state-sr').textContent = statusLabel;
    if (status === 'active' || status === 'stopped') item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });

  const syncDetails = {
    input: 'run_id from this browser',
    operation: 'Fetch persisted run state and reconnect SSE',
    output: 'last confirmed server checkpoint',
    gate: 'never reset an active run locally',
  };
  const optionalSceneDetails = {
    input: 'approved full-look PNG',
    operation: 'Generate the optional editorial still, then run scene VLM QA',
    output: 'editorial still, or no bonus artifact if its gate fails',
    gate: 'bonus failure never invalidates the approved core outputs',
  };
  const details = normalized.key === 'OPTIONAL_SCENE' ? optionalSceneDetails : activeNode ?? syncDetails;
  document.querySelector('#checkpoint-code').textContent = terminalStatus
    ? `${terminalStatus} · ${checkpointDisplayCode(normalized.key ?? 'UNMAPPED')}`
    : checkpointDisplayCode(normalized.key);
  document.querySelector('#checkpoint-input').textContent = details.input;
  let operation = details.operation;
  if (route.avatar_reuse && normalized.step === 11) operation = 'Verify exact avatar SHA-256 and its hash-bound PASS receipt';
  else if (route.garment_images_supplied === false && normalized.step === 5) operation += ' · гілку обробки речей пропущено: використано лише текст';
  document.querySelector('#checkpoint-operation').textContent = operation;
  document.querySelector('#checkpoint-output').textContent = details.output;
  document.querySelector('#checkpoint-gate').textContent = details.gate;
}

function renderRun(run) {
  if (activeRun?.run_id === run.run_id && Date.parse(run.updated_at) < Date.parse(activeRun.updated_at)) return;
  if (activeRun?.run_id !== run.run_id) renderedProgressFloor = 0;
  activeRun = run;
  liveVisualizer.update(run.visual_checkpoint, {
    providerWaiting: isProviderWaitStage(run.inner_state ?? run.phase),
  });
  setWorkflowActive(true);
  localStorage.setItem(ACTIVE_RUN_KEY, run.run_id);
  const hasSelectableConflict = run.status === 'NEEDS_INPUT' && (run.conflicts || []).some((item) => item.type === 'DUPLICATE_SLOT');
  const needsReplacementMaterials = run.status === 'NEEDS_INPUT' && !hasSelectableConflict;
  const needsInput = needsReplacementMaterials
    ? needsInputPresentation(run.message || run.error?.message)
    : null;
  statusChip.textContent = hasSelectableConflict ? 'ПОТРІБЕН ВИБІР' : run.status.replaceAll('_', ' ');
  statusChip.className = `status-chip ${hasSelectableConflict ? 'choice' : run.status === 'COMPLETED' ? 'completed' : run.status === 'FAILED' || run.status === 'NEEDS_INPUT' ? 'failed' : 'running'}`;
  if (run.status === 'COMPLETED') {
    renderProgress(resolveProgressState('COMPLETED'), run.message);
    movePipelineBoard('completed');
    document.querySelector('#completed-pipeline-trace').open = true;
    resultPanelTitle.textContent = 'Результат';
    setView('result');
    renderResults(run);
    submit.disabled = false;
    eventSource?.close();
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    return;
  }
  if (run.status === 'FAILED' || run.status === 'NEEDS_INPUT') {
    const terminalStage = run.terminal_stage ?? run.inner_state ?? run.phase;
    renderProgress(resolveProgressState(terminalStage), run.message, { terminalStatus: run.status });
    movePipelineBoard('failure');
    document.querySelector('#failure-pipeline-trace').open = true;
    resultPanelTitle.textContent = hasSelectableConflict ? 'Вибір' : 'Процес';
    setView('failure');
    failure.classList.toggle('choice', hasSelectableConflict);
    document.querySelector('.failure-mark').textContent = hasSelectableConflict ? '?' : '!';
    document.querySelector('#failure-title').textContent = hasSelectableConflict ? 'Обери річ для образу' : needsInput?.title ?? 'Генерацію зупинено';
    document.querySelector('#failure-message').textContent = hasSelectableConflict ? 'Знайдено кілька різних речей одного типу. Обери одну — генерація продовжиться з цього етапу.' : needsInput?.message ?? humanizeVisibleText(run.message || run.error?.message || 'Невідома помилка');
    renderConflictPicker(run);
    document.querySelector('#retry-run').classList.toggle('hidden', hasSelectableConflict || needsReplacementMaterials);
    submit.disabled = false;
    eventSource?.close();
    return;
  }
  resultPanelTitle.textContent = 'Процес';
  setView('progress');
  renderProgress(resolveProgressState(run.inner_state ?? run.phase), run.message);
}

function renderConflictPicker(run) {
  const picker = document.querySelector('#conflict-picker');
  picker.replaceChildren();
  const conflicts = (run.conflicts || []).filter((item) => item.type === 'DUPLICATE_SLOT');
  if (!conflicts.length) return;
  const selections = {};
  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'primary-button conflict-continue';
  continueButton.textContent = 'Продовжити з обраними речами →';
  continueButton.disabled = true;

  const categoryNames = { outerwear: 'верхній одяг', top: 'верх', bottom: 'низ', one_piece: 'цільний образ', footwear: 'взуття', headwear: 'головний убір', bag: 'сумка', accessory: 'аксесуар' };
  for (const conflict of conflicts) {
    const group = document.createElement('section');
    group.className = 'conflict-group';
    const heading = document.createElement('strong');
    heading.textContent = conflict.category === 'footwear' ? 'Оберіть одну пару взуття' : `Оберіть один варіант: ${humanizeVisibleText(categoryNames[conflict.category] || conflict.category)}`;
    const options = document.createElement('div');
    options.className = 'conflict-options';
    conflict.reference_set_ids.forEach((referenceSetId) => {
      const garment = (run.garments || []).find((item) => item.reference_set_id === referenceSetId || `set-${item.source_index}` === referenceSetId);
      if (!garment) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conflict-option';
      const image = document.createElement('img');
      image.src = garment.preview_url;
      image.alt = humanizeVisibleText(garment.observed?.garment_type || conflict.category);
      const label = document.createElement('span');
      label.textContent = humanizeVisibleText(garment.observed?.garment_type || conflict.category);
      button.append(image, label);
      button.addEventListener('click', () => {
        selections[conflict.category] = referenceSetId;
        options.querySelectorAll('button').forEach((item) => item.classList.toggle('selected', item === button));
        continueButton.disabled = conflicts.some((item) => !selections[item.category]);
      });
      options.append(button);
    });
    group.append(heading, options);
    picker.append(group);
  }

  continueButton.addEventListener('click', async () => {
    continueButton.disabled = true;
    renderedProgressFloor = 0;
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.run_id)}/garment-selection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selections }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти вибір');
      telemetry('client.garment_selected', { categories: Object.keys(selections), stage: 'garment_conflict' }, run.run_id);
      renderRun(body);
      watch(body.run_id);
    } catch (error) {
      document.querySelector('#failure-message').textContent = humanizeVisibleText(error.message);
      continueButton.disabled = false;
    }
  });
  picker.append(continueButton);
}

function profileValue(value) {
  return value?.profile ?? value ?? { avatars: [], looks: [] };
}

function avatarId(avatar) {
  return idOfAvatar(avatar);
}

function avatarImageUrl(avatar) {
  return avatar?.image_url ?? (avatarId(avatar) ? `/api/profile/avatars/${encodeURIComponent(avatarId(avatar))}/image` : '');
}

function setAvatarDraftMode(avatar = null, look = null) {
  const sourceId = avatarId(avatar);
  const reusingAvatar = Boolean(sourceId);
  form.dataset.mode = reusingAvatar ? 'add-items' : 'new-avatar';
  document.body.classList.toggle('reuse-avatar-mode', reusingAvatar);
  document.body.classList.toggle('add-items-active', reusingAvatar);
  document.querySelector('#add-items-kicker').classList.toggle('hidden', !reusingAvatar);
  const addItemsState = reusingAvatar
    ? addItemsScreenState(resolveAddItemsSelection({ avatar, look }))
    : null;
  document.querySelector('#new-avatar-inputs').classList.toggle(
    'hidden',
    addItemsState ? !addItemsState.showNewAvatarInputs : false,
  );
  const context = document.querySelector('#source-avatar-context');
  context.classList.toggle(
    'hidden',
    addItemsState ? !addItemsState.showSourceAvatarContext : true,
  );
  document.querySelector('#material-step').textContent = '01';
  document.querySelector('#material-title').textContent = addItemsState?.title ?? 'Матеріали';
  document.querySelector('#look-divider-label').textContent = addItemsState?.divider ?? 'НОВИЙ ОБРАЗ';
  document.querySelector('#submit-label').textContent = addItemsState?.submit ?? 'Створити аватар';
  document.querySelector('#empty-state-title').textContent = reusingAvatar ? 'Аватар уже зафіксований' : 'Тут з’явиться твій образ';
  document.querySelector('#empty-state-copy').textContent = reusingAvatar
    ? 'Додай речі для нового окремого образу. Використаємо збережені зовнішність і пропорції тіла аватара; попередні образи не зміняться.'
    : 'Спочатку перевіряємо базовий аватар, потім — одяг.';

  const preview = document.querySelector('#source-avatar-preview');
  if (reusingAvatar) {
    preview.src = presentationImageUrl(avatarImageUrl(avatar));
    preview.hidden = false;
    document.querySelector('#source-avatar-name').textContent = addItemsState.sourceName;
    document.querySelector('#source-avatar-detail').textContent = addItemsState.sourceDetail;
  } else {
    preview.removeAttribute('src');
    preview.hidden = true;
    document.querySelector('#source-avatar-detail').textContent = 'Зовнішність уже затверджена — повторно завантажувати фото не потрібно.';
  }
}

function profileLooks(profile) {
  return looksForProfile(profile);
}

function formatProfileExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Зберігаємо в цьому браузері 30 днів';
  return `Збережено в цьому браузері до ${new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(date)}`;
}

async function loadCurrentProfile({ refresh = false } = {}) {
  if (!profileLoadPromise || refresh) {
    profileLoadPromise = loadProfile().then((value) => {
      currentProfile = profileValue(value);
      return currentProfile;
    }).catch((error) => {
      profileLoadPromise = null;
      throw error;
    });
  }
  return profileLoadPromise;
}

async function ensureCompletedRunSaved(run) {
  if (profileSavePromises.has(run.run_id)) return profileSavePromises.get(run.run_id);
  const saveState = document.querySelector('#result-save-state');
  saveState.textContent = 'Зберігаємо профіль…';
  saveState.classList.add('saving');
  const { sourceAvatarId, sourceLookId } = lineageFromStorage(localStorage);
  const operation = (async () => {
    const { response, cleanup } = await saveCompletedProfileRun({
      runId: run.run_id,
      lineage: { sourceAvatarId, sourceLookId },
      claimRun: claimProfileRun,
      saveRun: saveProfileRun,
      finalizeConsumedState: () => finalizeConsumedRunState(localStorage, {
        runId: run.run_id,
        activeRunKey: ACTIVE_RUN_KEY,
        pendingFinalizationKey: PENDING_FINALIZATION_KEY,
        resetPendingKey: DRAFT_RESET_PENDING_KEY,
        clearRunLocation: (completedRunId) => {
          if (new URLSearchParams(location.search).get('run') === completedRunId) {
            history.replaceState({}, '', location.pathname);
          }
        },
        clearLocalDraft: clearDraft,
        clearServerDraft,
      }),
    });
    setServerDraftBindings({ person: null, identity: null, garments: [] });
    serverDraftLineage = { source_avatar_id: null, source_look_id: null };
    serverDraftLoaded = cleanup.serverDraftCleared;
    serverDraftResetRequired = !cleanup.serverDraftCleared;
    if (!cleanup.fullyCleared) {
      telemetry('client.draft_error', {
        local_cleared: cleanup.localDraftCleared,
        server_cleared: cleanup.serverDraftCleared,
        run_location_cleared: cleanup.runLocationCleared,
        stage: 'post_save_cleanup',
      }, run.run_id);
    }
    currentProfile = profileValue(response);
    profileLoadPromise = Promise.resolve(currentProfile);
    const avatars = currentProfile.avatars ?? [];
    const savedAvatarId = response?.avatar_id ?? response?.avatar?.avatar_id ?? response?.avatar?.id ?? sourceAvatarId
      ?? avatarId(avatars.find((avatar) => avatar.source_run_id === run.run_id));
    currentResultAvatarId = savedAvatarId;
    currentResultLookId = response?.look?.look_id ?? response?.look?.id ?? null;
    const sceneButton = document.querySelector('#create-scene');
    sceneButton.disabled = !currentResultLookId;
    sceneButton.textContent = currentResultLookId ? 'Створити сцену' : 'Сцена недоступна';
    const selected = avatars.find((avatar) => avatarId(avatar) === savedAvatarId);
    document.querySelector('#result-avatar-name').textContent = selected?.name || `Аватар ${String(Math.max(1, avatars.findIndex((avatar) => avatarId(avatar) === savedAvatarId) + 1)).padStart(2, '0')}`;
    const expiry = currentProfile.expires_at ?? response?.expires_at;
    document.querySelector('#result-profile-expiry').textContent = formatProfileExpiry(expiry);
    saveState.textContent = 'Перевірку пройдено · збережено';
    saveState.onclick = null;
    saveState.classList.remove('saving', 'failed');
    telemetry('client.profile_saved', { avatar_id: savedAvatarId, stage: 'completed_run' }, run.run_id);
    return currentProfile;
  })().catch((error) => {
    profileSavePromises.delete(run.run_id);
    saveState.textContent = 'Не вдалося підтвердити збереження · повторити';
    saveState.classList.remove('saving');
    saveState.classList.add('failed');
    saveState.onclick = () => ensureCompletedRunSaved(run).catch(() => {});
    telemetry('client.profile_error', { message: error.message.slice(0, 500), stage: 'save_completed' }, run.run_id);
    throw error;
  });
  profileSavePromises.set(run.run_id, operation);
  return operation;
}

function createProfileButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function profilePage(items, requestedPage, pageSize) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const start = page * pageSize;
  return {
    page,
    pageCount,
    entries: items.slice(start, start + pageSize).map((value, offset) => ({ value, index: start + offset })),
  };
}

function appendProfilePager(container, { label, page, pageCount, onChange }) {
  if (pageCount <= 1) return;
  container.classList.add('is-paged');
  const pager = document.createElement('nav');
  pager.className = 'profile-pager';
  pager.setAttribute('aria-label', label);
  const previous = createProfileButton('←', 'profile-page-button', () => onChange(page - 1));
  previous.disabled = page === 0;
  previous.setAttribute('aria-label', 'Попередня сторінка');
  const counter = document.createElement('span');
  counter.textContent = `${page + 1} / ${pageCount}`;
  const next = createProfileButton('→', 'profile-page-button', () => onChange(page + 1));
  next.disabled = page === pageCount - 1;
  next.setAttribute('aria-label', 'Наступна сторінка');
  pager.append(previous, counter, next);
  container.append(pager);
}

async function beginDraft({ avatar = null, look = null, outfitText = '' } = {}) {
  const selection = avatar ? resolveAddItemsSelection({ avatar, look }) : null;
  const carriedOutfitText = typeof outfitText === 'string' ? outfitText.trim() : '';
  form.inert = true;
  form.setAttribute('aria-busy', 'true');
  try {
    sceneUi?.stopWatching();
    eventSource?.close();
    window.clearTimeout(transitionTimer);
    window.clearTimeout(resumeTimer);
    activeRun = null;
    currentResultRunId = null;
    currentResultLookId = null;
    renderedProgressFloor = 0;
    form.reset();
    form.elements.outfit_text.value = carriedOutfitText;
    uploads.reset();
    renderUploads();
    localStorage.removeItem(ACTIVE_RUN_KEY);
    localStorage.removeItem(PENDING_FINALIZATION_KEY);
    serverDraftResetRequired = true;
    localStorage.setItem(DRAFT_RESET_PENDING_KEY, selection ? 'add-items' : 'new-avatar');
    if (selection) storeAddItemsSelection(localStorage, selection);
    else clearAddItemsSelection(localStorage);
    setAvatarDraftMode(selection?.avatar ?? null, selection?.look ?? null);
    history.replaceState({}, '', location.pathname);
    resultPanelTitle.textContent = avatar ? 'Новий окремий образ' : 'Процес';
    statusChip.textContent = avatar ? 'АВАТАР ЗАФІКСОВАНО' : 'Очікує матеріали';
    statusChip.className = 'status-chip idle';
    setView('empty');
    setWorkflowActive(false);
    const serverCleared = clearServerDraft().then(() => true).catch(() => false);
    const [, didClearServer] = await Promise.all([clearDraft().catch(() => {}), serverCleared]);
    setServerDraftBindings({ person: null, identity: null, garments: [] });
    serverDraftLineage = { source_avatar_id: null, source_look_id: null };
    serverDraftLoaded = didClearServer;
    serverDraftResetRequired = !didClearServer;
    if (didClearServer) localStorage.removeItem(DRAFT_RESET_PENDING_KEY);

    if (selection) {
      renderUploads();
      await saveDraft({ ...uploads, outfitText: carriedOutfitText, generateScene: false });
      if (didClearServer) {
        await updateServerDraftMetadata({
          outfitText: carriedOutfitText,
          generateScene: false,
          sourceAvatarId: selection.avatarId,
          sourceLookId: selection.lookId,
        });
        serverDraftLineage = {
          source_avatar_id: selection.avatarId,
          source_look_id: selection.lookId,
        };
        serverDraftLoaded = true;
      }
      draftStatus.textContent = carriedOutfitText
        ? 'Попередній опис перенесено · уточни його або додай фото речі'
        : 'Аватар зафіксовано · додай речі для окремого образу';
      draftStatus.className = 'draft-status saved';
    } else {
      draftStatus.textContent = 'Нова порожня чернетка аватара';
    }
    requestAnimationFrame(() => {
      if (selection) studioShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    (selection ? form.elements.outfit_text : document.querySelector('#person-photo')).focus();
  } finally {
    form.inert = false;
    form.removeAttribute('aria-busy');
    submit.disabled = false;
  }
}

function captureProfileReturnState() {
  if (currentViewName === 'profile' || currentViewName === 'scene') return false;
  profileReturnState = {
    view: currentViewName,
    workflowActive: document.body.classList.contains('workflow-active'),
    panelTitle: resultPanelTitle.textContent,
    statusText: statusChip.textContent,
    statusClass: statusChip.className,
  };
  profileReturnFocus = document.activeElement?.focus ? document.activeElement : null;
  return true;
}

function restoreProfileReturnView() {
  sceneUi?.stopWatching();
  restoreProfileReturnState(profileReturnState, {
    restorePanel: (target) => {
      if (target.panelTitle) resultPanelTitle.textContent = target.panelTitle;
      if (target.statusText) statusChip.textContent = target.statusText;
      if (target.statusClass) statusChip.className = target.statusClass;
    },
    setWorkflowActive,
    setView,
  });
  requestAnimationFrame(() => {
    if (profileReturnFocus?.isConnected) profileReturnFocus.focus();
    else studioShell.focus?.({ preventScroll: true });
  });
}

async function selectProfileAvatar(profile, avatar) {
  const transition = resolveSavedAvatarTransition(profile, avatar);
  await executeSavedAvatarTransition(transition, {
    openLook: (look) => openProfileLook(profile, look),
    filterAvatar: async (avatarId) => {
      selectedProfileAvatarId = avatarId;
      selectedProfileLookId = null;
      profileLookPage = 0;
      await renderProfile(profile);
      requestAnimationFrame(() => {
        const firstRelatedLook = document.querySelector(
          `#profile-look-grid [data-avatar-id="${CSS.escape(selectedProfileAvatarId)}"] .profile-look-open`,
        );
        (firstRelatedLook ?? document.querySelector('#profile-look-heading'))?.focus?.({ preventScroll: true });
      });
    },
  });
}

async function openProfileLook(profile, look) {
  const selection = resolveProfileLookSelection(profile, look);
  selectedProfileAvatarId = selection.avatarId;
  selectedProfileLookId = selection.lookId;
  profileLookPage = 0;
  await renderProfile(profile);
  requestAnimationFrame(() => {
    const detail = document.querySelector('#profile-look-detail');
    detail?.focus({ preventScroll: true });
  });
}

function renderProfileSceneLibrary(look) {
  const scenes = scenesForLook(look);
  const list = document.querySelector('#profile-look-scene-list');
  const emptyState = document.querySelector('#profile-look-scenes-empty');
  const count = document.querySelector('#profile-look-scenes-count');
  const section = document.querySelector('#profile-look-scenes');
  list.replaceChildren();
  section.classList.toggle('hidden', scenes.length === 0);
  count.textContent = String(scenes.length);
  count.setAttribute(
    'aria-label',
    scenes.length === 1 ? '1 збережена сцена' : `${scenes.length} збережених сцен`,
  );
  emptyState.classList.toggle('hidden', scenes.length > 0);

  scenes.forEach((scene, index) => {
    const status = sceneStatusLabel(scene.status);
    const item = document.createElement('li');
    item.className = 'profile-look-scene-item';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'profile-look-scene-open';
    open.dataset.status = String(scene.status ?? 'UNKNOWN').toUpperCase();

    const visual = document.createElement('span');
    visual.className = 'profile-look-scene-visual';
    if (scene.image_url) {
      const image = document.createElement('img');
      image.src = presentationImageUrl(scene.image_url);
      image.alt = '';
      image.loading = 'lazy';
      visual.append(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'profile-look-scene-placeholder';
      placeholder.textContent = String(index + 1).padStart(2, '0');
      placeholder.setAttribute('aria-hidden', 'true');
      visual.append(placeholder);
    }

    const copy = document.createElement('span');
    copy.className = 'profile-look-scene-copy';
    const title = document.createElement('strong');
    title.textContent = scenePresetLabel(scene.preset);
    open.setAttribute('aria-label', `Відкрити ${title.textContent}. Статус: ${status}`);
    const state = document.createElement('small');
    state.textContent = status;
    const preset = document.createElement('code');
    preset.textContent = scene.preset?.preset_id || 'scene';
    copy.append(title, state, preset);
    open.append(visual, copy);
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      sceneUi.openExisting(scene, look).catch(showProfileError);
    });
    item.append(open);
    list.append(item);
  });
}

function editorialShootsForLook(profile, look, supplied = null) {
  if (!look) return [];
  const lookId = look.look_id ?? look.id;
  const nested = supplied
    ?? look.editorial_shoots
    ?? look.editorialShoots
    ?? [];
  const topLevel = Array.isArray(profile?.editorial_shoots)
    ? profile.editorial_shoots.filter((shoot) => (
      (shoot.look_id
        ?? shoot.approved_look?.look_id
        ?? shoot.bindings?.approved_look?.look_id) === lookId
    ))
    : [];
  const localProjection = sceneUi?.editorialResumeProjectionForLook(lookId);
  const unique = new Map();
  for (const shoot of [...topLevel, ...(Array.isArray(nested) ? nested : [])]) {
    const shootId = shoot?.shoot_id ?? shoot?.id;
    if (shootId) unique.set(shootId, shoot);
  }
  if (localProjection && !unique.has(localProjection.shoot_id)) {
    unique.set(localProjection.shoot_id, localProjection);
  }
  return [...unique.values()];
}

function renderProfileEditorialLibrary(look, profile = currentProfile, supplied = null) {
  const shoots = editorialShootsForLook(profile, look, supplied);
  const list = document.querySelector('#profile-look-editorial-list');
  const emptyState = document.querySelector('#profile-look-editorial-empty');
  const count = document.querySelector('#profile-look-editorial-count');
  const section = document.querySelector('#profile-look-editorial');
  list.replaceChildren();
  section.classList.toggle('hidden', shoots.length === 0);
  count.textContent = String(shoots.length);
  count.setAttribute(
    'aria-label',
    shoots.length === 1 ? '1 збережена fashion-фотосесія' : `${shoots.length} збережених fashion-фотосесій`,
  );
  emptyState.classList.toggle('hidden', shoots.length > 0);

  shoots.forEach((shoot, index) => {
    const shootId = shoot.shoot_id ?? shoot.id;
    const status = String(shoot.status ?? 'SAVED').replaceAll('_', ' ');
    const modeId = shoot.mode?.mode_id
      ?? shoot.mode_id
      ?? shoot.bindings?.shoot_bible?.mode_id;
    const mode = shoot.mode?.ui_name_uk ?? ({
      'editorial.edwin_novak.organic_contrast': 'Органічний контраст',
      'editorial.edwin_novak.urban_monochrome': 'Міський монохром',
      'editorial.edwin_novak.institutional_modernism': 'Інституційний модернізм',
      'editorial.edwin_novak.luminous_blue_white': 'Світлий синьо-білий',
    })[modeId] ?? 'Art Fashion';
    const item = document.createElement('li');
    item.className = 'profile-look-scene-item profile-look-editorial-item';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'profile-look-scene-open';
    open.dataset.status = String(shoot.status ?? 'SAVED').toUpperCase();
    open.setAttribute('aria-label', `Відкрити fashion-фотосесію ${mode}. Статус: ${status}`);

    const visual = document.createElement('span');
    visual.className = 'profile-look-scene-visual';
    const heroUrl = shoot.hero_image_url
      ?? shoot.preview_url
      ?? shoot.shots?.find((shot) => shot.slot === 'clean_identity_hero')?.output?.image_url;
    if (heroUrl) {
      const image = document.createElement('img');
      image.src = presentationImageUrl(heroUrl);
      image.alt = '';
      image.loading = 'lazy';
      visual.append(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'profile-look-scene-placeholder';
      placeholder.textContent = `F${String(index + 1).padStart(2, '0')}`;
      placeholder.setAttribute('aria-hidden', 'true');
      visual.append(placeholder);
    }

    const copy = document.createElement('span');
    copy.className = 'profile-look-scene-copy';
    const title = document.createElement('strong');
    title.textContent = mode;
    const state = document.createElement('small');
    state.textContent = status;
    const code = document.createElement('code');
    code.textContent = shootId;
    copy.append(title, state, code);
    open.append(visual, copy);
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      sceneUi.openExistingEditorial(shoot, look).catch(showProfileError);
    });
    item.append(open);
    list.append(item);
  });
}

async function renderProfile(profileValueToRender = null) {
  sceneUi?.stopWatching();
  const openedProfile = captureProfileReturnState();
  const profile = profileValue(profileValueToRender ?? await loadCurrentProfile({ refresh: true }));
  currentProfile = profile;
  const avatars = profile.avatars ?? [];
  const looks = profileLooks(profile);
  let selectedAvatar = selectedProfileAvatarId
    ? avatars.find((avatar) => avatarId(avatar) === selectedProfileAvatarId) ?? null
    : null;
  if (selectedProfileAvatarId && !selectedAvatar) {
    selectedProfileAvatarId = null;
    selectedProfileLookId = null;
    selectedAvatar = null;
  }
  const visibleLooks = selectedAvatar ? looksForAvatar(profile, selectedAvatar) : looks;
  const selectedLookFromProfile = selectedProfileLookId
    ? visibleLooks.find((look) => (look.look_id ?? look.id) === selectedProfileLookId) ?? null
    : null;
  if (selectedProfileLookId && !selectedLookFromProfile) selectedProfileLookId = null;
  selectedProfileLook = selectedLookFromProfile;
  selectedProfileLookSelection = selectedProfileLook
    ? resolveProfileLookSelection(profile, selectedProfileLook)
    : null;

  const compact = window.matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
  const avatarPage = profilePage(avatars, profileAvatarPage, compact ? 2 : Math.max(1, avatars.length));
  const lookPage = profilePage(visibleLooks, profileLookPage, compact ? 2 : Math.max(1, visibleLooks.length));
  profileAvatarPage = avatarPage.page;
  profileLookPage = lookPage.page;
  document.querySelector('#profile-expiry').textContent = formatProfileExpiry(profile.expires_at);
  const lookContext = document.querySelector('#profile-look-context');
  const lookHeading = document.querySelector('#profile-look-heading');
  const clearAvatar = document.querySelector('#profile-clear-avatar');
  lookContext.textContent = selectedAvatar ? 'ОБРАЗИ ВИБРАНОГО АВАТАРА' : 'УСІ ЗБЕРЕЖЕНІ ОБРАЗИ';
  lookHeading.textContent = selectedAvatar?.name || 'Збережені образи';
  lookHeading.tabIndex = -1;
  clearAvatar.classList.toggle('hidden', !selectedAvatar);
  const avatarList = document.querySelector('#profile-avatar-list');
  const lookGrid = document.querySelector('#profile-look-grid');
  avatarList.replaceChildren();
  lookGrid.replaceChildren();

  avatarPage.entries.forEach(({ value: avatar, index }) => {
    const id = avatarId(avatar);
    const active = id === selectedProfileAvatarId;
    const latestLook = latestLookForAvatar(profile, avatar);
    const card = document.createElement('article');
    card.className = 'profile-avatar-item';
    card.classList.toggle('is-active', active);
    card.dataset.avatarId = id;
    const selector = document.createElement('button');
    selector.type = 'button';
    selector.className = 'profile-avatar-select';
    selector.setAttribute('aria-pressed', String(active));
    selector.setAttribute('aria-controls', 'profile-look-grid');
    selector.setAttribute(
      'aria-label',
      latestLook
        ? `Відкрити ${latestLook.name || 'останній збережений образ'} для ${avatar.name || `Аватар ${index + 1}`}`
        : `${active ? 'Вибрано' : 'Обрати'} ${avatar.name || `Аватар ${index + 1}`} і показати пов’язані образи`,
    );
    const image = document.createElement('img');
    image.src = presentationImageUrl(avatarImageUrl(avatar));
    image.alt = avatar.name || `Аватар ${index + 1}`;
    const summary = document.createElement('span');
    summary.className = 'profile-avatar-summary';
    const title = document.createElement('strong');
    title.textContent = avatar.name || `Аватар ${String(index + 1).padStart(2, '0')}`;
    const count = document.createElement('small');
    count.textContent = formatLookCount(looksForAvatar(profile, avatar).length);
    summary.append(title, count);
    selector.append(image, summary);
    selector.addEventListener('click', () => selectProfileAvatar(profile, avatar).catch(showProfileError));
    const actions = document.createElement('div');
    actions.className = 'profile-item-actions';
    actions.append(
      createProfileButton('Новий образ з цим аватаром', 'primary-result-action', (event) => {
        event.stopPropagation();
        continueAddItemsFromSelection(
          resolveSavedAvatarTransition(profile, avatar).selection,
          beginDraft,
        ).catch(showProfileError);
      }),
    );
    card.append(selector, actions);
    avatarList.append(card);
  });

  lookPage.entries.forEach(({ value: look, index }) => {
    const lookId = look.id ?? look.look_id;
    const selection = resolveProfileLookSelection(profile, look);
    const active = lookId === selectedProfileLookId;
    const card = document.createElement('article');
    card.className = 'profile-look-card';
    card.classList.toggle('is-active', active);
    card.dataset.avatarId = selection.avatarId;
    card.dataset.lookId = lookId;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'profile-look-open';
    open.setAttribute('aria-expanded', String(active));
    open.setAttribute('aria-controls', 'profile-look-detail');
    const image = document.createElement('img');
    image.src = presentationImageUrl(look.image_url ?? `/api/profile/looks/${encodeURIComponent(lookId)}/image`);
    image.alt = look.name || `Збережений образ ${index + 1}`;
    const title = document.createElement('strong');
    title.textContent = look.name || `Образ ${String(index + 1).padStart(2, '0')}`;
    const owner = document.createElement('small');
    owner.textContent = selection.avatar?.name || 'Збережений аватар';
    open.append(image, title, owner);
    open.setAttribute('aria-label', `Відкрити ${title.textContent} для ${owner.textContent}`);
    open.addEventListener('click', () => openProfileLook(profile, look).catch(showProfileError));
    card.append(open);
    lookGrid.append(card);
  });

  if (!avatars.length) {
    const emptyProfile = document.createElement('div');
    emptyProfile.className = 'profile-empty';
    emptyProfile.textContent = 'Збережених аватарів поки немає.';
    avatarList.append(emptyProfile);
  }
  if (!visibleLooks.length) {
    const emptyLooks = document.createElement('div');
    emptyLooks.className = 'profile-empty';
    emptyLooks.textContent = selectedAvatar
      ? 'Для цього аватара ще немає образів. Натисни «Новий образ з цим аватаром».'
      : 'Перший образ з’явиться тут після генерації.';
    lookGrid.append(emptyLooks);
  }
  appendProfilePager(avatarList, {
    label: 'Сторінки аватарів',
    page: avatarPage.page,
    pageCount: avatarPage.pageCount,
    onChange: (page) => {
      profileAvatarPage = page;
      renderProfile(profile).catch(showProfileError);
    },
  });
  appendProfilePager(lookGrid, {
    label: selectedAvatar ? `Сторінки образів ${selectedAvatar.name || 'вибраного аватара'}` : 'Сторінки образів',
    page: lookPage.page,
    pageCount: lookPage.pageCount,
    onChange: (page) => {
      profileLookPage = page;
      renderProfile(profile).catch(showProfileError);
    },
  });

  const detail = document.querySelector('#profile-look-detail');
  const profileLibrary = document.querySelector('.profile-library');
  const detailImage = document.querySelector('#profile-look-detail-image');
  const detailTitle = document.querySelector('#profile-look-detail-title');
  const detailOwner = document.querySelector('#profile-look-detail-owner');
  const editorialRequestVersion = ++profileEditorialRequestVersion;
  detail.classList.toggle('hidden', !selectedProfileLookSelection);
  profileLibrary?.classList.toggle('has-open-look', Boolean(selectedProfileLookSelection));
  if (selectedProfileLookSelection) {
    detailImage.src = presentationImageUrl(selectedProfileLook.image_url
      ?? `/api/profile/looks/${encodeURIComponent(selectedProfileLookSelection.lookId)}/image`);
    detailImage.alt = selectedProfileLook.name || 'Вибраний збережений образ';
    detailTitle.textContent = selectedProfileLook.name || 'Збережений образ';
    detailOwner.textContent = `${selectedProfileLookSelection.avatar?.name || 'Збережений аватар'} · зберігаємо зовнішність і пропорції тіла`;
    renderProfileSceneLibrary(selectedProfileLook);
    renderProfileEditorialLibrary(selectedProfileLook, profile);
    const requestedLookId = selectedProfileLookSelection.lookId;
    listProfileLookEditorialShoots(requestedLookId)
      .then((response) => {
        if (profileEditorialRequestVersion !== editorialRequestVersion
          || selectedProfileLookId !== requestedLookId) return;
        renderProfileEditorialLibrary(
          selectedProfileLook,
          profile,
          response?.shoots ?? response?.editorial_shoots ?? response,
        );
      })
      .catch(() => undefined);
    refreshFashionVideoCapability(selectedProfileLook);
    refreshRealtimeLookCapability(selectedProfileLook);
  } else {
    detailImage.removeAttribute('src');
    detailTitle.textContent = 'Збережений образ';
    detailOwner.textContent = '';
    renderProfileSceneLibrary(null);
    renderProfileEditorialLibrary(null, profile);
    refreshFashionVideoCapability(null);
    refreshRealtimeLookCapability(null);
  }

  resultPanelTitle.textContent = 'Мій профіль';
  statusChip.textContent = 'ЗБЕРЕЖЕНО';
  statusChip.className = 'status-chip completed';
  setWorkflowActive(true);
  setView('profile');
  if (openedProfile) requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function showProfileError(error) {
  formError.textContent = humanizeVisibleText(error.message);
  telemetry('client.profile_error', { message: error.message.slice(0, 500), stage: 'action' });
}

function renderResults(run) {
  const sceneButton = document.querySelector('#create-scene');
  if (currentResultRunId !== run.run_id) {
    currentResultRunId = run.run_id;
    currentResultAvatarId = null;
    currentResultLookId = null;
    sceneButton.disabled = true;
    sceneButton.textContent = 'Зберігаємо для сцени…';
  }
  const passports = document.querySelector('#passport-list');
  passports.replaceChildren();
  (run.garments || []).forEach((item) => {
    const element = document.createElement('span');
    element.className = 'passport';
    element.textContent = humanizeVisibleText(`${item.category} · ${Math.round(item.confidence * 100)}%`);
    passports.append(element);
  });
  const items = [
    ['avatar_outfit', 'Образ'],
    ['avatar', 'Аватар'],
    ['art_director_scene', 'Арткадр'],
  ].filter(([key]) => run.outputs[key]).map(([key, label]) => ({ key, label, url: run.outputs[key] }));
  const activeImage = document.querySelector('#active-result-image');
  const activeLabel = document.querySelector('#active-result-label');
  const activeDownload = document.querySelector('#active-result-download');
  const tabs = document.querySelector('#result-tabs');
  tabs.replaceChildren();

  const activate = (selected) => {
    activeImage.src = presentationImageUrl(selected.url);
    activeImage.alt = selected.label === 'Аватар' ? 'Базовий ZEELY аватар' : `ZEELY ${selected.label.toLowerCase()}`;
    activeLabel.textContent = selected.label;
    activeDownload.href = selected.url;
    tabs.querySelectorAll('.result-tab').forEach((button) => {
      const active = button.dataset.output === selected.key;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-tab';
    button.dataset.output = item.key;
    const thumb = document.createElement('img');
    thumb.src = presentationImageUrl(item.url);
    thumb.alt = '';
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(thumb, label);
    button.addEventListener('click', () => activate(item));
    tabs.append(button);
  }

  const avatarUrl = run.outputs.avatar || run.outputs.avatar_outfit;
  const avatarPreview = document.querySelector('#profile-avatar-preview');
  avatarPreview.src = presentationImageUrl(avatarUrl);
  avatarPreview.hidden = !avatarUrl;
  if (items.length) activate(items[0]);
  ensureCompletedRunSaved(run).catch(() => {});
}

function watch(runId) {
  eventSource?.close();
  sseRecovering = false;
  eventSource = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  eventSource.onopen = () => {
    telemetry('client.sse_open', { stage: 'run' }, runId);
  };
  eventSource.addEventListener('run', (event) => {
    const run = JSON.parse(event.data);
    telemetry('client.run_event', { status: run.status, stage: run.inner_state || run.phase }, runId);
    renderRun(run);
  });
  eventSource.onerror = async () => {
    if (sseRecovering || activeRun?.run_id !== runId || isTerminal(activeRun)) return;
    sseRecovering = true;
    telemetry('client.sse_error', { stage: 'run' }, runId);
    try {
      const run = await fetchRunWithRetry(runId, { delays: [0, 750, 1_500] });
      renderRun(run);
    } catch (error) {
      telemetry('client.fetch_error', { message: error.message.slice(0, 500), stage: 'run_poll' }, runId);
      if (!isTerminal(activeRun)) {
        renderProgress(
          resolveProgressState(activeRun?.inner_state ?? activeRun?.phase ?? 'RESUMING'),
          'Зв’язок із сервером перепідключається. Генерацію не зупинено.',
        );
      }
    } finally {
      sseRecovering = false;
    }
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting) return;
  formError.textContent = '';
  submit.disabled = true;
  form.inert = true;
  form.setAttribute('aria-busy', 'true');
  window.clearTimeout(saveTimer);
  await draftMutationQueue;
  await persistDraft('submit_finalize');
  const outfitText = form.elements.outfit_text.value.trim();
  const { sourceAvatarId, sourceLookId } = lineageFromStorage(localStorage);
  if (!sourceAvatarId && !uploads.person) {
    formError.textContent = 'Додай фото людини.';
    submit.disabled = false;
    form.inert = false;
    form.removeAttribute('aria-busy');
    return;
  }
  if (!outfitText && uploads.garments.length === 0) {
    formError.textContent = 'Додай опис образу або хоча б одне фото речі.';
    submit.disabled = false;
    form.inert = false;
    form.removeAttribute('aria-busy');
    return;
  }
  if (!form.elements.consent.checked) {
    formError.textContent = 'Потрібна згода на обробку фото.';
    submit.disabled = false;
    form.inert = false;
    form.removeAttribute('aria-busy');
    return;
  }

  submitting = true;
  renderedProgressFloor = 0;
  liveVisualizer.update(null, { providerWaiting: false });
  setWorkflowActive(true);
  resultPanelTitle.textContent = 'Процес';
  statusChip.textContent = 'ВИКОНУЄТЬСЯ';
  statusChip.className = 'status-chip running';
  setView('progress');
  window.clearTimeout(transitionTimer);
  transitionTimer = window.setTimeout(() => studioShell.scrollIntoView({ behavior: 'smooth', block: 'start' }), 720);
  const startedAt = performance.now();
  let finalizationId = null;
  telemetry('client.submit', {
    ...fileSummary(uploads),
    avatar_reuse: Boolean(sourceAvatarId),
    stage: 'draft_finalize',
  });
  try {
    renderProgress(resolveProgressState('PREPARING'), 'Перевіряємо збереження всіх файлів…');
    const confirmedFiles = await ensureServerDraftComplete();
    renderProgress(resolveProgressState('UPLOADED'), 'Файли на сервері. Створюємо зафіксований запуск…');
    finalizationId = localStorage.getItem(PENDING_FINALIZATION_KEY) || createFinalizationId();
    localStorage.setItem(PENDING_FINALIZATION_KEY, finalizationId);
    localStorage.setItem(ACTIVE_RUN_KEY, finalizationId);
    history.replaceState({}, '', `${location.pathname}?run=${encodeURIComponent(finalizationId)}`);
    const body = await createRunFromServerDraft(finalizationId, {
      sourceAvatarId,
      sourceLookId,
      fileManifest: confirmedFiles,
    });
    localStorage.removeItem(PENDING_FINALIZATION_KEY);
    telemetry('client.submit_response', { status: 202, duration_ms: Math.round(performance.now() - startedAt), stage: 'run_created_from_draft' }, body.run_id);
    history.replaceState({}, '', `${location.pathname}?run=${encodeURIComponent(body.run_id)}`);
    renderRun(body);
    watch(body.run_id);
  } catch (error) {
    telemetry('client.fetch_error', { message: error.message.slice(0, 500), duration_ms: Math.round(performance.now() - startedAt), stage: 'create_run' });
    const definitivelyRejected = clearDefinitivelyRejectedRunState(error, finalizationId, localStorage);
    if (!definitivelyRejected && finalizationId && await resumeRun(finalizationId, { retryNotFound: true })) return;
    window.clearTimeout(transitionTimer);
    if (localStorage.getItem(ACTIVE_RUN_KEY) === finalizationId) localStorage.removeItem(ACTIVE_RUN_KEY);
    history.replaceState({}, '', location.pathname);
    formError.textContent = `${humanizeVisibleText(error.message)}. Запуск не створено — перевір фото вище та натисни «Спробувати ще раз».`;
    document.querySelector('#submit-label').textContent = 'Спробувати ще раз';
    submit.disabled = false;
    statusChip.textContent = 'Завантаження не завершено';
    statusChip.className = 'status-chip failed';
    setView('empty');
    setWorkflowActive(false);
  } finally {
    submitting = false;
    form.inert = false;
    form.removeAttribute('aria-busy');
  }
});

document.querySelector('#retry-run').addEventListener('click', async () => {
  if (!activeRun) return;
  try {
    renderedProgressFloor = 0;
    const response = await fetch(`/api/runs/${encodeURIComponent(activeRun.run_id)}/retry`, { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    renderRun(body); watch(body.run_id);
  } catch (error) {
    document.querySelector('#failure-message').textContent = humanizeVisibleText(error.message);
    telemetry('client.fetch_error', { message: error.message.slice(0, 500), stage: 'retry' }, activeRun.run_id);
  }
});

document.querySelector('#edit-input').addEventListener('click', async () => {
  eventSource?.close();
  window.clearTimeout(resumeTimer);
  window.clearTimeout(transitionTimer);
  activeRun = null;
  renderedProgressFloor = 0;
  localStorage.removeItem(ACTIVE_RUN_KEY);
  localStorage.removeItem(PENDING_FINALIZATION_KEY);
  history.replaceState({}, '', location.pathname);
  resultPanelTitle.textContent = 'Pipeline';
  statusChip.textContent = 'Очікує матеріали';
  statusChip.className = 'status-chip idle';
  setView('empty');
  form.inert = true;
  form.setAttribute('aria-busy', 'true');
  setWorkflowActive(false);
  try {
    await restoreDraft();
  } finally {
    form.inert = false;
    form.removeAttribute('aria-busy');
    submit.disabled = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

sceneUi = createSceneUi({
  setView,
  setWorkflowActive,
  loadProfile: () => loadCurrentProfile({ refresh: true }),
  renderProfile: () => renderProfile(),
  humanize: humanizeVisibleText,
  telemetry,
});

document.querySelector('#new-avatar').addEventListener('click', async () => {
  try {
    if (activeRun?.status === 'COMPLETED') await ensureCompletedRunSaved(activeRun);
    await beginDraft();
  } catch (error) { showProfileError(error); }
});
document.querySelector('#profile-new-avatar').addEventListener('click', () => beginDraft().catch(showProfileError));
document.querySelector('#change-source-avatar').addEventListener('click', () => renderProfile().catch(showProfileError));
document.querySelector('#open-profile-global').addEventListener('click', () => renderProfile().catch(showProfileError));
document.querySelector('#profile-back').addEventListener('click', (event) => {
  event.stopPropagation();
  restoreProfileReturnView();
});
document.querySelector('#profile-clear-avatar').addEventListener('click', (event) => {
  event.stopPropagation();
  selectedProfileAvatarId = null;
  selectedProfileLookId = null;
  profileLookPage = 0;
  renderProfile(currentProfile).catch(showProfileError);
});
document.querySelector('#profile-look-detail-close').addEventListener('click', (event) => {
  event.stopPropagation();
  selectedProfileLookId = null;
  renderProfile(currentProfile).then(() => {
    const activeAvatar = document.querySelector('#profile-avatar-list .profile-avatar-select[aria-pressed="true"]');
    activeAvatar?.focus({ preventScroll: true });
  }).catch(showProfileError);
});
document.querySelector('#profile-look-add').addEventListener('click', (event) => {
  event.stopPropagation();
  if (!selectedProfileLookSelection) return;
  continueAddItemsFromSelection(selectedProfileLookSelection, beginDraft).catch(showProfileError);
});
function openSelectedLookScene(initialTab) {
  if (!selectedProfileLook) return;
  sceneUi.openForLook(selectedProfileLook, { initialTab }).catch(showProfileError);
}
function setLookActionStatus(message) {
  const target = document.querySelector('#profile-look-action-status');
  if (target) target.textContent = message;
}
function syncFashionVideoAction({ state = 'checking', capability = null } = {}) {
  const action = document.querySelector('#profile-look-video');
  const label = document.querySelector('#profile-look-video-state');
  if (!action || !label) return;
  fashionVideoCapability = capability;
  action.dataset.state = state;
  action.classList.toggle('is-checking', state === 'checking');
  action.setAttribute('aria-busy', String(state === 'checking'));
  if (state === 'checking') fashionVideoCapabilityOrb.setState('searching');
  action.disabled = !selectedProfileLook || state !== 'ready';
  action.setAttribute(
    'aria-label',
    state === 'ready'
      ? 'Відкрити Fashion Video'
      : 'Fashion Video ще готується: потрібні два референси',
  );
  label.textContent = state === 'ready'
    ? 'Style + motion перевірені'
    : state === 'unavailable'
      ? 'Потрібні 2 референси'
      : 'Перевіряємо доступність';
}
async function refreshFashionVideoCapability(look) {
  const requestVersion = ++fashionVideoCapabilityRequestVersion;
  const lookId = idOfLook(look);
  syncFashionVideoAction({ state: lookId ? 'checking' : 'unavailable' });
  if (!lookId) return;
  try {
    const response = await fetch(
      `/api/profile/looks/${encodeURIComponent(lookId)}/video-capability`,
      { credentials: 'same-origin', cache: 'no-store' },
    );
    const payload = response.ok ? await response.json() : null;
    if (requestVersion !== fashionVideoCapabilityRequestVersion
      || idOfLook(selectedProfileLook) !== lookId) return;
    const ready = payload?.capability === 'fashion_video'
      && payload?.look_id === lookId
      && payload?.available === true
      && payload?.create_route === '/api/profile/video-clips'
      && payload?.requirements?.approved_master_look === true
      && payload?.requirements?.verified_style_reference === true
      && payload?.requirements?.verified_motion_reference === true
      && payload?.requirements?.verified_video_style_catalog === true
      && Array.isArray(payload?.styles)
      && payload.styles.length >= 3;
    syncFashionVideoAction(ready
      ? { state: 'ready', capability: { lookId, styles: payload.styles ?? [] } }
      : { state: 'unavailable' });
  } catch {
    if (requestVersion === fashionVideoCapabilityRequestVersion) {
      syncFashionVideoAction({ state: 'unavailable' });
    }
  }
}
function syncRealtimeLookAction({ state = 'checking', capability = null } = {}) {
  const action = document.querySelector('#profile-look-live');
  const label = document.querySelector('#profile-look-live-state');
  if (!action || !label) return;
  realtimeLookCapability = capability;
  action.dataset.state = state;
  action.classList.toggle('is-checking', state === 'checking');
  action.setAttribute('aria-busy', String(state === 'checking'));
  if (state === 'checking') realtimeLookCapabilityOrb.setState('searching');
  action.disabled = !selectedProfileLook || state !== 'ready';
  action.setAttribute(
    'aria-label',
    state === 'ready'
      ? 'Відкрити Live Look'
      : state === 'unavailable'
        ? 'Live Look тимчасово недоступний'
        : 'Перевіряємо доступність Live Look',
  );
  label.textContent = state === 'ready'
    ? capability.paidLiveReady
      ? 'Камера й AI доступні'
      : 'Камера доступна · AI тимчасово ні'
    : state === 'unavailable'
      ? 'Тимчасово недоступно'
      : 'Перевіряємо доступність';
}
async function refreshRealtimeLookCapability(look) {
  const requestVersion = ++realtimeLookCapabilityRequestVersion;
  const lookId = idOfLook(look);
  syncRealtimeLookAction({ state: lookId ? 'checking' : 'unavailable' });
  if (!lookId) return;
  try {
    const response = await fetch(
      `/api/post-shoot/realtime-look-capability?look_id=${encodeURIComponent(lookId)}`,
      { credentials: 'same-origin', cache: 'no-store' },
    );
    const payload = response.ok ? await response.json() : null;
    if (requestVersion !== realtimeLookCapabilityRequestVersion
      || idOfLook(selectedProfileLook) !== lookId) return;
    const launchUrl = typeof payload?.launch?.href === 'string'
      ? new URL(payload.launch.href, window.location.origin)
      : null;
    const ready = payload?.capability === 'REALTIME_LOOK'
      && payload?.camera_preview_ready === true
      && payload?.launch?.presentation === 'FULL_VIEWPORT'
      && payload?.launch?.target === '_self'
      && payload?.launch?.nested === false
      && payload?.launch?.internal_scroll === false
      && payload?.consent?.privacy_required === true
      && payload?.consent?.cost_required === true
      && payload?.camera?.permission_required === true
      && payload?.camera?.audio === false
      && payload?.capture?.automatic_recording === false
      && payload?.capture?.automatic_upload === false
      && launchUrl?.origin === window.location.origin;
    syncRealtimeLookAction(ready
      ? {
          state: 'ready',
          capability: {
            lookId,
            href: `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`,
            paidLiveReady: payload.paid_live_ready === true,
          },
        }
      : { state: 'unavailable' });
  } catch {
    if (requestVersion === realtimeLookCapabilityRequestVersion) {
      syncRealtimeLookAction({ state: 'unavailable' });
    }
  }
}
document.querySelector('#profile-look-background-primary').addEventListener('click', (event) => {
  event.stopPropagation();
  setLookActionStatus('Фон: обери одну стандартну сцену. Master-образ і вибрані речі залишаються locked.');
  openSelectedLookScene('standard');
});
document.querySelector('#profile-look-photoshoot').addEventListener('click', (event) => {
  event.stopPropagation();
  setLookActionStatus('Fashion Shoot: обери готовий стиль із Creative Universe. Після внутрішньої QA-перевірки отримаєш п’ять унікальних fashion-кадрів.');
  openSelectedLookScene('editorial');
});
document.querySelector('#profile-look-video').addEventListener('click', (event) => {
  event.stopPropagation();
  if (!selectedProfileLook) return;
  const lookId = idOfLook(selectedProfileLook);
  if (!lookId || fashionVideoCapability?.lookId !== lookId) return;
  const overlay = fashionVideoOverlay;
  renderFashionVideoStyles(fashionVideoCapability.styles);
  document.querySelector('#video-progress').hidden = true;
  document.querySelector('#video-result').hidden = true;
  document.querySelector('#video-error').hidden = true;
  document.querySelector('#video-retry').hidden = true;
  setVideoGenerateBusy(videoGenerationBusy);
  document.body.classList.add('profile-live-open');
  overlay.classList.remove('hidden');
  document.querySelector('#video-overlay-close').focus({ preventScroll: true });
});
function renderFashionVideoStyles(styles = []) {
  const root = document.querySelector('#video-style-options');
  const cards = styles.map((style, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'video-style-card';
    card.dataset.motionMode = style.motion_mode;
    card.dataset.styleId = style.id;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(index === 0));
    const video = document.createElement('video');
    video.src = style.playback_url;
    video.poster = style.preview_url;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.setAttribute('aria-label', `Відеореференс стилю: ${style.title}`);
    video.addEventListener('canplay', () => video.play().catch(() => {}), { once: true });
    const label = document.createElement('span');
    label.textContent = style.title;
    card.append(video, label);
    card.addEventListener('click', () => {
      root.querySelectorAll('.video-style-card').forEach((candidate) => {
        candidate.setAttribute('aria-checked', String(candidate === card));
      });
    });
    return card;
  });
  root.replaceChildren(...cards);
}
// Video overlay: close
function closeVideoOverlay() {
  document.querySelectorAll('#video-style-options video').forEach((video) => video.pause());
  fashionVideoOverlay.classList.add('hidden');
  document.body.classList.remove('profile-live-open');
}
function setVideoGenerateBusy(busy) {
  const action = document.querySelector('#video-generate');
  const thinking = document.querySelector('#video-ai-thinking');
  videoGenerationBusy = busy;
  action.disabled = busy;
  action.classList.toggle('is-loading', busy);
  action.setAttribute('aria-busy', String(busy));
  thinking.hidden = !busy;
  if (busy) setVideoThinkingState('searching', 'AI готує запуск', 'Перевіряємо reference pack');
}
function showVideoRetry(message, clipId = null) {
  const error = document.querySelector('#video-error');
  error.textContent = message;
  error.hidden = false;
  failedFashionVideoClipId = clipId;
  failedFashionVideoRetryKey = clipId ? crypto.randomUUID() : null;
  // This is an explicit user action. It may submit one new paid job; the
  // server never retries a failed QA/provider result on its own.
  document.querySelector('#video-retry').hidden = false;
}
function setVideoThinkingState(state, title, detail) {
  videoThinkingOrb.setState(state);
  document.querySelector('#video-ai-title').textContent = title;
  document.querySelector('#video-ai-detail').textContent = detail;
}
document.querySelector('#video-overlay-close').addEventListener('click', closeVideoOverlay);
document.querySelector('#video-overlay').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeVideoOverlay();
});
async function pollFashionVideo(clipId) {
  const progressFill = document.querySelector('#video-progress-fill');
  const progressStatus = document.querySelector('#video-progress-status');
  const resultEl = document.querySelector('#video-result');
  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    progressFill.style.width = `${Math.min(30 + attempts * 0.5, 92)}%`;
    try {
      const statusRes = await fetch(`/api/profile/video-clips/${clipId}`);
      if (!statusRes.ok) return;
      const status = await statusRes.json();
      progressStatus.textContent = `Статус: ${status.status}`;
      const normalizedStatus = String(status.status ?? '').toUpperCase();
      if (/QA|CHECK|VERIFY|REVIEW/.test(normalizedStatus)) {
        setVideoThinkingState('solving', 'AI перевіряє відео', 'Звіряємо образ, речі та рух');
      } else if (/GENERAT|PROCESS|RUNNING|QUEUED/.test(normalizedStatus)) {
        setVideoThinkingState('composing', 'AI збирає рух', 'Генеруємо та монтуємо fashion clip');
      } else {
        setVideoThinkingState('working', 'AI працює', 'Очікуємо наступний server checkpoint');
      }
      if (status.status === 'COMPLETED' || status.status === 'PASS') {
        clearInterval(poll);
        if (!status.video_url) {
          showVideoRetry(status.error ?? 'Відео не пройшло strict QA по кожному cut. Автоматичний повтор не запускався.', clipId);
          setVideoGenerateBusy(false);
          return;
        }
        progressFill.style.width = '100%';
        progressStatus.textContent = 'Відео готове!';
        const player = document.querySelector('#video-result-player');
        const downloadLink = document.querySelector('#video-result-download');
        player.src = status.video_url;
        downloadLink.href = status.video_url;
        resultEl.hidden = false;
        setVideoGenerateBusy(false);
      } else if (status.status === 'FAILED' || status.status === 'FAIL') {
        clearInterval(poll);
        showVideoRetry(status.error ?? 'Відео не пройшло QA. Автоматичний повтор не запускався.', clipId);
        setVideoGenerateBusy(false);
        return;
      }
    } catch (pollErr) {
      clearInterval(poll);
      showVideoRetry(pollErr.message, clipId);
      setVideoGenerateBusy(false);
    }
    if (attempts === 120) {
      // Six minutes is not a provider failure. The server owns this persisted
      // job and continues even if the tab closes, so do not issue a duplicate.
      progressFill.style.width = '92%';
      progressStatus.textContent = 'Генерація ще триває на сервері. Можна закрити вікно — результат збережеться.';
    }
  }, 3000);
}
document.querySelector('#video-retry').addEventListener('click', async () => {
  const clipId = failedFashionVideoClipId;
  const retryKey = failedFashionVideoRetryKey;
  if (!clipId || !retryKey) {
    showVideoRetry('Немає зафіксованої failed-спроби. Запусти нове відео зі стилю.');
    return;
  }
  const progressEl = document.querySelector('#video-progress');
  const progressFill = document.querySelector('#video-progress-fill');
  const progressStatus = document.querySelector('#video-progress-status');
  document.querySelector('#video-retry').hidden = true;
  setVideoGenerateBusy(true);
  progressEl.hidden = false;
  progressFill.style.width = '15%';
  progressStatus.textContent = 'Створюємо одну нову спробу з тим самим locked look і video style…';
  try {
    const response = await fetch(`/api/profile/video-clips/${clipId}/retry`, {
      method: 'POST',
      headers: { 'Idempotency-Key': retryKey },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    failedFashionVideoClipId = null;
    failedFashionVideoRetryKey = null;
    progressFill.style.width = '30%';
    progressStatus.textContent = body.reused
      ? `Відкрито вже створену спробу ${body.clip_id}…`
      : `Створено нову спробу ${body.clip_id}…`;
    pollFashionVideo(body.clip_id);
  } catch (error) {
    showVideoRetry(error.message, clipId);
    setVideoGenerateBusy(false);
  }
});
// Video overlay: generate
document.querySelector('#video-generate').addEventListener('click', async () => {
  if (!selectedProfileLook) return;
  const lookId = idOfLook(selectedProfileLook);
  const selectedStyle = document.querySelector('#video-style-options .video-style-card[aria-checked="true"]');
  const surface = 'mirror';
  const styleId = selectedStyle?.dataset.styleId;
  const motionMode = selectedStyle?.dataset.motionMode;
  const progressEl = document.querySelector('#video-progress');
  const progressFill = document.querySelector('#video-progress-fill');
  const progressStatus = document.querySelector('#video-progress-status');
  const resultEl = document.querySelector('#video-result');
  const errorEl = document.querySelector('#video-error');
  setVideoGenerateBusy(true);
  progressEl.hidden = false;
  resultEl.hidden = true;
  errorEl.hidden = true;
  document.querySelector('#video-retry').hidden = true;
  progressFill.style.width = '10%';
  progressStatus.textContent = 'Відправляємо вибраний стиль на Seedance 2…';
  try {
    if (!styleId || !motionMode) throw new Error('Обери один із трьох відеостилів.');
    const res = await fetch('/api/profile/video-clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        look_id: lookId,
        surface,
        style_id: styleId,
        motion_mode: motionMode,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.code === 'MOTION_MODE_SOURCE_MISMATCH') {
        throw new Error('Для цього руху потрібен збережений образ у повний зріст: мають бути видні ноги й взуття. Обери інший стиль або створи full-body образ.');
      }
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const clip = await res.json();
    setVideoThinkingState('composing', 'AI збирає рух', 'Створюємо fashion motion із перевірених референсів');
    progressFill.style.width = '30%';
    progressStatus.textContent = `Clip ${clip.clip_id} створено — генерація…`;
    pollFashionVideo(clip.clip_id);
  } catch (err) {
    showVideoRetry(err.message);
    setVideoGenerateBusy(false);
  }
});
document.querySelector('#profile-look-live').addEventListener('click', (event) => {
  event.stopPropagation();
  const lookId = idOfLook(selectedProfileLook);
  if (!lookId || realtimeLookCapability?.lookId !== lookId) return;
  setLookActionStatus('Live Look: переходимо в окрему camera-сесію на весь екран після явної згоди.');
  const action = document.querySelector('#profile-look-live');
  realtimeLookCapabilityOrb.setState('working');
  action.classList.add('is-loading');
  action.setAttribute('aria-busy', 'true');
  action.disabled = true;
  sessionStorage.setItem(LIVE_RETURN_FOCUS_KEY, 'armed');
  const launchUrl = new URL(realtimeLookCapability.href, window.location.origin);
  launchUrl.searchParams.set('return', 'profile');
  window.location.assign(`${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector('#video-overlay').classList.contains('hidden')) {
    closeVideoOverlay();
  }
});
window.addEventListener('pageshow', () => {
  if (sessionStorage.getItem(LIVE_RETURN_FOCUS_KEY) !== 'return') return;
  sessionStorage.removeItem(LIVE_RETURN_FOCUS_KEY);
  requestAnimationFrame(() => document.querySelector('#profile-look-live')?.focus({ preventScroll: true }));
});
document.querySelector('#profile-look-delete').addEventListener('click', async (event) => {
  event.stopPropagation();
  if (!selectedProfileLookSelection || !confirm('Видалити цей образ?')) return;
  try {
    const deletedLookId = selectedProfileLookSelection.lookId;
    await deleteProfileLook(deletedLookId);
    selectedProfileLookId = null;
    await renderProfile(await loadCurrentProfile({ refresh: true }));
  } catch (error) {
    showProfileError(error);
  }
});
document.querySelector('#add-look').addEventListener('click', async () => {
  try {
    if (activeRun?.status === 'COMPLETED') await ensureCompletedRunSaved(activeRun);
    const profile = currentProfile ?? await loadCurrentProfile({ refresh: true });
    const selection = resolveResultAddItemsSelection(profile, {
      currentAvatarId: currentResultAvatarId,
      currentLookId: currentResultLookId,
    });
    await beginDraft({
      avatar: selection.avatar,
      look: selection.look,
      outfitText: activeRun?.requested_outfit_text ?? '',
    });
  } catch (error) { showProfileError(error); }
});
document.querySelector('#create-scene').addEventListener('click', async () => {
  try {
    if (activeRun?.status === 'COMPLETED') await ensureCompletedRunSaved(activeRun);
    const profile = currentProfile ?? await loadCurrentProfile({ refresh: true });
    const look = profileLooks(profile).find((item) => (item.look_id ?? item.id) === currentResultLookId);
    if (!look) throw new Error('Спершу збережи готовий образ');
    await sceneUi.openForLook(look);
  } catch (error) { showProfileError(error); }
});
document.querySelector('#open-profile').addEventListener('click', () => renderProfile().catch(showProfileError));
document.querySelector('#god-view-trigger')?.addEventListener('click', () => {
  window.location.assign('/god-view.html');
});
document.addEventListener('keydown', (event) => {
  if (event.shiftKey && event.key.toLowerCase() === 'g') {
    event.preventDefault();
    window.location.assign('/god-view.html');
  }
});
document.querySelector('#delete-profile').addEventListener('click', async () => {
  if (!confirm('Видалити всі аватари, образи та профіль цього браузера?')) return;
  try {
    await deleteAnonymousProfile();
    currentProfile = null;
    profileLoadPromise = null;
    await beginDraft();
  } catch (error) { showProfileError(error); }
});

async function resumeRun(runId, { retryNotFound = runId === localStorage.getItem(PENDING_FINALIZATION_KEY) } = {}) {
  window.clearTimeout(resumeTimer);
  resumeTimer = null;
  if (activeRun?.run_id !== runId) renderedProgressFloor = 0;
  setWorkflowActive(true);
  resultPanelTitle.textContent = 'Pipeline';
  statusChip.textContent = 'RECONNECTING';
  statusChip.className = 'status-chip running';
  setView('progress');
  renderProgress(resolveProgressState('RESUMING'), 'Шукаємо останній server checkpoint…');
  window.ZeelyBootGuard?.ready();
  try {
    const run = await fetchRunWithRetry(runId, {
      retryNotFound,
      ...(retryNotFound ? { delays: [0, 250, 500, 1_000, 2_000] } : {}),
      onRetry: ({ attempt }) => renderProgress(
        resolveProgressState('RESUMING'),
        `Server відповідає не відразу. Повторне з’єднання №${attempt}…`,
      ),
    });
    history.replaceState({}, '', `${location.pathname}?run=${encodeURIComponent(run.run_id)}`);
    if (localStorage.getItem(PENDING_FINALIZATION_KEY) === run.run_id) localStorage.removeItem(PENDING_FINALIZATION_KEY);
    renderRun(run);
    if (!isTerminal(run)) watch(run.run_id);
    return true;
  } catch (error) {
    telemetry('client.fetch_error', { message: error.message.slice(0, 500), stage: 'resume' }, runId);
    if (error instanceof RunNotFoundError) {
      if (localStorage.getItem(ACTIVE_RUN_KEY) === runId) localStorage.removeItem(ACTIVE_RUN_KEY);
      if (activeRun?.run_id === runId) {
        activeRun = null;
        eventSource?.close();
      }
      return false;
    }
    renderProgress(resolveProgressState('RESUMING'), 'Сервер недоступний, але run не скинуто. Повторюємо з’єднання…');
    resumeTimer = window.setTimeout(async () => {
      if (!await resumeRun(runId, { retryNotFound })) initialize().catch(() => {});
    }, 5_000);
    return true;
  }
}

async function restoreDraft({ skipServer = false } = {}) {
  let localDraft = null;
  try {
    localDraft = await loadDraft();
    if (localDraft) {
      uploads.restore(localDraft);
      form.elements.outfit_text.value = localDraft.outfitText;
      draftStatus.textContent = 'Локальну чернетку відновлено';
      draftStatus.className = 'draft-status saved';
      telemetry('client.draft_restored', { ...fileSummary(uploads), stage: 'boot' });
    }
  } catch (error) {
    draftStatus.textContent = 'Локальна чернетка недоступна';
    telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'restore' });
  }
  if (skipServer) {
    renderUploads();
    return;
  }
  try {
    const hasLocalFiles = Boolean(uploads.person || uploads.identityDetail || uploads.garments.length);
    const serverDraft = await loadServerDraft({ includeFiles: !hasLocalFiles });
    setServerDraftBindings(serverDraft.bindings);
    serverDraftLineage = {
      source_avatar_id: serverDraft.manifest.source_avatar_id ?? null,
      source_look_id: serverDraft.manifest.source_look_id ?? null,
    };
    serverDraftLoaded = true;
    if (!hasLocalFiles && serverDraft.files) {
      const hasServerFiles = Boolean(serverDraft.files.person || serverDraft.files.identityDetail || serverDraft.files.garments.length);
      if (hasServerFiles) {
        uploads.restore(serverDraft.files);
        if (!localDraft?.outfitText) form.elements.outfit_text.value = serverDraft.manifest.outfit_text || '';
        await saveDraft({ ...uploads, outfitText: form.elements.outfit_text.value, generateScene: false });
        draftStatus.textContent = 'Чернетку відновлено';
        draftStatus.className = 'draft-status saved';
        telemetry('client.draft_restored', { ...fileSummary(uploads), stage: 'server_backup' });
      }
    } else if (hasLocalFiles) {
      queueServerSync(async () => {
        const { sourceAvatarId } = lineageFromStorage(localStorage);
        await reconcileServerDraftFiles({ sourceAvatarId });
      });
    }
  } catch (error) {
    telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'server_restore' });
  }
  renderUploads();
}

async function initialize() {
  telemetry('client.boot', { stage: 'start' });
  let profileUnavailable = false;
  const pendingProfile = loadCurrentProfile().catch((error) => {
    profileUnavailable = true;
    telemetry('client.profile_error', { message: error.message.slice(0, 500), stage: 'boot' });
    return null;
  });
  const pendingResetMode = localStorage.getItem(DRAFT_RESET_PENDING_KEY);
  if (pendingResetMode !== null) {
    serverDraftResetRequired = true;
    localStorage.removeItem(ACTIVE_RUN_KEY);
    localStorage.removeItem(PENDING_FINALIZATION_KEY);
    if (pendingResetMode !== 'add-items') clearAddItemsSelection(localStorage);
    history.replaceState({}, '', location.pathname);
    await clearDraft().catch(() => {});
    await resetServerDraftIfNeeded().catch((error) => {
      telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'reset_resume' });
    });
  }
  const queryParams = new URLSearchParams(location.search);
  const queryRunId = queryParams.get('run');
  const querySceneId = queryParams.get('scene');
  const queryShootId = queryParams.get('shoot');
  const storedRunId = localStorage.getItem(ACTIVE_RUN_KEY);
  const pendingRunId = localStorage.getItem(PENDING_FINALIZATION_KEY);
  const candidates = [...new Set([queryRunId, storedRunId, pendingRunId].filter(Boolean))];
  await pendingProfile;
  if ((queryShootId || querySceneId) && await sceneUi.resume({ allowStored: false })) {
    window.ZeelyBootGuard?.ready();
    telemetry('client.ready', {
      scene_id: querySceneId,
      shoot_id: queryShootId,
      stage: queryShootId ? 'editorial_shoot_resumed' : 'scene_resumed',
    });
    return;
  }
  for (const runId of candidates) {
    let lineage = lineageFromStorage(localStorage);
    if (!lineage.sourceAvatarId) {
      try {
        const currentDraft = await loadServerDraft({ includeFiles: false });
        setServerDraftBindings(currentDraft.bindings);
        serverDraftLineage = {
          source_avatar_id: currentDraft.manifest.source_avatar_id ?? null,
          source_look_id: currentDraft.manifest.source_look_id ?? null,
        };
        serverDraftLoaded = true;
        lineage = resolveStoredAddItemsLineage(localStorage, serverDraftLineage);
        if (lineage.sourceAvatarId) storeAddItemsLineage(localStorage, lineage);
      } catch (error) {
        telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'run_lineage_recovery' });
      }
    }
    await claimProfileRun(runId, lineage).catch(() => null);
    if (await resumeRun(runId, { retryNotFound: runId === pendingRunId })) {
      window.ZeelyBootGuard?.ready();
      telemetry('client.ready', { stage: 'run_resumed' }, runId);
      return;
    }
  }

  history.replaceState({}, '', location.pathname);
  setWorkflowActive(false, { reveal: false });
  await restoreDraft({ skipServer: serverDraftResetRequired });
  const profile = await pendingProfile;
  const draftLineage = resolveStoredAddItemsLineage(
    localStorage,
    serverDraftLoaded ? serverDraftLineage : null,
  );
  let storedSelection = null;
  if (profileUnavailable && draftLineage.sourceAvatarId) {
    const provisionalAvatar = {
      avatar_id: draftLineage.sourceAvatarId,
      name: 'Збережений аватар',
      image_url: `/api/profile/avatars/${encodeURIComponent(draftLineage.sourceAvatarId)}/image`,
    };
    const provisionalLook = draftLineage.sourceLookId ? {
      look_id: draftLineage.sourceLookId,
      avatar_id: draftLineage.sourceAvatarId,
    } : null;
    storedSelection = resolveAddItemsSelection({
      avatar: provisionalAvatar,
      look: provisionalLook,
    });
    storeAddItemsSelection(localStorage, storedSelection);
  } else {
    storedSelection = restoreAddItemsSelection(
      profile,
      localStorage,
      serverDraftLoaded ? serverDraftLineage : null,
    );
  }
  if (storedSelection) {
    setAvatarDraftMode(storedSelection.avatar, storedSelection.look);
    if (profileUnavailable) {
      draftStatus.textContent = 'Прив’язку до аватара збережено · очікуємо з’єднання з профілем';
      draftStatus.className = 'draft-status failed';
      formError.textContent = 'Профіль тимчасово недоступний. Аватар не скинуто й новий створювати не потрібно.';
    } else {
      draftStatus.textContent = 'Збережений аватар зафіксовано · чернетку речей відновлено';
      draftStatus.className = 'draft-status saved';
    }
  } else if (draftLineage.sourceAvatarId) {
    await renderProfile(profile);
    document.querySelector('#profile-expiry').textContent = 'Попередній аватар більше недоступний. Обери інший збережений аватар або створи новий.';
    document.documentElement.classList.remove('workflow-pending');
    window.ZeelyBootGuard?.ready();
    telemetry('client.profile_error', {
      avatar_id: draftLineage.sourceAvatarId,
      stage: 'missing_bound_avatar',
    });
    return;
  } else {
    setAvatarDraftMode();
  }
  const hasDraft = Boolean(
    storedSelection
    || uploads.person
    || uploads.identityDetail
    || uploads.garments.length
    || form.elements.outfit_text.value.trim(),
  );
  if (!hasDraft && profile?.avatars?.length) {
    await renderProfile(profile);
    document.documentElement.classList.remove('workflow-pending');
    window.ZeelyBootGuard?.ready();
    telemetry('client.ready', { avatar_count: profile.avatars.length, stage: 'profile_restored' });
    return;
  }
  if (candidates.length) formError.textContent = 'Активний run не знайдено. Збережену чернетку відновлено.';
  document.documentElement.classList.remove('workflow-pending');
  window.ZeelyBootGuard?.ready();
  telemetry('client.ready', { ...fileSummary(uploads), stage: 'complete' });
}

document.addEventListener('visibilitychange', () => telemetry('client.visibility', { stage: document.visibilityState }));
window.addEventListener('online', () => {
  telemetry('client.online', { online: true, stage: 'network' });
  const runId = activeRun?.run_id || localStorage.getItem(ACTIVE_RUN_KEY);
  if (runId && !isTerminal(activeRun)) resumeRun(runId).then((found) => { if (!found) initialize().catch(() => {}); });
});
window.addEventListener('offline', () => telemetry('client.online', { online: false, stage: 'network' }));

initialize().catch((error) => {
  formError.textContent = `Не вдалося запустити інтерфейс: ${humanizeVisibleText(error.message)}`;
  telemetry('client.error', { message: error.message.slice(0, 500), stage: 'initialize' });
  window.ZeelyBootGuard?.ready();
});
