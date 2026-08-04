import { uploadFormData } from './image-upload.js?v=20260722-8';
import {
  draftBindingsFromManifest,
  draftRefsFromBindings,
  finalizationFileManifest,
  sha256Blob,
} from './draft-file-contract.js?v=20260723-1';
import { publicErrorCode } from './error-presentation.js?v=20260804-1';

export class DraftApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'DraftApiError';
    this.status = status;
    this.body = body;
    this.code = publicErrorCode(body);
    this.failure_code = publicErrorCode({ failure_code: body?.failure_code ?? body?.failureCode });
    this.reason_code = publicErrorCode({ reason_code: body?.reason_code ?? body?.reasonCode });
    this.next_action = typeof body?.next_action === 'string' ? body.next_action : null;
    this.next_action_reason_code = publicErrorCode({
      next_action_reason_code: body?.next_action_reason_code ?? body?.nextActionReasonCode,
    });
  }
}

export function isDefinitiveDraftRunRejection(error) {
  return error instanceof DraftApiError && error.status >= 400 && error.status < 500;
}

export function clearDefinitivelyRejectedRunState(error, finalizationId, storage) {
  if (!isDefinitiveDraftRunRejection(error)) return false;
  if (storage.getItem('zeely_pending_finalization_id') === finalizationId) {
    storage.removeItem('zeely_pending_finalization_id');
  }
  if (storage.getItem('zeely_active_run_id') === finalizationId) {
    storage.removeItem('zeely_active_run_id');
  }
  return true;
}

function extensionFor(type) {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

async function jsonResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new DraftApiError(body.error || `Draft API: HTTP ${response.status}`, {
      status: response.status,
      body,
    });
  }
  return body;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out: ${url}`)), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadDraftFile(slot, file, { onProgress = () => {} } = {}) {
  const data = new FormData();
  data.append('file', file, file.name);
  const response = await uploadFormData(`/api/draft/file/${encodeURIComponent(slot)}`, data, { timeoutMs: 10 * 60_000, onProgress });
  if (!response.ok) {
    throw new DraftApiError(response.body?.error || `Чернетку не збережено: HTTP ${response.status}`, {
      status: response.status,
      body: response.body,
    });
  }
  return response.body;
}

export async function updateServerDraftMetadata({
  outfitText,
  generateScene,
  sourceAvatarId = null,
  sourceLookId = null,
}) {
  return jsonResponse(await fetchWithTimeout('/api/draft/meta', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      outfit_text: outfitText,
      generate_scene: generateScene,
      source_avatar_id: sourceAvatarId,
      source_look_id: sourceLookId,
    }),
  }));
}

async function downloadFile(descriptor, label) {
  if (!descriptor) return null;
  const response = await fetchWithTimeout(descriptor.url, {}, 30_000);
  if (!response.ok) throw new Error(`Не вдалося відновити ${label}`);
  const blob = await response.blob();
  if (await sha256Blob(blob) !== descriptor.sha256) {
    throw new Error(`Серверна копія ${label} пошкоджена`);
  }
  return new File([blob], `${label}.${extensionFor(descriptor.mimetype)}`, { type: descriptor.mimetype, lastModified: Date.now() });
}

export async function loadServerDraft({ includeFiles = true } = {}) {
  const manifest = await jsonResponse(await fetchWithTimeout('/api/draft'));
  const bindings = draftBindingsFromManifest(manifest);
  const refs = draftRefsFromBindings(bindings);
  if (!includeFiles) return { manifest, bindings, refs, files: null };
  return {
    manifest,
    bindings,
    refs,
    files: {
      person: await downloadFile(manifest.person, 'person-draft'),
      identityDetail: await downloadFile(manifest.identity, 'identity-draft'),
      garments: await Promise.all((manifest.garments || []).map((item, index) => downloadFile(item, `garment-${index + 1}-draft`))),
    },
  };
}

export async function removeServerDraftFile(slot, id) {
  if (!id) return;
  const response = await fetchWithTimeout(`/api/draft/file/${encodeURIComponent(slot)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Не вдалося видалити temp ${slot}: HTTP ${response.status}`);
}

export async function clearServerDraft() {
  const response = await fetchWithTimeout('/api/draft', { method: 'DELETE' });
  if (!response.ok) throw new Error('Не вдалося очистити server draft');
}

export async function createRunFromServerDraft(finalizationKey, {
  timeoutMs = 30_000,
  sourceAvatarId = null,
  sourceLookId = null,
  fileManifest,
} = {}) {
  if (!fileManifest) throw new Error('Точний склад файлів чернетки не підтверджено');
  const body = { consent: true };
  if (finalizationKey !== undefined && finalizationKey !== null) body.finalization_key = finalizationKey;
  if (sourceAvatarId !== null) body.source_avatar_id = sourceAvatarId;
  if (sourceLookId !== null) body.source_look_id = sourceLookId;
  body.file_manifest = finalizationFileManifest(fileManifest);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Run creation request timed out')), timeoutMs);
  try {
    return jsonResponse(await fetch('/api/draft/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }));
  } finally {
    clearTimeout(timeout);
  }
}
