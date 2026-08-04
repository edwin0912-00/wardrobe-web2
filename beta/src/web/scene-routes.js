import { createReadStream } from 'node:fs';
import { ProfileError } from './profile-service.js';
import { sendPresentationImage } from './presentation-preview.js';

const TERMINAL_SCENE_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function sameOriginMutation(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site profile mutation is not allowed');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ProfileError(403, 'INVALID_ORIGIN', 'Invalid profile mutation origin');
  }
  const requestHost = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '')
    .split(',')[0]
    .trim();
  if (!requestHost || originHost !== requestHost) {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site profile mutation is not allowed');
  }
}

function idempotencyKey(request) {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw new ProfileError(
      422,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must contain between 8 and 256 characters',
    );
  }
  return value;
}

function requiredPreset(body) {
  const presetId = body?.preset_id;
  const presetVersion = body?.preset_version;
  if (typeof presetId !== 'string' || typeof presetVersion !== 'string') {
    throw new ProfileError(
      422,
      'INVALID_SCENE_PRESET',
      'preset_id and preset_version are required',
    );
  }
  return { presetId, presetVersion };
}

function profileSceneView(scene) {
  if (!scene) return null;
  const output = scene.output
    ? {
        ...scene.output,
        image_url: `/api/profile/scenes/${encodeURIComponent(scene.scene_id)}/image`,
        download_url: `/api/profile/scenes/${encodeURIComponent(scene.scene_id)}/download`,
      }
    : null;
  return { ...scene, output };
}

function etagMatches(value, etag) {
  if (typeof value !== 'string') return false;
  return value.split(',').some((candidate) => {
    const normalized = candidate.trim();
    return normalized === '*' || normalized === etag || normalized === `W/${etag}`;
  });
}

async function currentOwnedScene({
  profiles,
  profileId,
  sceneService,
  sceneId,
}) {
  const projection = profiles.sceneProjection(profileId, sceneId);
  if (!projection) return null;
  const scene = await sceneService.getScene(sceneId);
  if (!scene || scene.approved_look?.look_id !== projection.look_id) return null;
  profiles.syncSceneProjection(scene);
  return scene;
}

/**
 * Registers the profile-owned HTTP layer around SceneService. SceneService
 * remains the durable execution ledger; ProfileService is the authorization
 * and library projection.
 */
