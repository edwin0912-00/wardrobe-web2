import { createThinkingOrb } from './thinking-orb.js?v=20260722-10';
import { UploadSelectionStore } from './upload-state.js?v=20260722-8';
import { clearDraft, loadDraft, requestPersistentStorage, saveDraft } from './draft-store.js?v=20260722-10';
import { fileSummary, telemetry } from './telemetry.js?v=20260722-8';
import { prepareImageFile } from './image-upload.js?v=20260722-8';
import { clearServerDraft, createRunFromServerDraft, loadServerDraft, removeServerDraftFile, updateServerDraftMetadata, uploadDraftFile } from './server-draft.js?v=20260722-10';
import { PIPELINE_NODE_COUNT, nodeState, resolveProgressState } from './progress-model.js?v=20260722-3';
import { fetchRunWithRetry, RunNotFoundError } from './run-resume.js?v=20260722-3';
import { avatarFileFromProfile, claimProfileRun, deleteAnonymousProfile, deleteProfileAvatar, deleteProfileLook, loadProfile, saveProfileRun } from './profile-client.js?v=20260722-1';

const form = document.querySelector('#run-form');
const submit = document.querySelector('#submit-button');
const formError = document.querySelector('#form-error');
const draftStatus = document.querySelector('#draft-status');
const statusChip = document.querySelector('#status-chip');
const empty = document.querySelector('#empty-state');
const progress = document.querySelector('#progress-view');
const resultView = document.querySelector('#result-view');
const profileView = document.querySelector('#profile-view');
const failure = document.querySelector('#failure-view');
const studioShell = document.querySelector('#studio-shell');
const resultPanelTitle = document.querySelector('#result-panel-title');
const thinkingOrb = createThinkingOrb(document.querySelector('#progress-orb-canvas'));
const uploads = new UploadSelectionStore({ maxGarments: 5 });
let previewUrls = [];
let activeRun = null;
let eventSource = null;
let saveTimer = null;
let transitionTimer = null;
let serverDraftRefs = { person: null, identity: null, garments: [] };
let serverDraftResetRequired = false;
let serverSyncQueue = Promise.resolve();
let submitting = false;
let resumeTimer = null;
let sseRecovering = false;
let renderedProgressFloor = 0;
let currentProfile = null;
let currentResultAvatarId = null;
let profileLoadPromise = null;
const profileSavePromises = new Map();

const ACTIVE_RUN_KEY = 'zeely_active_run_id';
const PENDING_FINALIZATION_KEY = 'zeely_pending_finalization_id';
const DRAFT_RESET_PENDING_KEY = 'zeely_draft_reset_pending';
const SOURCE_AVATAR_KEY = 'zeely_source_avatar_id';
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'NEEDS_INPUT']);

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

function queueServerSync(task) {
  serverSyncQueue = serverSyncQueue.then(task).catch((error) => {
    draftStatus.textContent = 'Чернетку збережено лише на цьому пристрої';
    draftStatus.className = 'draft-status failed';
    telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'server_sync' });
    return null;
  });
  return serverSyncQueue;
}

async function resetServerDraftIfNeeded() {
  if (!serverDraftResetRequired && localStorage.getItem(DRAFT_RESET_PENDING_KEY) !== 'true') return;
  await clearServerDraft();
  serverDraftRefs = { person: null, identity: null, garments: [] };
  serverDraftResetRequired = false;
  localStorage.removeItem(DRAFT_RESET_PENDING_KEY);
}

async function syncFileToServer(slot, file) {
  await resetServerDraftIfNeeded();
  draftStatus.textContent = 'Зберігаємо чернетку на 15 хвилин…';
  const prepared = await prepareImageFile(file);
  if (prepared.changed) telemetry('client.file_prepared', {
    original_bytes: prepared.originalBytes, prepared_bytes: prepared.preparedBytes, stage: 'draft_backup',
  });
  const descriptor = await uploadDraftFile(slot, prepared.file, { onProgress: (loaded, total) => {
    if (!submitting || total <= 0) return;
    const uploadPercentage = Math.min(100, Math.round((loaded / total) * 100));
    const pipelinePercentage = 4 + Math.round(uploadPercentage * 0.06);
    renderProgress(
      { ...resolveProgressState('UPLOADING', pipelinePercentage), countLabel: `Файл ${uploadPercentage}%` },
      `${file.name} · завантажено ${uploadPercentage}% · ${Math.ceil(loaded / 1024 / 1024)} з ${Math.ceil(total / 1024 / 1024)} MB`,
    );
  } });
  if (slot === 'person') serverDraftRefs.person = descriptor.id;
  else if (slot === 'identity') serverDraftRefs.identity = descriptor.id;
  else serverDraftRefs.garments.push(descriptor.id);
  draftStatus.textContent = 'Чернетку збережено на 15 хвилин';
  draftStatus.className = 'draft-status saved';
}

