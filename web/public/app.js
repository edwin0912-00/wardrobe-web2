import { createThinkingOrb } from './thinking-orb.js';
import { UploadSelectionStore } from './upload-state.js';

const form = document.querySelector('#run-form');
const submit = document.querySelector('#submit-button');
const formError = document.querySelector('#form-error');
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

const progressStates = {
  UPLOADED: { percent: 5, step: 0, title: 'Input прийнято' },
  GARMENT_CONDITIONING: { percent: 18, step: 1, title: 'Підготовка garment references' },
  RECEIVED: { percent: 24, step: 0, title: 'Створення immutable job' },
  VALIDATING: { percent: 28, step: 0, title: 'Валідація матеріалів' },
  CONDITIONING_IDENTITY: { percent: 34, step: 1, title: 'Identity conditioning' },
  CONDITIONING_OUTFIT: { percent: 40, step: 1, title: 'Outfit conditioning' },
  CONDITIONING_RETRY: { percent: 42, step: 1, title: 'Повторна підготовка references' },
  CONDITIONING_QA: { percent: 46, step: 2, title: 'QA підготовлених references' },
  REFERENCES_READY: { percent: 50, step: 2, title: 'References готові' },
  GENERATING_AVATAR: { percent: 58, step: 3, title: 'Генерація base avatar' },
  AVATAR_RETRY: { percent: 61, step: 3, title: 'Повторна генерація avatar' },
  AVATAR_QA: { percent: 66, step: 4, title: 'Identity та технічний QA' },
  AVATAR_READY: { percent: 70, step: 4, title: 'Base avatar затверджено' },
  GENERATING_OUTFIT: { percent: 77, step: 5, title: 'Генерація повного образу' },
  OUTFIT_RETRY: { percent: 80, step: 5, title: 'Повторна генерація outfit' },
  OUTFIT_QA: { percent: 85, step: 5, title: 'Garment fidelity QA' },
  OUTFIT_READY: { percent: 89, step: 5, title: 'Outfit затверджено' },
  EXPORTING: { percent: 92, step: 7, title: 'Експорт PNG і manifest' },
  OPTIONAL_SCENE: { percent: 96, step: 6, title: 'Art Director scene' },
  COMPLETED: { percent: 100, step: 7, title: 'Результат готовий' },
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

  if (uploads.person) {
    personPreview.append(previewItem(uploads.person, () => {
      uploads.setPerson(null);
      renderUploads();
    }));
  }
  if (uploads.identityDetail) {
    identityPreview.append(previewItem(uploads.identityDetail, () => {
      uploads.setIdentityDetail(null);
      renderUploads();
    }));
  }
  uploads.garments.forEach((file, index) => {
    garmentPreview.append(previewItem(file, () => {
      uploads.removeGarment(index);
      renderUploads();
    }));
  });

  fileLabel(document.querySelector('#person-photo'), uploads.person ? 1 : 0, uploads.person?.name);
  fileLabel(document.querySelector('#identity-detail'), uploads.identityDetail ? 1 : 0, uploads.identityDetail?.name);
  fileLabel(document.querySelector('#garment-images'), uploads.garments.length);
  document.querySelectorAll('.upload-card').forEach((card) => {
    const input = card.querySelector('input[type=file]');
    const selected = input.id === 'person-photo' ? uploads.person : input.id === 'identity-detail' ? uploads.identityDetail : uploads.garments.length;
    card.classList.toggle('has-file', Boolean(selected));
  });
}

document.querySelector('#person-photo').addEventListener('change', (event) => {
  uploads.setPerson(event.target.files[0]);
  event.target.value = '';
  formError.textContent = '';
  renderUploads();
});

document.querySelector('#identity-detail').addEventListener('change', (event) => {
  uploads.setIdentityDetail(event.target.files[0]);
  event.target.value = '';
  formError.textContent = '';
  renderUploads();
});

document.querySelector('#garment-images').addEventListener('change', (event) => {
  try {
    uploads.addGarments(event.target.files);
    formError.textContent = '';
  } catch (error) {
    formError.textContent = error.message;
  }
  event.target.value = '';
  renderUploads();
});

function setView(name) {
  empty.classList.toggle('hidden', name !== 'empty');
  progress.classList.toggle('hidden', name !== 'progress');
  resultView.classList.toggle('hidden', name !== 'result');
  failure.classList.toggle('hidden', name !== 'failure');
}

