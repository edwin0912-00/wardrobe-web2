import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { isDeepStrictEqual } from 'node:util';

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

function preparationError(code, message, {
  field = 'image',
  requirements = [],
  nextAction = 'REPLACE_INPUT',
} = {}) {
  const error = new Error(message);
  error.name = 'InputNeedsInputError';
  error.statusCode = 422;
  error.status = 'NEEDS_INPUT';
  error.code = code;
  error.field = field;
  error.requirements = requirements;
  error.nextAction = nextAction;
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
  if (!upload?.buffer?.length) {
    throw preparationError('DRAFT_INPUT_MISSING', `${field} is missing from the draft`, {
      field,
      requirements: ['non-empty draft image'],
    });
  }
  let metadata;
  try {
    metadata = await sharp(upload.buffer, { failOn: 'error', unlimited: false }).metadata();
  } catch {
    throw preparationError('IMAGE_DECODE_FAILED', `${field} is not a decodable image`, {
      field,
      requirements: ['valid, non-corrupt image bytes'],
    });
  }
  if (!metadata.width || !metadata.height) {
    throw preparationError(
      'IMAGE_DIMENSIONS_UNAVAILABLE',
      `${field} has no usable dimensions`,
      { field, requirements: ['image with readable width and height'] },
    );
  }
  if (metadata.pages && metadata.pages > 1) {
    throw preparationError(
      'ANIMATED_IMAGE_UNSUPPORTED',
      `${field} must be a still image`,
      { field, requirements: ['single-frame image'] },
    );
  }

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
      'IMAGE_TOO_SMALL',
      `${field} is too small for bounded preparation: ${source.width}×${source.height}; `
      + `maximum upscale is ${maximumUpscaleFactor}×`,
      {
        field,
        requirements: [
          `minimum prepared edge ${minimumEdge} px`,
          `maximum deterministic upscale ${maximumUpscaleFactor}×`,
        ],
      },
    );
  }
  if (Math.max(targetWidth, targetHeight) > maximumEdge) {
    throw preparationError(
      'IMAGE_ASPECT_UNSUPPORTED',
      `${field} aspect ratio cannot reach ${minimumEdge} px on both edges within the ${maximumEdge} px output limit`,
      {
        field,
        requirements: [`maximum prepared edge ${maximumEdge} px`],
      },
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

function validDigest(value) {
  return /^[0-9a-f]{64}$/i.test(value ?? '');
}

const DRAFT_MODE_NEW_AVATAR = 'NEW_AVATAR';
const DRAFT_MODE_ADD_ITEMS = 'ADD_ITEMS';
const DRAFT_MODES = new Set([DRAFT_MODE_NEW_AVATAR, DRAFT_MODE_ADD_ITEMS]);

function draftConflict(message, code = 'DRAFT_FILE_MANIFEST_MISMATCH') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function invalidDraftMode(value) {
  const error = new Error(`draft_mode must be ${DRAFT_MODE_NEW_AVATAR} or ${DRAFT_MODE_ADD_ITEMS}`);
  error.statusCode = 400;
  error.code = 'INVALID_DRAFT_MODE';
  error.value = value;
  return error;
}

function storedDraftIntent(manifest) {
  const explicitMode = manifest.draft_mode;
  const mode = explicitMode === undefined || explicitMode === null
    // Compatibility for manifests written before draft_mode existed. A saved
    // source was already an add-items binding, so migrate it fail-closed.
    ? (manifest.source_avatar_id ? DRAFT_MODE_ADD_ITEMS : DRAFT_MODE_NEW_AVATAR)
    : explicitMode;
  if (!DRAFT_MODES.has(mode)) throw invalidDraftMode(mode);

  const sourceAvatarId = manifest.source_avatar_id ?? null;
  const sourceLookId = manifest.source_look_id ?? null;
  if (mode === DRAFT_MODE_ADD_ITEMS && !validId(sourceAvatarId)) {
    throw draftConflict(
      'ADD_ITEMS draft requires a persisted source_avatar_id',
      'ADD_ITEMS_SOURCE_REQUIRED',
    );
  }
  if (mode === DRAFT_MODE_NEW_AVATAR && sourceAvatarId !== null) {
    throw draftConflict(
      'NEW_AVATAR draft cannot contain source_avatar_id',
      'DRAFT_MODE_SOURCE_MISMATCH',
    );
  }
  if (sourceLookId !== null && (mode !== DRAFT_MODE_ADD_ITEMS || !validId(sourceLookId))) {
    throw draftConflict(
      'source_look_id requires an ADD_ITEMS draft with a valid source_avatar_id',
      'DRAFT_LOOK_BINDING_INVALID',
    );
  }
  return { mode, sourceAvatarId, sourceLookId };
}

function sameDraftIntent(left, right) {
  return left.mode === right.mode
    && left.sourceAvatarId === right.sourceAvatarId
    && left.sourceLookId === right.sourceLookId;
}

function fileBinding(item) {
  return item ? {
    id: item.id,
    sha256: item.sha256,
    size: item.size,
    mimetype: item.mimetype,
  } : null;
}

function fileManifest(manifest) {
  return {
    version: 1,
    person: fileBinding(manifest.person),
    identity: fileBinding(manifest.identity),
    garments: manifest.garments.map(fileBinding),
  };
}

function requestedFileManifest(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.garments)) {
    const error = new Error('file_manifest version 1 is required');
    error.statusCode = 400;
    throw error;
  }
  const normalize = (item, label) => {
    if (item === null) return null;
    if (!item
      || !validId(item.id)
      || !validDigest(item.sha256)
      || !Number.isSafeInteger(item.size)
      || item.size < 1
      || !MIME_EXTENSION.has(item.mimetype)) {
      const error = new Error(`${label} in file_manifest is invalid`);
      error.statusCode = 400;
      throw error;
    }
    return {
      id: item.id,
      sha256: item.sha256.toLowerCase(),
      size: item.size,
      mimetype: item.mimetype,
    };
  };
  if (value.person === undefined || value.identity === undefined || value.garments.length > 5) {
    const error = new Error('file_manifest must contain person, identity, and up to five garments');
    error.statusCode = 400;
    throw error;
  }
  return {
    version: 1,
    person: normalize(value.person, 'person'),
    identity: normalize(value.identity, 'identity'),
    garments: value.garments.map((item, index) => normalize(item, `garments[${index}]`)),
  };
}

