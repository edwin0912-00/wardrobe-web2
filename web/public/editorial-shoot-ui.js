import {
  approveProfileEditorialBible,
  approveProfileEditorialHero,
  cancelProfileEditorialShoot,
  createProfileEditorialShoot,
  deleteProfileEditorialShoot,
  loadProfileEditorialShoot,
  loadProfileEditorialShootBible,
  retryProfileEditorialShot,
} from './profile-client.js?v=20260724-5';
import {
  clearEditorialResume,
  editorialCanCancel,
  editorialCanDelete,
  editorialIsTerminal,
  editorialResumeFromSnapshot,
  editorialShotLabel,
  editorialTone,
  readEditorialResume,
  safeEditorialOutputUrl,
  writeEditorialResume,
} from './editorial-state.js?v=20260724-1';

function idOfLook(look) {
  return look?.look_id ?? look?.id ?? null;
}

function randomKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function modeVersion(mode) {
  return mode?.mode_version ?? mode?.version ?? null;
}

function modeName(mode) {
  const modeId = mode?.mode_id;
  return mode?.ui_name_uk || ({
    'editorial.edwin_novak.organic_contrast': 'Органічний контраст',
    'editorial.edwin_novak.urban_monochrome': 'Міський монохром',
    'editorial.edwin_novak.institutional_modernism': 'Інституційний модернізм',
    'editorial.edwin_novak.luminous_blue_white': 'Світлий синьо-білий',
  })[modeId] || 'Fashion Shoot';
}

function outputImageUrl(output) {
  return safeEditorialOutputUrl(
    output?.image_url ?? output?.urls?.image ?? output?.url ?? null,
  );
}

function outputDownloadUrl(output) {
  return safeEditorialOutputUrl(
    output?.download_url
      ?? output?.urls?.download
      ?? output?.image_url
      ?? output?.urls?.image
      ?? output?.url
      ?? null,
  );
}

function modePreviewUrl(mode) {
  const direct = String(mode?.preview_url ?? '');
  if (direct.startsWith('/api/editorial-modes/')) return direct;
  const modeId = String(mode?.mode_id ?? '');
  const version = String(mode?.mode_version ?? mode?.version ?? '');
  if (!modeId || !version) return null;
  return `/api/editorial-modes/${encodeURIComponent(modeId)}/${encodeURIComponent(version)}/preview`;
}

// The first engine slot proves that the saved person and approved look still
// hold under the selected style. It is a QA prerequisite, never one of the
// five Fashion Shoot photographs the user receives.
const INTERNAL_STYLE_CHECK_SLOT = 'clean_identity_hero';

function fashionFrames(shoot) {
  return (Array.isArray(shoot?.shots) ? shoot.shots : [])
    .filter((shot) => shot?.slot !== INTERNAL_STYLE_CHECK_SLOT);
}

function displayShotStatus(status) {
  return ({
    BLOCKED: 'Очікує первинну перевірку образу',
    QUEUED: 'У черзі',
    RUNNING: 'Створюється',
    QA_PASSED: 'QA пройдено',
    APPROVED: 'Готово',
    FAILED: 'Потрібен retry',
    CANCELLED: 'Зупинено',
  })[status] ?? String(status ?? 'Очікує');
}

function displayShootMessage(shoot) {
  const phase = shoot?.phase;
  const status = shoot?.status;
  return ({
    BIBLE_REVIEW: 'Готуємо вибраний стиль.',
    HERO_GENERATION: 'Перевіряємо образ перед зйомкою.',
    HERO_RETRY: 'Повторюємо перевірку образу.',
    HERO_APPROVAL: 'Образ пройшов перевірку. Створюємо п’ять кадрів.',
    SERIES_GENERATION: 'Створюємо п’ять унікальних fashion-кадрів паралельно по два.',
    SHOT_RETRY: 'Готові кадри збережено. Повтори лише кадри, які не пройшли QA.',
    RECOVERY_QUEUED: 'Після перезапуску продовжуємо незавершені кадри без повтору готових.',
    COMPLETED: 'Усі п’ять fashion-кадрів готові та пройшли QA.',
    CANCELLED: 'Фотосесію зупинено. Уже готові кадри збережено.',
  })[phase] ?? ({
    BIBLE_PENDING_APPROVAL: 'Готуємо вибраний стиль.',
    HERO_RUNNING: 'Перевіряємо образ перед зйомкою.',
    HERO_PENDING_APPROVAL: 'Образ пройшов перевірку. Створюємо п’ять кадрів.',
    SERIES_RUNNING: 'Створюємо п’ять унікальних fashion-кадрів паралельно по два.',
    NEEDS_RETRY: 'Один або кілька кадрів потрібно повторити окремо.',
    COMPLETED: 'Усі п’ять fashion-кадрів готові та пройшли QA.',
    CANCELLED: 'Фотосесію зупинено. Уже готові кадри збережено.',
  })[status] ?? 'Стан фотосесії оновлено.';
}

