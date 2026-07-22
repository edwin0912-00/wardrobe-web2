import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const PROFILE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function constantTimeTextEqual(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function nowFrom(clock) {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Profile clock must return a valid Date or epoch milliseconds');
  return milliseconds;
}

function assertRunId(runId) {
  if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) throw new ProfileError(400, 'INVALID_RUN_ID', 'Invalid run id');
  return runId;
}

function assertAssetId(value, label) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) throw new ProfileError(400, 'INVALID_ASSET_ID', `Invalid ${label}`);
  return value;
}

function rowAvatar(row) {
  return {
    avatar_id: row.avatar_id,
    created_at: iso(row.created_at),
    expires_at: iso(row.expires_at),
    image_url: `/api/profile/avatars/${encodeURIComponent(row.avatar_id)}/image`,
  };
}

function rowLook(row) {
  return {
    look_id: row.look_id,
    avatar_id: row.avatar_id,
    parent_look_id: row.parent_look_id ?? null,
    created_at: iso(row.created_at),
    expires_at: iso(row.expires_at),
    image_url: `/api/profile/looks/${encodeURIComponent(row.look_id)}/image`,
  };
}

export class ProfileError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ProfileError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * SQLite-backed metadata for an anonymous, browser-bound workspace.
 * Image bytes remain in immutable RunService directories; this service owns
 * the authorization and retention graph that points at those runs.
 */
export class ProfileService {
  constructor({ databasePath, clock = () => new Date(), ttlMs = PROFILE_TTL_MS }) {
    if (!databasePath) throw new Error('ProfileService databasePath is required');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ProfileService ttlMs must be positive');
    this.databasePath = databasePath === ':memory:' ? databasePath : path.resolve(databasePath);
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.database = null;
  }

