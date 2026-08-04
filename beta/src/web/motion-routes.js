// HTTP surface for motion jobs.
//
// Every mutating route carries the same three guards as the scene routes: a same-origin
// check, an `Idempotency-Key` header, and no body field that could name a model. The
// route module never validates domain rules itself — it converts a request into a service
// call and lets the service's own error class decide the status code.

import { loadMotionModes, publicMotionModes } from './motion-modes.js';
import { MotionServiceError } from './motion-service.js';
import path from 'node:path';

function sameOriginMutation(request) {
  const site = request.headers['sec-fetch-site'];
  if (site === 'cross-site') {
    throw new MotionServiceError(403, 'CROSS_SITE_REQUEST', 'Cross-site mutations are refused');
  }
  const origin = request.headers.origin;
  if (origin) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new MotionServiceError(403, 'INVALID_ORIGIN', 'The Origin header is not a URL');
    }
    if (originHost !== request.headers.host) {
      throw new MotionServiceError(403, 'INVALID_ORIGIN', 'The Origin header does not match the host');
    }
  }
}

function idempotencyKey(request) {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.length === 0) {
    throw new MotionServiceError(422, 'MISSING_IDEMPOTENCY_KEY', 'An Idempotency-Key header is required');
  }
  if (value.length < 8 || value.length > 256) {
    throw new MotionServiceError(422, 'INVALID_IDEMPOTENCY_KEY', 'The Idempotency-Key header must be 8 to 256 characters');
  }
  return value;
}

const defaultRoot = path.resolve(import.meta.dirname, '..', '..');

export async function registerMotionRoutes(app, { motionService, projectRoot = defaultRoot } = {}) {
  if (!motionService) throw new Error('registerMotionRoutes requires motionService');

  // Loaded once at registration so a malformed catalogue fails the boot rather than the
  // first request. The same file the service validates, read again here on purpose: the
  // route surface must not depend on the service having been initialised first.
  const catalogue = await loadMotionModes({ projectRoot });

  app.get('/api/motion/modes', async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return publicMotionModes(catalogue);
  });

  app.post('/api/motion/jobs', async (request) => {
    sameOriginMutation(request);
    const key = idempotencyKey(request);
    const body = request.body ?? {};
    return motionService.createJob({
      idempotencyKey: key,
      modeId: body.mode_id,
      source: body.source,
      references: body.references,
      audio: body.audio,
      prompt: body.prompt ?? null,
      shotList: body.shot_list ?? null,
    });
  });

  // Generation is its own call and its own confirmation. A client that merely creates a
  // job has spent nothing, which is the whole point of splitting these two routes.
  app.post('/api/motion/jobs/:jobId/run', async (request) => {
    sameOriginMutation(request);
    const key = idempotencyKey(request);
    const body = request.body ?? {};
    return motionService.runJob(request.params.jobId, {
      idempotencyKey: key,
      confirmPaidCreate: body.confirm_paid_create === true,
    });
  });

  app.get('/api/motion/jobs/:jobId', async (request, reply) => {
    const job = await motionService.getJob(request.params.jobId);
    if (!job) throw new MotionServiceError(404, 'MOTION_JOB_NOT_FOUND', 'No such motion job');
    reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie');
    return job;
  });

  app.get('/api/motion/jobs/:jobId/events', async (request, reply) => {
    const after = Number.parseInt(request.query?.after ?? '0', 10);
    reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie');
    return { events: await motionService.listEvents(request.params.jobId, { after: Number.isFinite(after) ? after : 0 }) };
  });

  // The clip is addressed by its own hash, so it may be cached forever; a request whose
  // sha does not match the delivered one is a miss rather than a redirect.
  app.get('/api/motion/jobs/:jobId/clip/:sha256', async (request, reply) => {
    const filename = await motionService.outputFile(request.params.jobId, { expectedSha256: request.params.sha256 });
    if (!filename) throw new MotionServiceError(404, 'MOTION_CLIP_NOT_FOUND', 'No delivered clip under that hash');
    const etag = `"${request.params.sha256}"`;
    if (request.headers['if-none-match'] === etag) {
      reply.code(304);
      return null;
    }
    reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', etag)
      .header('Content-Type', 'video/mp4')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.sendFile
      ? reply.sendFile(path.basename(filename), path.dirname(filename))
      : reply.send(await import('node:fs/promises').then((fs) => fs.readFile(filename)));
  });
}
