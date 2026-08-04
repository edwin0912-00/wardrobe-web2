import { createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const TEST_AUDIT_SEGMENTS = Object.freeze([
  'MY_TESTS',
  'EXTERNAL_TESTS',
  'UNCLASSIFIED',
]);

export const TEST_AUDIT_EVENTS = new Set([
  // These are the existing beta telemetry verbs. They deliberately contain no
  // prompt, filename, image, media URL or raw provider payload.
  'client.boot',
  'client.ready',
  'client.file_selected',
  'client.file_removed',
  'client.file_prepared',
  'client.draft_saved',
  'client.draft_restored',
  'client.draft_error',
  'client.submit',
  'client.submit_response',
  'client.fetch_error',
  'client.upload_progress',
  'client.sse_open',
  'client.sse_error',
  'client.run_event',
  'client.garment_selected',
  'client.profile_saved',
  'client.profile_error',
  'client.error',
  'client.unhandled_rejection',
  'client.visibility',
  'client.online',
  'client.exit',
  // These are emitted by the cinematic main shell through its same-origin
  // beta adapter. The browser sends only its visible journey state.
  'main.open',
  'main.ready',
  'main.stage',
  'main.bridge',
  'main.exit',
]);

const TOKEN = /^[A-Za-z0-9_.:-]{1,120}$/;
const COUNTRY = /^[A-Z]{2}$/;
const MAX_EVENTS_PER_PROFILE = 16;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;

function nowMs(clock) {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Test audit clock must return a valid time');
  return milliseconds;
}

function iso(value) {
  return new Date(value).toISOString();
}

function token(value, fallback = null, maximum = 120) {
  if (typeof value !== 'string' || !TOKEN.test(value)) return fallback;
  return value.slice(0, maximum);
}

function boundedInteger(value, lower, upper, fallback = null) {
  return Number.isInteger(value) && value >= lower && value <= upper ? value : fallback;
}

function header(request, name) {
  const value = request?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function isLoopback(value) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function trustedIp(request) {
  const direct = typeof request?.ip === 'string' ? request.ip : null;
  const cloudflare = header(request, 'cf-connecting-ip');
  // The beta daemon is loopback-only. A Cloudflare tunnel/static gateway is
  // therefore the trusted immediate peer and the CF header is usable there.
  if (isLoopback(direct) && typeof cloudflare === 'string' && isIP(cloudflare)) {
    return { value: cloudflare, source: 'cloudflare' };
  }
  if (direct && isIP(direct) && !isLoopback(direct)) return { value: direct, source: 'direct' };
  return { value: null, source: 'unavailable' };
}

function clientCountry(request) {
  for (const source of ['cf-ipcountry', 'x-vercel-ip-country']) {
    const value = String(header(request, source) ?? '').toUpperCase();
    if (COUNTRY.test(value)) return value;
  }
  return null;
}

/**
 * Produce a useful, deliberately coarse browser description. This is not a
 * fingerprint: no raw UA, installed fonts, screen size, canvas or plugin data
 * is persisted.
 */
export function parseUserAgent(userAgent = '') {
  const ua = String(userAgent).slice(0, 1_000);
  let device = 'unknown';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) device = 'tablet';
  else if (/Mobi|iPhone|Android/i.test(ua)) device = 'mobile';
  else if (/Macintosh|Windows NT|X11|Linux/i.test(ua)) device = 'desktop';

  let os = 'unknown';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'unknown';
  let major = null;
  const candidates = [
    ['Edge', /Edg(?:A|iOS)?\/(\d+)/i],
    ['Opera', /OPR\/(\d+)/i],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/i],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/i],
    ['Safari', /Version\/(\d+)[^]*Safari\//i],
  ];
  for (const [name, expression] of candidates) {
    const match = ua.match(expression);
    if (!match) continue;
    browser = name;
    major = Number.parseInt(match[1], 10);
    break;
  }
  return {
    device,
    os,
    browser,
    browser_major: Number.isInteger(major) && major >= 1 && major <= 999 ? major : null,
  };
}

function normalizedEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('Invalid test-audit event');
  const type = token(event.type, null, 120);
  if (!type || !TEST_AUDIT_EVENTS.has(type)) throw new Error('Unsupported test-audit event');
  const sessionId = token(event.session_id, null, 120);
  if (!sessionId) throw new Error('Missing test-audit session');
  return {
    type,
    session_id: sessionId,
    stage: token(event.stage, null, 120),
    gate: token(event.gate, null, 80),
    leg: boundedInteger(event.leg, 0, 9),
    status: token(event.status, null, 80),
    code: token(event.code, null, 120),
  };
}

function profileId(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new Error('Invalid test-audit profile');
  return value;
}

function requestOrigin(request) {
  const value = String(header(request, 'x-forwarded-host') || header(request, 'host') || 'unknown').toLowerCase();
  return /^[a-z0-9.-]{1,120}$/.test(value) ? value : 'unknown';
}

function errorEvent(type) {
  return /(?:_error$|fetch_error|unhandled_rejection|sse_error|draft_error)/.test(type);
}

function completionEvent(type, stage) {
  return type === 'client.profile_saved'
    || type === 'client.submit_response'
    || type === 'client.run_event' && stage === 'COMPLETED';
}

/**
 * A private, append-only test journey audit. It intentionally owns neither
 * auth nor product state: profile ownership remains in ProfileService.
 */
export class TestAuditService {
  constructor({ databasePath, clock = () => new Date(), ipHashKey = null, retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
    if (!databasePath) throw new Error('Test audit databasePath is required');
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 180) {
      throw new Error('Test audit retentionDays must be between 1 and 180');
    }
    this.databasePath = databasePath === ':memory:' ? databasePath : path.resolve(databasePath);
    this.clock = clock;
    this.ipHashKey = typeof ipHashKey === 'string' && ipHashKey.length >= 16 ? ipHashKey : null;
    this.retentionDays = retentionDays;
    this.database = null;
  }

