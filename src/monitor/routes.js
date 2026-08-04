import { projectMonitorEvent } from './event-store.js';

const CLIENT_TYPES = new Set([
  'client.boot', 'client.ready', 'client.file_selected', 'client.file_removed',
  'client.draft_saved', 'client.draft_restored', 'client.draft_error',
  'client.submit', 'client.submit_response', 'client.fetch_error',
  'client.file_prepared', 'client.upload_progress',
  'client.sse_open', 'client.sse_error', 'client.run_event',
  'client.garment_selected',
  'client.profile_saved', 'client.profile_error', 'client.exit',
  'client.error', 'client.unhandled_rejection', 'client.visibility', 'client.online',
]);

const CLIENT_KEYS = new Set([
  'field', 'count', 'bytes', 'mime_types', 'stage', 'status', 'message', 'stack',
  'line', 'column', 'online', 'visibility', 'run_id', 'duration_ms', 'restored',
  'file_count', 'total_bytes', 'garment_count', 'has_person', 'has_identity_detail',
  'original_bytes', 'prepared_bytes', 'percentage', 'categories',
]);

function normalizeClientEvent(payload) {
  if (!payload || typeof payload !== 'object' || !CLIENT_TYPES.has(payload.type)) throw new Error('Unsupported telemetry event');
  const data = {};
  for (const [key, value] of Object.entries(payload.data ?? {})) {
    if (!CLIENT_KEYS.has(key)) continue;
    if (typeof value === 'string') data[key] = value.slice(0, key === 'stack' ? 2_000 : 500);
    else if (typeof value === 'boolean' || Number.isFinite(value)) data[key] = value;
    else if (Array.isArray(value)) data[key] = value.slice(0, 10).map((item) => String(item).slice(0, 100));
  }
  return {
    source: 'client', type: payload.type,
    severity: ['client.error', 'client.unhandled_rejection', 'client.fetch_error', 'client.draft_error'].includes(payload.type) ? 'error' : 'info',
    session_id: typeof payload.session_id === 'string' ? payload.session_id.slice(0, 100) : undefined,
    run_id: typeof payload.run_id === 'string' ? payload.run_id.slice(0, 100) : data.run_id,
    data,
  };
}

export async function registerMonitorRoutes(app, {
  store,
  acceptClientTelemetry = false,
  statusProvider = async () => ({ status: 'ok' }),
  testAudit = null,
  profileApi = null,
}) {
  const publicEvents = async (limit) => (await store.tail(limit)).map(projectMonitorEvent);
  if (acceptClientTelemetry) {
    app.post('/api/telemetry', async (request, reply) => {
      const serialized = JSON.stringify(request.body ?? {});
      if (serialized.length > 16_384) return reply.code(413).send({ error: 'Telemetry payload too large' });
      try {
        const event = normalizeClientEvent(request.body);
        await store.append(event);
        // Telemetry is allowed to remain available if the optional test audit
        // is temporarily unavailable. It never receives raw error text,
        // source media, filenames or request URLs from the client payload.
        if (testAudit && profileApi && event.session_id) {
          try {
            const profile = await profileApi.resolveRequestProfile(request, reply);
            await testAudit.record({
              request,
              profile_id: profile.profileId,
              event: {
                type: event.type,
                session_id: event.session_id,
                stage: event.data?.stage,
                status: event.data?.status,
              },
            });
          } catch { /* audit must not degrade the product's existing telemetry */ }
        }
        return reply.code(202).send({ accepted: true });
      } catch (error) {
        return reply.code(400).send({ error: error.message });
      }
    });
  }

  app.get('/api/monitor/status', async () => statusProvider());
  app.get('/api/monitor/events', async (request) => ({ events: await publicEvents(request.query?.limit) }));
  app.get('/api/monitor/stream', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const seen = new Set();
    const send = (event) => {
      seen.add(event.id);
      reply.raw.write(`event: monitor\ndata: ${JSON.stringify(event)}\n\n`);
    };
    for (const event of await publicEvents(200)) send(event);
    const poll = setInterval(async () => {
      try {
        for (const event of await publicEvents(300)) if (!seen.has(event.id)) send(event);
        if (seen.size > 2_000) {
          const current = new Set((await publicEvents(500)).map((event) => event.id));
          for (const id of seen) if (!current.has(id)) seen.delete(id);
        }
      } catch { /* next poll retries */ }
    }, 1_000);
    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
    request.raw.on('close', () => { clearInterval(poll); clearInterval(heartbeat); });
  });
}
