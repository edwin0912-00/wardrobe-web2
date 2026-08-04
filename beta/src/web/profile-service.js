import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { buildLiveLookReferenceCard } from './live-look-reference.js';
import { sendPresentationImage } from './presentation-preview.js';

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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function containsPrivateEvidenceTransport(value) {
  if (value === null || value === undefined || Buffer.isBuffer(value)) return false;
  if (Array.isArray(value)) return value.some(containsPrivateEvidenceTransport);
  if (typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => (
    ['path', 'paths', 'filename', 'source_path', 'source_paths'].includes(key)
    || containsPrivateEvidenceTransport(item)
  ));
}

function serializeApprovedItemEvidence(evidence, sourceRunId) {
  if (evidence === null || evidence === undefined) return null;
  if (!evidence
    || evidence.schema_version !== '1.0.0'
    || evidence.kind !== 'APPROVED_ITEM_EVIDENCE'
    || evidence.source_run_id !== sourceRunId
    || !Array.isArray(evidence.items)
    || evidence.items.length === 0
    || containsPrivateEvidenceTransport(evidence)) {
    throw new ProfileError(
      409,
      'LOOK_ITEM_EVIDENCE_INVALID',
      'Saved look item evidence is missing or invalid',
    );
  }
  const serialized = {
    schema_version: evidence.schema_version,
    kind: evidence.kind,
    source_run_id: evidence.source_run_id,
    reference_pack: structuredClone(evidence.reference_pack),
    items: evidence.items.map((item) => {
      const data = Buffer.isBuffer(item?.data)
        ? item.data
        : (item?.data instanceof Uint8Array ? Buffer.from(item.data) : null);
      if (!data || data.length === 0 || sha256(data) !== item.sha256) {
        throw new ProfileError(
          409,
          'LOOK_ITEM_EVIDENCE_INVALID',
          'Saved look item evidence is missing or invalid',
        );
      }
      const { data: _data, ...logical } = item;
      return { ...structuredClone(logical), data_base64: data.toString('base64') };
    }),
  };
  const bytes = Buffer.from(JSON.stringify(serialized));
  return { bytes, sha256: sha256(bytes) };
}

function sqliteBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  return value instanceof Uint8Array ? Buffer.from(value) : null;
}

function verifiedApprovedLookBytes({
  sourceRunId,
  image,
  receipt,
  expectedImageSha256 = null,
  expectedReceiptSha256 = null,
}) {
  if (!Buffer.isBuffer(image) || image.length === 0
    || !Buffer.isBuffer(receipt) || receipt.length === 0) {
    throw new ProfileError(409, 'LOOK_RECEIPT_MISSING', 'Saved look output or receipt is missing');
  }
  const imageSha256 = sha256(image);
  const receiptSha256 = sha256(receipt);
  if ((expectedImageSha256 && imageSha256 !== expectedImageSha256)
    || (expectedReceiptSha256 && receiptSha256 !== expectedReceiptSha256)) {
    throw new ProfileError(409, 'LOOK_BINDING_MISMATCH', 'Approved look bytes no longer match the requested hashes');
  }
  let manifest;
  try {
    manifest = JSON.parse(receipt.toString('utf8'));
  } catch {
    throw new ProfileError(409, 'LOOK_RECEIPT_INVALID', 'Saved look receipt is invalid');
  }
  if (manifest.job_id !== `web-${sourceRunId}`
    || manifest.state !== 'COMPLETED'
    || manifest.outputs?.avatar_outfit?.sha256 !== imageSha256
    || manifest.qa?.avatar?.decision !== 'PASS'
    || manifest.qa?.outfit?.decision !== 'PASS') {
    throw new ProfileError(409, 'LOOK_RECEIPT_INVALID', 'Saved look is not bound to completed PASS receipts');
  }
  return { image, receipt, imageSha256, receiptSha256 };
}

function deserializeApprovedItemEvidence(evidenceJson, evidenceSha256, sourceRunId) {
  const evidenceBytes = sqliteBytes(evidenceJson);
  if (!evidenceBytes || sha256(evidenceBytes) !== evidenceSha256) {
    throw new ProfileError(
      409,
      'LOOK_ITEM_EVIDENCE_INVALID',
      'Saved look item evidence is missing or invalid',
    );
  }
  let serialized;
  try {
    serialized = JSON.parse(evidenceBytes.toString('utf8'));
  } catch {
    throw new ProfileError(
      409,
      'LOOK_ITEM_EVIDENCE_INVALID',
      'Saved look item evidence is missing or invalid',
    );
  }
  if (serialized?.schema_version !== '1.0.0'
    || serialized.kind !== 'APPROVED_ITEM_EVIDENCE'
    || serialized.source_run_id !== sourceRunId
    || !Array.isArray(serialized.items)
    || serialized.items.length === 0
    || containsPrivateEvidenceTransport(serialized)) {
    throw new ProfileError(
      409,
      'LOOK_ITEM_EVIDENCE_INVALID',
      'Saved look item evidence is missing or invalid',
    );
  }
  const items = serialized.items.map((item) => {
    const { data_base64: dataBase64, ...logical } = item;
    if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
      throw new ProfileError(
        409,
        'LOOK_ITEM_EVIDENCE_INVALID',
        'Saved look item evidence is missing or invalid',
      );
    }
    const data = Buffer.from(dataBase64, 'base64');
    if (data.length === 0 || sha256(data) !== logical.sha256) {
      throw new ProfileError(
        409,
        'LOOK_ITEM_EVIDENCE_INVALID',
        'Saved look item evidence is missing or invalid',
      );
    }
    return { ...logical, data };
  });
  return {
    schema_version: serialized.schema_version,
    kind: serialized.kind,
    source_run_id: serialized.source_run_id,
    reference_pack: serialized.reference_pack,
    items,
  };
}

