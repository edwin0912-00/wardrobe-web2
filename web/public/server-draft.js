import { uploadFormData } from './image-upload.js?v=20260722-8';

function extensionFor(type) {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

async function jsonResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Draft API: HTTP ${response.status}`);
  return body;
}

export async function uploadDraftFile(slot, file, { onProgress = () => {} } = {}) {
  const data = new FormData();
  data.append('file', file, file.name);
  const response = await uploadFormData(`/api/draft/file/${encodeURIComponent(slot)}`, data, { timeoutMs: 10 * 60_000, onProgress });
  if (!response.ok) throw new Error(response.body?.error || `Чернетку не збережено: HTTP ${response.status}`);
  return response.body;
}

export async function updateServerDraftMetadata({ outfitText, generateScene }) {
  return jsonResponse(await fetch('/api/draft/meta', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outfit_text: outfitText, generate_scene: generateScene }),
  }));
}

async function downloadFile(descriptor, label) {
  if (!descriptor) return null;
  const response = await fetch(descriptor.url);
  if (!response.ok) throw new Error(`Не вдалося відновити ${label}`);
  const blob = await response.blob();
  return new File([blob], `${label}.${extensionFor(descriptor.mimetype)}`, { type: descriptor.mimetype, lastModified: Date.now() });
}

export async function loadServerDraft({ includeFiles = true } = {}) {
  const manifest = await jsonResponse(await fetch('/api/draft'));
  const refs = {
    person: manifest.person?.id || null,
    identity: manifest.identity?.id || null,
    garments: (manifest.garments || []).map((item) => item.id),
  };
  if (!includeFiles) return { manifest, refs, files: null };
  return {
    manifest,
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
  const response = await fetch(`/api/draft/file/${encodeURIComponent(slot)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Не вдалося видалити temp ${slot}`);
}

export async function clearServerDraft() {
  const response = await fetch('/api/draft', { method: 'DELETE' });
  if (!response.ok) throw new Error('Не вдалося очистити server draft');
}

export async function createRunFromServerDraft() {
  return jsonResponse(await fetch('/api/draft/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ consent: true }),
  }));
}
