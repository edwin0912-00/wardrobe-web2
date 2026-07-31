import { presentationImageUrl } from './presentation-media.js?v=20260731-1';

const login = document.querySelector('#god-login');
const dashboard = document.querySelector('#god-dashboard');
const loginForm = document.querySelector('#god-login-form');
const loginError = document.querySelector('#god-login-error');
const status = document.querySelector('#god-session');
const logout = document.querySelector('#god-logout');
const summary = document.querySelector('#god-summary');
const profilesRoot = document.querySelector('#god-profiles');
const lookPicker = document.querySelector('#god-look-picker-grid');
const liveStatus = document.querySelector('#god-live-status');
let refreshTimer = null;

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function element(tag, text = null, className = null) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function stamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

function id(value) {
  return element('span', value, 'god-id');
}

function statusLine(label, value) {
  const node = element('div', null, 'god-muted');
  node.append(`${label}: `, element('strong', value ?? '—'));
  return node;
}

function generatedImage(url, alt) {
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.src = presentationImageUrl(url);
  image.alt = alt;
  return image;
}

function sourceReferences(run) {
  if (!run.garments?.length && !run.person_source_url) return null;
  const details = element('details', null, 'god-source');
  details.append(element('summary', `Вихідні фото та референси речей · ${run.garments?.length ?? 0}`));
  const grid = element('div', null, 'god-source-grid');
  if (run.person_source_url) {
    const figure = element('figure');
    figure.append(generatedImage(run.person_source_url, 'Вихідне фото людини'));
    figure.append(element('figcaption', 'Вихідне фото людини'));
    grid.append(figure);
  }
  if (run.identity_source_url) {
    const figure = element('figure');
    figure.append(generatedImage(run.identity_source_url, 'Додаткове фото людини'));
    figure.append(element('figcaption', 'Додаткове фото людини'));
    grid.append(figure);
  }
  for (const garment of run.garments) {
    const figure = element('figure');
    figure.append(generatedImage(garment.source_url, `Референс речі: ${garment.category ?? 'unknown'}`));
    figure.append(element('figcaption', `${garment.category ?? 'річ'} · ${garment.confidence ?? '—'}`));
    grid.append(figure);
  }
  details.append(grid);
  return details;
}

function runCard(run) {
  const card = element('article', null, 'god-run');
  card.append(element('p', `RUN · ${run.status ?? '—'} · ${run.phase ?? '—'}`, 'god-label'));
  card.append(id(run.run_id));
  card.append(statusLine('Оновлено', stamp(run.updated_at)));
  if (run.message) card.append(element('p', run.message, 'god-muted'));
  const source = sourceReferences(run);
  if (source) card.append(source);
  return card;
}

function sceneCard(scene) {
  const card = element('article', null, 'god-output');
  const head = element('header');
  head.append(element('h3', scene.preset_id || 'Background'));
  head.append(element('span', scene.status, 'god-muted'));
  card.append(head, id(scene.scene_id));
  if (scene.image_url) card.append(generatedImage(scene.image_url, `Сцена ${scene.preset_id}`));
  return card;
}

function shootCard(shoot) {
  const card = element('article', null, 'god-output');
  const head = element('header');
  head.append(element('h3', shoot.mode_id || 'Fashion Shoot'));
  head.append(element('span', `${shoot.status} · ${shoot.approved_shot_count}/5`, 'god-muted'));
  card.append(head, id(shoot.shoot_id));
  const gallery = element('div', null, 'god-gallery');
  for (const shot of shoot.shots ?? []) {
    const unit = element('div', null, 'god-shot');
    if (shot.image_url) unit.append(generatedImage(shot.image_url, `Fashion кадр ${shot.slot}`));
    unit.append(element('span', `${shot.slot} · ${shot.status}`));
    gallery.append(unit);
  }
  if (gallery.childElementCount) card.append(gallery);
  return card;
}

function videoCard(video) {
  const card = element('article', null, 'god-output');
  const head = element('header');
  head.append(element('h3', `Video · ${video.motion_mode || '—'}`));
  head.append(element('span', video.status, 'god-muted'));
  card.append(head, id(video.clip_id));
  if (video.video_url) {
    const player = document.createElement('video');
    player.className = 'god-video';
    player.controls = true;
    player.preload = 'metadata';
    player.src = video.video_url;
    card.append(player);
  }
  return card;
}

function lookCard(look) {
  const card = element('article', null, 'god-look');
  card.id = `god-look-${look.look_id}`;
  const head = element('header');
  head.append(element('h3', 'Збережений образ'));
  head.append(element('span', stamp(look.created_at), 'god-muted'));
  card.append(head, id(look.look_id));
  const row = element('div', null, 'god-image-row');
  row.append(generatedImage(look.image_url, 'Master look'));
  row.append(runCard(look.run));
  card.append(row);
  const outputs = element('div', null, 'god-output-list');
  for (const scene of look.scenes ?? []) outputs.append(sceneCard(scene));
  for (const shoot of look.shoots ?? []) outputs.append(shootCard(shoot));
  for (const video of look.videos ?? []) outputs.append(videoCard(video));
  if (outputs.childElementCount) card.append(outputs);
  return card;
}

