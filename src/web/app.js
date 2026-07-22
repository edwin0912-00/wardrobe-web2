import { createReadStream } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { registerMonitorRoutes } from '../monitor/routes.js';
import { installDemoAuth } from './demo-auth.js';
import { registerDraftRoutes } from './draft-service.js';

export async function createWebApp({ service, health = { status: 'ok' }, publicDirectory = path.resolve(import.meta.dirname, '..', '..', 'web', 'public'), logger = false, auth = null, monitor = null, drafts = null }) {
  const app = Fastify({ logger, bodyLimit: 150 * 1024 * 1024 });
  installDemoAuth(app, auth);
  await app.register(multipart, { limits: { files: 7, fileSize: 20 * 1024 * 1024, fields: 12, parts: 20 } });
  await app.register(fastifyStatic, { root: publicDirectory, prefix: '/' });
  if (drafts) await registerDraftRoutes(app, { service: drafts, runService: service, secureCookie: process.env.ZEELY_COOKIE_SECURE !== 'false' });

  if (monitor) {
    await registerMonitorRoutes(app, {
      store: monitor,
      acceptClientTelemetry: true,
      statusProvider: async () => ({ status: 'ok', service: 'zeely-core-web', generation: health.generation, preflight: health.status }),
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

  app.get('/api/health', async () => ({ ...health, service: 'zeely-core-web', generation: 'Higgsfield CLI', semantic_qa: 'Codex CLI' }));

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
      generateScene: fields.generate_scene !== 'false',
    });
    return reply.code(202).send(run);
  });

  app.get('/api/runs/:id', async (request, reply) => {
    const run = await service.getRun(request.params.id);
    return run ? run : reply.code(404).send({ error: 'Run not found' });
  });

  app.get('/api/runs/:id/events', async (request, reply) => {
    const current = await service.getRun(request.params.id);
    if (!current) return reply.code(404).send({ error: 'Run not found' });
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (value) => reply.raw.write(`event: run\ndata: ${JSON.stringify(value)}\n\n`);
    send(current);
    const unsubscribe = service.subscribe(request.params.id, send);
    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
    request.raw.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });

  app.post('/api/runs/:id/retry', async (request, reply) => {
    const run = await service.retry(request.params.id);
    return run ? reply.code(202).send(run) : reply.code(404).send({ error: 'Run not found' });
  });

  app.delete('/api/runs/:id', async (request, reply) => {
    await service.deleteRun(request.params.id);
    return reply.code(204).send();
  });

  app.get('/api/runs/:id/files/:name', async (request, reply) => {
    const filename = await service.outputFile(request.params.id, request.params.name);
    if (!filename) return reply.code(404).send({ error: 'Output not found' });
    const type = request.params.name.endsWith('.json') ? 'application/json' : 'image/png';
    return reply.type(type).header('Content-Disposition', `inline; filename="${request.params.name}"`).send(createReadStream(filename));
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 400;
    if (monitor) monitor.append({
      source: 'server', type: 'server.error', severity: 'error', run_id: request.params?.id,
      data: { method: request.method, stage: request.url.split('?')[0], status: statusCode, message: error.message },
    }).catch(() => {});
    reply.code(statusCode).send({ error: error.message });
  });

  return app;
}
