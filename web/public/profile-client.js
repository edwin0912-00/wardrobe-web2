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
    if (!response.ok) throw new Error(body.error || `Profile request failed (${response.status})`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function loadProfile() {
  return profileRequest('/api/profile');
}

export function claimProfileRun(runId, sourceAvatarId = null) {
  return profileRequest(`/api/profile/runs/${encodeURIComponent(runId)}/claim`, {
    method: 'POST',
    body: JSON.stringify({ source_avatar_id: sourceAvatarId }),
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

export async function avatarFileFromProfile(avatar) {
  const response = await fetch(avatar.image_url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Не вдалося відкрити збережений аватар');
  const blob = await response.blob();
  return new File([blob], `zeely-${avatar.id ?? avatar.avatar_id}.png`, { type: blob.type || 'image/png', lastModified: Date.now() });
}