function displayShootState(status) {
  return ({
    BIBLE_PENDING_APPROVAL: 'ПІДГОТОВКА',
    HERO_RUNNING: 'ПЕРЕВІРКА ОБРАЗУ',
    HERO_PENDING_APPROVAL: 'ЗАПУСК КАДРІВ',
    SERIES_RUNNING: 'СТВОРЮЄМО',
    NEEDS_RETRY: 'ПОТРІБЕН ПОВТОР',
    COMPLETED: 'ГОТОВО',
    CANCELLED: 'ЗУПИНЕНО',
  })[status] ?? 'ОНОВЛЮЄМО СТАН';
}

function modeFromShoot(shoot) {
  return {
    mode_id: shoot?.bindings?.shoot_bible?.mode_id ?? shoot?.mode?.mode_id ?? shoot?.mode_id,
    version: shoot?.bindings?.shoot_bible?.mode_version
      ?? shoot?.mode?.mode_version
      ?? shoot?.mode?.version
      ?? shoot?.mode_version,
    ui_name_uk: shoot?.mode?.ui_name_uk,
    visual_system: shoot?.mode?.visual_system,
    generation_available: true,
    source_set_status: 'READY',
  };
}

function lookFromShoot(shoot) {
  const lookId = shoot?.bindings?.approved_look?.look_id
    ?? shoot?.approved_look?.look_id
    ?? shoot?.look_id
    ?? null;
  return lookId ? {
    look_id: lookId,
    image_url: `/api/profile/looks/${encodeURIComponent(lookId)}/image`,
  } : null;
}

export class EditorialShootUiController {
  constructor({
    activate,
    setLook,
    loadProfile,
    renderProfile,
    humanize = (value) => String(value ?? ''),
    telemetry = () => {},
  }) {
    this.activate = activate;
    this.setLook = setLook;
    this.loadProfile = loadProfile;
    this.renderProfile = renderProfile;
    this.humanize = humanize;
    this.telemetry = telemetry;
    this.shoot = null;
    this.bible = null;
    this.bibleSha256 = null;
    this.look = null;
    this.mode = null;
    this.resumeRecord = null;
    this.eventSource = null;
    this.pollTimer = null;
    this.polling = false;
    this.actionPending = false;
    this.connectionFailed = false;
    this.bibleRequest = null;
    this.#bind();
  }

