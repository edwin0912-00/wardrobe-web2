import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { registerMonitorRoutes } from '../monitor/routes.js';
import { publicManifestView } from '../runner/public-manifest.js';
import { installDemoAuth } from './demo-auth.js';
import { registerDraftRoutes } from './draft-service.js';
import { registerProfileRoutes } from './profile-service.js';
import { EditorialSceneExecutor } from './editorial-scene-executor.js';
import { registerEditorialShootRoutes } from './editorial-shoot-routes.js';
import { EditorialShootService } from './editorial-shoot-service.js';
import { createProfileApprovedLookResolver } from './scene-resolvers.js';
import { registerSceneRoutes } from './scene-routes.js';
import { SceneService } from './scene-service.js';
import { sanitizeOutboundString } from '../security/outbound-redaction.js';
import { registerPostShootRoutes } from './post-shoot-routes.js';

export async function createWebApp({
  service,
  health = { status: 'ok' },
  healthProvider = null,
  publicDirectory = path.resolve(import.meta.dirname, '..', '..', 'web', 'public'),
  logger = false,
  auth = null,
  monitor = null,
  drafts = null,
  profiles = null,
  sceneDependencies = null,
  lucyTokenIssuer = null,
}) {
  // A degraded provider preflight means the local CLI cannot prove that it can
  // create and observe a paid Higgsfield job. Do not let a user enter the
  // pipeline only to fail later with an ambiguous provider-create message.
  const generationAvailable = health.status !== 'degraded';
  const currentHealth = async () => {
    const runtime = typeof healthProvider === 'function' ? await healthProvider() : null;
    return {
      ...health,
      ...(runtime ? {
        runtime_status: runtime.status,
        ...(runtime.status === 'ready' ? {} : { status: 'degraded' }),
      } : {}),
    };
  };
  const generationTrigger = (request) => {
    if (request.method !== 'POST') return false;
    const pathname = request.url.split('?')[0];
    return pathname === '/api/runs'
      || pathname === '/api/draft/run'
      || /^\/api\/runs\/[^/]+\/(?:retry|garment-selection)$/.test(pathname)
      || /^\/api\/profile\/looks\/[^/]+\/scenes$/.test(pathname)
      || /^\/api\/profile\/scenes\/[^/]+\/retry$/.test(pathname)
      || /^\/api\/profile\/editorial-shoots\/[^/]+\/(?:approve-bible|approve-hero)$/.test(pathname)
      || /^\/api\/profile\/editorial-shoots\/[^/]+\/shots\/[^/]+\/retry$/.test(pathname);
  };
  const app = Fastify({
    logger,
    bodyLimit: 150 * 1024 * 1024,
    logController: new Fastify.LogController({
      disableRequestLogging: (request) => request.url.split('?')[0] === '/api/health',
    }),
  });
  const activeSseCleanups = new Set();
  app.addHook('onClose', async () => {
    for (const cleanup of [...activeSseCleanups]) cleanup();
  });
  installDemoAuth(app, auth);
  app.addHook('onRequest', async (request, reply) => {
    if (generationAvailable || !generationTrigger(request)) return;
    return reply
      .header('Retry-After', '60')
      .code(503)
      .send({
        error: 'Генерація тимчасово недоступна: потрібна авторизація або перевірка Higgsfield.',
        code: 'GENERATION_UNAVAILABLE',
        next_action: 'RETRY_AFTER_PROVIDER_READY',
      });
  });
  await app.register(multipart, { limits: { files: 7, fileSize: 20 * 1024 * 1024, fields: 12, parts: 20 } });
  await app.register(fastifyStatic, { root: publicDirectory, prefix: '/' });
  await registerPostShootRoutes(app, {
    projectRoot: path.resolve(import.meta.dirname, '..', '..'),
    lucyTokenIssuer,
  });
  const secureCookie = process.env.ZEELY_COOKIE_SECURE !== 'false';
  let sceneService = null;
  let scenePresetResolver = null;
  let editorialShootService = null;
  if (sceneDependencies) {
    if (!profiles) throw new Error('SceneService requires ProfileService ownership');
    await profiles.initialize();
    const {
      approvedLookResolver: _untrustedApprovedLookResolver,
      observer: suppliedSceneObserver = null,
      presetResolver,
      editorialRootDirectory = null,
      ...sceneOptions
    } = sceneDependencies;
    if (!presetResolver) throw new Error('sceneDependencies.presetResolver is required');
    await presetResolver.initialize?.();
    scenePresetResolver = presetResolver;
    sceneService = new SceneService({
      ...sceneOptions,
      presetResolver,
      approvedLookResolver: createProfileApprovedLookResolver({
        profiles,
        runService: service,
      }),
      observer: async (scene) => {
        profiles.syncSceneProjection(scene);
        if (suppliedSceneObserver) await suppliedSceneObserver(scene);
      },
    });
    await sceneService.initialize();
    app.decorate('sceneService', sceneService);
    if (typeof presetResolver.compileEditorialShootBible === 'function'
      && typeof presetResolver.editorialShotPresetReference === 'function') {
      const editorialSceneExecutor = new EditorialSceneExecutor({
        sceneService,
        presetResolver,
      });
      editorialShootService = new EditorialShootService({
        rootDirectory: editorialRootDirectory
          ?? path.join(path.dirname(sceneOptions.rootDirectory), 'editorial-shoots'),
        sceneExecutor: editorialSceneExecutor,
        observer: async (shoot, event) => {
          profiles.syncEditorialShootProjection(shoot);
          if (monitor) {
            await monitor.append({
              source: 'runner',
              type: 'editorial.phase',
              severity: shoot.status === 'CANCELLED'
                ? 'warn'
                : shoot.status === 'NEEDS_RETRY'
                ? 'error'
                : 'info',
              data: {
                shoot_id: shoot.shoot_id,
                status: shoot.status,
                stage: shoot.phase,
                event_type: event?.event_type,
                message: sanitizeOutboundString(shoot.message),
              },
            });
          }
        },
      });
      await editorialShootService.initialize();
      app.decorate('editorialShootService', editorialShootService);
    }
  }
  const profileApi = profiles
    ? await registerProfileRoutes(app, {
        service: profiles,
        runService: service,
        sceneService,
        editorialShootService,
        secureCookie,
      })
    : null;
  if (sceneService) {
    await registerSceneRoutes(app, {
      sceneService,
      profiles,
      profileApi,
      runService: service,
      presetResolver: scenePresetResolver,
      editorialShootService,
    });
  }
  if (editorialShootService) {
    await registerEditorialShootRoutes(app, {
      editorialShootService,
      profiles,
      profileApi,
      runService: service,
      presetResolver: scenePresetResolver,
      sceneService,
    });
  }
  if (drafts) await registerDraftRoutes(app, {
    service: drafts,
    runService: service,
    profileService: profiles,
    profileApi,
    secureCookie,
  });

  async function ownsRun(request, reply) {
    if (!profiles || !profileApi) return true;
    const session = await profileApi.resolveRequestProfile(request, reply);
    if (profiles.getClaim(session.profileId, request.params.id)) {
      reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie');
      return true;
    }
    reply.code(404).send({ error: 'Run not found' });
    return false;
  }

  if (monitor) {
    await registerMonitorRoutes(app, {
      store: monitor,
      acceptClientTelemetry: true,
      statusProvider: async () => ({
        status: 'ok',
        service: 'web',
        generation: generationAvailable ? 'available' : 'unavailable',
        editorial_generation: editorialShootService
          ? (generationAvailable ? 'available' : 'unavailable')
          : 'disabled',
        preflight: health.status,
      }),
    });
    app.addHook('onResponse', async (request, reply) => {
      const pathname = request.url.split('?')[0];
      if (!pathname.startsWith('/api/') || pathname.startsWith('/api/monitor') || pathname === '/api/telemetry' || pathname === '/api/health') return;
      await monitor.append({
        source: 'http', type: 'http.response', severity: reply.statusCode >= 400 ? 'error' : 'info',
        run_id: request.params?.id,
        data: { method: request.method, stage: pathname, status: reply.statusCode },
      });
    });
  }

  app.get('/api/health', async () => {
    const resolved = await currentHealth();
    const status = resolved.status === 'ready' || resolved.status === 'ok' ? resolved.status : 'degraded';
    const runtimeStatus = resolved.runtime_status
      ? (resolved.runtime_status === 'ready' ? 'ready' : 'degraded')
      : null;
    return {
      status,
      service: 'web',
      generation: generationAvailable ? 'available' : 'unavailable',
      semantic_qa: 'available',
      ...(runtimeStatus ? { runtime_status: runtimeStatus } : {}),
      // Existing product mode exposes editorial availability. The isolated
      // worker canary intentionally exposes only the generic public contract.
      ...(health.test_only ? { editorial_generation: 'available' } : { editorial_generation: editorialShootService
        ? (generationAvailable ? 'available' : 'unavailable')
        : 'disabled' }),
    };
  });

  app.post('/api/runs', async (request, reply) => {
    const uploads = { garments: [] };
    const fields = {};
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const upload = { filename: part.filename, mimetype: part.mimetype, buffer: await part.toBuffer() };
        if (part.fieldname === 'person_photo') uploads.person = upload;
        else if (part.fieldname === 'identity_detail') uploads.identityDetail = upload;
        else if (part.fieldname === 'garment_images') uploads.garments.push(upload);
      } else fields[part.fieldname] = part.value;
    }
    if (monitor) await monitor.append({
      source: 'server', type: 'run.upload_received',
      data: {
        count: (uploads.person ? 1 : 0) + (uploads.identityDetail ? 1 : 0) + uploads.garments.length,
        bytes: [uploads.person, uploads.identityDetail, ...uploads.garments].filter(Boolean).reduce((total, upload) => total + upload.buffer.length, 0),
        stage: `person:${Boolean(uploads.person)} identity:${Boolean(uploads.identityDetail)} garments:${uploads.garments.length}`,
      },
    });
    if (fields.consent !== 'true') return reply.code(400).send({ error: 'Consent is required for processing personal images' });
    if (fields.generate_scene === 'true') {
      return reply.code(422).send({
        error: 'Legacy scene generation is disabled. Save the completed look, then create a scene from that look.',
        code: 'LEGACY_SCENE_DISABLED',
        next_action: 'CREATE_SCENE_FROM_SAVED_LOOK',
      });
    }
    const run = await service.createRun({
      person: uploads.person,
      identityDetail: uploads.identityDetail,
      garments: uploads.garments,
      outfitText: String(fields.outfit_text ?? ''),
      generateScene: false,
    });
    if (profileApi) await profileApi.claimRunForRequest(request, reply, run.run_id, { sourceAvatarId: null });
    return reply.code(202).send(run);
  });

  app.get('/api/runs/:id', async (request, reply) => {
    if (!await ownsRun(request, reply)) return reply;
    const run = await service.getRun(request.params.id);
    return run ? run : reply.code(404).send({ error: 'Run not found' });
  });

  app.get('/api/runs/:id/events', async (request, reply) => {
    if (!await ownsRun(request, reply)) return reply;
    const current = await service.getRun(request.params.id);
    if (!current) return reply.code(404).send({ error: 'Run not found' });
    const buffered = [];
    let live = false;
    const send = (value) => reply.raw.write(`event: run\ndata: ${JSON.stringify(value)}\n\n`);
    const listener = (value) => {
      if (live) send(value);
      else buffered.push(value);
    };
    const unsubscribe = service.subscribe(request.params.id, listener);
    let heartbeat = null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      activeSseCleanups.delete(cleanup);
    };
    activeSseCleanups.add(cleanup);
    request.raw.once('close', cleanup);
    let snapshot;
    try {
      snapshot = await service.getRun(request.params.id);
    } catch (error) {
      cleanup();
      throw error;
    }
    if (!snapshot) {
      cleanup();
      return reply.code(404).send({ error: 'Run not found' });
    }
    if (cleaned || request.raw.destroyed || reply.raw.destroyed || reply.raw.writableEnded) {
      cleanup();
      return reply;
    }
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    send(snapshot);
    live = true;
    const bufferedTail = buffered.at(-1);
    if (bufferedTail && bufferedTail.updated_at >= snapshot.updated_at && JSON.stringify(bufferedTail) !== JSON.stringify(snapshot)) send(bufferedTail);
    heartbeat = setInterval(() => {
      if (reply.raw.destroyed || reply.raw.writableEnded) cleanup();
      else reply.raw.write(': keep-alive\n\n');
    }, 15_000);
  });

  app.post('/api/runs/:id/retry', async (request, reply) => {
    if (!await ownsRun(request, reply)) return reply;
    try {
      const run = await service.retry(request.params.id);
      return run ? reply.code(202).send(run) : reply.code(404).send({ error: 'Run not found' });
    } catch (error) {
      if (error?.statusCode === 409) return reply.code(409).send({ error: error.message, code: error.code });
      throw error;
    }
  });

  app.post('/api/runs/:id/garment-selection', async (request, reply) => {
    if (!await ownsRun(request, reply)) return reply;
    const run = await service.selectGarments(request.params.id, request.body?.selections);
    return run ? reply.code(202).send(run) : reply.code(404).send({ error: 'Run not found' });
  });

  app.delete('/api/runs/:id', async (request, reply) => {
    if (!await ownsRun(request, reply)) return reply;
    await service.deleteRun(request.params.id);
    return reply.code(204).send();
  });

  app.get('/api/runs/:id/files/:name', async (request, reply) => {
    if (!await ownsRun(request, reply)) return reply;
    const filename = await service.outputFile(request.params.id, request.params.name);
    if (!filename) return reply.code(404).send({ error: 'Output not found' });
    if (request.params.name === 'run-manifest.json') {
      const internalManifest = JSON.parse(await readFile(filename, 'utf8'));
      return reply
        .type('application/json')
        .header('Cache-Control', 'private, no-store')
        .header('Content-Disposition', 'inline; filename="run-manifest.json"')
        .send(publicManifestView(internalManifest));
    }
    const type = request.params.name.endsWith('.json') ? 'application/json' : 'image/png';
    return reply.type(type).header('Content-Disposition', `inline; filename="${request.params.name}"`).send(createReadStream(filename));
  });

  app.get('/api/runs/:id/garments/:index', async (request, reply) => {
    if (!await ownsRun(request, reply)) return reply;
    const filename = await service.garmentSourceFile(request.params.id, request.params.index);
    if (!filename) return reply.code(404).send({ error: 'Фото речі не знайдено' });
    const type = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp']]).get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream';
    return reply.type(type).header('Cache-Control', 'private, max-age=900').send(createReadStream(filename));
  });

  app.get('/api/runs/:id/visual-assets/:assetId', async (request, reply) => {
    reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('X-Content-Type-Options', 'nosniff');
    if (!await ownsRun(request, reply)) return reply;
    const asset = typeof service.visualAsset === 'function'
      ? await service.visualAsset(request.params.id, request.params.assetId)
      : null;
    if (!asset) return reply.code(404).send({ error: 'Visual asset not found' });
    return reply
      .type(asset.media_type)
      .send(asset.bytes);
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 400;
    const publicMessage = sanitizeOutboundString(error.message);
    if (monitor) monitor.append({
      source: 'server', type: 'server.error', severity: 'error', run_id: request.params?.id,
      data: { method: request.method, stage: request.url.split('?')[0], status: statusCode, message: publicMessage },
    }).catch(() => {});
    const payload = {
      error: publicMessage,
      ...(error.code ? { code: sanitizeOutboundString(error.code) } : {}),
    };
    if (error.status === 'NEEDS_INPUT') {
      payload.status = 'NEEDS_INPUT';
      payload.code = sanitizeOutboundString(error.code ?? 'INPUT_REJECTED');
      payload.field = error.field ? sanitizeOutboundString(error.field) : null;
      payload.requirements = Array.isArray(error.requirements)
        ? error.requirements.map((value) => sanitizeOutboundString(value)).slice(0, 12)
        : [];
      payload.next_action = sanitizeOutboundString(error.nextAction ?? 'REPLACE_INPUT');
    }
    reply.code(statusCode).send(payload);
  });

  return app;
}
