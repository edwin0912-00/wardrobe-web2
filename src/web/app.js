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
import { sanitizeOutboundString } from '../security/outbound-redaction.js';

export async function createWebApp({ service, health = { status: 'ok' }, publicDirectory = path.resolve(import.meta.dirname, '..', '..', 'web', 'public'), logger = false, auth = null, monitor = null, drafts = null, profiles = null }) {
  const app = Fastify({ logger, bodyLimit: 150 * 1024 * 1024 });
  installDemoAuth(app, auth);
  await app.register(multipart, { limits: { files: 7, fileSize: 20 * 1024 * 1024, fields: 12, parts: 20 } });
  await app.register(fastifyStatic, { root: publicDirectory, prefix: '/' });
  const secureCookie = process.env.ZEELY_COOKIE_SECURE !== 'false';
  const profileApi = profiles ? await registerProfileRoutes(app, { service: profiles, runService: service, secureCookie }) : null;
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
      statusProvider: async () => ({ status: 'ok', service: 'web', generation: 'available', preflight: health.status }),
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

  app.get('/api/health', async () => ({ status: health.status, service: 'web', generation: 'available', semantic_qa: 'available' }));

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
    const run = await service.createRun({
      person: uploads.person,
      identityDetail: uploads.identityDetail,
      garments: uploads.garments,
      outfitText: String(fields.outfit_text ?? ''),
      generateScene: fields.generate_scene === 'true',
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
    let snapshot;
    try {
      snapshot = await service.getRun(request.params.id);
    } catch (error) {
      unsubscribe();
      throw error;
    }
    if (!snapshot) {
      unsubscribe();
      return reply.code(404).send({ error: 'Run not found' });
    }
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    send(snapshot);
    live = true;
    const bufferedTail = buffered.at(-1);
    if (bufferedTail && bufferedTail.updated_at >= snapshot.updated_at && JSON.stringify(bufferedTail) !== JSON.stringify(snapshot)) send(bufferedTail);
    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
    request.raw.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });

  app.post('/api/runs/:id/retry', async (request, reply) => {
    if (!await ownsRun(request, reply)) return reply;
    const run = await service.retry(request.params.id);
    return run ? reply.code(202).send(run) : reply.code(404).send({ error: 'Run not found' });
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

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 400;
    const publicMessage = sanitizeOutboundString(error.message);
    if (monitor) monitor.append({
      source: 'server', type: 'server.error', severity: 'error', run_id: request.params?.id,
      data: { method: request.method, stage: request.url.split('?')[0], status: statusCode, message: publicMessage },
    }).catch(() => {});
    reply.code(statusCode).send({ error: publicMessage });
  });

  return app;
}