  async initialize() {
    if (this.database) return;
    if (this.databasePath !== ':memory:') await mkdir(path.dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec('PRAGMA foreign_keys = ON');
    this.database.exec('PRAGMA journal_mode = WAL');
    this.database.exec('PRAGMA busy_timeout = 5000');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        profile_id TEXT PRIMARY KEY,
        verifier_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      ) STRICT;

      CREATE TABLE IF NOT EXISTS avatars (
        avatar_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        source_run_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS avatars_profile_idx ON avatars(profile_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS looks (
        look_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        avatar_id TEXT NOT NULL,
        source_run_id TEXT NOT NULL UNIQUE,
        parent_look_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
        FOREIGN KEY (avatar_id) REFERENCES avatars(avatar_id) ON DELETE CASCADE,
        FOREIGN KEY (parent_look_id) REFERENCES looks(look_id) ON DELETE SET NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS looks_profile_idx ON looks(profile_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS looks_avatar_idx ON looks(avatar_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS run_claims (
        run_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        source_avatar_id TEXT,
        saved_avatar_id TEXT,
        saved_look_id TEXT,
        claimed_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
        FOREIGN KEY (source_avatar_id) REFERENCES avatars(avatar_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS run_claims_profile_idx ON run_claims(profile_id, claimed_at DESC);

      CREATE TABLE IF NOT EXISTS pending_run_deletions (
        run_id TEXT PRIMARY KEY,
        queued_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      ) STRICT;
    `);
  }

  close() {
    if (!this.database) return;
    this.database.close();
    this.database = null;
  }

  #db() {
    if (!this.database) throw new Error('ProfileService.initialize() must be called first');
    return this.database;
  }

  #transaction(action) {
    const database = this.#db();
    database.exec('BEGIN IMMEDIATE');
    try {
      const value = action(database);
      database.exec('COMMIT');
      return value;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  #activeProfile(profileId, now = nowFrom(this.clock)) {
    return this.#db().prepare(`
      SELECT profile_id, created_at, expires_at
      FROM profiles
      WHERE profile_id = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(profileId, now) ?? null;
  }

  createSession() {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const now = nowFrom(this.clock);
    const profile = {
      profileId: randomUUID(),
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.#db().prepare(`
      INSERT INTO profiles(profile_id, verifier_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(profile.profileId, tokenHash(token), profile.createdAt, profile.expiresAt);
    return { ...profile, token, observedAt: now, isNew: true };
  }

  resolveSession(token) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    const now = nowFrom(this.clock);
    const digest = tokenHash(token);
    const row = this.#db().prepare(`
      SELECT profile_id, verifier_hash, created_at, expires_at
      FROM profiles
      WHERE verifier_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(digest, now);
    if (!row || !constantTimeTextEqual(row.verifier_hash, digest)) return null;
    return {
      profileId: row.profile_id,
      token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      observedAt: now,
      isNew: false,
    };
  }

  resolveOrCreateSession(token) {
    return this.resolveSession(token) ?? this.createSession();
  }

  getProfile(profileId) {
    const profile = this.#activeProfile(profileId);
    if (!profile) return null;
    const avatarRows = this.#db().prepare(`
      SELECT avatar_id, created_at, expires_at
      FROM avatars WHERE profile_id = ? ORDER BY created_at DESC, avatar_id
    `).all(profileId);
    const lookRows = this.#db().prepare(`
      SELECT look_id, avatar_id, parent_look_id, created_at, expires_at
      FROM looks WHERE profile_id = ? ORDER BY created_at DESC, look_id
    `).all(profileId);
    const looks = lookRows.map(rowLook);
    const avatars = avatarRows.map((row) => {
      const avatar = rowAvatar(row);
      return { ...avatar, looks: looks.filter((look) => look.avatar_id === avatar.avatar_id) };
    });
    return {
      profile_id: profile.profile_id,
      created_at: iso(profile.created_at),
      expires_at: iso(profile.expires_at),
      retention_days: Math.round(this.ttlMs / 86_400_000),
      avatars,
      looks,
    };
  }

  claimRun(profileId, runId, { sourceAvatarId = null } = {}) {
    assertRunId(runId);
    if (sourceAvatarId !== null) assertAssetId(sourceAvatarId, 'source avatar id');
    return this.#transaction((database) => {
      if (!this.#activeProfile(profileId)) throw new ProfileError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
      if (sourceAvatarId !== null) {
        const avatar = database.prepare('SELECT avatar_id FROM avatars WHERE avatar_id = ? AND profile_id = ?').get(sourceAvatarId, profileId);
        if (!avatar) throw new ProfileError(404, 'AVATAR_NOT_FOUND', 'Avatar not found');
      }
      const current = database.prepare('SELECT profile_id, source_avatar_id FROM run_claims WHERE run_id = ?').get(runId);
      if (current) {
        const sameProfile = constantTimeTextEqual(current.profile_id, profileId);
        const sameSource = (current.source_avatar_id ?? null) === sourceAvatarId;
        if (!sameProfile || !sameSource) throw new ProfileError(409, 'RUN_UNAVAILABLE', 'Run is unavailable');
        return { run_id: runId, source_avatar_id: sourceAvatarId, replayed: true };
      }
      database.prepare(`
        INSERT INTO run_claims(run_id, profile_id, source_avatar_id, claimed_at)
        VALUES (?, ?, ?, ?)
      `).run(runId, profileId, sourceAvatarId, nowFrom(this.clock));
      return { run_id: runId, source_avatar_id: sourceAvatarId, replayed: false };
    });
  }

  getClaim(profileId, runId) {
    assertRunId(runId);
    const row = this.#db().prepare(`
      SELECT run_id, source_avatar_id, saved_avatar_id, saved_look_id, claimed_at
      FROM run_claims WHERE run_id = ? AND profile_id = ?
    `).get(runId, profileId);
    return row ? {
      run_id: row.run_id,
      source_avatar_id: row.source_avatar_id ?? null,
      saved_avatar_id: row.saved_avatar_id ?? null,
      saved_look_id: row.saved_look_id ?? null,
      claimed_at: iso(row.claimed_at),
    } : null;
  }

  saveClaimedRun(profileId, runId) {
    assertRunId(runId);
    return this.#transaction((database) => {
      const profile = this.#activeProfile(profileId);
      if (!profile) throw new ProfileError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
      const claim = database.prepare(`
        SELECT source_avatar_id, saved_avatar_id, saved_look_id
        FROM run_claims WHERE run_id = ? AND profile_id = ?
      `).get(runId, profileId);
      if (!claim) throw new ProfileError(404, 'RUN_NOT_CLAIMED', 'Run was not claimed by this browser profile');

      const replayed = Boolean(claim.saved_avatar_id || claim.saved_look_id);
      let avatarId = claim.saved_avatar_id ?? claim.source_avatar_id ?? null;
      let lookId = claim.saved_look_id ?? null;
      const now = nowFrom(this.clock);

      if (!replayed) {
        if (claim.source_avatar_id === null) {
          avatarId = randomUUID();
          database.prepare(`
            INSERT INTO avatars(avatar_id, profile_id, source_run_id, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(avatarId, profileId, runId, now, profile.expires_at);
        } else {
          const source = database.prepare('SELECT avatar_id FROM avatars WHERE avatar_id = ? AND profile_id = ?').get(claim.source_avatar_id, profileId);
          if (!source) throw new ProfileError(404, 'AVATAR_NOT_FOUND', 'Source avatar not found');
        }
        lookId = randomUUID();
        database.prepare(`
          INSERT INTO looks(look_id, profile_id, avatar_id, source_run_id, parent_look_id, created_at, expires_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?)
        `).run(lookId, profileId, avatarId, runId, now, profile.expires_at);
        database.prepare(`
          UPDATE run_claims SET saved_avatar_id = ?, saved_look_id = ? WHERE run_id = ?
        `).run(claim.source_avatar_id === null ? avatarId : null, lookId, runId);
      }

      const avatarRow = avatarId ? database.prepare(`
        SELECT avatar_id, created_at, expires_at FROM avatars WHERE avatar_id = ? AND profile_id = ?
      `).get(avatarId, profileId) : null;
      const lookRow = lookId ? database.prepare(`
        SELECT look_id, avatar_id, parent_look_id, created_at, expires_at FROM looks WHERE look_id = ? AND profile_id = ?
      `).get(lookId, profileId) : null;
      return {
        avatar: avatarRow ? rowAvatar(avatarRow) : null,
        look: lookRow ? rowLook(lookRow) : null,
        replayed,
      };
    });
  }

  avatarAsset(profileId, avatarId) {
    assertAssetId(avatarId, 'avatar id');
    const row = this.#db().prepare(`
      SELECT a.avatar_id, a.source_run_id
      FROM avatars a JOIN profiles p ON p.profile_id = a.profile_id
      WHERE a.avatar_id = ? AND a.profile_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(avatarId, profileId, nowFrom(this.clock));
    return row ? { avatarId: row.avatar_id, runId: row.source_run_id, filename: 'avatar.png' } : null;
  }

  lookAsset(profileId, lookId) {
    assertAssetId(lookId, 'look id');
    const row = this.#db().prepare(`
      SELECT l.look_id, l.source_run_id
      FROM looks l JOIN profiles p ON p.profile_id = l.profile_id
      WHERE l.look_id = ? AND l.profile_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(lookId, profileId, nowFrom(this.clock));
    return row ? { lookId: row.look_id, runId: row.source_run_id, filename: 'avatar_outfit.png' } : null;
  }

  #queueRun(database, runId, now) {
    database.prepare(`
      INSERT INTO pending_run_deletions(run_id, queued_at) VALUES (?, ?)
      ON CONFLICT(run_id) DO NOTHING
    `).run(runId, now);
  }

  deleteLook(profileId, lookId) {
    assertAssetId(lookId, 'look id');
    return this.#transaction((database) => {
      const look = database.prepare('SELECT source_run_id FROM looks WHERE look_id = ? AND profile_id = ?').get(lookId, profileId);
      if (!look) return false;
      database.prepare('UPDATE run_claims SET saved_look_id = NULL WHERE saved_look_id = ?').run(lookId);
      database.prepare('DELETE FROM looks WHERE look_id = ? AND profile_id = ?').run(lookId, profileId);
      const remaining = database.prepare(`
        SELECT 1 FROM avatars WHERE source_run_id = ?
        UNION ALL SELECT 1 FROM looks WHERE source_run_id = ? LIMIT 1
      `).get(look.source_run_id, look.source_run_id);
      if (!remaining) {
        database.prepare('DELETE FROM run_claims WHERE run_id = ? AND profile_id = ?').run(look.source_run_id, profileId);
        this.#queueRun(database, look.source_run_id, nowFrom(this.clock));
      }
      return true;
    });
  }

  deleteAvatar(profileId, avatarId) {
    assertAssetId(avatarId, 'avatar id');
    return this.#transaction((database) => {
      const avatar = database.prepare('SELECT avatar_id FROM avatars WHERE avatar_id = ? AND profile_id = ?').get(avatarId, profileId);
      if (!avatar) return false;
      const runIds = database.prepare(`
        SELECT source_run_id AS run_id FROM avatars WHERE avatar_id = ? AND profile_id = ?
        UNION SELECT source_run_id AS run_id FROM looks WHERE avatar_id = ? AND profile_id = ?
        UNION SELECT run_id FROM run_claims WHERE profile_id = ? AND source_avatar_id = ?
      `).all(avatarId, profileId, avatarId, profileId, profileId, avatarId).map((row) => row.run_id);
      for (const runId of runIds) {
        database.prepare('DELETE FROM run_claims WHERE run_id = ? AND profile_id = ?').run(runId, profileId);
        this.#queueRun(database, runId, nowFrom(this.clock));
      }
      database.prepare('DELETE FROM avatars WHERE avatar_id = ? AND profile_id = ?').run(avatarId, profileId);
      return true;
    });
  }

