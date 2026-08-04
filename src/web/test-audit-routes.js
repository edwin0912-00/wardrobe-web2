import { TEST_AUDIT_EVENTS } from './test-audit-service.js';

const MAX_BODY_BYTES = 4 * 1024;
const TOKEN = /^[A-Za-z0-9_.:-]{1,120}$/;
const ALLOWED_KEYS = new Set(['type', 'session_id', 'stage', 'gate', 'leg', 'status', 'code']);

function valueToken(value, maximum = 120) {
  return typeof value === 'string' && TOKEN.test(value) ? value.slice(0, maximum) : null;
}

function integer(value, lower, upper) {
  return Number.isInteger(value) && value >= lower && value <= upper ? value : null;
}

export function normalizeTestAuditPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid test-audit payload');
  if (Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key))) throw new Error('Unsupported test-audit field');
  const type = valueToken(payload.type);
  const sessionId = valueToken(payload.session_id);
  if (!type || !TEST_AUDIT_EVENTS.has(type) || !sessionId) throw new Error('Unsupported test-audit event');
  return {
    type,
    session_id: sessionId,
    stage: valueToken(payload.stage),
    gate: valueToken(payload.gate, 80),
    leg: integer(payload.leg, 0, 9),
    status: valueToken(payload.status, 80),
    code: valueToken(payload.code),
  };
}

/**
 * Main and beta use this same-origin, narrow event sink. The browser cannot
 * send arbitrary text/URLs/files, and profile ownership remains server-owned.
 */
export async function registerTestAuditRoutes(app, { testAudit = null, profileApi = null } = {}) {
  if (!testAudit || !profileApi) return { enabled: false };
  app.post('/api/test-audit/events', async (request, reply) => {
    const serialized = JSON.stringify(request.body ?? {});
    if (serialized.length > MAX_BODY_BYTES) return reply.code(413).send({ error: 'Test audit payload too large' });
    try {
      const event = normalizeTestAuditPayload(request.body);
      const session = await profileApi.resolveRequestProfile(request, reply);
      const recorded = await testAudit.record({ request, profile_id: session.profileId, event });
      return reply.header('Cache-Control', 'no-store').code(202).send({ accepted: true, recorded_at: recorded.recorded_at });
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });
  return { enabled: true };
}