function defaultManifest() {
  return {
    version: 4,
    draft_mode: DRAFT_MODE_NEW_AVATAR,
    outfit_text: '',
    generate_scene: false,
    source_avatar_id: null,
    source_look_id: null,
    person: null,
    identity: null,
    garments: [],
    updated_at: new Date().toISOString(),
  };
}

export class DraftService {
  #sessionMutations = new Map();

  constructor({ rootDirectory }) { this.rootDirectory = path.resolve(rootDirectory); }
  async initialize() { await mkdir(this.rootDirectory, { recursive: true }); }
  directory(sessionId) { return path.join(this.rootDirectory, sessionId); }
  manifestPath(sessionId) { return path.join(this.directory(sessionId), 'draft.json'); }

  async read(sessionId) {
    try {
      const manifest = JSON.parse(await readFile(this.manifestPath(sessionId), 'utf8'));
      if (Date.now() - Date.parse(manifest.updated_at) > DRAFT_TTL_MS) {
        // read() is also called from inside the session mutation queue. Remove
        // expired bytes directly here so expiry cannot enqueue behind and
        // deadlock the mutation that discovered it.
        await rm(this.directory(sessionId), { recursive: true, force: true });
        return defaultManifest();
      }
      const descriptors = [manifest.person, manifest.identity, ...(manifest.garments ?? [])].filter(Boolean);
      for (const item of descriptors) {
        if (validDigest(item.sha256)) {
          item.sha256 = item.sha256.toLowerCase();
          continue;
        }
        try {
          item.sha256 = digest(await readFile(path.join(this.directory(sessionId), item.filename)));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          item.sha256 = null;
        }
      }
      manifest.garments ??= [];
      if (manifest.draft_mode === undefined || manifest.draft_mode === null) {
        manifest.draft_mode = manifest.source_avatar_id
          ? DRAFT_MODE_ADD_ITEMS
          : DRAFT_MODE_NEW_AVATAR;
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

  async #withSessionMutation(sessionId, callback) {
    const previous = this.#sessionMutations.get(sessionId) ?? Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(callback);
    this.#sessionMutations.set(sessionId, operation);
    try {
      return await operation;
    } finally {
      if (this.#sessionMutations.get(sessionId) === operation) {
        this.#sessionMutations.delete(sessionId);
      }
    }
  }

  async #updateMetadata(sessionId, metadata) {
    const manifest = await this.read(sessionId);
    const current = storedDraftIntent(manifest);
    const hasRequestedMode = Object.hasOwn(metadata, 'draft_mode');
    const hasRequestedAvatar = Object.hasOwn(metadata, 'source_avatar_id');
    const hasRequestedLook = Object.hasOwn(metadata, 'source_look_id');
    const requestedMode = hasRequestedMode ? metadata.draft_mode : null;
    const requestedAvatarId = hasRequestedAvatar ? metadata.source_avatar_id ?? null : null;

    if (hasRequestedMode && !DRAFT_MODES.has(requestedMode)) {
      throw invalidDraftMode(requestedMode);
    }
    if (hasRequestedAvatar && requestedAvatarId !== null && !validId(requestedAvatarId)) {
      const error = new Error('source_avatar_id must be a UUID or null');
      error.statusCode = 400;
      error.code = 'INVALID_SOURCE_AVATAR';
      throw error;
    }

    let nextMode = current.mode;
    let nextSourceAvatarId = current.sourceAvatarId;
    if (current.mode === DRAFT_MODE_ADD_ITEMS) {
      if (hasRequestedMode && requestedMode !== DRAFT_MODE_ADD_ITEMS) {
        throw draftConflict(
          'ADD_ITEMS draft cannot be changed to NEW_AVATAR; delete the draft to start over',
          'DRAFT_MODE_IMMUTABLE',
        );
      }
      if (hasRequestedAvatar && requestedAvatarId !== current.sourceAvatarId) {
        throw draftConflict(
          'source_avatar_id is immutable for an ADD_ITEMS draft',
          'DRAFT_SOURCE_IMMUTABLE',
        );
      }
    } else {
      nextMode = hasRequestedMode
        ? requestedMode
        : hasRequestedAvatar && requestedAvatarId !== null
          ? DRAFT_MODE_ADD_ITEMS
          : DRAFT_MODE_NEW_AVATAR;
      if (nextMode === DRAFT_MODE_ADD_ITEMS) {
        if (!hasRequestedAvatar || requestedAvatarId === null) {
          throw draftConflict(
            'ADD_ITEMS draft requires source_avatar_id',
            'ADD_ITEMS_SOURCE_REQUIRED',
          );
        }
        nextSourceAvatarId = requestedAvatarId;
      } else if (hasRequestedAvatar && requestedAvatarId !== null) {
        throw draftConflict(
          'NEW_AVATAR draft cannot contain source_avatar_id',
          'DRAFT_MODE_SOURCE_MISMATCH',
        );
      }
    }

    const nextSourceLookId = hasRequestedLook
      ? metadata.source_look_id ?? null
      : current.sourceLookId;
    if (nextSourceLookId !== null && !validId(nextSourceLookId)) {
      const error = new Error('source_look_id must be a UUID or null');
      error.statusCode = 400;
      error.code = 'INVALID_SOURCE_LOOK';
      throw error;
    }
    if (nextSourceLookId !== null && nextMode !== DRAFT_MODE_ADD_ITEMS) {
      throw draftConflict(
        'source_look_id requires an ADD_ITEMS draft',
        'DRAFT_LOOK_BINDING_INVALID',
      );
    }

    manifest.version = 4;
    manifest.draft_mode = nextMode;
    manifest.source_avatar_id = nextSourceAvatarId;
    manifest.source_look_id = nextSourceLookId;
    manifest.outfit_text = String(metadata.outfit_text ?? '').slice(0, 4_000);
    // The old blocking optional_scene path is read-only for historical runs.
    // New drafts always keep core look generation independent from scenes.
    manifest.generate_scene = false;
    return this.#write(sessionId, manifest);
  }

  async updateMetadata(sessionId, metadata = {}) {
    return this.#withSessionMutation(
      sessionId,
      () => this.#updateMetadata(sessionId, metadata),
    );
  }