async function ensureServerDraftComplete() {
  await serverSyncQueue;
  await resetServerDraftIfNeeded();
  const current = await loadServerDraft({ includeFiles: false });
  serverDraftRefs = current.refs;

  if (uploads.person && !serverDraftRefs.person) await syncFileToServer('person', uploads.person);
  if (uploads.identityDetail && !serverDraftRefs.identity) await syncFileToServer('identity', uploads.identityDetail);
  for (const garment of uploads.garments.slice(serverDraftRefs.garments.length)) {
    await syncFileToServer('garment', garment);
  }
  await updateServerDraftMetadata({
    outfitText: form.elements.outfit_text.value,
    generateScene: false,
  });

  if (!serverDraftRefs.person) throw new Error('Фото людини не збережено на сервері');
  if (uploads.identityDetail && !serverDraftRefs.identity) throw new Error('Identity detail не збережено на сервері');
  if (serverDraftRefs.garments.length !== uploads.garments.length) throw new Error('Не всі фото одягу збережено на сервері');
}

function fileLabel(input, count, filename = '') {
  const label = document.querySelector(`[data-for="${input.id}"]`);
  if (!label) return;
  if (input.id === 'garment-images') label.textContent = count ? `${count} з 5 файлів` : 'Додати гардероб';
  else label.textContent = filename || 'Обрати файл';
}

