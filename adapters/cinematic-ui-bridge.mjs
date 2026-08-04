/**
 * Presentation policy between ZeelyClient and any cinematic site.
 *
 * This module owns product state, never DOM, CSS, scroll position or a host name.
 * The active site may be replaced wholesale while this bridge continues to use
 * the same relative `/api` contract.
 */
import { createZeelyClient, phaseFor } from './zeely-client.mjs?v=20260803-1';

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
    videoCapability: null,
    catalogs: { backgrounds: [], shoots: [], videos: [] },
    // Durable deliveries are deliberately separate from the active job/result.
    // A browser refresh can restore a finished series or clip without making it
    // look like a newly submitted job, and without replacing the master image.
    deliveries: { lookId: null, scenes: [], shoots: [], videos: [], restoreErrors: [] },
    result: null,
    /* A requested presentation ratio is metadata for an in-flight scene, never a
     * deliverable result.  Keeping the two separate prevents a selection of a
     * wide style from waking the television before beta has produced any media. */
    requestedAspect: null,
    error: null,
    updatedAt: null,
  };
}

/**
 * Beta keeps the durable profile as a flat `looks` collection and also nests the
 * same records under each avatar for older clients.  Keep that compatibility at
 * the adapter boundary so every presentation can restore the same library after
 * a reload without inventing a browser-local session.
 */
export function profileLooks(profile) {
  if (Array.isArray(profile?.looks) && (profile.looks.length || !Array.isArray(profile?.avatars))) {
    return profile.looks;
  }
  return (profile?.avatars ?? []).flatMap((avatar) => (
    (avatar?.looks ?? []).map((look) => ({ ...look, avatar_id: avatar.avatar_id ?? avatar.id }))
  ));
}

function profileLookId(look) {
  return look?.look_id ?? look?.id ?? null;
}

/* The cinematic site never needs the original master bytes to paint the first
 * saved look.  Prefer the immutable compact cutout when beta has published
 * one; otherwise explicitly ask the image route for its presentation
 * derivative.  This keeps the opening warm-up small and, critically, never
 * lets a heavyweight white-background master compete with the intro film. */
export function savedLookPreviewUrl(look, client) {
  const explicit = [
    look?.cutout_preview_url,
    look?.cutoutPreviewUrl,
    look?.avatar_outfit_cutout_preview_url,
    look?.avatarOutfitCutoutPreviewUrl,
  ].find((value) => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//'));
  if (explicit) return explicit;

  const lookId = profileLookId(look);
  if (!lookId || typeof client?.lookImageUrl !== 'function') return null;
  const image = client.lookImageUrl(lookId);
  if (typeof image !== 'string' || !image.startsWith('/') || image.startsWith('//')) return null;
  return `${image}${image.includes('?') ? '&' : '?'}preview=1`;
}

/* The API owns the only allowed display derivative.  A cinematic client must
 * never download an original PNG and re-encode it in the browser just to make
 * a tile: that delays the result and makes a phone spend memory on a file the
 * user did not ask to download.  The immutable `/download` route remains a
 * separate, original-byte operation. */
export function presentationImagePreviewUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/api/') || value.startsWith('//')) return null;
  const [path, hash = ''] = value.split('#', 2);
  if (/(?:^|\/)download(?:$|\?)/.test(path)) return null;
  if (/(?:[?&])preview=1(?:&|$)/.test(path)) return value;
  return `${path}${path.includes('?') ? '&' : '?'}preview=1${hash ? `#${hash}` : ''}`;
}

/* Fashion Shoot state is server-owned. A phone refresh must not make five
 * independently running frames look as though they were lost: the same profile response
 * already contains the durable shoot projection, both flat and nested under its look.
 * Read both shapes, dedupe by id, then reconnect only the newest nonterminal programme
 * belonging to the currently restored look. */
function profileEditorialShoots(profile, lookId) {
  const records = [];
  const seen = new Set();
  const append = (shoot) => {
    const id = String(shoot?.shoot_id ?? shoot?.id ?? '');
    if (!id || seen.has(id)) return;
    if (String(shoot?.look_id ?? '') !== String(lookId ?? '')) return;
    seen.add(id);
    records.push(shoot);
  };
  (profile?.editorial_shoots ?? []).forEach(append);
  profileLooks(profile).forEach((look) => {
    if (String(profileLookId(look) ?? '') !== String(lookId ?? '')) return;
    (look?.editorial_shoots ?? []).forEach(append);
  });
  return records;
}

