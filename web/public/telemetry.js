const SESSION_KEY = 'zeely_monitor_session';
let sessionId = sessionStorage.getItem(SESSION_KEY);
if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem(SESSION_KEY, sessionId);
}

export function telemetry(type, data = {}, runId = null) {
  return fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, session_id: sessionId, run_id: runId, data }),
    keepalive: true,
  }).catch(() => null);
}

export function fileSummary(uploads) {
  const files = [uploads.person, uploads.identityDetail, ...uploads.garments].filter(Boolean);
  return {
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + file.size, 0),
    garment_count: uploads.garments.length,
    has_person: Boolean(uploads.person),
    has_identity_detail: Boolean(uploads.identityDetail),
  };
}