function previewItem(file, onRemove) {
  const item = document.createElement('article');
  item.className = 'selected-file';
  const image = document.createElement('img');
  const url = URL.createObjectURL(file);
  previewUrls.push(url);
  image.src = url;
  image.alt = file.name;
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
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  const personPreview = document.querySelector('#person-preview');
  const identityPreview = document.querySelector('#identity-preview');
  const garmentPreview = document.querySelector('#garment-preview');
  personPreview.replaceChildren();
  identityPreview.replaceChildren();
  garmentPreview.replaceChildren();

  if (uploads.person) personPreview.append(previewItem(uploads.person, () => removeFile('person')));
  if (uploads.identityDetail) identityPreview.append(previewItem(uploads.identityDetail, () => removeFile('identity')));
  uploads.garments.forEach((file, index) => garmentPreview.append(previewItem(file, () => removeFile('garment', index))));

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
    queueServerSync(() => updateServerDraftMetadata({
      outfitText: form.elements.outfit_text.value,
      generateScene: false,
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

function removeFile(kind, index) {
  let serverId;
  if (kind === 'person') { serverId = serverDraftRefs.person; serverDraftRefs.person = null; uploads.setPerson(null); }
  else if (kind === 'identity') { serverId = serverDraftRefs.identity; serverDraftRefs.identity = null; uploads.setIdentityDetail(null); }
  else { serverId = serverDraftRefs.garments[index]; serverDraftRefs.garments.splice(index, 1); uploads.removeGarment(index); }
  queueServerSync(() => removeServerDraftFile(kind, serverId));
  renderUploads();
  telemetry('client.file_removed', { ...fileSummary(uploads), stage: kind });
  persistDraft(`remove_${kind}`);
}

async function handleSelected(kind, files) {
  try {
    let additions;
    if (kind === 'person') { uploads.setPerson(files[0]); additions = [files[0]]; }
    else if (kind === 'identity') { uploads.setIdentityDetail(files[0]); additions = [files[0]]; }
    else {
      const previousCount = uploads.garments.length;
      uploads.addGarments(files);
      additions = uploads.garments.slice(previousCount);
    }
    formError.textContent = '';
    renderUploads();
    telemetry('client.file_selected', { ...fileSummary(uploads), stage: kind });
    requestPersistentStorage().catch(() => false);
    await persistDraft(`select_${kind}`);
    for (const file of additions) await queueServerSync(() => syncFileToServer(kind, file));
  } catch (error) {
    formError.textContent = error.message;
    telemetry('client.error', { message: error.message.slice(0, 500), stage: `select_${kind}` });
  }
}

document.querySelector('#person-photo').addEventListener('change', (event) => {
  handleSelected('person', event.target.files);
  event.target.value = '';
});
document.querySelector('#identity-detail').addEventListener('change', (event) => {
  handleSelected('identity', event.target.files);
  event.target.value = '';
});
document.querySelector('#garment-images').addEventListener('change', (event) => {
  handleSelected('garment', event.target.files);
  event.target.value = '';
});
form.elements.outfit_text.addEventListener('input', () => scheduleDraftSave('outfit_text'));

function setWorkflowActive(active) {
  document.documentElement.classList.remove('workflow-pending');
  document.body.classList.toggle('workflow-active', active);
  studioShell.dataset.screen = active ? 'pipeline' : 'input';
}

function setView(name) {
  const views = { empty, progress, result: resultView, profile: profileView, failure };
  document.querySelector('.result-panel').dataset.view = name;
  for (const [viewName, element] of Object.entries(views)) {
    const selected = viewName === name;
    element.classList.toggle('hidden', !selected);
    element.classList.remove('view-enter');
    if (selected) requestAnimationFrame(() => element.classList.add('view-enter'));
  }
}

function renderProgress(state, message) {
  const requested = state?.percent == null ? resolveProgressState(state?.key) : state;
  const normalized = { ...requested, percent: Math.max(renderedProgressFloor, requested.percent) };
  renderedProgressFloor = normalized.percent;
  document.querySelector('#progress-stage').textContent = `${normalized.percent}%`;
  document.querySelector('#progress-count').textContent = normalized.countLabel || `Етап ${normalized.step + 1} з ${PIPELINE_NODE_COUNT}`;
  document.querySelector('#progress-title').textContent = normalized.title;
  document.querySelector('#progress-message').textContent = message || 'Очікуємо підтвердження сервера…';
  const progressTrack = document.querySelector('#progress-track');
  progressTrack.setAttribute('aria-valuenow', String(normalized.percent));
  document.querySelector('#progress-bar').style.width = `${normalized.percent}%`;
  const orbState = normalized.step <= 0 ? 'listening' : normalized.step <= 2 ? 'searching' : normalized.step === 3 ? 'composing' : normalized.step <= 5 ? 'solving' : 'shaping';
  thinkingOrb.setState(orbState);
  document.querySelectorAll('#pipeline-nodes li').forEach((item, index) => {
    const status = nodeState(index, normalized.step);
    item.classList.toggle('active', status === 'active');
    item.classList.toggle('done', status === 'done');
    item.classList.toggle('pending', status === 'pending');
    if (status === 'active') item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
}

function renderRun(run) {
  if (activeRun?.run_id === run.run_id && Date.parse(run.updated_at) < Date.parse(activeRun.updated_at)) return;
  if (activeRun?.run_id !== run.run_id) renderedProgressFloor = 0;
  activeRun = run;
  setWorkflowActive(true);
  localStorage.setItem(ACTIVE_RUN_KEY, run.run_id);
  const hasSelectableConflict = run.status === 'NEEDS_INPUT' && (run.conflicts || []).some((item) => item.type === 'DUPLICATE_SLOT');
  statusChip.textContent = hasSelectableConflict ? 'ПОТРІБЕН ВИБІР' : run.status.replaceAll('_', ' ');
  statusChip.className = `status-chip ${hasSelectableConflict ? 'choice' : run.status === 'COMPLETED' ? 'completed' : run.status === 'FAILED' || run.status === 'NEEDS_INPUT' ? 'failed' : 'running'}`;
  if (run.status === 'COMPLETED') {
    resultPanelTitle.textContent = 'Результат';
    setView('result');
    renderResults(run);
    submit.disabled = false;
    eventSource?.close();
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    return;
  }
  if (run.status === 'FAILED' || run.status === 'NEEDS_INPUT') {
    resultPanelTitle.textContent = hasSelectableConflict ? 'Вибір' : 'Pipeline';
    setView('failure');
    failure.classList.toggle('choice', hasSelectableConflict);
    document.querySelector('.failure-mark').textContent = hasSelectableConflict ? '?' : '!';
    document.querySelector('#failure-title').textContent = hasSelectableConflict ? 'Обери річ для образу' : run.status === 'NEEDS_INPUT' ? 'Потрібен кращий input' : 'Run зупинено';
    document.querySelector('#failure-message').textContent = hasSelectableConflict ? 'Знайдено кілька різних речей одного типу. Обери одну — pipeline продовжить цей самий run.' : run.message || run.error?.message || 'Unknown error';
    renderConflictPicker(run);
    document.querySelector('#retry-run').classList.toggle('hidden', hasSelectableConflict);
    submit.disabled = false;
    eventSource?.close();
    return;
  }
  resultPanelTitle.textContent = 'Pipeline';
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
    heading.textContent = conflict.category === 'footwear' ? 'Оберіть одну пару взуття' : `Оберіть один варіант: ${categoryNames[conflict.category] || conflict.category}`;
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
      image.alt = garment.observed?.garment_type || conflict.category;
      const label = document.createElement('span');
      label.textContent = garment.observed?.garment_type || conflict.category;
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
      document.querySelector('#failure-message').textContent = error.message;
      continueButton.disabled = false;
    }
  });
  picker.append(continueButton);
}

function profileValue(value) {
  return value?.profile ?? value ?? { avatars: [], looks: [] };
}

function avatarId(avatar) {
  return avatar?.id ?? avatar?.avatar_id ?? null;
}

function avatarImageUrl(avatar) {
  return avatar?.image_url ?? (avatarId(avatar) ? `/api/profile/avatars/${encodeURIComponent(avatarId(avatar))}/image` : '');
}

function profileLooks(profile) {
  if (Array.isArray(profile?.looks)) return profile.looks;
  return (profile?.avatars ?? []).flatMap((avatar) => (avatar.looks ?? []).map((look) => ({ ...look, avatar_id: avatarId(avatar) })));
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
  const sourceAvatarId = localStorage.getItem(SOURCE_AVATAR_KEY);
  const operation = (async () => {
    await claimProfileRun(run.run_id, sourceAvatarId);
    const response = await saveProfileRun(run.run_id);
    currentProfile = profileValue(response);
    profileLoadPromise = Promise.resolve(currentProfile);
    const avatars = currentProfile.avatars ?? [];
    const savedAvatarId = response?.avatar_id ?? response?.avatar?.avatar_id ?? response?.avatar?.id ?? sourceAvatarId
      ?? avatarId(avatars.find((avatar) => avatar.source_run_id === run.run_id))
      ?? avatarId(avatars.at(0));
    currentResultAvatarId = savedAvatarId;
    const selected = avatars.find((avatar) => avatarId(avatar) === savedAvatarId);
    document.querySelector('#result-avatar-name').textContent = selected?.name || `Avatar ${String(Math.max(1, avatars.findIndex((avatar) => avatarId(avatar) === savedAvatarId) + 1)).padStart(2, '0')}`;
    const expiry = currentProfile.expires_at ?? response?.expires_at;
    document.querySelector('#result-profile-expiry').textContent = formatProfileExpiry(expiry);
    saveState.textContent = 'QA passed · Saved';
    saveState.onclick = null;
    saveState.classList.remove('saving', 'failed');
    localStorage.removeItem(SOURCE_AVATAR_KEY);
    if (localStorage.getItem(ACTIVE_RUN_KEY) === run.run_id) localStorage.removeItem(ACTIVE_RUN_KEY);
    if (new URLSearchParams(location.search).get('run') === run.run_id) history.replaceState({}, '', location.pathname);
    telemetry('client.profile_saved', { avatar_id: savedAvatarId, stage: 'completed_run' }, run.run_id);
    return currentProfile;
  })().catch((error) => {
    profileSavePromises.delete(run.run_id);
    saveState.textContent = 'Профіль не збережено · повторити';
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

async function beginDraft({ avatar = null } = {}) {
  form.inert = true;
  form.setAttribute('aria-busy', 'true');
  try {
    eventSource?.close();
    window.clearTimeout(transitionTimer);
    window.clearTimeout(resumeTimer);
    activeRun = null;
    renderedProgressFloor = 0;
    form.reset();
    uploads.reset();
    renderUploads();
    localStorage.removeItem(ACTIVE_RUN_KEY);
    localStorage.removeItem(PENDING_FINALIZATION_KEY);
    serverDraftResetRequired = true;
    localStorage.setItem(DRAFT_RESET_PENDING_KEY, 'true');
    if (avatar) localStorage.setItem(SOURCE_AVATAR_KEY, avatarId(avatar));
    else localStorage.removeItem(SOURCE_AVATAR_KEY);
    history.replaceState({}, '', location.pathname);
    resultPanelTitle.textContent = 'Pipeline';
    statusChip.textContent = 'Очікує input';
    statusChip.className = 'status-chip idle';
    setView('empty');
    setWorkflowActive(false);
    const serverCleared = clearServerDraft().then(() => true).catch(() => false);
    const [, didClearServer] = await Promise.all([clearDraft().catch(() => {}), serverCleared]);
    serverDraftRefs = { person: null, identity: null, garments: [] };
    serverDraftResetRequired = !didClearServer;
    if (didClearServer) localStorage.removeItem(DRAFT_RESET_PENDING_KEY);

    if (avatar) {
      const file = await avatarFileFromProfile({ ...avatar, image_url: avatarImageUrl(avatar) });
      uploads.setPerson(file);
      renderUploads();
      await saveDraft({ ...uploads, outfitText: '', generateScene: false });
      await queueServerSync(() => syncFileToServer('person', file));
      draftStatus.textContent = 'Збережений аватар готовий · додай нові речі';
    } else {
      draftStatus.textContent = 'Новий порожній avatar draft';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    (avatar ? form.elements.outfit_text : document.querySelector('#person-photo')).focus();
  } finally {
    form.inert = false;
    form.removeAttribute('aria-busy');
    submit.disabled = false;
  }
}

async function renderProfile(profileValueToRender = null) {
  const profile = profileValue(profileValueToRender ?? await loadCurrentProfile({ refresh: true }));
  currentProfile = profile;
  const avatars = profile.avatars ?? [];
  const looks = profileLooks(profile);
  document.querySelector('#profile-expiry').textContent = formatProfileExpiry(profile.expires_at);
  const avatarList = document.querySelector('#profile-avatar-list');
  const lookGrid = document.querySelector('#profile-look-grid');
  avatarList.replaceChildren();
  lookGrid.replaceChildren();

  avatars.forEach((avatar, index) => {
    const card = document.createElement('article');
    card.className = 'profile-avatar-item';
    const image = document.createElement('img');
    image.src = avatarImageUrl(avatar);
    image.alt = avatar.name || `Avatar ${index + 1}`;
    const meta = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = avatar.name || `Avatar ${String(index + 1).padStart(2, '0')}`;
    const count = document.createElement('small');
    count.textContent = `${looks.filter((look) => (look.avatar_id ?? look.avatarId) === avatarId(avatar)).length} образів`;
    const actions = document.createElement('div');
    actions.className = 'profile-item-actions';
    actions.append(
      createProfileButton('Додати речі', 'primary-result-action', () => beginDraft({ avatar }).catch(showProfileError)),
      createProfileButton('Видалити', 'profile-delete-action', async () => {
        if (!confirm('Видалити цей аватар і всі пов’язані образи?')) return;
        await deleteProfileAvatar(avatarId(avatar));
        await renderProfile(await loadCurrentProfile({ refresh: true }));
      }),
    );
    meta.append(title, count, actions);
    card.append(image, meta);
    avatarList.append(card);
  });

  looks.forEach((look, index) => {
    const lookId = look.id ?? look.look_id;
    const card = document.createElement('article');
    card.className = 'profile-look-card';
    const image = document.createElement('img');
    image.src = look.image_url ?? `/api/profile/looks/${encodeURIComponent(lookId)}/image`;
    image.alt = look.name || `Збережений образ ${index + 1}`;
    const meta = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = look.name || `Look ${String(index + 1).padStart(2, '0')}`;
    const remove = createProfileButton('×', 'profile-delete-action', async () => {
      if (!confirm('Видалити цей образ?')) return;
      await deleteProfileLook(lookId);
      await renderProfile(await loadCurrentProfile({ refresh: true }));
    });
    remove.setAttribute('aria-label', `Видалити ${title.textContent}`);
    meta.append(title, remove);
    card.append(image, meta);
    lookGrid.append(card);
  });

  if (!avatars.length) {
    const emptyProfile = document.createElement('div');
    emptyProfile.className = 'profile-empty';
    emptyProfile.textContent = 'Збережених аватарів поки немає.';
    avatarList.append(emptyProfile);
  }
  if (!looks.length) {
    const emptyLooks = document.createElement('div');
    emptyLooks.className = 'profile-empty';
    emptyLooks.textContent = 'Перший образ з’явиться тут після генерації.';
    lookGrid.append(emptyLooks);
  }
  resultPanelTitle.textContent = 'Мій профіль';
  statusChip.textContent = 'SAVED';
  statusChip.className = 'status-chip completed';
  setWorkflowActive(true);
  setView('profile');
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function showProfileError(error) {
  formError.textContent = error.message;
  telemetry('client.profile_error', { message: error.message.slice(0, 500), stage: 'action' });
}

function renderResults(run) {
  const passports = document.querySelector('#passport-list');
  passports.replaceChildren();
  (run.garments || []).forEach((item) => {
    const element = document.createElement('span');
    element.className = 'passport';
    element.textContent = `${item.category} · ${Math.round(item.confidence * 100)}%`;
    passports.append(element);
  });
  const items = [
    ['avatar_outfit', 'Образ'],
    ['avatar', 'Аватар'],
    ['art_director_scene', 'Editorial'],
  ].filter(([key]) => run.outputs[key]).map(([key, label]) => ({ key, label, url: run.outputs[key] }));
  const activeImage = document.querySelector('#active-result-image');
  const activeLabel = document.querySelector('#active-result-label');
  const activeDownload = document.querySelector('#active-result-download');
  const tabs = document.querySelector('#result-tabs');
  tabs.replaceChildren();

  const activate = (selected) => {
    activeImage.src = selected.url;
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
    thumb.src = item.url;
    thumb.alt = '';
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(thumb, label);
    button.addEventListener('click', () => activate(item));
    tabs.append(button);
  }

  const avatarUrl = run.outputs.avatar || run.outputs.avatar_outfit;
  const avatarPreview = document.querySelector('#profile-avatar-preview');
  avatarPreview.src = avatarUrl;
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
          'Зв’язок із сервером перепідключається. Run не зупинено.',
        );
      }
    } finally {
      sseRecovering = false;
    }
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  const outfitText = form.elements.outfit_text.value.trim();
  if (!uploads.person) { formError.textContent = 'Додай фото людини.'; return; }
  if (!outfitText && uploads.garments.length === 0) { formError.textContent = 'Додай опис образу або хоча б одне фото речі.'; return; }
  if (!form.elements.consent.checked) { formError.textContent = 'Потрібна згода на обробку фото.'; return; }

  submit.disabled = true;
  submitting = true;
  renderedProgressFloor = 0;
  setWorkflowActive(true);
  resultPanelTitle.textContent = 'Pipeline';
  statusChip.textContent = 'RUNNING';
  statusChip.className = 'status-chip running';
  setView('progress');
  window.clearTimeout(transitionTimer);
  transitionTimer = window.setTimeout(() => studioShell.scrollIntoView({ behavior: 'smooth', block: 'start' }), 720);
  const startedAt = performance.now();
  let finalizationId = null;
  telemetry('client.submit', { ...fileSummary(uploads), stage: 'draft_finalize' });
  try {
    renderProgress(resolveProgressState('PREPARING'), 'Перевіряємо збереження всіх файлів…');
    await ensureServerDraftComplete();
    renderProgress(resolveProgressState('UPLOADED'), 'Файли на сервері. Створюємо immutable run…');
    finalizationId = localStorage.getItem(PENDING_FINALIZATION_KEY) || createFinalizationId();
    localStorage.setItem(PENDING_FINALIZATION_KEY, finalizationId);
    localStorage.setItem(ACTIVE_RUN_KEY, finalizationId);
    history.replaceState({}, '', `${location.pathname}?run=${encodeURIComponent(finalizationId)}`);
    const body = await createRunFromServerDraft(finalizationId, {
      sourceAvatarId: localStorage.getItem(SOURCE_AVATAR_KEY),
    });
    localStorage.removeItem(PENDING_FINALIZATION_KEY);
    telemetry('client.submit_response', { status: 202, duration_ms: Math.round(performance.now() - startedAt), stage: 'run_created_from_draft' }, body.run_id);
    history.replaceState({}, '', `${location.pathname}?run=${encodeURIComponent(body.run_id)}`);
    renderRun(body);
    watch(body.run_id);
  } catch (error) {
    telemetry('client.fetch_error', { message: error.message.slice(0, 500), duration_ms: Math.round(performance.now() - startedAt), stage: 'create_run' });
    if (finalizationId && await resumeRun(finalizationId, { retryNotFound: true })) return;
    window.clearTimeout(transitionTimer);
    if (localStorage.getItem(ACTIVE_RUN_KEY) === finalizationId) localStorage.removeItem(ACTIVE_RUN_KEY);
    history.replaceState({}, '', location.pathname);
    formError.textContent = `${error.message}. Файли залишилися в локальній чернетці.`;
    submit.disabled = false;
    statusChip.textContent = 'Завантаження не завершено';
    statusChip.className = 'status-chip failed';
    setView('empty');
    setWorkflowActive(false);
  } finally {
    submitting = false;
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
    document.querySelector('#failure-message').textContent = error.message;
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
  statusChip.textContent = 'Очікує input';
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

document.querySelector('#new-avatar').addEventListener('click', () => beginDraft().catch(showProfileError));
document.querySelector('#profile-new-avatar').addEventListener('click', () => beginDraft().catch(showProfileError));
document.querySelector('#add-look').addEventListener('click', async () => {
  try {
    if (activeRun?.status === 'COMPLETED') await ensureCompletedRunSaved(activeRun);
    const profile = currentProfile ?? await loadCurrentProfile({ refresh: true });
    const avatar = (profile.avatars ?? []).find((item) => avatarId(item) === currentResultAvatarId) ?? profile.avatars?.at(-1);
    if (!avatar) throw new Error('Спершу збережи готовий аватар');
    await beginDraft({ avatar });
  } catch (error) { showProfileError(error); }
});
document.querySelector('#open-profile').addEventListener('click', () => renderProfile().catch(showProfileError));
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
    serverDraftRefs = serverDraft.refs;
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
        if (uploads.person && !serverDraftRefs.person) await syncFileToServer('person', uploads.person);
        if (uploads.identityDetail && !serverDraftRefs.identity) await syncFileToServer('identity', uploads.identityDetail);
        for (const garment of uploads.garments.slice(serverDraftRefs.garments.length)) await syncFileToServer('garment', garment);
      });
    }
  } catch (error) {
    telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'server_restore' });
  }
  renderUploads();
}