function newestActiveEditorialShoot(profile, lookId) {
  const terminal = new Set(['COMPLETED', 'CANCELLED']);
  return profileEditorialShoots(profile, lookId)
    .filter((shoot) => !terminal.has(String(shoot?.status ?? '').toUpperCase()))
    .sort((left, right) => String(right?.updated_at ?? right?.created_at ?? '')
      .localeCompare(String(left?.updated_at ?? left?.created_at ?? '')))[0] ?? null;
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
  const outputs = run?.outputs ?? run?.output ?? run ?? {};
  const imageUrl = outputs.avatar_outfit_master
    ?? outputs.master_image_url
    ?? outputs.avatar_outfit;
  const phase = phaseFor(run);
  const review = (phase === 'needs_input' || phase === 'failed') &&
    (run?.error?.code === 'FIRST_APPEARANCE_NEEDS_INPUT' ||
      run?.error?.name === 'FirstAppearanceNeedsInputError');
  if ((phase !== 'completed' && !review) || typeof imageUrl !== 'string' || !imageUrl.startsWith('/')) return null;
  const masterSha256 = outputs.avatar_outfit_master_sha256
    ?? outputs.master_sha256
    ?? outputs.image_sha256
    ?? null;
  const native = outputs.cutout_native ?? {};
  const cutoutNativeUrl = native.url
    ?? native.image_url
    ?? outputs.cutout_native_url
    ?? outputs.avatar_outfit_cutout_native_url
    ?? null;
  const cutoutNativeSha256 = native.sha256
    ?? outputs.cutout_native_sha256
    ?? outputs.avatar_outfit_cutout_native_sha256
    ?? null;
  const cutoutSourceSha256 = native.source_master_sha256
    ?? native.bound_master_sha256
    ?? outputs.cutout_native_source_master_sha256
    ?? outputs.cutout_source_master_sha256
    ?? null;
  const nativeHasAlpha = native.has_alpha === true || native.alpha === true
    || outputs.cutout_native_has_alpha === true;
  const cutoutBound = typeof cutoutNativeUrl === 'string'
    && cutoutNativeUrl.startsWith('/')
    && typeof cutoutNativeSha256 === 'string'
    && nativeHasAlpha
    && typeof masterSha256 === 'string'
    && typeof cutoutSourceSha256 === 'string'
    && cutoutSourceSha256 === masterSha256;
  const cutoutPreviewUrl = outputs.cutout_preview_url
    ?? outputs.avatar_outfit_cutout_preview_url
    ?? null;
  const cutoutPreviewSha256 = outputs.cutout_preview_sha256
    ?? outputs.avatar_outfit_cutout_preview_sha256
    ?? null;
  const previewSourceSha256 = outputs.cutout_preview_source_native_sha256
    ?? outputs.cutout_preview_source_sha256
    ?? null;
  const previewBound = cutoutBound && typeof cutoutPreviewUrl === 'string'
    && cutoutPreviewUrl.startsWith('/')
    && typeof cutoutPreviewSha256 === 'string'
    && typeof previewSourceSha256 === 'string'
    && previewSourceSha256 === cutoutNativeSha256;
  return {
    kind: 'look', aspect: '9:16', urls: [imageUrl], mediaUrl: imageUrl,
    previewUrls: [previewBound ? cutoutPreviewUrl : cutoutBound ? cutoutNativeUrl : imageUrl],
    pendingRealMedia: false,
    reviewRequired: review,
    masterUrl: imageUrl,
    masterSha256,
    cutoutNativeUrl: cutoutBound ? cutoutNativeUrl : null,
    cutoutNativeSha256: cutoutBound ? cutoutNativeSha256 : null,
    cutoutPreviewUrl: previewBound ? cutoutPreviewUrl : null,
    cutoutPreviewSha256: previewBound ? cutoutPreviewSha256 : null,
  };
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
  return (payload?.modes ?? []).filter((mode) => (
    mode?.source_set_status === 'READY' && mode?.generation_available === true
  )).map((mode) => {
    // Beta's canonical editorial catalogue calls this field `mode_id`; older
    // snapshots used `preset_id`. Accept both so the main site renders the
    // server-owned catalogue instead of silently falling back to placeholders.
    const id = mode.mode_id ?? mode.preset_id;
    const version = mode.mode_version ?? mode.version;
    return {
      id,
      version,
      name: mode.ui_name_uk ?? mode.title ?? id,
      note: mode.visual_system ?? '',
      previewUrl: mode.preview_url ?? (id && version
        ? client.editorialModePreviewUrl(id, version)
        : ''),
    };
  // The server's READY flag is the only catalogue authority. Some valid,
  // published Fashion Shoot programmes predate the `shoot.*` namespace; an id
  // prefix is not a product rule and must never make them disappear.
  }).filter((item) => item.id && item.version);
}

