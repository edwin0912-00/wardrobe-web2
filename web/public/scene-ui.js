import {
  cancelProfileScene,
  createProfileScene,
  deleteProfileScene,
  loadEditorialModes,
  loadProfileScene,
  loadScenePresets,
  retryProfileScene,
} from './profile-client.js?v=20260724-5';
import { createEditorialShootUi } from './editorial-shoot-ui.js?v=20260730-3';
import {
  clearSceneResume,
  presetCameraLabel,
  readSceneResume,
  safePresetPreviewUrl,
  sceneCanCancel,
  sceneCanDelete,
  sceneCanRetry,
  sceneIsTechnicalRecovery,
  sceneIsTerminal,
  sceneResumeFromSnapshot,
  sceneTone,
  writeSceneResume,
} from './scene-state.js?v=20260724-2';

const UK_PLURAL_SCENE = Object.freeze(['стандартна сцена', 'стандартні сцени', 'стандартних сцен']);
const UK_PLURAL_MODE = Object.freeze(['напрям', 'напрями', 'напрямів']);

// Ukrainian needs three forms, so a bare `N сцен` is wrong for 1 and for 2–4.
function ukPlural(count, forms) {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}


function idOfLook(look) {
  return look?.look_id ?? look?.id ?? null;
}

function imageOfLook(look) {
  const lookId = idOfLook(look);
  return look?.image_url ?? (lookId ? `/api/profile/looks/${encodeURIComponent(lookId)}/image` : '');
}

function randomKey(prefix = 'scene') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function familyLabel(family) {
  return ({
    city: 'МІСТО',
    light_studio: 'СВІТЛА СТУДІЯ',
    dramatic_studio: 'ДРАМАТИЧНА СТУДІЯ',
    interior: 'ІНТЕР’ЄР',
    nature_architecture: 'ПРИРОДА × АРХІТЕКТУРА',
  })[family] ?? 'СЦЕНА';
}

function visualKey(preset) {
  const id = String(preset?.preset_id ?? '');
  if (id.includes('white_window')) return 'white-window';
  if (id.includes('taupe_rembrandt')) return 'rembrandt';
  if (id.includes('gallery')) return 'gallery';
  if (id.includes('concrete_grass')) return 'nature';
  if (id.includes('city')) return 'city';
  return String(preset?.family ?? 'neutral').replace(/[^a-z0-9_-]/gi, '');
}

function createPresetVisual(preset, { large = false } = {}) {
  const wrapper = document.createElement('span');
  wrapper.className = `scene-preset-visual${large ? ' is-large' : ''}`;
  wrapper.dataset.visual = visualKey(preset);
  const previewUrl = safePresetPreviewUrl(preset);
  if (previewUrl) {
    const image = document.createElement('img');
    image.src = previewUrl;
    image.alt = '';
    image.loading = 'eager';
    wrapper.dataset.preview = 'api';
    wrapper.append(image);
  } else {
    wrapper.dataset.preview = 'schematic';
    wrapper.setAttribute('aria-label', 'Схема світла; API не надав окреме preview-зображення');
    const horizon = document.createElement('i');
    const light = document.createElement('b');
    wrapper.append(horizon, light);
  }
  return wrapper;
}

function createEditorialModeCard(mode, onSelect, { eager = false } = {}) {
  const ready = mode.source_set_status === 'READY' && mode.generation_available === true;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'editorial-mode-card';
  card.dataset.modeId = mode.mode_id;
  card.disabled = !ready;
  const nameText = mode.ui_name_uk || 'Fashion Shoot';
  card.setAttribute('aria-label', ready
    ? `Обрати Fashion Shoot: ${nameText}`
    : `${nameText}: поки недоступно`);

  const preview = document.createElement('span');
  preview.className = 'editorial-mode-preview';
  const previewUrl = safePresetPreviewUrl(mode);
  if (previewUrl) {
    const image = document.createElement('img');
    image.src = previewUrl;
    image.alt = `Приклад стилю: ${nameText}`;
    image.loading = eager ? 'eager' : 'lazy';
    if (eager) image.fetchPriority = 'high';
    preview.append(image);
  } else {
    preview.classList.add('is-missing');
    preview.textContent = 'Приклад стилю недоступний';
  }

  const copy = document.createElement('span');
  copy.className = 'editorial-mode-copy';
  const name = document.createElement('strong');
  name.textContent = nameText;
  const action = document.createElement('span');
  action.className = 'editorial-mode-action';
  action.textContent = ready ? 'Обрати стиль' : 'Незабаром';
  copy.append(name, action);
  card.append(preview, copy);
  if (ready) card.addEventListener('click', () => onSelect(mode));
  return card;
}