function deserializeApprovedLookSnapshot(row) {
  const image = sqliteBytes(row?.look_image);
  const receipt = sqliteBytes(row?.look_receipt);
  if (!row || !image || !receipt) {
    throw new ProfileError(409, 'LOOK_RECEIPT_MISSING', 'Saved look output or receipt is missing');
  }
  const verified = verifiedApprovedLookBytes({
    sourceRunId: row.source_run_id,
    image,
    receipt,
    expectedImageSha256: row.look_image_sha256,
    expectedReceiptSha256: row.look_receipt_sha256,
  });
  const evidence = row.evidence_json === null
    ? null
    : deserializeApprovedItemEvidence(
      row.evidence_json,
      row.evidence_sha256,
      row.source_run_id,
    );
  const expectedBundleSha256 = sha256(Buffer.from(JSON.stringify({
    source_run_id: row.source_run_id,
    look_image_sha256: verified.imageSha256,
    look_receipt_sha256: verified.receiptSha256,
    evidence_sha256: row.evidence_sha256 ?? null,
  })));
  if (row.bundle_sha256 !== expectedBundleSha256) {
    throw new ProfileError(409, 'LOOK_BINDING_MISMATCH', 'Saved look bundle no longer matches its immutable binding');
  }
  return { ...verified, approved_item_evidence: evidence };
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

function rowScene(row) {
  const completed = row.status === 'COMPLETED' && typeof row.output_sha256 === 'string';
  return {
    scene_id: row.scene_id,
    look_id: row.look_id,
    preset: {
      preset_id: row.preset_id,
      version: row.preset_version,
    },
    status: row.status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    expires_at: iso(row.expires_at),
    image_url: completed ? `/api/profile/scenes/${encodeURIComponent(row.scene_id)}/image` : null,
    download_url: completed ? `/api/profile/scenes/${encodeURIComponent(row.scene_id)}/download` : null,
    output_sha256: completed ? row.output_sha256 : null,
  };
}

function rowEditorialShoot(row) {
  const hasHero = typeof row.hero_output_sha256 === 'string'
    && row.hero_output_sha256.length > 0;
  const hasPreview = typeof row.preview_output_sha256 === 'string'
    && row.preview_output_sha256.length > 0
    && typeof row.preview_slot === 'string'
    && row.preview_slot.length > 0;
  const heroBaseUrl = `/api/profile/editorial-shoots/${encodeURIComponent(row.shoot_id)}/shots/clean_identity_hero`;
  const previewBaseUrl = hasPreview
    ? `/api/profile/editorial-shoots/${encodeURIComponent(row.shoot_id)}/shots/${encodeURIComponent(row.preview_slot)}`
    : null;
  return {
    shoot_id: row.shoot_id,
    look_id: row.look_id,
    mode: {
      mode_id: row.mode_id,
      version: row.mode_version,
    },
    status: row.status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    expires_at: iso(row.expires_at),
    approved_shot_count: row.approved_shot_count,
    hero_output_sha256: row.hero_output_sha256 ?? null,
    hero_image_url: hasHero ? `${heroBaseUrl}/image` : null,
    hero_download_url: hasHero ? `${heroBaseUrl}/download` : null,
    // `clean_identity_hero` is an internal check for the direct five-frame
    // Fashion Shoot product.  It intentionally has no customer image, so the
    // saved library needs its own durable first-delivered-frame projection.
    preview_slot: hasPreview ? row.preview_slot : null,
    preview_output_sha256: hasPreview ? row.preview_output_sha256 : null,
    preview_image_url: previewBaseUrl ? `${previewBaseUrl}/image` : null,
    preview_download_url: previewBaseUrl ? `${previewBaseUrl}/download` : null,
  };
}

function editorialPresentationPreview(shoot) {
  const shots = Array.isArray(shoot?.shots) ? shoot.shots : [];
  // Prefer the internal check only when it really produced output (legacy
  // editorial). Direct `shoot.*` mode delivers the five customer slots, so
  // select their first durable output in the canonical slot order instead.
  const isDirectFiveShoot = String(shoot?.bindings?.shoot_bible?.mode_id ?? '').startsWith('shoot.');
  const candidates = isDirectFiveShoot
    ? shots.filter((shot) => shot?.slot !== 'clean_identity_hero')
    : shots;
  return candidates.find((shot) => (
    shot?.output?.sha256
    && ['APPROVED', 'QA_PASSED'].includes(shot.status)
  )) ?? candidates.find((shot) => shot?.output?.sha256) ?? null;
}

function rowVideoClip(row) {
  const hasOutput = typeof row.output_sha256 === 'string' && row.output_sha256.length > 0;
  return {
    clip_id: row.clip_id,
    look_id: row.look_id,
    motion_mode: row.motion_mode,
    surface: row.surface,
    job_id: row.job_id ?? null,
    status: row.status,
    output_sha256: row.output_sha256 ?? null,
    duration_seconds: row.duration_seconds ?? null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    expires_at: iso(row.expires_at),
    video_url: hasOutput ? `/api/profile/video-clips/${encodeURIComponent(row.clip_id)}/video` : null,
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

      CREATE TABLE IF NOT EXISTS approved_look_snapshots (
        look_id TEXT PRIMARY KEY,
        source_run_id TEXT NOT NULL,
        look_image_sha256 TEXT NOT NULL,
        look_receipt_sha256 TEXT NOT NULL,
        look_image BLOB NOT NULL,
        look_receipt BLOB NOT NULL,
        evidence_sha256 TEXT,
        evidence_json BLOB,
        bundle_sha256 TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (look_id) REFERENCES looks(look_id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS run_claims (
        run_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        source_avatar_id TEXT,
        source_look_id TEXT,
        saved_avatar_id TEXT,
        saved_look_id TEXT,
        claimed_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
        FOREIGN KEY (source_avatar_id) REFERENCES avatars(avatar_id) ON DELETE CASCADE,
        FOREIGN KEY (source_look_id) REFERENCES looks(look_id) ON DELETE SET NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS run_claims_profile_idx ON run_claims(profile_id, claimed_at DESC);

      CREATE TABLE IF NOT EXISTS scenes (
        scene_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        look_id TEXT NOT NULL,
        preset_id TEXT NOT NULL,
        preset_version TEXT NOT NULL,
        status TEXT NOT NULL,
        output_sha256 TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
        FOREIGN KEY (look_id) REFERENCES looks(look_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS scenes_profile_idx ON scenes(profile_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS scenes_look_idx ON scenes(look_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS editorial_shoots (
        shoot_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        look_id TEXT NOT NULL,
        mode_id TEXT NOT NULL,
        mode_version TEXT NOT NULL,
        status TEXT NOT NULL,
        approved_shot_count INTEGER NOT NULL DEFAULT 0,
        hero_output_sha256 TEXT,
        preview_slot TEXT,
        preview_output_sha256 TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
        FOREIGN KEY (look_id) REFERENCES looks(look_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS editorial_shoots_profile_idx
      ON editorial_shoots(profile_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS editorial_shoots_look_idx
      ON editorial_shoots(look_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS video_clips (
        clip_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        look_id TEXT NOT NULL,
        motion_mode TEXT NOT NULL,
        surface TEXT NOT NULL,
        job_id TEXT,
        status TEXT NOT NULL,
        output_sha256 TEXT,
        duration_seconds REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE,
        FOREIGN KEY (look_id) REFERENCES looks(look_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS video_clips_profile_idx ON video_clips(profile_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS video_clips_look_idx ON video_clips(look_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS pending_run_deletions (
        run_id TEXT PRIMARY KEY,
        queued_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_resource_deletions (
        resource_kind TEXT NOT NULL CHECK(resource_kind IN ('RUN', 'SCENE_EXECUTION', 'EDITORIAL_SHOOT', 'VIDEO_CLIP')),
        resource_id TEXT NOT NULL,
        queued_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        PRIMARY KEY(resource_kind, resource_id)
      ) STRICT;

      INSERT OR IGNORE INTO pending_resource_deletions(resource_kind, resource_id, queued_at, attempts, last_error)
      SELECT 'RUN', run_id, queued_at, attempts, last_error FROM pending_run_deletions
      ;
    `);
    const claimColumns = this.database.prepare('PRAGMA table_info(run_claims)').all();
    if (!claimColumns.some((column) => column.name === 'source_look_id')) {
      this.database.exec(`
        ALTER TABLE run_claims
        ADD COLUMN source_look_id TEXT REFERENCES looks(look_id) ON DELETE SET NULL
      `);
    }
    const editorialColumns = this.database.prepare('PRAGMA table_info(editorial_shoots)').all();
    if (!editorialColumns.some((column) => column.name === 'preview_slot')) {
      this.database.exec('ALTER TABLE editorial_shoots ADD COLUMN preview_slot TEXT');
    }
    if (!editorialColumns.some((column) => column.name === 'preview_output_sha256')) {
      this.database.exec('ALTER TABLE editorial_shoots ADD COLUMN preview_output_sha256 TEXT');
    }
    const deletionTable = this.database.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'pending_resource_deletions'
    `).get();
    if (!String(deletionTable?.sql ?? '').includes('VIDEO_CLIP')) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE pending_resource_deletions
        RENAME TO pending_resource_deletions_legacy;
        CREATE TABLE pending_resource_deletions (
          resource_kind TEXT NOT NULL CHECK(resource_kind IN ('RUN', 'SCENE_EXECUTION', 'EDITORIAL_SHOOT', 'VIDEO_CLIP')),
          resource_id TEXT NOT NULL,
          queued_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          PRIMARY KEY(resource_kind, resource_id)
        ) STRICT;
        INSERT INTO pending_resource_deletions(
          resource_kind, resource_id, queued_at, attempts, last_error
        )
        SELECT resource_kind, resource_id, queued_at, attempts, last_error
        FROM pending_resource_deletions_legacy;
        DROP TABLE pending_resource_deletions_legacy;
        COMMIT;
      `);
    }
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
    const sceneRows = this.#db().prepare(`
      SELECT scene_id, look_id, preset_id, preset_version, status, output_sha256,
             created_at, updated_at, expires_at
      FROM scenes WHERE profile_id = ? ORDER BY updated_at DESC, scene_id
    `).all(profileId);
    const editorialRows = this.#db().prepare(`
      SELECT shoot_id, look_id, mode_id, mode_version, status, approved_shot_count,
             hero_output_sha256, preview_slot, preview_output_sha256,
             created_at, updated_at, expires_at
      FROM editorial_shoots WHERE profile_id = ?
      ORDER BY updated_at DESC, shoot_id
    `).all(profileId);
    const videoClipRows = this.#db().prepare(`
      SELECT clip_id, look_id, motion_mode, surface, job_id, status, output_sha256,
             duration_seconds, created_at, updated_at, expires_at
      FROM video_clips WHERE profile_id = ?
      ORDER BY updated_at DESC, clip_id
    `).all(profileId);
    const scenes = sceneRows.map(rowScene);
    const editorialShoots = editorialRows.map(rowEditorialShoot);
    const videoClips = videoClipRows.map(rowVideoClip);
    const looks = lookRows.map((row) => {
      const look = rowLook(row);
      return {
        ...look,
        scenes: scenes.filter((scene) => scene.look_id === look.look_id),
        editorial_shoots: editorialShoots.filter((shoot) => shoot.look_id === look.look_id),
        video_clips: videoClips.filter((clip) => clip.look_id === look.look_id),
      };
    });
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
      scenes,
      editorial_shoots: editorialShoots,
      video_clips: videoClips,
    };
  }

  assertAddItemsSource(profileId, { sourceAvatarId, sourceLookId = null }) {
    assertAssetId(sourceAvatarId, 'source avatar id');
    if (sourceLookId !== null) assertAssetId(sourceLookId, 'source look id');
    if (!this.#activeProfile(profileId)) {
      throw new ProfileError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    }
    const avatar = this.#db().prepare(`
      SELECT avatar_id FROM avatars WHERE avatar_id = ? AND profile_id = ?
    `).get(sourceAvatarId, profileId);
    if (!avatar) throw new ProfileError(404, 'AVATAR_NOT_FOUND', 'Avatar not found');
    if (sourceLookId !== null) {
      const look = this.#db().prepare(`
        SELECT look_id, avatar_id FROM looks WHERE look_id = ? AND profile_id = ?
      `).get(sourceLookId, profileId);
      if (!look) throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
      if (look.avatar_id !== sourceAvatarId) {
        throw new ProfileError(409, 'LOOK_AVATAR_MISMATCH', 'Source look belongs to a different avatar');
      }
    }
    return { source_avatar_id: sourceAvatarId, source_look_id: sourceLookId };
  }

  claimRun(profileId, runId, { sourceAvatarId = null, sourceLookId = null } = {}) {
    assertRunId(runId);
    if (sourceAvatarId !== null) assertAssetId(sourceAvatarId, 'source avatar id');
    if (sourceLookId !== null) assertAssetId(sourceLookId, 'source look id');
    if (sourceLookId !== null && sourceAvatarId === null) {
      throw new ProfileError(400, 'SOURCE_LOOK_REQUIRES_AVATAR', 'Source look requires a source avatar');
    }
    return this.#transaction((database) => {
      if (!this.#activeProfile(profileId)) throw new ProfileError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
      if (sourceAvatarId !== null) {
        const avatar = database.prepare('SELECT avatar_id FROM avatars WHERE avatar_id = ? AND profile_id = ?').get(sourceAvatarId, profileId);
        if (!avatar) throw new ProfileError(404, 'AVATAR_NOT_FOUND', 'Avatar not found');
      }
      if (sourceLookId !== null) {
        const look = database.prepare(`
          SELECT look_id, avatar_id FROM looks WHERE look_id = ? AND profile_id = ?
        `).get(sourceLookId, profileId);
        if (!look) throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
        if (look.avatar_id !== sourceAvatarId) {
          throw new ProfileError(409, 'LOOK_AVATAR_MISMATCH', 'Source look belongs to a different avatar');
        }
      }
      const current = database.prepare(`
        SELECT profile_id, source_avatar_id, source_look_id FROM run_claims WHERE run_id = ?
      `).get(runId);
      if (current) {
        const sameProfile = constantTimeTextEqual(current.profile_id, profileId);
        if (!sameProfile) throw new ProfileError(409, 'RUN_UNAVAILABLE', 'Run is unavailable');
        // A run's lineage is fixed on its first claim. After a successful save
        // the browser deliberately clears local draft lineage; a refresh must
        // therefore replay the original claim, not misreport the already saved
        // profile as unavailable. Never rewrite the stored lineage here.
        return {
          run_id: runId,
          source_avatar_id: current.source_avatar_id ?? null,
          source_look_id: current.source_look_id ?? null,
          replayed: true,
        };
      }
      database.prepare(`
        INSERT INTO run_claims(run_id, profile_id, source_avatar_id, source_look_id, claimed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(runId, profileId, sourceAvatarId, sourceLookId, nowFrom(this.clock));
      return {
        run_id: runId,
        source_avatar_id: sourceAvatarId,
        source_look_id: sourceLookId,
        replayed: false,
      };
    });
  }

  getClaim(profileId, runId) {
    assertRunId(runId);
    const row = this.#db().prepare(`
      SELECT run_id, source_avatar_id, source_look_id, saved_avatar_id, saved_look_id, claimed_at
      FROM run_claims WHERE run_id = ? AND profile_id = ?
    `).get(runId, profileId);
    return row ? {
      run_id: row.run_id,
      source_avatar_id: row.source_avatar_id ?? null,
      source_look_id: row.source_look_id ?? null,
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
        SELECT source_avatar_id, source_look_id, saved_avatar_id, saved_look_id
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
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(lookId, profileId, avatarId, runId, claim.source_look_id ?? null, now, profile.expires_at);
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

  savedLookImage(profileId, lookId) {
    assertAssetId(lookId, 'look id');
    const row = this.#db().prepare(`
      SELECT s.source_run_id, s.look_image_sha256, s.look_receipt_sha256,
             s.look_image, s.look_receipt, s.evidence_sha256, s.evidence_json,
             s.bundle_sha256
      FROM approved_look_snapshots s
      JOIN looks l ON l.look_id = s.look_id
      JOIN profiles p ON p.profile_id = l.profile_id
      WHERE s.look_id = ? AND l.profile_id = ?
        AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(lookId, profileId, nowFrom(this.clock));
    if (!row) return null;
    const snapshot = deserializeApprovedLookSnapshot(row);
    return { bytes: snapshot.image, sha256: snapshot.imageSha256 };
  }

  async #verifiedLook(row, runService) {
    const run = await runService.getRun(row.source_run_id);
    if (!run || run.status !== 'COMPLETED') {
      throw new ProfileError(409, 'LOOK_SOURCE_NOT_COMPLETED', 'Saved look source is not completed');
    }
    const [imagePath, receiptPath] = await Promise.all([
      runService.outputFile(row.source_run_id, 'avatar_outfit.png'),
      runService.outputFile(row.source_run_id, 'run-manifest.json'),
    ]);
    if (!imagePath || !receiptPath) {
      throw new ProfileError(409, 'LOOK_RECEIPT_MISSING', 'Saved look output or receipt is missing');
    }
    const [image, receipt] = await Promise.all([readFile(imagePath), readFile(receiptPath)]);
    const verified = verifiedApprovedLookBytes({
      sourceRunId: row.source_run_id,
      image,
      receipt,
    });
    return {
      look_id: row.look_id,
      avatar_id: row.avatar_id,
      source_run_id: row.source_run_id,
      ...verified,
      image_sha256: verified.imageSha256,
      receipt_sha256: verified.receiptSha256,
      expires_at: iso(row.expires_at),
    };
  }

  #approvedLookSnapshot(lookId) {
    return this.#db().prepare(`
      SELECT source_run_id, look_image_sha256, look_receipt_sha256,
             look_image, look_receipt, evidence_sha256, evidence_json,
             bundle_sha256
      FROM approved_look_snapshots WHERE look_id = ?
    `).get(lookId);
  }

  async #verifiedSavedLook(row, runService) {
    const snapshot = this.#approvedLookSnapshot(row.look_id);
    if (!snapshot) return this.#verifiedLook(row, runService);
    if (snapshot.source_run_id !== row.source_run_id) {
      throw new ProfileError(409, 'LOOK_BINDING_MISMATCH', 'Saved look source changed after snapshot creation');
    }
    const durable = deserializeApprovedLookSnapshot(snapshot);
    return {
      look_id: row.look_id,
      avatar_id: row.avatar_id,
      source_run_id: row.source_run_id,
      image: durable.image,
      receipt: durable.receipt,
      image_sha256: durable.imageSha256,
      receipt_sha256: durable.receiptSha256,
      approved_item_evidence: durable.approved_item_evidence,
      expires_at: iso(row.expires_at),
    };
  }

  async approvedLookReference(profileId, lookId, runService) {
    assertAssetId(lookId, 'look id');
    const row = this.#db().prepare(`
      SELECT l.look_id, l.profile_id, l.avatar_id, l.source_run_id, l.expires_at
      FROM looks l JOIN profiles p ON p.profile_id = l.profile_id
      WHERE l.look_id = ? AND l.profile_id = ?
        AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(lookId, profileId, nowFrom(this.clock));
    if (!row) throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
    const verified = await this.#verifiedSavedLook(row, runService);
    return {
      look_id: verified.look_id,
      image_sha256: verified.image_sha256,
      receipt_sha256: verified.receipt_sha256,
    };
  }

  async saveApprovedLookSnapshot(profileId, lookId, {
    sourceRunId,
    runService,
    evidence,
  }) {
    assertAssetId(lookId, 'look id');
    assertRunId(sourceRunId);
    const snapshot = serializeApprovedItemEvidence(evidence, sourceRunId);
    const row = this.#db().prepare(`
      SELECT look_id, profile_id, avatar_id, source_run_id, expires_at
      FROM looks WHERE look_id = ? AND profile_id = ?
    `).get(lookId, profileId);
    if (!row) throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
    if (row.source_run_id !== sourceRunId) {
      throw new ProfileError(409, 'LOOK_BINDING_MISMATCH', 'Saved look source changed before snapshot persistence');
    }
    const verified = await this.#verifiedLook(row, runService);
    const bundleSha256 = sha256(Buffer.from(JSON.stringify({
      source_run_id: sourceRunId,
      look_image_sha256: verified.image_sha256,
      look_receipt_sha256: verified.receipt_sha256,
      evidence_sha256: snapshot?.sha256 ?? null,
    })));
    return this.#transaction((database) => {
      const existing = database.prepare(`
        SELECT source_run_id, look_image_sha256, look_receipt_sha256,
               evidence_sha256, bundle_sha256
        FROM approved_look_snapshots WHERE look_id = ?
      `).get(lookId);
      if (existing) {
        if (existing.source_run_id !== sourceRunId
          || existing.look_image_sha256 !== verified.image_sha256
          || existing.look_receipt_sha256 !== verified.receipt_sha256
          || (existing.evidence_sha256 ?? null) !== (snapshot?.sha256 ?? null)
          || existing.bundle_sha256 !== bundleSha256) {
          throw new ProfileError(
            409,
            'LOOK_SNAPSHOT_CONFLICT',
            'Saved look conflicts with its immutable snapshot',
          );
        }
        return { bundle_sha256: existing.bundle_sha256, replayed: true };
      }
      database.prepare(`
        INSERT INTO approved_look_snapshots(
          look_id, source_run_id, look_image_sha256, look_receipt_sha256,
          look_image, look_receipt, evidence_sha256, evidence_json,
          bundle_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        lookId,
        sourceRunId,
        verified.image_sha256,
        verified.receipt_sha256,
        verified.image,
        verified.receipt,
        snapshot?.sha256 ?? null,
        snapshot?.bytes ?? null,
        bundleSha256,
        nowFrom(this.clock),
      );
      return { bundle_sha256: bundleSha256, replayed: false };
    });
  }

  async resolveApprovedLook(reference, runService) {
    assertAssetId(reference?.look_id, 'look id');
    const row = this.#db().prepare(`
      SELECT l.look_id, l.profile_id, l.avatar_id, l.source_run_id, l.expires_at
      FROM looks l JOIN profiles p ON p.profile_id = l.profile_id
      WHERE l.look_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(reference.look_id, nowFrom(this.clock));
    if (!row) throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
    const verified = await this.#verifiedSavedLook(row, runService);
    if (reference.image_sha256 !== verified.image_sha256
      || reference.receipt_sha256 !== verified.receipt_sha256) {
      throw new ProfileError(409, 'LOOK_BINDING_MISMATCH', 'Approved look bytes no longer match the requested hashes');
    }
    let approvedItemEvidence = verified.approved_item_evidence ?? null;
    const hasSnapshot = Boolean(this.#approvedLookSnapshot(verified.look_id));
    if (!hasSnapshot && typeof runService.approvedItemEvidenceForRun === 'function') {
      try {
        approvedItemEvidence = await runService.approvedItemEvidenceForRun(
          verified.source_run_id,
          {
            expectedReceiptSha256: verified.receipt_sha256,
            expectedLookSha256: verified.image_sha256,
          },
        );
      } catch {
        throw new ProfileError(
          409,
          'LOOK_ITEM_EVIDENCE_INVALID',
          'Saved look item evidence is missing or invalid',
        );
      }
      await this.saveApprovedLookSnapshot(row.profile_id, verified.look_id, {
          sourceRunId: verified.source_run_id,
          runService,
          evidence: approvedItemEvidence,
      });
    }
    return {
      look_id: verified.look_id,
      source_run_id: verified.source_run_id,
      image: verified.image,
      receipt: verified.receipt,
      approved_item_evidence: approvedItemEvidence,
    };
  }

  // The Live mirror's only legitimate person-free reference. It goes through the
  // same lock as every other consumer — the look's receipt, its QA gates and its
  // item evidence — and then composites the already-verified cutouts. The person
  // is never part of it: on the mirror the person arrives on the camera track,
  // and a second identity in the reference is exactly the drift this lock exists
  // to prevent.
  async approvedLookLiveReference(profileId, lookId, runService) {
    const reference = await this.approvedLookReference(profileId, lookId, runService);
    const resolved = await this.resolveApprovedLook(reference, runService);
    if (!resolved.approved_item_evidence) {
      throw new ProfileError(
        409,
        'LOOK_ITEM_EVIDENCE_INVALID',
        'Saved look item evidence is missing or invalid',
      );
    }
    let card;
    try {
      card = await buildLiveLookReferenceCard(resolved.approved_item_evidence);
    } catch (error) {
      throw new ProfileError(
        error?.status ?? 422,
        error?.code ?? 'LIVE_REFERENCE_INVALID',
        error?.message ?? 'Live reference could not be built',
      );
    }
    return {
      look_id: resolved.look_id,
      source_run_id: resolved.source_run_id,
      image_sha256: reference.image_sha256,
      receipt_sha256: reference.receipt_sha256,
      reference_sha256: card.sha256,
      width: card.width,
      height: card.height,
      items: card.items,
      image: card.image,
    };
  }

  ownsLook(profileId, lookId) {
    assertAssetId(lookId, 'look id');
    return Boolean(this.#db().prepare(`
      SELECT 1 FROM looks l JOIN profiles p ON p.profile_id = l.profile_id
      WHERE l.look_id = ? AND l.profile_id = ?
        AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(lookId, profileId, nowFrom(this.clock)));
  }

  projectScene(profileId, lookId, scene) {
    assertAssetId(lookId, 'look id');
    if (!scene || typeof scene !== 'object' || typeof scene.scene_id !== 'string') {
      throw new ProfileError(400, 'INVALID_SCENE', 'Scene projection is invalid');
    }
    return this.#transaction((database) => {
      const profile = this.#activeProfile(profileId);
      const look = database.prepare('SELECT look_id FROM looks WHERE look_id = ? AND profile_id = ?').get(lookId, profileId);
      if (!profile || !look) throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
      if (scene.approved_look?.look_id !== lookId) {
        throw new ProfileError(409, 'SCENE_LOOK_MISMATCH', 'Scene is bound to a different look');
      }
      const existing = database.prepare(`
        SELECT profile_id, look_id, preset_id, preset_version FROM scenes WHERE scene_id = ?
      `).get(scene.scene_id);
      const presetId = scene.preset?.preset_id;
      const presetVersion = scene.preset?.version;
      if (typeof presetId !== 'string' || typeof presetVersion !== 'string') {
        throw new ProfileError(400, 'INVALID_SCENE_PRESET', 'Scene preset projection is invalid');
      }
      if (existing && (existing.profile_id !== profileId
        || existing.look_id !== lookId
        || existing.preset_id !== presetId
        || existing.preset_version !== presetVersion)) {
        throw new ProfileError(404, 'SCENE_NOT_FOUND', 'Scene not found');
      }
      const createdAt = Number.isFinite(Date.parse(scene.created_at)) ? Date.parse(scene.created_at) : nowFrom(this.clock);
      const updatedAt = Number.isFinite(Date.parse(scene.updated_at)) ? Date.parse(scene.updated_at) : nowFrom(this.clock);
      database.prepare(`
        INSERT INTO scenes(
          scene_id, profile_id, look_id, preset_id, preset_version, status,
          output_sha256, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scene_id) DO UPDATE SET
          status = excluded.status,
          output_sha256 = excluded.output_sha256,
          updated_at = excluded.updated_at
      `).run(
        scene.scene_id,
        profileId,
        lookId,
        presetId,
        presetVersion,
        String(scene.status),
        scene.output?.sha256 ?? null,
        createdAt,
        updatedAt,
        profile.expires_at,
      );
      return this.sceneProjection(profileId, scene.scene_id);
    });
  }

  syncSceneProjection(scene) {
    if (!scene
      || typeof scene.scene_id !== 'string'
      || typeof scene.status !== 'string'
      || typeof scene.approved_look?.look_id !== 'string') return null;
    const updatedAt = Number.isFinite(Date.parse(scene.updated_at)) ? Date.parse(scene.updated_at) : nowFrom(this.clock);
    const result = this.#db().prepare(`
      UPDATE scenes SET status = ?, output_sha256 = ?, updated_at = ?
      WHERE scene_id = ? AND look_id = ?
    `).run(
      String(scene.status),
      scene.output?.sha256 ?? null,
      updatedAt,
      scene.scene_id,
      scene.approved_look?.look_id ?? '',
    );
    if (result.changes === 0) return null;
    return this.#db().prepare('SELECT profile_id FROM scenes WHERE scene_id = ?').get(scene.scene_id) ?? null;
  }

  sceneProjectionRecords() {
    return this.#db().prepare(`
      SELECT scene_id, profile_id, look_id
      FROM scenes
      ORDER BY created_at, scene_id
    `).all();
  }

  sceneProjection(profileId, sceneId) {
    const row = this.#db().prepare(`
      SELECT s.scene_id, s.look_id, s.preset_id, s.preset_version, s.status,
             s.output_sha256, s.created_at, s.updated_at, s.expires_at
      FROM scenes s JOIN profiles p ON p.profile_id = s.profile_id
      WHERE s.scene_id = ? AND s.profile_id = ?
        AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(sceneId, profileId, nowFrom(this.clock));
    return row ? rowScene(row) : null;
  }

  listScenes(profileId, lookId) {
    assertAssetId(lookId, 'look id');
    if (!this.ownsLook(profileId, lookId)) return null;
    return this.#db().prepare(`
      SELECT scene_id, look_id, preset_id, preset_version, status, output_sha256,
             created_at, updated_at, expires_at
      FROM scenes WHERE profile_id = ? AND look_id = ?
      ORDER BY updated_at DESC, scene_id
    `).all(profileId, lookId).map(rowScene);
  }

  projectEditorialShoot(profileId, lookId, shoot) {
    assertAssetId(lookId, 'look id');
    if (!shoot
      || typeof shoot !== 'object'
      || typeof shoot.shoot_id !== 'string'
      || typeof shoot.status !== 'string') {
      throw new ProfileError(400, 'INVALID_EDITORIAL_SHOOT', 'Editorial shoot projection is invalid');
    }
    assertRunId(shoot.shoot_id);
    return this.#transaction((database) => {
      const profile = this.#activeProfile(profileId);
      const look = database.prepare(
        'SELECT look_id FROM looks WHERE look_id = ? AND profile_id = ?',
      ).get(lookId, profileId);
      if (!profile || !look) throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
      if (shoot.bindings?.approved_look?.look_id !== lookId) {
        throw new ProfileError(
          409,
          'EDITORIAL_SHOOT_LOOK_MISMATCH',
          'Editorial shoot is bound to a different look',
        );
      }
      const modeId = shoot.bindings?.shoot_bible?.mode_id;
      const modeVersion = shoot.bindings?.shoot_bible?.mode_version;
      if (typeof modeId !== 'string' || typeof modeVersion !== 'string') {
        throw new ProfileError(
          400,
          'INVALID_EDITORIAL_MODE',
          'Editorial shoot mode projection is invalid',
        );
      }
      const existing = database.prepare(`
        SELECT profile_id, look_id, mode_id, mode_version
        FROM editorial_shoots WHERE shoot_id = ?
      `).get(shoot.shoot_id);
      if (existing && (
        existing.profile_id !== profileId
        || existing.look_id !== lookId
        || existing.mode_id !== modeId
        || existing.mode_version !== modeVersion
      )) {
        throw new ProfileError(404, 'EDITORIAL_SHOOT_NOT_FOUND', 'Editorial shoot not found');
      }
      const createdAt = Number.isFinite(Date.parse(shoot.created_at))
        ? Date.parse(shoot.created_at)
        : nowFrom(this.clock);
      const updatedAt = Number.isFinite(Date.parse(shoot.updated_at))
        ? Date.parse(shoot.updated_at)
        : nowFrom(this.clock);
      const approvedShotCount = Array.isArray(shoot.shots)
        ? shoot.shots.filter((shot) => shot.status === 'APPROVED').length
        : 0;
      const heroOutputSha256 = shoot.shots?.[0]?.output?.sha256 ?? null;
      const preview = editorialPresentationPreview(shoot);
      const previewSlot = preview?.slot ?? null;
      const previewOutputSha256 = preview?.output?.sha256 ?? null;
      database.prepare(`
        INSERT INTO editorial_shoots(
          shoot_id, profile_id, look_id, mode_id, mode_version, status,
          approved_shot_count, hero_output_sha256, preview_slot, preview_output_sha256,
          created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(shoot_id) DO UPDATE SET
          status = excluded.status,
          approved_shot_count = excluded.approved_shot_count,
          hero_output_sha256 = excluded.hero_output_sha256,
          preview_slot = excluded.preview_slot,
          preview_output_sha256 = excluded.preview_output_sha256,
          updated_at = excluded.updated_at
      `).run(
        shoot.shoot_id,
        profileId,
        lookId,
        modeId,
        modeVersion,
        shoot.status,
        approvedShotCount,
        heroOutputSha256,
        previewSlot,
        previewOutputSha256,
        createdAt,
        updatedAt,
        profile.expires_at,
      );
      return this.editorialShootProjection(profileId, shoot.shoot_id);
    });
  }

  syncEditorialShootProjection(shoot) {
    if (!shoot
      || typeof shoot.shoot_id !== 'string'
      || typeof shoot.status !== 'string'
      || typeof shoot.bindings?.approved_look?.look_id !== 'string') return null;
    const approvedShotCount = Array.isArray(shoot.shots)
      ? shoot.shots.filter((shot) => shot.status === 'APPROVED').length
      : 0;
    const updatedAt = Number.isFinite(Date.parse(shoot.updated_at))
      ? Date.parse(shoot.updated_at)
      : nowFrom(this.clock);
    const preview = editorialPresentationPreview(shoot);
    const result = this.#db().prepare(`
      UPDATE editorial_shoots
      SET status = ?, approved_shot_count = ?, hero_output_sha256 = ?,
          preview_slot = ?, preview_output_sha256 = ?, updated_at = ?
      WHERE shoot_id = ? AND look_id = ?
    `).run(
      shoot.status,
      approvedShotCount,
      shoot.shots?.[0]?.output?.sha256 ?? null,
      preview?.slot ?? null,
      preview?.output?.sha256 ?? null,
      updatedAt,
      shoot.shoot_id,
      shoot.bindings.approved_look.look_id,
    );
    if (result.changes === 0) return null;
    return this.#db().prepare(
      'SELECT profile_id FROM editorial_shoots WHERE shoot_id = ?',
    ).get(shoot.shoot_id) ?? null;
  }

  editorialShootProjectionRecords() {
    return this.#db().prepare(`
      SELECT shoot_id, profile_id, look_id
      FROM editorial_shoots
      ORDER BY created_at, shoot_id
    `).all();
  }

  editorialShootProjection(profileId, shootId) {
    assertRunId(shootId);
    const row = this.#db().prepare(`
      SELECT e.shoot_id, e.look_id, e.mode_id, e.mode_version, e.status,
             e.approved_shot_count, e.hero_output_sha256,
             e.preview_slot, e.preview_output_sha256,
             e.created_at, e.updated_at, e.expires_at
      FROM editorial_shoots e JOIN profiles p ON p.profile_id = e.profile_id
      WHERE e.shoot_id = ? AND e.profile_id = ?
        AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(shootId, profileId, nowFrom(this.clock));
    return row ? rowEditorialShoot(row) : null;
  }

  listEditorialShoots(profileId, lookId) {
    assertAssetId(lookId, 'look id');
    if (!this.ownsLook(profileId, lookId)) return null;
    return this.#db().prepare(`
      SELECT shoot_id, look_id, mode_id, mode_version, status, approved_shot_count,
             hero_output_sha256, preview_slot, preview_output_sha256,
             created_at, updated_at, expires_at
      FROM editorial_shoots
      WHERE profile_id = ? AND look_id = ?
      ORDER BY updated_at DESC, shoot_id
    `).all(profileId, lookId).map(rowEditorialShoot);
  }

  deleteEditorialShoot(profileId, shootId) {
    assertRunId(shootId);
    return this.#transaction((database) => {
      const shoot = database.prepare(`
        SELECT shoot_id FROM editorial_shoots
        WHERE shoot_id = ? AND profile_id = ?
      `).get(shootId, profileId);
      if (!shoot) return false;
      this.#queueResource(database, 'EDITORIAL_SHOOT', shootId, nowFrom(this.clock));
      database.prepare(`
        DELETE FROM editorial_shoots WHERE shoot_id = ? AND profile_id = ?
      `).run(shootId, profileId);
      return true;
    });
  }

  projectVideoClip(profileId, lookId, clip) {
    assertAssetId(lookId, 'look id');
    if (!clip
      || typeof clip !== 'object'
      || typeof clip.clip_id !== 'string'
      || typeof clip.status !== 'string') {
      throw new ProfileError(400, 'INVALID_VIDEO_CLIP', 'Video clip projection is invalid');
    }
    assertRunId(clip.clip_id);
    return this.#transaction((database) => {
      const profile = this.#activeProfile(profileId);
      const look = database.prepare(
        'SELECT look_id FROM looks WHERE look_id = ? AND profile_id = ?',
      ).get(lookId, profileId);
      if (!profile || !look) throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
      if (clip.bindings?.approved_look?.look_id !== lookId) {
        throw new ProfileError(
          409,
          'VIDEO_CLIP_LOOK_MISMATCH',
          'Video clip is bound to a different look',
        );
      }
      const motionMode = clip.bindings?.motion_mode;
      const surface = clip.bindings?.surface;
      if (typeof motionMode !== 'string' || typeof surface !== 'string') {
        throw new ProfileError(
          400,
          'INVALID_VIDEO_CLIP_BINDINGS',
          'Video clip bindings projection is invalid',
        );
      }
      const existing = database.prepare(`
        SELECT profile_id, look_id, motion_mode, surface
        FROM video_clips WHERE clip_id = ?
      `).get(clip.clip_id);
      if (existing && (
        existing.profile_id !== profileId
        || existing.look_id !== lookId
        || existing.motion_mode !== motionMode
        || existing.surface !== surface
      )) {
        throw new ProfileError(404, 'VIDEO_CLIP_NOT_FOUND', 'Video clip not found');
      }
      const createdAt = Number.isFinite(Date.parse(clip.created_at))
        ? Date.parse(clip.created_at)
        : nowFrom(this.clock);
      const updatedAt = Number.isFinite(Date.parse(clip.updated_at))
        ? Date.parse(clip.updated_at)
        : nowFrom(this.clock);
      
      const jobId = clip.job_id ?? null;
      const outputSha256 = clip.output?.sha256 ?? null;
      const durationSeconds = clip.output?.duration_seconds ?? null;
      
      database.prepare(`
        INSERT INTO video_clips(
          clip_id, profile_id, look_id, motion_mode, surface, job_id, status,
          output_sha256, duration_seconds, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clip_id) DO UPDATE SET
          status = excluded.status,
          job_id = excluded.job_id,
          output_sha256 = excluded.output_sha256,
          duration_seconds = excluded.duration_seconds,
          updated_at = excluded.updated_at
      `).run(
        clip.clip_id,
        profileId,
        lookId,
        motionMode,
        surface,
        jobId,
        clip.status,
        outputSha256,
        durationSeconds,
        createdAt,
        updatedAt,
        profile.expires_at,
      );
      return this.videoClipProjection(profileId, clip.clip_id);
    });
  }

  syncVideoClipProjection(clip) {
    if (!clip
      || typeof clip.clip_id !== 'string'
      || typeof clip.status !== 'string'
      || typeof clip.bindings?.approved_look?.look_id !== 'string') return null;
    const updatedAt = Number.isFinite(Date.parse(clip.updated_at))
      ? Date.parse(clip.updated_at)
      : nowFrom(this.clock);
    const result = this.#db().prepare(`
      UPDATE video_clips
      SET status = ?, job_id = ?, output_sha256 = ?, duration_seconds = ?, updated_at = ?
      WHERE clip_id = ? AND look_id = ?
    `).run(
      clip.status,
      clip.job_id ?? null,
      clip.output?.sha256 ?? null,
      clip.output?.duration_seconds ?? null,
      updatedAt,
      clip.clip_id,
      clip.bindings.approved_look.look_id,
    );
    if (result.changes === 0) return null;
    return this.#db().prepare(
      'SELECT profile_id FROM video_clips WHERE clip_id = ?',
    ).get(clip.clip_id) ?? null;
  }

  videoClipProjectionRecords() {
    return this.#db().prepare(`
      SELECT clip_id, profile_id, look_id
      FROM video_clips
      ORDER BY created_at, clip_id
    `).all();
  }

  videoClipProjection(profileId, clipId) {
    assertRunId(clipId);
    const row = this.#db().prepare(`
      SELECT v.clip_id, v.look_id, v.motion_mode, v.surface, v.job_id, v.status,
             v.output_sha256, v.duration_seconds,
             v.created_at, v.updated_at, v.expires_at
      FROM video_clips v JOIN profiles p ON p.profile_id = v.profile_id
      WHERE v.clip_id = ? AND v.profile_id = ?
        AND p.revoked_at IS NULL AND p.expires_at > ?
    `).get(clipId, profileId, nowFrom(this.clock));
    return row ? rowVideoClip(row) : null;
  }

  listVideoClips(profileId, lookId) {
    assertAssetId(lookId, 'look id');
    if (!this.ownsLook(profileId, lookId)) return null;
    return this.#db().prepare(`
      SELECT clip_id, look_id, motion_mode, surface, job_id, status, output_sha256,
             duration_seconds, created_at, updated_at, expires_at
      FROM video_clips
      WHERE profile_id = ? AND look_id = ?
      ORDER BY updated_at DESC, clip_id
    `).all(profileId, lookId).map(rowVideoClip);
  }

  /**
   * Read-only, server-internal inventory for the separately authenticated God
   * View. It intentionally excludes browser verifier hashes, cookies and any
   * filesystem path. Asset bytes stay behind the God View route authorization.
   */
  godViewSnapshot() {
    const now = nowFrom(this.clock);
    const activeProfiles = this.#db().prepare(`
      SELECT profile_id, created_at, expires_at
      FROM profiles
      WHERE revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC, profile_id
    `).all(now);
    const profiles = activeProfiles.map((row) => ({
      profile_id: row.profile_id,
      created_at: iso(row.created_at),
      expires_at: iso(row.expires_at),
      avatars: [],
      runs: [],
    }));
    const byProfile = new Map(profiles.map((profile) => [profile.profile_id, profile]));
    const avatars = new Map();
    const looks = new Map();

    for (const row of this.#db().prepare(`
      SELECT a.avatar_id, a.profile_id, a.source_run_id, a.created_at, a.expires_at
      FROM avatars a JOIN profiles p ON p.profile_id = a.profile_id
      WHERE p.revoked_at IS NULL AND p.expires_at > ?
      ORDER BY a.created_at DESC, a.avatar_id
    `).all(now)) {
      const avatar = {
        avatar_id: row.avatar_id,
        source_run_id: row.source_run_id,
        created_at: iso(row.created_at),
        expires_at: iso(row.expires_at),
        looks: [],
      };
      avatars.set(row.avatar_id, avatar);
      byProfile.get(row.profile_id)?.avatars.push(avatar);
    }

    for (const row of this.#db().prepare(`
      SELECT l.look_id, l.profile_id, l.avatar_id, l.source_run_id, l.parent_look_id,
             l.created_at, l.expires_at
      FROM looks l JOIN profiles p ON p.profile_id = l.profile_id
      WHERE p.revoked_at IS NULL AND p.expires_at > ?
      ORDER BY l.created_at DESC, l.look_id
    `).all(now)) {
      const look = {
        look_id: row.look_id,
        source_run_id: row.source_run_id,
        parent_look_id: row.parent_look_id ?? null,
        created_at: iso(row.created_at),
        expires_at: iso(row.expires_at),
        scenes: [],
        shoots: [],
        videos: [],
      };
      looks.set(row.look_id, look);
      avatars.get(row.avatar_id)?.looks.push(look);
    }

    for (const row of this.#db().prepare(`
      SELECT rc.run_id, rc.profile_id, rc.source_avatar_id, rc.source_look_id,
             rc.saved_avatar_id, rc.saved_look_id, rc.claimed_at
      FROM run_claims rc JOIN profiles p ON p.profile_id = rc.profile_id
      WHERE p.revoked_at IS NULL AND p.expires_at > ?
      ORDER BY rc.claimed_at DESC, rc.run_id
    `).all(now)) {
      byProfile.get(row.profile_id)?.runs.push({
        run_id: row.run_id,
        source_avatar_id: row.source_avatar_id ?? null,
        source_look_id: row.source_look_id ?? null,
        saved_avatar_id: row.saved_avatar_id ?? null,
        saved_look_id: row.saved_look_id ?? null,
        claimed_at: iso(row.claimed_at),
      });
    }

    for (const row of this.#db().prepare(`
      SELECT s.scene_id, s.look_id, s.preset_id, s.preset_version, s.status,
             s.output_sha256, s.created_at, s.updated_at
      FROM scenes s JOIN profiles p ON p.profile_id = s.profile_id
      WHERE p.revoked_at IS NULL AND p.expires_at > ?
      ORDER BY s.updated_at DESC, s.scene_id
    `).all(now)) {
      looks.get(row.look_id)?.scenes.push({
        scene_id: row.scene_id,
        preset_id: row.preset_id,
        preset_version: row.preset_version,
        status: row.status,
        output_sha256: row.output_sha256 ?? null,
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
      });
    }

    for (const row of this.#db().prepare(`
      SELECT e.shoot_id, e.look_id, e.mode_id, e.mode_version, e.status,
             e.approved_shot_count, e.hero_output_sha256,
             e.preview_slot, e.preview_output_sha256,
             e.created_at, e.updated_at
      FROM editorial_shoots e JOIN profiles p ON p.profile_id = e.profile_id
      WHERE p.revoked_at IS NULL AND p.expires_at > ?
      ORDER BY e.updated_at DESC, e.shoot_id
    `).all(now)) {
      looks.get(row.look_id)?.shoots.push({
        shoot_id: row.shoot_id,
        mode_id: row.mode_id,
        mode_version: row.mode_version,
        status: row.status,
        approved_shot_count: row.approved_shot_count,
        hero_output_sha256: row.hero_output_sha256 ?? null,
        preview_slot: row.preview_slot ?? null,
        preview_output_sha256: row.preview_output_sha256 ?? null,
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
      });
    }

    for (const row of this.#db().prepare(`
      SELECT v.clip_id, v.look_id, v.motion_mode, v.surface, v.job_id, v.status,
             v.output_sha256, v.duration_seconds, v.created_at, v.updated_at
      FROM video_clips v JOIN profiles p ON p.profile_id = v.profile_id
      WHERE p.revoked_at IS NULL AND p.expires_at > ?
      ORDER BY v.updated_at DESC, v.clip_id
    `).all(now)) {
      looks.get(row.look_id)?.videos.push({
        clip_id: row.clip_id,
        motion_mode: row.motion_mode,
        surface: row.surface,
        job_id: row.job_id ?? null,
        status: row.status,
        output_sha256: row.output_sha256 ?? null,
        duration_seconds: row.duration_seconds ?? null,
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
      });
    }
    return { profiles };
  }

  godViewOwns(kind, resourceId) {
    assertRunId(resourceId);
    const now = nowFrom(this.clock);
    const queries = {
      RUN: `SELECT 1 FROM run_claims r JOIN profiles p ON p.profile_id = r.profile_id
            WHERE r.run_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?`,
      SCENE: `SELECT 1 FROM scenes s JOIN profiles p ON p.profile_id = s.profile_id
              WHERE s.scene_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?`,
      SHOOT: `SELECT 1 FROM editorial_shoots e JOIN profiles p ON p.profile_id = e.profile_id
              WHERE e.shoot_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?`,
      VIDEO: `SELECT 1 FROM video_clips v JOIN profiles p ON p.profile_id = v.profile_id
              WHERE v.clip_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?`,
    };
    if (!queries[kind]) throw new Error('God View resource kind is invalid');
    return Boolean(this.#db().prepare(queries[kind]).get(resourceId, now));
  }

  deleteVideoClip(profileId, clipId) {
    assertRunId(clipId);
    return this.#transaction((database) => {
      const clip = database.prepare(`
        SELECT clip_id FROM video_clips
        WHERE clip_id = ? AND profile_id = ?
      `).get(clipId, profileId);
      if (!clip) return false;
      this.#queueResource(database, 'VIDEO_CLIP', clipId, nowFrom(this.clock));
      database.prepare(`
        DELETE FROM video_clips WHERE clip_id = ? AND profile_id = ?
      `).run(clipId, profileId);
      return true;
    });
  }

  deleteScene(profileId, sceneId) {
    return this.#transaction((database) => {
      const scene = database.prepare('SELECT scene_id FROM scenes WHERE scene_id = ? AND profile_id = ?').get(sceneId, profileId);
      if (!scene) return false;
      this.#queueResource(database, 'SCENE_EXECUTION', sceneId, nowFrom(this.clock));
      database.prepare('DELETE FROM scenes WHERE scene_id = ? AND profile_id = ?').run(sceneId, profileId);
      return true;
    });
  }

  #queueResource(database, resourceKind, resourceId, now) {
    database.prepare(`
      INSERT INTO pending_resource_deletions(resource_kind, resource_id, queued_at)
      VALUES (?, ?, ?)
      ON CONFLICT(resource_kind, resource_id) DO NOTHING
    `).run(resourceKind, resourceId, now);
  }

  #queueRun(database, runId, now) {
    this.#queueResource(database, 'RUN', runId, now);
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
      const sceneIds = database.prepare('SELECT scene_id FROM scenes WHERE look_id = ? AND profile_id = ?').all(lookId, profileId);
      const editorialShootIds = database.prepare(`
        SELECT shoot_id FROM editorial_shoots WHERE look_id = ? AND profile_id = ?
      `).all(lookId, profileId);
      const videoClipIds = database.prepare(`
        SELECT clip_id FROM video_clips WHERE look_id = ? AND profile_id = ?
      `).all(lookId, profileId);
      for (const { scene_id: sceneId } of sceneIds) {
        this.#queueResource(database, 'SCENE_EXECUTION', sceneId, nowFrom(this.clock));
      }
      for (const { shoot_id: shootId } of editorialShootIds) {
        this.#queueResource(database, 'EDITORIAL_SHOOT', shootId, nowFrom(this.clock));
      }
      for (const { clip_id: clipId } of videoClipIds) {
        this.#queueResource(database, 'VIDEO_CLIP', clipId, nowFrom(this.clock));
      }
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
      const sceneIds = database.prepare(`
        SELECT s.scene_id
        FROM scenes s JOIN looks l ON l.look_id = s.look_id
        WHERE l.avatar_id = ? AND s.profile_id = ?
      `).all(avatarId, profileId);
      const editorialShootIds = database.prepare(`
        SELECT e.shoot_id
        FROM editorial_shoots e JOIN looks l ON l.look_id = e.look_id
        WHERE l.avatar_id = ? AND e.profile_id = ?
      `).all(avatarId, profileId);
      const videoClipIds = database.prepare(`
        SELECT v.clip_id
        FROM video_clips v JOIN looks l ON l.look_id = v.look_id
        WHERE l.avatar_id = ? AND v.profile_id = ?
      `).all(avatarId, profileId);
      for (const { scene_id: sceneId } of sceneIds) {
        this.#queueResource(database, 'SCENE_EXECUTION', sceneId, nowFrom(this.clock));
      }
      for (const { shoot_id: shootId } of editorialShootIds) {
        this.#queueResource(database, 'EDITORIAL_SHOOT', shootId, nowFrom(this.clock));
      }
      for (const { clip_id: clipId } of videoClipIds) {
        this.#queueResource(database, 'VIDEO_CLIP', clipId, nowFrom(this.clock));
      }
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
      const sceneIds = database.prepare('SELECT scene_id FROM scenes WHERE profile_id = ?').all(profileId).map((row) => row.scene_id);
      const editorialShootIds = database.prepare(`
        SELECT shoot_id FROM editorial_shoots WHERE profile_id = ?
      `).all(profileId).map((row) => row.shoot_id);
      const videoClipIds = database.prepare(`
        SELECT clip_id FROM video_clips WHERE profile_id = ?
      `).all(profileId).map((row) => row.clip_id);
      for (const runId of runIds) this.#queueRun(database, runId, now);
      for (const sceneId of sceneIds) this.#queueResource(database, 'SCENE_EXECUTION', sceneId, now);
      for (const shootId of editorialShootIds) {
        this.#queueResource(database, 'EDITORIAL_SHOOT', shootId, now);
      }
      for (const clipId of videoClipIds) {
        this.#queueResource(database, 'VIDEO_CLIP', clipId, now);
      }
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
      const sceneIds = [];
      const editorialShootIds = [];
      const videoClipIds = [];
      for (const profile of profiles) {
        const claimed = database.prepare('SELECT run_id FROM run_claims WHERE profile_id = ?').all(profile.profile_id);
        const scenes = database.prepare('SELECT scene_id FROM scenes WHERE profile_id = ?').all(profile.profile_id);
        const editorialShoots = database.prepare(`
          SELECT shoot_id FROM editorial_shoots WHERE profile_id = ?
        `).all(profile.profile_id);
        const videoClips = database.prepare(`
          SELECT clip_id FROM video_clips WHERE profile_id = ?
        `).all(profile.profile_id);
        for (const { run_id: runId } of claimed) {
          runIds.push(runId);
          this.#queueRun(database, runId, now);
        }
        for (const { scene_id: sceneId } of scenes) {
          sceneIds.push(sceneId);
          this.#queueResource(database, 'SCENE_EXECUTION', sceneId, now);
        }
        for (const { shoot_id: shootId } of editorialShoots) {
          editorialShootIds.push(shootId);
          this.#queueResource(database, 'EDITORIAL_SHOOT', shootId, now);
        }
        for (const { clip_id: clipId } of videoClips) {
          videoClipIds.push(clipId);
          this.#queueResource(database, 'VIDEO_CLIP', clipId, now);
        }
        database.prepare('DELETE FROM profiles WHERE profile_id = ?').run(profile.profile_id);
      }
      return {
        removedProfiles: profiles.length,
        queuedRuns: [...new Set(runIds)],
        queuedScenes: [...new Set(sceneIds)],
        queuedEditorialShoots: [...new Set(editorialShootIds)],
        queuedVideoClips: [...new Set(videoClipIds)],
      };
    });
  }

  pendingRunDeletions() {
    return this.#db().prepare(`
      SELECT resource_id AS run_id, attempts, last_error
      FROM pending_resource_deletions
      WHERE resource_kind = 'RUN'
      ORDER BY queued_at
    `).all();
  }

  pendingResourceDeletions() {
    return this.#db().prepare(`
      SELECT resource_kind, resource_id, attempts, last_error
      FROM pending_resource_deletions
      ORDER BY queued_at, resource_kind, resource_id
    `).all();
  }

  async flushDeletionQueue(services, optionalSceneService = null) {
    const runService = services?.runService ?? services;
    const sceneService = services?.sceneService ?? optionalSceneService;
    const editorialShootService = services?.editorialShootService ?? null;
    const videoService = services?.videoService ?? null;
    const pending = this.pendingResourceDeletions();
    const result = {
      deleted: [],
      deferred: [],
      deletedRuns: [],
      deletedScenes: [],
      deletedEditorialShoots: [],
      deletedVideoClips: [],
    };
    for (const item of pending) {
      try {
        if (item.resource_kind === 'RUN') {
          if (!runService?.deleteRun) throw new Error('Run deletion service is unavailable');
          await runService.deleteRun(item.resource_id);
          this.#db().prepare('DELETE FROM pending_run_deletions WHERE run_id = ?').run(item.resource_id);
          result.deletedRuns.push(item.resource_id);
        } else if (item.resource_kind === 'SCENE_EXECUTION') {
          if (!sceneService?.deleteScene) throw new Error('Scene deletion service is unavailable');
          try {
            await sceneService.deleteScene(item.resource_id);
          } catch (error) {
            if (error?.code !== 'SCENE_RUNNING') throw error;
            await sceneService.cancelScene(item.resource_id, 'Parent profile asset was deleted');
            const running = sceneService.running?.get(item.resource_id);
            if (running) await running;
            await sceneService.deleteScene(item.resource_id);
          }
          result.deletedScenes.push(item.resource_id);
        } else if (item.resource_kind === 'EDITORIAL_SHOOT') {
          if (!editorialShootService?.deleteShoot) {
            throw new Error('Editorial shoot deletion service is unavailable');
          }
          await editorialShootService.deleteShoot(item.resource_id);
          result.deletedEditorialShoots.push(item.resource_id);
        } else if (item.resource_kind === 'VIDEO_CLIP') {
          if (!videoService?.deleteClip) {
            throw new Error('Video clip deletion service is unavailable');
          }
          await videoService.deleteClip(item.resource_id);
          result.deletedVideoClips.push(item.resource_id);
        }
        this.#db().prepare(`
          DELETE FROM pending_resource_deletions WHERE resource_kind = ? AND resource_id = ?
        `).run(item.resource_kind, item.resource_id);
        result.deleted.push(item.resource_id);
      } catch (error) {
        this.#db().prepare(`
          UPDATE pending_resource_deletions
          SET attempts = attempts + 1, last_error = ?
          WHERE resource_kind = ? AND resource_id = ?
        `).run(String(error?.message ?? error).slice(0, 500), item.resource_kind, item.resource_id);
        if (item.resource_kind === 'RUN') {
          this.#db().prepare(`
            UPDATE pending_run_deletions SET attempts = attempts + 1, last_error = ? WHERE run_id = ?
          `).run(String(error?.message ?? error).slice(0, 500), item.resource_id);
        }
        result.deferred.push(item.resource_id);
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
  sceneService = null,
  editorialShootService = null,
  videoService = null,
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

  async function claimRunForRequest(
    request,
    reply,
    runId,
    { sourceAvatarId = null, sourceLookId = null } = {},
  ) {
    const session = await resolveRequestProfile(request, reply);
    const run = await runService.getRun(assertRunId(runId));
    if (!run) throw new ProfileError(404, 'RUN_NOT_FOUND', 'Run not found');
    return service.claimRun(session.profileId, runId, { sourceAvatarId, sourceLookId });
  }

  async function serveProfileImage(request, reply, type) {
    const session = await resolveRequestProfile(request, reply);
    if (type === 'look') {
      const saved = service.savedLookImage(session.profileId, request.params.lookId);
      if (saved) {
        return sendPresentationImage(request, reply, {
          bytes: saved.bytes,
          mediaType: 'image/png',
          downloadName: 'avatar_outfit.png',
          cacheControl: 'private, max-age=900',
        });
      }
    }
    const descriptor = type === 'avatar'
      ? service.avatarAsset(session.profileId, request.params.avatarId)
      : service.lookAsset(session.profileId, request.params.lookId);
    if (!descriptor) return reply.code(404).send({ error: 'Image not found' });
    const filename = await runService.outputFile(descriptor.runId, descriptor.filename);
    if (!filename) return reply.code(404).send({ error: 'Image not found' });
    return sendPresentationImage(request, reply, {
      filename,
      downloadName: descriptor.filename,
      cacheControl: 'private, max-age=900',
    });
  }

  app.get('/api/profile', async (request, reply) => {
    const session = await resolveRequestProfile(request, reply);
    return reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie').send(service.getProfile(session.profileId));
  });

  app.post('/api/profile/runs/:runId/claim', async (request, reply) => {
    sameOriginMutation(request);
    const sourceAvatarId = request.body?.source_avatar_id ?? null;
    const sourceLookId = request.body?.source_look_id ?? null;
    if (sourceAvatarId !== null && typeof sourceAvatarId !== 'string') {
      throw new ProfileError(400, 'INVALID_SOURCE_AVATAR', 'source_avatar_id must be a UUID or null');
    }
    if (sourceLookId !== null && typeof sourceLookId !== 'string') {
      throw new ProfileError(400, 'INVALID_SOURCE_LOOK', 'source_look_id must be a UUID or null');
    }
    const claim = await claimRunForRequest(request, reply, request.params.runId, {
      sourceAvatarId,
      sourceLookId,
    });
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
    if (typeof runService.approvedItemEvidenceForRun === 'function') {
      const garmentBacked = Array.isArray(run.inputs?.garments) && run.inputs.garments.length > 0;
      try {
        const reference = await service.approvedLookReference(
          session.profileId,
          saved.look.look_id,
          runService,
        );
        const evidence = await runService.approvedItemEvidenceForRun(runId, {
          expectedReceiptSha256: reference.receipt_sha256,
          expectedLookSha256: reference.image_sha256,
        });
        if (garmentBacked && !evidence) {
          throw new Error('Garment-backed saved look has no approved item evidence');
        }
        await service.saveApprovedLookSnapshot(session.profileId, saved.look.look_id, {
          sourceRunId: runId,
          runService,
          evidence,
        });
      } catch {
        if (garmentBacked) {
          throw new ProfileError(
            409,
            'LOOK_ITEM_EVIDENCE_INVALID',
            'Saved look item evidence is missing or invalid',
          );
        }
      }
    }
    return reply.code(saved.replayed ? 200 : 201).send({ ...saved, profile: service.getProfile(session.profileId) });
  });

  app.delete('/api/profile/avatars/:avatarId', async (request, reply) => {
    sameOriginMutation(request);
    const session = await resolveRequestProfile(request, reply);
    if (!service.deleteAvatar(session.profileId, request.params.avatarId)) return reply.code(404).send({ error: 'Avatar not found' });
    await service.flushDeletionQueue({ runService, sceneService, editorialShootService, videoService });
    return reply.code(204).send();
  });

  app.delete('/api/profile/looks/:lookId', async (request, reply) => {
    sameOriginMutation(request);
    const session = await resolveRequestProfile(request, reply);
    if (!service.deleteLook(session.profileId, request.params.lookId)) return reply.code(404).send({ error: 'Look not found' });
    await service.flushDeletionQueue({ runService, sceneService, editorialShootService, videoService });
    return reply.code(204).send();
  });

  app.delete('/api/profile', async (request, reply) => {
    sameOriginMutation(request);
    const session = await resolveRequestProfile(request, reply);
    service.deleteProfile(session.profileId);
    await service.flushDeletionQueue({ runService, sceneService, editorialShootService, videoService });
    appendSetCookie(reply, clearCookie(cookieName, { secure: secureCookie }));
    return reply.code(204).send();
  });

  app.get('/api/profile/avatars/:avatarId/image', async (request, reply) => serveProfileImage(request, reply, 'avatar'));
  app.get('/api/profile/looks/:lookId/image', async (request, reply) => serveProfileImage(request, reply, 'look'));

  // Two views of the same locked artifact: the binding a caller must echo back,
  // and the bytes themselves. Both fail closed — an unverifiable look, missing
  // item evidence or an incomplete set answers with a code, never with a
  // best-effort image.
  app.get('/api/profile/looks/:lookId/live-reference', async (request, reply) => {
    const session = await resolveRequestProfile(request, reply);
    const built = await service.approvedLookLiveReference(
      session.profileId,
      request.params.lookId,
      runService,
    );
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .send({
        look_id: built.look_id,
        image_sha256: built.image_sha256,
        receipt_sha256: built.receipt_sha256,
        reference_sha256: built.reference_sha256,
        width: built.width,
        height: built.height,
        items: built.items,
      });
  });

  app.get('/api/profile/looks/:lookId/live-reference.png', async (request, reply) => {
    const session = await resolveRequestProfile(request, reply);
    const built = await service.approvedLookLiveReference(
      session.profileId,
      request.params.lookId,
      runService,
    );
    return reply
      .type('image/png')
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .header('X-Live-Reference-Sha256', built.reference_sha256)
      .header('Content-Disposition', 'inline; filename="live-reference.png"')
      .send(built.image);
  });

  return {
    cookieName,
    resolveRequestProfile,
    claimRunForRequest,
    cleanup: async () => {
      const expired = service.cleanupExpired();
      const deletion = await service.flushDeletionQueue({
        runService,
        sceneService,
        editorialShootService,
        videoService,
      });
      return { ...expired, ...deletion };
    },
  };
}