async function initialize() {
  telemetry('client.boot', { stage: 'start' });
  const pendingProfile = loadCurrentProfile().catch((error) => {
    telemetry('client.profile_error', { message: error.message.slice(0, 500), stage: 'boot' });
    return null;
  });
  if (localStorage.getItem(DRAFT_RESET_PENDING_KEY) === 'true') {
    serverDraftResetRequired = true;
    localStorage.removeItem(ACTIVE_RUN_KEY);
    localStorage.removeItem(PENDING_FINALIZATION_KEY);
    history.replaceState({}, '', location.pathname);
    await clearDraft().catch(() => {});
    await resetServerDraftIfNeeded().catch((error) => {
      telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'reset_resume' });
    });
  }
  const queryRunId = new URLSearchParams(location.search).get('run');
  const storedRunId = localStorage.getItem(ACTIVE_RUN_KEY);
  const pendingRunId = localStorage.getItem(PENDING_FINALIZATION_KEY);
  const candidates = [...new Set([queryRunId, storedRunId, pendingRunId].filter(Boolean))];
  await pendingProfile;
  for (const runId of candidates) {
    await claimProfileRun(runId, localStorage.getItem(SOURCE_AVATAR_KEY)).catch(() => null);
    if (await resumeRun(runId, { retryNotFound: runId === pendingRunId })) {
      window.ZeelyBootGuard?.ready();
      telemetry('client.ready', { stage: 'run_resumed' }, runId);
      return;
    }
  }

  history.replaceState({}, '', location.pathname);
  setWorkflowActive(false);
  await restoreDraft({ skipServer: serverDraftResetRequired });
  const profile = await pendingProfile;
  const hasDraft = Boolean(uploads.person || uploads.identityDetail || uploads.garments.length || form.elements.outfit_text.value.trim());
  if (!hasDraft && profile?.avatars?.length) {
    await renderProfile(profile);
    window.ZeelyBootGuard?.ready();
    telemetry('client.ready', { avatar_count: profile.avatars.length, stage: 'profile_restored' });
    return;
  }
  if (candidates.length) formError.textContent = 'Активний run не знайдено. Збережену чернетку відновлено.';
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
  formError.textContent = `Не вдалося запустити інтерфейс: ${error.message}`;
  telemetry('client.error', { message: error.message.slice(0, 500), stage: 'initialize' });
  window.ZeelyBootGuard?.ready();
});
