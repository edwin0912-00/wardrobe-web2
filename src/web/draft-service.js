import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const COOKIE_NAME = 'zeely_draft_session';
export const DRAFT_TTL_MS = 15 * 60 * 1000;
const SESSION_SECONDS = DRAFT_TTL_MS / 1000;
const MAX_FILE_BYTES = 18 * 1024 * 1024;
const MIME_EXTENSION = new Map([['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp']]);
export const RUN_IMAGE_MIN_EDGE = 256;
export const RUN_IMAGE_MAX_EDGE = 4096;
export const DRAFT_MAX_UPSCALE_FACTOR = 4;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function preparationError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

function displayDimensions(metadata) {
  const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation);
  return swapsAxes
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

/**
 * Produces the bounded, deterministic copy that RunService stores as its
 * immutable input. The browser draft remains byte-for-byte unchanged.
 * Resampling can satisfy the transport minimum; it never claims to restore
 * detail that is absent from the source image.
 */
export async function prepareDraftUploadForRun(upload, {
  field = 'image',
  minimumEdge = RUN_IMAGE_MIN_EDGE,
  maximumEdge = RUN_IMAGE_MAX_EDGE,
  maximumUpscaleFactor = DRAFT_MAX_UPSCALE_FACTOR,
} = {}) {
  if (!upload?.buffer?.length) throw preparationError(`${field} is missing from the draft`);
  let metadata;
  try {
    metadata = await sharp(upload.buffer, { failOn: 'error', unlimited: false }).metadata();
  } catch {
    throw preparationError(`${field} is not a decodable image`);
  }
  if (!metadata.width || !metadata.height) throw preparationError(`${field} has no usable dimensions`);
  if (metadata.pages && metadata.pages > 1) throw preparationError(`${field} must be a still image`);

  const source = displayDimensions(metadata);
  const requiredScale = Math.max(1, minimumEdge / source.width, minimumEdge / source.height);
  const targetWidth = Math.ceil(source.width * requiredScale);
  const targetHeight = Math.ceil(source.height * requiredScale);
  const baseEvidence = {
    policy: 'DRAFT_RUN_INPUT_V1',
    source_width: source.width,
    source_height: source.height,
    minimum_edge: minimumEdge,
    maximum_edge: maximumEdge,
    maximum_upscale_factor: maximumUpscaleFactor,
    source_sha256: digest(upload.buffer),
    semantic_generation: false,
  };

  if (requiredScale === 1) {
    return {
      ...upload,
      preparation: {
        ...baseEvidence,
        method: 'UNCHANGED',
        output_width: source.width,
        output_height: source.height,
        scale: 1,
        output_sha256: baseEvidence.source_sha256,
      },
    };
  }
  if (requiredScale > maximumUpscaleFactor) {
    throw preparationError(
      `${field} is too small for bounded preparation: ${source.width}×${source.height}; `
      + `maximum upscale is ${maximumUpscaleFactor}×`,
    );
  }
  if (Math.max(targetWidth, targetHeight) > maximumEdge) {
    throw preparationError(
      `${field} aspect ratio cannot reach ${minimumEdge} px on both edges within the ${maximumEdge} px output limit`,
    );
  }

  const buffer = await sharp(upload.buffer, { failOn: 'error', unlimited: false })
    .rotate()
    .toColourspace('srgb')
    .resize({ width: targetWidth, height: targetHeight, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const stem = String(upload.filename ?? field).replace(/\.[^.]+$/, '') || field;
  return {
    filename: `${stem}-prepared.png`,
    mimetype: 'image/png',
    buffer,
    preparation: {
      ...baseEvidence,
      method: 'DETERMINISTIC_LANCZOS3_UPSCALE',
      output_width: targetWidth,
      output_height: targetHeight,
      scale: Number(requiredScale.toFixed(6)),
      output_sha256: digest(buffer),
    },
  };
}

function cookies(header = '') {
  return Object.fromEntries(header.split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value));
}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '');
}

function defaultManifest() {
  return { version: 1, outfit_text: '', generate_scene: false, person: null, identity: null, garments: [], updated_at: new Date().toISOString() };
}

export class DraftService {
  constructor({ rootDirectory }) { this.rootDirectory = path.resolve(rootDirectory); }
  async initialize() { await mkdir(this.rootDirectory, { recursive: true }); }
  directory(sessionId) { return path.join(this.rootDirectory, sessionId); }
  manifestPath(sessionId) { return path.join(this.directory(sessionId), 'draft.json'); }

