/**
 * Presentation policy between ZeelyClient and any cinematic site.
 *
 * This module owns product state, never DOM, CSS, scroll position or a host name.
 * The active site may be replaced wholesale while this bridge continues to use
 * the same relative `/api` contract.
 */
import { createZeelyClient, phaseFor } from './zeely-client.mjs';

const ACTIVE_PHASES = new Set([
  'uploading', 'running', 'needs_input', 'waiting_for_approval', 'recovering',
]);

export const MIRROR_COPY = Object.freeze({
  checking: 'Відкриваємо дзеркало',
  auth_required: 'Ця частина простору ще закрита',
  unavailable: 'Ця частина простору ще готується',
  uploading: 'Приймаємо матеріали',
  running: 'Створюємо результат',
  needs_input: 'Оберіть речі',
  waiting_for_approval: 'Останній погляд перед продовженням',
  recovering: 'Повертаємося до результату',
  completed: 'Готово',
  failed: 'Не вдалося завершити',
});

export class CinematicUiBridgeError extends Error {
  constructor(code, message = MIRROR_COPY.unavailable, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CinematicUiBridgeError';
    this.code = code;
  }
}

function clone(value) {
  return structuredClone(value);
}

function initialState() {
  return {
    availability: 'checking',
    releaseSha: null,
    phase: 'idle',
    activeKind: null,
    profile: null,
    run: null,
    savedLook: null,
    choices: [],
    scene: null,
    shoot: null,
    video: null,
    liveCapability: null,
    catalogs: { backgrounds: [], shoots: [], videos: [] },
    result: null,
    error: null,
    updatedAt: null,
  };
}

function runChoices(run) {
  return (run?.conflicts ?? [])
    .filter((conflict) => conflict?.type === 'DUPLICATE_SLOT')
    .map((conflict) => ({
      category: String(conflict.category ?? ''),
      options: (conflict.reference_set_ids ?? []).map((referenceSetId) => {
        const id = String(referenceSetId);
        const garment = (run?.garments ?? []).find((item) => (
          item?.reference_set_id === id || `set-${item?.source_index}` === id
        ));
        return {
          id,
          label: garment?.observed?.garment_type ?? conflict.category ?? id,
          previewUrl: garment?.preview_url ?? null,
        };
      }),
    }))
    .filter((choice) => choice.category && choice.options.length);
}

function runResult(run) {
  const imageUrl = run?.outputs?.avatar_outfit;
  if (phaseFor(run) !== 'completed' || typeof imageUrl !== 'string' || !imageUrl.startsWith('/')) return null;
  return { kind: 'look', aspect: '9:16', urls: [imageUrl], mediaUrl: imageUrl, pendingRealMedia: false };
}

function normalizeBackgrounds(payload, client) {
  return (payload?.presets ?? []).map((preset) => ({
    id: preset.preset_id,
    version: preset.preset_version,
    name: preset.ui_name_uk ?? preset.title ?? preset.preset_id,
    note: preset.visual_system ?? '',
    previewUrl: preset.preview_url ?? client.scenePresetPreviewUrl(preset.preset_id, preset.preset_version),
    referencePackSha256: preset.reference_pack_sha256 ?? null,
  })).filter((item) => item.id && item.version);
}

function normalizeShoots(payload, client) {
  return (payload?.modes ?? []).filter((mode) => mode?.source_set_status !== 'BLOCKED_UNIT_MISSING').map((mode) => ({
    id: mode.preset_id,
    version: mode.version,
    name: mode.ui_name_uk ?? mode.title ?? mode.preset_id,
    note: mode.visual_system ?? '',
    previewUrl: mode.preview_url ?? client.editorialModePreviewUrl(mode.preset_id, mode.version),
  })).filter((item) => item.id && item.version);
}

function normalizeVideos(capability) {
  if (!capability?.available) return [];
  return (capability.styles ?? []).map((style) => ({
    id: style.id,
    name: style.title,
    motionMode: style.motion_mode,
    previewUrl: style.preview_url,
    playbackUrl: style.playback_url,
    referenceUrl: style.reference_url,
  })).filter((item) => item.id && item.motionMode);
}

