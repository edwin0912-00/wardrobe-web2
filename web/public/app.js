import { createThinkingOrb } from './thinking-orb.js?v=20260722-8';
import { UploadSelectionStore } from './upload-state.js?v=20260722-8';
import { clearDraft, loadDraft, requestPersistentStorage, saveDraft } from './draft-store.js?v=20260722-8';
import { fileSummary, telemetry } from './telemetry.js?v=20260722-8';
import { prepareImageFile } from './image-upload.js?v=20260722-8';
import { clearServerDraft, createRunFromServerDraft, loadServerDraft, removeServerDraftFile, updateServerDraftMetadata, uploadDraftFile } from './server-draft.js?v=20260722-8';

const form = document.querySelector('#run-form');
const submit = document.querySelector('#submit-button');
const formError = document.querySelector('#form-error');
const draftStatus = document.querySelector('#draft-status');
const statusChip = document.querySelector('#status-chip');
const empty = document.querySelector('#empty-state');
const progress = document.querySelector('#progress-view');
const resultView = document.querySelector('#result-view');
const failure = document.querySelector('#failure-view');
const thinkingOrb = createThinkingOrb(document.querySelector('#progress-orb-canvas'));
const uploads = new UploadSelectionStore({ maxGarments: 5 });
let previewUrls = [];
let activeRun = null;
let eventSource = null;
let saveTimer = null;
let serverDraftRefs = { person: null, identity: null, garments: [] };
let serverSyncQueue = Promise.resolve();
let submitting = false;

function queueServerSync(task) {
  serverSyncQueue = serverSyncQueue.then(task).catch((error) => {
    draftStatus.textContent = 'Чернетку збережено лише на цьому пристрої';
    draftStatus.className = 'draft-status failed';
    telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'server_sync' });
    return null;
  });
  return serverSyncQueue;
}