  async saveFile(sessionId, slot, upload) {
    return this.#withSessionMutation(sessionId, async () => {
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
      const descriptor = {
        id,
        filename,
        mimetype: upload.mimetype,
        size: upload.buffer.length,
        sha256: digest(upload.buffer),
      };
      let previous = null;
      if (slot === 'garment') {
        if (manifest.garments.length >= 5) {
          await rm(path.join(directory, filename), { force: true });
          throw new Error('У чернетці вже є п’ять фото речей');
        }
        manifest.garments.push(descriptor);
      } else {
        previous = manifest[slot];
        manifest[slot] = descriptor;
      }
      try {
        await this.#write(sessionId, manifest);
      } catch (error) {
        await rm(path.join(directory, filename), { force: true });
        throw error;
      }
      if (previous?.filename) await rm(path.join(directory, previous.filename), { force: true });
      return descriptor;
    });
  }

  async removeFile(sessionId, slot, id) {
    return this.#withSessionMutation(sessionId, async () => {
      const manifest = await this.read(sessionId);
      let removed = null;
      if (slot === 'person' || slot === 'identity') {
        if (manifest[slot]?.id === id) {
          removed = manifest[slot];
          manifest[slot] = null;
        }
      } else if (slot === 'garment') {
        const index = manifest.garments.findIndex((item) => item.id === id);
        if (index >= 0) [removed] = manifest.garments.splice(index, 1);
      }
      await this.#write(sessionId, manifest);
      if (removed?.filename) {
        await rm(path.join(this.directory(sessionId), removed.filename), { force: true });
      }
      return Boolean(removed);
    });
  }

  async file(sessionId, slot, id) {
    const manifest = await this.read(sessionId);
    const descriptor = slot === 'person' || slot === 'identity'
      ? (manifest[slot]?.id === id ? manifest[slot] : null)
      : manifest.garments.find((item) => item.id === id);
    if (!descriptor) return null;
    const filename = path.join(this.directory(sessionId), descriptor.filename);
    await stat(filename);
    const buffer = await readFile(filename);
    if (!validDigest(descriptor.sha256) || digest(buffer) !== descriptor.sha256) {
      throw draftConflict('Файл чернетки пошкоджено; запуск зупинено', 'DRAFT_FILE_DIGEST_MISMATCH');
    }
    return { descriptor, buffer };
  }

  async clear(sessionId) {
    return this.#withSessionMutation(
      sessionId,
      () => rm(this.directory(sessionId), { recursive: true, force: true }),
    );
  }
}