function lookSelectionLabel(look, avatar, index) {
  return look.name || avatar.name || `Образ ${String(index + 1).padStart(2, '0')}`;
}

function renderLookPicker(data) {
  lookPicker.replaceChildren();
  const entries = (data.profiles ?? []).flatMap((profile) => (
    (profile.avatars ?? []).flatMap((avatar) => (
      (avatar.looks ?? []).map((look) => ({ profile, avatar, look }))
    ))
  ));
  if (!entries.length) {
    lookPicker.append(element('p', 'Ще немає збережених тестових образів.', 'god-muted'));
    return;
  }
  entries.forEach(({ profile, avatar, look }, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'god-look-choice';
    button.setAttribute('aria-label', `Відкрити ${lookSelectionLabel(look, avatar, index)} з тестової сесії`);
    button.append(generatedImage(look.image_url, lookSelectionLabel(look, avatar, index)));
    const copy = element('span', null, 'god-look-choice-copy');
    copy.append(
      element('strong', lookSelectionLabel(look, avatar, index)),
      element('small', `Сесія ${String(index + 1)} · ${new Date(profile.created_at).toLocaleDateString('uk-UA')}`),
    );
    button.append(copy);
    button.addEventListener('click', () => {
      document.getElementById(`god-look-${look.look_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    lookPicker.append(button);
  });
}

function profileCard(profile) {
  const card = element('section', null, 'god-profile');
  const head = element('header');
  const title = element('div');
  title.append(element('p', 'BROWSER PROFILE', 'god-label'), id(profile.profile_id));
  head.append(title, element('span', `TTL до ${stamp(profile.expires_at)}`, 'god-muted'));
  card.append(head);
  const avatars = element('div', null, 'god-avatar-list');
  for (const avatar of profile.avatars ?? []) {
    const unit = element('article', null, 'god-avatar');
    const row = element('div', null, 'god-image-row');
    row.append(generatedImage(avatar.image_url, 'Збережений аватар'));
    const body = element('div');
    body.append(element('p', 'AVATAR', 'god-label'), id(avatar.avatar_id), statusLine('Створено', stamp(avatar.created_at)));
    const looks = element('div', null, 'god-look-list');
    for (const look of avatar.looks ?? []) looks.append(lookCard(look));
    body.append(looks);
    row.append(body);
    unit.append(row);
    avatars.append(unit);
  }
  if (avatars.childElementCount) card.append(avatars);
  const runs = element('div', null, 'god-run-list');
  for (const item of profile.runs ?? []) runs.append(runCard(item.run));
  if (runs.childElementCount) card.append(element('p', 'ВСІ CLAIMED RUNS', 'god-label'), runs);
  return card;
}

function render(data) {
  summary.replaceChildren();
  for (const [label, value] of Object.entries(data.summary ?? {})) {
    const unit = element('article');
    unit.append(element('strong', String(value)), element('span', label));
    summary.append(unit);
  }
  profilesRoot.replaceChildren();
  renderLookPicker(data);
  if (!data.profiles?.length) {
    profilesRoot.append(element('p', 'У активному runtime ще немає збережених профілів.', 'god-muted'));
    return;
  }
  for (const profile of data.profiles) profilesRoot.append(profileCard(profile));
}

async function loadOverview() {
  const data = await request('/api/god-view/overview');
  render(data);
  login.hidden = true;
  dashboard.hidden = false;
  logout.hidden = false;
  status.textContent = 'read-only session active';
  liveStatus.textContent = `Оновлено ${new Date(data.generated_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} · автооновлення 15 с`;
  if (!refreshTimer) {
    refreshTimer = window.setInterval(() => {
      loadOverview().catch(() => {
        liveStatus.textContent = 'Очікуємо відновлення з’єднання';
      });
    }, 15_000);
  }
}

async function boot() {
  try {
    const session = await request('/api/god-view/session');
    if (session.authenticated) return loadOverview();
    login.hidden = false;
    status.textContent = 'key required';
  } catch {
    login.hidden = false;
    status.textContent = 'not provisioned';
    loginError.textContent = 'God View ще не provisioned на цьому сервері.';
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    await request('/api/god-view/session', { method: 'POST', body: JSON.stringify({ key: document.querySelector('#god-key').value }) });
    document.querySelector('#god-key').value = '';
    await loadOverview();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

logout.addEventListener('click', async () => {
  await request('/api/god-view/session', { method: 'DELETE' });
  window.clearInterval(refreshTimer);
  refreshTimer = null;
  dashboard.hidden = true;
  logout.hidden = true;
  login.hidden = false;
  status.textContent = 'key required';
});

boot();
