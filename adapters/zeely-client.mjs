/**
 * ZeelyClient is a presentation-neutral browser client for the Wardrobe engine.
 *
 * It deliberately owns no DOM, CSS, scroll state, storage, or host name.  Both the
 * engineering beta and a cinematic site can use it through a same-origin `/api`
 * reverse-proxy.  The API paths below mirror beta's public Fastify routes.
 */

export class ZeelyApiError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = 'ZeelyApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// NEEDS_RETRY is a terminal backend decision: the job is no longer running and
// needs an explicit user action.  Keep it transport-terminal so a lost SSE
// connection cannot leave the watchdog spinning forever while the bridge
// presents its retry affordance.
const terminal = new Set([
  'COMPLETED', 'PASS', 'READY', 'APPROVED', 'FAILED', 'FAIL', 'CANCELLED', 'NEEDS_RETRY',
]);

function entityIdField(kind) {
  return kind === 'run' ? 'run_id'
    : kind === 'scene' ? 'scene_id'
      : kind === 'shoot' ? 'shoot_id'
        : kind === 'video' ? 'clip_id'
          : `${kind}_id`;
}

function trimTrailingSlash(value) {
  return String(value || '/api').replace(/\/+$/, '') || '/api';
}

function encode(value) {
  return encodeURIComponent(String(value));
}

function idempotencyKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// `/api/draft/run` is stricter than the header-based idempotency endpoints:
// its finalization key is itself the persisted run UUID, so it must be a bare
// UUID v4, not a descriptive header-style key.
function finalizationKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new TypeError('createRunFromDraft requires createFinalizationKey when crypto.randomUUID is unavailable');
}

export function phaseFor(entity) {
  const status = String(entity?.status ?? '').toUpperCase();
  if (!entity) return 'idle';
  if (['COMPLETED', 'PASS', 'READY', 'APPROVED'].includes(status)) return 'completed';
  if (['FAILED', 'FAIL', 'CANCELLED', 'REJECTED'].includes(status)) return 'failed';
  if (status === 'NEEDS_INPUT') return 'needs_input';
  if (/(APPROVAL|APPROVE_BIBLE|APPROVE_HERO)/.test(status)) return 'waiting_for_approval';
  if (/(RECOVER|RESUM|NEEDS_RETRY)/.test(status)) return 'recovering';
  return 'running';
}

/**
 * @param {object} options
 * @param {string} [options.apiBase='/api'] same-origin by default; absolute URLs are supported for tests only.
 * @param {typeof fetch} [options.fetchImpl=fetch]
 * @param {typeof EventSource} [options.EventSourceImpl=EventSource]
 * @param {() => string} [options.createIdempotencyKey]
 * @param {() => string} [options.createFinalizationKey] returns a UUID v4 for draft finalization.
 * @param {number} [options.sseRecoveryInitialDelayMs=300] delay before the first durable status refresh after an SSE error.
 * @param {number} [options.sseRecoveryMaxAttempts=3] bounded number of durable refreshes while EventSource reconnects.
 * @param {number} [options.terminalPollIntervalMs=5000] bounded watchdog interval for mobile/Safari clients that keep an SSE connection open but miss a terminal event.
 */
