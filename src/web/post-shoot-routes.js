import { loadPostShootPipeline, publicPostShootPipeline } from './post-shoot-pipeline.js';
import { ProfileError } from './profile-service.js';

const MODEL_ID = 'decart/lucy-2-5/realtime';
/* The browser remains the only camera permission gate.  This beta session has
 * an explicit server-owned 40 second ceiling; neither a price checkbox nor a
 * second confirmation is a reliable technical safeguard. */
const MAX_SESSION_SECONDS = 40;
const MAXIMUM_COST_USD = 1.6;
const SAVED_LOOK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

function sameOriginMutation(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site Live mutation is not allowed');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ProfileError(403, 'INVALID_ORIGIN', 'Invalid Live mutation origin');
  }
  const requestHost = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '')
    .split(',')[0]
    .trim();
  if (!requestHost || originHost !== requestHost) {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site Live mutation is not allowed');
  }
}

export async function registerPostShootRoutes(app, {
  projectRoot,
  lucyTokenIssuer = null,
  profileApi = null,
  profiles = null,
} = {}) {
  const pipeline = await loadPostShootPipeline({ projectRoot });

  app.get('/live', async (_request, reply) => reply
    .header('Cache-Control', 'no-store')
    .redirect('/post-shoot-mvp.html?demo=outfit&release=20260729-2'));

  app.get('/api/post-shoot/pipeline', async (_request, reply) => reply
    .header('Cache-Control', 'no-store')
    .send({
      ...publicPostShootPipeline(pipeline),
      provider_ready: typeof lucyTokenIssuer === 'function',
    }));

  app.get('/api/post-shoot/realtime-look-capability', async (request, reply) => {
    const lookId = String(request.query?.look_id ?? '');
    if (!SAVED_LOOK_ID.test(lookId)) {
      return reply.code(400).send({
        code: 'INVALID_LOOK_ID',
        error: 'Real-time Look потребує валідний збережений образ.',
      });
    }
    if (!profileApi || !profiles) {
      return reply.code(503).send({
        code: 'PROFILE_OWNERSHIP_UNAVAILABLE',
        error: 'Перевірка власника образу недоступна.',
      });
    }
    const session = await profileApi.resolveRequestProfile(request, reply);
    if (!profiles.ownsLook(session.profileId, lookId)) {
      return reply.code(404).send({
        code: 'LOOK_NOT_FOUND',
        error: 'Look not found',
      });
    }
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .send({
        capability: 'REALTIME_LOOK',
        camera_preview_ready: true,
        paid_live_ready: typeof lucyTokenIssuer === 'function',
        launch: {
          href: `/post-shoot-mvp.html?look=${encodeURIComponent(lookId)}&surface=full`,
          presentation: 'FULL_VIEWPORT',
          target: '_self',
          nested: false,
          internal_scroll: false,
        },
        consent: {
          privacy_required: false,
          cost_required: false,
          maximum_cost_usd: MAXIMUM_COST_USD,
          maximum_session_seconds: MAX_SESSION_SECONDS,
        },
        camera: {
          permission_required: true,
          video: true,
          audio: false,
        },
        capture: {
          automatic_recording: false,
          automatic_upload: false,
        },
      });
  });

  app.post('/api/fal/realtime-token', async (request, reply) => {
    sameOriginMutation(request);
    const body = request.body ?? {};
    if (body.app !== MODEL_ID) {
      return reply.code(400).send({ code: 'MODEL_NOT_ALLOWED', error: 'Lucy model is not allowlisted' });
    }
    const lookId = String(body.look_id ?? '');
    if (!SAVED_LOOK_ID.test(lookId)) {
      return reply.code(400).send({
        code: 'INVALID_LOOK_ID',
        error: 'Real-time Look потребує валідний збережений образ.',
      });
    }
    if (!profileApi || !profiles) {
      return reply.code(503).send({
        code: 'PROFILE_OWNERSHIP_UNAVAILABLE',
        error: 'Перевірка власника образу недоступна.',
      });
    }
    const session = await profileApi.resolveRequestProfile(request, reply);
    if (!profiles.ownsLook(session.profileId, lookId)) {
      return reply.code(404).send({
        code: 'LOOK_NOT_FOUND',
        error: 'Look not found',
      });
    }
    if (typeof lucyTokenIssuer !== 'function') {
      return reply.code(503).send({
        code: 'LUCY_PROVIDER_NOT_CONFIGURED',
        error: 'Lucy provider не активовано. Безкоштовний camera preview доступний.',
      });
    }
    const token = await lucyTokenIssuer({
      app: MODEL_ID,
      expiresInSeconds: 10,
      maxSessionSeconds: MAX_SESSION_SECONDS,
    });
    if (typeof token !== 'string' || token.length < 16) throw new Error('Lucy token issuer returned an invalid token');
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .type('text/plain')
      .send(token);
  });
}