function normalizeVideos(capability) {
  if (!capability?.available) return [];
  return (capability.styles ?? []).map((style) => {
    // The immutable style video owns its geometry.  The cinematic client may
    // display the resulting surface, but must never offer a second choice that
    // can change the provider request away from the approved reference master.
    const presentationSurface = style.presentation_surface === 'tv'
      || style.surface === 'tv'
      || style.aspect_ratio === '16:9'
      ? 'tv'
      : 'mirror';
    return {
      id: style.id,
      name: style.title,
      motionMode: style.motion_mode,
      presentationSurface,
      aspect: presentationSurface === 'tv' ? '16:9' : '9:16',
      note: style.presentation_label
        ?? (presentationSurface === 'tv' ? 'відтвориться на телевізорі' : 'відтвориться у дзеркалі'),
      previewUrl: style.preview_url,
      playbackUrl: style.playback_url,
      referenceUrl: style.reference_url,
      inputContract: style.input_contract ?? null,
    };
  }).filter((item) => item.id && item.motionMode);
}

/* The public pipeline is beta's server-owned declaration of which realtime app exists.
 * The cinematic client must never reproduce a provider identifier or a duration locally;
 * enriching the per-look capability here keeps both values tied to beta's current contract. */
function enrichLiveCapability(capability, pipeline) {
  if (!capability) return null;
  const liveMode = (pipeline?.modes ?? []).find((mode) => mode?.id === 'live_webcam');
  return {
    ...capability,
    app: capability.app ?? capability.default_app ?? liveMode?.provider?.model_id ?? null,
  };
}

function statusError(error) {
  if (error?.status === 401) return { availability: 'auth_required', code: 'AUTH_REQUIRED' };
  if (error?.code === 'ENGINE_UNAVAILABLE' || error?.status === 404 || error?.status === 0) {
    return { availability: 'unavailable', code: 'ENGINE_UNAVAILABLE' };
  }
  if (error?.code === 'UNSUPPORTED_MEDIA_TYPE') {
    const rawField = String(error?.body?.field ?? '');
    const field = /^(Ваше фото|Фото речі [1-5])$/.test(rawField) ? rawField : 'Це фото';
    return {
      availability: null,
      code: 'UNSUPPORTED_GARMENT_MEDIA',
      message: `${field}: оберіть JPEG, PNG або WebP.`,
    };
  }
  if (error?.code === 'IMAGE_TOO_SMALL' ||
      (error?.status === 422 && error?.body?.nextAction === 'REPLACE_INPUT')) {
    const rawField = String(error?.body?.field ?? '');
    const field = /^(Ваше фото|Фото речі [1-5])$/.test(rawField) ? rawField : 'Це фото';
    return {
      availability: null,
      code: 'IMAGE_TOO_SMALL',
      message: `${field}: потрібне зображення щонайменше 256×256 px.`,
    };
  }
  return { availability: null, code: error?.code ?? 'REQUEST_FAILED' };
}

/* Beta's terminal `message` is useful evidence for a repair prompt, but it is
 * not presentation copy.  The mirror only receives a small allowlist of
 * verified, actionable facts; raw evaluator prose and any unexpected text stay
 * on the server. */
function runFailurePresentation(run) {
  const message = String(run?.message ?? '').toLowerCase();
  const stage = String(run?.terminal_stage ?? run?.phase ?? '').toUpperCase();
  if (stage === 'OUTFIT_QA' && /blue\s+(?:t-?shirt|shirt)|син(?:я|ій).*футбол/.test(message)) {
    return {
      code: 'OUTFIT_QA_VISIBLE_BLUE_LAYER',
      message: 'На образі лишився синій шар замість погодженого темного верху. Повторимо тільки образ.',
    };
  }
  if (stage === 'OUTFIT_QA') {
    return {
      code: 'OUTFIT_QA_MISMATCH',
      message: 'Образ не пройшов перевірку точності речей. Повторимо тільки образ.',
    };
  }
  if (stage === 'AVATAR_QA') {
    return {
      code: 'AVATAR_QA_MISMATCH',
      message: 'Не вдалося точно зберегти зовнішність. Повторимо тільки образ.',
    };
  }
  return { code: 'RUN_FAILED', message: 'Не вдалося зібрати образ. Спробуйте ще раз.' };
}