function lookDescriptor(profile, lookId) {
  const looks = Array.isArray(profile?.looks)
    ? profile.looks
    : (profile?.avatars ?? []).flatMap((avatar) => avatar.looks ?? []);
  return looks.find((look) => idOfLook(look) === lookId) ?? {
    look_id: lookId,
    image_url: `/api/profile/looks/${encodeURIComponent(lookId)}/image`,
  };
}

function exactPhase(scene) {
  return String(scene?.phase ?? 'AWAITING_SERVER');
}

function exactStatus(scene) {
  return String(scene?.status ?? 'CONNECTING');
}

function scenePhasePresentation(scene) {
  const phase = exactPhase(scene).toUpperCase();
  const status = exactStatus(scene).toUpperCase();
  if (status === 'COMPLETED') return { phase: 'Сцена готова', estimate: 'Готово' };
  if (status === 'FAILED') return { phase: 'Потрібна перевірка', estimate: 'Створення зупинено до наступної дії' };
  if (/(QA|VERIFY|VALIDAT)/.test(phase)) return { phase: 'Перевіряємо результат', estimate: 'Зазвичай ще до 1 хвилини' };
  if (/(GENERAT|RENDER|EXECUT)/.test(phase)) return { phase: 'Створюємо кадр', estimate: 'Зазвичай ще 2–4 хвилини' };
  if (/(QUEUED|RECEIVED|POSTING|BIND|AWAIT|FETCH|CONNECT)/.test(`${phase} ${status}`)) return { phase: 'Готуємо запуск', estimate: 'Зазвичай до 5 хвилин' };
  return { phase: 'Оновлюємо сцену', estimate: 'Зазвичай до 5 хвилин' };
}

function sceneConnectionPresentation(polling) {
  return polling ? 'ОНОВЛЮЄМО СТАН' : 'З’ЄДНАННЯ АКТИВНЕ';
}

export function sceneRequestFailurePresentation(error) {
  const code = String(error?.code ?? '');
  const structured = Number.isInteger(error?.status) && error.status >= 400;
  const messageByCode = {
    LOOK_ITEM_EVIDENCE_INVALID: 'Збережений образ не має цілісного підтвердження речей. Запуск сцени зупинено без генерації.',
    LOOK_BINDING_MISMATCH: 'Збережений образ змінився після підтвердження. Обери образ повторно.',
    LOOK_RECEIPT_INVALID: 'Підтвердження збереженого образу пошкоджене або застаріле.',
    LOOK_RECEIPT_MISSING: 'Не знайдено підтвердження збереженого образу.',
  };
  if (structured) {
    return {
      status: 'ЗАПУСК ВІДХИЛЕНО',
      phase: 'Потрібна перевірка збереженого образу',
      connection: 'СЕРВЕР НА ЗВ’ЯЗКУ',
      message: messageByCode[code] ?? String(error?.message || `Сервер відхилив запуск (${error.status})`),
      reconnect: false,
    };
  }
  return {
    status: 'НЕМАЄ З’ЄДНАННЯ',
    phase: 'Не вдалося отримати стан',
    connection: 'З’ЄДНАННЯ ПЕРЕРВАЛОСЯ',
    message: String(error?.message || 'Не вдалося з’єднатися із сервером'),
    reconnect: true,
  };
}

export class SceneUiController {
  constructor({
    setView,
    setWorkflowActive,
    loadProfile,
    renderProfile,
    humanize = (value) => String(value ?? ''),
    telemetry = () => {},
  }) {
    this.setView = setView;
    this.setWorkflowActive = setWorkflowActive;
    this.loadProfile = loadProfile;
    this.renderProfile = renderProfile;
    this.humanize = humanize;
    this.telemetry = telemetry;
    this.scene = null;
    this.look = null;
    this.presets = [];
    this.editorialModes = [];
    this.editorialCatalog = null;
    this.editorialLoadError = null;
    this.editorialLoading = false;
    this.pickerTab = 'standard';
    this.selectedPreset = null;
    this.resumeRecord = null;
    this.eventSource = null;
    this.pollTimer = null;
    this.polling = false;
    this.phaseHistory = [];
    this.actionPending = false;
    this.editorialUi = createEditorialShootUi({
      activate: () => {
        this.#activateView();
        this.#setMode('editorial');
      },
      setLook: (look) => this.#setLook(look),
      loadProfile: this.loadProfile,
      renderProfile: this.renderProfile,
      humanize: this.humanize,
      telemetry: this.telemetry,
    });
    this.#bind();
  }