async function syncFileToServer(slot, file) {
  draftStatus.textContent = 'Зберігаємо чернетку на 15 хвилин…';
  const prepared = await prepareImageFile(file);
  if (prepared.changed) telemetry('client.file_prepared', {
    original_bytes: prepared.originalBytes, prepared_bytes: prepared.preparedBytes, stage: 'draft_backup',
  });
  const descriptor = await uploadDraftFile(slot, prepared.file, { onProgress: (loaded, total) => {
    if (!submitting || total <= 0) return;
    const percentage = Math.min(100, Math.round((loaded / total) * 100));
    renderProgress(
      { ...progressStates.UPLOADING, label: `${percentage}%` },
      `${file.name} · ${Math.ceil(loaded / 1024 / 1024)} з ${Math.ceil(total / 1024 / 1024)} MB`,
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
  const current = await loadServerDraft({ includeFiles: false });
  serverDraftRefs = current.refs;

  if (uploads.person && !serverDraftRefs.person) await syncFileToServer('person', uploads.person);
  if (uploads.identityDetail && !serverDraftRefs.identity) await syncFileToServer('identity', uploads.identityDetail);
  for (const garment of uploads.garments.slice(serverDraftRefs.garments.length)) {
    await syncFileToServer('garment', garment);
  }
  await updateServerDraftMetadata({
    outfitText: form.elements.outfit_text.value,
    generateScene: form.elements.generate_scene.checked,
  });

  if (!serverDraftRefs.person) throw new Error('Фото людини не збережено на сервері');
  if (uploads.identityDetail && !serverDraftRefs.identity) throw new Error('Identity detail не збережено на сервері');
  if (serverDraftRefs.garments.length !== uploads.garments.length) throw new Error('Не всі фото одягу збережено на сервері');
}

const progressStates = {
  PREPARING: { label: 'ГОТУЄМО', step: 0, title: 'Готуємо файли' },
  UPLOADING: { label: '0%', step: 0, title: 'Завантажуємо файли' },
  UPLOADED: { label: '1 / 8', step: 0, title: 'Input прийнято сервером' },
  RECEIVED: { label: '1 / 8', step: 0, title: 'Створення immutable job' },
  VALIDATING: { label: '1 / 8', step: 0, title: 'Валідація матеріалів' },
  GARMENT_CONDITIONING: { label: '2 / 8', step: 1, title: 'Підготовка garment references' },
  GARMENT_GROUPING: { label: '2 / 8', step: 1, title: 'Групуємо ракурси речей' },
  GARMENT_GENERATING: { label: '2 / 8', step: 1, title: 'Створюємо canonical garment' },
  GARMENT_QA: { label: '3 / 8', step: 2, title: 'Перевіряємо canonical garment' },
  CONDITIONING_IDENTITY: { label: '2 / 8', step: 1, title: 'Identity conditioning' },
  CONDITIONING_OUTFIT: { label: '2 / 8', step: 1, title: 'Outfit conditioning' },
  CONDITIONING_RETRY: { label: '2 / 8', step: 1, title: 'Повторна підготовка references' },
  CONDITIONING_QA: { label: '3 / 8', step: 2, title: 'QA підготовлених references' },
  REFERENCES_READY: { label: '3 / 8', step: 2, title: 'References готові' },
  GENERATING_AVATAR: { label: '4 / 8', step: 3, title: 'Генерація base avatar' },
  AVATAR_RETRY: { label: '4 / 8', step: 3, title: 'Повторна генерація avatar' },
  AVATAR_QA: { label: '5 / 8', step: 4, title: 'Identity та технічний QA' },
  AVATAR_READY: { label: '5 / 8', step: 4, title: 'Base avatar затверджено' },
  GENERATING_OUTFIT: { label: '6 / 8', step: 5, title: 'Генерація повного образу' },
  OUTFIT_RETRY: { label: '6 / 8', step: 5, title: 'Повторна генерація outfit' },
  OUTFIT_QA: { label: '6 / 8', step: 5, title: 'Garment fidelity QA' },
  OUTFIT_READY: { label: '6 / 8', step: 5, title: 'Outfit затверджено' },
  OPTIONAL_SCENE: { label: '7 / 8', step: 6, title: 'Art Director scene' },
  EXPORTING: { label: '8 / 8', step: 7, title: 'Експорт PNG і manifest' },
  COMPLETED: { label: '8 / 8', step: 7, title: 'Результат готовий' },
};

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
      generateScene: form.elements.generate_scene.checked,
    });
    draftStatus.textContent = 'Чернетку збережено на цьому пристрої';
    draftStatus.className = 'draft-status saved';
    telemetry('client.draft_saved', { ...fileSummary(uploads), stage: reason });
    queueServerSync(() => updateServerDraftMetadata({
      outfitText: form.elements.outfit_text.value,
      generateScene: form.elements.generate_scene.checked,
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
form.elements.generate_scene.addEventListener('change', () => persistDraft('generate_scene'));

function setView(name) {
  empty.classList.toggle('hidden', name !== 'empty');
  progress.classList.toggle('hidden', name !== 'progress');
  resultView.classList.toggle('hidden', name !== 'result');
  failure.classList.toggle('hidden', name !== 'failure');
}

function renderProgress(state, message) {
  document.querySelector('#progress-stage').textContent = state.label;
  document.querySelector('#progress-title').textContent = state.title;
  document.querySelector('#progress-message').textContent = message || 'Очікуємо підтвердження сервера…';
  const orbState = state.step <= 0 ? 'listening' : state.step <= 2 ? 'searching' : state.step === 3 ? 'composing' : state.step <= 5 ? 'solving' : state.step === 6 ? 'working' : 'shaping';
  thinkingOrb.setState(orbState);
  document.querySelectorAll('#timeline li').forEach((item, index) => {
    item.classList.toggle('active', index === state.step);
    item.classList.toggle('done', index < state.step);
    if (index === state.step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
}

function renderRun(run) {
  activeRun = run;
  localStorage.setItem('zeely_active_run_id', run.run_id);
  const hasSelectableConflict = run.status === 'NEEDS_INPUT' && (run.conflicts || []).some((item) => item.type === 'DUPLICATE_SLOT');
  statusChip.textContent = hasSelectableConflict ? 'ПОТРІБЕН ВИБІР' : run.status.replaceAll('_', ' ');
  statusChip.className = `status-chip ${hasSelectableConflict ? 'choice' : run.status === 'COMPLETED' ? 'completed' : run.status === 'FAILED' || run.status === 'NEEDS_INPUT' ? 'failed' : 'running'}`;
  if (run.status === 'COMPLETED') {
    setView('result');
    renderResults(run);
    submit.disabled = false;
    eventSource?.close();
    return;
  }
  if (run.status === 'FAILED' || run.status === 'NEEDS_INPUT') {
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
  setView('progress');
  renderProgress(progressStates[run.inner_state] ?? progressStates[run.phase] ?? { label: 'LIVE', step: 2, title: 'Pipeline працює' }, run.message);
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

function renderResults(run) {
  const passports = document.querySelector('#passport-list');
  passports.replaceChildren();
  (run.garments || []).forEach((item) => {
    const element = document.createElement('span');
    element.className = 'passport';
    element.textContent = `${item.category} · ${Math.round(item.confidence * 100)}%`;
    passports.append(element);
  });
  const gallery = document.querySelector('#result-gallery');
  gallery.replaceChildren();
  [['avatar', 'Base avatar'], ['avatar_outfit', 'Full look'], ['art_director_scene', 'Art Director scene']].forEach(([key, label]) => {
    if (!run.outputs[key]) return;
    const card = document.createElement('article');
    card.className = `result-card ${key === 'art_director_scene' ? 'scene' : ''}`;
    const image = document.createElement('img');
    image.src = `${run.outputs[key]}?v=${Date.now()}`;
    image.alt = label;
    const meta = document.createElement('div');
    meta.className = 'result-meta';
    const strong = document.createElement('strong');
    strong.textContent = label;
    const link = document.createElement('a');
    link.href = run.outputs[key]; link.download = ''; link.textContent = 'Download PNG ↓';
    meta.append(strong, link); card.append(image, meta); gallery.append(card);
  });
}

function watch(runId) {
  eventSource?.close();
  eventSource = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  eventSource.onopen = () => telemetry('client.sse_open', { stage: 'run' }, runId);
  eventSource.addEventListener('run', (event) => {
    const run = JSON.parse(event.data);
    telemetry('client.run_event', { status: run.status, stage: run.inner_state || run.phase }, runId);
    renderRun(run);
  });
  eventSource.onerror = async () => {
    telemetry('client.sse_error', { stage: 'run' }, runId);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      if (response.ok) renderRun(await response.json());
    } catch (error) {
      telemetry('client.fetch_error', { message: error.message.slice(0, 500), stage: 'run_poll' }, runId);
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
  setView('progress');
  const startedAt = performance.now();
  telemetry('client.submit', { ...fileSummary(uploads), stage: 'draft_finalize' });
  try {
    renderProgress(progressStates.PREPARING, 'Перевіряємо збереження всіх файлів…');
    await ensureServerDraftComplete();
    renderProgress(progressStates.UPLOADED, 'Файли на сервері. Створюємо run…');
    const body = await createRunFromServerDraft();
    telemetry('client.submit_response', { status: 202, duration_ms: Math.round(performance.now() - startedAt), stage: 'run_created_from_draft' }, body.run_id);
    history.replaceState({}, '', `${location.pathname}?run=${encodeURIComponent(body.run_id)}`);
    renderRun(body);
    watch(body.run_id);
  } catch (error) {
    telemetry('client.fetch_error', { message: error.message.slice(0, 500), duration_ms: Math.round(performance.now() - startedAt), stage: 'create_run' });
    formError.textContent = `${error.message}. Файли залишилися в локальній чернетці.`;
    submit.disabled = false;
    statusChip.textContent = 'Завантаження не завершено';
    statusChip.className = 'status-chip failed';
    setView('empty');
  } finally {
    submitting = false;
  }
});

document.querySelector('#retry-run').addEventListener('click', async () => {
  if (!activeRun) return;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(activeRun.run_id)}/retry`, { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    renderRun(body); watch(body.run_id);
  } catch (error) {
    document.querySelector('#failure-message').textContent = error.message;
    telemetry('client.fetch_error', { message: error.message.slice(0, 500), stage: 'retry' }, activeRun.run_id);
  }
});

document.querySelector('#new-run').addEventListener('click', async () => {
  eventSource?.close(); activeRun = null; form.reset(); uploads.reset(); renderUploads();
  localStorage.removeItem('zeely_active_run_id');
  history.replaceState({}, '', location.pathname);
  await Promise.all([clearDraft().catch(() => {}), clearServerDraft().catch(() => {})]);
  serverDraftRefs = { person: null, identity: null, garments: [] };
  draftStatus.textContent = 'Нова порожня чернетка';
  statusChip.textContent = 'Очікує input'; statusChip.className = 'status-chip idle'; setView('empty');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function resumeRun(runId) {
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    if (!response.ok) throw new Error('Збережений run не знайдено');
    const run = await response.json();
    renderRun(run);
    if (!['COMPLETED', 'FAILED', 'NEEDS_INPUT'].includes(run.status)) watch(run.run_id);
  } catch (error) {
    formError.textContent = error.message;
    localStorage.removeItem('zeely_active_run_id');
    telemetry('client.fetch_error', { message: error.message.slice(0, 500), stage: 'resume' }, runId);
  }
}

async function initialize() {
  telemetry('client.boot', { stage: 'start' });
  let localDraft = null;
  try {
    localDraft = await loadDraft();
    if (localDraft) {
      uploads.restore(localDraft);
      form.elements.outfit_text.value = localDraft.outfitText;
      form.elements.generate_scene.checked = localDraft.generateScene;
      draftStatus.textContent = 'Локальну чернетку відновлено';
      draftStatus.className = 'draft-status saved';
      telemetry('client.draft_restored', { ...fileSummary(uploads), stage: 'boot' });
    }
  } catch (error) {
    draftStatus.textContent = 'Локальна чернетка недоступна';
    telemetry('client.draft_error', { message: error.message.slice(0, 500), stage: 'restore' });
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
        if (!localDraft) form.elements.generate_scene.checked = serverDraft.manifest.generate_scene !== false;
        await saveDraft({ ...uploads, outfitText: form.elements.outfit_text.value, generateScene: form.elements.generate_scene.checked });
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
  const resumeRunId = new URLSearchParams(location.search).get('run') || localStorage.getItem('zeely_active_run_id');
  if (resumeRunId) await resumeRun(resumeRunId);
  window.ZeelyBootGuard?.ready();
  telemetry('client.ready', { ...fileSummary(uploads), stage: 'complete' }, resumeRunId);
}

document.addEventListener('visibilitychange', () => telemetry('client.visibility', { stage: document.visibilityState }));
window.addEventListener('online', () => telemetry('client.online', { online: true, stage: 'network' }));
window.addEventListener('offline', () => telemetry('client.online', { online: false, stage: 'network' }));

initialize().catch((error) => {
  formError.textContent = `Не вдалося запустити інтерфейс: ${error.message}`;
  telemetry('client.error', { message: error.message.slice(0, 500), stage: 'initialize' });
  window.ZeelyBootGuard?.ready();
});