function runReviewPresentation(run) {
  if (run?.error?.code === 'FIRST_APPEARANCE_NEEDS_INPUT' ||
      run?.error?.name === 'FirstAppearanceNeedsInputError') {
    return {
      code: 'FIRST_APPEARANCE_NEEDS_INPUT',
      message: 'Образ уже зібраний. Спробуємо ще раз, щоб завершити його повністю?',
      retryable: true,
    };
  }
  return null;
}

/* A product entity is server-owned. Keep only the small, authored failure
 * vocabulary that Beta deliberately exposes to a visitor; raw provider/VLM
 * prose must never be mirrored into the cinematic site. */
function productFailurePresentation(kind, entity, needsManualRetry) {
  const code = entity?.failure_code ?? entity?.failureCode
    ?? (needsManualRetry ? `${kind.toUpperCase()}_NEEDS_RETRY` : `${kind.toUpperCase()}_FAILED`);
  const copy = {
    VIDEO_PROVIDER_JOB_FAILED: 'Higgsfield не зміг завершити цей ролик. Автоматичні спроби вже завершилися — можна запустити нову.',
    VIDEO_INPUT_MEDIA_IP_CHECK_PENDING: 'Higgsfield ще перевіряє завантажені медіа. Job не створився; спробуйте ще раз через кілька секунд.',
    VIDEO_AUTOMATIC_RETRY_IN_PROGRESS: 'Сервер уже завершує автоматичну спробу цього відео. Нова генерація не запускалася.',
    VIDEO_PROVIDER_JOB_NOT_FOUND: 'Higgsfield більше не має цей job. Можна створити нову спробу.',
    VIDEO_REFERENCE_QA_FAILED: 'Відео не пройшло перевірку заміни героя. Можна запустити нову спробу.',
  };
  return {
    code,
    message: copy[code] ?? (needsManualRetry
      ? 'Цей результат потребує повторної спроби.'
      : 'Не вдалося завершити цю дію. Спробуйте ще раз.'),
  };
}

