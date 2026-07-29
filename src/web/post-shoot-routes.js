import { loadPostShootPipeline, publicPostShootPipeline } from './post-shoot-pipeline.js';

const MODEL_ID = 'decart/lucy-2-5/realtime';

export async function registerPostShootRoutes(app, {
  projectRoot,
  lucyTokenIssuer = null,
} = {}) {
  const pipeline = await loadPostShootPipeline({ projectRoot });

  app.get('/live', async (_request, reply) => reply
    .header('Cache-Control', 'no-store')
    .redirect('/post-shoot-mvp.html?demo=outfit&release=20260729-1'));

  app.get('/api/post-shoot/pipeline', async (_request, reply) => reply
    .header('Cache-Control', 'no-store')
    .send({
      ...publicPostShootPipeline(pipeline),
      provider_ready: typeof lucyTokenIssuer === 'function',
    }));

  app.post('/api/fal/realtime-token', async (request, reply) => {
    const body = request.body ?? {};
    if (body.app !== MODEL_ID) {
      return reply.code(400).send({ code: 'MODEL_NOT_ALLOWED', error: 'Lucy model is not allowlisted' });
    }
    if (body.cost_acknowledged !== true || body.max_session_seconds !== 5) {
      return reply.code(409).send({
        code: 'PAID_SESSION_APPROVAL_REQUIRED',
        error: 'Потрібне явне підтвердження платної 5-секундної Lucy-сесії.',
        maximum_cost_usd: 0.2,
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
      maxSessionSeconds: 5,
    });
    if (typeof token !== 'string' || token.length < 16) throw new Error('Lucy token issuer returned an invalid token');
    return reply
      .header('Cache-Control', 'private, no-store')
      .type('text/plain')
      .send(token);
  });
}