  async read(sessionId) {
    try {
      const manifest = JSON.parse(await readFile(this.manifestPath(sessionId), 'utf8'));
      if (Date.now() - Date.parse(manifest.updated_at) > DRAFT_TTL_MS) {
        await this.clear(sessionId);
        return defaultManifest();
      }
      return manifest;
    }
    catch (error) { if (error.code === 'ENOENT') return defaultManifest(); throw error; }
  }

  async cleanupExpired() {
    let entries;
    try { entries = await readdir(this.rootDirectory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      try {
        const manifest = JSON.parse(await readFile(this.manifestPath(entry.name), 'utf8'));
        if (Date.now() - Date.parse(manifest.updated_at) <= DRAFT_TTL_MS) continue;
      } catch (error) {
        if (error.code !== 'ENOENT') continue;
      }
      await this.clear(entry.name);
      removed += 1;
    }
    return removed;
  }

  async #write(sessionId, manifest) {
    const directory = this.directory(sessionId);
    await mkdir(directory, { recursive: true });
    const value = { ...manifest, updated_at: new Date().toISOString() };
    const temporary = path.join(directory, `.draft-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, this.manifestPath(sessionId));
    return value;
  }

  async updateMetadata(sessionId, { outfit_text = '', generate_scene = false }) {
    const manifest = await this.read(sessionId);
    manifest.outfit_text = String(outfit_text).slice(0, 4_000);
    manifest.generate_scene = generate_scene === true;
    return this.#write(sessionId, manifest);
  }

  async saveFile(sessionId, slot, upload) {
    if (!['person', 'identity', 'garment'].includes(slot)) throw new Error('Invalid draft slot');
    const extension = MIME_EXTENSION.get(upload.mimetype);
    if (!extension) throw new Error('Draft image must be PNG, JPEG, or WEBP');
    if (!upload.buffer?.length || upload.buffer.length > MAX_FILE_BYTES) throw new Error('Draft image must be between 1 byte and 18 MB');
    const manifest = await this.read(sessionId);
    const id = randomUUID();
    const filename = `${id}${extension}`;
    const directory = this.directory(sessionId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), upload.buffer, { flag: 'wx', mode: 0o600 });
    const descriptor = { id, filename, mimetype: upload.mimetype, size: upload.buffer.length };
    if (slot === 'garment') {
      if (manifest.garments.length >= 5) { await rm(path.join(directory, filename), { force: true }); throw new Error('Draft already has five garments'); }
      manifest.garments.push(descriptor);
    } else {
      const previous = manifest[slot];
      manifest[slot] = descriptor;
      if (previous?.filename) await rm(path.join(directory, previous.filename), { force: true });
    }
    await this.#write(sessionId, manifest);
    return descriptor;
  }

  async removeFile(sessionId, slot, id) {
    const manifest = await this.read(sessionId);
    let removed = null;
    if (slot === 'person' || slot === 'identity') {
      if (manifest[slot]?.id === id) { removed = manifest[slot]; manifest[slot] = null; }
    } else if (slot === 'garment') {
      const index = manifest.garments.findIndex((item) => item.id === id);
      if (index >= 0) [removed] = manifest.garments.splice(index, 1);
    }
    if (removed?.filename) await rm(path.join(this.directory(sessionId), removed.filename), { force: true });
    await this.#write(sessionId, manifest);
    return Boolean(removed);
  }

  async file(sessionId, slot, id) {
    const manifest = await this.read(sessionId);
    const descriptor = slot === 'person' || slot === 'identity'
      ? (manifest[slot]?.id === id ? manifest[slot] : null)
      : manifest.garments.find((item) => item.id === id);
    if (!descriptor) return null;
    const filename = path.join(this.directory(sessionId), descriptor.filename);
    await stat(filename);
    return { descriptor, buffer: await readFile(filename) };
  }

  async clear(sessionId) { await rm(this.directory(sessionId), { recursive: true, force: true }); }
}

function publicManifest(manifest) {
  const descriptor = (slot, item) => item ? { id: item.id, size: item.size, mimetype: item.mimetype, url: `/api/draft/file/${slot}/${item.id}` } : null;
  return {
    outfit_text: manifest.outfit_text,
    generate_scene: manifest.generate_scene,
    updated_at: manifest.updated_at,
    person: descriptor('person', manifest.person),
    identity: descriptor('identity', manifest.identity),
    garments: manifest.garments.map((item) => descriptor('garment', item)),
  };
}

export async function registerDraftRoutes(app, { service, runService = null, profileService = null, profileApi = null, secureCookie = true }) {
  function session(request, reply) {
    const supplied = cookies(request.headers.cookie)[COOKIE_NAME];
    const id = validId(supplied) ? supplied : randomUUID();
    reply.header('Set-Cookie', `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secureCookie ? '; Secure' : ''}`);
    return id;
  }

  app.get('/api/draft', async (request, reply) => {
    const sessionId = session(request, reply);
    const current = await service.read(sessionId);
    return publicManifest(await service.updateMetadata(sessionId, current));
  });
  app.put('/api/draft/meta', async (request, reply) => publicManifest(await service.updateMetadata(session(request, reply), request.body ?? {})));
  app.post('/api/draft/file/:slot', async (request, reply) => {
    const part = await request.file({ limits: { files: 1, fileSize: MAX_FILE_BYTES } });
    if (!part) return reply.code(400).send({ error: 'Draft file is required' });
    const descriptor = await service.saveFile(session(request, reply), request.params.slot, {
      mimetype: part.mimetype,
      buffer: await part.toBuffer(),
    });
    return reply.code(201).send({ id: descriptor.id, size: descriptor.size, mimetype: descriptor.mimetype });
  });
  app.delete('/api/draft/file/:slot/:id', async (request, reply) => {
    const removed = await service.removeFile(session(request, reply), request.params.slot, request.params.id);
    return removed ? reply.code(204).send() : reply.code(404).send({ error: 'Draft file not found' });
  });
  app.get('/api/draft/file/:slot/:id', async (request, reply) => {
    const value = await service.file(session(request, reply), request.params.slot, request.params.id);
    return value ? reply.type(value.descriptor.mimetype).send(value.buffer) : reply.code(404).send({ error: 'Draft file not found' });
  });
  app.delete('/api/draft', async (request, reply) => { await service.clear(session(request, reply)); return reply.code(204).send(); });
  if (runService) app.post('/api/draft/run', async (request, reply) => {
    if (request.body?.consent !== true) return reply.code(400).send({ error: 'Consent is required for processing personal images' });
    const finalizationKey = request.body?.finalization_key;
    if (finalizationKey !== undefined && !validId(finalizationKey)) {
      return reply.code(400).send({ error: 'finalization_key must be a valid UUID v4' });
    }
    const resolvedRunId = finalizationKey ?? (profileService && profileApi ? randomUUID() : null);
    const sourceAvatarId = request.body?.source_avatar_id ?? null;
    if (sourceAvatarId !== null && typeof sourceAvatarId !== 'string') {
      return reply.code(400).send({ error: 'source_avatar_id must be a UUID or null' });
    }
    if (sourceAvatarId !== null && (!profileService || !profileApi)) {
      return reply.code(400).send({ error: 'Saved avatar profiles are not enabled' });
    }
    const sessionId = session(request, reply);
    const manifest = await service.read(sessionId);
    if (!manifest.person) return reply.code(400).send({ error: 'Фото людини відсутнє в чернетці' });
    const asUpload = async (slot, descriptor, field) => {
      const value = await service.file(sessionId, slot, descriptor.id);
      if (!value) throw new Error(`Файл ${slot} відсутній у чернетці`);
      return prepareDraftUploadForRun(
        { filename: descriptor.filename, mimetype: descriptor.mimetype, buffer: value.buffer },
        { field },
      );
    };
    const person = await asUpload('person', manifest.person, 'person_photo');
    const identityDetail = manifest.identity
      ? await asUpload('identity', manifest.identity, 'identity_detail')
      : null;
    const garments = await Promise.all(manifest.garments.map((item, index) => (
      asUpload('garment', item, `garment_images[${index}]`)
    )));
    let approvedAvatarReference = null;
    let profileSession = null;
    if (profileService && profileApi) {
      profileSession = await profileApi.resolveRequestProfile(request, reply);
      if (sourceAvatarId !== null) {
        const asset = profileService.avatarAsset(profileSession.profileId, sourceAvatarId);
        if (!asset) return reply.code(404).send({ error: 'Saved avatar not found' });
        approvedAvatarReference = await runService.approvedAvatarReferenceForRun(asset.runId);
      }
      profileService.claimRun(profileSession.profileId, resolvedRunId, { sourceAvatarId });
    }
    const run = await runService.createRun({
      person,
      identityDetail,
      garments,
      outfitText: manifest.outfit_text,
      generateScene: manifest.generate_scene,
      approvedAvatarReference,
      ...(resolvedRunId === null ? {} : { runId: resolvedRunId }),
    });
    return reply.code(202).send(run);
  });
}
