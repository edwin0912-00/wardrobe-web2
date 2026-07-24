const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' });

async function profileRequest(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Profile request timed out: ${url}`)), 8_000);
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: options.body ? { ...JSON_HEADERS, ...options.headers } : options.headers,
      signal: controller.signal,
    });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Profile request failed (${response.status})`);
      error.status = response.status;
      error.code = body.code;
      error.body = body;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function loadProfile() {
  return profileRequest('/api/profile');
}

export function claimProfileRun(runId, lineage = {}) {
  const sourceAvatarId = typeof lineage === 'string'
    ? lineage
    : lineage?.sourceAvatarId ?? null;
  const sourceLookId = typeof lineage === 'object' && lineage !== null
    ? lineage.sourceLookId ?? null
    : null;
  return profileRequest(`/api/profile/runs/${encodeURIComponent(runId)}/claim`, {
    method: 'POST',
    body: JSON.stringify({
      source_avatar_id: sourceAvatarId,
      source_look_id: sourceLookId,
    }),
  });
}

export function saveProfileRun(runId) {
  return profileRequest(`/api/profile/runs/${encodeURIComponent(runId)}/save`, { method: 'POST' });
}

export function deleteProfileAvatar(avatarId) {
  return profileRequest(`/api/profile/avatars/${encodeURIComponent(avatarId)}`, { method: 'DELETE' });
}

export function deleteProfileLook(lookId) {
  return profileRequest(`/api/profile/looks/${encodeURIComponent(lookId)}`, { method: 'DELETE' });
}

export function deleteAnonymousProfile() {
  return profileRequest('/api/profile', { method: 'DELETE' });
}

export function loadScenePresets() {
  return profileRequest('/api/scene-presets', { cache: 'no-store' });
}

export function loadEditorialModes() {
  return profileRequest('/api/editorial-modes', { cache: 'no-store' });
}

export function createProfileEditorialShoot(lookId, {
  modeId,
  modeVersion,
  idempotencyKey,
}) {
  return profileRequest(`/api/profile/looks/${encodeURIComponent(lookId)}/editorial-shoots`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      mode_id: modeId,
      mode_version: modeVersion,
    }),
  });
}

export function listProfileLookEditorialShoots(lookId) {
  return profileRequest(
    `/api/profile/looks/${encodeURIComponent(lookId)}/editorial-shoots`,
    { cache: 'no-store' },
  );
}

export function loadProfileEditorialShoot(shootId) {
  return profileRequest(`/api/profile/editorial-shoots/${encodeURIComponent(shootId)}`, {
    cache: 'no-store',
  });
}

export function loadProfileEditorialShootBible(shootId) {
  return profileRequest(`/api/profile/editorial-shoots/${encodeURIComponent(shootId)}/bible`, {
    cache: 'no-store',
  });
}

export function approveProfileEditorialBible(shootId, {
  expectedBibleSha256,
  idempotencyKey,
}) {
  return profileRequest(
    `/api/profile/editorial-shoots/${encodeURIComponent(shootId)}/approve-bible`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ expected_bible_sha256: expectedBibleSha256 }),
    },
  );
}

export function approveProfileEditorialHero(shootId, {
  expectedOutputSha256,
  idempotencyKey,
}) {
  return profileRequest(
    `/api/profile/editorial-shoots/${encodeURIComponent(shootId)}/approve-hero`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ expected_output_sha256: expectedOutputSha256 }),
    },
  );
}

export function retryProfileEditorialShot(shootId, slot, idempotencyKey) {
  return profileRequest(
    `/api/profile/editorial-shoots/${encodeURIComponent(shootId)}/shots/${encodeURIComponent(slot)}/retry`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

export function cancelProfileEditorialShoot(shootId) {
  return profileRequest(
    `/api/profile/editorial-shoots/${encodeURIComponent(shootId)}/cancel`,
    { method: 'POST' },
  );
}

export function deleteProfileEditorialShoot(shootId) {
  return profileRequest(
    `/api/profile/editorial-shoots/${encodeURIComponent(shootId)}`,
    { method: 'DELETE' },
  );
}

export function listProfileLookScenes(lookId) {
  return profileRequest(`/api/profile/looks/${encodeURIComponent(lookId)}/scenes`, {
    cache: 'no-store',
  });
}

export function createProfileScene(lookId, {
  presetId,
  presetVersion,
  expectedReferencePackSha256 = null,
  idempotencyKey,
}) {
  return profileRequest(`/api/profile/looks/${encodeURIComponent(lookId)}/scenes`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      preset_id: presetId,
      preset_version: presetVersion,
      ...(expectedReferencePackSha256
        ? { expected_reference_pack_sha256: expectedReferencePackSha256 }
        : {}),
    }),
  });
}

export function loadProfileScene(sceneId) {
  return profileRequest(`/api/profile/scenes/${encodeURIComponent(sceneId)}`, {
    cache: 'no-store',
  });
}

export function retryProfileScene(sceneId, idempotencyKey) {
  return profileRequest(`/api/profile/scenes/${encodeURIComponent(sceneId)}/retry`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function cancelProfileScene(sceneId) {
  return profileRequest(`/api/profile/scenes/${encodeURIComponent(sceneId)}/cancel`, {
    method: 'POST',
  });
}

export function deleteProfileScene(sceneId) {
  return profileRequest(`/api/profile/scenes/${encodeURIComponent(sceneId)}`, {
    method: 'DELETE',
  });
}

export async function avatarFileFromProfile(avatar) {
  const response = await fetch(avatar.image_url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Не вдалося відкрити збережений аватар');
  const blob = await response.blob();
  return new File([blob], `zeely-${avatar.id ?? avatar.avatar_id}.png`, { type: blob.type || 'image/png', lastModified: Date.now() });
}
