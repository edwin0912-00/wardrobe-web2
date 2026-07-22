import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeOutbound, sanitizeOutboundString } from '../security/outbound-redaction.js';

const MAX_TEXT = 2_000;

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
    const event = {
      id: randomUUID(),
      at: this.clock().toISOString(),
      source: text(source, 40) ?? 'server',
      type,
      severity: ['debug', 'info', 'warn', 'error'].includes(severity) ? severity : 'info',
      ...(text(session_id, 100) ? { session_id: text(session_id, 100) } : {}),
      ...(text(run_id, 100) ? { run_id: text(run_id, 100) } : {}),
      data: safeData(data),
    };
    await appendFile(this.filename, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return event;
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