export async function registerSceneRoutes(app, {
  sceneService,
  profiles,
  profileApi,
  runService,
  presetResolver,
  editorialShootService = null,
} = {}) {
  if (!sceneService || !profiles || !profileApi || !runService || !presetResolver) {
    throw new Error('registerSceneRoutes requires sceneService, profiles, profileApi, runService and presetResolver');
  }
  // A user opening Fashion Shoot must only read already-verified presentation
  // data. Fail the server startup if the immutable catalog or previews do not
  // pass integrity checks; never move that audit into a browser request.
  await presetResolver.prepareEditorialPresentation?.();

  // Bring pre-existing SQLite projections up to date after a service restart.
  // A projection without a durable execution is removed from the visible
  // profile graph and queued for idempotent physical cleanup.
  for (const projection of profiles.sceneProjectionRecords()) {
    const scene = await sceneService.getScene(projection.scene_id);
    if (scene?.approved_look?.look_id === projection.look_id) {
      profiles.syncSceneProjection(scene);
    } else {
      profiles.deleteScene(projection.profile_id, projection.scene_id);
    }
  }
  await profiles.flushDeletionQueue({ runService, sceneService, editorialShootService });

  app.get('/api/scene-presets', async (_request, reply) => {
    const presets = await presetResolver.listPresets();
    return reply
      .header('Cache-Control', 'private, no-store')
      .send({ presets });
  });

  app.get('/api/scene-presets/:presetId/:presetVersion/preview', async (request, reply) => {
    const preview = await presetResolver.environmentPlatePreview({
      presetId: request.params.presetId,
      presetVersion: request.params.presetVersion,
    });
    const etag = `"${preview.sha256}"`;
    reply
      .type(preview.media_type)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', etag)
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('X-Content-Type-Options', 'nosniff');
    if (etagMatches(request.headers['if-none-match'], etag)) {
      return reply.code(304).send();
    }
    return reply.send(preview.data);
  });

  app.get('/api/editorial-modes', async (_request, reply) => {
    const catalog = await presetResolver.listEditorialModes();
    return reply
      .header('Cache-Control', 'private, no-store')
      .send(catalog);
  });

  app.get('/api/editorial-modes/:modeId/:version/preview', async (request, reply) => {
    const preview = await presetResolver.editorialModePreview({
      modeId: request.params.modeId,
      version: request.params.version,
    });
    const etag = `"${preview.sha256}"`;
    reply
      .type(preview.media_type)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', etag)
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('X-Content-Type-Options', 'nosniff');
    if (etagMatches(request.headers['if-none-match'], etag)) {
      return reply.code(304).send();
    }
    return reply.send(preview.data);
  });

  app.get('/api/profile/looks/:lookId/scenes', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const scenes = profiles.listScenes(session.profileId, request.params.lookId);
    if (scenes === null) return reply.code(404).send({ error: 'Look not found' });
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .send({ scenes });
  });

  app.post('/api/profile/looks/:lookId/scenes', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const approvedLookReference = await profiles.approvedLookReference(
      session.profileId,
      request.params.lookId,
      runService,
    );
    const presetInput = requiredPreset(request.body);
    const presetReference = await presetResolver.presetReference(presetInput);
    if (request.body?.expected_reference_pack_sha256 !== undefined
      && request.body.expected_reference_pack_sha256 !== presetReference.reference_pack_sha256) {
      throw new ProfileError(
        409,
        'SCENE_PRESET_STALE',
        'The selected scene preset reference pack has changed',
      );
    }
    const scene = await sceneService.createScene({
      idempotencyKey: idempotencyKey(request),
      approvedLookReference,
      presetReference,
    });
    profiles.projectScene(session.profileId, request.params.lookId, scene);
    // Close the publication race where a very fast provider advances between
    // createScene() returning and the SQLite authorization row being inserted.
    const latest = await sceneService.getScene(scene.scene_id);
    if (latest) profiles.syncSceneProjection(latest);
    return reply
      .code(202)
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .send(profileSceneView(latest ?? scene));
  });

  app.get('/api/profile/scenes/:sceneId', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const scene = await currentOwnedScene({
      profiles,
      profileId: session.profileId,
      sceneService,
      sceneId: request.params.sceneId,
    });
    if (!scene) return reply.code(404).send({ error: 'Scene not found' });
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .send(profileSceneView(scene));
  });

  app.get('/api/profile/scenes/:sceneId/events', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const projection = profiles.sceneProjection(session.profileId, request.params.sceneId);
    if (!projection) return reply.code(404).send({ error: 'Scene not found' });

    const buffered = [];
    let live = false;
    let closed = false;
    let heartbeat = null;
    let unsubscribe = () => {};
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    };
    const send = (value) => {
      if (closed) return;
      reply.raw.write(`event: scene\ndata: ${JSON.stringify(profileSceneView(value))}\n\n`);
      if (TERMINAL_SCENE_STATES.has(value.status)) {
        cleanup();
        reply.raw.end();
      }
    };
    const listener = (value) => {
      if (value?.approved_look?.look_id !== projection.look_id) return;
      profiles.syncSceneProjection(value);
      if (live) send(value);
      else buffered.push(value);
    };
    unsubscribe = sceneService.subscribe(request.params.sceneId, listener);

    let snapshot;
    try {
      snapshot = await sceneService.getScene(request.params.sceneId);
    } catch (error) {
      unsubscribe();
      throw error;
    }
    if (!snapshot || snapshot.approved_look?.look_id !== projection.look_id) {
      unsubscribe();
      return reply.code(404).send({ error: 'Scene not found' });
    }
    profiles.syncSceneProjection(snapshot);

    const setCookie = reply.getHeader('set-cookie');
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      Vary: 'Cookie',
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
    });
    send(snapshot);
    if (closed) return reply;
    live = true;
    const bufferedTail = buffered.at(-1);
    if (bufferedTail
      && bufferedTail.updated_at >= snapshot.updated_at
      && JSON.stringify(bufferedTail) !== JSON.stringify(snapshot)) {
      send(bufferedTail);
    }
    if (!closed) {
      heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
      request.raw.on('close', cleanup);
    }
    return reply;
  });

  app.post('/api/profile/scenes/:sceneId/retry', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const projection = profiles.sceneProjection(session.profileId, request.params.sceneId);
    if (!projection) return reply.code(404).send({ error: 'Scene not found' });
    const scene = await sceneService.retryScene(request.params.sceneId, {
      idempotencyKey: idempotencyKey(request),
    });
    if (scene.approved_look?.look_id !== projection.look_id) {
      return reply.code(404).send({ error: 'Scene not found' });
    }
    profiles.syncSceneProjection(scene);
    return reply.code(202).send(profileSceneView(scene));
  });

  app.post('/api/profile/scenes/:sceneId/cancel', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const projection = profiles.sceneProjection(session.profileId, request.params.sceneId);
    if (!projection) return reply.code(404).send({ error: 'Scene not found' });
    const scene = await sceneService.cancelScene(request.params.sceneId, 'Cancelled by profile owner');
    if (scene.approved_look?.look_id !== projection.look_id) {
      return reply.code(404).send({ error: 'Scene not found' });
    }
    profiles.syncSceneProjection(scene);
    return reply.code(202).send(profileSceneView(scene));
  });

  app.delete('/api/profile/scenes/:sceneId', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const projection = profiles.sceneProjection(session.profileId, request.params.sceneId);
    if (!projection) return reply.code(404).send({ error: 'Scene not found' });
    const scene = await sceneService.getScene(request.params.sceneId);
    if (scene && !TERMINAL_SCENE_STATES.has(scene.status)) {
      try {
        await sceneService.cancelScene(request.params.sceneId, 'Deleted by profile owner');
      } catch (error) {
        if (error?.code !== 'SCENE_NOT_CANCELLABLE') throw error;
      }
      const running = sceneService.running?.get(request.params.sceneId);
      if (running) await running;
    }
    profiles.deleteScene(session.profileId, request.params.sceneId);
    await profiles.flushDeletionQueue({ runService, sceneService, editorialShootService });
    return reply.code(204).send();
  });

  async function serveSceneImage(request, reply, disposition) {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const scene = await currentOwnedScene({
      profiles,
      profileId: session.profileId,
      sceneService,
      sceneId: request.params.sceneId,
    });
    if (!scene) return reply.code(404).send({ error: 'Scene not found' });
    const filename = await sceneService.outputFile(request.params.sceneId, 'scene.png');
    if (!filename) return reply.code(404).send({ error: 'Scene image not found' });
    return sendPresentationImage(request, reply, {
      filename,
      disposition,
      downloadName: 'scene.png',
      cacheControl: 'private, max-age=900',
    });
  }

  app.get('/api/profile/scenes/:sceneId/image', async (request, reply) => (
    serveSceneImage(request, reply, 'inline')
  ));
  app.get('/api/profile/scenes/:sceneId/download', async (request, reply) => (
    serveSceneImage(request, reply, 'attachment')
  ));
}