  deleteProfile(profileId) {
    return this.#transaction((database) => {
      const profile = database.prepare('SELECT profile_id FROM profiles WHERE profile_id = ?').get(profileId);
      if (!profile) return false;
      const now = nowFrom(this.clock);
      const runIds = database.prepare('SELECT run_id FROM run_claims WHERE profile_id = ?').all(profileId).map((row) => row.run_id);
      for (const runId of runIds) this.#queueRun(database, runId, now);
      database.prepare('DELETE FROM profiles WHERE profile_id = ?').run(profileId);
      return true;
    });
  }

  cleanupExpired() {
    return this.#transaction((database) => {
      const now = nowFrom(this.clock);
      const profiles = database.prepare(`
        SELECT profile_id FROM profiles WHERE expires_at <= ? OR revoked_at IS NOT NULL
      `).all(now);
      const runIds = [];
      for (const profile of profiles) {
        const claimed = database.prepare('SELECT run_id FROM run_claims WHERE profile_id = ?').all(profile.profile_id);
        for (const { run_id: runId } of claimed) {
          runIds.push(runId);
          this.#queueRun(database, runId, now);
        }
        database.prepare('DELETE FROM profiles WHERE profile_id = ?').run(profile.profile_id);
      }
      return { removedProfiles: profiles.length, queuedRuns: [...new Set(runIds)] };
    });
  }

  pendingRunDeletions() {
    return this.#db().prepare('SELECT run_id, attempts, last_error FROM pending_run_deletions ORDER BY queued_at').all();
  }

  async flushDeletionQueue(runService) {
    const pending = this.pendingRunDeletions();
    const result = { deleted: [], deferred: [] };
    for (const item of pending) {
      try {
        await runService.deleteRun(item.run_id);
        this.#db().prepare('DELETE FROM pending_run_deletions WHERE run_id = ?').run(item.run_id);
        result.deleted.push(item.run_id);
      } catch (error) {
        this.#db().prepare(`
          UPDATE pending_run_deletions SET attempts = attempts + 1, last_error = ? WHERE run_id = ?
        `).run(String(error?.message ?? error).slice(0, 500), item.run_id);
        result.deferred.push(item.run_id);
      }
    }
    return result;
  }
}

function parseCookies(header = '') {
  const result = {};
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const key = pair.slice(0, separator).trim();
    try { result[key] = decodeURIComponent(pair.slice(separator + 1).trim()); } catch { /* ignore malformed cookies */ }
  }
  return result;
}

function appendSetCookie(reply, value) {
  const current = reply.getHeader('set-cookie');
  if (!current) reply.header('Set-Cookie', value);
  else if (Array.isArray(current)) reply.header('Set-Cookie', [...current, value]);
  else reply.header('Set-Cookie', [current, value]);
}

function sessionCookie(name, session, { secure }) {
  const remainingSeconds = Math.max(0, Math.ceil((session.expiresAt - session.observedAt) / 1000));
  return [
    `${name}=${encodeURIComponent(session.token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${remainingSeconds}`,
    `Expires=${new Date(session.expiresAt).toUTCString()}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function clearCookie(name, { secure }) {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function sameOriginMutation(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site profile mutation is not allowed');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let originHost;
  try { originHost = new URL(origin).host; } catch {
    throw new ProfileError(403, 'INVALID_ORIGIN', 'Invalid profile mutation origin');
  }
  const requestHost = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '').split(',')[0].trim();
  if (!requestHost || originHost !== requestHost) {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site profile mutation is not allowed');
  }
}

/**
 * Registers the anonymous profile HTTP contract and returns helpers needed by
 * the existing run-creation routes. Call this before registering those routes.
 */
export async function registerProfileRoutes(app, {
  service,
  runService,
  secureCookie = true,
  cookieName = secureCookie ? '__Host-zeely_profile' : 'zeely_profile_dev',
} = {}) {
  if (!service || !runService) throw new Error('registerProfileRoutes requires service and runService');
  await service.initialize();

  async function resolveRequestProfile(request, reply) {
    const supplied = parseCookies(request.headers.cookie)[cookieName];
    const session = service.resolveOrCreateSession(supplied);
    appendSetCookie(reply, sessionCookie(cookieName, session, { secure: secureCookie }));
    return session;
  }

  async function claimRunForRequest(request, reply, runId, { sourceAvatarId = null } = {}) {
    const session = await resolveRequestProfile(request, reply);
    const run = await runService.getRun(assertRunId(runId));
    if (!run) throw new ProfileError(404, 'RUN_NOT_FOUND', 'Run not found');
    return service.claimRun(session.profileId, runId, { sourceAvatarId });
  }

  async function serveProfileImage(request, reply, type) {
    const session = await resolveRequestProfile(request, reply);
    const descriptor = type === 'avatar'
      ? service.avatarAsset(session.profileId, request.params.avatarId)
      : service.lookAsset(session.profileId, request.params.lookId);
    if (!descriptor) return reply.code(404).send({ error: 'Image not found' });
    const filename = await runService.outputFile(descriptor.runId, descriptor.filename);
    if (!filename) return reply.code(404).send({ error: 'Image not found' });
    return reply
      .type('image/png')
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .header('Content-Disposition', `inline; filename="${descriptor.filename}"`)
      .send(createReadStream(filename));
  }

  app.get('/api/profile', async (request, reply) => {
    const session = await resolveRequestProfile(request, reply);
    return reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie').send(service.getProfile(session.profileId));
  });

  app.post('/api/profile/runs/:runId/claim', async (request, reply) => {
    sameOriginMutation(request);
    const sourceAvatarId = request.body?.source_avatar_id ?? null;
    if (sourceAvatarId !== null && typeof sourceAvatarId !== 'string') {
      throw new ProfileError(400, 'INVALID_SOURCE_AVATAR', 'source_avatar_id must be a UUID or null');
    }
    const claim = await claimRunForRequest(request, reply, request.params.runId, { sourceAvatarId });
    return reply.code(claim.replayed ? 200 : 201).send(claim);
  });

  app.post('/api/profile/runs/:runId/save', async (request, reply) => {
    sameOriginMutation(request);
    const session = await resolveRequestProfile(request, reply);
    const runId = assertRunId(request.params.runId);
    const claim = service.getClaim(session.profileId, runId);
    if (!claim) throw new ProfileError(404, 'RUN_NOT_CLAIMED', 'Run was not claimed by this browser profile');
    const run = await runService.getRun(runId);
    if (!run) throw new ProfileError(404, 'RUN_NOT_FOUND', 'Run not found');
    if (run.status !== 'COMPLETED') throw new ProfileError(409, 'RUN_NOT_COMPLETED', 'Run must be completed before it can be saved');
    if (claim.source_avatar_id === null && !await runService.outputFile(runId, 'avatar.png')) {
      throw new ProfileError(409, 'AVATAR_OUTPUT_MISSING', 'Completed run has no avatar output');
    }
    if (!await runService.outputFile(runId, 'avatar_outfit.png')) {
      throw new ProfileError(409, 'LOOK_OUTPUT_MISSING', 'Completed run has no look output');
    }
    const saved = service.saveClaimedRun(session.profileId, runId);
    return reply.code(saved.replayed ? 200 : 201).send({ ...saved, profile: service.getProfile(session.profileId) });
  });

  app.delete('/api/profile/avatars/:avatarId', async (request, reply) => {
    sameOriginMutation(request);
    const session = await resolveRequestProfile(request, reply);
    if (!service.deleteAvatar(session.profileId, request.params.avatarId)) return reply.code(404).send({ error: 'Avatar not found' });
    await service.flushDeletionQueue(runService);
    return reply.code(204).send();
  });

  app.delete('/api/profile/looks/:lookId', async (request, reply) => {
    sameOriginMutation(request);
    const session = await resolveRequestProfile(request, reply);
    if (!service.deleteLook(session.profileId, request.params.lookId)) return reply.code(404).send({ error: 'Look not found' });
    await service.flushDeletionQueue(runService);
    return reply.code(204).send();
  });

  app.delete('/api/profile', async (request, reply) => {
    sameOriginMutation(request);
    const session = await resolveRequestProfile(request, reply);
    service.deleteProfile(session.profileId);
    await service.flushDeletionQueue(runService);
    appendSetCookie(reply, clearCookie(cookieName, { secure: secureCookie }));
    return reply.code(204).send();
  });

  app.get('/api/profile/avatars/:avatarId/image', async (request, reply) => serveProfileImage(request, reply, 'avatar'));
  app.get('/api/profile/looks/:lookId/image', async (request, reply) => serveProfileImage(request, reply, 'look'));

  return {
    cookieName,
    resolveRequestProfile,
    claimRunForRequest,
    cleanup: async () => {
      const expired = service.cleanupExpired();
      const deletion = await service.flushDeletionQueue(runService);
      return { ...expired, ...deletion };
    },
  };
}