export function createCinematicUiBridge({
  client = createZeelyClient({ apiBase: '/api' }),
  autoProbe = true,
  unavailableRetryMs = 5_000,
} = {}) {
  if (!client || typeof client.health !== 'function' || typeof client.subscribe !== 'function') {
    throw new TypeError('createCinematicUiBridge requires a ZeelyClient-compatible client');
  }

  const listeners = new Set();
  let state = initialState();
  let disposed = false;
  let unavailableRetryTimer = null;
  let savingRunId = null;
  const prewarmedPreviewUrls = new Set();
  const prewarmedImages = new Set();

  /* Starts during the filmed intro, before the mirrors are reachable.  It is
   * deliberately best-effort: no profile or image failure can hold the
   * cinematic loader, and the visible UI still receives the normal immutable
   * profile payload through `probe()`. */
  function warmFirstSavedLookPreview(profile) {
    const url = savedLookPreviewUrl(profileLooks(profile)[0], client);
    if (!url || prewarmedPreviewUrls.has(url) || typeof globalThis.Image !== 'function') return;
    prewarmedPreviewUrls.add(url);
    const image = new globalThis.Image();
    image.decoding = 'async';
    if ('fetchPriority' in image) image.fetchPriority = 'high';
    const release = () => prewarmedImages.delete(image);
    image.onload = release;
    image.onerror = release;
    prewarmedImages.add(image);
    image.src = url;
  }

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
      error: { code: mapped.code, status: error?.status ?? 0, message: mapped.message ?? null },
    });
  }

  async function loadCatalogs(lookId) {
    if (!lookId) return state.catalogs;
    const [backgrounds, shoots, videos, live, pipeline] = await Promise.allSettled([
      client.listScenePresets(),
      client.listEditorialModes(),
      client.videoCapability(lookId),
      client.realtimeCapability(lookId),
      client.postShootPipeline(),
    ]);
    const catalogs = {
      backgrounds: backgrounds.status === 'fulfilled' ? normalizeBackgrounds(backgrounds.value, client) : [],
      shoots: shoots.status === 'fulfilled' ? normalizeShoots(shoots.value, client) : [],
      videos: videos.status === 'fulfilled' ? normalizeVideos(videos.value) : [],
    };
    emit('catalogs:ready', {
      catalogs,
      videoCapability: videos.status === 'fulfilled' ? videos.value : null,
      liveCapability: live.status === 'fulfilled'
        ? enrichLiveCapability(live.value, pipeline.status === 'fulfilled' ? pipeline.value : null)
        : null,
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
        emit('look:saved', {
          savedLook: look,
          ...(saved?.profile ? { profile: saved.profile } : {}),
        });
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
    const result = runResult(run);
    emit(type, {
      activeKind: 'look', run, phase,
      choices: phase === 'needs_input' ? runChoices(run) : [],
      result,
      error: phase === 'failed' ? runFailurePresentation(run) : null,
      review: result?.reviewRequired ? runReviewPresentation(run) : null,
    });
    if (phase === 'completed') void saveCompletedRun(run);
  }

  function shootResultFromState(shoot) {
    if (!shoot?.shoot_id || !Array.isArray(shoot.shots)) return null;
    // `clean_identity_hero` is an internal prerequisite, not one of the five
    // client-facing editorial frames.  The beta payload may contain its output
    // while the public series is still running, so filter it at this boundary.
    const publicShots = shoot.shots.filter((shot) => shot?.slot !== 'clean_identity_hero');
    const frames = publicShots.map((shot, index) => {
      const ready = String(shot?.status ?? '').toUpperCase() === 'APPROVED'
        && Boolean(shot?.output);
      const imageUrl = ready
        ? (shot.output?.image_url ?? shot?.image_url ?? shot?.output_url
          ?? client.shootShotImageUrl(shoot.shoot_id, shot.slot))
        : null;
      const previewCandidate = ready
        ? (shot.output?.preview_url ?? shot.output?.previewUrl ?? shot?.preview_url ?? imageUrl)
        : null;
      return {
        slot: shot?.slot ?? `frame_${index + 1}`,
        index: index + 1,
        status: String(shot?.status ?? 'QUEUED').toUpperCase(),
        retryCount: Number(shot?.retry_count ?? 0),
        errorCode: shot?.error?.code ?? null,
        imageUrl,
        previewUrl: presentationImagePreviewUrl(previewCandidate) ?? previewCandidate ?? null,
        downloadUrl: ready
          ? (shot.output?.download_url ?? shot?.download_url
            ?? client.shootShotDownloadUrl(shoot.shoot_id, shot.slot))
          : null,
      };
    });
    const urls = frames.map((frame) => frame.imageUrl).filter(Boolean);
    const previewUrls = frames.map((frame) => frame.previewUrl).filter(Boolean);
    if (!urls.length) return null;
    const expectedCount = Math.max(frames.length, 5);
    return {
      kind: 'shoot', aspect: '16:9', urls, previewUrls, mediaUrl: '',
      pendingRealMedia: false,
      partial: urls.length < expectedCount,
      readyCount: urls.length,
      expectedCount,
      frames,
    };
  }

  async function syncShootResult(shoot) {
    if (!shoot?.shoot_id) return;
    const phase = phaseFor(shoot);
    const partial = shootResultFromState(shoot);
    if (partial) emit('shoot:partial_result', { activeKind: 'shoot', phase, result: partial, error: null });
    if (phase !== 'completed') return;
    try {
      const sheet = await client.loadShootContactSheet(shoot.shoot_id);
      const delivered = shootResultFromState(shoot);
      const frames = sheet?.shots ?? sheet?.frames ?? sheet?.images ?? [];
      const urls = frames.map((frame) => frame?.image_url
        ?? (frame?.slot ? client.shootShotImageUrl(shoot.shoot_id, frame.slot) : null)).filter(Boolean);
      const previewUrls = frames.map((frame) => presentationImagePreviewUrl(frame?.preview_url ?? frame?.image_url
        ?? (frame?.slot ? client.shootShotImageUrl(shoot.shoot_id, frame.slot) : null))).filter(Boolean);
      if (urls.length || delivered?.frames?.length) {
        emit('shoot:result', {
          result: {
            ...(delivered ?? { kind: 'shoot', aspect: '16:9', frames: [] }),
            urls: urls.length ? urls : delivered.urls,
            previewUrls: previewUrls.length ? previewUrls : (delivered?.previewUrls ?? []),
            mediaUrl: '', pendingRealMedia: false,
            partial: false,
            readyCount: delivered?.readyCount ?? urls.length,
            expectedCount: delivered?.expectedCount ?? urls.length,
          },
          error: null,
        });
      } else if (!partial) {
        fail(new CinematicUiBridgeError('SHOOT_RESULT_EMPTY'), 'shoot:result_failed');
      }
    } catch (error) {
      // A contact sheet is assembled after the individual shot resources.  A
      // transient 404/409 here must not erase already-visible approved frames.
      // Keep the partial result and allow the next watchdog snapshot to retry.
      if (!partial) fail(error, 'shoot:result_failed');
    }
  }

  function syncProduct(kind, entity, type) {
    if (!entity) return;
    const needsManualRetry = String(entity.status ?? '').toUpperCase() === 'NEEDS_RETRY';
    const phase = needsManualRetry ? 'failed' : phaseFor(entity);
    let result = null;
    if (phase === 'completed' && kind === 'background' && entity.scene_id) {
      const image = client.sceneImageUrl(entity.scene_id);
      result = {
        kind, aspect: state.requestedAspect ?? '9:16', urls: [image], mediaUrl: image,
        previewUrl: presentationImagePreviewUrl(entity.preview_url ?? image) ?? entity.preview_url ?? null,
        previewUrls: [presentationImagePreviewUrl(entity.preview_url ?? image) ?? entity.preview_url ?? image],
        pendingRealMedia: false,
      };
    }
    if (phase === 'completed' && kind === 'video' && entity.clip_id) {
      const media = entity.video_url ?? client.videoUrl(entity.clip_id);
      const styleId = entity.style_id ?? entity.styleId ?? null;
      const stylePreview = state.catalogs.videos.find((style) => style.id === styleId)?.previewUrl ?? null;
      result = {
        kind,
        clipId: entity.clip_id,
        aspect: entity.surface === 'tv' ? '16:9' : '9:16',
        urls: [],
        mediaUrl: media,
        /* A card opens on an approved lightweight style/poster if beta supplied
         * one. It never downloads a whole MP4 until the user opens that video. */
        posterUrl: entity.poster_url ?? entity.preview_url ?? stylePreview,
        downloadUrl: entity.download_url
          ?? (typeof client.videoDownloadUrl === 'function' ? client.videoDownloadUrl(entity.clip_id) : null),
        pendingRealMedia: false,
      };
    }
    if (kind === 'shoot') result = shootResultFromState(entity);
    emit(type, {
      activeKind: kind,
      phase,
      [kind === 'background' ? 'scene' : kind]: entity,
      /* A later QUEUED/RUNNING event must clear an earlier look/result instead
       * of inheriting it through emit's shallow state merge.  A shoot may carry
       * real approved partial frames; all other in-flight product states do not. */
      result: result ?? null,
      error: phase === 'failed'
        ? productFailurePresentation(kind, entity, needsManualRetry)
        : null,
    });
    if (kind === 'shoot') void syncShootResult(entity);
  }

  async function restoreActiveShoot(profile, savedLook) {
    const lookId = profileLookId(savedLook);
    const persisted = newestActiveEditorialShoot(profile, lookId);
    const shootId = persisted?.shoot_id ?? persisted?.id ?? null;
    if (!shootId || typeof client.loadShoot !== 'function') return null;
    try {
      const shoot = await client.loadShoot(shootId);
      /* ZeelyClient emits while loading; simple test/different clients may not.
       * Reconcile once at this neutral boundary so both clients restore the exact same
       * 3/5 projection after refresh. */
      if (state.shoot?.shoot_id !== shoot?.shoot_id || state.shoot?.updated_at !== shoot?.updated_at) {
        syncProduct('shoot', shoot, 'shoot:restored');
      }
      const terminal = new Set(['COMPLETED', 'CANCELLED']);
      if (!terminal.has(String(shoot?.status ?? '').toUpperCase())
        && typeof client.watchShoot === 'function') {
        client.watchShoot(shoot.shoot_id);
      }
      return shoot;
    } catch {
      /* A stale profile projection must not break recovery of the saved look itself.
       * The server remains the authority and the next profile refresh can repair it. */
      return null;
    }
  }

  function collection(value, keys) {
    if (Array.isArray(value)) return value;
    for (const key of keys) {
      if (Array.isArray(value?.[key])) return value[key];
    }
    return [];
  }

  function savedShootDelivery(shoot) {
    const result = shootResultFromState(shoot);
    const recovery = shoot?.recovery ?? null;
    if (!result && !recovery) return null;
    return {
      shoot_id: shoot.shoot_id ?? shoot.id,
      status: shoot.status ?? 'COMPLETED',
      updated_at: shoot.updated_at ?? shoot.created_at ?? null,
      recovery,
      // A durable profile record can outlive an in-memory runner reload. The
      // card remains visible but cannot claim an image until the authoritative
      // shoot state reappears and yields immutable output URLs.
      result: result ?? {
        kind: 'shoot', aspect: '16:9', urls: [], previewUrls: [], mediaUrl: '',
        pendingRealMedia: true, partial: true,
        readyCount: Number(recovery.approved_shot_count ?? 0), expectedCount: 5,
        frames: [], recoveryPending: true,
      },
    };
  }

  function savedSceneDelivery(scene) {
    const sceneId = scene?.scene_id ?? scene?.id;
    const imageUrl = scene?.image_url
      ?? (typeof client.sceneImageUrl === 'function' && typeof sceneId === 'string'
        ? client.sceneImageUrl(sceneId)
        : null);
    // The profile list only includes an image URL after the server has stored
    // a completed scene and its immutable output hash. Do not turn an active
    // scene into a fake saved result just because it has an id.
    if (typeof sceneId !== 'string' || !imageUrl) return null;
    const previewUrl = presentationImagePreviewUrl(scene?.preview_url ?? imageUrl)
      ?? scene?.preview_url
      ?? imageUrl;
    return {
      scene_id: sceneId,
      status: scene.status ?? 'COMPLETED',
      updated_at: scene.updated_at ?? scene.created_at ?? null,
      preset: scene.preset ?? null,
      result: {
        kind: 'background',
        sceneId,
        aspect: scene?.aspect_ratio ?? scene?.aspect ?? '3:4',
        urls: [imageUrl],
        previewUrls: [previewUrl],
        mediaUrl: imageUrl,
        previewUrl,
        downloadUrl: scene?.download_url
          ?? (typeof client.sceneDownloadUrl === 'function' ? client.sceneDownloadUrl(sceneId) : null),
        pendingRealMedia: false,
      },
    };
  }

  function savedVideoDelivery(clip) {
    const clipId = clip?.clip_id ?? clip?.id;
    const mediaUrl = clip?.video_url ?? null;
    if (typeof clipId !== 'string' || !mediaUrl) return null;
    return {
      clip_id: clipId,
      status: clip.status ?? 'PASS',
      updated_at: clip.updated_at ?? clip.created_at ?? null,
      result: {
        kind: 'video',
        clipId,
        aspect: clip.surface === 'tv' ? '16:9' : '9:16',
        urls: [],
        mediaUrl,
        posterUrl: clip?.poster_url ?? clip?.preview_url
          ?? state.catalogs.videos.find((style) => style.id === (clip?.style_id ?? clip?.styleId))?.previewUrl
          ?? null,
        downloadUrl: clip.download_url
          ?? (typeof client.videoDownloadUrl === 'function' ? client.videoDownloadUrl(clipId) : null),
        pendingRealMedia: false,
      },
    };
  }

  /* Read delivery state from the profile-owned list routes, never from a
   * browser-local action cache.  The API omits unverified video clips; for a
   * shoot we retain every already-approved client frame, including a series
   * that was only partly complete when the page refreshed. */
  async function restoreSavedDeliveries(savedLook) {
    const lookId = profileLookId(savedLook);
    if (!lookId) return null;
    const previous = state.deliveries?.lookId === lookId
      ? state.deliveries
      : { scenes: [], shoots: [], videos: [], restoreErrors: [] };
    const [scenesResponse, shootsResponse, videosResponse] = await Promise.allSettled([
      typeof client.listScenes === 'function' ? client.listScenes(lookId) : Promise.resolve([]),
      typeof client.listShoots === 'function' ? client.listShoots(lookId) : Promise.resolve([]),
      typeof client.listVideos === 'function' ? client.listVideos(lookId) : Promise.resolve([]),
    ]);
    const scenes = scenesResponse.status === 'fulfilled'
      ? collection(scenesResponse.value, ['scenes'])
        .map(savedSceneDelivery).filter(Boolean)
      : previous.scenes;
    const shoots = shootsResponse.status === 'fulfilled'
      ? collection(shootsResponse.value, ['shoots', 'editorial_shoots'])
        .map(savedShootDelivery).filter(Boolean)
      : previous.shoots;
    const videos = videosResponse.status === 'fulfilled'
      ? collection(videosResponse.value, ['clips', 'video_clips'])
        .map(savedVideoDelivery).filter(Boolean)
      : previous.videos;
    const restoreErrors = [
      scenesResponse.status === 'rejected' ? 'backgrounds' : null,
      shootsResponse.status === 'rejected' ? 'shoots' : null,
      videosResponse.status === 'rejected' ? 'videos' : null,
    ].filter(Boolean);
    emit('deliveries:restored', {
      // A refresh must not erase a material already visible in this browser
      // because one private list request temporarily failed. The next profile
      // refresh still replaces it with the server-authoritative list.
      deliveries: { lookId, scenes, shoots, videos, restoreErrors },
    });
    return state.deliveries;
  }

  const unsubscribeClient = client.subscribe((event) => {
    if (disposed || !event) return;
    const type = String(event.type ?? '');
    if (type.startsWith('run:') && event.run) syncRun(event.run, type);
    else if (type.startsWith('scene:') && event.scene) syncProduct('background', event.scene, type);
    else if (type.startsWith('shoot:') && event.shoot) syncProduct('shoot', event.shoot, type);
    else if (type.startsWith('video:') && event.video) syncProduct('video', event.video, type);
  });

  function cancelUnavailableRetry() {
    if (unavailableRetryTimer === null) return;
    clearTimeout(unavailableRetryTimer);
    unavailableRetryTimer = null;
  }

  function scheduleUnavailableRetry() {
    if (disposed || unavailableRetryTimer !== null) return;
    unavailableRetryTimer = setTimeout(() => {
      unavailableRetryTimer = null;
      if (disposed || state.availability !== 'unavailable') return;
      void probe();
    }, Math.max(1_000, Number(unavailableRetryMs) || 5_000));
  }

  async function probe() {
    cancelUnavailableRetry();
    emit('connection:checking', { availability: 'checking', error: null });
    try {
      /* Health is small and profile state is the thing the first mirror needs.
       * Starting both on the intro's first frame removes a full request round
       * trip from the saved-look arrival without weakening either check. */
      const profileTask = client.loadProfile().then(
        (profile) => ({ profile }),
        (error) => ({ error }),
      );
      const health = await client.health();
      if (!['ready', 'ok'].includes(String(health?.status ?? '').toLowerCase())) {
        throw new CinematicUiBridgeError('ENGINE_UNAVAILABLE');
      }
      emit('connection:healthy', { availability: 'checking', releaseSha: health.release_sha ?? null });
      const profileResult = await profileTask;
      try {
        if (profileResult.error) throw profileResult.error;
        const profile = profileResult.profile;
        warmFirstSavedLookPreview(profile);
        const savedLook = profileLooks(profile)[0] ?? null;
        emit('connection:ready', { availability: 'ready', profile, savedLook, error: null });
        cancelUnavailableRetry();
        if (savedLook) {
          await Promise.all([
            loadCatalogs(profileLookId(savedLook)),
            restoreActiveShoot(profile, savedLook),
            restoreSavedDeliveries(savedLook),
          ]);
        }
      } catch (error) {
        if (error?.status === 401) fail(error, 'connection:auth_required');
        else throw error;
      }
    } catch (error) {
      fail(error, 'connection:unavailable');
      if (statusError(error).availability === 'unavailable') scheduleUnavailableRetry();
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
    /** Select a durable beta look as the command context for this presentation. */
    async useSavedLook(lookId) {
      requireReady();
      const look = profileLooks(state.profile).find((candidate) => profileLookId(candidate) === String(lookId));
      if (!look) throw new CinematicUiBridgeError('SAVED_LOOK_NOT_FOUND', 'Збережений образ більше недоступний');
      emit('look:selected', { savedLook: look, error: null });
      await Promise.all([
        loadCatalogs(profileLookId(look)),
        restoreSavedDeliveries(look),
      ]);
      return look;
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
      const hasOutfitText = typeof outfitText === 'string' && outfitText.trim().length > 0;
      if (!person || (!garments.length && !hasOutfitText)) {
        throw new CinematicUiBridgeError('INCOMPLETE_LOOK', 'Додайте себе й хоча б одну річ');
      }
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
      emit('scene:submitting', {
        activeKind: 'background', phase: 'running', requestedAspect: aspect,
        result: null, error: null,
      });
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
    async createVideo({ styleId, motionMode, presentationSurface = 'mirror', durationSeconds = null, styleNote = '' }) {
      requireReady();
      if (!state.savedLook?.look_id) throw new CinematicUiBridgeError('NO_SAVED_LOOK');
      emit('video:submitting', { activeKind: 'video', phase: 'running', error: null, result: null });
      const video = await client.createVideo({
        lookId: state.savedLook.look_id,
        // Compatibility field for the current beta route.  Its value is
        // derived from the verified style manifest, never from a UI control.
        surface: presentationSurface,
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
    async loadLiveReference() {
      requireReady();
      if (!state.savedLook?.look_id) throw new CinematicUiBridgeError('LIVE_UNAVAILABLE');
      return client.liveReferenceDataUrl(state.savedLook.look_id);
    },
    dispose() {
      disposed = true;
      cancelUnavailableRetry();
      unsubscribeClient?.();
      client.dispose?.();
      listeners.clear();
    },
  };

  if (autoProbe) void probe();
  return Object.freeze(bridge);
}