  #db() {
    if (!this.database) throw new Error('TestAuditService is not initialized');
    return this.database;
  }

  async initialize() {
    if (this.database) return;
    if (this.databasePath !== ':memory:') await mkdir(path.dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS test_audit_profiles (
        profile_id TEXT PRIMARY KEY,
        segment TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        origin TEXT NOT NULL,
        device TEXT NOT NULL,
        os TEXT NOT NULL,
        browser TEXT NOT NULL,
        browser_major INTEGER,
        country_code TEXT,
        network_hash TEXT,
        network_source TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS test_audit_sessions (
        session_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES test_audit_profiles(profile_id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ended_at INTEGER,
        origin TEXT NOT NULL,
        last_event TEXT NOT NULL,
        last_stage TEXT,
        last_gate TEXT,
        last_leg INTEGER,
        last_status TEXT,
        event_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        completion_count INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS test_audit_events (
        event_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES test_audit_profiles(profile_id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES test_audit_sessions(session_id) ON DELETE CASCADE,
        occurred_at INTEGER NOT NULL,
        origin TEXT NOT NULL,
        event_type TEXT NOT NULL,
        stage TEXT,
        gate TEXT,
        leg INTEGER,
        status TEXT,
        code TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS test_audit_profiles_last_seen ON test_audit_profiles(last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS test_audit_sessions_profile_last_seen ON test_audit_sessions(profile_id, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS test_audit_events_profile_time ON test_audit_events(profile_id, occurred_at DESC);
    `);
    this.database = database;
  }

  networkContext(request) {
    const network = trustedIp(request);
    const networkHash = network.value && this.ipHashKey
      ? createHmac('sha256', this.ipHashKey).update(network.value).digest('hex').slice(0, 16)
      : null;
    return {
      country_code: clientCountry(request),
      network_hash: networkHash,
      network_source: network.source,
    };
  }

  async record({ request, profile_id: rawProfileId, event }) {
    const profile = profileId(rawProfileId);
    const normalized = normalizedEvent(event);
    const now = nowMs(this.clock);
    const origin = requestOrigin(request);
    const client = parseUserAgent(header(request, 'user-agent'));
    const network = this.networkContext(request);
    const eventIsError = errorEvent(normalized.type) ? 1 : 0;
    const eventIsCompletion = completionEvent(normalized.type, normalized.stage) ? 1 : 0;
    const ended = normalized.type === 'main.exit' || normalized.type === 'client.exit' ? now : null;
    const db = this.#db();

    db.prepare(`
      INSERT INTO test_audit_profiles(
        profile_id, segment, first_seen_at, last_seen_at, origin, device, os, browser,
        browser_major, country_code, network_hash, network_source
      ) VALUES (?, 'UNCLASSIFIED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        origin = excluded.origin,
        device = excluded.device,
        os = excluded.os,
        browser = excluded.browser,
        browser_major = excluded.browser_major,
        country_code = COALESCE(excluded.country_code, test_audit_profiles.country_code),
        network_hash = COALESCE(excluded.network_hash, test_audit_profiles.network_hash),
        network_source = excluded.network_source
    `).run(
      profile,
      now,
      now,
      origin,
      client.device,
      client.os,
      client.browser,
      client.browser_major,
      network.country_code,
      network.network_hash,
      network.network_source,
    );

    db.prepare(`
      INSERT INTO test_audit_sessions(
        session_id, profile_id, started_at, last_seen_at, ended_at, origin, last_event,
        last_stage, last_gate, last_leg, last_status, event_count, error_count, completion_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        last_seen_at = excluded.last_seen_at,
        ended_at = CASE
          WHEN excluded.ended_at IS NOT NULL THEN excluded.ended_at
          WHEN excluded.last_event IN ('main.open', 'client.boot') THEN NULL
          ELSE test_audit_sessions.ended_at
        END,
        origin = excluded.origin,
        last_event = excluded.last_event,
        last_stage = COALESCE(excluded.last_stage, test_audit_sessions.last_stage),
        last_gate = COALESCE(excluded.last_gate, test_audit_sessions.last_gate),
        last_leg = COALESCE(excluded.last_leg, test_audit_sessions.last_leg),
        last_status = COALESCE(excluded.last_status, test_audit_sessions.last_status),
        event_count = test_audit_sessions.event_count + 1,
        error_count = test_audit_sessions.error_count + excluded.error_count,
        completion_count = test_audit_sessions.completion_count + excluded.completion_count
    `).run(
      normalized.session_id,
      profile,
      now,
      now,
      ended,
      origin,
      normalized.type,
      normalized.stage,
      normalized.gate,
      normalized.leg,
      normalized.status,
      eventIsError,
      eventIsCompletion,
    );

    db.prepare(`
      INSERT INTO test_audit_events(
        event_id, profile_id, session_id, occurred_at, origin, event_type, stage, gate, leg, status, code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      profile,
      normalized.session_id,
      now,
      origin,
      normalized.type,
      normalized.stage,
      normalized.gate,
      normalized.leg,
      normalized.status,
      normalized.code,
    );
    return { profile_id: profile, session_id: normalized.session_id, recorded_at: iso(now) };
  }

  setSegment(rawProfileId, segment) {
    const profile = profileId(rawProfileId);
    if (!TEST_AUDIT_SEGMENTS.includes(segment)) throw new Error('Invalid test-audit segment');
    const result = this.#db().prepare(`UPDATE test_audit_profiles SET segment = ? WHERE profile_id = ?`).run(segment, profile);
    if (result.changes !== 1) return null;
    return { profile_id: profile, segment };
  }

  overview({ days = 30 } = {}) {
    const rangeDays = boundedInteger(days, 1, this.retentionDays, this.retentionDays);
    const since = nowMs(this.clock) - rangeDays * DAY_MS;
    const db = this.#db();
    const profiles = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM test_audit_sessions s WHERE s.profile_id = p.profile_id AND s.last_seen_at >= ?) AS session_count,
        (SELECT COALESCE(SUM(s.event_count), 0) FROM test_audit_sessions s WHERE s.profile_id = p.profile_id AND s.last_seen_at >= ?) AS event_count,
        (SELECT COALESCE(SUM(s.error_count), 0) FROM test_audit_sessions s WHERE s.profile_id = p.profile_id AND s.last_seen_at >= ?) AS error_count,
        (SELECT COALESCE(SUM(s.completion_count), 0) FROM test_audit_sessions s WHERE s.profile_id = p.profile_id AND s.last_seen_at >= ?) AS completion_count,
        (SELECT s.last_event FROM test_audit_sessions s WHERE s.profile_id = p.profile_id ORDER BY s.last_seen_at DESC LIMIT 1) AS last_event,
        (SELECT s.last_stage FROM test_audit_sessions s WHERE s.profile_id = p.profile_id ORDER BY s.last_seen_at DESC LIMIT 1) AS last_stage,
        (SELECT s.last_gate FROM test_audit_sessions s WHERE s.profile_id = p.profile_id ORDER BY s.last_seen_at DESC LIMIT 1) AS last_gate,
        (SELECT s.last_leg FROM test_audit_sessions s WHERE s.profile_id = p.profile_id ORDER BY s.last_seen_at DESC LIMIT 1) AS last_leg,
        (SELECT s.ended_at FROM test_audit_sessions s WHERE s.profile_id = p.profile_id ORDER BY s.last_seen_at DESC LIMIT 1) AS last_ended_at
      FROM test_audit_profiles p
      WHERE p.last_seen_at >= ?
      ORDER BY p.last_seen_at DESC
    `).all(since, since, since, since, since).map((row) => ({
      profile_id: row.profile_id,
      segment: row.segment,
      first_seen_at: iso(row.first_seen_at),
      last_seen_at: iso(row.last_seen_at),
      last_ended_at: row.last_ended_at ? iso(row.last_ended_at) : null,
      origin: row.origin,
      device: row.device,
      os: row.os,
      browser: row.browser,
      browser_major: row.browser_major ?? null,
      country_code: row.country_code ?? null,
      // A short HMAC identifier can correlate a network without exposing its
      // raw address. It is not an IP and cannot be used to connect back to it.
      network_id: row.network_hash ?? null,
      network_source: row.network_source,
      session_count: row.session_count,
      event_count: row.event_count,
      error_count: row.error_count,
      completion_count: row.completion_count,
      last_event: row.last_event,
      last_stage: row.last_stage,
      last_gate: row.last_gate,
      last_leg: row.last_leg,
      events: db.prepare(`
        SELECT occurred_at, origin, event_type, stage, gate, leg, status, code
        FROM test_audit_events
        WHERE profile_id = ?
        ORDER BY occurred_at DESC
        LIMIT ?
      `).all(row.profile_id, MAX_EVENTS_PER_PROFILE).map((event) => ({
        occurred_at: iso(event.occurred_at),
        origin: event.origin,
        type: event.event_type,
        stage: event.stage,
        gate: event.gate,
        leg: event.leg,
        status: event.status,
        code: event.code,
      })),
    }));
    const summary = profiles.reduce((totals, profile) => {
      totals.profiles += 1;
      totals.sessions += profile.session_count;
      totals.events += profile.event_count;
      totals.errors += profile.error_count;
      totals.completions += profile.completion_count;
      if (profile.segment === 'MY_TESTS') totals.my_tests += 1;
      else if (profile.segment === 'EXTERNAL_TESTS') totals.external_tests += 1;
      else totals.unclassified += 1;
      return totals;
    }, { profiles: 0, sessions: 0, events: 0, errors: 0, completions: 0, my_tests: 0, external_tests: 0, unclassified: 0 });
    return {
      generated_at: iso(nowMs(this.clock)),
      retention_days: this.retentionDays,
      range_days: rangeDays,
      summary,
      profiles,
    };
  }

  cleanup() {
    const before = nowMs(this.clock) - this.retentionDays * DAY_MS;
    const db = this.#db();
    const events = db.prepare('DELETE FROM test_audit_events WHERE occurred_at < ?').run(before).changes;
    const sessions = db.prepare('DELETE FROM test_audit_sessions WHERE last_seen_at < ?').run(before).changes;
    const profiles = db.prepare('DELETE FROM test_audit_profiles WHERE last_seen_at < ?').run(before).changes;
    return { events, sessions, profiles };
  }

  close() {
    this.database?.close();
    this.database = null;
  }
}