  #element(selector) {
    return document.querySelector(selector);
  }

  #bind() {
    this.#element('#editorial-approve-bible').addEventListener('click', () => this.approveBible());
    this.#element('#editorial-approve-hero').addEventListener('click', () => this.approveHero());
    this.#element('#editorial-cancel-bible').addEventListener('click', () => this.cancel());
    this.#element('#editorial-cancel').addEventListener('click', () => this.cancel());
    this.#element('#editorial-delete').addEventListener('click', () => this.remove());
    this.#element('#editorial-reconnect').addEventListener('click', () => this.reconnect());
    this.#element('#editorial-shot-inspector-close').addEventListener(
      'click',
      () => this.#closeShotInspector(),
    );
    this.#element('#editorial-shot-inspector').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) this.#closeShotInspector();
    });
  }

  #setHeader(title, status, tone = 'running') {
    this.#element('#scene-execution-title').textContent = title;
    const chip = this.#element('#scene-server-status');
    chip.textContent = status;
    chip.dataset.tone = tone;
  }

  #setError(message = '') {
    const element = this.#element('#editorial-error');
    element.textContent = this.humanize(message);
    element.hidden = !message;
  }

  #show() {
    this.activate();
    this.#element('#editorial-shoot').classList.remove('hidden');
  }

  #showConnecting(phase, message) {
    this.#show();
    this.#setHeader('Fashion Shoot', 'ПІДГОТОВКА');
    this.#element('#editorial-phase').textContent = 'ПІДГОТОВКА';
    this.#element('#editorial-message').textContent = message;
    this.#element('#editorial-connection').textContent = 'З’ЄДНУЄМОСЯ ІЗ СЕРВЕРОМ';
    this.#element('#editorial-bible-stage').hidden = true;
    this.#element('#editorial-gallery-stage').hidden = false;
    this.#element('#editorial-gallery').replaceChildren();
    this.#renderActionButtons();
  }

  #showConnectionFailure(error, stage) {
    this.#show();
    this.#setError(error?.message || 'Не вдалося з’єднатися із сервером');
    this.#element('#editorial-connection').textContent = 'CONNECTION LOST';
    this.connectionFailed = true;
    this.#element('#editorial-reconnect').hidden = false;
    this.telemetry('client.editorial_error', {
      shoot_id: this.shoot?.shoot_id,
      stage,
      message: String(error?.message ?? error).slice(0, 500),
    });
  }

  hasResumeForLook(lookId) {
    return readEditorialResume()?.look_id === lookId;
  }

  resumeProjectionForLook(lookId) {
    const resume = readEditorialResume();
    if (!resume || resume.look_id !== lookId || !resume.shoot_id) return null;
    return {
      shoot_id: resume.shoot_id,
      look_id: resume.look_id,
      mode: {
        mode_id: resume.mode_id,
        mode_version: resume.mode_version,
      },
      status: this.shoot?.shoot_id === resume.shoot_id ? this.shoot.status : 'SAVED',
      source: 'browser_resume',
    };
  }

  async openStoredForLook(look) {
    const resume = readEditorialResume();
    if (!resume || resume.look_id !== idOfLook(look)) return false;
    this.look = look;
    this.setLook(look);
    return this.resume();
  }

  async openExisting(projection, look) {
    const shootId = projection?.shoot_id ?? projection?.id;
    if (!shootId) throw new Error('Збережений Fashion Shoot не знайдено');
    this.stopWatching();
    this.look = look;
    this.setLook(look);
    this.#showConnecting('FETCHING_EDITORIAL_SHOOT', 'Відновлюємо збережені кадри із сервера');
    const shoot = await loadProfileEditorialShoot(shootId);
    const fromShoot = modeFromShoot(shoot);
    const mode = {
      ...projection?.mode,
      ...fromShoot,
      mode_id: fromShoot.mode_id ?? projection?.mode?.mode_id ?? projection?.mode_id,
      version: modeVersion(fromShoot)
        ?? modeVersion(projection?.mode)
        ?? projection?.mode_version,
    };
    this.mode = mode;
    this.resumeRecord = writeEditorialResume({
      shoot_id: shoot.shoot_id,
      look_id: idOfLook(look) ?? lookFromShoot(shoot)?.look_id,
      mode_id: mode.mode_id,
      mode_version: modeVersion(mode),
      create_idempotency_key: randomKey('editorial-resume'),
      pending_action: null,
    });
    this.#acceptShoot(shoot);
  }

  async openForMode(mode, look) {
    const lookId = idOfLook(look);
    const version = modeVersion(mode);
    if (!lookId) throw new Error('Збережений образ не знайдено');
    if (mode?.source_set_status !== 'READY' || mode?.generation_available !== true) {
      throw new Error('Цей напрям Fashion Shoot ще не готовий до генерації');
    }
    if (!version) throw new Error('Версію Fashion Shoot напряму не опубліковано');
    this.stopWatching();
    this.shoot = null;
    this.bible = null;
    this.bibleSha256 = null;
    this.look = look;
    this.mode = mode;
    this.setLook(look);
    this.#setError('');
    this.resumeRecord = writeEditorialResume({
      shoot_id: null,
      look_id: lookId,
      mode_id: mode.mode_id,
      mode_version: version,
      create_idempotency_key: randomKey('editorial-create'),
      pending_action: {
        type: 'create',
        idempotency_key: randomKey('editorial-create-action'),
        expected_sha256: null,
        slot: null,
      },
    });
    this.#showConnecting('BINDING_STYLE_PACK', 'Фіксуємо збережений образ і вибраний стиль.');
    await this.#createFromResume();
  }

  async #createFromResume() {
    if (this.actionPending || !this.resumeRecord) return;
    this.actionPending = true;
    this.#renderActionButtons();
    try {
      const shoot = await createProfileEditorialShoot(this.resumeRecord.look_id, {
        modeId: this.resumeRecord.mode_id,
        modeVersion: this.resumeRecord.mode_version,
        idempotencyKey: this.resumeRecord.create_idempotency_key,
      });
      this.#acceptShoot(shoot);
      this.telemetry('client.editorial_created', {
        shoot_id: shoot.shoot_id,
        look_id: this.resumeRecord.look_id,
        mode_id: this.resumeRecord.mode_id,
        stage: shoot.phase,
      });
    } catch (error) {
      this.#showConnectionFailure(error, 'create');
    } finally {
      this.actionPending = false;
      this.#renderActionButtons();
    }
  }

  #acceptShoot(shoot) {
    if (!shoot?.shoot_id) throw new Error('Сервер повернув фотосесію без shoot_id');
    this.shoot = shoot;
    this.connectionFailed = false;
    this.mode = {
      ...modeFromShoot(shoot),
      ...this.mode,
      mode_id: shoot.bindings?.shoot_bible?.mode_id ?? this.mode?.mode_id,
      version: shoot.bindings?.shoot_bible?.mode_version ?? modeVersion(this.mode),
    };
    if (!this.look) {
      this.look = lookFromShoot(shoot);
      if (this.look) this.setLook(this.look);
    }
    const previous = this.resumeRecord ?? {
      shoot_id: shoot.shoot_id,
      look_id: shoot.bindings?.approved_look?.look_id,
      mode_id: shoot.bindings?.shoot_bible?.mode_id,
      mode_version: shoot.bindings?.shoot_bible?.mode_version,
      create_idempotency_key: randomKey('editorial-resume'),
      pending_action: null,
    };
    const normalized = editorialResumeFromSnapshot(shoot, previous);
    if (normalized) this.resumeRecord = writeEditorialResume(normalized);
    history.replaceState({}, '', `${location.pathname}?shoot=${encodeURIComponent(shoot.shoot_id)}`);
    this.#setError('');
    this.#renderShoot();
    if (shoot.status === 'BIBLE_PENDING_APPROVAL') this.#ensureBible();
    if (this.#shouldWatch(shoot)) this.watch(shoot.shoot_id);
    else this.stopWatching();
  }

  #shouldWatch(shoot) {
    return ['HERO_RUNNING', 'SERIES_RUNNING'].includes(shoot?.status)
      || shoot?.shots?.some((shot) => ['QUEUED', 'RUNNING'].includes(shot.status));
  }

  async #ensureBible() {
    if (!this.shoot?.shoot_id || this.bible || this.bibleRequest) return;
    this.bibleRequest = loadProfileEditorialShootBible(this.shoot.shoot_id)
      .then((response) => {
        this.bible = response?.bible ?? response;
        this.bibleSha256 = response?.sha256
          ?? response?.bible_sha256
          ?? response?.binding?.sha256
          ?? null;
        this.#renderBible();
      })
      .catch((error) => this.#showConnectionFailure(error, 'bible'))
      .finally(() => { this.bibleRequest = null; });
    await this.bibleRequest;
  }

  #renderShoot() {
    const shoot = this.shoot;
    this.#show();
    const bibleReview = shoot.status === 'BIBLE_PENDING_APPROVAL';
    // The style is visible as a visual reference throughout the job. The
    // internal six-slot Bible remains a server artifact; it is never rendered
    // as a customer-facing approval or sixth output.
    this.#element('#editorial-bible-stage').hidden = false;
    this.#element('#editorial-gallery-stage').hidden = false;
    this.#element('#editorial-phase').textContent = displayShootState(shoot.status);
    this.#element('#editorial-message').textContent = displayShootMessage(shoot);
    this.#element('#editorial-connection').textContent = 'СТАН ОНОВЛЮЄТЬСЯ';
    this.#element('#editorial-mode-name').textContent = modeName(this.mode);
    this.#setHeader('Fashion Shoot', displayShootState(shoot.status), editorialTone(shoot));
    this.#renderGallery();
    this.#renderActionButtons();
    if (bibleReview) void this.#autoApproveBible();
    if (shoot.status === 'HERO_PENDING_APPROVAL') void this.#autoApproveHero();
  }

  // The plan is still hash-confirmed with the exact SHA the server produced —
  // the confirmation simply is not a human click any more.
  async #autoApproveBible() {
    if (this.autoBibleApproved || this.actionPending) return;
    if (this.shoot?.status !== 'BIBLE_PENDING_APPROVAL') return;
    if (!this.bible && !this.bibleSha256) {
      await this.#ensureBible().catch(() => {});
      if (this.shoot?.status !== 'BIBLE_PENDING_APPROVAL') return;
    }
    this.autoBibleApproved = true;
    try {
      await this.approveBible();
    } catch {
      // A failed auto-approval must not strand the screen: the action button
      // stays available and the next poll retries.
      this.autoBibleApproved = false;
    }
  }

  #renderBible() {
    const title = modeName(this.mode);
    const system = 'Світло, локація та подача вже зафіксовані для цієї фотозйомки.';
    const preview = this.#element('#editorial-style-preview-image');
    this.#element('#editorial-bible-title').textContent = title;
    this.#element('#editorial-bible-system').textContent = system;
    const url = modePreviewUrl(this.mode);
    if (url) {
      preview.src = url;
      preview.hidden = false;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
  }

  #renderGallery() {
    const shots = fashionFrames(this.shoot);
    const completed = shots.filter(
      (shot) => ['QA_PASSED', 'APPROVED'].includes(shot.status),
    ).length;
    const meter = this.#element('#editorial-progress-meter');
    meter.value = completed;
    this.#element('#editorial-series-progress').textContent = `${completed}/5 fashion-кадрів готово`;
    this.#element('#editorial-progress-detail').textContent = completed === 5
      ? 'Усі кадри пройшли QA'
      : displayShootMessage(this.shoot);
    const cards = shots.map((shot, index) => {
      const card = document.createElement('article');
      card.className = 'editorial-shot-card';
      card.dataset.status = shot.status ?? 'BLOCKED';
      card.dataset.slot = shot.slot;
      const visual = document.createElement('div');
      visual.className = 'editorial-shot-visual';
      const imageUrl = outputImageUrl(shot.output);
      if (imageUrl) {
        const inspect = document.createElement('button');
        inspect.type = 'button';
        inspect.className = 'editorial-shot-inspect';
        inspect.setAttribute(
          'aria-label',
          `Переглянути повний кадр: ${editorialShotLabel(shot.slot)}`,
        );
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = `${editorialShotLabel(shot.slot)} — ${displayShotStatus(shot.status)}`;
        image.loading = index === 0 ? 'eager' : 'lazy';
        inspect.append(image);
        inspect.addEventListener('click', () => this.#openShotInspector({
          imageUrl,
          downloadUrl: outputDownloadUrl(shot.output),
          label: editorialShotLabel(shot.slot),
        }));
        visual.append(inspect);
      } else {
        const state = document.createElement('span');
        state.textContent = shot.status === 'RUNNING'
          ? 'Створюємо кадр'
          : shot.status === 'QUEUED'
            ? 'Кадр у черзі'
            : 'Готуємо кадр';
        visual.append(state);
      }
      const showCaption = Boolean(imageUrl) || shot.status === 'FAILED';
      const caption = document.createElement('footer');
      if (showCaption) {
        const title = document.createElement('strong');
        title.textContent = `Кадр ${String(index + 1).padStart(2, '0')}`;
        const status = document.createElement('small');
        status.textContent = displayShotStatus(shot.status);
        caption.append(title, status);
      } else {
        card.classList.add('is-pending');
      }
      const downloadUrl = outputDownloadUrl(shot.output);
      if (downloadUrl) {
        const download = document.createElement('a');
        download.href = downloadUrl;
        download.download = `${shot.slot}.png`;
        download.setAttribute('aria-label', `Завантажити ${editorialShotLabel(shot.slot)}`);
        download.textContent = '↓';
        caption.append(download);
      }
      if (shot.status === 'FAILED') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'editorial-shot-retry';
        retry.textContent = 'Повторити кадр';
        retry.disabled = this.actionPending;
        retry.addEventListener('click', () => this.retryShot(shot.slot));
        visual.append(retry);
      }
      card.append(visual);
      if (showCaption) card.append(caption);
      return card;
    });
    this.#element('#editorial-gallery').replaceChildren(...cards);
  }

  #openShotInspector({ imageUrl, downloadUrl, label }) {
    const dialog = this.#element('#editorial-shot-inspector');
    const image = this.#element('#editorial-shot-inspector-image');
    const title = this.#element('#editorial-shot-inspector-title');
    const download = this.#element('#editorial-shot-inspector-download');
    image.src = imageUrl;
    image.alt = `${label} — повний кадр 4:5`;
    title.textContent = label;
    download.href = downloadUrl ?? imageUrl;
    download.download = `${this.shoot?.shoot_id ?? 'art-fashion'}-${label}.png`;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  #closeShotInspector() {
    const dialog = this.#element('#editorial-shot-inspector');
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  #renderActionButtons() {
    const shoot = this.shoot;
    const pending = this.actionPending;
    const approveBible = this.#element('#editorial-approve-bible');
    const approveHero = this.#element('#editorial-approve-hero');
    const cancel = this.#element('#editorial-cancel');
    const cancelBible = this.#element('#editorial-cancel-bible');
    const remove = this.#element('#editorial-delete');
    approveBible.hidden = true;
    // The initial style check is an internal QA barrier. Its exact hash is
    // still bound before output frames begin, but it is never a user decision.
    approveHero.hidden = true;
    cancel.hidden = !editorialCanCancel(shoot);
    cancelBible.hidden = shoot?.status !== 'BIBLE_PENDING_APPROVAL';
    remove.hidden = !editorialCanDelete(shoot);
    for (const button of [approveBible, approveHero, cancel, cancelBible, remove]) {
      button.disabled = pending;
    }
    this.#element('#editorial-reconnect').hidden = !this.connectionFailed;
  }

  #pendingAction(type, { expectedSha256 = null, slot = null } = {}) {
    const action = {
      type,
      idempotency_key: randomKey(`editorial-${type}`),
      expected_sha256: expectedSha256,
      slot,
    };
    this.resumeRecord = writeEditorialResume({
      ...this.resumeRecord,
      pending_action: action,
    });
    return action;
  }

  async approveBible() {
    const expectedSha256 = this.shoot?.bindings?.shoot_bible?.sha256
      ?? this.shoot?.shoot_bible?.sha256
      ?? this.shoot?.bible?.sha256
      ?? this.shoot?.bible_sha256
      ?? this.bibleSha256;
    if (this.actionPending || this.shoot?.status !== 'BIBLE_PENDING_APPROVAL' || !expectedSha256) return;
    const action = this.#pendingAction('approve_bible', { expectedSha256 });
    await this.#executeAction(async () => approveProfileEditorialBible(this.shoot.shoot_id, {
      expectedBibleSha256: expectedSha256,
      idempotencyKey: action.idempotency_key,
    }), 'approve_bible');
  }

  async approveHero() {
    const expectedSha256 = this.shoot?.shots?.[0]?.output?.sha256;
    if (this.actionPending || this.shoot?.status !== 'HERO_PENDING_APPROVAL' || !expectedSha256) return;
    const action = this.#pendingAction('approve_hero', { expectedSha256 });
    await this.#executeAction(async () => approveProfileEditorialHero(this.shoot.shoot_id, {
      expectedOutputSha256: expectedSha256,
      idempotencyKey: action.idempotency_key,
    }), 'approve_hero');
  }

  async #autoApproveHero() {
    if (this.autoHeroApproved || this.actionPending) return;
    if (this.shoot?.status !== 'HERO_PENDING_APPROVAL') return;
    if (!this.shoot?.shots?.[0]?.output?.sha256) return;
    this.autoHeroApproved = true;
    try {
      await this.approveHero();
    } catch {
      // Preserve the immutable server state and retry through normal reconnect
      // handling; do not replace the approved look or create a second job.
      this.autoHeroApproved = false;
    }
  }

  async retryShot(slot) {
    const shot = this.shoot?.shots?.find((item) => item.slot === slot);
    if (this.actionPending || shot?.status !== 'FAILED') return;
    const action = this.#pendingAction('retry_shot', { slot });
    await this.#executeAction(
      async () => retryProfileEditorialShot(this.shoot.shoot_id, slot, action.idempotency_key),
      'retry_shot',
    );
  }

  async #executeAction(operation, stage) {
    this.actionPending = true;
    this.#renderActionButtons();
    try {
      const shoot = await operation();
      this.#acceptShoot(shoot);
      this.telemetry('client.editorial_action', {
        shoot_id: shoot.shoot_id,
        action: stage,
        stage: shoot.phase,
      });
    } catch (error) {
      this.#showConnectionFailure(error, stage);
    } finally {
      this.actionPending = false;
      this.#renderActionButtons();
    }
  }

  watch(shootId) {
    if (!shootId || editorialIsTerminal(this.shoot) || !this.#shouldWatch(this.shoot)) return;
    if (this.eventSource || this.polling) return;
    if (typeof EventSource !== 'function') {
      this.#beginPolling(shootId);
      return;
    }
    this.polling = false;
    const source = new EventSource(
      `/api/profile/editorial-shoots/${encodeURIComponent(shootId)}/events`,
    );
    this.eventSource = source;
    const acceptEvent = (event) => {
      try {
        const body = JSON.parse(event.data);
        const shoot = body?.shoot ?? body?.editorial_shoot ?? body;
        if (shoot?.shoot_id) this.#acceptShoot(shoot);
      } catch (error) {
        this.#showConnectionFailure(error, 'sse_parse');
        this.#beginPolling(shootId);
      }
    };
    source.onmessage = acceptEvent;
    source.addEventListener('shoot', acceptEvent);
    source.addEventListener('editorial-shoot', acceptEvent);
    source.onerror = () => {
      if (editorialIsTerminal(this.shoot)) return this.stopWatching();
      this.#beginPolling(shootId);
    };
  }

  #beginPolling(shootId) {
    this.eventSource?.close();
    this.eventSource = null;
    this.polling = true;
    this.#element('#editorial-connection').textContent = 'ОНОВЛЮЄМО СТАН';
    const poll = async () => {
      if (!this.polling) return;
      try {
        const shoot = await loadProfileEditorialShoot(shootId);
        this.#acceptShoot(shoot);
        if (!this.#shouldWatch(shoot)) return;
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
  }

  async cancel() {
    if (this.actionPending || !editorialCanCancel(this.shoot)) return;
    if (!globalThis.confirm?.('Зупинити незавершені кадри? Уже готові кадри залишаться.')) return;
    await this.#executeAction(
      async () => cancelProfileEditorialShoot(this.shoot.shoot_id),
      'cancel',
    );
  }

  async remove() {
    if (this.actionPending || !editorialCanDelete(this.shoot)) return;
    if (!globalThis.confirm?.('Видалити цю фотосесію та всі шість файлів?')) return;
    this.actionPending = true;
    this.#renderActionButtons();
    try {
      await deleteProfileEditorialShoot(this.shoot.shoot_id);
      clearEditorialResume();
      this.stopWatching();
      this.shoot = null;
      this.bible = null;
      this.bibleSha256 = null;
      this.resumeRecord = null;
      this.#closeShotInspector();
      history.replaceState({}, '', location.pathname);
      await this.renderProfile();
    } catch (error) {
      this.#showConnectionFailure(error, 'delete');
    } finally {
      this.actionPending = false;
      this.#renderActionButtons();
    }
  }

  async reconnect() {
    if (!this.resumeRecord) return;
    if (!this.resumeRecord.shoot_id) return this.#createFromResume();
    try {
      const shoot = await loadProfileEditorialShoot(this.resumeRecord.shoot_id);
      this.#acceptShoot(shoot);
      await this.#replayPendingAction();
    } catch (error) {
      this.#showConnectionFailure(error, 'reconnect');
    }
  }

  async #replayPendingAction() {
    const action = this.resumeRecord?.pending_action;
    if (!action) return;
    if (action.type === 'create') return this.#createFromResume();
    const shootId = this.resumeRecord.shoot_id;
    if (!shootId) return;
    const operations = {
      approve_bible: () => approveProfileEditorialBible(shootId, {
        expectedBibleSha256: action.expected_sha256,
        idempotencyKey: action.idempotency_key,
      }),
      approve_hero: () => approveProfileEditorialHero(shootId, {
        expectedOutputSha256: action.expected_sha256,
        idempotencyKey: action.idempotency_key,
      }),
      retry_shot: () => retryProfileEditorialShot(
        shootId,
        action.slot,
        action.idempotency_key,
      ),
    };
    const operation = operations[action.type];
    if (!operation) return;
    await this.#executeAction(operation, `${action.type}_replay`);
  }

  async resume() {
    let resume = readEditorialResume();
    const queryShootId = new URLSearchParams(location.search).get('shoot');
    if (!resume && !queryShootId) return false;
    this.resumeRecord = resume;
    this.#showConnecting(
      resume?.shoot_id || queryShootId ? 'FETCHING_EDITORIAL_SHOOT' : 'REPLAYING_EDITORIAL_CREATE',
      'Відновлюємо фотосесію без повторної генерації master-образу',
    );
    try {
      if (!resume && queryShootId) {
        const shoot = await loadProfileEditorialShoot(queryShootId);
        const fallbackMode = modeFromShoot(shoot);
        const fallbackLook = lookFromShoot(shoot);
        if (!fallbackLook || !fallbackMode.mode_id || !modeVersion(fallbackMode)) {
          throw new Error('Фотосесія не містить прив’язки до збереженого образу');
        }
        this.look = fallbackLook;
        this.mode = fallbackMode;
        this.setLook(fallbackLook);
        this.resumeRecord = writeEditorialResume({
          shoot_id: shoot.shoot_id,
          look_id: fallbackLook.look_id,
          mode_id: fallbackMode.mode_id,
          mode_version: modeVersion(fallbackMode),
          create_idempotency_key: randomKey('editorial-resume'),
          pending_action: null,
        });
        this.#acceptShoot(shoot);
        return true;
      }
      if (resume?.look_id) {
        const profile = await this.loadProfile().catch(() => null);
        const looks = Array.isArray(profile?.looks)
          ? profile.looks
          : (profile?.avatars ?? []).flatMap((avatar) => avatar.looks ?? []);
        this.look = looks.find((look) => idOfLook(look) === resume.look_id) ?? {
          look_id: resume.look_id,
          image_url: `/api/profile/looks/${encodeURIComponent(resume.look_id)}/image`,
        };
        this.setLook(this.look);
      }
      if (!resume?.shoot_id) {
        this.mode = {
          mode_id: resume.mode_id,
          version: resume.mode_version,
          generation_available: true,
          source_set_status: 'READY',
        };
        await this.#createFromResume();
        return true;
      }
      const shoot = await loadProfileEditorialShoot(resume.shoot_id);
      this.mode = modeFromShoot(shoot);
      this.#acceptShoot(shoot);
      if (resume.pending_action) {
        this.resumeRecord = writeEditorialResume({
          ...this.resumeRecord,
          pending_action: resume.pending_action,
        });
        await this.#replayPendingAction();
      }
      return true;
    } catch (error) {
      if (error?.status === 404 && (resume?.shoot_id || queryShootId)) {
        clearEditorialResume();
        history.replaceState({}, '', location.pathname);
        this.resumeRecord = null;
        return false;
      }
      this.#showConnectionFailure(error, 'resume');
      return true;
    }
  }

  async back() {
    this.stopWatching();
    this.#closeShotInspector();
    history.replaceState({}, '', location.pathname);
    await this.renderProfile();
  }
}

export function createEditorialShootUi(options) {
  return new EditorialShootUiController(options);
}