function publicManifest(manifest) {
  const descriptor = (slot, item) => item ? {
    id: item.id,
    sha256: item.sha256,
    size: item.size,
    mimetype: item.mimetype,
    url: `/api/draft/file/${slot}/${item.id}`,
  } : null;
  return {
    version: manifest.version ?? 4,
    draft_mode: storedDraftIntent(manifest).mode,
    outfit_text: manifest.outfit_text,
    generate_scene: manifest.generate_scene,
    source_avatar_id: manifest.source_avatar_id ?? null,
    source_look_id: manifest.source_look_id ?? null,
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
    const value = `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secureCookie ? '; Secure' : ''}`;
    const current = reply.getHeader('set-cookie');
    if (!current) reply.header('Set-Cookie', value);
    else if (Array.isArray(current)) reply.header('Set-Cookie', [...current, value]);
    else reply.header('Set-Cookie', [current, value]);
    return id;
  }

  app.get('/api/draft', async (request, reply) => {
    const sessionId = session(request, reply);
    const current = await service.read(sessionId);
    return publicManifest(await service.updateMetadata(sessionId, current));
  });
  app.put('/api/draft/meta', async (request, reply) => {
    if (request.body?.generate_scene === true) {
      return reply.code(422).send({
        error: 'Legacy scene generation is disabled. Save the completed look, then create a scene from that look.',
        code: 'LEGACY_SCENE_DISABLED',
        next_action: 'CREATE_SCENE_FROM_SAVED_LOOK',
      });
    }
    const metadata = request.body ?? {};
    if (Object.hasOwn(metadata, 'draft_mode') && !DRAFT_MODES.has(metadata.draft_mode)) {
      return reply.code(400).send({
        error: `draft_mode must be ${DRAFT_MODE_NEW_AVATAR} or ${DRAFT_MODE_ADD_ITEMS}`,
        code: 'INVALID_DRAFT_MODE',
      });
    }
    const sourceAvatarId = metadata.source_avatar_id ?? null;
    const sourceLookId = metadata.source_look_id ?? null;
    if (sourceAvatarId !== null && !validId(sourceAvatarId)) {
      return reply.code(400).send({ error: 'source_avatar_id must be a UUID or null' });
    }
    if (sourceLookId !== null && !validId(sourceLookId)) {
      return reply.code(400).send({ error: 'source_look_id must be a UUID or null' });
    }
    if (sourceLookId !== null && sourceAvatarId === null) {
      return reply.code(400).send({ error: 'source_look_id requires source_avatar_id' });
    }
    if (sourceAvatarId !== null) {
      if (!profileService || !profileApi) {
        return reply.code(400).send({ error: 'Saved avatar profiles are not enabled' });
      }
      const profileSession = await profileApi.resolveRequestProfile(request, reply);
      profileService.assertAddItemsSource(profileSession.profileId, {
        sourceAvatarId,
        sourceLookId,
      });
    }
    try {
      return publicManifest(await service.updateMetadata(session(request, reply), metadata));
    } catch (error) {
      if (error.statusCode && error.statusCode < 500) {
        return reply.code(error.statusCode).send({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      throw error;
    }
  });
  app.post('/api/draft/file/:slot', async (request, reply) => {
    const part = await request.file({ limits: { files: 1, fileSize: MAX_FILE_BYTES } });
    if (!part) return reply.code(400).send({ error: 'Draft file is required' });
    const descriptor = await service.saveFile(session(request, reply), request.params.slot, {
      mimetype: part.mimetype,
      buffer: await part.toBuffer(),
    });
    return reply.code(201).send({
      id: descriptor.id,
      sha256: descriptor.sha256,
      size: descriptor.size,
      mimetype: descriptor.mimetype,
    });
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
    const expectedFiles = requestedFileManifest(request.body?.file_manifest);
    const finalizationKey = request.body?.finalization_key;
    if (finalizationKey !== undefined && !validId(finalizationKey)) {
      return reply.code(400).send({ error: 'finalization_key must be a valid UUID v4' });
    }
    const resolvedRunId = finalizationKey ?? (profileService && profileApi ? randomUUID() : null);
    const hasRequestedMode = Object.hasOwn(request.body ?? {}, 'draft_mode');
    const hasRequestedSourceAvatar = Object.hasOwn(request.body ?? {}, 'source_avatar_id');
    const hasRequestedSourceLook = Object.hasOwn(request.body ?? {}, 'source_look_id');
    const requestedMode = hasRequestedMode ? request.body.draft_mode : null;
    const requestedSourceAvatarId = hasRequestedSourceAvatar ? request.body.source_avatar_id ?? null : null;
    const requestedSourceLookId = hasRequestedSourceLook ? request.body.source_look_id ?? null : null;
    if (hasRequestedMode && !DRAFT_MODES.has(requestedMode)) {
      return reply.code(400).send({
        error: `draft_mode must be ${DRAFT_MODE_NEW_AVATAR} or ${DRAFT_MODE_ADD_ITEMS}`,
        code: 'INVALID_DRAFT_MODE',
      });
    }
    if (requestedSourceAvatarId !== null && !validId(requestedSourceAvatarId)) {
      return reply.code(400).send({ error: 'source_avatar_id must be a UUID or null' });
    }
    if (requestedSourceLookId !== null && !validId(requestedSourceLookId)) {
      return reply.code(400).send({ error: 'source_look_id must be a UUID or null' });
    }
    const sessionId = session(request, reply);
    const manifest = await service.read(sessionId);
    if (!isDeepStrictEqual(expectedFiles, fileManifest(manifest))) {
      return reply.code(409).send({
        error: 'Файли чернетки змінилися; перевір їх і повтори запуск',
        code: 'DRAFT_FILE_MANIFEST_MISMATCH',
      });
    }
    const intent = storedDraftIntent(manifest);
    if (hasRequestedMode && requestedMode !== intent.mode) {
      return reply.code(409).send({
        error: 'draft_mode does not match the persisted draft intent',
        code: 'DRAFT_MODE_IMMUTABLE',
      });
    }
    if (intent.mode === DRAFT_MODE_ADD_ITEMS) {
      if (hasRequestedSourceAvatar && requestedSourceAvatarId !== intent.sourceAvatarId) {
        return reply.code(409).send({
          error: 'source_avatar_id does not match the immutable ADD_ITEMS draft binding',
          code: 'DRAFT_SOURCE_IMMUTABLE',
        });
      }
      if (hasRequestedSourceLook && requestedSourceLookId !== intent.sourceLookId) {
        return reply.code(409).send({
          error: 'source_look_id does not match the saved draft binding',
          code: 'DRAFT_LOOK_BINDING_MISMATCH',
        });
      }
    } else if ((hasRequestedSourceAvatar && requestedSourceAvatarId !== null)
      || (hasRequestedSourceLook && requestedSourceLookId !== null)) {
      return reply.code(409).send({
        error: 'Saved-avatar lineage must be bound through draft metadata before finalization',
        code: 'DRAFT_INTENT_NOT_BOUND',
      });
    }
    const sourceAvatarId = intent.sourceAvatarId;
    const sourceLookId = intent.sourceLookId;
    if (intent.mode === DRAFT_MODE_ADD_ITEMS && (!profileService || !profileApi)) {
      return reply.code(400).send({ error: 'Saved avatar profiles are not enabled' });
    }
    if (manifest.generate_scene === true) {
      return reply.code(422).send({
        error: 'Legacy scene generation is disabled. Save the completed look, then create a scene from that look.',
        code: 'LEGACY_SCENE_DISABLED',
        next_action: 'CREATE_SCENE_FROM_SAVED_LOOK',
      });
    }
    const asUpload = async (slot, descriptor, field, displaySlot) => {
      const value = await service.file(sessionId, slot, descriptor.id);
      if (!value) throw draftConflict(`Файл ${displaySlot} змінився або відсутній у чернетці`);
      if (value.descriptor.sha256 !== descriptor.sha256 || digest(value.buffer) !== descriptor.sha256) {
        throw draftConflict(`Файл ${displaySlot} не відповідає підтвердженому SHA-256`, 'DRAFT_FILE_DIGEST_MISMATCH');
      }
      return prepareDraftUploadForRun(
        { filename: descriptor.filename, mimetype: descriptor.mimetype, buffer: value.buffer },
        { field },
      );
    };
    let approvedAvatarReference = null;
    let profileSession = null;
    let approvedAvatarUpload = null;
    if (profileService && profileApi) {
      profileSession = await profileApi.resolveRequestProfile(request, reply);
      if (sourceAvatarId !== null) {
        const asset = profileService.avatarAsset(profileSession.profileId, sourceAvatarId);
        if (!asset) return reply.code(404).send({ error: 'Saved avatar not found' });
        approvedAvatarReference = await runService.approvedAvatarReferenceForRun(asset.runId);
        const approvedAvatarPath = await runService.outputFile(asset.runId, 'avatar.png');
        if (!approvedAvatarPath) {
          return reply.code(409).send({ error: 'Saved avatar source is unavailable' });
        }
        approvedAvatarUpload = {
          filename: `approved-avatar-${sourceAvatarId}.png`,
          mimetype: 'image/png',
          buffer: await readFile(approvedAvatarPath),
          preparation: {
            policy: 'APPROVED_AVATAR_REUSE_V1',
            method: 'VERIFIED_SERVER_OUTPUT',
            semantic_generation: false,
          },
        };
      }
    }
    if (!approvedAvatarUpload && !manifest.person) {
      return reply.code(400).send({ error: 'Фото людини відсутнє в чернетці' });
    }
    const person = approvedAvatarUpload
      ?? await asUpload('person', manifest.person, 'Фото людини', 'людини');
    const identityDetail = approvedAvatarUpload
      ? null
      : manifest.identity
        ? await asUpload('identity', manifest.identity, 'Додаткове фото людини', 'додаткового фото людини')
        : null;
    const garments = await Promise.all(manifest.garments.map((item, index) => (
      asUpload('garment', item, `Фото речі ${index + 1}`, `речі ${index + 1}`)
    )));
    const latestManifest = await service.read(sessionId);
    if (!isDeepStrictEqual(expectedFiles, fileManifest(latestManifest))) {
      return reply.code(409).send({
        error: 'Файли чернетки змінилися під час запуску; перевір їх і повтори',
        code: 'DRAFT_FILE_MANIFEST_MISMATCH',
      });
    }
    if (!sameDraftIntent(intent, storedDraftIntent(latestManifest))) {
      return reply.code(409).send({
        error: 'Draft intent changed during finalization; review it and retry',
        code: 'DRAFT_INTENT_CHANGED',
      });
    }
    if (profileService && profileSession) {
      profileService.claimRun(profileSession.profileId, resolvedRunId, {
        sourceAvatarId,
        sourceLookId,
      });
    }
    const run = await runService.createRun({
      person,
      identityDetail,
      garments,
      outfitText: manifest.outfit_text,
      generateScene: false,
      approvedAvatarReference,
      ...(resolvedRunId === null ? {} : { runId: resolvedRunId }),
    });
    return reply.code(202).send(run);
  });
}
