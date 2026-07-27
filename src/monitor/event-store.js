import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeOutbound, sanitizeOutboundString } from '../security/outbound-redaction.js';

const MAX_TEXT = 2_000;
const STALL_EVENT_TYPES = new Set(['agent.stall_detected', 'agent.stall_heartbeat']);
const STALL_RECOVERY_STATES = new Set(['QUEUED', 'RUNNING', 'REVIEW_REQUIRED', 'STOPPED', 'OBSERVED']);
export const STALL_DIAGNOSTIC_CODE = 'RUN_CHECKPOINT_STALLED';
const STALL_INCIDENT_ID = /^[a-f0-9]{16}$/i;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STALL_PHASE = /^(?:ITEM_FACTS|VIEW_GROUPING|ITEM_PREPARATION|ITEM_QA|UPLOADED|CORE_PIPELINE|OPTIONAL_SCENE|UNMAPPED)$/;
const MAX_DIAGNOSTIC_ELAPSED_MS = 7 * 24 * 60 * 60_000;

export function canonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : null;
}

function boundedInteger(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value <= maximum ? value : null;
}

export function normalizeStallDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stall diagnostic');
  const incidentId = typeof value.incident_id === 'string' && STALL_INCIDENT_ID.test(value.incident_id)
    ? value.incident_id
    : null;
  const phase = typeof value.phase === 'string' && STALL_PHASE.test(value.phase) ? value.phase : null;
  const checkpointAt = canonicalIsoTimestamp(value.checkpoint_at);
  const thresholdMs = boundedInteger(value.threshold_ms, MAX_DIAGNOSTIC_ELAPSED_MS);
  const elapsedMs = boundedInteger(value.elapsed_ms, MAX_DIAGNOSTIC_ELAPSED_MS);
  const recoveryState = typeof value.recovery_state === 'string' && STALL_RECOVERY_STATES.has(value.recovery_state)
    ? value.recovery_state
    : null;
  const attemptCount = boundedInteger(value.attempt_count, 3);
  if (!incidentId || value.diagnostic_code !== STALL_DIAGNOSTIC_CODE || !phase || !checkpointAt
    || thresholdMs === null || elapsedMs === null || !recoveryState || attemptCount === null) {
    throw new Error('Invalid stall diagnostic');
  }
  return {
    incident_id: incidentId,
    diagnostic_code: STALL_DIAGNOSTIC_CODE,
    phase,
    checkpoint_at: checkpointAt,
    threshold_ms: thresholdMs,
    elapsed_ms: elapsedMs,
    recovery_state: recoveryState,
    attempt_count: attemptCount,
  };
}

export function projectMonitorEvent(event) {
  const eventId = typeof event?.id === 'string' && EVENT_ID.test(event.id) ? event.id : null;
  if (!STALL_EVENT_TYPES.has(event?.type)) return { ...event, id: eventId };
  let diagnostic;
  try { diagnostic = normalizeStallDiagnostic(event.data); }
  catch { diagnostic = { diagnostic_code: 'DIAGNOSTIC_UNAVAILABLE' }; }
  return {
    id: eventId,
    at: canonicalIsoTimestamp(event.at),
    source: 'agent',
    type: event.type,
    severity: ['debug', 'info', 'warn', 'error'].includes(event.severity) ? event.severity : 'error',
    ...(typeof event.run_id === 'string' && RUN_ID.test(event.run_id) ? { run_id: event.run_id } : {}),
    data: diagnostic,
  };
}

function text(value, limit = MAX_TEXT) {
  return typeof value === 'string' ? sanitizeOutboundString(value.slice(0, limit)) : undefined;
}

function safeData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (item === null || typeof item === 'boolean' || Number.isFinite(item)) return [[key, item]];
    if (typeof item === 'string') return [[key, sanitizeOutboundString(item.slice(0, MAX_TEXT))]];
    if (Array.isArray(item)) return [[key, sanitizeOutbound(item.slice(0, 20).map((entry) => typeof entry === 'string' ? entry.slice(0, 200) : entry))]];
    return [];
  }));
}

export class MonitorEventStore {
  constructor({ filename, clock = () => new Date() }) {
    this.filename = path.resolve(filename);
    this.clock = clock;
  }

  async initialize() {
    await mkdir(path.dirname(this.filename), { recursive: true });
  }

  async append({ source = 'server', type, severity = 'info', session_id, run_id, data = {} }) {
    if (!/^[a-z0-9_.-]{2,80}$/i.test(type ?? '')) throw new Error('Invalid monitor event type');
    const isStallDiagnostic = STALL_EVENT_TYPES.has(type);
    const diagnostic = isStallDiagnostic ? normalizeStallDiagnostic(data) : null;
    if (isStallDiagnostic && (typeof run_id !== 'string' || !RUN_ID.test(run_id))) {
      throw new Error('Invalid stall diagnostic run id');
    }
    const event = {
      id: randomUUID(),
      at: this.clock().toISOString(),
      source: isStallDiagnostic ? 'agent' : text(source, 40) ?? 'server',
      type,
      severity: ['debug', 'info', 'warn', 'error'].includes(severity) ? severity : 'info',
      ...(!isStallDiagnostic && text(session_id, 100) ? { session_id: text(session_id, 100) } : {}),
      ...(isStallDiagnostic ? { run_id } : text(run_id, 100) ? { run_id: text(run_id, 100) } : {}),
      data: isStallDiagnostic ? diagnostic : safeData(data),
    };
    await appendFile(this.filename, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return event;
  }

  async appendStallDiagnostic({ type, severity = 'error', run_id, diagnostic }) {
    if (!STALL_EVENT_TYPES.has(type)) throw new Error('Unsupported stall diagnostic event');
    return this.append({
      source: 'agent',
      type,
      severity,
      run_id,
      data: normalizeStallDiagnostic(diagnostic),
    });
  }

  async tail(limit = 250) {
    const bounded = Math.max(1, Math.min(Number(limit) || 250, 1_000));
    let body;
    try { body = await readFile(this.filename, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return body.trim().split('\n').filter(Boolean).slice(-bounded).flatMap((line) => {
      try { return [sanitizeOutbound(JSON.parse(line))]; } catch { return []; }
    });
  }
}