  #element(selector) {
    return document.querySelector(selector);
  }

  #bind() {
    this.#element('#scene-back').addEventListener('click', () => this.back());
    this.#element('#scene-picker-back').addEventListener('click', () => this.showPicker());
    this.#element('#scene-start').addEventListener('click', () => this.startSelected());
    this.#element('#scene-cancel').addEventListener('click', () => this.cancel());
    this.#element('#scene-retry').addEventListener('click', () => this.retry());
    this.#element('#scene-delete').addEventListener('click', () => this.remove());
    this.#element('#scene-reconnect').addEventListener('click', () => this.reconnect());
    this.#element('#scene-tab-standard').addEventListener('click', () => this.#setPickerTab('standard'));
    this.#element('#scene-tab-editorial').addEventListener('click', () => this.#setPickerTab('editorial'));
    this.#element('#editorial-resume').addEventListener('click', () => {
      this.editorialUi.openStoredForLook(this.look).catch((error) => this.#setError(error.message));
    });
  }

  #activateView() {
    this.setWorkflowActive(true);
    this.setView('scene');
  }

  #setMode(mode) {
    const shell = this.#element('.scene-shell');
    shell.dataset.mode = mode;
    for (const name of ['picker', 'confirm', 'execution', 'editorial']) {
      const element = this.#element(name === 'editorial' ? '#editorial-shoot' : `#scene-${name}`);
      element.classList.toggle('hidden', name !== mode);
    }
  }

  #setError(message = '') {
    const error = this.#element('#scene-error');
    error.textContent = this.humanize(message);
    error.hidden = !message;
  }

  #setLook(look) {
    this.look = look;
    const imageUrl = imageOfLook(look);
    for (const image of document.querySelectorAll('[data-scene-look-image]')) {
      image.src = imageUrl;
      image.alt = 'Збережений образ для сцени';
    }
    for (const label of document.querySelectorAll('[data-scene-look-name]')) {
      label.textContent = look?.name || 'Збережений образ';
    }
  }

  async #ensurePresets() {
    if (this.presets.length) return this.presets;
    const response = await loadScenePresets();
    this.presets = Array.isArray(response?.presets) ? response.presets : [];
    if (!this.presets.length) throw new Error('Сервер не опублікував жодної сцени');
    return this.presets;
  }

  async #ensureEditorialModes() {
    if (this.editorialCatalog) return this.editorialCatalog;
    const response = await loadEditorialModes();
    const modes = Array.isArray(response?.modes) ? response.modes : [];
    if (response?.status !== 'ACTIVE'
      || response?.generation_available !== true
      || !Array.isArray(response?.shot_sequence)
      || response.shot_sequence.length !== 6
      || !modes.length
      || modes.some((mode) => mode?.generation_available === true
        && mode?.source_set_status !== 'READY')
      || !modes.some((mode) => mode?.generation_available === true)) {
      throw new Error('Fashion Shoot API повернув невалідний production-контракт');
    }
    this.editorialModes = modes;
    this.editorialCatalog = response;
    this.editorialLoadError = null;
    return response;
  }

  #setPickerTab(tab) {
    this.pickerTab = tab === 'editorial' ? 'editorial' : 'standard';
    const editorial = this.pickerTab === 'editorial';
    const standardTab = this.#element('#scene-tab-standard');
    const editorialTab = this.#element('#scene-tab-editorial');
    const standardPanel = this.#element('#scene-standard-panel');
    const editorialPanel = this.#element('#scene-editorial-panel');
    const fashionModes = this.editorialModes.filter((mode) => mode.mode_id.startsWith('shoot.'));
    // The counts used to be baked into index.html, so the tab still said five
    // standard scenes after the catalog grew to sixteen. Both labels now come
    // from the same data the grids are rendered from.
    standardTab.textContent = this.presets.length
      ? `${this.presets.length} ${ukPlural(this.presets.length, UK_PLURAL_SCENE)}`
      : 'Стандартні сцени';
    editorialTab.textContent = fashionModes.length
      ? `Fashion Shoot · ${fashionModes.length} ${ukPlural(fashionModes.length, UK_PLURAL_MODE)}`
      : 'Fashion Shoot';
    standardTab.setAttribute('aria-selected', String(!editorial));
    standardTab.tabIndex = editorial ? -1 : 0;
    editorialTab.setAttribute('aria-selected', String(editorial));
    editorialTab.tabIndex = editorial ? 0 : -1;
    standardPanel.hidden = editorial;
    editorialPanel.hidden = !editorial;
    this.#element('#scene-execution-title').textContent = editorial
      ? 'Fashion Shoot напрями'
      : 'Обери сцену';
    this.#element('#scene-picker-status').textContent = editorial
      ? (this.editorialLoading
        ? 'Завантажуємо Fashion Shoot напрями…'
        : this.editorialLoadError
        ? 'Fashion Shoot недоступний'
        : `${fashionModes.filter((mode) => mode.generation_available).length} напрями готові`)
      : `${this.presets.length} сцен · обери одну`;
    const resume = this.#element('#editorial-resume');
    const hasResume = editorial && this.editorialUi.hasResumeForLook(idOfLook(this.look));
    resume.hidden = !hasResume;
    resume.textContent = 'Відкрити останню фотосесію';
    this.telemetry('client.scene_picker_tab', {
      look_id: idOfLook(this.look),
      tab: this.pickerTab,
      stage: 'scene',
    });
  }

  async openForLook(look, { initialTab = 'standard' } = {}) {
    const lookId = idOfLook(look);
    if (!lookId) throw new Error('Збережений образ не знайдено');
    this.stopWatching();
    clearSceneResume();
    this.scene = null;
    this.resumeRecord = null;
    this.phaseHistory = [];
    this.selectedPreset = null;
    this.pickerTab = initialTab === 'editorial' ? 'editorial' : 'standard';
    this.#setLook(look);
    this.#activateView();
    this.#setMode('picker');
    this.#element('#scene-execution-title').textContent = 'Обери сцену';
    const status = this.#element('#scene-server-status');
    status.textContent = 'READY';
    status.dataset.tone = 'running';
    this.#setError('');
    this.#element('#scene-preset-grid').replaceChildren();
    const editorialLoading = document.createElement('p');
    editorialLoading.className = 'editorial-mode-unavailable';
    editorialLoading.textContent = 'Завантажуємо Fashion Shoot напрями…';
    // The Fashion Shoot picker has one grid containing complete `shoot.*`
    // Creative Universe units. Do not dereference removed legacy markup here:
    // doing so aborts picker boot before either catalogue can render.
    this.#element('#editorial-mode-grid-new').replaceChildren(editorialLoading);
    this.#setPickerTab(this.pickerTab);
    this.#element('#scene-picker-status').textContent = 'Завантажуємо доступні сцени…';
    this.editorialLoading = true;
    this.telemetry('client.scene_picker_opened', { look_id: lookId, stage: 'scene' });
    const standardRequest = this.#ensurePresets()
      .then(() => {
        this.#renderPresets();
        if (this.pickerTab === 'standard') {
          this.#element('#scene-picker-status').textContent = `${this.presets.length} сцен · обери одну`;
        }
      })
      .catch((error) => {
        this.presets = [];
        if (this.pickerTab === 'standard') this.#element('#scene-picker-status').textContent = 'Сцени недоступні';
        this.#setError(error.message || 'Не вдалося завантажити сцени');
        this.telemetry('client.scene_error', { message: String(error.message).slice(0, 500), stage: 'preset_list' });
      });
    const editorialRequest = this.#ensureEditorialModes()
      .then(() => {
        this.editorialLoading = false;
        this.#renderEditorialModes();
        if (this.pickerTab === 'editorial') this.#setPickerTab('editorial');
      })
      .catch((error) => {
        this.editorialLoading = false;
        this.editorialCatalog = null;
        this.editorialModes = [];
        this.editorialLoadError = error;
        this.#renderEditorialModes();
        if (this.pickerTab === 'editorial') this.#setPickerTab('editorial');
        this.telemetry('client.scene_error', {
          message: String(error?.message ?? error).slice(0, 500),
          stage: 'editorial_mode_list',
        });
      });
    await Promise.all([standardRequest, editorialRequest]);
  }

  editorialResumeProjectionForLook(lookId) {
    return this.editorialUi.resumeProjectionForLook(lookId);
  }

  openExistingEditorial(projection, look) {
    return this.editorialUi.openExisting(projection, look);
  }

  #renderPresets() {
    const grid = this.#element('#scene-preset-grid');
    const fragment = document.createDocumentFragment();
    for (const preset of this.presets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-preset-card';
      button.dataset.presetId = preset.preset_id;
      button.append(createPresetVisual(preset));
      const copy = document.createElement('span');
      copy.className = 'scene-preset-copy';
      const family = document.createElement('small');
      family.textContent = familyLabel(preset.family);
      const name = document.createElement('strong');
      name.textContent = preset.ui_name_uk || preset.preset_id;
      const camera = document.createElement('em');
      camera.textContent = presetCameraLabel(preset);
      copy.append(family, name, camera);
      button.append(copy);
      button.addEventListener('click', () => this.confirmPreset(preset));
      fragment.append(button);
    }
    grid.replaceChildren(fragment);
  }

  #renderEditorialModes() {
    const gridNew = this.#element('#editorial-mode-grid-new');
    if (this.editorialLoadError) {
      const unavailable = document.createElement('p');
      unavailable.className = 'editorial-mode-unavailable';
      unavailable.textContent = 'Mood-board зараз не завантажився. Стандартні сцени продовжують працювати.';
      gridNew.replaceChildren(unavailable);
      return;
    }

    // Only complete Creative Universe style units are a Fashion Shoot choice.
    // Historical editorial records remain addressable for owners, but they are
    // not silently presented as a second style product in the new picker.
    const newModes = this.editorialModes.filter((m) => m.mode_id.startsWith('shoot.'));
    
    const onSelect = (selected) => this.editorialUi.openForMode(selected, this.look).catch(
      (error) => this.#setError(error.message),
    );
    
    gridNew.replaceChildren(...newModes.map(
      (mode, index) => createEditorialModeCard(mode, onSelect, { eager: index < 4 }),
    ));
  }

  showPicker() {
    this.#setError('');
    this.#element('#scene-execution-title').textContent = 'Обери сцену';
    const status = this.#element('#scene-server-status');
    status.textContent = 'READY';
    status.dataset.tone = 'running';
    this.#setMode('picker');
    this.#setPickerTab(this.pickerTab);
  }

  confirmPreset(preset) {
    this.pickerTab = 'standard';
    this.selectedPreset = preset;
    const host = this.#element('#scene-confirm-preset');
    host.replaceChildren(createPresetVisual(preset, { large: true }));
    this.#element('#scene-confirm-family').textContent = familyLabel(preset.family);
    this.#element('#scene-confirm-name').textContent = preset.ui_name_uk || preset.preset_id;
    this.#element('#scene-confirm-camera').textContent = presetCameraLabel(preset);
    this.#element('#scene-start').disabled = false;
    this.#setError('');
    this.#element('#scene-execution-title').textContent = 'Підтверди сцену';
    this.#setMode('confirm');
    this.telemetry('client.scene_preset_selected', {
      look_id: idOfLook(this.look),
      preset_id: preset.preset_id,
      stage: 'scene',
    });
  }

  async startSelected() {
    if (this.actionPending || !this.selectedPreset || !idOfLook(this.look)) return;
    const preset = this.selectedPreset;
    this.resumeRecord = writeSceneResume({
      scene_id: null,
      look_id: idOfLook(this.look),
      preset_id: preset.preset_id,
      preset_version: preset.preset_version,
      reference_pack_sha256: preset.reference_pack_sha256 ?? null,
      idempotency_key: randomKey('scene-create'),
    });
    this.#showConnecting('POSTING_SCENE_REQUEST', 'Надсилаємо зафіксований запит на сервер');
    await this.#createFromResume();
  }

  async #createFromResume() {
    if (this.actionPending || !this.resumeRecord) return;
    this.actionPending = true;
    this.#syncActionButtons();
    try {
      const scene = await createProfileScene(this.resumeRecord.look_id, {
        presetId: this.resumeRecord.preset_id,
        presetVersion: this.resumeRecord.preset_version,
        expectedReferencePackSha256: this.resumeRecord.reference_pack_sha256,
        idempotencyKey: this.resumeRecord.idempotency_key,
      });
      this.#acceptScene(scene);
      this.watch(scene.scene_id);
      this.telemetry('client.scene_created', {
        scene_id: scene.scene_id,
        look_id: this.resumeRecord.look_id,
        status: scene.status,
        stage: scene.phase,
      });
    } catch (error) {
      this.#showConnectionFailure(error, 'create');
    } finally {
      this.actionPending = false;
      this.#syncActionButtons();
    }
  }

  #showConnecting(phase, message) {
    this.#activateView();
    this.#setMode('execution');
    this.#element('#scene-output').hidden = true;
    this.#element('#scene-running-stage').hidden = false;
    const presentation = scenePhasePresentation({ status: 'CONNECTING', phase });
    this.#element('#scene-server-status').textContent = 'ПІДГОТОВКА';
    this.#element('#scene-server-phase').textContent = presentation.phase;
    this.#element('#scene-server-message').textContent = presentation.estimate;
    this.#element('#scene-connection').textContent = 'З’ЄДНУЄМОСЯ ІЗ СЕРВЕРОМ';
    this.#element('#scene-execution-title').textContent = 'Створюємо сцену';
    this.#element('#scene-reconnect').hidden = true;
    this.#syncActionButtons();
  }

  #showConnectionFailure(error, stage) {
    this.#activateView();
    this.#setMode('execution');
    const presentation = sceneRequestFailurePresentation(error);
    this.#element('#scene-server-status').textContent = presentation.status;
    this.#element('#scene-server-phase').textContent = presentation.phase;
    this.#element('#scene-server-message').textContent = this.humanize(presentation.message);
    this.#element('#scene-connection').textContent = presentation.connection;
    this.#element('#scene-reconnect').hidden = !presentation.reconnect;
    this.telemetry('client.scene_error', {
      message: String(error?.message ?? error).slice(0, 500),
      code: String(error?.code ?? '').slice(0, 120),
      status: Number.isInteger(error?.status) ? error.status : null,
      scene_id: this.scene?.scene_id,
      stage,
    });
  }

  #acceptScene(scene) {
    if (!scene?.scene_id) throw new Error('Сервер повернув сцену без scene_id');
    this.scene = scene;
    const previous = this.resumeRecord ?? {
      idempotency_key: randomKey('scene-resume'),
      look_id: scene.approved_look?.look_id,
      preset_id: scene.preset?.preset_id,
      preset_version: scene.preset?.version,
      reference_pack_sha256: scene.preset?.reference_pack_sha256 ?? null,
    };
    const normalized = sceneResumeFromSnapshot(scene, previous);
    if (normalized) this.resumeRecord = writeSceneResume(normalized);
    history.replaceState({}, '', `${location.pathname}?scene=${encodeURIComponent(scene.scene_id)}`);
    this.#renderScene(scene);
  }

  #renderScene(scene) {
    this.#activateView();
    this.#setMode('execution');
    const status = exactStatus(scene);
    const phase = exactPhase(scene);
    const presentation = scenePhasePresentation(scene);
    const tone = sceneTone(scene);
    const statusElement = this.#element('#scene-server-status');
    statusElement.textContent = status;
    statusElement.dataset.tone = tone;
    this.#element('#scene-server-phase').textContent = presentation.phase;
    this.#element('#scene-server-message').textContent = presentation.estimate;
    this.#element('#scene-connection').textContent = sceneConnectionPresentation(this.polling);
    this.#element('#scene-reconnect').hidden = true;
    this.#recordPhase(status, phase);

    const preset = this.presets.find((item) => item.preset_id === scene.preset?.preset_id)
      ?? this.selectedPreset
      ?? {
        preset_id: scene.preset?.preset_id,
        preset_version: scene.preset?.version,
        ui_name_uk: scene.preset?.preset_id,
      };
    this.selectedPreset = preset;
    this.#element('#scene-active-preset').textContent = preset.ui_name_uk || preset.preset_id || 'Сцена';
    const model = scene.execution?.model;
    this.#element('#scene-model').textContent = model
      ? `${model.name} · ${model.quality}`
      : 'Модель ще не призначена';

    const completed = status === 'COMPLETED' && scene.output?.image_url;
    this.#element('#scene-running-stage').hidden = Boolean(completed);
    this.#element('#scene-output').hidden = !completed;
    if (completed) {
      const image = this.#element('#scene-output-image');
      image.src = scene.output.image_url;
      image.alt = `Готова сцена: ${preset.ui_name_uk || preset.preset_id}`;
      this.#element('#scene-output-download').href = scene.output.download_url || scene.output.image_url;
      this.#element('#scene-execution-title').textContent = 'Сцена готова';
    } else if (status === 'FAILED') {
      this.#element('#scene-execution-title').textContent = sceneIsTechnicalRecovery(scene)
        ? 'Відновлюємо технічну перевірку'
        : 'Сцена потребує доопрацювання';
    } else if (status === 'CANCELLED') {
      this.#element('#scene-execution-title').textContent = 'Створення зупинено';
    } else {
      this.#element('#scene-execution-title').textContent = 'Створюємо сцену';
    }
    this.#syncActionButtons();
    if (sceneIsTerminal(scene)) this.stopWatching();
  }

  #recordPhase(status, phase) {
    const key = `${status}:${phase}`;
    if (this.phaseHistory.at(-1)?.key === key) return;
    this.phaseHistory.push({
      key,
      status,
      phase,
      time: new Intl.DateTimeFormat('uk-UA', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date()),
    });
    this.phaseHistory = this.phaseHistory.slice(-5);
    const list = this.#element('#scene-phase-stream');
    list.replaceChildren(...this.phaseHistory.map((item) => {
      const entry = document.createElement('li');
      const marker = document.createElement('i');
      const copy = document.createElement('span');
      const code = document.createElement('code');
      const time = document.createElement('time');
      code.textContent = scenePhasePresentation({ status: item.status, phase: item.phase }).phase;
      time.textContent = item.time;
      copy.append(code, time);
      entry.append(marker, copy);
      return entry;
    }));
  }

  #syncActionButtons() {
    const scene = this.scene;
    const pending = this.actionPending;
    const cancel = this.#element('#scene-cancel');
    const retry = this.#element('#scene-retry');
    const remove = this.#element('#scene-delete');
    cancel.hidden = !sceneCanCancel(scene);
    retry.hidden = !sceneCanRetry(scene);
    remove.hidden = !sceneCanDelete(scene);
    if (!retry.hidden) {
      retry.textContent = sceneIsTechnicalRecovery(scene) ? 'Повторити перевірку' : 'Переробити сцену';
    }
    cancel.disabled = pending;
    retry.disabled = pending;
    remove.disabled = pending;
    this.#element('#scene-start').disabled = pending || !this.selectedPreset;
  }

  watch(sceneId) {
    this.stopWatching();
    if (sceneIsTerminal(this.scene)) return;
    if (typeof EventSource !== 'function') {
      this.#beginPolling(sceneId);
      return;
    }
    this.polling = false;
    this.eventSource = new EventSource(`/api/profile/scenes/${encodeURIComponent(sceneId)}/events`);
    this.eventSource.addEventListener('scene', (event) => {
      try {
        const scene = JSON.parse(event.data);
        this.#acceptScene(scene);
        this.telemetry('client.scene_event', {
          scene_id: scene.scene_id,
          status: scene.status,
          stage: scene.phase,
        });
      } catch (error) {
        this.#showConnectionFailure(error, 'sse_parse');
        this.#beginPolling(sceneId);
      }
    });
    this.eventSource.onerror = () => {
      if (sceneIsTerminal(this.scene)) return this.stopWatching();
      this.#beginPolling(sceneId);
    };
  }

  #beginPolling(sceneId) {
    this.eventSource?.close();
    this.eventSource = null;
    this.polling = true;
    this.#element('#scene-connection').textContent = 'ОНОВЛЮЄМО СТАН';
    const poll = async () => {
      if (!this.polling) return;
      try {
        const scene = await loadProfileScene(sceneId);
        this.#acceptScene(scene);
        if (sceneIsTerminal(scene)) return;
      } catch (error) {
        this.#showConnectionFailure(error, 'poll');
      }
      if (this.polling) this.pollTimer = window.setTimeout(poll, 2_500);
    };
    window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(poll, 250);
  }

  stopWatching() {
    this.eventSource?.close();
    this.eventSource = null;
    this.polling = false;
    window.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.editorialUi?.stopWatching();
  }

  async cancel() {
    if (this.actionPending || !sceneCanCancel(this.scene)) return;
    this.actionPending = true;
    this.#syncActionButtons();
    try {
      this.#acceptScene(await cancelProfileScene(this.scene.scene_id));
    } catch (error) {
      this.#showConnectionFailure(error, 'cancel');
    } finally {
      this.actionPending = false;
      this.#syncActionButtons();
    }
  }

  async retry() {
    if (this.actionPending || !sceneCanRetry(this.scene)) return;
    this.actionPending = true;
    this.#syncActionButtons();
    try {
      const scene = await retryProfileScene(this.scene.scene_id, randomKey('scene-retry'));
      this.phaseHistory = [];
      this.#acceptScene(scene);
      this.watch(scene.scene_id);
    } catch (error) {
      this.#showConnectionFailure(error, 'retry');
    } finally {
      this.actionPending = false;
      this.#syncActionButtons();
    }
  }

  async remove() {
    if (this.actionPending || !sceneCanDelete(this.scene)) return;
    if (!globalThis.confirm?.('Видалити цю сцену та її файл?')) return;
    this.actionPending = true;
    this.#syncActionButtons();
    try {
      await deleteProfileScene(this.scene.scene_id);
      clearSceneResume();
      this.resumeRecord = null;
      this.scene = null;
      this.stopWatching();
      history.replaceState({}, '', location.pathname);
      await this.renderProfile();
    } catch (error) {
      this.#showConnectionFailure(error, 'delete');
    } finally {
      this.actionPending = false;
      this.#syncActionButtons();
    }
  }

  async reconnect() {
    if (this.scene?.scene_id) {
      try {
        const scene = await loadProfileScene(this.scene.scene_id);
        this.#acceptScene(scene);
        this.watch(scene.scene_id);
      } catch (error) {
        this.#showConnectionFailure(error, 'reconnect');
      }
      return;
    }
    await this.#createFromResume();
  }

  async openExisting(sceneProjection, look = null) {
    const sceneId = sceneProjection?.scene_id;
    if (!sceneId) return;
    this.stopWatching();
    this.phaseHistory = [];
    if (look) this.#setLook(look);
    this.#showConnecting('FETCHING_SCENE', 'Відновлюємо останній стан із сервера');
    try {
      await this.#ensurePresets().catch(() => []);
      const scene = await loadProfileScene(sceneId);
      this.resumeRecord = writeSceneResume({
        scene_id: scene.scene_id,
        look_id: scene.approved_look.look_id,
        preset_id: scene.preset.preset_id,
        preset_version: scene.preset.version,
        reference_pack_sha256: scene.preset.reference_pack_sha256 ?? null,
        idempotency_key: randomKey('scene-resume'),
      });
      this.#acceptScene(scene);
      this.watch(scene.scene_id);
    } catch (error) {
      this.#showConnectionFailure(error, 'open_existing');
    }
  }

  async resume({ allowStored = true } = {}) {
    const query = new URLSearchParams(location.search);
    const queryShootId = query.get('shoot');
    const querySceneId = query.get('scene');
    if (queryShootId && await this.editorialUi.resume({ allowStored: false })) return true;
    if (!querySceneId && allowStored && await this.editorialUi.resume()) return true;
    let resume = allowStored ? readSceneResume() : null;
    if (!resume && !querySceneId) return false;
    this.resumeRecord = resume;
    this.#showConnecting(
      resume?.scene_id || querySceneId ? 'FETCHING_SCENE' : 'REPLAYING_SCENE_REQUEST',
      'Відновлюємо scene job без повторної генерації образу',
    );
    try {
      const [profile] = await Promise.all([
        this.loadProfile(),
        this.#ensurePresets().catch(() => []),
      ]);
      const lookId = resume?.look_id;
      if (lookId) this.#setLook(lookDescriptor(profile, lookId));

      if (resume?.scene_id || querySceneId) {
        const scene = await loadProfileScene(resume?.scene_id || querySceneId);
        if (!this.look) this.#setLook(lookDescriptor(profile, scene.approved_look.look_id));
        if (!resume) {
          resume = writeSceneResume({
            scene_id: scene.scene_id,
            look_id: scene.approved_look.look_id,
            preset_id: scene.preset.preset_id,
            preset_version: scene.preset.version,
            reference_pack_sha256: scene.preset.reference_pack_sha256 ?? null,
            idempotency_key: randomKey('scene-resume'),
          });
          this.resumeRecord = resume;
        }
        this.#acceptScene(scene);
        this.watch(scene.scene_id);
      } else {
        await this.#createFromResume();
      }
      return true;
    } catch (error) {
      if (error?.status === 404 && (resume?.scene_id || querySceneId)) {
        clearSceneResume();
        history.replaceState({}, '', location.pathname);
        this.resumeRecord = null;
        return false;
      }
      this.#showConnectionFailure(error, 'resume');
      return true;
    }
  }

  async back() {
    if (this.#element('.scene-shell').dataset.mode === 'editorial') {
      await this.editorialUi.back();
      return;
    }
    const terminal = sceneIsTerminal(this.scene);
    this.stopWatching();
    if (terminal) {
      clearSceneResume();
      this.resumeRecord = null;
    }
    history.replaceState({}, '', location.pathname);
    await this.renderProfile();
  }
}

export function createSceneUi(options) {
  return new SceneUiController(options);
}