function statusError(error) {
  if (error?.status === 401) return { availability: 'auth_required', code: 'AUTH_REQUIRED' };
  if (error?.code === 'ENGINE_UNAVAILABLE' || error?.status === 404 || error?.status === 0) {
    return { availability: 'unavailable', code: 'ENGINE_UNAVAILABLE' };
  }
  return { availability: null, code: error?.code ?? 'REQUEST_FAILED' };
}

export function createCinematicUiBridge({
  client = createZeelyClient({ apiBase: '/api' }),
  autoProbe = true,
} = {}) {
  if (!client || typeof client.health !== 'function' || typeof client.subscribe !== 'function') {
    throw new TypeError('createCinematicUiBridge requires a ZeelyClient-compatible client');
  }

  const listeners = new Set();
  let state = initialState();
  let disposed = false;
  let savingRunId = null;

  const emit = (type, patch = {}) => {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() };
    const event = { type, ...clone(state) };
    listeners.forEach((listener) => listener(event));
    return event;
  };

  function fail(error, type = 'error') {
    const mapped = statusError(error);
    emit(type, {
      ...(mapped.availability ? { availability: mapped.availability } : {}),
      phase: mapped.availability ? 'idle' : 'failed',
      error: { code: mapped.code, status: error?.status ?? 0 },
    });
  }

  async function loadCatalogs(lookId) {
    if (!lookId) return state.catalogs;
    const [backgrounds, shoots, videos, live] = await Promise.allSettled([
      client.listScenePresets(),
      client.listEditorialModes(),
      client.videoCapability(lookId),
      client.realtimeCapability(lookId),
    ]);
    const catalogs = {
      backgrounds: backgrounds.status === 'fulfilled' ? normalizeBackgrounds(backgrounds.value, client) : [],
      shoots: shoots.status === 'fulfilled' ? normalizeShoots(shoots.value, client) : [],
      videos: videos.status === 'fulfilled' ? normalizeVideos(videos.value) : [],
    };
    emit('catalogs:ready', {
      catalogs,
      liveCapability: live.status === 'fulfilled' ? live.value : null,
    });
    return catalogs;
  }

  async function saveCompletedRun(run) {
    if (!run?.run_id || savingRunId === run.run_id || state.savedLook?.run_id === run.run_id) return;
    savingRunId = run.run_id;
    try {
      const saved = await client.saveRun(run.run_id);
      const look = saved?.look ?? null;
      if (state.run?.run_id === run.run_id && look) {
        emit('look:saved', { savedLook: look });
        await loadCatalogs(look.look_id);
      }
    } catch (error) {
      if (state.run?.run_id === run.run_id) emit('look:save_failed', { error: { code: 'LOOK_NOT_SAVED' } });
    } finally {
      if (savingRunId === run.run_id) savingRunId = null;
    }
  }

  function syncRun(run, type = 'run:updated') {
    if (!run) return;
    const phase = phaseFor(run);
    emit(type, {
      activeKind: 'look', run, phase,
      choices: phase === 'needs_input' ? runChoices(run) : [],
      result: runResult(run),
      error: phase === 'failed' ? { code: 'RUN_FAILED' } : null,
    });
    if (phase === 'completed') void saveCompletedRun(run);
  }

  async function syncShootResult(shoot) {
    if (phaseFor(shoot) !== 'completed' || !shoot?.shoot_id) return;
    try {
      const sheet = await client.loadShootContactSheet(shoot.shoot_id);
      const frames = sheet?.shots ?? sheet?.frames ?? sheet?.images ?? [];
      const urls = frames.map((frame) => frame?.image_url
        ?? (frame?.slot ? client.shootShotImageUrl(shoot.shoot_id, frame.slot) : null)).filter(Boolean);
      emit('shoot:result', {
        result: { kind: 'shoot', aspect: '16:9', urls, mediaUrl: '', pendingRealMedia: urls.length === 0 },
      });
    } catch (error) {
      fail(error, 'shoot:result_failed');
    }
  }

  function syncProduct(kind, entity, type) {
    if (!entity) return;
    const needsManualRetry = String(entity.status ?? '').toUpperCase() === 'NEEDS_RETRY';
    const phase = needsManualRetry ? 'failed' : phaseFor(entity);
    let result = null;
    if (phase === 'completed' && kind === 'background' && entity.scene_id) {
      const image = client.sceneImageUrl(entity.scene_id);
      result = { kind, aspect: state.result?.aspect ?? '9:16', urls: [image], mediaUrl: image, pendingRealMedia: false };
    }
    if (phase === 'completed' && kind === 'video' && entity.clip_id) {
      const media = entity.video_url ?? client.videoUrl(entity.clip_id);
      result = { kind, aspect: entity.surface === 'tv' ? '16:9' : '9:16', urls: [], mediaUrl: media, pendingRealMedia: false };
    }
    emit(type, {
      activeKind: kind,
      phase,
      [kind === 'background' ? 'scene' : kind]: entity,
      ...(result ? { result } : {}),
      error: phase === 'failed' ? {
        code: needsManualRetry ? `${kind.toUpperCase()}_NEEDS_RETRY` : `${kind.toUpperCase()}_FAILED`,
      } : null,
    });
    if (kind === 'shoot' && phase === 'completed') void syncShootResult(entity);
  }

  const unsubscribeClient = client.subscribe((event) => {
    if (disposed || !event) return;
    const type = String(event.type ?? '');
    if (type.startsWith('run:') && event.run) syncRun(event.run, type);
    else if (type.startsWith('scene:') && event.scene) syncProduct('background', event.scene, type);
    else if (type.startsWith('shoot:') && event.shoot) syncProduct('shoot', event.shoot, type);
    else if (type.startsWith('video:') && event.video) syncProduct('video', event.video, type);
  });

  async function probe() {
    emit('connection:checking', { availability: 'checking', error: null });
    try {
      const health = await client.health();
      if (!['ready', 'ok'].includes(String(health?.status ?? '').toLowerCase())) {
        throw new CinematicUiBridgeError('ENGINE_UNAVAILABLE');
      }
      emit('connection:healthy', { availability: 'checking', releaseSha: health.release_sha ?? null });
      try {
        const profile = await client.loadProfile();
        emit('connection:ready', { availability: 'ready', profile, error: null });
      } catch (error) {
        if (error?.status === 401) fail(error, 'connection:auth_required');
        else throw error;
      }
    } catch (error) {
      fail(error, 'connection:unavailable');
    }
    return clone(state);
  }

  function requireReady() {
    if (state.availability !== 'ready') {
      throw new CinematicUiBridgeError(
        state.availability === 'auth_required' ? 'AUTH_REQUIRED' : 'ENGINE_UNAVAILABLE',
        MIRROR_COPY[state.availability] ?? MIRROR_COPY.unavailable,
      );
    }
  }

  const bridge = {
    client,
    state: () => clone(state),
    subscribe(listener) {
      listeners.add(listener);
      listener({ type: 'snapshot', ...clone(state) });
      return () => listeners.delete(listener);
    },
    probe,
    async authenticate(pin) {
      await client.authenticate(pin);
      return probe();
    },
    isReady: () => state.availability === 'ready',
    canStartLook: () => state.availability === 'ready' && !ACTIVE_PHASES.has(state.phase),
    canLeaveAttentionStation: () => !ACTIVE_PHASES.has(state.phase),
    resetLook() {
      emit('look:reset', {
        phase: 'idle', activeKind: null, run: null, choices: [], result: null, error: null,
      });
    },
    async createLook({ person, identityDetail = null, garments = [], outfitText = '' } = {}) {
      requireReady();
      if (!person || !garments.length) throw new CinematicUiBridgeError('INCOMPLETE_LOOK', 'Додайте себе й хоча б одну річ');
      emit('look:submitting', { activeKind: 'look', phase: 'uploading', error: null, result: null });
      try {
        const run = await client.createRunFromUploads({ person, identityDetail, garments, outfitText });
        syncRun(run, 'run:created');
        return run;
      } catch (error) {
        fail(error, 'look:failed');
        throw error;
      }
    },
    async selectGarments(selections) {
      requireReady();
      if (!state.run?.run_id) throw new CinematicUiBridgeError('NO_RUN');
      return client.selectGarments(state.run.run_id, selections);
    },
    async retryLook() {
      requireReady();
      if (!state.run?.run_id) throw new CinematicUiBridgeError('NO_RUN');
      return client.retryRun(state.run.run_id);
    },
    loadCatalogs,
    async createBackground({ presetId, presetVersion, aspect = '9:16', expectedReferencePackSha256 = null }) {
      requireReady();
      if (!state.savedLook?.look_id) throw new CinematicUiBridgeError('NO_SAVED_LOOK');
      emit('scene:submitting', { activeKind: 'background', phase: 'running', result: { aspect }, error: null });
      return client.createScene(state.savedLook.look_id, { presetId, presetVersion, expectedReferencePackSha256 });
    },
    async createShoot({ modeId, modeVersion }) {
      requireReady();
      if (!state.savedLook?.look_id) throw new CinematicUiBridgeError('NO_SAVED_LOOK');
      emit('shoot:submitting', { activeKind: 'shoot', phase: 'running', error: null, result: null });
      return client.createShoot(state.savedLook.look_id, { modeId, modeVersion });
    },
    async approveShoot() {
      requireReady();
      const shoot = state.shoot;
      if (!shoot?.shoot_id) throw new CinematicUiBridgeError('NO_SHOOT');
      if (shoot.status === 'BIBLE_PENDING_APPROVAL' && shoot.bible?.sha256) {
        return client.approveShootBible(shoot.shoot_id, shoot.bible.sha256);
      }
      if (shoot.status === 'HERO_PENDING_APPROVAL' && shoot.hero_output_sha256) {
        return client.approveShootHero(shoot.shoot_id, shoot.hero_output_sha256);
      }
      throw new CinematicUiBridgeError('SHOOT_APPROVAL_UNAVAILABLE');
    },
    async createVideo({ styleId, motionMode, aspect = '9:16', durationSeconds = null, styleNote = '' }) {
      requireReady();
      if (!state.savedLook?.look_id) throw new CinematicUiBridgeError('NO_SAVED_LOOK');
      emit('video:submitting', { activeKind: 'video', phase: 'running', error: null, result: null });
      const video = await client.createVideo({
        lookId: state.savedLook.look_id,
        surface: aspect === '16:9' ? 'tv' : 'mirror',
        styleId,
        motionMode,
        durationSeconds,
        styleNote,
      });
      client.watchVideo(video.clip_id);
      return video;
    },
    async retryActive() {
      requireReady();
      if (state.activeKind === 'look') return bridge.retryLook();
      if (state.activeKind === 'background' && state.scene?.scene_id) return client.retryScene(state.scene.scene_id);
      if (state.activeKind === 'shoot' && state.shoot?.shoot_id) {
        const failed = (state.shoot.shots ?? []).find((shot) => shot?.status === 'FAILED');
        if (failed?.slot) return client.retryShootShot(state.shoot.shoot_id, failed.slot);
      }
      if (state.activeKind === 'video' && state.video?.clip_id) return client.retryVideo(state.video.clip_id);
      throw new CinematicUiBridgeError('RETRY_UNAVAILABLE');
    },
    async startLive({ privacyConsent = false, costAcknowledged = false } = {}) {
      requireReady();
      if (!state.savedLook?.look_id || !state.liveCapability) throw new CinematicUiBridgeError('LIVE_UNAVAILABLE');
      return client.startLiveLook({
        lookId: state.savedLook.look_id,
        capability: {
          app: state.liveCapability.app,
          default_app: state.liveCapability.default_app,
          max_session_seconds: state.liveCapability.consent?.maximum_session_seconds,
        },
        privacyConsent,
        costAcknowledged,
      });
    },
    dispose() {
      disposed = true;
      unsubscribeClient?.();
      client.dispose?.();
      listeners.clear();
    },
  };

  if (autoProbe) void probe();
  return Object.freeze(bridge);
}