export function createZeelyClient({
  apiBase = '/api',
  fetchImpl = globalThis.fetch,
  EventSourceImpl = globalThis.EventSource,
  createIdempotencyKey = idempotencyKey,
  createFinalizationKey = finalizationKey,
  sseRecoveryInitialDelayMs = 300,
  sseRecoveryMaxAttempts = 3,
  terminalPollIntervalMs = 5_000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createZeelyClient requires fetch');
  if (!Number.isFinite(sseRecoveryInitialDelayMs) || sseRecoveryInitialDelayMs < 0) {
    throw new RangeError('sseRecoveryInitialDelayMs must be a non-negative number');
  }
  if (!Number.isInteger(sseRecoveryMaxAttempts) || sseRecoveryMaxAttempts < 1) {
    throw new RangeError('sseRecoveryMaxAttempts must be a positive integer');
  }
  if (!Number.isFinite(terminalPollIntervalMs) || terminalPollIntervalMs < 0) {
    throw new RangeError('terminalPollIntervalMs must be a non-negative number');
  }

  const base = trimTrailingSlash(apiBase);
  const subscribers = new Set();
  const streams = new Map();
  const snapshot = {
    phase: 'idle',
    run: null,
    scene: null,
    shoot: null,
    video: null,
    profile: null,
    error: null,
    updated_at: null,
  };

  const url = (path) => `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const emit = (type, patch = {}) => {
    Object.assign(snapshot, patch, { updated_at: new Date().toISOString() });
    const event = { type, ...structuredClone(snapshot) };
    subscribers.forEach((listener) => listener(event));
    return event;
  };

  async function request(path, {
    method = 'GET',
    body,
    headers = {},
    signal,
    responseType = 'json',
  } = {}) {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const response = await fetchImpl(url(path), {
      method,
      credentials: 'same-origin',
      signal,
      headers: {
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });

    if (response.status === 204) return null;
    const payload = responseType === 'text'
      ? await response.text()
      : await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorBody = typeof payload === 'object' && payload !== null ? payload : {};
      const error = new ZeelyApiError(errorBody.error || `Zeely API returned ${response.status}`, {
        status: response.status,
        code: errorBody.code || null,
        body: errorBody,
      });
      emit('error', { error: { message: error.message, status: error.status, code: error.code } });
      throw error;
    }
    return payload;
  }

  /* A Live reference is private profile media, so it is deliberately loaded through the
   * same-origin client and converted to an in-memory data URL.  The realtime peer gets the
   * pixels for this one explicit session, not a durable or public profile URL. */
  async function liveReferenceDataUrl(lookId) {
    const response = await fetchImpl(url(`/profile/looks/${encode(lookId)}/live-reference.png`), {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new ZeelyApiError(`Zeely API returned ${response.status}`, { status: response.status });
    }
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    if (typeof globalThis.btoa !== 'function') throw new TypeError('Live reference requires base64 support');
    return `data:${blob.type || 'image/png'};base64,${globalThis.btoa(binary)}`;
  }

  function update(kind, value, type = `${kind}:updated`) {
    const patch = { [kind]: value, phase: phaseFor(value), error: null };
    return emit(type, patch);
  }

  function closeStream(key) {
    streams.get(key)?.close();
    streams.delete(key);
  }

  function watch(kind, id, eventName, path, { statusPath = null } = {}) {
    if (typeof EventSourceImpl !== 'function') {
      throw new TypeError('This environment does not provide EventSource');
    }
    const key = `${kind}:${id}`;
    closeStream(key);
    const stream = new EventSourceImpl(url(path), { withCredentials: true });
    let closed = false;
    let recoveryTimer = null;
    let recoveryAttempt = 0;
    let recoveryInFlight = false;
    let terminalPollTimer = null;
    let terminalPollInFlight = false;
    const isCurrent = () => streams.get(key) === subscription
      && snapshot[kind]?.[entityIdField(kind)] === id;
    const cancelRecovery = () => {
      if (recoveryTimer) clearTimeout(recoveryTimer);
      recoveryTimer = null;
      recoveryInFlight = false;
    };
    const cancelTerminalPoll = () => {
      if (terminalPollTimer) clearTimeout(terminalPollTimer);
      terminalPollTimer = null;
      terminalPollInFlight = false;
    };
    const scheduleTerminalPoll = () => {
      if (!statusPath || closed || terminalPollTimer || terminalPollInFlight) return;
      terminalPollTimer = setTimeout(async () => {
        terminalPollTimer = null;
        if (closed || terminalPollInFlight || !isCurrent()) return;
        terminalPollInFlight = true;
        try {
          const refreshed = await request(statusPath);
          if (closed || !isCurrent()) return;
          update(kind, refreshed, `${kind}:terminal_watchdog`);
          if (terminal.has(String(refreshed?.status ?? '').toUpperCase())) {
            closeStream(key);
            return;
          }
        } catch {
          // SSE remains the primary transport; the watchdog is best-effort.
        } finally {
          terminalPollInFlight = false;
          scheduleTerminalPoll();
        }
      }, terminalPollIntervalMs);
      // Node test runners must not stay alive for a browser-only watchdog.
      terminalPollTimer.unref?.();
    };
    const scheduleRecovery = () => {
      if (!statusPath || closed || !isCurrent() || recoveryTimer || recoveryInFlight
        || recoveryAttempt >= sseRecoveryMaxAttempts) return;
      const delay = sseRecoveryInitialDelayMs * (2 ** recoveryAttempt);
      recoveryTimer = setTimeout(async () => {
        recoveryTimer = null;
        if (closed || !isCurrent()) return;
        recoveryInFlight = true;
        recoveryAttempt += 1;
        try {
          const refreshed = await request(statusPath);
          if (closed || !isCurrent()) return;
          update(kind, refreshed, `${kind}:reconciled`);
          if (terminal.has(String(refreshed?.status ?? '').toUpperCase())) {
            closeStream(key);
            return;
          }
        } catch {
          // request() emitted the structured API error. The bounded retry below
          // is only a temporary bridge while EventSource reconnects.
        } finally {
          recoveryInFlight = false;
          scheduleRecovery();
        }
      }, delay);
    };
    const subscription = {
      close() {
        closed = true;
        cancelRecovery();
        cancelTerminalPoll();
        stream.close();
      },
    };
    stream.addEventListener(eventName, (event) => {
      try {
        cancelRecovery();
        recoveryAttempt = 0;
        const refreshed = JSON.parse(event.data);
        update(kind, refreshed, `${kind}:event`);
        if (terminal.has(String(refreshed?.status ?? '').toUpperCase())) cancelTerminalPoll();
      } catch {
        emit('connection:error', { error: { message: `Malformed ${kind} event`, code: 'MALFORMED_EVENT' } });
      }
    });
    stream.onerror = () => {
      emit('connection:reconnecting', { connection: { kind, id } });
      scheduleRecovery();
    };
    streams.set(key, subscription);
    scheduleTerminalPoll();
    // A stale cleanup must not silence a newer replacement subscription.
    return () => {
      if (streams.get(key) === subscription) closeStream(key);
    };
  }

  const client = {
    apiBase: base,
    subscribe(listener) {
      subscribers.add(listener);
      listener({ type: 'snapshot', ...structuredClone(snapshot) });
      return () => subscribers.delete(listener);
    },
    snapshot: () => structuredClone(snapshot),
    dispose() {
      [...streams.keys()].forEach(closeStream);
      subscribers.clear();
    },
    assetUrl(path) { return url(path); },

    health: () => request('/health'),
    authenticate(pin) {
      return request('/auth/pin', { method: 'POST', body: { pin: String(pin ?? '') } });
    },

    // Profile ---------------------------------------------------------------
    async loadProfile() {
      const profile = await request('/profile');
      emit('profile:updated', { profile, error: null });
      return profile;
    },
    claimRun(runId, { sourceAvatarId = null, sourceLookId = null } = {}) {
      return request(`/profile/runs/${encode(runId)}/claim`, {
        method: 'POST',
        body: { source_avatar_id: sourceAvatarId, source_look_id: sourceLookId },
      });
    },
    saveRun(runId) {
      return request(`/profile/runs/${encode(runId)}/save`, { method: 'POST' });
    },
    deleteAvatar(avatarId) {
      return request(`/profile/avatars/${encode(avatarId)}`, { method: 'DELETE' });
    },
    deleteLook(lookId) {
      return request(`/profile/looks/${encode(lookId)}`, { method: 'DELETE' });
    },
    deleteProfile() { return request('/profile', { method: 'DELETE' }); },
    avatarImageUrl: (avatarId) => url(`/profile/avatars/${encode(avatarId)}/image`),
    lookImageUrl: (lookId) => url(`/profile/looks/${encode(lookId)}/image`),
    liveReferenceDataUrl,

    // Draft / core run ------------------------------------------------------
    loadDraft: () => request('/draft'),
    updateDraft({ outfitText = '', generateScene = false, sourceAvatarId = null, sourceLookId = null }) {
      return request('/draft/meta', {
        method: 'PUT',
        body: {
          outfit_text: outfitText,
          generate_scene: generateScene,
          source_avatar_id: sourceAvatarId,
          source_look_id: sourceLookId,
        },
      });
    },
    uploadDraftFile(slot, file) {
      const data = new FormData();
      data.append('file', file, file.name);
      emit('draft:uploading', { phase: 'uploading', error: null });
      return request(`/draft/file/${encode(slot)}`, { method: 'POST', body: data });
    },
    removeDraftFile(slot, fileId) {
      return request(`/draft/file/${encode(slot)}/${encode(fileId)}`, { method: 'DELETE' });
    },
    clearDraft: () => request('/draft', { method: 'DELETE' }),
    async createRunFromDraft({ fileManifest, sourceAvatarId = null, sourceLookId = null, finalizationKey = null }) {
      const run = await request('/draft/run', {
        method: 'POST',
        body: {
          consent: true,
          finalization_key: finalizationKey || createFinalizationKey(),
          file_manifest: fileManifest,
          source_avatar_id: sourceAvatarId,
          source_look_id: sourceLookId,
        },
      });
      update('run', run, 'run:created');
      client.watchRun(run.run_id);
      return run;
    },
    async createRunFromUploads({ person, identityDetail = null, garments = [], outfitText = '' }) {
      const data = new FormData();
      data.append('consent', 'true');
      data.append('outfit_text', outfitText);
      data.append('person_photo', person, person.name);
      if (identityDetail) data.append('identity_detail', identityDetail, identityDetail.name);
      garments.forEach((file) => data.append('garment_images', file, file.name));
      const run = await request('/runs', { method: 'POST', body: data });
      update('run', run, 'run:created');
      client.watchRun(run.run_id);
      return run;
    },
    async loadRun(runId) {
      const run = await request(`/runs/${encode(runId)}`);
      update('run', run, 'run:updated');
      return run;
    },
    watchRun(runId) {
      return watch('run', runId, 'run', `/runs/${encode(runId)}/events`, {
        // EventSource can miss the terminal message while the beta daemon
        // completes the run. Reconcile only this exact active run, with a
        // bounded backoff; do not turn a transport error into broad polling.
        statusPath: `/runs/${encode(runId)}`,
      });
    },
    async retryRun(runId) {
      const run = await request(`/runs/${encode(runId)}/retry`, { method: 'POST' });
      update('run', run, 'run:retried');
      client.watchRun(run.run_id);
      return run;
    },
    async selectGarments(runId, selections) {
      const run = await request(`/runs/${encode(runId)}/garment-selection`, {
        method: 'POST', body: { selections },
      });
      update('run', run, 'run:garments_selected');
      client.watchRun(run.run_id);
      return run;
    },
    deleteRun(runId) { return request(`/runs/${encode(runId)}`, { method: 'DELETE' }); },
    runFileUrl: (runId, name) => url(`/runs/${encode(runId)}/files/${encode(name)}`),
    garmentPreviewUrl: (runId, index) => url(`/runs/${encode(runId)}/garments/${encode(index)}`),
    visualAssetUrl: (runId, assetId) => url(`/runs/${encode(runId)}/visual-assets/${encode(assetId)}`),

    // Environment scenes ----------------------------------------------------
    listScenePresets: () => request('/scene-presets'),
    scenePresetPreviewUrl: (presetId, version) => url(`/scene-presets/${encode(presetId)}/${encode(version)}/preview`),
    listScenes: (lookId) => request(`/profile/looks/${encode(lookId)}/scenes`),
    async createScene(lookId, { presetId, presetVersion, expectedReferencePackSha256 = null, idempotencyKey: key = null }) {
      const scene = await request(`/profile/looks/${encode(lookId)}/scenes`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key || createIdempotencyKey('scene') },
        body: {
          preset_id: presetId,
          preset_version: presetVersion,
          ...(expectedReferencePackSha256 ? { expected_reference_pack_sha256: expectedReferencePackSha256 } : {}),
        },
      });
      update('scene', scene, 'scene:created');
      client.watchScene(scene.scene_id);
      return scene;
    },
    async loadScene(sceneId) {
      const scene = await request(`/profile/scenes/${encode(sceneId)}`);
      update('scene', scene, 'scene:updated');
      return scene;
    },
    watchScene(sceneId) {
      return watch('scene', sceneId, 'scene', `/profile/scenes/${encode(sceneId)}/events`, {
        statusPath: `/profile/scenes/${encode(sceneId)}`,
      });
    },
    async retryScene(sceneId, key = null) {
      const scene = await request(`/profile/scenes/${encode(sceneId)}/retry`, {
        method: 'POST', headers: { 'Idempotency-Key': key || createIdempotencyKey('scene-retry') },
      });
      update('scene', scene, 'scene:retried');
      client.watchScene(scene.scene_id);
      return scene;
    },
    async cancelScene(sceneId) {
      const scene = await request(`/profile/scenes/${encode(sceneId)}/cancel`, { method: 'POST' });
      update('scene', scene, 'scene:cancelled');
      return scene;
    },
    deleteScene(sceneId) { return request(`/profile/scenes/${encode(sceneId)}`, { method: 'DELETE' }); },
    sceneImageUrl: (sceneId) => url(`/profile/scenes/${encode(sceneId)}/image`),
    sceneDownloadUrl: (sceneId) => url(`/profile/scenes/${encode(sceneId)}/download`),

    // Editorial / Fashion Shoot --------------------------------------------
    listEditorialModes: () => request('/editorial-modes'),
    editorialModePreviewUrl: (modeId, version) => url(`/editorial-modes/${encode(modeId)}/${encode(version)}/preview`),
    listShoots: (lookId) => request(`/profile/looks/${encode(lookId)}/editorial-shoots`),
    async createShoot(lookId, { modeId, modeVersion, idempotencyKey: key = null }) {
      const shoot = await request(`/profile/looks/${encode(lookId)}/editorial-shoots`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key || createIdempotencyKey('shoot') },
        body: { mode_id: modeId, mode_version: modeVersion },
      });
      update('shoot', shoot, 'shoot:created');
      client.watchShoot(shoot.shoot_id);
      return shoot;
    },
    async loadShoot(shootId) {
      const shoot = await request(`/profile/editorial-shoots/${encode(shootId)}`);
      update('shoot', shoot, 'shoot:updated');
      return shoot;
    },
    loadShootBible: (shootId) => request(`/profile/editorial-shoots/${encode(shootId)}/bible`),
    loadShootContactSheet: (shootId) => request(`/profile/editorial-shoots/${encode(shootId)}/contact-sheet`),
    watchShoot(shootId) {
      return watch('shoot', shootId, 'shoot', `/profile/editorial-shoots/${encode(shootId)}/events`, {
        statusPath: `/profile/editorial-shoots/${encode(shootId)}`,
      });
    },
    async approveShootBible(shootId, expectedBibleSha256, key = null) {
      const shoot = await request(`/profile/editorial-shoots/${encode(shootId)}/approve-bible`, {
        method: 'POST', headers: { 'Idempotency-Key': key || createIdempotencyKey('shoot-bible') },
        body: { expected_bible_sha256: expectedBibleSha256 },
      });
      update('shoot', shoot, 'shoot:bible_approved');
      return shoot;
    },
    async approveShootHero(shootId, expectedOutputSha256, key = null) {
      const shoot = await request(`/profile/editorial-shoots/${encode(shootId)}/approve-hero`, {
        method: 'POST', headers: { 'Idempotency-Key': key || createIdempotencyKey('shoot-hero') },
        body: { expected_output_sha256: expectedOutputSha256 },
      });
      update('shoot', shoot, 'shoot:hero_approved');
      return shoot;
    },
    async retryShootShot(shootId, slot, key = null) {
      const shoot = await request(`/profile/editorial-shoots/${encode(shootId)}/shots/${encode(slot)}/retry`, {
        method: 'POST', headers: { 'Idempotency-Key': key || createIdempotencyKey('shoot-retry') },
      });
      update('shoot', shoot, 'shoot:shot_retried');
      client.watchShoot(shoot.shoot_id);
      return shoot;
    },
    async cancelShoot(shootId) {
      const shoot = await request(`/profile/editorial-shoots/${encode(shootId)}/cancel`, { method: 'POST' });
      update('shoot', shoot, 'shoot:cancelled');
      return shoot;
    },
    deleteShoot(shootId) { return request(`/profile/editorial-shoots/${encode(shootId)}`, { method: 'DELETE' }); },
    shootShotImageUrl: (shootId, slot) => url(`/profile/editorial-shoots/${encode(shootId)}/shots/${encode(slot)}/image`),
    // The image route is for the progressive in-mirror preview. The separate
    // download route is the immutable delivered file, so a preview derivative
    // can never accidentally become the user's download.
    shootShotDownloadUrl: (shootId, slot) => url(`/profile/editorial-shoots/${encode(shootId)}/shots/${encode(slot)}/download`),

    // Fashion Video ---------------------------------------------------------
    videoCapability: (lookId) => request(`/profile/looks/${encode(lookId)}/video-capability`),
    videoStylePreviewUrl: (lookId, styleId) => url(`/profile/looks/${encode(lookId)}/video-styles/${encode(styleId)}/preview`),
    videoStylePlaybackUrl: (lookId, styleId) => url(`/profile/looks/${encode(lookId)}/video-styles/${encode(styleId)}/playback`),
    videoStyleReferenceUrl: (lookId, styleId) => url(`/profile/looks/${encode(lookId)}/video-styles/${encode(styleId)}/reference`),
    listVideos: (lookId) => request(`/profile/looks/${encode(lookId)}/video-clips`),
    async createVideo({ lookId, surface = null, styleId, motionMode, durationSeconds, styleNote }) {
      const video = await request('/profile/video-clips', {
        method: 'POST',
        body: {
          look_id: lookId,
          style_id: styleId,
          motion_mode: motionMode,
          // The newer server derives this from the immutable style reference.
          // Keep an optional derived value only for older server releases.
          ...(surface === 'tv' || surface === 'mirror' ? { surface } : {}),
          ...(durationSeconds ? { duration_seconds: durationSeconds } : {}),
          ...(styleNote ? { style_note: styleNote } : {}),
        },
      });
      update('video', video, 'video:created');
      return video;
    },
    async retryVideo(clipId, key = null) {
      const video = await request(`/profile/video-clips/${encode(clipId)}/retry`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key || createIdempotencyKey('video-retry') },
      });
      update('video', video, 'video:retried');
      client.watchVideo(video.clip_id);
      return video;
    },
    async loadVideo(clipId) {
      const video = await request(`/profile/video-clips/${encode(clipId)}`);
      update('video', video, 'video:updated');
      return video;
    },
    /**
     * Video has no SSE route in the current beta contract. Poll its durable
     * projection instead; callers own the returned stop function just as they
     * do for EventSource-backed resources.
     */
    watchVideo(clipId, { intervalMs = 2_500 } = {}) {
      if (!Number.isFinite(intervalMs) || intervalMs < 250) {
        throw new RangeError('watchVideo intervalMs must be at least 250ms');
      }
      const key = `video:${clipId}`;
      closeStream(key);
      let stopped = false;
      const poll = async () => {
        if (stopped) return;
        try {
          const video = await client.loadVideo(clipId);
          if (client.isTerminal(video)) closeStream(key);
        } catch (error) {
          // `request()` already emits the structured failure. Keep polling for
          // transient provider/proxy errors until the presentation stops it.
        }
      };
      const timer = setInterval(poll, intervalMs);
      const watcher = {
        close() {
          stopped = true;
          clearInterval(timer);
        },
      };
      streams.set(key, watcher);
      void poll();
      return () => {
        if (streams.get(key) === watcher) closeStream(key);
      };
    },
    async finalizeVideo(clipId) {
      const video = await request(`/profile/video-clips/${encode(clipId)}/finalize`, { method: 'POST' });
      update('video', video, 'video:finalized');
      return video;
    },
    deleteVideo(clipId) { return request(`/profile/video-clips/${encode(clipId)}`, { method: 'DELETE' }); },
    videoUrl: (clipId) => url(`/profile/video-clips/${encode(clipId)}/video`),
    // The server authorizes both URLs against the current private profile. A
    // playback URL is not a share link; this attachment URL only changes the
    // browser disposition of the same verified delivery file.
    videoDownloadUrl: (clipId) => url(`/profile/video-clips/${encode(clipId)}/download`),

    // Live mirror -----------------------------------------------------------
    postShootPipeline: () => request('/post-shoot/pipeline'),
    realtimeCapability: (lookId) => request(`/post-shoot/realtime-look-capability?look_id=${encode(lookId)}`),
    /**
     * This requests a short-lived provider token only. Camera access and the
     * realtime connection remain the caller's job. Consent arguments are
     * deliberately explicit: a cinematic UI must never turn an arrival at a
     * mirror into an implicit paid or privacy-sensitive session.
     */
    startLiveLook({
      lookId,
      capability = null,
      privacyConsent = false,
      costAcknowledged = false,
    } = {}) {
      /* The server capability owns both the enabled application and the allowed time.
       * A presentation must never smuggle a stale 15-second default (or a decorative
       * 40-second claim) into a Live request. When the capability changes, every visual
       * site gets the new limit through the same neutral client contract. */
      const app = capability?.app ?? capability?.default_app ?? null;
      const rawLimit = capability?.max_session_seconds ?? capability?.maxSessionSeconds ?? null;
      const maxSessionSeconds = Number(rawLimit);
      const hasServerLimit = Number.isFinite(maxSessionSeconds) && maxSessionSeconds > 0;
      return request('/fal/realtime-token', {
        method: 'POST',
        responseType: 'text',
        body: {
          ...(app ? { app } : {}),
          look_id: lookId,
          privacy_consent: privacyConsent,
          cost_acknowledged: costAcknowledged,
          ...(hasServerLimit ? { max_session_seconds: maxSessionSeconds } : {}),
        },
      });
    },

    isTerminal(entity) { return terminal.has(String(entity?.status ?? '').toUpperCase()); },
    canLeaveAttentionStation() {
      return !['uploading', 'running', 'needs_input', 'waiting_for_approval', 'recovering'].includes(snapshot.phase);
    },
  };

  return Object.freeze(client);
}