function renderRun(run) {
  activeRun = run;
  statusChip.textContent = run.status.replaceAll('_', ' ');
  statusChip.className = `status-chip ${run.status === 'COMPLETED' ? 'completed' : run.status === 'FAILED' || run.status === 'NEEDS_INPUT' ? 'failed' : 'running'}`;
  if (run.status === 'COMPLETED') {
    setView('result');
    renderResults(run);
    submit.disabled = false;
    eventSource?.close();
    return;
  }
  if (run.status === 'FAILED' || run.status === 'NEEDS_INPUT') {
    setView('failure');
    document.querySelector('#failure-title').textContent = run.status === 'NEEDS_INPUT' ? 'Потрібен кращий input' : 'Run зупинено';
    document.querySelector('#failure-message').textContent = run.message || run.error?.message || 'Unknown error';
    submit.disabled = false;
    eventSource?.close();
    return;
  }
  setView('progress');
  const state = progressStates[run.inner_state] ?? progressStates[run.phase] ?? { percent: 45, step: 2, title: 'Pipeline працює' };
  document.querySelector('#progress-percent').textContent = `${state.percent}%`;
  document.querySelector('#progress-title').textContent = state.title;
  document.querySelector('#progress-message').textContent = run.message;
  const orbState = state.step <= 0 ? 'listening' : state.step <= 2 ? 'searching' : state.step === 3 ? 'composing' : state.step <= 5 ? 'solving' : state.step === 6 ? 'working' : 'shaping';
  thinkingOrb.setState(orbState);
  document.querySelectorAll('#timeline li').forEach((item, index) => {
    item.classList.toggle('active', index === state.step);
    item.classList.toggle('done', index < state.step);
    if (index === state.step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
}

function renderResults(run) {
  const passports = document.querySelector('#passport-list');
  passports.innerHTML = '';
  (run.garments || []).forEach((item) => {
    const element = document.createElement('span');
    element.className = 'passport';
    element.textContent = `${item.category} · ${Math.round(item.confidence * 100)}%`;
    passports.append(element);
  });
  const gallery = document.querySelector('#result-gallery');
  gallery.innerHTML = '';
  const outputs = [['avatar', 'Base avatar'], ['avatar_outfit', 'Full look'], ['art_director_scene', 'Art Director scene']];
  outputs.forEach(([key, label]) => {
    if (!run.outputs[key]) return;
    const card = document.createElement('article');
    card.className = `result-card ${key === 'art_director_scene' ? 'scene' : ''}`;
    card.innerHTML = `<img src="${run.outputs[key]}?v=${Date.now()}" alt="${label}"><div class="result-meta"><strong>${label}</strong><a href="${run.outputs[key]}" download>Download PNG ↓</a></div>`;
    gallery.append(card);
  });
}

function watch(runId) {
  eventSource?.close();
  eventSource = new EventSource(`/api/runs/${runId}/events`);
  eventSource.addEventListener('run', (event) => renderRun(JSON.parse(event.data)));
  eventSource.onerror = async () => {
    const response = await fetch(`/api/runs/${runId}`);
    if (response.ok) renderRun(await response.json());
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  const outfitText = document.querySelector('#outfit-text').value.trim();
  if (!uploads.person) {
    formError.textContent = 'Додай фото людини.';
    return;
  }
  if (!outfitText && uploads.garments.length === 0) {
    formError.textContent = 'Додай опис образу або хоча б одне фото речі.';
    return;
  }
  if (!form.elements.consent.checked) {
    formError.textContent = 'Потрібна згода на обробку фото.';
    return;
  }

  const data = new FormData();
  data.append('person_photo', uploads.person, uploads.person.name);
  if (uploads.identityDetail) data.append('identity_detail', uploads.identityDetail, uploads.identityDetail.name);
  uploads.garments.forEach((file) => data.append('garment_images', file, file.name));
  data.set('outfit_text', outfitText);
  data.set('consent', 'true');
  data.set('generate_scene', form.elements.generate_scene.checked ? 'true' : 'false');
  submit.disabled = true;
  setView('progress');
  try {
    const response = await fetch('/api/runs', { method: 'POST', body: data });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Не вдалося створити run');
    renderRun(body);
    watch(body.run_id);
  } catch (error) {
    formError.textContent = error.message;
    submit.disabled = false;
    setView('empty');
  }
});

document.querySelector('#retry-run').addEventListener('click', async () => {
  if (!activeRun) return;
  const response = await fetch(`/api/runs/${activeRun.run_id}/retry`, { method: 'POST' });
  const body = await response.json();
  if (response.ok) {
    renderRun(body);
    watch(body.run_id);
  } else document.querySelector('#failure-message').textContent = body.error;
});

document.querySelector('#new-run').addEventListener('click', () => {
  eventSource?.close();
  activeRun = null;
  form.reset();
  uploads.reset();
  renderUploads();
  statusChip.textContent = 'Очікує input';
  statusChip.className = 'status-chip idle';
  setView('empty');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

const resumeRunId = new URLSearchParams(window.location.search).get('run');
if (resumeRunId) {
  fetch(`/api/runs/${encodeURIComponent(resumeRunId)}`)
    .then(async (response) => {
      if (!response.ok) throw new Error('Run не знайдено');
      return response.json();
    })
    .then((run) => {
      renderRun(run);
      if (!['COMPLETED', 'FAILED', 'NEEDS_INPUT'].includes(run.status)) watch(run.run_id);
    })
    .catch((error) => { formError.textContent = error.message; });
}

renderUploads();
